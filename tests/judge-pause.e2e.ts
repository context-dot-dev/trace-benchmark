import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { runTick } from "../src/lib/benchmark/collect.ts";
import { runProvider } from "../src/lib/benchmark/parallel.ts";
import { createReaders } from "../src/lib/benchmark/providers.ts";
import { migrateStore, openStore } from "../src/lib/benchmark/store.ts";
import { categories, providers } from "../src/lib/benchmark/types.ts";

// Failures: judge limits hidden as generic errors, sibling providers continuing
// grading after a limit, reads stopping unnecessarily, cooldown bypass, duplicate
// provider billing, changing the two-call judgment allowance, and a provider
// cooldown blocking judgments for evidence already fetched. Claimed but unsent
// grades must refund tokens and preserve their judgment allowance when paused.
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl && ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname),
  "Use a disposable local database; this test truncates scraping_bench");
const store = openStore(databaseUrl);
const calls: { kind: string; at: number; status: number }[] = [];
const checks: string[] = [];
let failureStatus = 429;
let hasFailed = false;
let failedAt = 0;
const fixture = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const provider = req.url!.slice(1);
  const url = body.url ?? body.urls?.[0];
  res.setHeader("Content-Type", "application/json");
  if (provider === "judge") {
    const status = hasFailed ? 200 : failureStatus;
    hasFailed = true;
    assert.deepEqual(Object.keys(body.state).sort(), ["sampled", "text"]);
    calls.push({ kind: "judge", at: Date.now(), status });
    if (status !== 200) {
      failedAt = Date.now();
      res.statusCode = status;
      res.setHeader("Retry-After", "1");
      res.end(JSON.stringify({ error: "Fixture account limit" }));
      return;
    }
    res.end(JSON.stringify({ answers: {
      access: { choice: "accessed", confidence: 1 },
    }, usage: { input_tokens: 100 } }));
    return;
  }
  calls.push({ kind: provider, at: Date.now(), status: 200 });
  const text = "Substantive target article content. ".repeat(30);
  res.end(JSON.stringify(provider === "context"
    ? { markdown: { requested: true, success: true, data: text }, url }
    : { results: [{ text, url }] }));
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const base = "http://127.0.0.1:" + (fixture.address() as { port: number }).port;
const readers = createReaders({
  endpoints: Object.fromEntries(providers.map((p) => [p.id, base + "/" + p.id])),
  judgeEndpoint: base + "/judge",
  keys: Object.fromEntries([...providers.map((p) => p.id), "judge"].map((p) => [p, "fixture-key"])),
});
let failure: string | undefined;
try {
  await migrateStore(store);
  for (const status of [429, 401, 402]) {
    failureStatus = status;
    hasFailed = false;
    failedAt = 0;
    const before = calls.length;
    await store.db.execute(sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`);
    const clock = new Date("2026-11-06T00:20:00Z");
    await store.seedCandidates(Array.from({ length: 16 }, (_, i) => ({
      id: "judge-pause-" + String(i).padStart(3, "0"), url: "https://example.org/judge-pause/" + i,
      title: "Article " + i, category: categories[i % categories.length].id,
      organization: "fixture-" + i, sourceId: "fixture", discoveredAt: clock,
    })));
    await runTick(store, { readers, now: () => clock, discover: false, maxPages: 0 });
    const options = ["context", "exa"].map((provider) => ({
      provider: provider as "context" | "exa", shard: 0, shards: 1, concurrency: 4,
      requestsPerSecond: 4, judgeRequestsPerSecond: 20, readers, now: () => clock,
    }));
    await Promise.all(options.map((option) => runProvider(store, option)));
    const firstCalls = calls.slice(before);
    assert.equal(firstCalls.filter((call) => call.kind !== "judge").length, 32,
      "Judge limits must not stop provider reads from persisting evidence");
    const firstGrades = firstCalls.filter((call) => call.kind === "judge");
    assert.ok(firstGrades.every((call) => call.at <= failedAt + 350),
      "A judge account limit must pause grading in every provider worker within 350ms");
    const rows = await store.db.execute(sql`select state,error,judge_calls from scraping_bench.attempts where provider in ('context','exa')`);
    assert.equal(rows.rows.filter((row) => row.error === "JUDGE_HTTP_" + status).length, 1);
    assert.ok(rows.rows.filter((row) => row.state === "fetched" && row.judge_calls === 0).length >= 28,
      "Undispatched judgments must retain evidence and their judgment allowance");
    const countBeforeRetry = calls.length;
    await Promise.all(options.map((option) => runProvider(store, option)));
    assert.equal(calls.length, countBeforeRetry, "Fresh workers must respect the shared judge cooldown");
    clock.setTime(clock.getTime() + (status === 429 ? 61000 : 16 * 60000));
    await Promise.all(options.map((option) => runProvider(store, option)));
    const completed = await store.db.execute(sql`select state,success,judge_calls from scraping_bench.attempts where provider in ('context','exa')`);
    assert.ok(completed.rows.every((row) => row.state === "done" && row.success === true));
    assert.equal(completed.rows.filter((row) => row.judge_calls === 2).length, 1);
    assert.ok(completed.rows.every((row) => row.judge_calls <= 2));
    const allCalls = calls.slice(before);
    assert.equal(allCalls.filter((call) => call.kind !== "judge").length, 32);
    assert.equal(allCalls.filter((call) => call.kind === "judge").length, 33);
    const budget = await store.db.execute(sql`select bucket,used from scraping_bench.budgets where bucket in ('context','exa')`);
    assert.ok(budget.rows.every((row) => row.used === 16));
    checks.push(`Judge HTTP ${status} pauses every provider's grading while reads finish; cooldown preserves evidence and the two-call allowance without duplicate reads`);
    await store.db.execute(sql`update scraping_bench.attempts set state='fetched',success=null,error=null,judge_calls=0
      where provider='context' and page_id='judge-pause-000'`);
    await store.db.execute(sql`update scraping_bench.attempts set state='queued',success=null,error=null
      where provider='context' and page_id='judge-pause-001'`);
    await store.db.execute(sql`insert into scraping_bench.worker(id,lease_until,error)
      values('pause:context',${new Date(clock.getTime() + 60000)},'HTTP_429')
      on conflict(id) do update set lease_until=excluded.lease_until,error=excluded.error`);
    const beforeProviderPause = calls.length;
    const providerPaused = await runProvider(store, options[0]);
    assert.equal(providerPaused.paused, true);
    const providerPauseCalls = calls.slice(beforeProviderPause);
    assert.equal(providerPauseCalls.length, 1,
      "A provider cooldown must allow judging already-fetched evidence");
    assert.equal(providerPauseCalls[0].kind, "judge");
    const preservedQueue = await store.db.execute(sql`select state from scraping_bench.attempts
      where provider='context' and page_id='judge-pause-001'`);
    assert.equal(preservedQueue.rows[0].state, "queued");
    checks.push("A provider cooldown blocks fresh reads but permits grading durable evidence");
  }
  failureStatus = 429;
  hasFailed = false;
  failedAt = 0;
  await store.db.execute(sql`truncate scraping_bench.worker, scraping_bench.budgets`);
  await store.db.execute(sql`update scraping_bench.attempts set state='fetched',success=null,error=null,
    judge_calls=0,claim=null,lease_until=null where provider in ('context','exa')`);
  const beforeReserved = calls.length;
  const reservedClock = new Date("2026-11-06T01:20:00Z");
  await Promise.all((["context", "exa"] as const).map((provider) => runProvider(store, {
    provider, shard: 0, shards: 1, concurrency: 4, requestsPerSecond: 4,
    judgeRequestsPerSecond: 4, readers, now: () => reservedClock,
  })));
  const reservedCalls = calls.slice(beforeReserved);
  assert.ok(reservedCalls.length > 0 && reservedCalls.every((call) => call.kind === "judge"));
  const reservedRows = await store.db.execute(sql`select state,judge_calls from scraping_bench.attempts
    where provider in ('context','exa')`);
  assert.equal(reservedRows.rows.reduce((sum, row) => sum + Number(row.judge_calls), 0), reservedCalls.length,
    "Claimed but undispatched judgments must not consume their two-call allowance");
  assert.ok(reservedRows.rows.every((row) => row.state !== "grading"),
    "Paused workers must release every undispatched grade claim");
  assert.ok(reservedRows.rows.filter((row) => row.state === "fetched" && row.judge_calls === 0).length >= 28);
  const rejectedRows = await store.db.execute(sql`select url,title from scraping_bench.attempts where error='JUDGE_HTTP_429'`);
  assert.equal(rejectedRows.rows.length, 1);
  const rejectedRow = rejectedRows.rows[0];
  const failedReservation = Buffer.byteLength("Substantive target article content. ".repeat(30))
    + Buffer.byteLength(rejectedRow.url) + Buffer.byteLength(rejectedRow.title) + 8192;
  const judgeBudget = await store.db.execute(sql`select used from scraping_bench.budgets where bucket='judge'`);
  assert.equal(Number(judgeBudget.rows[0].used), failedReservation + (reservedCalls.length - 1) * 100,
    "Only dispatched judgments may retain a token reservation after a shared pause");
  checks.push("Preclaimed grades canceled by the shared judge pause refund all reserved tokens and consume no judgment allowance");
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  fixture.closeAllConnections();
  fixture.close();
  await store.close();
  await mkdir("artifacts/parallel", { recursive: true });
  await writeFile("artifacts/parallel/judge-pause-e2e.json", JSON.stringify({
    ok: !failure, failure, checks, calls,
    repeat: "DATABASE_URL=postgresql://...@127.0.0.1/... npx tsx tests/judge-pause.e2e.ts",
  }, null, 2));
}
console.log(JSON.stringify({ ok: true, checks, artifact: "artifacts/parallel/judge-pause-e2e.json" }, null, 2));
