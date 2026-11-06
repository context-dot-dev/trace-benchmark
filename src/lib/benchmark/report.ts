import { and, desc, eq, count, sql } from "drizzle-orm";
import { attempts, runs, sources, worker } from "./schema";
import { categories, providers, type Report, type RunSummary } from "./types";
import type { Store } from "./store";
import { isAccountLimited, providerFailed } from "./outcomes";
export function summarize(
  id: string,
  day: string,
  protocol: string,
  rows: Pick<
    typeof attempts.$inferSelect,
    | "provider"
    | "pageId"
    | "category"
    | "state"
    | "success"
    | "elapsedMs"
    | "error"
  >[],
  target: number,
  finishedAt: Date | null,
): RunSummary {
  const scoredCategories = [
    ...categories,
    ...(rows.some((r) => r.category === "other") ? [{ id: "other" }] : []),
  ];
  const counts = Object.fromEntries(
    scoredCategories.map((c) => [
      c.id,
      new Set(rows.filter((r) => r.category === c.id).map((r) => r.pageId))
        .size,
    ]),
  );
  const percentile = (values: number[], p: number) =>
    values.length
      ? values[Math.max(0, Math.ceil(values.length * p) - 1)]
      : null;
  return {
    id,
    day,
    protocol,
    status:
      rows.length && rows.every((r) => r.state === "done")
        ? "completed"
        : rows.length
          ? "collecting"
          : "insufficient_supply",
    pages: new Set(rows.map((r) => r.pageId)).size,
    target,
    finishedAt: finishedAt?.toISOString() ?? null,
    categories: counts,
    providers: providers.map((provider) => {
      const all = rows.filter((r) => r.provider === provider.id);
      // Rejections from our own account limits say nothing about the provider; leave them
      // out of the score and report them separately.
      const records = all.filter((r) => !isAccountLimited(r.error));
      const groups = Object.fromEntries(
        scoredCategories.map((c) => {
          const group = records.filter((r) => r.category === c.id);
          return [
            c.id,
            {
              total: group.length,
              completed: group.filter((r) => r.state === "done").length,
              useful: group.filter((r) => r.success === true).length,
              unknown: group.filter((r) => r.success === null).length,
            },
          ];
        }),
      );
      const scored =
        Object.values(groups).every((g) => g.total > 0) &&
        records.some((r) => r.state === "done");
      const variance = Object.values(groups).reduce((sum, g) => {
        const p = g.total ? g.useful / g.total : 0;
        return sum + (g.total ? (p * (1 - p)) / g.total : 0);
      }, 0);
      const rateLimits = ["HTTP_429", "RATE_LIMIT_EXCEEDED", "RATE_LIMITED"];
      const timed = records
        .filter(
          (r) =>
            r.elapsedMs !== null &&
            ![
              "HTTP_401",
              "HTTP_402",
              ...rateLimits,
              "NO_MORE_CREDITS",
              "account_blocked_not_attempted",
              "INTERRUPTED_REQUEST",
              "CACHED_RESPONSE",
            ].includes(r.error ?? ""),
        )
        .map((r) => r.elapsedMs!)
        .sort((a, b) => a - b);
      const failed = records.filter(
        (r) => r.state === "done" && r.success !== true && providerFailed(r),
      ).length;
      return {
        id: provider.id,
        total: records.length,
        useful: records.filter((r) => r.success === true).length,
        failed,
        unknown:
          records.filter((r) => r.state === "done" && r.success !== true).length -
          failed,
        pending: records.filter((r) => r.state !== "done").length,
        rate: scored
          ? Object.values(groups).reduce(
              (sum, g) => sum + g.useful / g.total,
              0,
            ) / scoredCategories.length
          : null,
        ci: scored ? (1.96 * Math.sqrt(variance)) / scoredCategories.length : null,
        p50: percentile(timed, 0.5),
        p90: percentile(timed, 0.9),
        p95: percentile(timed, 0.95),
        p99: percentile(timed, 0.99),
        rateLimited: all.filter((r) => rateLimits.includes(r.error ?? ""))
          .length,
        excluded: all.length - records.length,
        categories: groups,
      };
    }),
  };
}
/**
 * Reads that depend on migration 0002 fall back until it has been applied, so a deploy that
 * lands before the migration keeps serving the existing results.
 */
