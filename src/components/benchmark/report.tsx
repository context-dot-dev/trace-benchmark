"use client";

import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Surface } from "@/lib/surface";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContextMark, ProviderName } from "@/components/trace/provider-logo";
import { CodeBlock, CodeWindow } from "@/components/site/code-window";
import { percent } from "@/lib/benchmark/format";
import { Hero } from "@/components/site/hero";
import { SiteHeader } from "@/components/site/site-header";
import { SiteSection, SectionHeading, SectionHeaderRule } from "@/components/site/section";
import { HeroDotField } from "@/components/visuals/hero-dot-field";
import {
  benchmarkCategories,
  scorePages,
  uniquePages,
  type BenchmarkDataset,
} from "@/lib/benchmark/combined";
import { ThemeToggle } from "@/components/trace/theme-toggle";
import { BenchmarkSources } from "./sources";
import {
  categories,
  providers,
  PROTOCOL,
  type ProviderMetric,
  type RunSummary,
} from "@/lib/benchmark/types";

const integer = (value: number) => value.toLocaleString("en-US");
function Name({ id }: { id: string }) {
  return (
    <ProviderName
      id={id}
      name={providers.find((p) => p.id === id)?.name ?? id}
    />
  );
}
function Table({
  headers,
  rows,
  label,
}: {
  headers: string[];
  rows: { id: string; cells: ReactNode[] }[];
  label: string;
}) {
  return (
    <div className="bench-scroll" tabIndex={0} role="region" aria-label={label}>
      <table>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {row.cells.map((cell, j) =>
                j === 0 ? (
                  <th key={headers[j]} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={headers[j]} data-label={headers[j]}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Section({
  id,
  accent,
  title,
  note,
  chart,
  table,
}: {
  id: string;
  accent: string;
  title: string;
  note: string;
  chart: ReactNode;
  table: ReactNode;
}) {
  return (
    <SiteSection id={id} lines className="bench-section">
      <Tabs defaultValue="chart">
        <SectionHeading
          title={title.slice(0, -accent.length).trimEnd()}
          accent={accent}
          description={note}
        />
        <SectionHeaderRule />
        <TabsList variant="segmented" aria-label={`${title} view`}>
          <TabsTrigger value="chart">Chart</TabsTrigger>
          <TabsTrigger value="table">Table</TabsTrigger>
        </TabsList>
        <TabsContent value="chart">{chart}</TabsContent>
        <TabsContent value="table">{table}</TabsContent>
      </Tabs>
    </SiteSection>
  );
}
const patterns = ["", "8 4", "2 4", "10 3 2 3"];
function Legend({
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

function Bars({ rows }: { rows: ProviderMetric[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(30);

  useEffect(() => {
    if (!track.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setColumns(Math.max(1, Math.floor(entry.contentRect.width / 12))),
    );
    observer.observe(track.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="bench-bars"
      role="img"
      aria-label={rows.map((r) => `${r.id}: ${percent(r.rate)}`).join(", ")}
    >
      <div className="bench-axis">
        <span>0%</span>
        <span>100%</span>
      </div>
      {providers.map((p, index) => {
        const value = rows.find((r) => r.id === p.id)?.rate;
        const filled = Math.round((value ?? 0) * columns);
        return (
          <div className="bench-bar-row" key={p.id}>
            <Name id={p.id} />
            <div
              ref={index === 0 ? track : undefined}
              className="bench-track"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              aria-hidden="true"
            >
              {Array.from({ length: columns * 2 }, (_, cell) => (
                <span className="meter-cell" key={cell}>
                  <span
                    className="meter-dot"
                    style={Math.floor(cell / 2) < filled
                      ? { backgroundColor: p.color, borderColor: p.color }
                      : undefined}
                  />
                </span>
              ))}
            </div>
            <strong data-score={p.id}>{percent(value)}</strong>
          </div>
        );
      })}
    </div>
  );
}
function categoryRate(row: ProviderMetric | undefined, category: string) {
  const group = row?.categories[category];
  return group?.total && group.completed ? group.useful / group.total : null;
}
function Radar({
  rows,
  chartCategories,
}: {
  rows: ProviderMetric[];
  chartCategories: { id: string; name: string }[];
}) {
  const [active, setActive] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.round(entry.contentRect.width))),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const radius = Math.max(40, width / 2 - (width < 500 ? 104 : 96));
  const height = radius * 2 + 128;
  const cx = width / 2,
    cy = height / 2;
  const point = (i: number, value: number, extra = 0) => {
    const angle = (i * 2 * Math.PI) / chartCategories.length - Math.PI / 2;
    return [
      cx + Math.cos(angle) * (radius * value + extra),
      cy + Math.sin(angle) * (radius * value + extra),
    ];
  };
  const shortNames: Record<string, string[]> = {
    legal_regulatory: ["Legal"],
    software_docs: ["Docs"],
    arts_sports_reference: ["Arts &", "reference"],
  };
  const labels = chartCategories.map((c) => shortNames[c.id] ?? [c.name]);
  return (
    <>
      <Legend
        active={active}
        onSelect={(id) => setActive(active === id ? null : id)}
      />
      <div className="bench-radar" ref={container}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Useful content by category from zero to 100 percent; exact values and page counts are available in the table"
        >
          {[0.25, 0.5, 0.75, 1].map((value) => (
            <polygon
              key={value}
              points={chartCategories
                .map((_, i) => point(i, value).join(","))
                .join(" ")}
              className="bench-radar-grid"
            />
          ))}
          {chartCategories.map((category, i) => {
            const [x, y] = point(i, 1),
              [lx, ly] = point(i, 1, 20);
            return (
              <g key={category.id}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={x}
                  y2={y}
                  className="bench-radar-grid"
                />
                <text
                  x={lx}
                  y={ly}
                  textAnchor={
                    Math.abs(lx - cx) < 1 ? "middle" : lx > cx ? "start" : "end"
                  }
                  dominantBaseline="middle"
                >
                  {labels[i].map((label, j) => (
                    <tspan
                      key={label}
                      x={lx}
                      dy={j ? 16 : labels[i].length > 1 ? -8 : 0}
                    >
                      {label}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
          {providers.map((p, providerIndex) => {
            const row = rows.find((r) => r.id === p.id);
            const values = chartCategories.map((c) => categoryRate(row, c.id));
            return (
              <g key={p.id} opacity={active && active !== p.id ? 0.2 : 1}>
                {values.map((value, i) => {
                  if (value == null) return null;
                  const next = values[(i + 1) % values.length];
                  const [x, y] = point(i, value),
                    [nx, ny] = point((i + 1) % values.length, next ?? 0);
                  return (
                    <g key={chartCategories[i].id}>
                      {next != null && (
                        <line
                          x1={x}
                          y1={y}
                          x2={nx}
                          y2={ny}
                          stroke={p.color}
                          strokeWidth="2"
                          strokeDasharray={patterns[providerIndex]}
                        />
                      )}
                      <circle cx={x} cy={y} r="3" fill={p.color}>
                        <title>{`${p.name}, ${chartCategories[i].name}: ${percent(value)} (${integer(row?.categories[chartCategories[i].id]?.total ?? 0)} pages)`}</title>
                      </circle>
                    </g>
                  );
                })}
              </g>
            );
          })}
          {(width < 500 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map(
            (value) => (
              <text
                key={value}
                x={cx + 8}
                y={cy - radius * value + 4}
                textAnchor="start"
                className="bench-radar-scale"
              >
                {Math.round(value * 100)}%
              </text>
            ),
          )}
        </svg>
      </div>
    </>
  );
}
const dayMs = 86400000;
const dateLabel = (time: number, long = false) =>
  new Date(time).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    day: "numeric",
    ...(long ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
const protocolLabel = (protocol: string) =>
  `Protocol ${protocol.match(/v\d+$/)?.[0] ?? protocol}`;
function historyResult(run: RunSummary, provider: string) {
  const result = run.providers.find((metric) => metric.id === provider);
  if (run.status !== "completed" || !result?.total) return "—";
  return result.rate == null
    ? `${integer(result.useful)} / ${integer(result.total)} useful`
    : percent(result.rate);
}
function Trend({ history }: { history: RunSummary[] }) {
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
  const tickStep = Math.max(
    1,
    Math.ceil((dayCount - 1) / (width < 500 ? 3 : 6) / 7) * 7,
  );
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
          {protocols.map((protocol, i) => {
            const start = Date.parse(
              daily.find((r) => r.protocol === protocol)!.day,
            );
            return (
              <g key={protocol}>
                <text
                  x={i === 0 ? plotLeft : position(start) + 5}
                  y="18"
                  textAnchor="start"
                >
                  {i === 0
                    ? protocolLabel(protocol)
                    : (protocol.match(/v\d+$/)?.[0] ?? protocol)}
                </text>
                {i > 0 && (
                  <line
                    className="bench-protocol-boundary"
                    x1={position(start)}
                    x2={position(start)}
                    y1="25"
                    y2="290"
                  />
                )}
              </g>
            );
          })}
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
                          <title>{`${r.day} · ${r.protocol}: ${p.name} ${percent(value)}`}</title>
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
        {latestCompleted ? "Showing the latest completed sample by default." : "No completed sample yet; showing the latest available sample."} Hover to preview a day;
        click, touch or use the arrow keys to keep it selected. Gaps are not estimated.
      </p>
      <Button variant="outline" className="mb-6" onClick={() => {
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
                    {protocolLabel(r.protocol)} · {integer(r.pages)} pages
                    {r.pages === 0 ? " · No pages were collected" : r.status !== "completed" ? " · Collection in progress" : ""}
                  </p>
                  {r.status === "completed" &&
                    r.providers.every((p) => p.rate == null) && (
                      <p>
                        This sample does not cover every category, so no overall score is reported.
                        The results below show useful pages out of all pages tested.
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
const citation = `@misc{scrapingbench2026,
  author = {{Context.dev}},
  title = {{Scraping Bench}: A Live Scraping Benchmark},
  year = {2026},
  url = {https://trace-benchmark-contextdev.vercel.app/}
}`;
function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; description?: string }[];
}) {
  return (
    <div className="sample-filter">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange} options={options} label={label} appearance="field" />
    </div>
  );
}
export function BenchmarkReport({ initial }: { initial: BenchmarkDataset }) {
  const [dataset, setDataset] = useState(initial);
  const [selection, setSelection] = useState("latest");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [validation, setValidation] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const data = dataset.report;
  const run = data.latest;
  useEffect(() => {
    if (copyStatus !== "Copied") return;
    const timer = setTimeout(() => setCopyStatus(""), 2000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  useEffect(() => {
    const controller = new AbortController();
    function refresh() {
      setLoading(true);
      return fetch(
        `/api/benchmark?${new URLSearchParams({ run: selection === "latest" ? "" : selection })}`,
        { signal: controller.signal },
      )
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              "Results could not be refreshed. The last successful sample is still shown.",
            );
          }
          return response.json() as Promise<BenchmarkDataset>;
        })
        .then((next) => {
          if (!controller.signal.aborted) {
            setDataset(next);
            setError("");
          }
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted) {
            setError(
              e instanceof Error ? e.message : "Results could not be refreshed.",
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 900000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [selection]);
  const selected = uniquePages(
    dataset.pages.filter(
      (p) =>
        (source === "all" || (source === "daily" ? p.source !== "wikipedia" : p.source === source)) &&
        (category === "all" || p.category === category) &&
        (validation === "all" ||
          (validation === "hard"
            ? p.screened
            : p.audit === "reference_checked")),
    ),
  );
  const observedCategories = [...new Set(selected.map((p) => p.category))];
  const categoryIds =
    source === "daily" &&
    category === "all" &&
    validation === "all"
      ? [...categories.map((c) => c.id), ...(observedCategories.includes("other") ? ["other"] : [])]
      : observedCategories;
  const rows = scorePages(selected, categoryIds);
  const pending = rows.reduce((sum, r) => sum + r.pending, 0);
  const unknown = rows.reduce((sum, r) => sum + r.unknown, 0);
  const chartCategories = benchmarkCategories.filter((c) =>
    categoryIds.includes(c.id),
  );
  const history = [...data.history]
    .reverse()
    .sort((a, b) => a.day.localeCompare(b.day));
  const dailyCount = selected.filter((p) => p.source !== "wikipedia").length;
  const retainedDaily = dataset.pages.filter(
    (p) => p.source !== "wikipedia",
  ).length;
  const wikiCount = selected.filter((p) => p.source === "wikipedia").length;
  const categoryTable = (
    <Table
      label="Category results"
      headers={["Category", "Pages", ...providers.map((p) => p.name)]}
      rows={chartCategories.map((c) => ({ id: c.id, cells: [
        c.name,
        integer(selected.filter((p) => p.category === c.id).length),
        ...providers.map((p) =>
          percent(
            categoryRate(
              rows.find((r) => r.id === p.id),
              c.id,
            ),
          ),
        ),
      ] }))}
    />
  );
  function reset() {
    setSource("all");
    setCategory("all");
    setValidation("all");
  }
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            scoring:
              "The score averages the useful-page rate of each represented category, giving every category equal weight. Failed, unresolved, and pending results remain in the page counts.",
            filters: { source, category, validation },
            dailyRun: run?.id,
            scores: rows,
            pages: selected,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "scraping-bench-filtered.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Surface kind="site" className="bench-page">
      <SiteHeader
        logo={<ContextMark />}
        wordmark="Scraping Bench"
        logoHref="/"
        logoLabel="Scraping Bench"
        className="data-[scrolled=false]:bg-surface max-[879px]:bg-surface max-[879px]:data-[scrolled=true]:border-b max-[879px]:data-[scrolled=true]:border-hairline"
        items={[
          { label: "Sources", href: "#sources" },
          { label: "Methodology", href: "#methodology" },
          { label: "Citation", href: "#citation" },
          { label: "GitHub ↗", href: "https://github.com/context-dot-dev/trace-benchmark" },
        ]}
        endAction={<ThemeToggle />}
      />
      <main id="main">
        <Hero
          id="overview"
          title="How reliably can web scrapers read a page?"
          accent="read a page?"
          description="We ask Context, Exa, Firecrawl, and Keenable to retrieve the same web pages, then check whether each response contains meaningful content from the requested page. The results show how reliably each provider handles different kinds of websites."
          background={<HeroDotField fine streams miniStreams className="max-[43.2rem]:[mask-image:linear-gradient(to_bottom,var(--ds-color-black)_0,var(--ds-color-black)_8%,transparent_15%,transparent_88%,var(--ds-color-black)_97%)]" />}
          contentClassName="min-h-0 gap-8 pt-14 pb-16 sm:pt-20 sm:pb-20 lg:pt-24 lg:pb-24"
          actions={<a href="#sources" className="inline-flex min-h-11 items-center justify-center rounded-pill border border-primary bg-primary px-6 py-3 text-body text-on-primary transition-colors hover:bg-primary-hover">See where the pages come from</a>}
        />
        <div id="results" aria-busy={loading}>
        <SiteSection id="sample" lines>
        <div className="sample-filters" aria-label="Benchmark filters">
          <Filter
            label="Source"
            value={source}
            onChange={setSource}
            options={[
              { value: "all", label: "All sources" },
              { value: "daily", label: "Daily web sample" },
              { value: "wikipedia_daily", label: "Daily Wikipedia discoveries" },
              { value: "wikipedia", label: "Original Wikipedia study (Oct 29)" },
            ]}
          />
          <Filter
            label="Category"
            value={category}
            onChange={setCategory}
            options={[
              { value: "all", label: "All categories" },
              ...benchmarkCategories.map((c) => ({
                value: c.id,
                label: c.name,
              })),
            ]}
          />
          <Filter
            label="Validation"
            value={validation}
            onChange={setValidation}
            options={[
              { value: "all", label: "All pages" },
              { value: "hard", label: "Screened hard candidates" },
              { value: "reference", label: "Reference checked" },
            ]}
          />
        </div>
        <div className="mt-6">
          {(source === "all" || source === "daily") && (
            <p className="bench-note">
              Each day, we find pages through publisher feeds that announce new
              articles, public databases that list records such as company filings
              and job openings, and sitemaps that list a website’s pages.
            </p>
          )}
          {source !== "wikipedia" && (
            <p className="bench-note">
              Before building each daily sample, we check the previous day’s
              English Wikipedia edits for new external links. All four providers
              then retrieve the previously untested pages in that sample.
            </p>
          )}
          {source === "wikipedia" && (
            <p className="bench-note">
              The original 1,041-page Wikipedia study from October 29 remains
              available alongside the daily results as a separate historical sample.
            </p>
          )}
          <p className="bench-note">
            <a href="#sources">Explore the sources and example pages</a>.
          </p>
        </div>
        <div className="bench-sample">
          <p aria-live="polite">
            {source !== "wikipedia" && (run ? (
              <>
                Daily sample: <strong>{run.day}</strong> UTC
              </>
            ) : (
              "No daily sample available"
            ))}
            {source === "all" && (
              <> · <a href="#wikipedia" onClick={() => {
                const archive = document.querySelector<HTMLDetailsElement>("#wikipedia");
                if (archive) archive.open = true;
              }}>Includes archived results</a></>
            )}
            {source === "wikipedia" && "Original Wikipedia study: October 29, 2026"}
            {loading && " · Updating…"}
          </p>
          <div className="sample-actions">
            <Select
              value={selection}
              onValueChange={setSelection}
              disabled={source === "wikipedia"}
              label="Sample date (UTC)"
              className="rounded-pill px-5"
              icon={
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M16 3v4M8 3v4M3 11h18" />
                </svg>
              }
              options={[
                { value: "latest", label: "Latest completed sample" },
                ...data.history.map((run) => ({
                  value: run.id,
                  label: run.day,
                  description: `${run.protocol}${run.status !== "completed" ? " · In progress" : ""}`,
                })),
              ]}
            />
            <Button variant="outline-brand" className="rounded-pill px-5" aria-label="Reset filters" onClick={reset}>
              Reset filters
            </Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="bench-notice">
            {error}
          </p>
        )}
        {run && source !== "wikipedia" && retainedDaily < run.pages && (
          <p className="bench-notice" role="status" data-retention-notice>
            Only {integer(retainedDaily)} of {integer(run.pages)} daily page
            records are available for {run.day}. Individual records expire after
            30 days. The filters and scores below use available records only;
            original daily scores remain in the history.
          </p>
        )}
          <dl className="sample-metrics" aria-live="polite">
            <div>
              <dt>Pages in sample</dt>
              <dd data-sample-count>{integer(selected.length)}</dd>
            </div>
            <div>
              <dt>Daily pages</dt>
              <dd>{integer(dailyCount)}</dd>
            </div>
            <div>
              <dt>Archived pages</dt>
              <dd>{integer(wikiCount)}</dd>
            </div>
            <div>
              <dt>Categories represented</dt>
              <dd>{integer(observedCategories.length)}</dd>
            </div>
          </dl>
          {validation !== "all" && (
            <p className="bench-notice">
              {validation === "hard"
                ? "This subset was selected using provider failures and is not an unbiased ranking. Independent validation is incomplete."
                : "Five pages were reference checked against visible article bodies or public abstracts. This small subset is not representative."}{" "}
              Daily pages have not been independently screened and are excluded.
            </p>
          )}
        </SiteSection>
          {source === "wikipedia_daily" && selected.length === 0 && (
            <p className="bench-column bench-note" role="status">
              No daily Wikipedia pages match this sample and these filters.
              Choose another sample date to see available results.
            </p>
          )}
          <Section
            id="useful-content"
            accent="useful content"
            title="Pages with useful content"
            note="The score summarizes how often each provider returned meaningful content from the requested pages. Every provider is tested on the same selected pages."
            chart={<Bars rows={rows} />}
            table={
              <Table
                label="Useful content results"
                headers={[
                  "Provider",
                  "Useful",
                  "Not useful",
                  "Unresolved",
                  "Pending",
                  "Score",
                ]}
                rows={rows.map((r) => ({ id: r.id, cells: [
                  <Name key={r.id} id={r.id} />,
                  integer(r.useful),
                  integer(r.failed),
                  integer(r.unknown),
                  integer(r.pending),
                  percent(r.rate),
                ] }))}
              />
            }
          />
          <div className="bench-column bench-support">
            <p className="bench-note">
              Context runs this benchmark and is one of the providers tested. See
              the <a href="#methodology">methodology</a> for scoring rules and limitations.
            </p>
            {pending > 0 && (
              <p className="bench-note" role="status">
                Results for this selection are still being collected.
              </p>
            )}
          </div>
          <Section
            id="categories"
            accent="category"
            title="Results by category"
            note="Compare how reliably each provider returns content from different kinds of pages, including news articles, research papers, and product listings."
            chart={
              chartCategories.length >= 3 ? (
                <Radar rows={rows} chartCategories={chartCategories} />
              ) : (
                categoryTable
              )
            }
            table={categoryTable}
          />
          <div className="bench-section-head bench-column bench-download">
            <p className="bench-note">
              {integer(selected.length)} pages match these filters. Downloads
              include source, protocol, original grades and review notes.
            </p>
            <Button
              variant="outline"
              className="sample-download"
              data-download-results
              onClick={download}
            >
              Download filtered results ↓
            </Button>
          </div>
        </div>
        <Section
          id="history"
          accent="over time"
          title="Daily quality over time"
          note="Follow each provider’s results as we test a new sample of web pages each day. This chart shows the daily collection and does not include the fixed Wikipedia sample."
          chart={<Trend history={history} />}
          table={
            <Table
              label="Daily quality history"
              headers={[
                "Date (UTC)",
                "Protocol",
                "Status",
                "Pages",
                ...providers.map((p) => p.name),
              ]}
              rows={data.history.map((r) => ({ id: r.id, cells: [
                r.day,
                r.protocol,
                r.status !== "completed"
                  ? "In progress"
                  : r.providers.every((p) => p.rate == null)
                    ? "Completed · partial coverage"
                    : "Scored",
                integer(r.pages),
                ...providers.map((p) => historyResult(r, p.id)),
              ] }))}
            />
          }
        />
        <BenchmarkSources onViewDailyWikipedia={() => {
          setSource("wikipedia_daily");
          setCategory("all");
          setValidation("all");
          document.getElementById("sample")?.scrollIntoView({ behavior: "smooth" });
        }} />
        <SiteSection id="methodology" lines className="bench-method">
          <SectionHeading title="Methodology" />
          <SectionHeaderRule />
          <h3>How scores are calculated</h3>
          <p>
            A page counts as useful when the response contains substantive
            content that matches the requested page. We calculate the percentage
            of useful pages within each category, then average those percentages.
            This gives every category the same influence on the final score,
            regardless of how many pages it contains. Failed requests, unresolved
            judgments, and pending results remain in the page count and lower the
            score, so it reflects more than the quality of successfully returned
            content.
          </p>
          {(unknown > 0 || pending > 0) && (
            <p>
              For the current selection, {integer(unknown)} provider results
              remain unresolved and {integer(pending)} are pending. These results
              count against the score until useful content is confirmed. You can
              inspect each provider’s counts in the results table.
            </p>
          )}
          <h3>Reading the daily history</h3>
          <p>
            Historical scores keep the scoring rules used at the time and do
            not change with the filters above. Gaps mark missing scores, and
            separate line segments show where the scoring rules changed. Scores
            from different collection protocols are not directly comparable.
            A dash in a results table means no score is available.
          </p>
          <h3>Daily collection</h3>
          {run && run.pages < run.target && (
            <p>
              The selected daily run collected {integer(run.pages)} of{" "}
              {integer(run.target)} targeted pages. In the unfiltered daily-only
              view, a missing category withholds the overall score.
            </p>
          )}
          <p>
            Public feeds, registries, and sitemaps supply up to 300 previously
            unseen pages per category each day. All four providers receive the
            same frozen sample with fresh content requested and a 30-second
            request deadline. An automated judge evaluates whether returned
            content is substantive and belongs to the requested page, without
            seeing the provider name. A useful result does not establish that
            every fact is correct or that all of the page’s content was recovered.
          </p>
          <p>
            Wikipedia discovery runs once before the daily sample is created,
            using up to 1,200 non-bot article edits spread across the previous
            UTC day. We compare the old and new revision text. Only new
            external URLs are eligible; previously tested URLs and the original
            study pages are excluded. The daily sample includes up to 300 of
            these pages in the Other category, without inferring their subject
            from the citing article. This is a sample of edits, not every link
            added to Wikipedia. If discovery fails, the other sources can still
            form the daily sample, and Wikipedia is checked again the next day.
          </p>
          <p>
            Protocol v5 adds this group to the daily sample. It receives the same
            weight as each other category when present; missing Wikipedia pages
            do not suppress the eight-category daily score. Historical results
            retain their original scoring rules.
          </p>
          <details>
            <summary>Collection, grading, and limitations</summary>
            <p>
              {run && run.protocol !== PROTOCOL
                ? `The selected historical sample uses ${run.protocol}, while new collections use ${PROTOCOL}.`
                : `Collection uses ${PROTOCOL}.`}{" "}
              Context and Firecrawl request main content; all outputs are
              limited to 250,000 characters. Jev 1.13.0 grades up to 12,000
              characters from the beginning, middle, and end. A positive match
              can establish useful content, while a negative judgment from an
              incomplete excerpt remains unresolved. Failed, unresolved, and
              pending results stay in the denominator, with equal weight for
              each scored category.
            </p>
            <p>
              Although we request fresh content, providers may still return
              cached responses, so response times would not be directly
              comparable and are not ranked here. The number of available pages,
              provider rate limits, and request budgets can also reduce the daily
              sample.
            </p>
            <p>
              Collection runs every fifteen minutes, with a limit of 4,000
              requests per provider per UTC day and a separate grading budget.
              Interrupted requests are not automatically repeated, which avoids
              giving a provider extra attempts at the same page.
            </p>
            <p>
              Individual results are retained for 30 days. Private grading
              excerpts are compressed and retained for up to seven days within a
              256 MB budget; daily summaries remain available. Historical
              records retain their original protocol and grading decisions.
            </p>
            {data.collecting && data.collecting.id !== run?.id && (
              <p>
                Collection for {data.collecting.day} is in progress, with{" "}
                {integer(
                  data.collecting.providers.reduce(
                    (n, p) => n + p.total - p.pending,
                    0,
                  ),
                )}{" "}
                of {integer(data.collecting.pages * providers.length)} results
                ready.
              </p>
            )}
            <p>
              {data.health.healthySources} of {data.health.sources} sources last
              fetched successfully. Last collector update:{" "}
              {data.health.lastTick
                ? new Date(data.health.lastTick)
                    .toISOString()
                    .replace("T", " ")
                    .slice(0, 19) + " UTC"
                : "not yet recorded"}
              .{data.health.error && ` ${data.health.error}`}
            </p>
          </details>
          <details id="wikipedia">
            <summary>Wikipedia methodology history</summary>
            <p>
              With protocol v5, Wikipedia discovery moved from a fixed snapshot
              to daily samples. The earlier study tested 1,041 linked pages on
              October 29, 2026, using links found in 48 two-minute windows on
              October 25 and 27, covering 4,777 edits. Those saved results remain
              available in the Source filter and are included in All sources;
              they are not refreshed with each daily sample.
            </p>
            <p>
              The combined view brings together the selected daily sample and the
              fixed Wikipedia study. We align their legal and finance categories
              and keep arts, sports, and reference pages in a separate category.
              A URL appears only once, ignoring page fragments; when both studies
              contain it, we use the daily result.
            </p>
            <p>
              The two studies used different collection settings, so the combined
              score describes this particular mix of pages. Use the Source filter
              to compare providers within one study. The Wikipedia study was
              measured on October 29 with its original Python adapters and
              identity-content-jev-v2 grading, with Context requesting the full
              page rather than main content only. Its scores here use equal
              category weights, so they differ from the original study chart,
              which gave every page equal weight.
            </p>
            <p>
              <a href="/data/wikipedia-study.json" download>
                Download the archived URLs and results
              </a>
            </p>
            <Button variant="outline-brand" onClick={() => {
              setSource("wikipedia");
              setCategory("all");
              setValidation("all");
              document.getElementById("sample")?.scrollIntoView({ behavior: "smooth" });
            }}>
              View original Wikipedia results
            </Button>
            <h3 id="wikipedia-methodology">Archived study validation</h3>
            {wikiCount > 0 && (
              <p>
                A basic HTTP fetch with Trafilatura, an article-text extractor,
                recovered useful content from {integer(selected.filter(
                  (page) => page.source === "wikipedia" && page.plainHttp === true,
                ).length)} of {integer(wikiCount)} selected pages linked from
                Wikipedia. This baseline was not measured for daily pages.
              </p>
            )}
            <details>
              <summary>Wikipedia screening and reference checks</summary>
              <p>
                The scores use each provider’s first attempt. We repeated some
                requests to check whether failures persisted and identified 73 pages
                for further study. Because those pages were selected using provider
                failures, this subset cannot support an unbiased ranking.
              </p>
              <p>
                Of 20 randomly audited candidates, five were reference checked,
                three were rejected, and twelve remain unresolved. Some reference
                checks used public abstracts, so they do not establish whether the
                full paper was recovered. Two known grading errors are flagged in
                the data, with their original grades preserved.
              </p>
              <p>
                Daily pages have not received this independent screening and are
                excluded by the validation filters. A reliable supply of 1,000
                validated hard pages per day has not been established. The download
                includes original grades, review notes and provenance hashes.
              </p>
            </details>
          </details>
        </SiteSection>
        <SiteSection id="citation" lines className="bench-citation">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div className="flex flex-col gap-6">
          <SectionHeading title="Citation" />
          <p>
            Scraping Bench is maintained by{" "}
            <a href="https://context.dev">Context.dev</a>. If you use these
            results in your work, please cite the benchmark and
            include the sample date and protocol.
          </p>
          </div>
          <div className="flex min-w-0 flex-col gap-10">
          <CodeWindow label="scraping-bench.bib" windowClassName="[&>div:first-child]:flex-wrap" actions={
              <Button
                size="icon"
                variant="ghost"
                className="text-white/70 hover:bg-white/10 hover:text-white"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(citation);
                    setCopyStatus("Copied");
                  } catch {
                    setCopyStatus("Select and copy the citation above.");
                  }
                }}
              >
                {copyStatus === "Copied" ? <Check /> : <Copy />}
                <span className="sr-only">{copyStatus === "Copied" ? "Copied" : "Copy citation"}</span>
              </Button>
          }>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="BibTeX citation">
              <CodeBlock code={citation} className="[&_span]:whitespace-pre-wrap [&_span]:wrap-anywhere" />
            </div>
          </CodeWindow>
          <span
            className={!copyStatus || copyStatus === "Copied" ? "sr-only" : "bench-note"}
            role="status"
          >
            {copyStatus}
          </span>
          <p className="text-body-sm leading-relaxed text-fg-muted">
            Our approach is inspired by{" "}
            <a href="https://keenableai.github.io/needle/">
              NEEDLE: A Live Open-Source Search Benchmark for AI Agents
            </a>{" "}
            (2026), by Andrey Styskin, Matthias Petri, and Ilya Gusev. Its
            fresh-query methodology and transparent comparisons informed this
            benchmark, which evaluates scraping rather than search.
          </p>
          </div>
          </div>
        </SiteSection>
      </main>
      <footer className="bench-footer bench-column">
        Published by <a href="https://context.dev">Context.dev</a> to compare how
        reliably scraping APIs return content from a shared sample of web pages.
      </footer>
    </Surface>
  );
}
