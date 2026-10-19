import type { CohortId, Summary } from "./types";

const DAILY_RUN_WINDOW_MS = 1080 * 60 * 1000;
const HOURLY_RUN_WINDOW_MS = 45 * 60 * 1000;

const RUN_STATUS_LABELS: Record<string, string> = {
  running: "collecting",
  acquired: "scoring",
  pending_budget: "waiting for daily budget",
  review_pending: "needs review",
  incomplete: "incomplete",
};

/** The collection state the original page reports at the top, from the scheduler's last tick and the latest run. */
export function collectionState(summary: Summary, cohort: CohortId, now: number) {
  const tick = summary.operations?.last_tick;
  const hoursSinceTick = tick?.finished_at ? (now - Date.parse(tick.finished_at)) / 3_600_000 : Infinity;
  const schedulerOn = summary.operations?.scheduler_status === "enabled";
  const latest = summary.cohorts[cohort]?.latestRun ?? null;
  const daily = summary.operations?.collection_profile?.cadence === "daily";
  const runWindow = daily ? DAILY_RUN_WINDOW_MS : HOURLY_RUN_WINDOW_MS;
  const staleAfterHours = daily ? 30 : 2;
  const hasErrors = !!tick?.errors?.length;

  const collecting =
    (latest && ["running", "acquired"].includes(latest.status) && now - Date.parse(latest.started_at) < runWindow) ||
    (schedulerOn && tick?.started_at && !tick.finished_at && now - Date.parse(tick.started_at) < runWindow);

  const label = collecting
    ? "Collecting new pages"
    : schedulerOn && hoursSinceTick < staleAfterHours && !hasErrors
      ? daily
        ? "Updating daily"
        : "Updating hourly"
      : hasErrors
        ? "Collection needs attention"
        : schedulerOn && hoursSinceTick >= staleAfterHours
          ? "Collection delayed"
          : "Manual collection";

  const tone: "live" | "warning" | "idle" = label === "Collection needs attention" || label === "Collection delayed" ? "warning" : label === "Manual collection" ? "idle" : "live";

  return {
    label,
    tone,
    lastCompleted: summary.cohorts[cohort]?.lastCompleted ?? null,
    current: latest && latest.status !== "completed" ? { run: latest, statusLabel: RUN_STATUS_LABELS[latest.status] ?? latest.status } : null,
    nextRunAt: summary.operations?.next_run_at ?? null,
  };
}
