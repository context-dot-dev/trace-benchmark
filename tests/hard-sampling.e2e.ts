import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { probeCandidates, refreshSupply, runTick } from "../src/lib/benchmark/collect.ts";
import type { Source } from "../src/lib/benchmark/discovery.ts";
import { fixedProbe } from "./probe-fixture.ts";
import { createReaders } from "../src/lib/benchmark/providers.ts";
import { migrateStore, openStore } from "../src/lib/benchmark/store.ts";
import { ACCESS_PROTOCOL, HARD_PROTOCOL, categories, providers, type RunSummary } from "../src/lib/benchmark/types.ts";
import type { ProbeVerdict } from "../src/lib/benchmark/probe.ts";

// Hard-first sampling: a neutral probe labels candidates before the sample is drawn. Hard pages
// fill the sample, easy pages only top up thin categories, and dead pages are never sampled.
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl && ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname),
  "Use a disposable local database; this test truncates scraping_bench");
const store = openStore(databaseUrl);
const readers = createReaders({
  keys: Object.fromEntries([...providers.map((p) => p.id), "judge"].map((id) => [id, "fixture-key"])),
});
const allCategories = [...categories.map((c) => c.id), "other"];
const checks: string[] = [];
const verdictOf = (url: string) => new URL(url).pathname.split("/")[2] as ProbeVerdict;
const probed: string[] = [];
const probe = async (url: string) => {
  probed.push(url);
  return fixedProbe(verdictOf)(url);
};
// Per category: two hard, two easy, and two dead pages from separate organizations.
async function seed(day: string, clock: Date) {
  await store.seedCandidates(allCategories.flatMap((category) =>
    (["hard", "easy", "dead"] as const).flatMap((verdict) => [1, 2].map((n) => ({
      id: `${day}-${category}-${verdict}-${n}`,
      url: `https://${category.replace("_", "-")}-${n}.example.org/${day}/${verdict}/${n}`,
      title: "Fixture page",
      category,
      organization: `${category}-${verdict}-${n}`,
      sourceId: "fixture",
      discoveredAt: clock,
    })))));
}
const sampled = async (runId: string) => (await store.db.execute(sql`
  select distinct page_id, url, category, probe from scraping_bench.attempts where run_id=${runId}`)).rows as
  { page_id: string; url: string; category: string; probe: { verdict: string; reason: string; version: string } | null }[];
const summaryOf = async (runId: string) => (await store.db.execute(sql`
  select summary from scraping_bench.runs where id=${runId}`)).rows[0]?.summary as RunSummary | undefined;
const restore = { ...process.env };

