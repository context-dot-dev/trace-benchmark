"use client";

import * as React from "react";

import { percent, shortDay } from "@/lib/trace/format";
import type { DailyPoint } from "@/lib/trace/types";
import { cn } from "@/lib/utils";

import { AXIS_TITLE, MONO, useElementWidth } from "./chart-utils";
import { OURS } from "./provider-logo";

const HEIGHT = 280;
const LEFT = 44;
const RIGHT = 12;
const TOP = 12;
const BOTTOM = 36;
const DAY_MS = 86_400_000;
const MIN_LABEL_GAP = 56;

// Context's line is solid brand blue with solid dots; the others share one neutral and are told apart by their dash and
// their logo in the legend, never by color.
const LINE_DASH: Record<string, string | undefined> = { exa: "6 4", keenable: "1.5 3.5", firecrawl: "10 3 2 3" };

export type TrendProvider = { id: string; name: string };

/** Splits a provider's days into runs of consecutive days, so a missing day stays a gap (and a control panel change a break). */
function segments(points: DailyPoint[], breakOnPanel: boolean) {
  const runs: DailyPoint[][] = [];
  for (const point of points) {
    const previous = runs.at(-1)?.at(-1);
    if (!previous || Date.parse(point.day) - Date.parse(previous.day) > DAY_MS || (breakOnPanel && point.control_panel_version !== previous.control_panel_version)) runs.push([]);
    runs.at(-1)!.push(point);
  }
  return runs;
}

