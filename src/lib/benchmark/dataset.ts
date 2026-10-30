import { unstable_cache } from "next/cache";
import { eq } from "drizzle-orm";
import { cachedReport } from "./cached-report";
import { database } from "./store";
import { attempts } from "./schema";
import { providers } from "./types";
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
        source: "daily" as const,
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
  ["benchmark-daily-pages-v1"],
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
export async function benchmarkDataset(
  run?: string,
): Promise<BenchmarkDataset> {
  const report = await cachedReport({ run });
  const daily = report.latest
    ? await dailyPages(report.latest.id, report.latest.protocol)
    : [];
  return { report, pages: [...daily, ...wikipediaPages] };
}
