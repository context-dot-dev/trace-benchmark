"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { percent } from "@/lib/benchmark/format";
import { ACCESS_PROTOCOL, providers, type RunSummary } from "@/lib/benchmark/types";
import { Name, integer } from "./charts";

export const patterns = ["", "8 4", "2 4", "10 3 2 3"];
export function Legend({
  active,
  onSelect,
}: {
  active?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="bench-legend">
      {providers.map((p, i) => {
        const content = (
          <>
            <svg width="26" height="8" aria-hidden="true">
              <line
                x1="0"
                x2="26"
                y1="4"
                y2="4"
                stroke={p.color}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={patterns[i]}
              />
            </svg>
            <Name id={p.id} />
          </>
        );
        return onSelect ? (
          <button
            key={p.id}
            type="button"
            aria-label={`Highlight ${p.name}`}
            aria-pressed={active === p.id}
            onClick={() => onSelect(p.id)}
          >
            {content}
          </button>
        ) : (
          <span key={p.id}>{content}</span>
        );
      })}
    </div>
  );
}
const dayMs = 86400000;
export const dateLabel = (time: number, long = false) =>
  new Date(time).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    day: "numeric",
    ...(long ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
export const scoringLabel = (protocol: string) =>
  protocol === ACCESS_PROTOCOL ? "Page access" : "Useful content";
export function historyResult(run: RunSummary, provider: string) {
  const result = run.providers.find((metric) => metric.id === provider);
  if (run.status !== "completed" || !result?.total) return "—";
  return result.rate == null
    ? `${integer(result.useful)} / ${integer(result.total)} ${run.protocol === ACCESS_PROTOCOL ? "accessed" : "useful"}`
    : percent(result.rate);
}
export function Trend({ history, filtered }: { history: RunSummary[]; filtered: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [active, setActive] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.round(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [history.length]);
  const firstDay = Date.parse(history[0]?.day ?? "1970-01-01");
  const lastDay = Date.parse(history.at(-1)?.day ?? "1970-01-01");
  const latestCompleted = history.findLast(
    (sample) => sample.status === "completed" && sample.pages > 0,
  );
  const latestSample = latestCompleted ?? history.findLast((sample) => sample.pages > 0) ?? history.at(-1);
  const defaultDay = latestSample ? Date.parse(latestSample.day) : lastDay;
  const dayCount = Math.round((lastDay - firstDay) / dayMs) + 1;
  const inspectedDay = Math.max(
    firstDay,
    Math.min(lastDay, hoveredDay ?? selectedDay ?? defaultDay),
  );
  const plotLeft = 46,
    plotRight = width - 32;
  const position = (time: number) =>
    dayCount === 1
      ? (plotLeft + plotRight) / 2
      : plotLeft +
        ((time - firstDay) * (plotRight - plotLeft)) / (lastDay - firstDay);
  const protocols = [...new Set(history.map((r) => r.protocol))];
  const latestBySample = new Map<string, RunSummary>();
  for (const sample of history) {
    const key = `${sample.day}:${sample.protocol}`;
    if (
      sample.status === "completed" ||
      latestBySample.get(key)?.status !== "completed"
    ) {
      latestBySample.set(key, sample);
    }
  }
  const daily = [...latestBySample.values()];
  const byDay = new Map<number, RunSummary[]>();
  for (const sample of daily) {
    const time = Date.parse(sample.day);
    byDay.set(time, [...(byDay.get(time) ?? []), sample]);
  }
  const runsOnDay = (time: number) => byDay.get(time) ?? [];
  const x = (r: RunSummary) => {
    const sameDay = runsOnDay(Date.parse(r.day));
    return (
      position(Date.parse(r.day)) +
      (sameDay.indexOf(r) - (sameDay.length - 1) / 2) *
        Math.min(8, ((plotRight - plotLeft) / Math.max(1, dayCount - 1)) * 0.4)
    );
  };
  const y = (value: number) => 280 - value * 240;
  const tickIntervals = width < 500 ? 3 : 6;
  const tickStep = dayCount <= 7
    ? Math.max(1, Math.ceil((dayCount - 1) / tickIntervals))
    : Math.max(1, Math.ceil((dayCount - 1) / tickIntervals / 7) * 7);
  const ticks = [firstDay];
  for (
    let t = firstDay + tickStep * dayMs;
    t < lastDay - (tickStep * dayMs) / 2;
    t += tickStep * dayMs
  )
    ticks.push(t);
  if (lastDay !== firstDay) ticks.push(lastDay);
  const pickDay = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - bounds.left) * width) / bounds.width;
    return Math.max(
      firstDay,
      Math.min(
        lastDay,
        firstDay +
          Math.round(
            ((px - plotLeft) / (plotRight - plotLeft)) * (dayCount - 1),
          ) * dayMs,
      ),
    );
  };
  if (!history.length)
    return (
      <p className="bench-notice">No historical samples are available yet.</p>
    );
  return (
    <>
      <div className="bench-history-range">
        <p>
          {dateLabel(firstDay, true)} – {dateLabel(lastDay, true)}{" "}
          <span>
            {byDay.size} sampled {byDay.size === 1 ? "day" : "days"}
          </span>
        </p>
        <Legend
          active={active}
          onSelect={(id) => setActive(active === id ? null : id)}
        />
      </div>
      <div className="bench-history" ref={container}>
        <svg
          viewBox={`0 0 ${width} 348`}
          role="slider"
          tabIndex={0}
          aria-label="History date"
          aria-describedby="history-instructions"
          aria-valuemin={0}
          aria-valuemax={dayCount - 1}
          aria-valuenow={Math.round((inspectedDay - firstDay) / dayMs)}
          aria-valuetext={`${dateLabel(inspectedDay, true)} UTC`}
          onKeyDown={(event) => {
            const next =
              event.key === "Home"
                ? firstDay
                : event.key === "End"
                  ? lastDay
                  : event.key === "ArrowLeft" || event.key === "ArrowDown"
                    ? inspectedDay - dayMs
                    : event.key === "ArrowRight" || event.key === "ArrowUp"
                      ? inspectedDay + dayMs
                      : null;
            if (next != null) {
              event.preventDefault();
              setHoveredDay(null);
              setSelectedDay(Math.max(firstDay, Math.min(lastDay, next)));
            }
          }}
          onPointerDown={(event) => {
            setHoveredDay(null);
            setSelectedDay(pickDay(event));
            event.currentTarget.focus({ preventScroll: true });
          }}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse") setHoveredDay(pickDay(event));
            else if (event.buttons === 1) setSelectedDay(pickDay(event));
          }}
          onPointerLeave={() => setHoveredDay(null)}
        >
          {[0, 25, 50, 75, 100].map((n) => (
            <g key={n}>
              <text x="0" y={y(n / 100) + 5}>
                {n}%
              </text>
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={y(n / 100)}
                y2={y(n / 100)}
              />
            </g>
          ))}
          <line
            className="bench-history-cursor"
            x1={position(inspectedDay)}
            x2={position(inspectedDay)}
            y1="35"
            y2="336"
          />
          {protocols.flatMap((protocol) =>
            providers.map((p, providerIndex) => {
              const series = daily.filter((r) => r.protocol === protocol);
              return (
                <g
                  key={`${protocol}-${p.id}`}
                  opacity={active && active !== p.id ? 0.18 : 1}
                >
                  {series.map((r, i) => {
                    const value =
                      r.status === "completed"
                        ? r.providers.find((v) => v.id === p.id)?.rate
                        : null;
                    const previous = series[i - 1];
                    const before =
                      previous?.status === "completed"
                        ? previous.providers.find((v) => v.id === p.id)?.rate
                        : null;
                    if (value == null) return null;
                    return (
                      <g key={r.id}>
                        {before != null &&
                          Date.parse(r.day) - Date.parse(previous.day) ===
                            dayMs && (
                            <line
                              x1={x(previous)}
                              x2={x(r)}
                              y1={y(before)}
                              y2={y(value)}
                              strokeLinecap="round"
                              style={{
                                stroke: p.color,
                                strokeWidth: 2,
                                strokeDasharray: patterns[providerIndex],
                              }}
                            />
                          )}
                        <circle
                          cx={x(r)}
                          cy={y(value)}
                          r={Date.parse(r.day) === inspectedDay ? 4 : 3}
                          fill={p.color}
                        >
                          <title>{`${r.day}: ${p.name} ${percent(value)}`}</title>
                        </circle>
                      </g>
                    );
                  })}
                </g>
              );
            }),
          )}
          {ticks.map((time, i) => (
            <text
              key={time}
              x={position(time)}
              y="309"
              textAnchor={
                i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"
              }
            >
              {dateLabel(time)}
            </text>
          ))}
          {Array.from({ length: dayCount }, (_, i) => {
            const time = firstDay + i * dayMs;
            const samples = runsOnDay(time);
            const scored = samples.some(
              (r) =>
                r.status === "completed" &&
                r.providers.some((p) => p.rate != null),
            );
            if (!samples.length)
              return (
                <path
                  key={time}
                  className="bench-coverage is-absent"
                  d={`M${position(time) - 3},328 l6,6 M${position(time) - 3},334 l6,-6`}
                />
              );
            return (
              <circle
                key={time}
                cx={position(time)}
                cy="331"
                r="3"
                className={`bench-coverage ${scored ? "is-scored" : "is-unscored"}`}
              />
            );
          })}
        </svg>
      </div>
      <div className="bench-history-key" aria-label="Sample coverage legend">
        <span>
          <i className="is-scored" />
          Score available
        </span>
        <span>
          <i className="is-unscored" />
          Sample without score
        </span>
        <span>
          <i className="is-absent">×</i>
          No sample
        </span>
      </div>
      <p className="bench-note" id="history-instructions">
        {filtered && !history.some((r) => r.pages > 0)
          ? history.some((r) => r.status === "unavailable")
            ? "Filtered results are unavailable for these dates."
            : "No pages match these filters."
          : latestCompleted ? "Showing the latest completed sample by default." : "No completed sample yet; showing the latest available sample."} Hover to preview a day;
        click, touch or use the arrow keys to keep it selected. Gaps are not estimated.
      </p>
      <Button variant="pill-outline" size="sm" className="mb-6" onClick={() => {
        setSelectedDay(null);
        setHoveredDay(null);
      }}>
        {latestCompleted ? "Latest completed result" : "Latest available sample"}
      </Button>
      <div
        className="bench-history-detail"
        aria-live="polite"
        aria-atomic="true"
      >
        {Array.from({ length: dayCount }, (_, index) => {
          const time = firstDay + index * dayMs;
          const samples = runsOnDay(time);
          const current = time === inspectedDay;
          return (
            <div
              key={time}
              className="bench-history-day"
              data-active={current}
              aria-hidden={!current}
            >
              <h3>
                {dateLabel(time, true)} <span>UTC</span>
              </h3>
              {!samples.length && <p>No sample was collected on this day.</p>}
              {samples.map((r) => (
                <div key={r.id} className="bench-history-sample">
                  <p>
                    {r.status === "unavailable"
                      ? "Filtered results unavailable: complete source records are unavailable."
                      : <>
                        {scoringLabel(r.protocol)} · {integer(r.pages)} pages
                        {r.pages === 0 ? filtered ? " · No pages match these filters" : " · No pages were collected" : r.status !== "completed" ? " · Collection in progress" : ""}
                      </>}
                  </p>
                  {r.status === "completed" && r.pages > 0 &&
                    r.providers.every((p) => p.rate == null) && (
                      <p>
                        This sample does not cover every category, so no overall score is reported.
                        The results below show {r.protocol === ACCESS_PROTOCOL ? "accessed" : "useful"} pages out of all pages tested.
                      </p>
                    )}
                  <dl>
                    {providers.map((p) => (
                      <div key={p.id}>
                        <dt>
                          <Name id={p.id} />
                        </dt>
                        <dd style={{ color: p.color }}>
                          {historyResult(r, p.id)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
