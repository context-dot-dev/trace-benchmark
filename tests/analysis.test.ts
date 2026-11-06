// Unit checks for the statistics behind every published number. No database needed:
//   npx tsx tests/analysis.test.ts
import assert from "node:assert/strict";
import { mcnemarP, pairwise, places, categoryResults, latency, failures, funnel, cost, findings } from "../src/lib/benchmark/analysis";
import { normalizePages, scorePages, type BenchmarkPage, type PageOutcome } from "../src/lib/benchmark/combined";
import { failureReason, providerFailed, redirected } from "../src/lib/benchmark/outcomes";
import { categories } from "../src/lib/benchmark/types";

const checks: string[] = [];

// Exact McNemar: 10 to 0 is significant, 6 to 4 is not, and the test is symmetric.
assert.ok(mcnemarP(10, 0) < 0.01);
assert.ok(mcnemarP(6, 4) > 0.5);
assert.equal(mcnemarP(3, 9), mcnemarP(9, 3));
assert.equal(mcnemarP(0, 0), 1);
checks.push("Exact McNemar p-values are symmetric and separate clear from noisy differences");

// Failure labels: deadlines count as timeouts whatever the provider reports; account limits are not failures.
assert.equal(failureReason({ state: "done", success: false, error: "HTTP_408", elapsedMs: 27_000 }), "timeout");
assert.equal(failureReason({ state: "done", success: null, error: "INVALID_CONTENT_RESPONSE", elapsedMs: 26_100 }), "timeout");
assert.equal(failureReason({ state: "done", success: null, error: "INVALID_CONTENT_RESPONSE", elapsedMs: 900 }), "no_content");
assert.equal(failureReason({ state: "done", success: null, error: "HTTP_429", elapsedMs: 100 }), null);
assert.equal(failureReason({ state: "done", success: false, error: null, access: "not_accessed" }), "barrier");
assert.equal(providerFailed({ state: "done", success: null, error: "INVALID_CONTENT_RESPONSE" }), true);
assert.equal(providerFailed({ state: "done", success: null, error: "CACHED_RESPONSE" }), false);
checks.push("Timeouts, empty responses, barriers, and account limits are labeled consistently");

assert.equal(redirected("https://example.com/a/", "http://www.example.com/a?x=1"), false);
assert.equal(redirected("https://example.com/a", "https://example.com/"), true);
assert.equal(redirected("https://example.com/a", null), null);
checks.push("Redirect detection ignores scheme, www, query, and trailing slash");

// A synthetic sample with 100 pages per category. Context gets 95 and Keenable 94, but on partly
// different pages, so their gap is within the noise; Exa (80) and Firecrawl (79) likewise.
const ids = ["context", "keenable", "exa", "firecrawl"] as const;
const ok: Record<(typeof ids)[number], (i: number) => boolean> = {
  context: (i) => i < 95,
  keenable: (i) => i >= 3 && i <= 96,
  exa: (i) => i < 80,
  firecrawl: (i) => i >= 2 && i < 81,
};
const pages: BenchmarkPage[] = [];
for (const c of categories)
  for (let i = 0; i < 100; i++)
    pages.push({
      id: `${c.id}-${i}`,
      url: `https://example.org/${c.id}/${i}`,
      category: c.id,
      source: "daily",
      day: "2026-11-07",
      protocol: "scraping-bench-v6",
      results: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            state: "done",
            success: ok[id](i),
            error: ok[id](i) ? null : id === "exa" ? "INVALID_CONTENT_RESPONSE" : null,
            ms: 1000 + i * 10,
            access: ok[id](i) ? "accessed" : "not_accessed",
            quality: "substantive",
            identity: ok[id](i) && i % 50 !== 0 ? "match" : "wrong_target",
          } satisfies PageOutcome,
        ]),
      ),
    });
// One account-limited request must not count against keenable.
pages[0].results.keenable = { state: "done", success: null, error: "HTTP_429" };
const ids8 = categories.map((c) => c.id);
const rows = scorePages(pages, ids8);
const keenable = rows.find((r) => r.id === "keenable")!;
assert.equal(keenable.excluded, 1);
assert.equal(keenable.total, pages.length - 1);
assert.ok(keenable.ci! > 0 && keenable.ci! < 0.03);
checks.push("Account-limited requests leave the denominator and every score carries a confidence interval");

const pairs = pairwise(pages);
const ranks = places(rows, pairs);
assert.equal(ranks.get("context")?.place, 1);
assert.equal(ranks.get("keenable")?.place, 1, "a 1-point gap with disagreements both ways is a tie");
assert.equal(ranks.get("exa")?.place, 3);
assert.equal(ranks.get("firecrawl")?.place, 3);
checks.push("Places are shared unless a paired test separates neighbors");

const cats = categoryResults(pages, ids8);
assert.ok(cats.every((c) => c.verdict === "tied" && c.nobody === 3));
const lat = latency(pages);
assert.equal(lat.find((l) => l.id === "context")!.p50, 1490);
const fails = failures(pages);
assert.equal(fails.find((f) => f.id === "exa")!.reasons.no_content, 160);
const fun = funnel(pages, true);
const ctx = fun.find((f) => f.id === "context")!;
assert.equal(ctx.accessed, 760);
assert.equal(ctx.rightPage, 744);
const costs = cost(rows);
assert.equal(costs.find((c) => c.id === "context")!.perAccessed1k, 0.792, "Context does not bill failures");
assert.ok(costs.find((c) => c.id === "exa")!.assumed);
checks.push("Category verdicts, latency percentiles, failure reasons, the quality funnel, and cost agree with the sample");

const text = findings({ rows, pairs, categories: cats, categoryName: (id) => id, latency: lat, measure: "accessed", pages: pages.length });
assert.match(text[0].detail, /margin of error|share first place/);
checks.push("Generated findings never claim a lead the statistics do not support");

// Compact transport: omitted state, error, and success come back with their defaults.
const restored = normalizePages([{ id: "p", url: "https://example.org", category: "news", source: "daily", results: { context: {} } } as unknown as BenchmarkPage], { day: "2026-11-07", protocol: "scraping-bench-v6" });
assert.deepEqual(restored[0].results.context, { state: "done", error: null, success: null });
assert.equal(restored[0].day, "2026-11-07");
checks.push("Compact page data is restored before any statistic is computed");

console.log(JSON.stringify({ ok: true, checks }, null, 2));
