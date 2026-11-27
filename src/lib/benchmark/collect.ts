import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  and,
  desc,
  eq,
  getTableColumns,
  gt,
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
  probes,
  runs,
  seen,
  sources,
  worker,
} from "./schema";
import {
  ACCESS_PROTOCOL,
  categories,
  HARD_PROTOCOL,
  providers,
  type Candidate,
  type RunSummary,
  type SamplingSummary,
} from "./types";
import {
  PROBE_VERSION,
  probeMany,
  probePage,
  probeId,
  type Probe,
  type ProbeLabel,
} from "./probe";
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
function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Hard-first sampling (protocol v7) admits pages that a neutral plain HTTP GET could not read.
// TRACE_SAMPLING=all restores the v6 sample, which draws from every discovered page.
export type SamplingMode = "hard-first" | "all";
export const samplingMode = (env: Record<string, string | undefined> = process.env): SamplingMode =>
  env.TRACE_SAMPLING === "all" ? "all" : "hard-first";
export const protocolFor = (mode: SamplingMode) => (mode === "all" ? ACCESS_PROTOCOL : HARD_PROTOCOL);
export type ProbeFn = (url: string, signal: AbortSignal) => Promise<Probe>;
const defaultProbe: ProbeFn = (url, signal) => probePage(url, { signal });
/** A probe older than this is repeated, because sites change their defenses. */
const PROBE_FRESH_MS = 14 * 86400000;
/** Newest unseen candidates considered per category. */
const POOL_LIMIT = 20000;
/** Pages one organization may contribute to a sample, and pages one hostname may contribute. */
const ORGANIZATION_CAP = 125;
const HOST_CAP = 375;
export const samplingLimits = () => ({
  // Easy pages top up a category with too few hard pages to this size, so every core category
  // stays scored. Set TRACE_MIN_PER_CATEGORY=0 to sample hard pages only.
  minPerCategory: envNumber("TRACE_MIN_PER_CATEGORY", 50),
  maxProbesPerCategory: envNumber("TRACE_PROBE_MAX_PER_CATEGORY", 2000),
  probeConcurrency: Math.max(1, envNumber("TRACE_PROBE_CONCURRENCY", 24)),
});

type PoolRow = Candidate & { probe: ProbeLabel | null };
type Reader = Pick<Store["db"], "select">;
/** Unseen candidates in a category, newest first, with any fresh probe of the same URL. */
async function loadPool(db: Reader, category: string, clock: Date): Promise<PoolRow[]> {
  const rows = await db
    .select({
      ...getTableColumns(candidates),
      verdict: probes.verdict,
      reason: probes.reason,
    })
    .from(candidates)
    .leftJoin(
      probes,
      and(
        sql`${probes.id}=encode(sha256(convert_to(${candidates.url},'UTF8')),'hex')`,
        eq(probes.version, PROBE_VERSION),
        gt(probes.probedAt, new Date(clock.getTime() - PROBE_FRESH_MS)),
      ),
    )
    .where(
      and(
        eq(candidates.category, category),
        sql`not exists(select 1 from scraping_bench.seen s where s.id=${candidates.id} or s.id=encode(sha256(convert_to(${candidates.url},'UTF8')),'hex'))`,
      ),
    )
    .orderBy(desc(candidates.discoveredAt))
    .limit(POOL_LIMIT);
  return rows.map(({ verdict, reason, ...c }) => ({
    ...c,
    probe: verdict ? ({ verdict, reason, version: PROBE_VERSION } as ProbeLabel) : null,
  }));
}
/**
 * Day-seeded round-robin across organizations: the order in which selection considers pages.
 * Organizations and their pages are each ordered by a hash of the day, so the sample is
 * deterministic for a day and no organization is favored.
 */
export function interleave<T extends { id: string; organization: string }>(rows: T[], day: string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.organization, [...(groups.get(row.organization) ?? []), row]);
  const ordered = [...groups].sort((a, b) => hash(day + a[0]).localeCompare(hash(day + b[0])));
  for (const [, group] of ordered) group.sort((a, b) => hash(day + a.id).localeCompare(hash(day + b.id)));
  const out: T[] = [];
  for (let round = 0; out.length < rows.length; round++)
    for (const [, group] of ordered) if (round < group.length) out.push(group[round]);
  return out;
}

