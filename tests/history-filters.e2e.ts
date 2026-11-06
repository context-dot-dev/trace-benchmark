import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { attempts, runs } from "../src/lib/benchmark/schema.ts";
import { summarize } from "../src/lib/benchmark/report.ts";
import { migrateStore, openStore } from "../src/lib/benchmark/store.ts";
import { providers, PROTOCOL, type RunSummary } from "../src/lib/benchmark/types.ts";

// Failure cases: source inferred from category, unfiltered fallback, lost pending
// counts, partial retention scored as complete, empty matches scored as zero,
// changed overall scoring, old days leaking back in, and input mutation.
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl && ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname),
  "Use a disposable local database; this test truncates scraping_bench");
const store = openStore(databaseUrl);
const checks: string[] = [];
let failure: string | undefined;
try {
  await migrateStore(store);
  await store.db.execute(sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`);
  const pages = [
    { id: "wiki-news-pass", category: "news", wiki: true, state: "done", success: true },
    { id: "wiki-news-fail", category: "news", wiki: true, state: "done", success: false },
    { id: "wiki-news-unknown", category: "news", wiki: true, state: "done", success: null },
    { id: "wiki-news-pending", category: "news", wiki: true, state: "queued", success: null },
    { id: "wiki-other-pass", category: "other", wiki: true, state: "done", success: true },
    { id: "feed-other-fail", category: "other", wiki: false, state: "done", success: false },
    { id: "feed-news-pass", category: "news", wiki: false, state: "done", success: true },
  ];
  const history: RunSummary[] = [];
  for (const day of ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]) {
    const id = `fixture:${day}`;
    const rows = providers.flatMap((provider) => pages.map((page) => ({
      id: `${id}:${provider.id}:${page.id}`, runId: id, day, pageId: page.id,
      provider: provider.id, url: `https://example.org/${page.id}`, title: page.id,
      category: page.category, state: page.state, success: page.success,
      elapsedMs: null, error: null,
      provenance: page.wiki ? { source: "wikipedia" as const, article: "Fixture", revision: 1, timestamp: `${day}T00:00:00Z` } : null,
    })));
    const summary = summarize(id, day, PROTOCOL, rows, pages.length, null);
    history.push(summary);
    await store.db.insert(runs).values({ id, day, protocol: PROTOCOL, status: summary.status, summary });
    await store.db.insert(attempts).values(rows);
  }
  const { filterHistory, firstSampleDay } = await import("../src/lib/benchmark/history.ts");
  const { sourceHistory } = await import("../src/lib/benchmark/source-history.ts");
  const original = JSON.stringify(history);
  const visible = history.filter((run) => run.day >= "2026-11-04");
  assert.equal(firstSampleDay, "2026-11-04");
  assert.deepEqual(filterHistory(history, { source: "all", category: "all" }), visible);
  checks.push("All-source overall scoring is preserved; Nov 4 cutoff retains future dates");
  const news = filterHistory(history, { source: "all", category: "news" });
  for (const run of news) {
    assert.equal(run.pages, 5);
    assert.equal(run.status, "collecting");
    for (const metric of run.providers) {
      assert.deepEqual([metric.total, metric.useful, metric.failed, metric.unknown, metric.pending, metric.rate], [5, 2, 1, 1, 1, 0.4]);
    }
  }
  checks.push("Persisted category summaries distinguish terminal unknowns from pending and keep collecting status");
  const wikipediaHistory = await sourceHistory(store, history);
  assert.equal(wikipediaHistory.length, 4);
  const wiki = filterHistory(history, { source: "wikipedia_daily", category: "all" }, wikipediaHistory);
  for (const run of wiki) {
    assert.equal(run.pages, 5);
    assert.deepEqual(run.categories, { news: 4, other: 1 });
    assert.equal(run.status, "collecting");
    for (const metric of run.providers) {
      assert.deepEqual([metric.total, metric.useful, metric.failed, metric.unknown, metric.pending, metric.rate], [5, 2, 1, 1, 1, 0.625]);
    }
  }
  const wikiOther = filterHistory(history, { source: "wikipedia_daily", category: "other" }, wikipediaHistory);
  assert.ok(wikiOther.every((run) => run.pages === 1 && run.providers.every((metric) => metric.rate === 1)));
  assert.ok(filterHistory(history, { source: "all", category: "other" }).every((run) => run.pages === 2 && run.providers.every((metric) => metric.rate === 0.5)));
  checks.push("Explicit provenance selects Wikipedia in every category; Other includes non-Wikipedia pages only for All sources");
  const missing = filterHistory(history, { source: "wikipedia_daily", category: "all" });
  const empty = filterHistory(history, { source: "wikipedia_daily", category: "jobs" }, wikipediaHistory);
  assert.ok(missing.every((run) => run.status === "unavailable" && run.pages === 0 && run.providers.every((metric) => metric.rate === null && metric.total === 0)));
  assert.ok(empty.every((run) => run.status === "collecting" && run.pages === 0 && run.providers.every((metric) => metric.rate === null && metric.total === 0)));
  checks.push("Missing source aggregates are unavailable; known empty intersections retain status without a fabricated score");
  await store.db.delete(attempts).where(eq(attempts.runId, "fixture:2026-11-04"));
  await store.db.delete(attempts).where(and(eq(attempts.runId, "fixture:2026-11-05"), eq(attempts.provider, "exa"), eq(attempts.pageId, "feed-other-fail")));
  await store.db.update(attempts).set({ provenance: null }).where(eq(attempts.runId, "fixture:2026-11-06"));
  const retained = await sourceHistory(store, history);
  for (const day of ["2026-11-04", "2026-11-05"]) {
    const run = retained.find((run) => run.day === day)!;
    assert.equal(run.status, "unavailable");
    assert.equal(run.pages, 0);
    assert.ok(run.providers.every((metric) => metric.total === 0 && metric.rate === null));
  }
  const noWiki = retained.find((run) => run.day === "2026-11-06")!;
  assert.equal(noWiki.status, "collecting");
  assert.equal(noWiki.pages, 0);
  assert.ok(noWiki.providers.every((metric) => metric.rate === null));
  assert.deepEqual(filterHistory(history, { source: "all", category: "news" }), news);
  assert.equal(JSON.stringify(history), original);
  checks.push("Expired or partially retained provider rows invalidate source history; saved category history still works and inputs remain unchanged");
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await store.close();
  await mkdir("artifacts/history-filters", { recursive: true });
  await writeFile("artifacts/history-filters/e2e.json", JSON.stringify({ ok: !failure, checks, failure,
    repeat: "DATABASE_URL=postgresql://...@127.0.0.1/... npx tsx tests/history-filters.e2e.ts" }, null, 2));
}
console.log(JSON.stringify({ ok: true, checks }, null, 2));
