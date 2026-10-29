"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProviderName } from "@/components/trace/provider-logo";
import { ThemeToggle } from "@/components/trace/theme-toggle";
import {
  categories,
  providers,
  PROTOCOL,
  type Report,
  type ProviderMetric,
  type RunSummary,
} from "@/lib/benchmark/types";

const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const seconds = (value: number | null | undefined) =>
  value == null ? "—" : `${(value / 1000).toFixed(2)} s`;
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
function Bars({
  rows,
  metric,
  max,
  format,
}: {
  rows: ProviderMetric[];
  metric: "rate" | "p50";
  max: number;
  format: typeof percent;
}) {
  return (
    <div
      className="bench-bars"
      role="img"
      aria-label={rows.map((r) => `${r.id}: ${format(r[metric])}`).join(", ")}
    >
      <div className="bench-axis">
        <span>0{metric === "rate" ? "%" : " s"}</span>
        <span>{metric === "rate" ? "100%" : format(max)}</span>
      </div>
      {providers.map((p) => {
        const row = rows.find((r) => r.id === p.id);
        const value = row?.[metric];
        return (
          <div className="bench-bar-row" key={p.id}>
            <Name id={p.id} />
            <div className="bench-track">
              <div
                className="bench-bar"
                style={{
                  width: `${value == null ? 0 : Math.min(100, (value / max) * 100)}%`,
                  background: p.color,
                }}
              />
            </div>
            <strong>{format(value)}</strong>
          </div>
        );
      })}
    </div>
  );
}
function Trend({ history }: { history: RunSummary[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const patterns = ["", "8 4", "2 4", "10 3 2 3"];
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.round(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const firstDay = Date.parse(history[0]?.day ?? "1970-01-01");
  const lastDay = Date.parse(history.at(-1)?.day ?? "1970-01-01");
  const span = Math.max(86400000, lastDay - firstDay);
  const position = (time: number) =>
    45 + ((time - firstDay) * (width - 60)) / span;
  const x = (i: number) => position(Date.parse(history[i].day));
  const tickCount = lastDay === firstDay ? 1 : width < 500 ? 3 : 6;
  const ticks = [
    ...new Set(
      Array.from(
        { length: tickCount },
        (_, i) =>
          firstDay +
          Math.round(
            (i * (lastDay - firstDay)) / Math.max(1, tickCount - 1) / 86400000,
          ) *
            86400000,
      ),
    ),
  ];
  return (
    <>
      <div className="bench-legend">
        {providers.map((p, i) => (
          <span key={p.id}>
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
          </span>
        ))}
      </div>
      <div className="bench-history" ref={container}>
        <svg
          viewBox={`0 0 ${width} 260`}
          role="img"
          aria-label="Daily useful-content scores; exact values are available in the table"
        >
          {[0, 25, 50, 75, 100].map((n) => (
            <g key={n}>
              <text x="0" y={225 - n * 2}>
                {n}%
              </text>
              <line x1="45" x2={width - 15} y1={220 - n * 2} y2={220 - n * 2} />
            </g>
          ))}
          {providers.map((p, providerIndex) => (
            <g key={p.id}>
              {history.map((r, i) => {
                const value = r.providers.find((v) => v.id === p.id)?.rate;
                const previous = history[i - 1];
                const before = previous?.providers.find(
                  (v) => v.id === p.id,
                )?.rate;
                const adjacent =
                  previous &&
                  Date.parse(r.day) - Date.parse(previous.day) === 86400000;
                if (value == null) return null;
                return (
                  <g key={r.id}>
                    {before != null && adjacent && (
                      <line
                        x1={x(i - 1)}
                        x2={x(i)}
                        y1={220 - before * 200}
                        y2={220 - value * 200}
                        style={{
                          stroke: p.color,
                          strokeWidth: 2.5,
                          strokeDasharray: patterns[providerIndex],
                        }}
                      />
                    )}
                    <circle
                      cx={x(i)}
                      cy={220 - value * 200}
                      r="3"
                      fill={p.color}
                    >
                      <title>{`${r.day}: ${p.name} ${percent(value)}`}</title>
                    </circle>
                  </g>
                );
              })}
            </g>
          ))}
          {ticks.map((time, i) => (
            <text
              key={time}
              x={position(time)}
              y="255"
              textAnchor={
                i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"
              }
            >
              {new Date(time).toISOString().slice(5, 10)}
            </text>
          ))}
        </svg>
      </div>
    </>
  );
}
export function BenchmarkReport({ initial }: { initial: Report }) {
  const [data, setData] = useState(initial);
  const [selection, setSelection] = useState({
    run: "",
    provider: "",
    page: 0,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function refresh() {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/report?${new URLSearchParams({ ...selection, page: String(selection.page) })}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(
            "Results could not be refreshed. The last successful response is still shown.",
          );
        const next = await response.json();
        if (active) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (active && !controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Results could not be refreshed.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 900000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [selection]);
  const run = data.latest;
  const rows = run?.providers ?? [];
  const pending = rows.reduce((sum, r) => sum + r.pending, 0);
  const unknown = rows.reduce((sum, r) => sum + r.unknown, 0);
  const history = data.history
    .filter((r) => r.protocol === run?.protocol && r.status === "completed")
    .filter(
      (r, i, rows) => rows.findIndex((other) => other.day === r.day) === i,
    )
    .slice(0, 30)
    .reverse();
  const latencyMax = Math.max(1000, ...rows.map((r) => r.p50 ?? 0));
  return (
    <div className="ds-product bench-shell">
      <header className="bench-header">
        <Link href="/" className="bench-wordmark">
          Scraping Bench
        </Link>
        <nav aria-label="Main navigation">
          <a href="#results">Results</a>
          <a href="#methodology">Methodology</a>
          <a href="https://github.com/context-dot-dev/trace-benchmark">
            GitHub ↗
          </a>
          <ThemeToggle />
        </nav>
      </header>
      <main id="main">
        <div className="bench-intro">
          <div>
            <h1>Daily web scraping benchmark</h1>
            <p>
              Compare how reliably four providers return useful content from the
              same pages across eight categories.
            </p>
          </div>
          <label className="bench-select">
            Sample date (UTC)
            <select
              value={selection.run}
              onChange={(e) =>
                setSelection({ run: e.target.value, provider: "", page: 0 })
              }
            >
              <option value="">Latest completed sample</option>
              {data.history.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.day} · {r.protocol === PROTOCOL ? "v4" : r.protocol}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p role="alert" className="bench-notice">
            {error}
          </p>
        )}
        {data.collecting && data.collecting.id !== run?.id && (
          <p className="bench-notice">
            Collection for {data.collecting.day} is in progress:{" "}
            {integer(
              data.collecting.providers.reduce(
                (n, p) => n + p.total - p.pending,
                0,
              ),
            )}{" "}
            of {integer(data.collecting.pages * 4)} results are ready. Select
            its date to inspect progress.
          </p>
        )}
        {!run ? (
          <p className="bench-notice">
            The first sample has not been collected yet. Results appear here as
            scheduled collection progresses.
          </p>
        ) : (
          <>
            <div className="bench-summary" id="results">
              <span>
                <strong>{run.day}</strong> UTC
              </span>
              <span>
                <strong>{integer(run.pages)}</strong> / {integer(run.target)}{" "}
                pages
              </span>
              <span>
                {run.status === "completed"
                  ? "Collection complete"
                  : `${integer(pending)} results pending`}
              </span>
              <span>{integer(unknown)} unresolved results</span>
              <a href={`/api/download?run=${encodeURIComponent(run.id)}`}>
                Download results ↓
              </a>
            </div>
            {run.pages < run.target && (
              <p className="bench-notice">
                This sample contains {integer(run.target - run.pages)} fewer
                pages than its target. Category counts below show the gaps;
                missing categories are never scored as zero.
              </p>
            )}
            <div className="bench-primary">
              <Section
                title="Useful content"
                note={`Share of sampled pages with substantive content matching the requested page. Each category has equal weight.${pending ? " Collection is in progress, so these are provisional lower bounds." : " Unresolved results remain in the denominator."}`}
                chart={
                  <Bars rows={rows} metric="rate" max={1} format={percent} />
                }
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
              <Section
                title="Response time"
                note="Lower median response times indicate faster responses; grading time and authentication, credit, and rate-limit errors are excluded."
                chart={
                  <Bars
                    rows={rows}
                    metric="p50"
                    max={latencyMax}
                    format={seconds}
                  />
                }
                table={
                  <Table
                    label="Response time results"
                    headers={[
                      "Provider",
                      "Median",
                      "95th percentile",
                      "Rate limited",
                    ]}
                    rows={rows.map((r) => [
                      <Name key={r.id} id={r.id} />,
                      seconds(r.p50),
                      seconds(r.p95),
                      integer(r.rateLimited),
                    ])}
                  />
                }
              />
            </div>
            <Section
              title="Results by category"
              note="Each provider receives the same pages. Bar length shows the share returning useful content; counts show the actual sample size."
              chart={
                <div className="bench-category-grid">
                  {categories.map((c) => (
                    <div key={c.id}>
                      <div className="bench-category-title">
                        <h3>{c.name}</h3>
                        <span>{integer(run.categories[c.id] ?? 0)} pages</span>
                      </div>
                      {providers.map((p) => {
                        const g = rows.find((r) => r.id === p.id)?.categories[
                          c.id
                        ];
                        const value =
                          g?.total && g.completed ? g.useful / g.total : null;
                        return (
                          <div className="bench-mini-row" key={p.id}>
                            <span>{p.name}</span>
                            <div className="bench-track">
                              <div
                                className="bench-bar"
                                style={{
                                  width: `${(value ?? 0) * 100}%`,
                                  background: p.color,
                                }}
                              />
                            </div>
                            <span>{percent(value)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              }
              table={
                <Table
                  label="Category results"
                  headers={[
                    "Category",
                    "Pages",
                    ...providers.map((p) => p.name),
                  ]}
                  rows={categories.map((c) => [
                    c.name,
                    integer(run.categories[c.id] ?? 0),
                    ...providers.map((p) => {
                      const g = rows.find((r) => r.id === p.id)?.categories[
                        c.id
                      ];
                      return percent(
                        g?.total && g.completed ? g.useful / g.total : null,
                      );
                    }),
                  ])}
                />
              }
            />
            <Section
              title="Quality over time"
              note={`Daily useful-content scores for ${run.protocol}. Gaps mean no measured score, and protocol changes are not joined together.`}
              chart={<Trend history={history} />}
              table={
                <Table
                  label="Daily quality history"
                  headers={[
                    "Date (UTC)",
                    "Pages",
                    ...providers.map((p) => p.name),
                  ]}
                  rows={[...history]
                    .reverse()
                    .map((r) => [
                      r.day,
                      integer(r.pages),
                      ...providers.map((p) =>
                        percent(r.providers.find((m) => m.id === p.id)?.rate),
                      ),
                    ])}
                />
              }
            />
            <section className="bench-section" aria-busy={loading}>
              <div className="bench-section-head">
                <div>
                  <h2>Individual results</h2>
                  <p className="bench-note">
                    Inspect outcomes for every measured page and provider.
                  </p>
                </div>
                <label className="bench-select">
                  Provider
                  <select
                    value={selection.provider}
                    onChange={(e) =>
                      setSelection({
                        ...selection,
                        provider: e.target.value,
                        page: 0,
                      })
                    }
                  >
                    <option value="">All providers</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Table
                label="Individual page results"
                headers={["Page", "Provider", "Outcome", "Time", "Evidence"]}
                rows={data.records.map((r) => [
                  <a
                    key={r.id}
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="bench-url"
                    title={r.url}
                  >
                    {r.url.replace(/^https?:\/\//, "")}
                  </a>,
                  <Name key={r.id} id={r.provider} />,
                  r.state !== "done"
                    ? "Pending"
                    : r.success === true
                      ? "Useful"
                      : r.success === false
                        ? "Not useful"
                        : "Unresolved",
                  seconds(r.elapsedMs),
                  r.error?.replaceAll("_", " ").toLowerCase() ??
                    [r.content, r.identity].filter(Boolean).join(" · "),
                ])}
              />
              {!data.records.length && (
                <p className="bench-note">
                  Individual records are available for 30 days; daily summaries
                  remain in the history.
                </p>
              )}
              <div className="bench-pagination">
                <span>
                  {integer(data.totalRecords)} results
                  {loading ? " · Updating…" : ""}
                </span>
                <div>
                  <button
                    disabled={loading || data.page === 0}
                    onClick={() =>
                      setSelection({ ...selection, page: data.page - 1 })
                    }
                  >
                    Previous
                  </button>
                  <span>
                    {data.page + 1} /{" "}
                    {Math.max(1, Math.ceil(data.totalRecords / 20))}
                  </span>
                  <button
                    disabled={
                      loading || (data.page + 1) * 20 >= data.totalRecords
                    }
                    onClick={() =>
                      setSelection({ ...selection, page: data.page + 1 })
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          </>
        )}
        <section id="methodology" className="bench-method">
          <h2>Methodology</h2>
          <p>
            Public feeds, registries, and sitemaps supply up to 300 previously
            unseen pages per category each day. All four providers receive the
            same frozen sample with fresh content requested and a 30-second
            request deadline. An automated judge evaluates whether returned
            content is substantive and belongs to the requested page, without
            seeing the provider name. This measures useful content, not factual
            accuracy or complete recall.
          </p>
          <details>
            <summary>Collection, grading, and data retention</summary>
            <p>
              {run && run.protocol !== PROTOCOL
                ? `The selected historical sample uses ${run.protocol}, while new collections use ${PROTOCOL}.`
                : `Collection uses ${PROTOCOL}.`}{" "}
              Context and Firecrawl request main content; all outputs are
              limited to 250,000 characters. Jev 1.13.0 grades up to 12,000
              characters from the beginning, middle, and end. A positive match
              can establish useful content, while a negative judgment from an
              incomplete excerpt remains unresolved. Failed, unresolved, and
              pending results stay in the score denominator, with equal weight
              for each of the eight categories.
            </p>
            <p>
              Vercel Cron checks for work every fifteen minutes. Drizzle stores
              durable work claims, request budgets, results, and summaries in
              Neon. Interrupted provider requests are not automatically
              repeated. Each provider is limited to 4,000 requests per UTC day,
              and grading has a separate input budget.
            </p>
            <p>
              Individual results are retained for 30 days. Private grading
              excerpts are compressed and retained for up to seven days within a
              256 MB budget; daily summaries remain available. Historical
              records retain their original protocol and grading decisions.
            </p>
            <p>
              {data.health.healthySources} of {data.health.sources} sources last
              fetched successfully. Last collector update:{" "}
              {data.health.lastTick
                ? new Date(data.health.lastTick)
                    .toISOString()
                    .replace("T", " ")
                    .slice(0, 19) + " UTC"
                : "Not yet recorded"}
              .{data.health.error && ` ${data.health.error}`}
            </p>
          </details>
        </section>
      </main>
      <footer className="bench-footer">
        Published by <a href="https://context.dev">Context.dev</a>, with the
        same sample and scoring rules for every provider.
      </footer>
    </div>
  );
}