/**
 * Probes unprobed candidates in the order selection will consider them, until each category has
 * enough hard pages for its quota (with headroom for organization and host caps), has used its
 * probe budget, or the deadline passes. Returns `done` when no further probing would help.
 */
export async function probeCandidates(
  store: Store,
  options: {
    day: string;
    perCategory?: number;
    deadlineMs?: number;
    probe?: ProbeFn;
    now?: () => Date;
  },
) {
  const now = options.now ?? (() => new Date());
  const { maxProbesPerCategory, probeConcurrency } = samplingLimits();
  const target = Math.ceil((options.perCategory ?? 300) * 1.2);
  const probe = options.probe ?? defaultProbe;
  // Hard pages count toward the target only while their organization is under its sample cap,
  // so a category dominated by one hard organization keeps probing for others.
  type Queue = { todo: PoolRow[]; byOrganization: Map<string, number>; hard: number };
  const addHard = (queue: Queue, organization: string) => {
    const before = queue.byOrganization.get(organization) ?? 0;
    queue.byOrganization.set(organization, before + 1);
    if (before < ORGANIZATION_CAP) queue.hard++;
  };
  const queues: Queue[] = [];
  for (const category of [...categories, { id: "other" }]) {
    const pool = interleave(await loadPool(store.db, category.id, now()), options.day);
    const queue: Queue = { todo: [], byOrganization: new Map(), hard: 0 };
    for (const row of pool) if (row.probe?.verdict === "hard") addHard(queue, row.organization);
    const probed = pool.filter((row) => row.probe).length;
    if (queue.hard < target)
      queue.todo = pool.filter((row) => !row.probe).slice(0, Math.max(0, maxProbesPerCategory - probed));
    queues.push(queue);
  }
  // Alternate categories so one slow host cannot hold up the rest.
  const work: { row: PoolRow; queue: Queue }[] = [];
  for (let round = 0; queues.some((q) => round < q.todo.length); round++)
    for (const queue of queues) if (round < queue.todo.length) work.push({ row: queue.todo[round], queue });
  const signal = AbortSignal.timeout(options.deadlineMs ?? 200_000);
  const probed = new Set<string>();
  await probeMany(work, async ({ row, queue }) => {
    const id = probeId(row.url);
    if (queue.hard >= target || probed.has(id)) return;
    probed.add(id);
    const result = await probe(row.url, signal);
    // A probe cut short by our own deadline says nothing about the page.
    if (signal.aborted) return;
    const values = {
      id,
      url: row.url,
      version: result.version,
      verdict: result.verdict,
      reason: result.reason,
      status: result.status,
      textChars: result.textChars,
      elapsedMs: result.elapsedMs,
      probedAt: now(),
    };
    await store.db.insert(probes).values(values).onConflictDoUpdate({ target: probes.id, set: values });
    if (result.verdict === "hard") addHard(queue, row.organization);
  }, probeConcurrency, signal);
  return { probed: probed.size, done: !signal.aborted };
}
type TickOptions = {
  now?: () => Date;
  readers?: Readers;
  discover?: boolean;
  discovery?: { registry: Source[]; discover: typeof discoverSource };
  perCategory?: number;
  maxPages?: number;
  deadlineMs?: number;
  sampling?: SamplingMode;
  probe?: ProbeFn;
  /** Deadline for probing inside this tick before a hard-first sample is drawn. */
  probeDeadlineMs?: number;
  /** false discovers without drawing a pending sample, so probing can run in its own steps. */
  select?: boolean;
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
    const mode = options.sampling ?? samplingMode();
    if (samplePending && options.select !== false) {
      if (mode === "hard-first")
        await probeCandidates(store, {
          day,
          perCategory: options.perCategory ?? 300,
          deadlineMs: options.probeDeadlineMs ?? 120_000,
          probe: options.probe,
          now,
        });
      await selectSample(store, day, options.perCategory ?? 300, clock, mode);
    }
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
        run.summary.sampling,
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
    return { status: "advanced", processed, day, samplePending: samplePending && options.select === false, mode };
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
/** Sources polled per discovery pass; a pass runs them concurrently. */
const DISCOVERY_BATCH = 48;
/**
 * Daily supply refresh between weekly samples. It polls every due source, in passes of 48, and
 * then probes new candidates, so a week of feed items accumulates and the Friday sample starts
 * mostly probed. Polling only inside the weekly Workflow reached at most 96 of the registry's
 * sources a week and kept one snapshot of each feed. No provider or judge is called.
 */
export async function refreshSupply(
  store: Store,
  options: {
    now?: () => Date;
    probe?: ProbeFn;
    deadlineMs?: number;
    discovery?: TickOptions["discovery"];
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const started = Date.now();
  const budget = options.deadlineMs ?? 270_000;
  let polled = 0;
  for (let pass = 0; pass < 8 && Date.now() - started < budget / 2; pass++) {
    // The first pass also collects yesterday's Wikipedia links once they are due.
    const count = await discoverDue(store, now(), pass === 0, options.discovery);
    polled += count;
    if (count < DISCOVERY_BATCH) break;
  }
  const remaining = budget - (Date.now() - started);
  if (samplingMode() !== "hard-first" || remaining < 10_000)
    return { polled, probed: 0, done: samplingMode() !== "hard-first" };
  const result = await probeCandidates(store, {
    day: now().toISOString().slice(0, 10),
    probe: options.probe,
    now,
    deadlineMs: remaining,
  });
  return { polled, ...result };
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
    .limit(DISCOVERY_BATCH);
  const polled = due.length;
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
  return polled;
}

async function selectSample(
  store: Store,
  day: string,
  perCategory: number,
  clock: Date,
  mode: SamplingMode,
) {
  const protocol = protocolFor(mode);
  const { minPerCategory } = samplingLimits();
  await store.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(74012492)`);
    const runId = protocol + ":" + day;
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
    const selected: PoolRow[] = [];
    const prior = new Set<string>();
    const orgCounts = new Map<string, number>();
    const hostCounts = new Map<string, number>();
    const sampling: SamplingSummary["categories"] = {};
    for (const category of [...categories, { id: "other" }]) {
      const ordered = interleave(await loadPool(tx, category.id, clock), day);
      let count = 0;
      // Walks the day's order and takes pages that pass the organization and host caps.
      const take = (admit: (c: PoolRow) => boolean, limit: number) => {
        for (const c of ordered) {
          if (count >= limit) break;
          if (!admit(c) || (orgCounts.get(c.organization) ?? 0) >= ORGANIZATION_CAP) continue;
          const host = new URL(c.url).hostname;
          if (prior.has(c.id) || prior.has(hash(c.url)) || (hostCounts.get(host) ?? 0) >= HOST_CAP)
            continue;
          selected.push(c);
          prior.add(c.id);
          prior.add(hash(c.url));
          orgCounts.set(c.organization, (orgCounts.get(c.organization) ?? 0) + 1);
          hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
          count++;
        }
      };
      if (mode === "all") take(() => true, perCategory);
      else {
        take((c) => c.probe?.verdict === "hard", perCategory);
        const hard = count;
        take((c) => c.probe?.verdict === "easy", Math.min(perCategory, minPerCategory));
        sampling[category.id] = { hard, easy: count - hard };
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
        probe: mode === "all" ? null : c.probe,
        state: "queued",
      })),
    );
    const summary: RunSummary = {
      id: runId,
      day,
      protocol,
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
      ...(mode === "all" ? {} : { sampling: { method: "hard-first", probe: PROBE_VERSION, categories: sampling } }),
    };
    await tx.insert(runs).values({
      id: runId,
      day,
      protocol,
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
  await store.db
    .delete(probes)
    .where(lt(probes.probedAt, new Date(clock.getTime() - 30 * 86400000)));
}
