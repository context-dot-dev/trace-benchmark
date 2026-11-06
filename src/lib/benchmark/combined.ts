import {
  categories,
  providers,
  type ProviderMetric,
  type RunSummary,
  type Report,
  type Provider,
} from "./types";
import { isAccountLimited, providerFailed } from "./outcomes";

export const benchmarkCategories = [
  ...categories,
  { id: "arts_sports_reference", name: "Arts, sports & reference" },
  { id: "other", name: "Other" },
];
export type PageOutcome = {
  success: boolean | null;
  state: string;
  error: string | null;
  /** Response time in milliseconds. */
  ms?: number | null;
  /** v6 access label: accessed, not_accessed, unclear (collection grade or v6 regrade). */
  access?: string | null;
  /** Content label: substantive, thin, blocked, error, unclear. */
  quality?: string | null;
  /** Document label: match, wrong_target, unknown. */
  identity?: string | null;
  /** v6 regrade result for samples collected under an earlier protocol. */
  v6?: boolean | null;
  /** Characters of returned text. */
  chars?: number | null;
  /** The provider ended on a different page than requested. */
  moved?: boolean | null;
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
/**
 * Restores fields that the transport omits: each result's default state, error, and success,
 * and the day and protocol shared by every page of the selected run.
 */
export function normalizePages(pages: BenchmarkPage[], latest: { day: string; protocol: string } | null): BenchmarkPage[] {
  return pages.map((page) => ({
    ...page,
    day: page.day ?? latest?.day ?? "",
    protocol: page.protocol ?? latest?.protocol ?? "",
    results: Object.fromEntries(
      Object.entries(page.results).map(([id, o]) => [
        id,
        { ...o, state: o?.state ?? "done", error: o?.error ?? null, success: o?.success ?? null },
      ]),
    ),
  }));
}
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
    // Rejections from our own account limits are left out of the provider's score.
    const counted = pages.filter((p) => !isAccountLimited(p.results[provider.id]?.error));
    const groups = Object.fromEntries(
      categoryIds.map((id) => {
        const group = counted.filter((p) => p.category === id);
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
    const outcomes = counted.map((p) => p.results[provider.id]);
    const pending = outcomes.filter((r) => r && r.state !== "done").length;
    const failed = outcomes.filter(
      (r) => r && r.state === "done" && r.success !== true && providerFailed(r),
    ).length;
    const scored =
      categoryIds.length > 0 &&
      Object.values(groups).every((g) => g.total > 0) &&
      outcomes.some((r) => r?.state === "done");
    const variance = Object.values(groups).reduce((sum, g) => {
      const p = g.total ? g.useful / g.total : 0;
      return sum + (g.total ? (p * (1 - p)) / g.total : 0);
    }, 0);
    return {
      id: provider.id,
      total: counted.length,
      useful: outcomes.filter((r) => r?.success === true).length,
      failed,
      unknown:
        outcomes.filter((r) => !r || (r.state === "done" && r.success !== true))
          .length - failed,
      pending,
      rate: scored
        ? Object.values(groups).reduce(
            (sum, g) => sum + g.useful / g.total,
            0,
          ) / categoryIds.length
        : null,
      ci: scored ? (1.96 * Math.sqrt(variance)) / categoryIds.length : null,
      categories: groups,
      p50: null,
      p95: null,
      rateLimited: pages.length - counted.length,
      excluded: pages.length - counted.length,
    };
  });
}
