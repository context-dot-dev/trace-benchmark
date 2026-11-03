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
import { categories, providers } from "../src/lib/benchmark/types.ts";

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
            recentchanges: [
              {
                title: "Example article",
                revid: revision,
                old_revid: 1,
                timestamp: "2026-11-03T00:10:00Z",
                ns: 0,
                type: "edit",
              },
            ],
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
                revisions: [
                  { revid: 1, slots: { main: { content: old } } },
                  {
                    revid: revision,
                    slots: { main: hidden ? {} : { content: added } },
                  },
                ],
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
        answers: {
          content: { choice: "substantive", confidence: 0.99 },
          identity: { choice: "match", confidence: 0.99 },
        },
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
  poll_interval_hours: 1,
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
    sql`truncate scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`,
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
  await runTick(store, options);
  clock = new Date("2026-11-03T02:20:00Z");
  await runTick(store, options);
  assert.equal(providerCalls(), 36);
  checks.push(
    "New Wikipedia pages run through all four providers, grading and reporting without repeated billing",
  );
  clock = new Date("2026-11-04T00:20:00Z");
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
    "Failed Wikipedia requests lower the v5 score as the ninth category; the eight existing categories remain equally weighted",
  );
  assert.equal(providerCalls(), 72);
  wiki = await store.db.execute(
    sql`select distinct url from scraping_bench.attempts where category='other'`,
  );
  assert.equal(wiki.rows.length, 2);
  checks.push(
    "The next UTC day discovers and benchmarks new Wikipedia links while excluding previously tested URLs",
  );
  clock = new Date("2026-11-04T02:20:00Z");
  fail = true;
  await runTick(store, { ...options, maxPages: 0 });
  const failures = await store.db.execute(
    sql`select error,next_poll,last_poll from scraping_bench.sources where id='wikipedia_recent_links'`,
  );
  assert.match(String(failures.rows[0].error), /WIKIPEDIA/);
  assert.ok(
    new Date(failures.rows[0].next_poll).getTime() <=
      clock.getTime() + 15 * 60000,
  );
  assert.equal(
    new Date(failures.rows[0].last_poll).toISOString(),
    "2026-11-04T00:20:00.000Z",
  );
  fail = false;
  hidden = true;
  await assert.rejects(discovery.discover(source, { now: clock }), /WIKIPEDIA/);
  hidden = false;
  revision = 4;
  clock = new Date("2026-11-04T02:40:00Z");
  await runTick(store, { ...options, maxPages: 0 });
  const recovered = await store.db.execute(
    sql`select error,count from scraping_bench.sources where id='wikipedia_recent_links'`,
  );
  assert.equal(recovered.rows[0].error, null);
  assert.equal(recovered.rows[0].count, 1);
  checks.push(
    "API errors and unavailable revision content remain failures; scheduled retry recovers without erasing last success",
  );
  clock = new Date("2026-11-05T00:20:00Z");
  fail = true;
  await store.db.execute(sql`truncate scraping_bench.candidates`);
  await store.db.execute(
    sql`update scraping_bench.sources set last_poll=null,next_poll=now()-interval '1 day'`,
  );
  await seedFeeds();
  await store.db.execute(
    sql`delete from scraping_bench.candidates where category=${categories[0].id}`,
  );
  await runTick(store, { ...options, maxPages: 0 });
  const partial = await store.db.execute(
    sql`select id from scraping_bench.runs where day='2026-11-05'`,
  );
  assert.equal(
    partial.rows.length,
    1,
    "An unavailable optional Wikipedia source must not block the existing partial daily sample",
  );
  checks.push(
    "A first-poll Wikipedia failure does not block daily collection when a core category has insufficient supply",
  );
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
