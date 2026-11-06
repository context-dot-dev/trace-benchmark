import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { openStore, migrateStore } from "../src/lib/benchmark/store.ts";
import { runTick } from "../src/lib/benchmark/collect.ts";
import { createReaders } from "../src/lib/benchmark/providers.ts";
import { categories, providers } from "../src/lib/benchmark/types.ts";
import registry from "../config/sources.json";

// Covers cron authentication, duplicate workflows, an occupied lease, provider
// capacity limits, independent progress, duplicate billing, and body deadlines.
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl && ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname),
  "Use a disposable local database; this test truncates scraping_bench");
const store = openStore(databaseUrl);
const artifactDir = path.resolve("artifacts/continuous");
await mkdir(artifactDir, { recursive: true });
const blockedPath = path.join(artifactDir, "blocked-fetches.log");
await writeFile(blockedPath, "");
await writeFile(path.join(artifactDir, "server.log"), "");
const checks: string[] = [];
const defaultLimits: Record<string, { concurrency: number; requestsPerSecond: number }> = {
  context: { concurrency: 512, requestsPerSecond: 10 },
  exa: { concurrency: 512, requestsPerSecond: 5 },
  firecrawl: { concurrency: 50, requestsPerSecond: 100 },
  keenable: { concurrency: 100, requestsPerSecond: 8 },
};
const requests: { provider: string; url: string; started: number; ended?: number; mode: string }[] = [];
const active: Record<string, number> = {};
const maximum: Record<string, number> = {};
const maximumPerSecond: Record<string, number> = {};
const children: ChildProcess[] = [];
let serverLog = "";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fixture = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const incoming = new URL(req.url!, "http://127.0.0.1");
  const provider = incoming.pathname.slice(1);
  const url = body.url ?? body.urls?.[0] ?? body.state?.target.url ?? incoming.searchParams.get("url");
  const mode = new URL(url).searchParams.get("mode") ?? "normal";
  const request = { provider, url, mode, started: Date.now(), ended: undefined as number | undefined };
  requests.push(request);
  active[provider] = (active[provider] ?? 0) + 1;
  maximum[provider] = Math.max(maximum[provider] ?? 0, active[provider]);
  res.once("close", () => { request.ended = Date.now(); active[provider]--; });
  res.setHeader("Content-Type", "application/json");
  if (provider === "judge") {
    await delay(25);
    res.end(JSON.stringify({ answers: {
      content: { choice: "substantive", confidence: 0.98 },
      identity: { choice: "match", confidence: 0.99 },
    }, usage: { input_tokens: 100 } }));
    return;
  }
  assert.ok(providers.some((p) => p.id === provider));
  const authorization = req.headers.authorization ?? req.headers["x-api-key"];
  assert.ok(authorization === "fixture-key" || authorization === "Bearer fixture-key");
  if (mode === "stall") { res.write("{"); return; }
  const text = "The requested document contains substantive target information. ".repeat(30);
  const result = provider === "context"
    ? { markdown: { requested: true, success: true, data: text }, url, key_metadata: { credits_consumed: 1 } }
    : provider === "exa" ? { results: [{ text, url }], costDollars: { total: 0.001 } }
    : provider === "firecrawl" ? { success: true, data: { markdown: text, metadata: { statusCode: 200 } } }
    : { content: text, url };
  const serialized = JSON.stringify(result);
  if (mode === "slow") {
    res.write(serialized.slice(0, 30));
    await delay(2200);
    res.end(serialized.slice(30));
  } else {
    await delay(1500);
    res.end(serialized);
  }
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const fixtureBase = "http://127.0.0.1:" + (fixture.address() as { port: number }).port;
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  CONTEXT_API_KEY: "fixture-key", EXA_API_KEY: "fixture-key",
  FIRECRAWL_API_KEY: "fixture-key", KEENABLE_API_KEY: "fixture-key",
  TYPESAFE_API_KEY: "fixture-key", CRON_SECRET: "fixture-cron-secret",
  TRACE_WORKER_ENABLED: "1", VERCEL_ENV: "production",
  BENCHMARK_DATA_ORIGIN: "", BENCHMARK_E2E_FIXTURE: fixtureBase,
  BENCHMARK_E2E_BLOCKED: blockedPath,
  WORKFLOW_TARGET_WORLD: "local",
  WORKFLOW_LOCAL_DATA_DIR: path.join(artifactDir, "workflow-" + process.pid + "-" + Date.now()),
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: "--import=" + path.resolve("tests/provider-fixture-preload.mjs"),
};
// A local Workflow world is selected outside Vercel; never inherit remote credentials.
delete childEnv.VERCEL;
delete childEnv.VERCEL_URL;
delete childEnv.VERCEL_DEPLOYMENT_ID;
delete childEnv.VERCEL_OIDC_TOKEN;
delete childEnv.WORKFLOW_VERCEL_AUTH_TOKEN;
delete childEnv.TRACE_JUDGE_RPS;
for (const provider of providers) {
  delete childEnv["TRACE_" + provider.id.toUpperCase() + "_CONCURRENCY"];
  delete childEnv["TRACE_" + provider.id.toUpperCase() + "_RPS"];
}
async function startServer() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...childEnv, WORKFLOW_LOCAL_BASE_URL: "http://127.0.0.1:" + port }, stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const recordLog = (chunk: Buffer) => {
    serverLog += chunk.toString();
    appendFileSync(path.join(artifactDir, "server.log"), chunk);
  };
  child.stdout?.on("data", recordLog);
  child.stderr?.on("data", recordLog);
  const base = "http://127.0.0.1:" + port;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Next exited: " + serverLog.slice(-6000));
    try {
      const response = await fetch(base + "/api/cron", { signal: AbortSignal.timeout(10000) });
      if (response.status === 401) return base;
    } catch { /* Next is still starting. */ }
    await delay(500);
  }
  throw new Error("Next did not start: " + serverLog.slice(-6000));
}
let failure: string | undefined;
let launch: unknown;
let duplicate: unknown;
const started = Date.now();
try {
  await migrateStore(store);
  await store.db.execute(sql`truncate scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`);
  const clock = new Date();
  clock.setUTCHours(0, 20, 0, 0);
  const day = clock.toISOString().slice(0, 10);
  const candidates = Array.from({ length: 112 }, (_, i) => ({
    id: "continuous-" + String(i).padStart(3, "0"),
    url: "https://example.org/continuous/" + i + "?mode=" + (i === 1 ? "slow" : i === 2 ? "stall" : "normal"),
    title: "Target document " + i, category: categories[i % categories.length].id,
    organization: "fixture-publisher-" + i, sourceId: "fixture", discoveredAt: clock,
  }));
  await store.seedCandidates(candidates);
  await runTick(store, {
    now: () => clock, discover: false, maxPages: 0,
    readers: createReaders({ keys: Object.fromEntries([...providers.map((p) => p.id), "judge"].map((p) => [p, "fixture-key"])) }),
  });
  for (const source of registry)
    await store.db.execute(sql`insert into scraping_bench.sources(id,next_poll,last_poll) values(${source.source_id},now()+interval '2 days',now())`);
  const seeded = await store.db.execute(sql`select count(*)::int as count from scraping_bench.attempts`);
  assert.equal(seeded.rows[0].count, 448);
  const base = await startServer();
  assert.equal((await fetch(base + "/api/cron")).status, 401);
  assert.equal(requests.length, 0);
  checks.push("HTTP cron authentication rejects unauthorized calls without provider requests");
  const leaseExpiry = new Date(Date.now() + 30000);
  await store.db.execute(sql`update scraping_bench.worker set claim='existing-collector',lease_until=${leaseExpiry}`);
  const headers = { authorization: "Bearer fixture-cron-secret" };
  const response = await fetch(base + "/api/cron", { headers });
  assert.equal(response.status, 200, await response.clone().text());
  const first = await response.json();
  launch = first;
  assert.equal(first.status, "started");
  assert.equal(typeof first.runId, "string");
  const again = await fetch(base + "/api/cron", { headers });
  assert.equal(again.status, 200, await again.clone().text());
  const second = await again.json();
  duplicate = second;
  assert.equal(second.status, "busy");
  assert.equal(second.runId, first.runId);
  checks.push("Duplicate authenticated dispatch returns the same in-flight workflow");
  const deadline = Date.now() + 240000;
  let completed = false;
  while (Date.now() < deadline) {
    const rows = await store.db.execute(sql`select status from scraping_bench.runs where day=${day}`);
    if (rows.rows[0]?.status === "completed") { completed = true; break; }
    await delay(1000);
  }
  assert.ok(completed, "One workflow must drain all 112 pages without another cron invocation");
  assert.ok(requests[0].started >= leaseExpiry.getTime(), "The existing collector lease must be respected");
  checks.push("Occupied collector lease is retried and >100 pages finish without another cron tick");
  const outcomes = await store.db.execute(sql`select provider,url,state,success,error,elapsed_ms from scraping_bench.attempts order by provider,url`);
  for (const row of outcomes.rows) {
    assert.equal(row.state, "done");
    const mode = new URL(String(row.url)).searchParams.get("mode");
    if (mode === "stall") {
      assert.equal(row.error, "REQUEST_TIMEOUT");
      assert.equal(row.success, false);
      assert.ok(Number(row.elapsed_ms) >= 29000 && Number(row.elapsed_ms) < 35000);
    } else { assert.equal(row.error, null); assert.equal(row.success, true); }
  }
  checks.push("All four clients retain 30s full-body deadlines; slow streamed successes pass");
  for (const provider of providers) {
    const calls = requests.filter((r) => r.provider === provider.id);
    assert.equal(calls.length, 112);
    assert.equal(new Set(calls.map((r) => r.url)).size, 112);
    assert.ok(maximum[provider.id] <= defaultLimits[provider.id].concurrency && maximum[provider.id] > 1);
    const starts = calls.map((r) => r.started).sort((a, b) => a - b);
    let left = 0;
    for (let right = 0; right < starts.length; right++) {
      while (starts[right] - starts[left] >= 1000) left++;
      maximumPerSecond[provider.id] = Math.max(maximumPerSecond[provider.id] ?? 0, right - left + 1);
    }
    assert.ok(maximumPerSecond[provider.id] <= defaultLimits[provider.id].requestsPerSecond + 4,
      provider.id + " exceeded its default aggregate request pacing");
  }
  assert.equal(requests.filter((r) => r.provider === "judge").length, 444);
  checks.push("Exactly one read per provider/page within production-default provider concurrency and QPS limits");
  for (const provider of providers) {
    const calls = requests.filter((r) => r.provider === provider.id);
    const stalled = calls.find((r) => r.mode === "stall")!;
    assert.ok(calls.filter((r) => r.mode === "normal" && r.started < stalled.ended!).length >= 100,
      provider.id + " must continue dispatching while its stalled response is pending");
  }
  checks.push("Provider pools continue dispatching unrelated pages during a stalled response");
  assert.equal(await readFile(blockedPath, "utf8"), "");
  checks.push("No public-network requests; the actual production provider clients use local HTTP fixtures");
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(5000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  fixture.closeAllConnections();
  fixture.close();
  await store.close();
  await writeFile(path.join(artifactDir, "server.log"), serverLog);
  await writeFile(path.join(artifactDir, "e2e.json"), JSON.stringify({
    ok: !failure, failure, checks, launch, duplicate, maximum, maximumPerSecond, defaultLimits,
    elapsedMs: Date.now() - started, requests,
    limitations: "Local Next/Turbopack + PostgreSQL + Workflow development world with HTTP fixtures; not live provider load or Vercel production execution.",
    repeat: "DATABASE_URL=postgresql://...@127.0.0.1/... npx tsx tests/continuous.e2e.ts",
  }, null, 2));
}
console.log(JSON.stringify({ ok: true, checks, maximum, maximumPerSecond, artifact: path.join(artifactDir, "e2e.json") }, null, 2));
