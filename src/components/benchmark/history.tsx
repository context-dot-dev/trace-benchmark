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
  solid = false,
}: {
  active?: string | null;
  onSelect?: (id: string) => void;
  solid?: boolean;
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
                strokeDasharray={solid ? undefined : patterns[i]}
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
  // Leave room on the right to label each line with its latest score, plus
  // the provider name when there is space for it.
  const namedLabels = width >= 640;
  const plotLeft = 46,
    plotRight = width - (namedLabels ? 150 : 62);
  const position = (time: number) =>
    dayCount === 1
      ? (plotLeft + plotRight) / 2
      : plotLeft +
        ((time - firstDay) * (plotRight - plotLeft)) / (lastDay - firstDay);
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
  // Runs may be weekly or occasional: every interaction snaps to a sampled day.
  const sampledDays = [...byDay.keys()].sort((a, b) => a - b);
  const nearestSampledDay = (time: number) =>
    sampledDays.reduce(
      (best, day) => (Math.abs(day - time) < Math.abs(best - time) ? day : best),
      sampledDays[0] ?? firstDay,
    );
  const inspectedDay = nearestSampledDay(hoveredDay ?? selectedDay ?? defaultDay);
  const inspectedIndex = sampledDays.indexOf(inspectedDay);
  // One continuous line per provider through every scored sample, whatever
  // the gap between runs. A day with several samples uses its latest score.
  const scoreOn = (time: number, provider: string) => {
    for (const run of runsOnDay(time).toReversed()) {
      const rate =
        run.status === "completed"
          ? run.providers.find((metric) => metric.id === provider)?.rate
          : null;
      if (rate != null) return rate;
    }
    return null;
  };
  const series = providers.map((provider) => ({
    provider,
    points: sampledDays.flatMap((time) => {
      const value = scoreOn(time, provider.id);
      return value == null ? [] : [{ time, value }];
    }),
  }));
  const unscoredDays = sampledDays.filter((time) =>
    providers.every((provider) => scoreOn(time, provider.id) == null),
  );
  // Zoom the score axis to the observed range so close results stay legible.
  const scores = daily.flatMap((r) =>
    r.status === "completed"
      ? r.providers.flatMap((p) => (p.rate == null ? [] : [p.rate * 100]))
      : [],
  );
  const lowestScore = scores.length ? Math.min(...scores) : 0;
  const yStep = 100 - lowestScore <= 40 ? 10 : 25;
  const yFloor = Math.max(0, Math.floor((lowestScore - 2) / yStep) * yStep);
  const yTicks = Array.from(
    { length: (100 - yFloor) / yStep + 1 },
    (_, i) => yFloor + i * yStep,
  );
  const y = (value: number) =>
    280 - ((value * 100 - yFloor) / (100 - yFloor)) * 240;
  // Latest score labels at the right edge, nudged apart so they never overlap.
  const endLabels = series
    .filter(({ points }) => points.length)
    .map(({ provider, points }) => ({
      provider,
      value: points.at(-1)!.value,
      y: y(points.at(-1)!.value),
    }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++)
    endLabels[i].y = Math.max(endLabels[i].y, endLabels[i - 1].y + 18);
  const labelOverflow = (endLabels.at(-1)?.y ?? 0) - 280;
  if (labelOverflow > 0) for (const label of endLabels) label.y -= labelOverflow;
  const chartTop = 24;
  const chartHeight = unscoredDays.length ? 348 : 326;
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
    return nearestSampledDay(
      firstDay +
        ((px - plotLeft) / (plotRight - plotLeft)) * (lastDay - firstDay),
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
          solid
          active={active}
          onSelect={(id) => setActive(active === id ? null : id)}
        />
      </div>
      <div className="bench-history" ref={container}>
        <svg
          viewBox={`0 ${chartTop} ${width} ${chartHeight - chartTop}`}
          role="slider"
          tabIndex={0}
          aria-label="History date"
          aria-describedby="history-instructions"
          aria-valuemin={0}
          aria-valuemax={sampledDays.length - 1}
          aria-valuenow={inspectedIndex}
          aria-valuetext={`${dateLabel(inspectedDay, true)} UTC`}
          onKeyDown={(event) => {
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? sampledDays.length - 1
                  : event.key === "ArrowLeft" || event.key === "ArrowDown"
                    ? Math.max(0, inspectedIndex - 1)
                    : event.key === "ArrowRight" || event.key === "ArrowUp"
                      ? Math.min(sampledDays.length - 1, inspectedIndex + 1)
                      : null;
            if (index != null) {
              event.preventDefault();
              setHoveredDay(null);
              setSelectedDay(sampledDays[index]);
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
          {yTicks.map((n) => (
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
            y1="40"
            y2="280"
          />
          {series.map(({ provider, points }) => (
            <g
              key={provider.id}
              className="bench-history-series"
              opacity={active && active !== provider.id ? 0.18 : 1}
            >
              <path
                d={points
                  .map(({ time, value }, i) =>
                    `${i ? "L" : "M"}${position(time)},${y(value)}`,
                  )
                  .join(" ")}
                style={{ stroke: provider.color }}
              />
              {points.map(({ time, value }) => (
                <circle
                  key={time}
                  cx={position(time)}
                  cy={y(value)}
                  r={time === inspectedDay ? 4.5 : 2.75}
                  fill={provider.color}
                >
                  <title>{`${dateLabel(time, true)}: ${provider.name} ${percent(value)}`}</title>
                </circle>
              ))}
            </g>
          ))}
          {endLabels.map(({ provider, value, y: labelY }) => (
            <text
              key={provider.id}
              className="bench-history-end"
              x={plotRight + 10}
              y={labelY + 5}
              opacity={active && active !== provider.id ? 0.18 : 1}
              style={{ fill: provider.color }}
            >
              {namedLabels && (
                <tspan className="bench-history-end-name">{provider.name} </tspan>
              )}
              {percent(value)}
            </text>
          ))}
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
          {unscoredDays.length > 0 && (
            <>
              <line
                className="bench-coverage-track"
                x1={plotLeft}
                x2={plotRight}
                y1="331"
                y2="331"
              />
              {sampledDays.map((time) => (
                <circle
                  key={time}
                  cx={position(time)}
                  cy="331"
                  r="3"
                  className={`bench-coverage ${unscoredDays.includes(time) ? "is-unscored" : "is-scored"}`}
                />
              ))}
            </>
          )}
        </svg>
      </div>
      {unscoredDays.length > 0 && (
        <div className="bench-history-key" aria-label="Sample coverage legend">
          <span>
            <i className="is-scored" />
            Score available
          </span>
          <span>
            <i className="is-unscored" />
            Sample without score
          </span>
        </div>
      )}
      <p className="bench-note" id="history-instructions">
        {filtered && !history.some((r) => r.pages > 0)
          ? history.some((r) => r.status === "unavailable")
            ? "Filtered results are unavailable for these dates."
            : "No pages match these filters."
          : latestCompleted ? "Showing the latest completed sample by default." : "No completed sample yet; showing the latest available sample."} Hover to preview a sample;
        click, touch or use the arrow keys to keep it selected. Lines join consecutive samples; days without a sample are not estimated.
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
        {sampledDays.map((time) => {
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
