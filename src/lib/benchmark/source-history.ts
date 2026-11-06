import { normalizeCategory } from "./combined";
import { firstSampleDay, projectHistoryRun } from "./history";
import type { Store } from "./store";
import type { ProviderMetric, RunSummary } from "./types";

type SourceGroup = {
  run_id: string;
  provider: string;
  category: string;
  wikipedia: boolean;
  total: number;
  useful: number;
  unknown: number;
  completed: number;
  rate_limited: number;
};

export async function sourceHistory(store: Store, history: RunSummary[]): Promise<RunSummary[]> {
  const visible = history.filter((run) => run.day >= firstSampleDay);
  if (!visible.length) return [];
  const { rows } = await store.pool.query<SourceGroup>(`
    SELECT run_id, provider, category,
      coalesce(provenance->>'source' = 'wikipedia', false) AS wikipedia,
      count(*)::int AS total,
      count(*) FILTER (WHERE success = true)::int AS useful,
      count(*) FILTER (WHERE success IS NULL)::int AS unknown,
      count(*) FILTER (WHERE state = 'done')::int AS completed,
      count(*) FILTER (WHERE error IN ('HTTP_429', 'RATE_LIMIT_EXCEEDED', 'RATE_LIMITED'))::int AS rate_limited
    FROM scraping_bench.attempts
    WHERE run_id = ANY($1::text[])
    GROUP BY run_id, provider, category, wikipedia
  `, [visible.map((run) => run.id)]);
  const byRun = new Map<string, SourceGroup[]>();
  for (const row of rows) {
    const groups = byRun.get(row.run_id) ?? [];
    groups.push(row);
    byRun.set(row.run_id, groups);
  }
  return visible.map((run) => {
    const groups = byRun.get(run.id) ?? [];
    const complete = run.providers.length > 0 && run.providers.every((provider) =>
      groups.filter((group) => group.provider === provider.id).reduce((sum, group) => sum + group.total, 0) === provider.total);
    if (!complete) return { ...projectHistoryRun(run, []), status: "unavailable" };
    const categories: Record<string, number> = {};
    const metrics = run.providers.map((provider) => {
      const selected = groups.filter((group) => group.provider === provider.id && group.wikipedia);
      const providerCategories: ProviderMetric["categories"] = {};
      for (const group of selected) {
        const id = normalizeCategory(group.category);
        const previous = providerCategories[id] ?? { total: 0, useful: 0, unknown: 0, completed: 0 };
        providerCategories[id] = {
          total: previous.total + group.total,
          useful: previous.useful + group.useful,
          unknown: previous.unknown + group.unknown,
          completed: previous.completed + group.completed,
        };
        categories[id] = Math.max(categories[id] ?? 0, providerCategories[id].total);
      }
      return { ...provider, categories: providerCategories };
    });
    const projected = projectHistoryRun({ ...run, categories, providers: metrics }, Object.keys(categories).sort());
    return { ...projected, providers: projected.providers.map((provider) => ({
      ...provider,
      rateLimited: groups.filter((group) => group.provider === provider.id && group.wikipedia)
        .reduce((sum, group) => sum + group.rate_limited, 0),
    })) };
  });
}
