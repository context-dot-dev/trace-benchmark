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

// Already-claimed requests waiting for a pacing slot are not network in-flight.
// On 429/401/402 they must return to the queue without spending a request budget;
// a later worker may resume them, but must not repeat the already-billed failure.
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl && ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname),
  "Use a disposable local database; this test truncates scraping_bench");
const store = openStore(databaseUrl);
const requests: { url: string; at: number; status: number }[] = [];
let fixtureStatus = 429;
let onlyFailUrl: string | undefined;
const fixture = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  res.setHeader("Content-Type", "application/json");
  if (body.state) {
    assert.deepEqual(Object.keys(body.questions), ["access"]);
    res.end(JSON.stringify({ answers: { access: { choice: "accessed", confidence: 1 } }, usage: { input_tokens: 100 } }));
    return;
  }
  const status = !onlyFailUrl || body.urls[0] === onlyFailUrl ? fixtureStatus : 200;
  requests.push({ url: body.urls[0], at: Date.now(), status });
  res.statusCode = status;
  res.end(JSON.stringify(status === 200 ? { results: [{ text: "Substantive requested document. ".repeat(30), url: body.urls[0] }] } : {}));
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const base = "http://127.0.0.1:" + (fixture.address() as { port: number }).port;
const readers = createReaders({
  endpoints: Object.fromEntries(providers.map((p) => [p.id, base])),
  judgeEndpoint: base,
  keys: Object.fromEntries([...providers.map((p) => p.id), "judge"].map((p) => [p, "fixture-key"])),
});
const checks: string[] = [];
let failure: string | undefined;
try {
  await migrateStore(store);
  {
  fixtureStatus = 429;
  const before = requests.length;
  await store.db.execute(sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`);
  const clock = new Date("2026-11-06T00:20:00Z");
  await store.seedCandidates(Array.from({ length: 32 }, (_, i) => ({
    id: "shared-pause-" + String(i).padStart(3, "0"), url: "https://example.org/shared-pause/" + i,
    title: "Target " + i, category: categories[i % categories.length].id,
    organization: "fixture-" + i, sourceId: "fixture", discoveredAt: clock,
  })));
  await runTick(store, { readers, now: () => clock, discover: false, maxPages: 0 });
  const chosen = await store.db.execute(sql`select url from scraping_bench.attempts where provider='exa'
    and mod(abs(hashtext(id)::bigint),2)=0 order by page_id limit 1`);
  onlyFailUrl = String(chosen.rows[0].url);
  await Promise.all([0, 1].map((shard) => runProvider(store, {
    provider: "exa", shard, shards: 2, concurrency: 8, requestsPerSecond: 4,
    readers, now: () => clock,
  })));
  const calls = requests.slice(before);
  const failed = calls.find((r) => r.status === 429)!;
  assert.ok(failed);
  assert.ok(calls.every((r) => r.at <= failed.at + 350),
    "A provider 429 must stop new dispatches in sibling shards within the shared pause propagation window");
  const budget = await store.db.execute(sql`select used from scraping_bench.budgets where bucket='exa'`);
  assert.equal(budget.rows[0].used, calls.length);
  const state = await store.db.execute(sql`select state,count(*)::int as count from scraping_bench.attempts where provider='exa' group by state`);
  assert.equal(state.rows.find((r) => r.state === "queued")?.count, 32 - calls.length);
  assert.equal(new Set(calls.map((r) => r.url)).size, calls.length);
  checks.push("A rate limit pauses sibling shards within 350ms and refunds every undispatched reservation");
  }
  onlyFailUrl = undefined;
  for (const status of [429, 401, 402]) {
    fixtureStatus = status;
    const before = requests.length;
    await store.db.execute(sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`);
    const clock = new Date("2026-11-06T00:20:00Z");
    await store.seedCandidates(Array.from({ length: 16 }, (_, i) => ({
      id: "pause-" + String(i).padStart(3, "0"), url: "https://example.org/pause/" + i,
      title: "Target " + i, category: categories[i % categories.length].id,
      organization: "fixture-" + i, sourceId: "fixture", discoveredAt: clock,
    })));
    await runTick(store, { readers, now: () => clock, discover: false, maxPages: 0 });
    const options = { provider: "exa" as const, shard: 0, shards: 1, concurrency: 8,
      requestsPerSecond: 4, readers, now: () => clock };
    const first = await runProvider(store, options);
    assert.equal(first.paused, true);
    assert.equal(requests.length - before, 1, `HTTP ${status} must stop requests still waiting for a pacing slot`);
    const rows = await store.db.execute(sql`select state,error,success from scraping_bench.attempts where provider='exa'`);
    assert.equal(rows.rows.filter((r) => r.state === "queued").length, 15);
    assert.equal(rows.rows.filter((r) => r.state === "done" && r.error === "HTTP_" + status && r.success === null).length, 1);
    const budget = await store.db.execute(sql`select used from scraping_bench.budgets where bucket='exa'`);
    assert.equal(budget.rows[0].used, 1);
    const paused = await runProvider(store, options);
    assert.equal(paused.paused, true);
    assert.equal(requests.length - before, 1, "A fresh worker must respect the durable provider cooldown");
    clock.setMinutes(clock.getMinutes() + 16);
    await runProvider(store, options);
    assert.equal(requests.length - before, 2);
    assert.equal(new Set(requests.slice(before).map((r) => r.url)).size, 2);
    checks.push(`HTTP ${status} pauses undispatched claims, refunds their reservations, and later resumes without rebilling completed reads`);
  }

} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  fixture.closeAllConnections();
  fixture.close();
  await store.close();
  await mkdir("artifacts/parallel", { recursive: true });
  await writeFile("artifacts/parallel/pause-e2e.json", JSON.stringify({
    ok: !failure, failure, checks, requests,
    repeat: "DATABASE_URL=postgresql://...@127.0.0.1/... npx tsx tests/provider-pause.e2e.ts",
  }, null, 2));
}
console.log(JSON.stringify({ ok: true, checks, artifact: "artifacts/parallel/pause-e2e.json" }, null, 2));
