"use client";

import * as React from "react";

import { percent, shortDay } from "@/lib/trace/format";
import type { CohortId, DailyPoint, SampleRole, Summary } from "@/lib/trace/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { Choice } from "../choice";
import { CellDetail, DataTable } from "../data-table";
import { TabbedPanel } from "../panel";
import { OURS, ProviderLogo, ProviderName } from "../provider-logo";
import { Controls, Fine, ReportSection, TextLink } from "../report-section";
import { LineSwatch, TrendChart } from "../trend-chart";

const PERIODS = ["7", "30", "90"] as const;
type Period = (typeof PERIODS)[number];

export function TrendsSection({ summary, cohort, sampleRole }: { summary: Summary; cohort: CohortId; sampleRole: SampleRole | null }) {
  const [earlier, setEarlier] = React.useState(false);
  const [period, setPeriod] = React.useState<Period>("30");
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set());
  const [hoveredDay, setHoveredDay] = React.useState<string | null>(null);

  const role = cohort === "independent" && sampleRole && !earlier ? sampleRole : null;
  const series: DailyPoint[] = (role ? (summary.metrics?.sample_daily ?? []).filter((point) => point.sample_role === role) : (summary.metrics?.daily ?? [])).filter((point) => point.cohort === cohort);
  const latestDay = series.map((point) => point.day).sort().at(-1);
  const since = latestDay ? Date.parse(latestDay) - (Number(period) - 1) * 86_400_000 : 0;
  const inPeriod = series.filter((point) => Date.parse(point.day) >= since);
  const days = [...new Set(inPeriod.map((point) => point.day))].sort();
  const pointsByDay = new Map<string, Map<string, DailyPoint>>();
  for (const point of inPeriod) {
    const byProvider = pointsByDay.get(point.day) ?? new Map<string, DailyPoint>();
    byProvider.set(point.provider, point);
    pointsByDay.set(point.day, byProvider);
  }
  const daySet = new Set(days);
  const hiddenSet = hidden;
  const scoredDays = days.filter((day) => [...(pointsByDay.get(day)?.values() ?? [])].some((point) => point.success_rate !== null));
  const activeDay = hoveredDay && daySet.has(hoveredDay) ? hoveredDay : (scoredDays.at(-1) ?? days.at(-1));
  const providers = summary.providers;
  const visible = providers.filter((provider) => !hiddenSet.has(provider.id));

  const chart = days.length ? (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label="Chart providers" className="flex flex-wrap gap-2">
        {providers.map((provider) => {
          const shown = !hiddenSet.has(provider.id);
          return (
            <button
              key={provider.id}
              type="button"
              aria-pressed={shown}
              onClick={() => setHidden((current) => {
                const next = new Set(current);
                if (next.has(provider.id)) next.delete(provider.id);
                else next.add(provider.id);
                return next;
              })}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-pill border px-3 text-caption max-[43.2rem]:h-11 max-[43.2rem]:px-3.5 transition-[border-color,color,opacity] duration-150 ease-out outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
                shown ? "border-line-strong text-fg" : "border-line text-fg-faint opacity-60",
                shown && provider.id === OURS && "border-brand text-fg-brand",
              )}
            >
              <ProviderLogo id={provider.id} className="size-3.5" />
              {provider.name}
              <LineSwatch providerId={provider.id} />
            </button>
          );
        })}
      </div>
      <TrendChart points={inPeriod} days={days} providers={visible} activeDay={activeDay} onActiveDay={setHoveredDay} breakOnPanel={role === "control"} />
    </div>
  ) : (
    <p className="py-10 text-center text-body-sm text-fg-muted">No completed day yet.</p>
  );

  const table = (
    <div className="flex h-[420px] min-h-0 flex-col sm:h-[360px]">
      <ScrollArea>
        <DataTable
          caption="Daily useful-content rates"
          minWidth="min-w-136"
          framed={false}
          columns={[{ key: "day", label: "UTC date" }, ...providers.map((provider) => ({ key: provider.id, label: <ProviderName id={provider.id} name={provider.name} className="text-body-sm" />, align: "right" as const, highlight: provider.id === OURS }))]}
          rows={[...days].reverse().map((day) => {
            const byProvider = pointsByDay.get(day);
            const first = byProvider?.values().next().value as DailyPoint | undefined;
            return {
              key: day,
              cells: {
                day: (
                  <>
                    {shortDay(day)}
                    <CellDetail>{role === "control" ? `Panel ${first?.control_panel_version}` : role === "new" ? "New pages" : first?.sample_kind === "daily" ? "Daily" : "Earlier batches"}</CellDetail>
                  </>
                ),
                ...Object.fromEntries(
                  providers.map((provider) => {
                    const point = byProvider?.get(provider.id);
                    return [
                      provider.id,
                      <React.Fragment key={provider.id}>
                        {percent(point?.success_rate)}
                        <CellDetail>{point?.pages.toLocaleString("en-US") ?? 0} URLs</CellDetail>
                      </React.Fragment>,
                    ];
                  }),
                ),
              },
            };
          })}
        />
      </ScrollArea>
    </div>
  );

  return (
    <ReportSection
      id="trends"
      title="Quality"
      accent="over time"
      description={`One point per provider, per UTC day. ${cohort === "independent" ? "One daily sample targets 2,400 new pages and 600 controls, shared by every scraper." : "The separate search cohort samples up to 400 result slots each day."} The leaderboard above shows the latest completed daily run.`}
    >
      <div className="flex flex-col gap-4">
        <Controls>
          {cohort === "independent" && sampleRole && (
            <Choice
              label="History sampling design"
              value={earlier ? "earlier" : "current"}
              onValueChange={(value) => setEarlier(value === "earlier")}
              options={[
                { value: "current", label: `${sampleRole === "control" ? "Control" : "New"} pages` },
                { value: "earlier", label: "Earlier runs" },
              ]}
            />
          )}
          <Choice label="History period" value={period} onValueChange={setPeriod} options={PERIODS.map((value) => ({ value, label: `${value} days` }))} />
        </Controls>
        <p className="text-body-sm text-fg-muted">
          {role
            ? `Equal-category scores for ${role === "control" ? "control" : "new"} pages. Missing categories withhold the daily score.`
            : cohort === "needle"
              ? "Search results use their own page-weighted score."
              : "Earlier runs use the original page-weighted score and are kept separate from the new sampling design."}
        </p>
      </div>

      <TabbedPanel
        label="Quality over time view"
        tabs={[
          { id: "chart", label: "Chart", content: chart },
          { id: "table", label: "Table", content: table },
        ]}
      />

      <Fine>
        {days.length === 0 ? "No completed day yet. " : days.length === 1 ? "One day recorded; a trend needs more than one day. " : ""}
        Up to 90 days of completed results under the same scoring protocol. Missing days remain gaps. Control trends break when the panel version changes; fixed URLs can still change content. Earlier small batches are labeled and replaced by
        that day’s daily run once it finishes. A completed same-day replacement rerun supersedes its parent in this trend; both receipts remain available. Rates show confirmed coverage of the full sample, including unresolved and unattempted
        tests. Changes can reflect account availability and page mix as well as the provider. <TextLink href="#runs">Inspect category counts and repeated URLs</TextLink>.
      </Fine>
    </ReportSection>
  );
}