try {
  await migrateStore(store);
  await store.db.execute(sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources, scraping_bench.probes`);

  // Day 1: three pages per category. Two hard pages, then one easy page tops the category up.
  let clock = new Date("2026-11-27T00:20:00Z");
  await seed("2026-11-27", clock);
  process.env.TRACE_MIN_PER_CATEGORY = "3";
  await runTick(store, { now: () => clock, readers, probe, discover: false, maxPages: 0, perCategory: 3 });
  let rows = await sampled(HARD_PROTOCOL + ":2026-11-27");
  assert.equal(rows.length, allCategories.length * 3);
  for (const category of allCategories) {
    const pages = rows.filter((r) => r.category === category);
    assert.deepEqual(pages.map((r) => r.probe?.verdict).sort(), ["easy", "hard", "hard"]);
  }
  assert.ok(rows.every((r) => verdictOf(r.url) === r.probe?.verdict && r.probe?.version === "http-get-v1"));
  assert.ok(!rows.some((r) => r.probe?.verdict === "dead"));
  let summary = await summaryOf(HARD_PROTOCOL + ":2026-11-27");
  assert.equal(summary?.protocol, HARD_PROTOCOL);
  assert.deepEqual(summary?.sampling?.categories.news, { hard: 2, easy: 1 });
  assert.equal(summary?.sampling?.probe, "http-get-v1");
  checks.push("Hard pages fill the sample first, easy pages only top up a thin category, and dead pages are excluded");
  checks.push("Each sampled page keeps its probe label, and the run summary records the hard and easy counts");

  // Every candidate was probed once: fewer hard pages exist than the quota needs.
  assert.equal(probed.length, allCategories.length * 6);
  assert.equal(new Set(probed).size, probed.length);
  const before = probed.length;
  const again = await probeCandidates(store, { day: "2026-11-27", perCategory: 3, probe, now: () => clock });
  assert.equal(again.probed, 0);
  assert.equal(probed.length, before);
  checks.push("Fresh probes are reused instead of repeated");

  // Day 2: TRACE_MIN_PER_CATEGORY=0 samples hard pages only.
  clock = new Date("2026-12-04T00:20:00Z");
  await seed("2026-12-04", clock);
  process.env.TRACE_MIN_PER_CATEGORY = "0";
  await runTick(store, { now: () => clock, readers, probe, discover: false, maxPages: 0, perCategory: 3 });
  rows = await sampled(HARD_PROTOCOL + ":2026-12-04");
  assert.equal(rows.length, allCategories.length * 2);
  assert.ok(rows.every((r) => r.probe?.verdict === "hard"));
  checks.push("Hard-only sampling draws no easy pages");

  // Day 3: probing stops once a category has enough hard pages, and respects its probe budget.
  clock = new Date("2026-12-11T00:20:00Z");
  await seed("2026-12-11", clock);
  process.env.TRACE_PROBE_MAX_PER_CATEGORY = "3";
  probed.length = 0;
  const limited = await probeCandidates(store, { day: "2026-12-11", perCategory: 1, probe, now: () => clock });
  assert.equal(limited.done, true);
  for (const category of allCategories) {
    const urls = probed.filter((u) => new URL(u).hostname.startsWith(category.replace("_", "-") + "-"));
    assert.ok(urls.length <= 3, category + " exceeded its probe budget");
    assert.ok(urls.filter((u) => verdictOf(u) === "hard").length <= 2);
  }
  checks.push("Probing stops at each category's hard-page target or probe budget");

  // A probe cut short by the deadline is not recorded, so the page is probed again later.
  await store.db.execute(sql`truncate scraping_bench.probes`);
  delete process.env.TRACE_PROBE_MAX_PER_CATEGORY;
  const slow = async (url: string, signal: AbortSignal) => {
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    return fixedProbe(() => "hard")(url);
  };
  const cut = await probeCandidates(store, { day: "2026-12-11", perCategory: 3, probe: slow, deadlineMs: 100, now: () => clock });
  assert.equal(cut.done, false);
  assert.equal((await store.db.execute(sql`select count(*)::int as n from scraping_bench.probes`)).rows[0].n, 0);
  checks.push("A probe interrupted by the deadline leaves no verdict behind");

  // The daily refresh polls every due source in one call, not just one batch of 48, and probes
  // what it found. It never draws a sample.
  clock = new Date("2026-12-15T12:45:00Z");
  const registry: Source[] = Array.from({ length: 100 }, (_, i) => ({
    source_id: "daily-" + i, url: `https://feed-${i}.example.org/rss`, kind: "feed",
    category: "news", organization: "daily-" + i, poll_interval_hours: 24,
  }));
  probed.length = 0;
  const refreshed = await refreshSupply(store, {
    now: () => clock,
    probe,
    discovery: {
      registry,
      discover: async (source) => [{
        id: source.source_id, url: `https://${source.source_id}.example.org/2026-12-15/hard/1`, title: "Feed item",
        category: source.category, organization: source.organization, sourceId: source.source_id, discoveredAt: clock,
      }],
    },
  });
  assert.equal(refreshed.polled, 100);
  assert.equal(probed.filter((u) => u.includes("daily-")).length, 100);
  assert.equal((await store.db.execute(sql`select count(*)::int as n from scraping_bench.runs where day='2026-12-15'`)).rows[0].n, 0);
  checks.push("The daily refresh polls every due source and probes new candidates without drawing a sample");

  // TRACE_SAMPLING=all restores the v6 sample: no probes, every discovered page is eligible.
  clock = new Date("2026-12-18T00:20:00Z");
  await seed("2026-12-18", clock);
  process.env.TRACE_SAMPLING = "all";
  probed.length = 0;
  await runTick(store, { now: () => clock, readers, probe, discover: false, maxPages: 0, perCategory: 6 });
  rows = await sampled(ACCESS_PROTOCOL + ":2026-12-18");
  assert.equal(probed.length, 0);
  assert.equal(rows.length, allCategories.length * 6);
  assert.ok(rows.every((r) => r.probe === null));
  assert.equal((await summaryOf(ACCESS_PROTOCOL + ":2026-12-18"))?.sampling, undefined);
  checks.push("TRACE_SAMPLING=all draws the unfiltered v6 sample without probing");

  await mkdir("artifacts/hard-sampling", { recursive: true });
  await writeFile("artifacts/hard-sampling/e2e.json", JSON.stringify({ ok: true, checks }, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  process.env = restore;
  await store.close();
}
