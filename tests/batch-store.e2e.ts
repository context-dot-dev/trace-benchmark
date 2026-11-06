import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import { attempts, budgets, runs, worker } from "../src/lib/benchmark/schema.ts";
import { migrateStore, openStore } from "../src/lib/benchmark/store.ts";
import { claimReads, releaseReads, saveReceipts, claimGrades, releaseGrades, saveGrades } from "../src/lib/benchmark/batch-store.ts";
import type { Receipt, Grade, RunSummary } from "../src/lib/benchmark/types.ts";

// Failure cases: concurrent claims must not overspend or dispatch the same row;
// stale owners must not save, reservations must settle once, and judge failures
// may retry only once. Missing evidence and exhausted judge calls must terminate.
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl && ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname),
  "Use a disposable local database; this test truncates scraping_bench");
const store = openStore(databaseUrl);
const day = "2026-11-06";
const token = "fixture-owner";
const lease = new Date(Date.now() + 300000);
const checks: string[] = [];
const receipt: Receipt = { text: "Substantive content 🦉", chars: 22, hash: "fixture-hash", elapsedMs: 123,
  httpStatus: 200, error: null, success: null, credits: 1, costUsd: 0.01, finalUrl: null };
const grade: Grade = { inputTokens: 20, success: true, content: "substantive", identity: "match", confidence: 0.9, error: null };
let failure: string | undefined;
try {
  await migrateStore(store);
  await store.db.execute(sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`);
  await store.db.insert(worker).values({ id: "fixture-worker", claim: token, leaseUntil: lease });
  await store.db.insert(runs).values({ id: "fixture-run", day, protocol: "fixture", status: "collecting", summary: {} as RunSummary });
  await store.db.insert(attempts).values(Array.from({ length: 8 }, (_, index) => ({
    id: `attempt-${index}`, pageId: `page-${index}`, runId: "fixture-run", day,
    provider: "context", url: `https://example.org/${index}`, title: `Article ${index}`, category: "news", state: "queued",
  })));
  const rows = await store.db.select().from(attempts).orderBy(attempts.id);
  await store.db.insert(budgets).values({ day, bucket: "context", used: 3995 });
  assert.deepEqual(await claimReads(store, rows, "stale", day, lease, "fixture-worker"), []);
  const claimed = (await Promise.all([
    claimReads(store, rows, token, day, lease, "fixture-worker"),
    claimReads(store, rows, token, day, lease, "fixture-worker"),
  ])).flat();
  assert.equal(claimed.length, 5);
  assert.equal(new Set(claimed.map((row) => row.id)).size, 5);
  assert.equal((await store.db.select().from(budgets).where(eq(budgets.bucket, "context")))[0].used, 4000);
  checks.push("Concurrent bulk read claims reserve exactly the five remaining calls without duplicate dispatch");
  await releaseReads(store, [claimed[0]], "stale", day);
  assert.equal((await store.db.select().from(budgets).where(eq(budgets.bucket, "context")))[0].used, 4000);
  await Promise.all([
    releaseReads(store, [claimed[0]], token, day),
    releaseReads(store, [claimed[0]], token, day),
  ]);
  assert.equal((await store.db.select().from(budgets).where(eq(budgets.bucket, "context")))[0].used, 3999);
  const released = (await store.db.select().from(attempts).where(eq(attempts.id, claimed[0].id)))[0];
  assert.equal(released.state, "queued");
  assert.equal(released.claim, null);
  assert.equal(released.leaseUntil, null);
  assert.equal(released.startedAt, null);
  const reclaimed = await claimReads(store, [released], token, day, lease, "fixture-worker");
  assert.equal(reclaimed.length, 1);
  assert.equal((await store.db.select().from(budgets).where(eq(budgets.bucket, "context")))[0].used, 4000);
  claimed[claimed.findIndex((row) => row.id === released.id)] = reclaimed[0];
  checks.push("Known-unsent releases refund once, reject stale ownership, and remain claimable");
  assert.deepEqual(await saveReceipts(store, claimed.map((row) => ({ row, receipt })), "stale"), []);
  const fetched = await saveReceipts(store, claimed.map((row) => ({ row, receipt })), token);
  assert.equal(fetched.length, 5);
  assert.deepEqual(await saveReceipts(store, claimed.map((row) => ({ row, receipt })), token), []);
  for (const row of fetched) {
    assert.equal(row.state, "fetched");
    assert.equal(gunzipSync(row.evidence!).toString(), receipt.text);
    assert.equal(row.elapsedMs, 123);
    assert.equal(row.credits, 1);
    assert.equal(row.claim, null);
    assert.ok(row.startedAt instanceof Date, "Returned rows must retain typed timestamps");
  }
  checks.push("Bulk receipts preserve evidence and metrics; stale and duplicate completions cannot write");
  const reservation = Buffer.byteLength(receipt.text) + Buffer.byteLength(fetched[0].url) + Buffer.byteLength(fetched[0].title) + 8192;
  await store.db.insert(budgets).values({ day, bucket: "judge", used: 120_000_000 - reservation * 2 });
  const grading = (await Promise.all([
    claimGrades(store, fetched, token, day, lease, "fixture-worker"),
    claimGrades(store, fetched, token, day, lease, "fixture-worker"),
  ])).flat();
  assert.equal(grading.length, 2);
  assert.ok(grading.every(({ row }) => row.state === "grading" && row.judgeCalls === 1));
  assert.equal((await store.db.select().from(budgets).where(eq(budgets.bucket, "judge")))[0].used, 120_000_000);
  await releaseGrades(store, [grading[0]], "stale", day);
  assert.equal((await store.db.select().from(budgets).where(eq(budgets.bucket, "judge")))[0].used, 120_000_000);
  await Promise.all([releaseGrades(store, [grading[0]], token, day), releaseGrades(store, [grading[0]], token, day)]);
  assert.equal((await store.db.select().from(budgets).where(eq(budgets.bucket, "judge")))[0].used, 120_000_000 - grading[0].reservation);
  const unjudged = (await store.db.select().from(attempts).where(eq(attempts.id, grading[0].row.id)))[0];
  assert.equal(unjudged.state, "fetched");
  assert.equal(unjudged.judgeCalls, 0);
  assert.equal(unjudged.claim, null);
  assert.equal(unjudged.leaseUntil, null);
  grading[0] = (await claimGrades(store, [unjudged], token, day, lease, "fixture-worker"))[0];
  assert.equal(grading[0].row.judgeCalls, 1);
  assert.equal((await store.db.select().from(budgets).where(eq(budgets.bucket, "judge")))[0].used, 120_000_000);
  checks.push("Known-unsent judge releases refund tokens and restore call count exactly once");
  await saveGrades(store, grading.map((entry) => ({ ...entry, grade })), "stale", day);
  assert.equal((await store.db.select().from(budgets).where(eq(budgets.bucket, "judge")))[0].used, 120_000_000);
  await Promise.all([
    saveGrades(store, grading.map((entry) => ({ ...entry, grade })), token, day),
    saveGrades(store, grading.map((entry) => ({ ...entry, grade })), token, day),
  ]);
  assert.equal((await store.db.select().from(budgets).where(eq(budgets.bucket, "judge")))[0].used, 120_000_000 - reservation * 2 + 40);
  checks.push("Concurrent judge reservations respect token ceiling and settle exactly once");
  await store.db.update(budgets).set({ used: 0 }).where(eq(budgets.bucket, "judge"));
  const pending = await store.db.select().from(attempts).where(eq(attempts.state, "fetched"));
  const first = await claimGrades(store, [pending[0]], token, day, lease, "fixture-worker");
  const failedGrade = { ...grade, success: null, error: "JUDGE_UNAVAILABLE", inputTokens: null };
  await saveGrades(store, first.map((entry) => ({ ...entry, grade: failedGrade })), token, day);
  const retryRow = (await store.db.select().from(attempts).where(eq(attempts.id, pending[0].id)))[0];
  assert.equal(retryRow.state, "fetched");
  const second = await claimGrades(store, [retryRow], token, day, lease, "fixture-worker");
  assert.equal(second[0].row.judgeCalls, 2);
  await saveGrades(store, second.map((entry) => ({ ...entry, grade: failedGrade })), token, day);
  assert.equal((await store.db.select().from(attempts).where(eq(attempts.id, pending[0].id)))[0].state, "done");
  assert.deepEqual(await claimGrades(store, [retryRow], token, day, lease, "fixture-worker"), []);
  await store.db.update(attempts).set({ evidence: null }).where(eq(attempts.id, pending[1].id));
  await store.db.update(attempts).set({ judgeCalls: 2, evidence: gzipSync("content") }).where(eq(attempts.id, pending[2].id));
  assert.deepEqual(await claimGrades(store, pending.slice(1), token, day, lease, "fixture-worker"), []);
  const terminal = await store.db.select().from(attempts).where(eq(attempts.state, "done"));
  assert.ok(terminal.some((row) => row.error === "EVIDENCE_UNAVAILABLE"));
  assert.ok(terminal.some((row) => row.error === "JUDGE_UNAVAILABLE"));
  checks.push("Judge failures retry once; absent evidence and exhausted calls become terminal unknowns");
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await store.close();
  await mkdir("artifacts/continuous", { recursive: true });
  await writeFile("artifacts/continuous/batch-store-e2e.json", JSON.stringify({ ok: !failure, checks, failure,
    repeat: "DATABASE_URL=postgresql://...@127.0.0.1/... npx tsx tests/batch-store.e2e.ts" }, null, 2));
}
console.log(JSON.stringify({ ok: true, checks }, null, 2));