export async function missingSchemaFallback<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code ??
      (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "42P01" || code === "42703") return fallback;
    throw error;
  }
}
type AuditRow = { rubric: string; pages: number; agreed: number; reviewers: number; since: string | null };
export async function report(
  store: Store,
  options: { run?: string; provider?: string; page?: number } = {},
): Promise<Report> {
  const runRows = await store.db
    .select()
    .from(runs)
    .orderBy(desc(runs.day), desc(runs.createdAt));
  const samples = runRows.map((r) => r.summary);
  // One run per day is charted: the most recently created one. Every run stays listed.
  const days = new Set<string>();
  const history = samples.filter((sample) => {
    if (days.has(sample.day)) return false;
    days.add(sample.day);
    return true;
  });
  const charted = new Set(history.map((r) => r.id));
  const auditRows = await missingSchemaFallback<{ rows: AuditRow[] }>(
    () =>
      store.db.execute<{
        rubric: string;
        pages: number;
        agreed: number;
        reviewers: number;
        since: string | null;
      }>(sql`
    select a.rubric, count(*)::int as pages,
      count(*) filter (where a.label = case when t.success is true then 'pass'
        when t.success is false then 'fail' else 'unclear' end)::int as agreed,
      count(distinct a.reviewer)::int as reviewers, min(a.created_at)::text as since
    from scraping_bench.audits a
    join scraping_bench.attempts t on t.id = a.attempt_id
    where a.label <> 'unclear'
    group by a.rubric`),
    { rows: [] },
  );
  const latest =
    (options.run
      ? samples.find((r) => r.id === options.run)
      : (history.find((r) => r.status === "completed") ?? history[0])) ?? null;
  const conditions = [eq(attempts.runId, latest?.id ?? "")];
  if (providers.some((p) => p.id === options.provider))
    conditions.push(eq(attempts.provider, options.provider!));
  const [{ total }] = await store.db
    .select({ total: count() })
    .from(attempts)
    .where(and(...conditions));
  const page = Math.max(
    0,
    Math.min(options.page ?? 0, Math.ceil(total / 20) - 1),
  );
  const records = await store.db
    .select({
      id: attempts.id,
      url: attempts.url,
      category: attempts.category,
      provider: attempts.provider,
      state: attempts.state,
      success: attempts.success,
      elapsedMs: attempts.elapsedMs,
      error: attempts.error,
      content: attempts.content,
      identity: attempts.identity,
      chars: attempts.chars,
      hash: attempts.hash,
      day: attempts.day,
    })
    .from(attempts)
    .where(and(...conditions))
    .orderBy(attempts.pageId, attempts.provider)
    .limit(20)
    .offset(page * 20);
  const [health] = await store.db
    .select()
    .from(worker)
    .where(eq(worker.id, "collector"));
  const sourceRows = await store.db.select().from(sources);
  const [{ bytes }] = await store.db
    .select({
      bytes: sql<number>`coalesce(sum(${attempts.evidenceBytes}),0)::int`,
    })
    .from(attempts);
  return {
    collecting: history.find((r) => r.status === "collecting") ?? null,
    latest,
    history,
    runs: runRows.map((r) => ({
      id: r.id,
      day: r.day,
      protocol: r.protocol,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      charted: charted.has(r.id),
    })),
    audits: auditRows.rows.map((row) => ({
      rubric: row.rubric,
      pages: Number(row.pages),
      agreed: Number(row.agreed),
      reviewers: Number(row.reviewers),
      since: row.since,
    })),
    records,
    totalRecords: total,
    page,
    health: {
      lastTick: health?.lastTick?.toISOString() ?? null,
      error: health?.error ?? null,
      sources: sourceRows.length,
      healthySources: sourceRows.filter((s) => s.lastPoll && !s.error).length,
      evidenceBytes: bytes,
    },
  };
}
