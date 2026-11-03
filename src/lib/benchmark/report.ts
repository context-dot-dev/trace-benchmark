import { and, desc, eq, count, sql } from "drizzle-orm";
import { attempts, runs, sources, worker } from "./schema";
import { categories, providers, type Report, type RunSummary } from "./types";
import type { Store } from "./store";
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
      const records = rows.filter((r) => r.provider === provider.id);
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
            ].includes(r.error ?? ""),
        )
        .map((r) => r.elapsedMs!)
        .sort((a, b) => a - b);
      return {
        id: provider.id,
        total: records.length,
        useful: records.filter((r) => r.success === true).length,
        failed: records.filter((r) => r.success === false).length,
        unknown: records.filter((r) => r.state === "done" && r.success === null)
          .length,
        pending: records.filter((r) => r.state !== "done").length,
        rate:
          Object.values(groups).every((g) => g.total > 0) &&
          records.some((r) => r.state === "done")
            ? Object.values(groups).reduce(
                (sum, g) => sum + g.useful / g.total,
                0,
              ) / scoredCategories.length
            : null,
        p50: percentile(timed, 0.5),
        p95: percentile(timed, 0.95),
        rateLimited: records.filter((r) => rateLimits.includes(r.error ?? ""))
          .length,
        categories: groups,
      };
    }),
  };
}
export async function report(
  store: Store,
  options: { run?: string; provider?: string; page?: number } = {},
): Promise<Report> {
  const samples = (
    await store.db
      .select()
      .from(runs)
      .orderBy(desc(runs.day), desc(runs.createdAt))
  ).map((r) => r.summary);
  const days = new Set<string>();
  const history = samples.filter((sample) => {
    if (days.has(sample.day)) return false;
    days.add(sample.day);
    return true;
  });
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
