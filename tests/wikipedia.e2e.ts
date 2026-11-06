import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { openStore, migrateStore } from "../src/lib/benchmark/store.ts";
import { runTick } from "../src/lib/benchmark/collect.ts";
import { discoverSource, type Source } from "../src/lib/benchmark/discovery.ts";
import { createReaders } from "../src/lib/benchmark/providers.ts";
import { report } from "../src/lib/benchmark/report.ts";
import study from "../public/data/wikipedia-study.json";
import { categories, providers, PROTOCOL } from "../src/lib/benchmark/types.ts";

const databaseUrl = process.env.DATABASE_URL!;
assert.ok(
  databaseUrl &&
    ["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname),
  "Use a disposable local database",
);
const store = openStore(databaseUrl);
const checks: string[] = [];
const requests: string[] = [];
let revision = 2;
let fail = false;
let hidden = false;
let suppressed = false;
const fixture = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  const url = new URL(req.url!, "http://fixture");
  if (url.pathname === "/wiki") {
    requests.push(url.search);
    if (fail) {
      res.end(JSON.stringify({ error: { code: "maxlag" } }));
      return;
    }
    if (url.searchParams.get("list") === "recentchanges") {
      res.end(
        JSON.stringify({
          query: {
            recentchanges: Array.from({ length: 50 }, (_, i) => ({
              title: "Example article",
              revid:
                revision +
                (new Date(url.searchParams.get("rcend")!).getUTCHours() * 50 +
                  i) *
                  100,
              old_revid: 1,
              timestamp: url.searchParams.get("rcstart"),
              ns: 0,
              type: "edit",
            })),
          },
        }),
      );
    } else {
      const old = "[https://publisher.example/old Existing reference]";
      const added = `${old} {{cite web|url=https://publisher.example/new-${revision}?a=1&amp;b=2#section}} https://en.wikipedia.org/wiki/Internal https://127.0.0.1/private <!-- https://publisher.example/comment --> ${study.pages[0].url}`;
      res.end(
        JSON.stringify({
          query: {
            pages: [
              {
                revisions: url.searchParams
                  .get("revids")!
                  .split("|")
                  .map(Number)
                  .map((id) => ({
                    revid: id,
                    slots: {
                      main:
                        suppressed && id === revision
                          ? { texthidden: true }
                          : hidden && id !== 1
                            ? {}
                            : { content: id === 1 ? old : added },
                    },
                  })),
              },
            ],
          },
        }),
      );
    }
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  requests.push(url.pathname);
  const text =
    JSON.stringify(body).includes("/new-3") ||
    (url.searchParams.get("url") ?? "").includes("/new-3")
      ? ""
      : "Substantive content from the requested external page. ".repeat(40);
  if (url.pathname === "/judge")
    res.end(
      JSON.stringify({
        answers: body.state.target
          ? {
              content: { choice: "substantive", confidence: 0.99 },
              identity: { choice: "match", confidence: 0.99 },
            }
          : { access: { choice: "accessed", confidence: 0.99 } },
        usage: { input_tokens: 100 },
      }),
    );
  else if (url.pathname === "/context")
    res.end(
      JSON.stringify({
        markdown: { requested: true, success: true, data: text },
        url: body.url,
        key_metadata: { credits_consumed: 1 },
      }),
    );
  else if (url.pathname === "/exa")
    res.end(JSON.stringify({ results: [{ text, url: body.urls[0] }] }));
  else if (url.pathname === "/firecrawl")
    res.end(
      JSON.stringify({
        success: true,
        data: { markdown: text, metadata: { statusCode: 200 } },
      }),
    );
  else res.end(JSON.stringify({ content: text }));
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const address = fixture.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const read = async (url: string) =>
  (await fetch(base + "/wiki" + new URL(url).search)).text();
const source: Source = {
  source_id: "wikipedia_recent_links",
  kind: "wikipedia",
  url: "https://en.wikipedia.org/w/api.php",
  category: "other",
  organization: "Wikipedia",
  poll_interval_hours: 24,
};
const readers = createReaders({
  endpoints: Object.fromEntries(
    providers.map((p) => [p.id, base + "/" + p.id]),
  ),
  judgeEndpoint: base + "/judge",
  keys: Object.fromEntries(
    [...providers.map((p) => p.id), "judge"].map((id) => [id, "fixture"]),
  ),
});
let clock = new Date("2026-11-03T00:20:00Z");
const discovery = {
  registry: [source],
  discover: (s: Source, options: { now?: Date } = {}) =>
    discoverSource(s, { ...options, read }),
};
const options = {
  now: () => clock,
  readers,
  discovery,
  perCategory: 1,
  maxPages: 20,
  deadlineMs: 20000,
};
try {
  await migrateStore(store);
  await store.db.execute(
    sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`,
  );
  const found = await discovery.discover(source, { now: clock });
  assert.equal(
    found.length,
    1,
    "Only the newly added external URL is eligible",
  );
  assert.equal(found[0].url, "https://publisher.example/new-2?a=1&b=2");
  assert.equal(found[0].provenance?.article, "Example article");
  assert.equal(found[0].provenance?.revision, 2);
  assert.equal(
    found[0].title,
    "",
    "Article title must not masquerade as the external page title",
  );
  checks.push(
    "Revision comparison rejects existing, internal, private and commented links and preserves provenance",
  );
  const seedFeeds = () =>
    store.seedCandidates(
      categories.map((c, i) => ({
        id: `${clock.toISOString()}-${i}`,
        url: `https://feed.example/${clock.toISOString().slice(0, 10)}/${i}`,
        title: "Feed article",
        category: c.id,
        organization: `publisher-${i}`,
        sourceId: "fixture",
        discoveredAt: clock,
      })),
    );
  const wikipediaCalls = () => requests.filter((r) => r.startsWith("?")).length;
  const discoveryCalls = wikipediaCalls();
  const windows = requests
    .filter((r) => new URLSearchParams(r).get("list") === "recentchanges")
    .map((r) => new URLSearchParams(r));
  assert.equal(windows.length, 24);
  assert.equal(
    windows.map((p) => p.get("rcend")).sort()[0],
    "2026-11-02T00:00:00.000Z",
  );
  assert.equal(
    windows
      .map((p) => p.get("rcstart"))
      .sort()
      .at(-1),
    "2026-11-02T23:59:59.000Z",
  );
  clock = new Date("2026-11-03T00:00:00Z");
  await runTick(store, options);
  assert.equal(
    wikipediaCalls(),
    discoveryCalls,
    "No Wikipedia discovery before the daily sample window",
  );
  clock = new Date("2026-11-03T00:20:00Z");
  await seedFeeds();
  await runTick(store, options);
  let data = await report(store);
  assert.equal(data.latest?.pages, 9);
  assert.ok(
    data.latest?.providers.every(
      (p) => p.total === 9 && p.useful === 9 && p.rate === 1,
    ),
  );
  let wiki = await store.db.execute(
    sql`select provider, url, provenance from scraping_bench.attempts where category='other'`,
  );
  assert.equal(wiki.rows.length, 4);
  assert.ok(wiki.rows.every((r) => r.provenance.revision === 2));
  const providerCalls = () =>
    requests.filter((r) => providers.some((p) => r === "/" + p.id)).length;
  assert.equal(providerCalls(), 36);
  const dailyDiscoveryCalls = wikipediaCalls();
  await runTick(store, options);
  clock = new Date("2026-11-03T23:50:00Z");
  await runTick(store, options);
  assert.equal(providerCalls(), 36);
  assert.equal(
    wikipediaCalls(),
    dailyDiscoveryCalls,
    "Later ticks must not repeat Wikipedia discovery",
  );
  checks.push(
    "One daily batch samples the prior UTC day before freezing the sample; later ticks do not rediscover",
  );
  checks.push(
    "New Wikipedia pages run through all four providers, grading and reporting without repeated billing",
  );
  clock = new Date("2026-11-04T00:15:00Z");
  revision = 3;
  await seedFeeds();
  await runTick(store, options);
  data = await report(store);
  assert.equal(data.latest?.day, "2026-11-04");
  assert.equal(data.latest?.pages, 9);
  assert.ok(
    data.latest?.providers.every(
      (p) =>
        p.useful === 8 && p.failed === 1 && Math.abs(p.rate! - 8 / 9) < 1e-10,
    ),
  );
  checks.push(
    "Failed Wikipedia requests lower the access score as the ninth category; the eight existing categories remain equally weighted",
  );
  assert.equal(providerCalls(), 72);
  wiki = await store.db.execute(
    sql`select distinct url from scraping_bench.attempts where category='other'`,
  );
  assert.equal(wiki.rows.length, 2);
  checks.push(
    "The next UTC day discovers and benchmarks new Wikipedia links while excluding previously tested URLs",
  );
  clock = new Date("2026-11-05T00:15:00Z");
  await seedFeeds();
  fail = true;
  await runTick(store, { ...options, maxPages: 0 });
  const failures = await store.db.execute(
    sql`select error,next_poll,last_poll from scraping_bench.sources where id='wikipedia_recent_links'`,
  );
  assert.match(String(failures.rows[0].error), /WIKIPEDIA/);
  assert.equal(
    new Date(failures.rows[0].next_poll).toISOString(),
    "2026-11-06T00:15:00.000Z",
  );
  const failedCalls = wikipediaCalls();
  clock = new Date("2026-11-05T12:00:00Z");
  await runTick(store, { ...options, maxPages: 0 });
  assert.equal(
    wikipediaCalls(),
    failedCalls,
    "No repeated discovery after the daily sample has been frozen",
  );
  assert.equal(
    new Date(failures.rows[0].last_poll).toISOString(),
    "2026-11-04T00:15:00.000Z",
  );
  fail = false;
  suppressed = true;
  const partialDiscovery = await discovery.discover(source, { now: clock });
  assert.equal(partialDiscovery.length, 1);
  assert.equal(
    partialDiscovery[0].provenance?.revision,
    revision + 100,
    "Explicitly hidden revisions are skipped; readable comparisons remain eligible",
  );
  suppressed = false;
  hidden = true;
  await assert.rejects(discovery.discover(source, { now: clock }), /WIKIPEDIA/);
  hidden = false;
  revision = 4;
  clock = new Date("2026-11-06T00:15:00Z");
  await runTick(store, { ...options, maxPages: 0 });
  const recovered = await store.db.execute(
    sql`select error,count from scraping_bench.sources where id='wikipedia_recent_links'`,
  );
  assert.equal(recovered.rows[0].error, null);
  assert.equal(recovered.rows[0].count, 1);
  checks.push(
    "API errors and unavailable revision content remain failures; the next daily batch recovers without erasing last success",
  );
  clock = new Date("2026-11-07T00:15:00Z");
  fail = true;
  await store.db.execute(sql`truncate scraping_bench.candidates`);
  await store.db.execute(
    sql`update scraping_bench.sources set last_poll=null,next_poll='2026-11-07T00:00:00Z'`,
  );
  await seedFeeds();
  await store.db.execute(
    sql`delete from scraping_bench.candidates where category=${categories[0].id}`,
  );
  await runTick(store, { ...options, maxPages: 0 });
  const partial = await store.db.execute(
    sql`select id from scraping_bench.runs where day='2026-11-07'`,
  );
  assert.equal(
    partial.rows.length,
    1,
    "An unavailable optional Wikipedia source must not block the existing partial daily sample",
  );
  checks.push(
    "A first-poll Wikipedia failure does not block daily collection when a core category has insufficient supply",
  );
  await store.db.execute(
    sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`,
  );
  fail = false;
  revision = 5;
  clock = new Date("2026-11-08T00:20:00Z");
  await seedFeeds();
  await runTick(store, { ...options, discover: false, maxPages: 0 });
  await store.db.execute(sql`
    insert into scraping_bench.runs (id,day,protocol,status,created_at,summary)
    select 'scraping-bench-v4:2026-11-08',day,'scraping-bench-v4',status,created_at,
      summary || '{"id":"scraping-bench-v4:2026-11-08","protocol":"scraping-bench-v4","target":8}'::jsonb
    from scraping_bench.runs where day='2026-11-08'
  `);
  await store.db.execute(sql`update scraping_bench.attempts set run_id='scraping-bench-v4:2026-11-08' where day='2026-11-08'`);
  await store.db.execute(sql`delete from scraping_bench.runs where id=${PROTOCOL + ':2026-11-08'}`);
  const upgradeDiscoveryCalls = wikipediaCalls();
  const upgradeProviderCalls = providerCalls();
  await runTick(store, options);
  assert.equal(wikipediaCalls(), upgradeDiscoveryCalls, "A protocol upgrade must preserve today's frozen sample");
  data = await report(store);
  const upgradeRuns = await store.db.execute(sql`select id from scraping_bench.runs where day='2026-11-08'`);
  assert.equal(upgradeRuns.rows.length, 1, "An upgrade must not create a second sample for the same day");
  assert.equal(data.latest?.protocol, "scraping-bench-v4");
  assert.equal(data.latest?.status, "completed", "An in-flight run from the previous protocol must finish");
  assert.ok(data.latest?.providers.every((p) => p.total === 8 && p.rate === 1));
  assert.equal(providerCalls() - upgradeProviderCalls, 32);
  await runTick(store, options);
  assert.equal(providerCalls() - upgradeProviderCalls, 32, "Completed older runs must not be billed again");
  clock = new Date("2026-11-09T00:15:00Z");
  revision = 6;
  await seedFeeds();
  await runTick(store, options);
  data = await report(store);
  assert.equal(data.latest?.protocol, PROTOCOL);
  assert.equal(data.latest?.pages, 9);
  assert.equal(data.latest?.status, "completed");
  assert.ok(wikipediaCalls() > upgradeDiscoveryCalls);
  checks.push("A mid-day protocol upgrade completes the existing run without duplicating discovery or billing, then starts the current protocol with Wikipedia the next day");
  await store.db.execute(sql`
    insert into scraping_bench.runs (id,day,protocol,status,created_at,summary)
    select 'scraping-bench-v4:2026-11-09',day,'scraping-bench-v4','collecting',created_at - interval '1 hour',
      summary || '{"id":"scraping-bench-v4:2026-11-09","protocol":"scraping-bench-v4","status":"collecting"}'::jsonb
    from scraping_bench.runs where id=${PROTOCOL + ':2026-11-09'}
  `);
  data = await report(store);
  assert.deepEqual(data.history.map((r) => r.id), [
    PROTOCOL + ":2026-11-09",
    "scraping-bench-v4:2026-11-08",
  ], "History must show only the newest sample for each day while retaining earlier protocols on earlier days");
  assert.equal(data.collecting, null, "A superseded protocol must not appear as the public collecting sample");
  assert.equal((await report(store, { run: "scraping-bench-v4:2026-11-09" })).latest?.protocol, "scraping-bench-v4", "Explicit historical run IDs must remain accessible");
  await store.db.execute(sql`
    update scraping_bench.runs set status='completed',summary=summary || '{"status":"completed"}'::jsonb
    where id='scraping-bench-v4:2026-11-09'
  `);
  await store.db.execute(sql`
    update scraping_bench.runs set status='collecting',summary=summary || '{"status":"collecting"}'::jsonb
    where id=${PROTOCOL + ':2026-11-09'}
  `);
  data = await report(store);
  assert.equal(data.collecting?.id, PROTOCOL + ":2026-11-09");
  assert.equal(data.history.filter((r) => r.day === "2026-11-09").length, 1);
  assert.equal(data.latest?.id, "scraping-bench-v4:2026-11-08", "The completed-sample default must not fall back to a superseded protocol on the same day");
  checks.push("History exposes one active sample per day, preserves earlier days and explicit run access, and excludes superseded collecting runs");
  await mkdir("artifacts/daily-wikipedia", { recursive: true });
  await writeFile(
    "artifacts/daily-wikipedia/e2e.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        providerCalls: providerCalls(),
        wikipediaUrls: wiki.rows,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  fixture.close();
  await store.close();
}
