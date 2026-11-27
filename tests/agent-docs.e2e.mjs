import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const categories = ["news", "commerce", "jobs", "finance_filings", "research", "legal_regulatory", "software_docs", "community_social"];
const providerIds = ["context", "exa", "firecrawl", "keenable"];
const day = "2026-11-07";
const runId = "scraping-bench-v6:" + day;
const run = {
  id: runId, day, protocol: "scraping-bench-v6", status: "completed",
  pages: categories.length, target: categories.length, finishedAt: day + "T01:00:00Z",
  categories: Object.fromEntries(categories.map(id => [id, 1])),
  providers: providerIds.map(id => ({
    id, total: 8, useful: 8, failed: 0, unknown: 0, pending: 0, rate: 1,
    p50: 100, p95: 100, rateLimited: 0,
    categories: Object.fromEntries(categories.map(id => [id, { total: 1, useful: 1, unknown: 0, completed: 1 }])),
  })),
};
const dataset = {
  report: { latest: run, history: [run], collecting: null, records: [], totalRecords: 0, page: 0,
    health: { lastTick: null, error: null, sources: 0, healthySources: 0, evidenceBytes: 0 } },
  pages: categories.map((category, i) => ({
    id: "agent-fixture-" + i, url: "https://fixture.example/" + i, category,
    source: "daily", day, protocol: run.protocol,
    results: Object.fromEntries(providerIds.map(id => [id, { success: true, state: "done", error: null, ms: 100, access: "accessed" }])),
  })),
};
let unavailable = false;
let requests = 0;
const fixture = createServer((_req, res) => {
  requests++;
  res.writeHead(unavailable ? 503 : 200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(unavailable ? { error: "PRIVATE_FIXTURE_DETAIL_MUST_NOT_LEAK" } : dataset));
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = "http://127.0.0.1:" + port;
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, BENCHMARK_DATA_ORIGIN: "http://127.0.0.1:" + fixture.address().port,
    TRACE_WORKER_ENABLED: "0", CRON_SECRET: "", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
app.stdout.on("data", chunk => { log += chunk; });
app.stderr.on("data", chunk => { log += chunk; });
try {
  const deadline = Date.now() + 30000;
  while (true) {
    try { if ((await fetch(base + "/llms.txt")).ok) break; } catch {}
    if (app.exitCode !== null || Date.now() > deadline) throw new Error(log || "App did not start");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(requests, 0, "The index is readable without a results service");
  const index = await (await fetch(base + "/llms.txt")).text();
  assert.equal(index, await readFile("llms.txt", "utf8"));
  assert.ok(index.length < 10000, "Index stays small enough for selective context loading");
  for (const line of index.split("\n").filter(line => line.startsWith("- "))) {
    assert.match(line, /^- \[[^\]]+\]\(https:\/\//, "Index entries have absolute, machine-readable links");
  }
  const full = await fetch(base + "/llms-full.txt");
  const fullText = await full.text();
  assert.equal(full.status, 200);
  assert.ok(fullText.includes("## Methodology"));
  assert.ok(fullText.includes("protocol: scraping-bench-v6"));
  assert.ok(fullText.includes(runId));
  assert.ok(fullText.includes("## Pages accessed"));
  const homepage = await fetch(base);
  assert.equal(homepage.status, 200);
  assert.match(homepage.headers.get("link"), /<\/llms.txt>; rel="describedby"/);
  assert.match(homepage.headers.get("link"), /<\/results.md>; rel="alternate"/);
  assert.equal(await readFile("llms-full.txt", "utf8"), await readFile("llms.full.txt", "utf8"));
  console.log("PASS concise index, generated reference, dated live scores, protocol, and source links");

  for (const userAgent of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot", "Googlebot"]) {
    for (const path of ["/llms.txt", "/llms-full.txt", "/results.md"]) {
      const response = await fetch(base + path, { headers: { "User-Agent": userAgent } });
      assert.equal(response.status, 200, userAgent + " can read " + path);
      assert.match(response.headers.get("content-type"), /^text\//);
      assert.match(response.headers.get("link"), /rel="describedby"/);
    }
  }
  for (const path of ["/llms.txt", "/llms-full.txt", "/results.md", "/robots.txt", "/sitemap.xml"]) {
    assert.equal((await fetch(base + path, { method: "HEAD" })).status, 200);
  }
  for (const [alias, canonical] of [["/llms.full.txt", "/llms-full.txt"], ["/index.md", "/results.md"]]) {
    const response = await fetch(base + alias, { redirect: "manual" });
    assert.equal(response.status, 308);
    assert.equal(new URL(response.headers.get("location"), base).pathname, canonical);
  }
  const robots = await (await fetch(base + "/robots.txt")).text();
  assert.match(robots, /User-Agent: \*/i);
  assert.match(robots, /Allow: \/\n/);
  assert.match(robots, /Disallow: \/api\/cron/);
  assert.match(robots, /Disallow: \/\.well-known\/workflow\//);
  assert.match(robots, /Sitemap: https:\/\/trace\.context\.dev\/sitemap\.xml/);
  const sitemap = await (await fetch(base + "/sitemap.xml")).text();
  assert.ok(sitemap.includes("<loc>https://trace.context.dev/</loc>"));
  assert.equal((await fetch(base + "/api/cron")).status, 401);
  assert.equal((await fetch(base + "/api/discover")).status, 401);
  for (const path of ["/llms.txt", "/llms-full.txt", "/results.md"]) {
    assert.equal((await fetch(base + path, { method: "POST" })).status, 405);
  }
  console.log("PASS bot GET/HEAD access, discovery headers, aliases, robots, sitemap, and protected cron");

  unavailable = true;
  assert.equal((await fetch(base + "/llms.txt")).status, 200);
  const fallback = await fetch(base + "/llms-full.txt");
  const fallbackText = await fallback.text();
  assert.equal(fallback.status, 200, "Documentation remains readable during a results outage");
  assert.match(fallbackText, /Live results are temporarily unavailable/);
  assert.ok(fallbackText.includes("## Methodology"));
  assert.ok(!fallbackText.includes("PRIVATE_FIXTURE_DETAIL_MUST_NOT_LEAK"));
  assert.equal((await fetch(base + "/results.md")).status, 503);
  console.log("PASS outage fallback retains documentation, reports unavailable scores, and leaks no private error");
} finally {
  app.kill("SIGTERM");
  await new Promise(resolve => fixture.close(resolve));
}
