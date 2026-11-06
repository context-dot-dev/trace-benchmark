import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import registry from "../../../config/sources.json";
import {
  attempts,
  budgets,
  candidates,
  runs,
  seen,
  sources,
  worker,
} from "./schema";
import {
  categories,
  providers,
  PROTOCOL,
  type Candidate,
  type RunSummary,
} from "./types";
import { createReaders, type Readers } from "./providers";
import { runProvider, providerWorkers } from "./parallel";
import { discoverSource, type Source } from "./discovery";
import { summarize } from "./report";
import type { Store } from "./store";

export function authorizeCron(
  request: Request,
  env: Record<string, string | undefined> = process.env,
) {
  const expected = env.CRON_SECRET && Buffer.from("Bearer " + env.CRON_SECRET);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (
    !expected ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return 401;
  return env.VERCEL_ENV === "production" ? 200 : 403;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
type TickOptions = {
  now?: () => Date;
  readers?: Readers;
  discover?: boolean;
  discovery?: { registry: Source[]; discover: typeof discoverSource };
  perCategory?: number;
  maxPages?: number;
  deadlineMs?: number;
};
export async function runTick(store: Store, options: TickOptions = {}) {
  const now = options.now ?? (() => new Date());
  const clock = now();
  const day = clock.toISOString().slice(0, 10);
  const token = randomUUID();
  const readers = options.readers ?? createReaders();
  if (!readers.ready()) throw new Error("Collector credentials are incomplete");
  const lease = new Date(clock.getTime() + 300000);
  const acquired = await store.db
    .insert(worker)
    .values({
      id: "collector",
      claim: token,
      leaseUntil: lease,
      lastTick: clock,
      error: null,
    })
    .onConflictDoUpdate({
      target: worker.id,
      set: { claim: token, leaseUntil: lease, lastTick: clock, error: null },
      setWhere: or(isNull(worker.leaseUntil), lt(worker.leaseUntil, clock)),
    })
    .returning();
  if (!acquired.length) return { status: "busy" };
  let processed = 0;
  try {
    await store.db
      .update(attempts)
      .set({
        state: "done",
        success: null,
        error: "INTERRUPTED_REQUEST",
        claim: null,
        leaseUntil: null,
      })
      .where(
        and(eq(attempts.state, "fetching"), lt(attempts.leaseUntil, clock)),
      );
    await store.db
      .update(attempts)
      .set({ state: "fetched", claim: null, leaseUntil: null })
      .where(
        and(eq(attempts.state, "grading"), lt(attempts.leaseUntil, clock)),
      );
    const samplePending =
      clock.toISOString().slice(11, 16) >= "00:15" &&
      !(
        await store.db
          .select({ id: runs.id })
          .from(runs)
          .where(eq(runs.day, day))
      ).length;
    if (options.discover !== false)
      await discoverDue(store, clock, samplePending, options.discovery);
    if (samplePending)
      await selectSample(store, day, options.perCategory ?? 300, clock);
    if (options.maxPages !== 0) {
      const configured = providerWorkers();
      const workers = options.maxPages === undefined ? configured : providers.map(({ id }) => ({
        provider: id, shard: 0, shards: 1,
        concurrency: Math.min(options.maxPages!, configured.filter((entry) => entry.provider === id)
          .reduce((sum, entry) => sum + entry.concurrency, 0)),
        requestsPerSecond: configured.filter((entry) => entry.provider === id)
          .reduce((sum, entry) => sum + entry.requestsPerSecond, 0),
      }));
      const results = await Promise.allSettled(workers.map((config) =>
        runProvider(store, {
          ...config, readers, now, maxPages: options.maxPages,
          deadlineMs: options.deadlineMs,
        }),
      ));
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
      processed = results.reduce((sum, result) => sum +
        (result.status === "fulfilled" ? result.value.processed : 0), 0);
    }
    for (const run of await store.db
      .select()
      .from(runs)
      .where(eq(runs.status, "collecting"))) {
      const rows = await store.db
        .select({
          provider: attempts.provider,
          pageId: attempts.pageId,
          category: attempts.category,
          state: attempts.state,
          success: attempts.success,
          elapsedMs: attempts.elapsedMs,
          error: attempts.error,
        })
        .from(attempts)
        .where(eq(attempts.runId, run.id));
      const done = rows.every((r) => r.state === "done");
      const finished = done ? now() : null;
      const summary = summarize(
        run.id,
        run.day,
        run.protocol,
        rows,
        run.summary.target,
        finished,
      );
      await store.db
        .update(runs)
        .set({ status: summary.status, summary, finishedAt: finished })
        .where(eq(runs.id, run.id));
    }
    await retainEvidence(store, clock);
    const errors = await store.db.select({ error: worker.error }).from(worker).where(and(
      isNotNull(worker.error),
      or(sql`${worker.id} like 'collector:%'`,
        and(sql`${worker.id} like 'pause:%'`, sql`${worker.leaseUntil} > ${clock}`)),
    ));
    if (errors.length) await store.db.update(worker).set({
      error: [...new Set(errors.map((row) => row.error))].join("; "),
    }).where(and(eq(worker.id, "collector"), eq(worker.claim, token)));
    return { status: "advanced", processed, day };
  } catch (error) {
    await store.db
      .update(worker)
      .set({ error: "Collection failed; inspect Vercel runtime logs" })
      .where(and(eq(worker.id, "collector"), eq(worker.claim, token)));
    throw error;
  } finally {
    await store.db
      .update(worker)
      .set({ claim: null, leaseUntil: null, lastTick: now() })
      .where(and(eq(worker.id, "collector"), eq(worker.claim, token)));
  }
}
async function discoverDue(
  store: Store,
  clock: Date,
  samplePending: boolean,
  discovery?: TickOptions["discovery"],
) {
  const sourceRegistry = discovery?.registry ?? registry;
  const discover = discovery?.discover ?? discoverSource;
  await store.db
    .insert(sources)
    .values(
      sourceRegistry.map((s) => ({ id: s.source_id, nextPoll: new Date(0) })),
    )
    .onConflictDoNothing();
  const due = await store.db
    .select()
    .from(sources)
    .where(
      and(
        lt(sources.nextPoll, clock),
        inArray(
          sources.id,
          sourceRegistry
            .filter((s) => s.kind !== "wikipedia")
            .map((s) => s.source_id),
        ),
      ),
    )
    .orderBy(sources.nextPoll)
    .limit(48);
  if (samplePending)
    due.push(
      ...(await store.db
        .select()
        .from(sources)
        .where(
          and(
            lte(sources.nextPoll, clock),
            inArray(
              sources.id,
              sourceRegistry
                .filter((s) => s.kind === "wikipedia")
                .map((s) => s.source_id),
            ),
          ),
        )),
    );
  const nextDailySample = new Date(clock);
  nextDailySample.setUTCHours(24, 15, 0, 0);
  await Promise.all(
    due.map(async (due) => {
      const source = sourceRegistry.find((s) => s.source_id === due.id) as
        Source | undefined;
      if (!source) return;
      try {
        const rows = await discover(source, { now: clock });
        await store.seedCandidates(rows);
        await store.db
          .update(sources)
          .set({
            lastPoll: clock,
            nextPoll:
              source.kind === "wikipedia"
                ? nextDailySample
                : new Date(
                    clock.getTime() + source.poll_interval_hours * 3600000,
                  ),
            count: rows.length,
            error: null,
          })
          .where(eq(sources.id, due.id));
      } catch (error) {
        await store.db
          .update(sources)
          .set({
            ...(source.kind === "wikipedia" ? {} : { lastPoll: clock }),
            nextPoll:
              source.kind === "wikipedia"
                ? nextDailySample
                : new Date(
                    clock.getTime() +
                      Math.max(1, source.poll_interval_hours) * 3600000,
                  ),
            error:
              error instanceof Error
                ? error.message.slice(0, 120)
                : "Source failed",
          })
          .where(eq(sources.id, due.id));
      }
    }),
  );
}
async function selectSample(
  store: Store,
  day: string,
  perCategory: number,
  clock: Date,
) {
  await store.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(74012492)`);
    const runId = PROTOCOL + ":" + day;
    if (
      (await tx.select({ id: runs.id }).from(runs).where(eq(runs.day, day)))
        .length
    )
      return;
    const used = await tx.select().from(budgets).where(eq(budgets.day, day));
    const remaining = Math.min(
      ...providers.map(
        (p) => 4000 - (used.find((b) => b.bucket === p.id)?.used ?? 0),
      ),
    );
    perCategory = Math.min(
      perCategory,
      Math.max(0, Math.floor(remaining / (categories.length + 1))),
    );
    if (!perCategory) return;
    const selected: Candidate[] = [];
    const prior = new Set<string>();
    const orgCounts = new Map<string, number>();
    const hostCounts = new Map<string, number>();
    for (const category of [...categories, { id: "other" }]) {
      const pool = await tx
        .select()
        .from(candidates)
        .where(
          and(
            eq(candidates.category, category.id),
            sql`not exists(select 1 from scraping_bench.seen s where s.id=${candidates.id} or s.id=encode(sha256(convert_to(${candidates.url},'UTF8')),'hex'))`,
          ),
        )
        .orderBy(desc(candidates.discoveredAt))
        .limit(6000);
      const groups = new Map<string, Candidate[]>();
      for (const c of pool) {
        if (prior.has(c.id) || prior.has(hash(c.url))) continue;
        const group = groups.get(c.organization) ?? [];
        group.push(c);
        groups.set(c.organization, group);
      }
      const ordered = [...groups].sort((a, b) =>
        hash(day + a[0]).localeCompare(hash(day + b[0])),
      );
      for (const [, rows] of ordered)
        rows.sort((a, b) => hash(day + a.id).localeCompare(hash(day + b.id)));
      let count = 0;
      while (count < perCategory) {
        let moved = false;
        for (const [org, rows] of ordered) {
          if (count >= perCategory) break;
          if ((orgCounts.get(org) ?? 0) >= 125) continue;
          const c = rows.shift();
          if (!c) continue;
          moved = true;
          const host = new URL(c.url).hostname;
          if (
            prior.has(c.id) ||
            prior.has(hash(c.url)) ||
            (hostCounts.get(host) ?? 0) >= 375
          )
            continue;
          selected.push(c);
          prior.add(c.id);
          prior.add(hash(c.url));
          orgCounts.set(org, (orgCounts.get(org) ?? 0) + 1);
          hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
          count++;
        }
        if (!moved) break;
      }
    }
    if (!selected.length) return;
    if (categories.some((c) => !selected.some((p) => p.category === c.id))) {
      const unpolled = await tx
        .select({ id: sources.id })
        .from(sources)
        .where(
          and(
            isNull(sources.lastPoll),
            inArray(
              sources.id,
              registry
                .filter((source) => source.kind !== "wikipedia")
                .map((source) => source.source_id),
            ),
          ),
        )
        .limit(1);
      if (unpolled.length) return;
    }
    const rows = selected.flatMap((c) =>
      providers.map((p) => ({
        id: hash(runId + c.id + p.id),
        runId,
        day,
        pageId: c.id,
        provider: p.id,
        url: c.url,
        title: c.title,
        category: c.category,
        provenance: c.provenance,
        state: "queued",
      })),
    );
    const summary: RunSummary = {
      id: runId,
      day,
      protocol: PROTOCOL,
      status: selected.length ? "collecting" : "insufficient_supply",
      pages: selected.length,
      target: perCategory * (categories.length + 1),
      finishedAt: null,
      providers: [],
      categories: Object.fromEntries(
        [...categories, { id: "other" }].map((c) => [
          c.id,
          selected.filter((p) => p.category === c.id).length,
        ]),
      ),
    };
    await tx.insert(runs).values({
      id: runId,
      day,
      protocol: PROTOCOL,
      status: summary.status,
      summary,
      createdAt: clock,
    });
    for (let i = 0; i < rows.length; i += 200)
      await tx.insert(attempts).values(rows.slice(i, i + 200));
    const identities = selected.flatMap((c) => [
      { id: c.id, day },
      { id: hash(c.url), day },
    ]);
    for (let i = 0; i < identities.length; i += 200)
      await tx
        .insert(seen)
        .values(identities.slice(i, i + 200))
        .onConflictDoNothing();
  });
}
function retentionDays(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 1 ? value : fallback;
}
// Grading evidence is kept long enough to regrade and audit published samples, and page-level
// records long enough to recheck history. Both are configurable; see README.
export const retention = () => ({
  evidenceDays: retentionDays("TRACE_EVIDENCE_DAYS", 30),
  evidenceBytes: retentionDays("TRACE_EVIDENCE_MAX_MB", 900) * 1_000_000,
  recordDays: retentionDays("TRACE_RECORD_DAYS", 180),
});
async function retainEvidence(store: Store, clock: Date) {
  const { evidenceDays, evidenceBytes, recordDays } = retention();
  const cutoff = new Date(clock.getTime() - evidenceDays * 86400000)
    .toISOString()
    .slice(0, 10);
  await store.db
    .update(attempts)
    .set({ evidence: null, evidenceBytes: 0 })
    .where(
      and(
        eq(attempts.state, "done"),
        isNotNull(attempts.evidence),
        lt(attempts.day, cutoff),
      ),
    );
  const [{ bytes }] = await store.db
    .select({
      bytes: sql<number>`coalesce(sum(${attempts.evidenceBytes}),0)::int`,
    })
    .from(attempts);
  if (bytes > evidenceBytes)
    await store.db.execute(
      sql`with oldest as (select id,sum(evidence_bytes) over(order by day,id) as size from scraping_bench.attempts where state='done' and evidence_bytes>0) update scraping_bench.attempts set evidence=null,evidence_bytes=0 where id in(select id from oldest where size<=${bytes - Math.floor(evidenceBytes * 0.94)})`,
    );
  await store.db
    .delete(attempts)
    .where(
      and(
        inArray(
          attempts.runId,
          store.db
            .select({ id: runs.id })
            .from(runs)
            .where(eq(runs.status, "completed")),
        ),
        eq(attempts.state, "done"),
        lt(
          attempts.day,
          new Date(clock.getTime() - recordDays * 86400000)
            .toISOString()
            .slice(0, 10),
        ),
      ),
    );
  await store.db
    .delete(candidates)
    .where(
      lt(candidates.discoveredAt, new Date(clock.getTime() - 30 * 86400000)),
    );
}
