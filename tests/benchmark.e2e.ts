import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { openStore, migrateStore } from "../src/lib/benchmark/store.ts";
import { runTick, authorizeCron } from "../src/lib/benchmark/collect.ts";
import { createReaders } from "../src/lib/benchmark/providers.ts";
import { report } from "../src/lib/benchmark/report.ts";
import { discoverSource } from "../src/lib/benchmark/discovery.ts";
import { categories, providers } from "../src/lib/benchmark/types.ts";
const url = process.env.DATABASE_URL!;
assert.ok(
  url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
  "Use a disposable local database",
);
const store = openStore(url);
const checks: string[] = [];
const requests: any[] = [];
const fixture = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = body ? JSON.parse(body) : {};
  requests.push({ path: req.url, body: data });
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/judge") {
    res.end(
      JSON.stringify({
        answers: { access: { choice: "accessed", confidence: 0.98 } },
        usage: { input_tokens: 100 },
      }),
    );
    return;
  }
  if (JSON.stringify(data).includes("/rate")) {
    res.statusCode = 429;
    res.end("{}");
    return;
  }
  const text =
    "A complete target article with substantive information. ".repeat(30) +
    "\ud83d";
  if (req.url === "/context")
    res.end(
      JSON.stringify({
        markdown: { requested: true, success: true, data: text },
        url: data.url,
        key_metadata: { credits_consumed: 1 },
      }),
    );
  else if (req.url === "/firecrawl")
    res.end(
      JSON.stringify({
        success: true,
        data: { markdown: text, metadata: { statusCode: 200 } },
      }),
    );
  else if (req.url === "/exa")
    res.end(
      JSON.stringify({
        results: [{ text, url: data.urls[0] }],
        costDollars: { total: 0.001 },
      }),
    );
  else res.end(JSON.stringify({ content: text }));
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const base = "http://127.0.0.1:" + (fixture.address() as any).port;
const readers = createReaders({
  endpoints: Object.fromEntries(
    providers.map((p) => [p.id, base + "/" + p.id]),
  ),
  judgeEndpoint: base + "/judge",
  keys: Object.fromEntries(
    [...providers.map((p) => p.id), "judge"].map((id) => [id, "fixture-key"]),
  ),
});
try {
  await migrateStore(store);
  await store.db.execute(
    sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`,
  );
  assert.equal(
    authorizeCron(new Request(base), {
      CRON_SECRET: "a-test-secret",
      VERCEL_ENV: "production",
    }),
    401,
  );
  assert.equal(
    authorizeCron(
      new Request(base, { headers: { authorization: "Bearer a-test-secret" } }),
      { CRON_SECRET: "a-test-secret", VERCEL_ENV: "preview" },
    ),
    403,
  );
  assert.equal(
    authorizeCron(
      new Request(base, { headers: { authorization: "Bearer undefined" } }),
      { VERCEL_ENV: "production" },
    ),
    401,
  );
  checks.push(
    "Cron authentication fails closed and preview collection is forbidden",
  );
  await assert.rejects(
    discoverSource({
      source_id: "private",
      url: base,
      kind: "feed",
      category: "news",
      organization: "fixture",
      poll_interval_hours: 1,
    }),
  );
  checks.push("Discovery rejects private destinations before fetching");
  const limited = await readers.read("context", {
    url: "https://example.org/rate",
    title: "Rate limit",
    category: "news",
  });
  assert.equal(limited.error, "HTTP_429");
  assert.equal(limited.success, null);
  checks.push("Rate limits are recorded separately from content failure");
  requests.length = 0;
  const clock = new Date("2026-10-28T00:20:00Z");
  const candidates = categories.map((c, i) => ({
    id: "page-" + i,
    url: "https://example.org/" + i,
    title: "Target article",
    category: c.id,
    organization: "publisher-" + i,
    sourceId: "fixture",
    discoveredAt: clock,
  }));
  await store.seedCandidates(candidates);
  const options = {
    now: () => clock,
    readers,
    discover: false,
    perCategory: 1,
    maxPages: 8,
    deadlineMs: 20000,
  };
  const concurrent = await Promise.all([
    runTick(store, options),
    runTick(store, options),
  ]);
  assert.ok(concurrent.some((x) => x.status === "busy"));
  let data = await report(store);
  assert.equal(data.latest?.pages, 8);
  assert.equal(data.latest?.status, "completed");
  assert.equal(data.latest?.providers.length, 4);
  assert.ok(
    data.latest?.providers.every((p) => p.useful === 8 && p.total === 8),
  );
  assert.equal(requests.filter((r) => r.path != "/judge").length, 32);
  checks.push(
    "Concurrent ticks freeze one shared sample and complete all four providers",
  );
  await runTick(store, options);
  assert.equal(requests.filter((r) => r.path != "/judge").length, 32);
  checks.push("Repeated ticks do not repeat billed requests");
  for (const request of requests.filter((r) => r.path === "/judge")) {
    assert.deepEqual(Object.keys(request.body.state).sort(), ["sampled", "text"]);
    assert.ok(!JSON.stringify(request.body.state).includes("fixture-key"));
  }
  const settled = await store.db.execute(
    sql`select used from scraping_bench.budgets where day='2026-10-28' and bucket='judge'`,
  );
  assert.equal(settled.rows[0].used, 3200);
  checks.push(
    "Grading is provider-blind and reservations settle to observed token usage",
  );

  const contextRequest = requests.find((r) => r.path === "/context").body;
  assert.equal(contextRequest.sharedParams.mainContentOnly, true);
  assert.equal(
    requests.find((r) => r.path === "/firecrawl").body.onlyMainContent,
    true,
  );
  checks.push(
    "Providers request comparable main content and Unicode survives persistence",
  );
  assert.ok(!JSON.stringify(data).includes("fixture-key"));
  assert.ok(!JSON.stringify(data).includes("complete target article"));
  checks.push("Public report excludes credentials and private grading text");
  await store.db.execute(
    sql`update scraping_bench.attempts set state='fetching', claim='dead', lease_until='2026-10-27' where id=(select id from scraping_bench.attempts limit 1)`,
  );
  await store.db.execute(
    sql`update scraping_bench.runs set status='collecting'`,
  );
  const next = new Date("2026-10-29T00:20:00Z");
  await store.seedCandidates(
    candidates.map((c, i) => ({
      ...c,
      id: "next-" + i,
      url: "https://example.org/next-" + i,
      discoveredAt: next,
    })),
  );
  await runTick(store, { ...options, now: () => next });
  data = await report(store);
  assert.equal(data.latest?.day, "2026-10-29");
  assert.equal(data.latest?.pages, 8);
  const recovered = await store.db.execute(
    sql`select error from scraping_bench.attempts where error='INTERRUPTED_REQUEST'`,
  );
  assert.equal(recovered.rows.length, 1);
  checks.push(
    "Expired dispatch becomes explicit unknown and cannot block a later day",
  );
  const capped = new Date("2026-10-30T00:20:00Z");
  await store.seedCandidates(
    candidates.map((c, i) => ({
      ...c,
      id: "cap-" + i,
      url: "https://example.org/cap-" + i,
      discoveredAt: capped,
    })),
  );
  for (const p of providers)
    await store.db.execute(
      sql`insert into scraping_bench.budgets(day,bucket,used) values('2026-10-30',${p.id},4000)`,
    );
  const before = requests.length;
  await runTick(store, { ...options, now: () => capped });
  assert.equal(requests.length, before);
  checks.push("Durable daily request caps prevent external calls");
  await store.db.execute(
    sql`update scraping_bench.attempts set day='2026-09-20' where state='done'`,
  );
  await runTick(store, { ...options, now: () => capped, maxPages: 0 });
  const retained = await store.db.execute(
    sql`select id,xmin::text as version,evidence_bytes from scraping_bench.attempts where day='2026-09-20' order by id`,
  );
  assert.ok(retained.rows.length > 0);
  assert.ok(retained.rows.every((r) => r.evidence_bytes === 0));
  await runTick(store, { ...options, now: () => capped, maxPages: 0 });
  const repeated = await store.db.execute(
    sql`select id,xmin::text as version,evidence_bytes from scraping_bench.attempts where day='2026-09-20' order by id`,
  );
  assert.deepEqual(repeated.rows, retained.rows);
  checks.push(
    "Expired evidence is cleared once without rewriting historical rows on later ticks",
  );
  await mkdir("artifacts/rebuild", { recursive: true });
  await writeFile(
    "artifacts/rebuild/e2e.json",
    JSON.stringify(
      { passed: true, checks, requests: requests.length },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks }));
} finally {
  fixture.close();
  await store.close();
}
