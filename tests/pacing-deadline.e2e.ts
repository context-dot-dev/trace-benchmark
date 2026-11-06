import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import { runProvider } from "../src/lib/benchmark/parallel.ts";
import { createReaders } from "../src/lib/benchmark/providers.ts";
import { attempts, budgets, runs } from "../src/lib/benchmark/schema.ts";
import { migrateStore, openStore } from "../src/lib/benchmark/store.ts";
import { providers, PROTOCOL, type RunSummary } from "../src/lib/benchmark/types.ts";

// A configured pacing interval longer than the invocation must not hold claims
// past their lease. Unsent reads and grades must return their budget reservations.
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl && ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname),
  "Use a disposable local database; this test truncates scraping_bench");
const store = openStore(databaseUrl);
const calls = { read: 0, judge: 0 };
const text = "Substantive target content. ".repeat(30);
const fixture = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/judge") {
    calls.judge++;
    assert.deepEqual(Object.keys(body.questions), ["access"]);
    res.end(JSON.stringify({ answers: {
      access: { choice: "accessed", confidence: 1 },
    }, usage: { input_tokens: 100 } }));
  } else {
    calls.read++;
    res.end(JSON.stringify({ results: [{ text, url: body.urls[0] }] }));
  }
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const base = "http://127.0.0.1:" + (fixture.address() as { port: number }).port;
const readers = createReaders({
  endpoints: Object.fromEntries(providers.map((provider) => [provider.id, base])),
  judgeEndpoint: base + "/judge",
  keys: Object.fromEntries([...providers.map((provider) => provider.id), "judge"].map((id) => [id, "fixture-key"])),
});
const results: { phase: string; elapsedMs: number; calls: typeof calls }[] = [];
let failure: string | undefined;
try {
  await migrateStore(store);
  for (const phase of ["read", "judge"]) {
    calls.read = 0; calls.judge = 0;
    await store.db.execute(sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`);
    const day = "2026-11-06";
    await store.db.insert(runs).values({ id: "pacing-run", day, protocol: PROTOCOL, status: "collecting", summary: {} as RunSummary });
    await store.db.insert(attempts).values(Array.from({ length: 8 }, (_, index) => ({
      id: `pacing-${index}`, runId: "pacing-run", day, pageId: `page-${index}`, provider: "exa",
      url: `https://example.org/${index}`, title: `Article ${index}`, category: "news",
      state: phase === "read" ? "queued" : "fetched",
      evidence: phase === "judge" ? gzipSync(text) : null,
    })));
    const started = Date.now();
    await runProvider(store, { provider: "exa", shard: 0, shards: 1, concurrency: 8,
      requestsPerSecond: 0.01, judgeRequestsPerSecond: 0.01, deadlineMs: 1000,
      now: () => new Date(day + "T00:20:00Z"), readers });
    const elapsedMs = Date.now() - started;
    assert.ok(elapsedMs < 2000, `A 100-second pacing interval must respect the 1-second invocation deadline (${elapsedMs}ms)`);
    const rows = await store.db.select().from(attempts);
    assert.ok(rows.every((row) => !["fetching", "grading"].includes(row.state)));
    assert.equal(calls.read, phase === "read" ? 1 : 0);
    assert.equal(calls.judge, 1);
    assert.equal(rows.reduce((sum, row) => sum + row.judgeCalls, 0), calls.judge);
    const judgeBudget = (await store.db.select().from(budgets).where(eq(budgets.bucket, "judge")))[0];
    assert.equal(judgeBudget.used, 100);
    if (phase === "read") {
      assert.equal(rows.filter((row) => row.state === "queued").length, 7);
      assert.equal((await store.db.select().from(budgets).where(eq(budgets.bucket, "exa")))[0].used, 1);
    } else assert.equal(rows.filter((row) => row.state === "fetched").length, 7);
    results.push({ phase, elapsedMs, calls: { ...calls } });
  }
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  fixture.closeAllConnections(); fixture.close();
  await store.close();
  await mkdir("artifacts/parallel", { recursive: true });
  await writeFile("artifacts/parallel/pacing-deadline-e2e.json", JSON.stringify({ ok: !failure, failure, results,
    repeat: "DATABASE_URL=postgresql://...@127.0.0.1/... node --import tsx tests/pacing-deadline.e2e.ts" }, null, 2));
}
console.log(JSON.stringify({ ok: true, results }, null, 2));
