import { gzipSync, gunzipSync } from "node:zlib";
import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { attempts, budgets, worker } from "./schema";
import type { Store } from "./store";
import type { Grade, Receipt } from "./types";

export type Attempt = typeof attempts.$inferSelect;
type Transaction = Parameters<Parameters<Store["db"]["transaction"]>[0]>[0];
const returning = sql.join(Object.entries(getTableColumns(attempts)).map(
  ([name, column]) => sql`${column} as ${sql.identifier(name)}`,
), sql`, `);

async function ownsWorker(tx: Transaction, workerId: string, token: string) {
  return (await tx.select({ id: worker.id }).from(worker)
    .where(and(eq(worker.id, workerId), eq(worker.claim, token)))).length > 0;
}

async function lockBudget(tx: Transaction, day: string, bucket: string) {
  await tx.insert(budgets).values({ day, bucket, used: 0 }).onConflictDoNothing();
  const [budget] = await tx.select().from(budgets)
    .where(and(eq(budgets.day, day), eq(budgets.bucket, bucket))).for("update");
  return budget;
}

export async function claimReads(
  store: Store, rows: Attempt[], token: string, day: string, lease: Date, workerId: string,
): Promise<Attempt[]> {
  if (!rows.length) return [];
  const provider = rows[0].provider;
  if (rows.some((row) => row.provider !== provider)) throw new Error("Read claims must share a provider");
  return store.db.transaction(async (tx) => {
    if (!await ownsWorker(tx, workerId, token)) return [];
    const budget = await lockBudget(tx, day, provider);
    const remaining = Math.max(0, 4000 - budget.used);
    if (!remaining) return [];
    const queued = await tx.select({ id: attempts.id }).from(attempts)
      .where(and(inArray(attempts.id, rows.map((row) => row.id)), eq(attempts.state, "queued"), eq(attempts.provider, provider)))
      .orderBy(attempts.id).limit(remaining).for("update");
    if (!queued.length) return [];
    const claimed = await tx.update(attempts).set({
      state: "fetching", claim: token, leaseUntil: lease, startedAt: new Date(),
    }).where(inArray(attempts.id, queued.map((row) => row.id))).returning();
    await tx.update(budgets).set({ used: budget.used + claimed.length })
      .where(and(eq(budgets.day, day), eq(budgets.bucket, provider)));
    return claimed;
  });
}

export async function saveReceipts(
  store: Store, entries: { row: Attempt; receipt: Receipt }[], token: string,
): Promise<Attempt[]> {
  if (!entries.length) return [];
  const payload = [...new Map(entries.map((entry) => [entry.row.id, entry])).values()].map(({ row, receipt }) => {
    const evidence = receipt.text ? gzipSync(receipt.text) : null;
    return {
      id: row.id, state: receipt.text && !receipt.error ? "fetched" : "done",
      success: receipt.success, error: receipt.error, elapsed_ms: receipt.elapsedMs,
      http_status: receipt.httpStatus, credits: receipt.credits, cost_usd: receipt.costUsd,
      chars: receipt.chars, hash: receipt.hash, evidence: evidence?.toString("base64") ?? null,
      evidence_bytes: evidence?.length ?? 0,
      final_url: typeof receipt.finalUrl === "string" ? receipt.finalUrl.slice(0, 2048) : null,
    };
  });
  const result = await store.db.execute(sql`
    update scraping_bench.attempts set
      state=d.state, success=d.success, error=d.error, elapsed_ms=d.elapsed_ms,
      http_status=d.http_status, credits=d.credits, cost_usd=d.cost_usd,
      chars=d.chars, hash=d.hash, evidence=decode(d.evidence,'base64'),
      evidence_bytes=d.evidence_bytes, final_url=d.final_url, claim=null, lease_until=null
    from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as d(
      id text, state text, success boolean, error text, elapsed_ms integer,
      http_status integer, credits double precision, cost_usd double precision,
      chars integer, hash text, evidence text, evidence_bytes integer, final_url text)
    where attempts.id=d.id and attempts.state='fetching' and attempts.claim=${token}
    returning ${returning}`);
  return result.rows.map((row) => ({
    ...row,
    startedAt: row.startedAt ? new Date(row.startedAt as string) : null,
  })) as Attempt[];
}

export async function releaseReads(
  store: Store, rows: Attempt[], token: string, day: string,
): Promise<void> {
  if (!rows.length) return;
  const provider = rows[0].provider;
  if (rows.some((row) => row.provider !== provider)) throw new Error("Read releases must share a provider");
  await store.db.transaction(async (tx) => {
    const budget = await lockBudget(tx, day, provider);
    const released = await tx.update(attempts).set({
      state: "queued", claim: null, leaseUntil: null, startedAt: null,
    }).where(and(
      inArray(attempts.id, rows.map((row) => row.id)), eq(attempts.state, "fetching"),
      eq(attempts.claim, token), eq(attempts.provider, provider),
    )).returning({ id: attempts.id });
    if (released.length) await tx.update(budgets).set({ used: budget.used - released.length })
      .where(and(eq(budgets.day, day), eq(budgets.bucket, provider)));
  });
}

