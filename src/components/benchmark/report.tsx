"use client";

import Link from "next/link";
import { CalendarDays, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Surface } from "@/lib/surface";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProviderName } from "@/components/trace/provider-logo";
import {
  benchmarkCategories,
  scorePages,
  uniquePages,
  type BenchmarkDataset,
} from "@/lib/benchmark/combined";
import { ThemeToggle } from "@/components/trace/theme-toggle";
import {
  categories,
  providers,
  PROTOCOL,
  type ProviderMetric,
  type RunSummary,
} from "@/lib/benchmark/types";

const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
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
  rows: ReactNode[][];
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
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={j} data-label={headers[j]}>
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
  title,
  note,
  chart,
  table,
}: {
  title: string;
  note: string;
  chart: ReactNode;
  table: ReactNode;
}) {
  return (
    <section className="bench-section">
      <Tabs defaultValue="chart">
        <div className="bench-section-head">
          <h2>{title}</h2>
          <TabsList variant="segmented" aria-label={`${title} view`}>
            <TabsTrigger value="chart">Chart</TabsTrigger>
            <TabsTrigger value="table">Table</TabsTrigger>
          </TabsList>
        </div>
        <p className="bench-note">{note}</p>
        <TabsContent value="chart">{chart}</TabsContent>
        <TabsContent value="table">{table}</TabsContent>
      </Tabs>
    </section>
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
      {providers.map((p) => {
        const value = rows.find((r) => r.id === p.id)?.rate;
        return (
          <div className="bench-bar-row" key={p.id}>
            <Name id={p.id} />
            <div className="bench-track">
              <div
                className="bench-bar"
                style={{ width: `${(value ?? 0) * 100}%`, background: p.color }}
              />
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
function Trend({ history }: { history: RunSummary[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [active, setActive] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
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
  const dayCount = Math.round((lastDay - firstDay) / dayMs) + 1;
  const inspectedDay = Math.max(
    firstDay,
    Math.min(lastDay, selectedDay ?? lastDay),
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
  const inspected = runsOnDay(inspectedDay);
  const pickDay = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - bounds.left) * width) / bounds.width;
    setSelectedDay(
      Math.max(
        firstDay,
        Math.min(
          lastDay,
          firstDay +
            Math.round(
              ((px - plotLeft) / (plotRight - plotLeft)) * (dayCount - 1),
            ) *
              dayMs,
        ),
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
              setSelectedDay(Math.max(firstDay, Math.min(lastDay, next)));
            }
          }}
          onPointerDown={(event) => {
            pickDay(event);
            event.currentTarget.focus({ preventScroll: true });
          }}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse" || event.buttons === 1)
              pickDay(event);
          }}
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
              <rect
                key={time}
                x={position(time) - 3}
                y="328"
                width="6"
                height="6"
                rx="1"
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
        Hover or touch the chart to inspect a day, or focus it and use the arrow
        keys. Gaps are not estimated.
      </p>
      <div
        className="bench-history-detail"
        aria-live="polite"
        aria-atomic="true"
      >
        <h3>
          {dateLabel(inspectedDay, true)} <span>UTC</span>
        </h3>
        {!inspected.length && <p>No sample was collected on this day.</p>}
        {inspected.map((r) => (
          <div key={r.id} className="bench-history-sample">
            <p>
              {protocolLabel(r.protocol)} · {integer(r.pages)} pages
              {r.status !== "completed" ? " · Collection in progress" : ""}
            </p>
            {r.status === "completed" &&
              r.providers.every((p) => p.rate == null) && (
                <p>
                  A sample was collected, but at least one category is missing,
                  so no overall score is reported.
                </p>
              )}
            <dl>
              {providers.map((p) => (
                <div key={p.id}>
                  <dt>
                    <Name id={p.id} />
                  </dt>
                  <dd style={{ color: p.color }}>
                    {r.status === "completed"
                      ? percent(r.providers.find((m) => m.id === p.id)?.rate)
                      : "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
const citation = `@misc{scrapingbench2026,
  author = {Ryaboy, Michael and Bakour, Yahia},
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
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger appearance="field" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem
              key={o.value}
              value={o.value}
              description={o.description}
            >
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
export function BenchmarkReport({ initial }: { initial: BenchmarkDataset }) {
  const [dataset, setDataset] = useState(initial);
  const [selection, setSelection] = useState("latest");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [validation, setValidation] = useState("all");
  const [query, setQuery] = useState("");
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
    async function refresh() {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/benchmark?${new URLSearchParams({ run: selection === "latest" ? "" : selection })}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(
            "Results could not be refreshed. The last successful sample is still shown.",
          );
        const next: BenchmarkDataset = await response.json();
        if (!controller.signal.aborted) {
          setDataset(next);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Results could not be refreshed.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
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
        (source === "all" || p.source === source) &&
        (category === "all" || p.category === category) &&
        (validation === "all" ||
          (validation === "hard"
            ? p.screened
            : p.audit === "reference_checked")) &&
        `${p.url} ${p.article ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    ),
  );
  const observedCategories = [...new Set(selected.map((p) => p.category))];
  const categoryIds =
    source === "daily" &&
    category === "all" &&
    validation === "all" &&
    !query.trim()
      ? categories.map((c) => c.id)
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
  const dailyCount = selected.filter((p) => p.source === "daily").length;
  const retainedDaily = dataset.pages.filter(
    (p) => p.source === "daily",
  ).length;
  const wikiCount = selected.filter((p) => p.source === "wikipedia").length;
  const categoryTable = (
    <Table
      label="Category results"
      headers={["Category", "Pages", ...providers.map((p) => p.name)]}
      rows={chartCategories.map((c) => [
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
      ])}
    />
  );
  function reset() {
    setSource("all");
    setCategory("all");
    setValidation("all");
    setQuery("");
  }
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            scoring:
              "Equal weight per represented category, equal weight per page within each category. Unresolved and pending outcomes remain in denominators.",
            filters: { source, category, validation, query },
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
    <Surface kind="product" className="bench-shell">
      <header className="bench-header">
        <Link href="/" className="bench-wordmark">
          Scraping Bench
        </Link>
        <nav aria-label="Main navigation">
          <a href="#methodology">Methodology</a>
          <a href="#citation">Citation</a>
          <a href="https://github.com/context-dot-dev/trace-benchmark">
            GitHub ↗
          </a>
          <ThemeToggle />
        </nav>
      </header>
      <main id="main">
        <div className="bench-intro">
          <h1>Measuring web scraping quality</h1>
          <p>
            Four providers, the same pages. Compare useful content across daily
            feeds, public registries, and Wikipedia citations, with the evidence
            behind every result.
          </p>
          <a href="#methodology">How we measure</a>
        </div>
        <div className="sample-filters" aria-label="Benchmark filters">
          <Filter
            label="Source"
            value={source}
            onChange={setSource}
            options={[
              { value: "all", label: "All sources" },
              { value: "daily", label: "Daily feeds & registries" },
              { value: "wikipedia", label: "Wikipedia citations" },
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
          <label className="sample-search" htmlFor="page-search">
            <span>Search pages</span>
            <input
              id="page-search"
              type="search"
              placeholder="URL or citing article…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="bench-sample">
          <p aria-live="polite">
            {run ? (
              <>
                Daily sample: <strong>{run.day}</strong> UTC
              </>
            ) : (
              "No daily sample available"
            )}{" "}
            · Wikipedia: October 29 fixed study{loading && " · Updating…"}
          </p>
          <div className="sample-actions">
            <Select
              value={selection}
              onValueChange={setSelection}
              disabled={source === "wikipedia"}
            >
              <SelectTrigger aria-label="Sample date (UTC)">
                <CalendarDays aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">Latest completed sample</SelectItem>
                {data.history.map((r) => (
                  <SelectItem
                    key={r.id}
                    value={r.id}
                    description={`${r.protocol}${r.status !== "completed" ? " · In progress" : ""}`}
                  >
                    {r.day}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" aria-label="Reset filters" onClick={reset}>
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
        <div id="results" aria-busy={loading}>
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
              <dt>Wikipedia citations</dt>
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
          <Section
            title="Useful content"
            note={`Each represented category has equal weight; pages within a category have equal weight. ${unknown ? integer(unknown) + " unresolved results stay in the denominator." : "Failed results stay in the denominator."}${pending ? " " + integer(pending) + " pending results make these scores provisional lower bounds." : ""}`}
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
                rows={rows.map((r) => [
                  <Name key={r.id} id={r.id} />,
                  integer(r.useful),
                  integer(r.failed),
                  integer(r.unknown),
                  integer(r.pending),
                  percent(r.rate),
                ])}
              />
            }
          />
          <p className="bench-note">
            {dailyCount > 0 && wikiCount > 0
              ? "The overall score combines two collection protocols. Use Source to inspect each separately. "
              : ""}
            Context operates this benchmark and is one of the providers
            evaluated. <a href="#methodology">Scoring and limitations</a>.
          </p>
          {wikiCount > 0 && (
            <p className="bench-note">
              Plain HTTP + Trafilatura recovered useful content from{" "}
              {integer(
                selected.filter(
                  (p) => p.source === "wikipedia" && p.plainHttp === true,
                ).length,
              )}{" "}
              of {integer(wikiCount)} selected Wikipedia pages. This baseline
              was not measured for daily pages.
            </p>
          )}
          <Section
            title="Results by category"
            note="Every provider is evaluated on the same filtered pages. Missing measurements appear as an em dash. The table shows exact rates and page counts."
            chart={
              chartCategories.length >= 3 ? (
                <Radar rows={rows} chartCategories={chartCategories} />
              ) : (
                categoryTable
              )
            }
            table={categoryTable}
          />
          <div className="bench-section-head">
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
          title="Daily quality over time"
          note="Complete daily history, using each run’s original scoring rules. These historical scores are not recalculated by the filters above and do not include the fixed Wikipedia study. Different protocols are not directly comparable; missing categories withhold the overall daily score."
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
              rows={data.history.map((r) => [
                r.day,
                r.protocol,
                r.status !== "completed"
                  ? "In progress"
                  : r.providers.every((p) => p.rate == null)
                    ? "Missing categories"
                    : "Scored",
                integer(r.pages),
                ...providers.map((p) =>
                  r.status === "completed"
                    ? percent(r.providers.find((m) => m.id === p.id)?.rate)
                    : "—",
                ),
              ])}
            />
          }
        />
        <section id="methodology" className="bench-method">
          <h2>Methodology</h2>
          <p>
            The overall view pools the selected daily sample and the fixed
            Wikipedia citation study. Each represented category has equal
            weight; pages within a category have equal weight. Legal and finance
            labels are normalized across sources, and arts, sports &amp;
            reference remains its own category. Failed, unresolved, and pending
            results stay in the denominator. Duplicate URLs, ignoring fragments,
            count once; the daily observation takes precedence when both sources
            contain a URL.
          </p>
          <p>
            Pooling does not harmonize the collection protocols. The Wikipedia
            study was measured on October 29 using identity-content-jev-v2
            grading and frozen Python adapters, with Context requesting
            mainContentOnly=false. Daily collection uses the protocol recorded
            below. Treat the overall score as a descriptive comparison of this
            mixed sample; use the source filter for a protocol-specific
            comparison. Wikipedia-only scores now use the same category
            weighting as the overall view, so they differ from the earlier
            page-weighted study chart.
          </p>
          <details>
            <summary>Wikipedia discovery and validation</summary>
            <p>
              48 two-minute windows on October 25 and 27 yielded 1,041 external
              URLs from 4,777 measured English Wikipedia edits. Newly cited does
              not mean newly published. The benchmark tests the linked websites,
              not Wikipedia itself. First-run grades are used; repeat tests only
              inform screening.
            </p>
            <p>
              73 pages survived repeatability and quality screening. The hard
              cohort was selected using provider failures, so it is not an
              unbiased provider ranking. Of 20 randomly audited candidates, five
              were reference checked, three rejected and twelve unresolved.
              Reference checks include public abstracts and do not establish
              full-paper recovery. Two known grader errors remain flagged with
              their original grades.
            </p>
            <p>
              Daily pages have not received this independent screening and are
              excluded by the validation filters. A reliable supply of 1,000
              validated hard pages per day has not been established. This fixed
              study does not enable recurring Wikipedia collection.{" "}
              <a href="/data/wikipedia-study.json" download>
                Download the original study and provenance hashes
              </a>
              .
            </p>
          </details>
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
            seeing the provider name. The score measures useful content rather
            than factual accuracy or complete recall.
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
              each of the eight categories.
            </p>
            <p>
              Fresh-fetch settings do not guarantee an uncached response.
              Response time is therefore not compared. Source availability,
              provider rate limits, and request budgets can reduce the daily
              sample.
            </p>
            <p>
              Vercel Cron checks for work every fifteen minutes, and results are
              stored in Neon through Drizzle. Interrupted provider requests are
              not automatically repeated. Each provider is limited to 4,000
              requests per UTC day, and grading has a separate input budget.
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
        </section>
        <section id="citation" className="bench-citation">
          <h2>Citation</h2>
          <p>
            Scraping Bench is maintained by{" "}
            <a href="mailto:michael@context.dev">Michael Ryaboy</a> and{" "}
            <a href="mailto:yahia@context.dev">Yahia Bakour</a> at Context. If
            you use these results in your work, please cite the benchmark and
            include the sample date and protocol.
          </p>
          <div className="bench-code">
            <div className="bench-code-head">
              <span>scraping-bench.bib</span>
              <Button
                size="sm"
                variant="ghost"
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
                {copyStatus === "Copied" ? "Copied" : "Copy citation"}
              </Button>
            </div>
            <pre tabIndex={0} aria-label="BibTeX citation">
              <code>{citation}</code>
            </pre>
          </div>
          <span
            className={copyStatus === "Copied" ? "sr-only" : "bench-note"}
            role="status"
          >
            {copyStatus}
          </span>
          <p>
            Our approach is inspired by{" "}
            <a href="https://keenableai.github.io/needle/">
              NEEDLE: A Live Open-Source Search Benchmark for AI Agents
            </a>{" "}
            (2026), by Andrey Styskin, Matthias Petri, and Ilya Gusev. Its
            fresh-query methodology and transparent comparisons informed this
            benchmark, which evaluates scraping rather than search.
          </p>
        </section>
      </main>
      <footer className="bench-footer">
        Published by <a href="https://context.dev">Context.dev</a>, with the
        same pages for every provider within each source sample.
      </footer>
    </Surface>
  );
}
