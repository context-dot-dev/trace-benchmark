import type { RunSummary } from "./types";

export const firstSampleDay = "2026-11-04";

export function projectHistoryRun(run: RunSummary, categoryIds: string[]): RunSummary {
  return {
    ...run,
    pages: categoryIds.reduce((sum, id) => sum + (run.categories[id] ?? 0), 0),
    categories: Object.fromEntries(categoryIds.map((id) => [id, run.categories[id] ?? 0])),
    providers: run.providers.map((provider) => {
      const groups = Object.fromEntries(categoryIds.map((id) => [id, provider.categories[id] ?? {
        total: 0, useful: 0, unknown: 0, completed: 0,
      }]));
      const values = Object.values(groups);
      const total = values.reduce((sum, group) => sum + group.total, 0);
      const useful = values.reduce((sum, group) => sum + group.useful, 0);
      const completed = values.reduce((sum, group) => sum + group.completed, 0);
      const unknown = values.reduce((sum, group) => sum + group.unknown, 0);
      const pending = total - completed;
      return {
        ...provider,
        total,
        useful,
        failed: total - useful - unknown,
        unknown: unknown - pending,
        pending,
        rate: completed > 0 && values.every((group) => group.total > 0)
          ? values.reduce((sum, group) => sum + group.useful / group.total, 0) / values.length
          : null,
        p50: null,
        p95: null,
        rateLimited: 0,
        categories: groups,
      };
    }),
  };
}

export function filterHistory(
  history: RunSummary[],
  filters: { source: string; category: string },
  wikipediaHistory?: RunSummary[],
): RunSummary[] {
  const wikipedia = new Map(wikipediaHistory?.map((run) => [run.id, run]));
  return history.filter((run) => run.day >= firstSampleDay).map((run) => {
    const selected = filters.source === "wikipedia_daily"
      ? wikipedia.get(run.id) ?? { ...projectHistoryRun(run, []), status: "unavailable" }
      : run;
    return filters.category === "all" || selected.status === "unavailable"
      ? selected
      : projectHistoryRun(selected, [filters.category]);
  });
}