export async function claimGrades(
  store: Store, rows: Attempt[], token: string, day: string, lease: Date, workerId: string,
): Promise<{ row: Attempt; reservation: number }[]> {
  if (!rows.length) return [];
  return store.db.transaction(async (tx) => {
    if (!await ownsWorker(tx, workerId, token)) return [];
    const budget = await lockBudget(tx, day, "judge");
    const fetched = await tx.select().from(attempts)
      .where(and(inArray(attempts.id, rows.map((row) => row.id)), eq(attempts.state, "fetched")))
      .orderBy(attempts.id).for("update");
    const reservations = new Map<string, number>();
    const unavailable: string[] = [];
    let reserved = 0;
    for (const row of fetched) {
      if (!row.evidence || row.judgeCalls >= 2) {
        unavailable.push(row.id);
        continue;
      }
      const reservation = gunzipSync(row.evidence).length + Buffer.byteLength(row.url) + Buffer.byteLength(row.title) + 8192;
      if (budget.used + reserved + reservation > 120_000_000) continue;
      reservations.set(row.id, reservation);
      reserved += reservation;
    }
    if (unavailable.length) await tx.update(attempts).set({
      state: "done", success: null, claim: null, leaseUntil: null,
      error: sql`case when ${attempts.evidence} is null then 'EVIDENCE_UNAVAILABLE' else 'JUDGE_UNAVAILABLE' end`,
    }).where(inArray(attempts.id, unavailable));
    if (!reservations.size) return [];
    const claimed = await tx.update(attempts).set({
      state: "grading", claim: token, leaseUntil: lease, judgeCalls: sql`${attempts.judgeCalls}+1`,
    }).where(inArray(attempts.id, [...reservations.keys()])).returning();
    await tx.update(budgets).set({ used: budget.used + reserved })
      .where(and(eq(budgets.day, day), eq(budgets.bucket, "judge")));
    return claimed.map((row) => ({ row, reservation: reservations.get(row.id)! }));
  });
}

export async function saveGrades(
  store: Store, entries: { row: Attempt; grade: Grade; reservation: number }[], token: string, day: string,
): Promise<void> {
  if (!entries.length) return;
  const payload = [...new Map(entries.map((entry) => [entry.row.id, entry])).values()].map(({ row, grade, reservation }) => ({
    id: row.id, judge_calls: row.judgeCalls, success: grade.success, content: grade.content,
    identity: grade.identity, confidence: grade.confidence, error: grade.error,
    refund: grade.inputTokens !== null && Number.isInteger(grade.inputTokens)
      && grade.inputTokens >= 0 && grade.inputTokens <= reservation ? reservation - grade.inputTokens : 0,
  }));
  await store.db.transaction(async (tx) => {
    const budget = await lockBudget(tx, day, "judge");
    const result = await tx.execute(sql`
      update scraping_bench.attempts set
        state=case when d.error is not null and attempts.judge_calls<2 then 'fetched' else 'done' end,
        success=d.success, content=d.content, identity=d.identity, confidence=d.confidence,
        error=d.error, claim=null, lease_until=null
      from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as d(
        id text, judge_calls integer, success boolean, content text, identity text,
        confidence double precision, error text, refund integer)
      where attempts.id=d.id and attempts.state='grading' and attempts.claim=${token}
        and attempts.judge_calls=d.judge_calls
      returning d.refund`);
    const refund = result.rows.reduce((sum, row) => sum + Number(row.refund), 0);
    if (refund) await tx.update(budgets).set({ used: budget.used - refund })
      .where(and(eq(budgets.day, day), eq(budgets.bucket, "judge")));
  });
}

export async function releaseGrades(
  store: Store, entries: { row: Attempt; reservation: number }[], token: string, day: string,
): Promise<void> {
  if (!entries.length) return;
  const payload = [...new Map(entries.map((entry) => [entry.row.id, entry])).values()]
    .map(({ row, reservation }) => ({ id: row.id, judge_calls: row.judgeCalls, reservation }));
  await store.db.transaction(async (tx) => {
    const budget = await lockBudget(tx, day, "judge");
    const released = await tx.execute(sql`
      update scraping_bench.attempts set state='fetched', claim=null, lease_until=null,
        judge_calls=attempts.judge_calls-1
      from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as d(id text, judge_calls integer, reservation integer)
      where attempts.id=d.id and attempts.state='grading' and attempts.claim=${token}
        and attempts.judge_calls=d.judge_calls
      returning d.reservation`);
    const refund = released.rows.reduce((sum, row) => sum + Number(row.reservation), 0);
    if (refund) await tx.update(budgets).set({ used: budget.used - refund })
      .where(and(eq(budgets.day, day), eq(budgets.bucket, "judge")));
  });
}
