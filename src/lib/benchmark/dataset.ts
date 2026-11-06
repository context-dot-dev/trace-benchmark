import { unstable_cache } from "next/cache";
import { serverEnv } from "../env.server";
import { eq } from "drizzle-orm";
import { cachedReport } from "./cached-report";
import { database } from "./store";
import { attempts, grades } from "./schema";
import { ACCESS_PROTOCOL, providers, type RunSummary } from "./types";
import { sourceHistory } from "./source-history";
import { redirected } from "./outcomes";
import { missingSchemaFallback } from "./report";
import {
  normalizeCategory,
  type BenchmarkDataset,
  type BenchmarkPage,
  type PageOutcome,
} from "./combined";
import study from "../../../public/data/wikipedia-study.json";

const baseColumns = {
  id: attempts.id,
  pageId: attempts.pageId,
  url: attempts.url,
  category: attempts.category,
  provider: attempts.provider,
  state: attempts.state,
  success: attempts.success,
  error: attempts.error,
  day: attempts.day,
  provenance: attempts.provenance,
  elapsedMs: attempts.elapsedMs,
  content: attempts.content,
  identity: attempts.identity,
  chars: attempts.chars,
};

const dailyPages = unstable_cache(
  async (runId: string, protocol: string) => {
    const { db } = database();
    const query = (withFinalUrl: boolean) =>
      db
        .select(withFinalUrl ? { ...baseColumns, finalUrl: attempts.finalUrl } : baseColumns)
        .from(attempts)
        .where(eq(attempts.runId, runId))
        .orderBy(attempts.pageId, attempts.provider);
    const rows: (Awaited<ReturnType<typeof query>>[number] & { finalUrl?: string | null })[] =
      await missingSchemaFallback(() => query(true), null) ?? await query(false);
    // Grades added after collection: v6 access regrades and document/content quality grades.
    const extra = await missingSchemaFallback(
      () =>
        db
          .select({
            attemptId: grades.attemptId,
            rubric: grades.rubric,
            success: grades.success,
            access: grades.access,
            content: grades.content,
            identity: grades.identity,
          })
          .from(grades)
          .where(eq(grades.runId, runId)),
      [],
    );
    const regrade = new Map(extra.filter((g) => g.rubric === "access").map((g) => [g.attemptId, g]));
    const quality = new Map(extra.filter((g) => g.rubric === "quality").map((g) => [g.attemptId, g]));
    const accessRun = protocol === ACCESS_PROTOCOL;
    const pages = new Map<string, BenchmarkPage>();
    for (const row of rows) {
      const provider = providers.find((p) => p.id === row.provider);
      if (!provider) continue;
      // Day and protocol are the same for every page of a run; normalizePages restores them.
      const page = pages.get(row.pageId) ?? ({
        id: row.pageId.slice(0, 16),
        url: row.url,
        category: normalizeCategory(row.category),
        source:
          row.provenance?.source === "wikipedia"
            ? ("wikipedia_daily" as const)
            : ("daily" as const),
        article: row.provenance?.article,
        revision: row.provenance?.revision,
        citedAt: row.provenance?.timestamp,
        results: {},
      } as unknown as BenchmarkPage);
      const q = quality.get(row.id);
      const r = regrade.get(row.id);
      const outcome: PageOutcome = {
        success: row.success,
        state: row.state,
        error: row.error,
        ms: row.elapsedMs,
        // In v6 the collection grade's content column holds the access label.
        access: accessRun ? row.content : (r?.access ?? null),
        quality: accessRun ? (q?.content ?? null) : row.content,
        identity: accessRun ? (q?.identity ?? null) : row.identity,
        v6: accessRun ? undefined : r ? r.success : undefined,
        chars: row.chars,
        moved: redirected(row.url, row.finalUrl),
      };
      page.results[provider.id] = compact(outcome);
      pages.set(row.pageId, page);
    }
    return [...pages.values()];
  },
  ["benchmark-daily-pages-v4"],
  { revalidate: 900 },
);

/**
 * Drops default and empty fields so the cached data and the page payload stay small:
 * state "done", a null error, and a null success are restored by normalizePages.
 */
function compact(outcome: PageOutcome): PageOutcome {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(outcome)) {
    if (value === null || value === undefined) continue;
    if (key === "state" && value === "done") continue;
    result[key] = value;
  }
  return result as PageOutcome;
}

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
