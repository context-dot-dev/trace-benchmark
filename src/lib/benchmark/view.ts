// Builds everything the page shows for one set of filters. Shared by the page, its structured
// data, and llms.txt so every surface reports the same numbers.
import {
  benchmarkCategories,
  normalizePages,
  scorePages,
  uniquePages,
  type BenchmarkDataset,
} from "./combined";
import {
  categoryResults,
  cost,
  failures,
  findings,
  funnel,
  latency,
  pairwise,
  places,
  qualitySignals,
  stability,
} from "./analysis";
import { filterHistory, firstSampleDay } from "./history";
import { ACCESS_PROTOCOL, categories, providers } from "./types";

/** URL-backed filters: source is "all" or "wikipedia_daily"; run is "latest" or a run id. */
export type Filters = { source: string; category: string; run?: string };
export const defaultFilters: Filters = { source: "all", category: "all", run: "latest" };

export function categoryName(id: string) {
  if (id === "other") return "Wikipedia links";
  return benchmarkCategories.find((c) => c.id === id)?.name ?? id;
}
export function providerName(id: string) {
  return providers.find((p) => p.id === id)?.name ?? id;
}

export function buildView(dataset: BenchmarkDataset, filters: Filters) {
  const { source, category } = filters;
  const selection = filters.run ?? "latest";
  const report = dataset.report;
  // Only daily samples from firstSampleDay onward are published.
  const visibleHistory = report.history.filter((r) => r.day >= firstSampleDay);
  const requestedRun =
    selection === "latest"
      ? (visibleHistory.find((r) => r.status === "completed") ?? visibleHistory[0])
      : visibleHistory.find((r) => r.id === selection);
  // The page data belongs to report.latest; while another run loads, nothing is scored.
  const run = report.latest && report.latest.id === requestedRun?.id ? report.latest : null;
  const accessRun = requestedRun?.protocol === ACCESS_PROTOCOL;
  const accessOnly = accessRun;
  const pages = normalizePages(dataset.pages, report.latest);
  const dailyPages = pages.filter((p) => p.source !== "wikipedia" && p.day >= firstSampleDay && p.day === run?.day);
  const selected = uniquePages(
    dailyPages.filter(
      (p) => (source === "all" || p.source === source) && (category === "all" || p.category === category),
    ),
  );
  const observedCategories = [...new Set(selected.map((p) => p.category))];
  const categoryIds =
    source === "all" && category === "all"
      ? [...categories.map((c) => c.id), ...(observedCategories.includes("other") ? ["other"] : [])]
      : observedCategories;
  const rows = scorePages(selected, categoryIds);
  const pairs = pairwise(selected);
  const ranks = places(rows, pairs);
  const categoryList = benchmarkCategories.filter((c) => categoryIds.includes(c.id));
  const cats = categoryResults(selected, categoryList.map((c) => c.id));
  const lat = latency(selected);
  const filteredHistory = filterHistory(visibleHistory, { source, category }, dataset.wikipediaHistory);
  const history = [...filteredHistory].reverse().sort((a, b) => a.day.localeCompare(b.day));
  const measure = accessOnly ? "accessed" : "returned useful content from";
  return {
    run,
    requestedRun,
    visibleHistory,
    filteredHistory,
    retainedDaily: dailyPages.length,
    hasFilters: source !== "all" || category !== "all",
    accessRun,
    accessOnly,
    selected,
    categoryIds,
    categoryList,
    rows,
    pairs,
    ranks,
    cats,
    lat,
    fails: failures(selected),
    funnel: funnel(selected, accessOnly),
    quality: qualitySignals(selected),
    costs: cost(rows),
    history,
    stability: stability(history),
    measure,
    findings: findings({
      rows,
      pairs,
      categories: cats,
      categoryName,
      latency: lat,
      measure,
      pages: selected.length,
    }),
  };
}
export type View = ReturnType<typeof buildView>;

const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const sec = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} seconds`);
const longDate = (day: string) =>
  new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Questions and answers built from the data, used on the page and in structured data. */
export function faqItems(view: View) {
  const ranked = [...view.rows].filter((r) => r.rate != null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const items: { q: string; a: string }[] = [];
  if (view.run && ranked.length) {
    const top = ranked[0];
    const tie = view.ranks.get(top.id)?.tied;
    items.push({
      q: "Which web scraping API has the highest success rate?",
      a: `In the ${longDate(view.run.day)} sample, ${providerName(top.id)} ${view.measure} ${pct(top.rate)} of ${view.selected.length.toLocaleString("en-US")} pages, followed by ${ranked
        .slice(1)
        .map((r) => `${providerName(r.id)} at ${pct(r.rate)}`)
        .join(", ")}. ${tie ? "Its lead over the next provider is within the margin of error." : "Its lead over the next provider is statistically significant."}`,
    });
  }
  const fastest = [...view.lat].filter((l) => l.p50 != null).sort((a, b) => a.p50! - b.p50!)[0];
  const tail = [...view.lat].filter((l) => l.p95 != null).sort((a, b) => a.p95! - b.p95!)[0];
  if (fastest && tail)
    items.push({
      q: "Which web scraping API is fastest?",
      a: `${providerName(fastest.id)} had the fastest median response, ${sec(fastest.p50)}. ${providerName(tail.id)} had the shortest slow tail: 95% of its requests finished within ${sec(tail.p95)}. Times are measured with caching turned off.`,
    });
  items.push(
    {
      q: "Does the benchmark use cached pages?",
      a: "No. Every request asks for a fresh fetch, and we check each response for the provider's own cache marker. Responses served from cache are left out of the scores and latency.",
    },
    {
      q: "How often is the benchmark updated?",
      a: "A new sample of about 2,500 never-tested pages is drawn every day at 00:15 UTC and sent to all four providers. Its scores fill in over the same UTC day.",
    },
    {
      q: "What does a success mean?",
      a: "Each sample states its scoring rule. Under page access, a page succeeds when actual page data loaded rather than a block, login screen, error, or empty shell. Under useful content, the response must also contain substantive content from the requested page, a stricter test, so compare scores only between samples that use the same rule.",
    },
    {
      q: "Can I reproduce the results?",
      a: "Yes. Every page-level record is downloadable, and the collector, judge prompt, and request settings are open source.",
    },
  );
  return items;
}