export function TrendChart({
  points,
  days,
  providers,
  activeDay,
  onActiveDay,
  breakOnPanel,
}: {
  points: DailyPoint[];
  days: string[];
  providers: TrendProvider[];
  activeDay: string | undefined;
  onActiveDay: (day: string | null) => void;
  breakOnPanel: boolean;
}) {
  const { ref, width: measured, measured: hasMeasured } = useElementWidth<HTMLDivElement>(640);
  const width = Math.max(260, measured);
  const right = width - RIGHT;
  const first = Date.parse(days[0]);
  const last = Date.parse(days.at(-1)!);
  const x = (day: string) => (first === last ? (LEFT + right) / 2 : LEFT + ((Date.parse(day) - first) / (last - first)) * (right - LEFT));
  const y = (rate: number) => TOP + (1 - rate) * (HEIGHT - TOP - BOTTOM);
  const labelEvery = Math.max(1, Math.ceil(days.length / (width < 450 ? 3 : 6)));
  const candidates = days.filter((_, index) => index === 0 || index === days.length - 1 || index % labelEvery === 0);
  // The last day is always labeled, so an interval label that would crowd it gives way.
  const dayLabels = candidates.filter((day, index) => index === candidates.length - 1 || x(candidates.at(-1)!) - x(day) >= MIN_LABEL_GAP);
  const ordered = [...providers].sort((a, b) => (a.id === OURS ? 1 : b.id === OURS ? -1 : 0));
  const [hint, setHint] = React.useState<{ day: string; left: number } | null>(null);
  const showDayHint = (day: string) => {
    const renderedWidth = hasMeasured ? measured : width;
    const tipHalfWidth = Math.min(88, Math.max(0, (renderedWidth - 16) / 2));
    const minLeft = tipHalfWidth + 8;
    const maxLeft = renderedWidth - tipHalfWidth - 8;
    const renderedX = x(day) * (renderedWidth / width);
    setHint({ day, left: Math.max(minLeft, Math.min(maxLeft, renderedX)) });
    onActiveDay(day);
  };
  const selectNearestDay = (clientX: number, svg: SVGSVGElement) => {
    if (!days.length) return;
    const bounds = svg.getBoundingClientRect();
    const position = ((clientX - bounds.left) / bounds.width) * width;
    const day = days.reduce((closest, candidate) => (Math.abs(x(candidate) - position) < Math.abs(x(closest) - position) ? candidate : closest), days[0]);
    showDayHint(day);
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="group"
        aria-label={`Daily useful-content rate for ${days.length} recorded UTC days. Exact values are in the Table view.`}
        className="block w-full overflow-visible"
        onPointerMove={(event) => selectNearestDay(event.clientX, event.currentTarget)}
        onPointerLeave={() => {
          setHint(null);
          onActiveDay(null);
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line x1={LEFT} x2={right} y1={y(tick)} y2={y(tick)} className="stroke-rule" strokeWidth={1} strokeDasharray={tick === 0 ? undefined : "2 4"} />
            <text x={LEFT - 8} y={y(tick) + 4} textAnchor="end" className="fill-fg-muted font-mono text-axis tabular-nums">
              {tick * 100}%
            </text>
          </g>
        ))}
        {days.filter((day) => {
          const collected = points.filter((point) => point.day === day);
          return collected.length > 0 && collected.every((point) => point.success_rate === null && point.pages > 0);
        }).map((day) => (
          <rect key={`withheld:${day}`} x={Math.max(LEFT, x(day) - 6)} y={TOP} width={Math.min(12, right - Math.max(LEFT, x(day) - 6))} height={HEIGHT - TOP - BOTTOM}
            className="fill-fg-faint/15 outline-none focus-visible:stroke-focus-ring" tabIndex={0} role="button"
            aria-label={`${shortDay(day)}: pages collected; balanced score withheld because categories are missing`}
            onFocus={() => showDayHint(day)} onClick={() => showDayHint(day)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showDayHint(day); } }}>
            <title>{`${shortDay(day)}: pages collected; score withheld`}</title>
          </rect>
        ))}
        {dayLabels.map((day) => (
          <text key={day} x={x(day)} y={HEIGHT - 12} textAnchor="middle" className={cn("fill-fg-muted text-axis", MONO)}>
            {shortDay(day)}
          </text>
        ))}
        {activeDay && <line x1={x(activeDay)} x2={x(activeDay)} y1={TOP} y2={HEIGHT - BOTTOM} className="stroke-line-strong" strokeWidth={1} />}
        {ordered.map((provider) => {
          const ours = provider.id === OURS;
          const series = points.filter((point) => point.provider === provider.id && point.success_rate !== null).sort((a, b) => a.day.localeCompare(b.day));
          return (
            <g key={provider.id} className={ours ? "text-brand" : "text-fg-secondary"}>
              {segments(series, breakOnPanel).map((run, index) => (
                <polyline
                  key={index}
                  points={run.map((point) => `${x(point.day)},${y(point.success_rate!)}`).join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeDasharray={ours ? undefined : LINE_DASH[provider.id]}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {series.map((point) => {
                const active = point.day === activeDay;
                return (
                  <circle
                    key={point.day}
                    cx={x(point.day)}
                    cy={y(point.success_rate!)}
                    r={active ? 4.5 : 3}
                    tabIndex={0}
                    role="button"
                    aria-label={`${shortDay(point.day)}, ${provider.name}: ${percent(point.success_rate)}, ${point.pages.toLocaleString("en-US")} URLs`}
                    onFocus={() => showDayHint(point.day)}
                    onPointerEnter={() => showDayHint(point.day)}
                    onClick={() => showDayHint(point.day)}
                    className={cn("cursor-pointer outline-none focus-visible:stroke-focus-ring focus-visible:stroke-2", ours ? "fill-brand" : "fill-surface stroke-fg-secondary")}
                    strokeWidth={ours ? 0 : 1.5}
                  >
                    <title>{`${provider.name}: ${percent(point.success_rate)} · ${point.pages.toLocaleString("en-US")} URLs · ${point.day}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
      {hint && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-2 z-50 box-border w-[min(11rem,calc(100%_-_1rem))] -translate-x-1/2 rounded-card bg-surface px-3 py-2 text-left shadow-floating ring-1 ring-hairline"
          style={{ left: hint.left }}
        >
          <p className="mb-1 font-mono text-caption text-fg-muted">{shortDay(hint.day)}</p>
          <ul className="flex flex-col gap-1">
            {providers.map((provider) => {
              const point = points.find((candidate) => candidate.day === hint.day && candidate.provider === provider.id);
              return (
                <li key={provider.id} className="flex items-center justify-between gap-2 text-caption">
                  <span className={cn("min-w-0 break-words", provider.id === OURS ? "text-fg-brand" : "text-fg-muted")}>{provider.name}</span>
                  <span className="shrink-0 font-mono text-body-sm font-medium tabular-nums text-fg">{point && point.success_rate === null && point.pages > 0 ? "Withheld" : percent(point?.success_rate)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className={cn("mt-1 text-center", AXIS_TITLE)}>UTC day</p>
    </div>
  );
}

export function LineSwatch({ providerId }: { providerId: string }) {
  const ours = providerId === OURS;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 8" className={cn("h-2 w-6 shrink-0", ours ? "text-brand" : "text-fg-secondary")}>
      <line x1="1" x2="23" y1="4" y2="4" stroke="currentColor" strokeWidth={2} strokeDasharray={ours ? undefined : LINE_DASH[providerId]} strokeLinecap="round" />
    </svg>
  );
}
