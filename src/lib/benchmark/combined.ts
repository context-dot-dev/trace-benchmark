import {
  categories,
  providers,
  type ProviderMetric,
  type RunSummary,
  type Report,
  type Provider,
} from "./types";

export const benchmarkCategories = [
  ...categories,
  { id: "arts_sports_reference", name: "Arts, sports & reference" },
  { id: "other", name: "Other" },
];
export type PageOutcome = {
  success: boolean | null;
  state: string;
  error: string | null;
};
export type BenchmarkPage = {
  id: string;
  url: string;
  category: string;
  source: "daily" | "wikipedia_daily" | "wikipedia";
  day: string;
  protocol: string;
  results: Partial<Record<Provider, PageOutcome>>;
  screened?: boolean;
  audit?: string;
  auditReason?: string;
  article?: string;
  revision?: number;
  citedAt?: string;
  plainHttp?: boolean | null;
};
export type BenchmarkDataset = { report: Report; pages: BenchmarkPage[]; wikipediaHistory?: RunSummary[] };
export function normalizeCategory(id: string) {
  if (id === "legal_government") return "legal_regulatory";
  if (id === "finance") return "finance_filings";
  return id;
}
export function uniquePages(pages: BenchmarkPage[]) {
  const seen = new Set<string>();
  return pages.filter((page) => {
    const url = new URL(page.url);
    url.hash = "";
    if (seen.has(url.href)) return false;
    seen.add(url.href);
    return true;
  });
}
export function scorePages(
  pages: BenchmarkPage[],
  categoryIds: string[],
): ProviderMetric[] {
  return providers.map((provider) => {
    const groups = Object.fromEntries(
      categoryIds.map((id) => {
        const group = pages.filter((p) => p.category === id);
        return [
          id,
          {
            total: group.length,
            useful: group.filter(
              (p) => p.results[provider.id]?.success === true,
            ).length,
            unknown: group.filter(
              (p) => p.results[provider.id]?.success == null,
            ).length,
            completed: group.filter(
              (p) => p.results[provider.id]?.state === "done",
            ).length,
          },
        ];
      }),
    );
    const outcomes = pages.map((p) => p.results[provider.id]);
    const pending = outcomes.filter((r) => r && r.state !== "done").length;
    return {
      id: provider.id,
      total: pages.length,
      useful: outcomes.filter((r) => r?.success === true).length,
      failed: outcomes.filter((r) => r?.success === false).length,
      unknown: outcomes.filter(
        (r) => !r || (r.state === "done" && r.success === null),
      ).length,
      pending,
      rate:
        categoryIds.length &&
        Object.values(groups).every((g) => g.total > 0) &&
        outcomes.some((r) => r?.state === "done")
          ? Object.values(groups).reduce(
              (sum, g) => sum + g.useful / g.total,
              0,
            ) / categoryIds.length
          : null,
      categories: groups,
      p50: null,
      p95: null,
      rateLimited: 0,
    };
  });
}
