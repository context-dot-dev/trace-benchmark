import { unstable_cache } from "next/cache";
import { serverEnv } from "../env.server";
import { eq } from "drizzle-orm";
import { cachedReport } from "./cached-report";
import { database } from "./store";
import { attempts } from "./schema";
import { providers, type RunSummary } from "./types";
import { sourceHistory } from "./source-history";
import {
  normalizeCategory,
  type BenchmarkDataset,
  type BenchmarkPage,
} from "./combined";
import study from "../../../public/data/wikipedia-study.json";

const dailyPages = unstable_cache(
  async (runId: string, protocol: string) => {
    const rows = await database()
      .db.select({
        pageId: attempts.pageId,
        url: attempts.url,
        category: attempts.category,
        provider: attempts.provider,
        state: attempts.state,
        success: attempts.success,
        error: attempts.error,
        day: attempts.day,
        provenance: attempts.provenance,
      })
      .from(attempts)
      .where(eq(attempts.runId, runId))
      .orderBy(attempts.pageId, attempts.provider);
    const pages = new Map<string, BenchmarkPage>();
    for (const row of rows) {
      const provider = providers.find((p) => p.id === row.provider);
      if (!provider) continue;
      const page = pages.get(row.pageId) ?? {
        id: row.pageId,
        url: row.url,
        category: normalizeCategory(row.category),
        day: row.day,
        protocol,
        source:
          row.provenance?.source === "wikipedia"
            ? ("wikipedia_daily" as const)
            : ("daily" as const),
        article: row.provenance?.article,
        revision: row.provenance?.revision,
        citedAt: row.provenance?.timestamp,
        results: {},
      };
      page.results[provider.id] = {
        success: row.success,
        state: row.state,
        error: row.error,
      };
      pages.set(row.pageId, page);
    }
    return [...pages.values()];
  },
  ["benchmark-daily-pages-v2"],
  { revalidate: 900 },
);

const wikipediaPages: BenchmarkPage[] = study.pages.map((p) => ({
  id: p.id,
  url: p.url,
  category: normalizeCategory(p.category),
  source: "wikipedia",
  day: study.measuredAt,
  protocol: study.grading,
  screened: p.screened,
  audit: p.audit,
  auditReason: p.auditReason,
  article: p.article,
  revision: p.revision,
  plainHttp: p.results.plain_http.success,
  results: Object.fromEntries(
    providers.map((provider) => [
      provider.id,
      { ...p.results[provider.id], state: "done" },
    ]),
  ),
}));
const wikipediaHistory = unstable_cache(
  async (history: RunSummary[]) => sourceHistory(database(), history),
  ["benchmark-source-history-v1"],
  { revalidate: 900 },
);
export async function benchmarkDataset(
  run?: string,
): Promise<BenchmarkDataset> {
  if (serverEnv.benchmarkDataOrigin) {
    const url = new URL("/api/benchmark", serverEnv.benchmarkDataOrigin);
    if (run) url.searchParams.set("run", run);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Benchmark data is unavailable");
    return response.json();
  }
  const report = await cachedReport({ run });
  const [daily, sourceSummaries] = await Promise.all([
    report.latest ? dailyPages(report.latest.id, report.latest.protocol) : [],
    wikipediaHistory(report.history),
  ]);
  return { report, pages: [...daily, ...wikipediaPages], wikipediaHistory: sourceSummaries };
}
