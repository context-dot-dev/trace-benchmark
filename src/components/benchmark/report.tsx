"use client";

import { Copy, Check, Download, ArrowRight, X } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock, CodeWindow } from "@/components/site/code-window";
import { HeroDotField } from "@/components/visuals/hero-dot-field";
import { Surface } from "@/lib/surface";
import { cn } from "@/lib/utils";
import { percent } from "@/lib/benchmark/format";
import { benchmarkCategories, type BenchmarkDataset } from "@/lib/benchmark/combined";
import { buildView, categoryName, faqItems, providerName } from "@/lib/benchmark/view";
import { benchmarkQueryParsers } from "@/lib/benchmark/query";
import { firstSampleDay } from "@/lib/benchmark/history";
import { prices, pairBetween, type ProviderId } from "@/lib/benchmark/analysis";
import { DEADLINE_MS } from "@/lib/benchmark/outcomes";
import { providers } from "@/lib/benchmark/types";
import { BenchRail } from "./rail";
import { Radar } from "./radar";
import {
  Bars,
  FailureBars,
  FunnelChart,
  LatencyStrips,
  Name,
  PairMatrix,
  Swatch,
  Table,
  integer,
  points,
  seconds,
} from "./charts";
import { Trend, historyResult, scoringLabel } from "./history";
import { dailyExamples } from "./sources";

export type SourceSummary = { total: number; categories: { id: string; count: number; examples: string[] }[] };

const repo = "https://github.com/context-dot-dev/trace-benchmark";
const citation = `@misc{trace2026,
  author = {Bakour, Yahia and Ryaboy, Michael},
  title  = {{TRACE}: A Live Open-Source Scrape Benchmark for {AI} Agents},
  year   = {2026},
  url    = {${repo}},
  note   = {Contact: yahia@context.dev,michael@context.dev}
}`;
const longDate = (day: string) =>
  new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDate = (day: string) =>
  new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const utcTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : null;

function Frame({
  id,
  index,
  eyebrow,
  title,
  accent,
  lede,
  method,
  as: Heading = "h2",
  aside,
  children,
}: {
  id: string;
  index: number;
  eyebrow: string;
  title: ReactNode;
  accent?: ReactNode;
  lede?: ReactNode;
  method?: boolean;
  as?: "h1" | "h2";
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className={cn("bench-frame", method && "is-method")}>
      <header className="bench-frame-head">
        <div className="bench-frame-title">
          <p className="bench-eyebrow">
            <span>{String(index).padStart(2, "0")}</span>
            {eyebrow}
          </p>
          <Heading id={`${id}-title`}>
            {title}
            {accent && (
              <>
                {" "}
                <span className="text-fg-brand">{accent}</span>
              </>
            )}
          </Heading>
        </div>
        {lede && <div className="bench-lede">{lede}</div>}
        {aside}
      </header>
      {children}
    </section>
  );
}

function ChartTabs({ label, chart, table, controls }: { label: string; chart: ReactNode; table: ReactNode; controls?: ReactNode }) {
  const tabs = (
    <TabsList variant="segmented" aria-label={`${label} view`}>
      <TabsTrigger value="chart">Chart</TabsTrigger>
      <TabsTrigger value="table">Table</TabsTrigger>
    </TabsList>
  );
  return (
    <Tabs defaultValue="chart" className="bench-tabs">
      {/* The row stays mounted while chips come and go, so the tabs keep keyboard focus. */}
      {controls !== undefined ? (
        <div className="bench-result-controls">
          {tabs}
          {controls}
        </div>
      ) : (
        tabs
      )}
      <TabsContent value="chart">{chart}</TabsContent>
      <TabsContent value="table">{table}</TabsContent>
    </Tabs>
  );
}

function Notes({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <div className="bench-notes">
      {items.map((item) => (
        <div key={item.title}>
          <h3>{item.title}</h3>
          <div>{item.body}</div>
        </div>
      ))}
    </div>
  );
}

export function BenchmarkReport({ initial, sources }: { initial: BenchmarkDataset; sources: SourceSummary }) {
  const [dataset, setDataset] = useState(initial);
  const [{ source, category, run: selection }, setFilters] = useQueryStates(benchmarkQueryParsers, {
    history: "push",
    shallow: true,
    scroll: false,
  });
  const setSource = (value: string) => void setFilters({ source: benchmarkQueryParsers.source.parse(value) ?? "all" });
  const setCategory = (value: string) => void setFilters({ category: benchmarkQueryParsers.category.parse(value) ?? "all" });
  const setSelection = (value: string) => void setFilters({ run: value });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const data = dataset.report;
  useEffect(() => {
    if (copyStatus !== "Copied") return;
    const timer = setTimeout(() => setCopyStatus(""), 2000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  useEffect(() => {
    const controller = new AbortController();
    function refresh() {
      setLoading(true);
      setError("");
      return fetch(
        `/api/benchmark?${new URLSearchParams({ run: selection === "latest" ? "" : selection })}`,
        { signal: controller.signal },
      )
        .then((response) => {
          if (!response.ok) {
            throw new Error("Results could not be refreshed. Please try again.");
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
            setError(e instanceof Error ? e.message : "Results could not be refreshed.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
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

  const view = useMemo(() => buildView(dataset, { source, category, run: selection }), [dataset, source, category, selection]);
  const { run, requestedRun, visibleHistory, filteredHistory, hasFilters, retainedDaily } = view;
  // A different sample is selected but its records have not arrived: never show its scores as zero.
  const sampleUnavailable = Boolean(requestedRun && !run);
  const sampleLoading = sampleUnavailable && (loading || !error);
  const sampleStatus = sampleLoading ? "Loading sample…" : "Sample results unavailable.";
  const samplePlaceholder = (
    <div className="flex min-h-64 items-center justify-center text-muted" role="status">
      {sampleStatus}
    </div>
  );
  const { selected, rows, ranks, pairs, cats, lat, fails, funnel, quality, costs, history, stability, accessOnly } = view;
  const order = [...providers]
    .map((p) => p.id)
    .sort((a, b) => (rows.find((r) => r.id === b)?.rate ?? -1) - (rows.find((r) => r.id === a)?.rate ?? -1)) as ProviderId[];
  const pending = rows.reduce((sum, r) => sum + r.pending, 0);
  const unknown = rows.reduce((sum, r) => sum + r.unknown, 0);
  const excluded = rows.reduce((sum, r) => sum + (r.excluded ?? 0), 0);
  const timedPages = lat.some((l) => l.n > 0);
  const graded = funnel.some((f) => f.graded > 0);
  const scoredSamples = stability[0]?.scored ?? 0;
  const firstPlace = [...stability].sort((a, b) => b.firsts - a.firsts)[0];
  const audits = data.audits ?? [];
  const audit = audits.find((a) => a.rubric === run?.protocol) ?? audits[0];
  const duplicateDays = Object.entries(
    (data.runs ?? [])
      .filter((r) => r.day >= firstSampleDay)
      .reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.day]: (acc[r.day] ?? 0) + 1 }), {}),
  ).filter(([, n]) => n > 1);
  const measureWord = accessOnly ? "accessed" : "useful";
  const sourceLabel = source === "all" ? "All daily sources" : "Daily Wikipedia discoveries";
  const categoryLabel = benchmarkCategories.find((c) => c.id === category)?.name ?? "All categories";

  function reset() {
    void setFilters({ source: null, category: null });
  }
  /** Removes one filter, then keeps focus in the same section: the other chip, the selected tab, or the section. */
  function clearFilter(filter: "source" | "category", section: HTMLElement | null) {
    const remaining = filter === "source" ? "category" : "source";
    const next =
      section?.querySelector<HTMLElement>(`[data-result-filter="${remaining}"]`) ??
      section?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
      section;
    next?.focus({ preventScroll: true });
    void setFilters(filter === "source" ? { source: null } : { category: null });
  }
  const chips = hasFilters ? (
    <div className="bench-chips" role="group" aria-label="Applied filters">
      {source !== "all" && (
        <Button
          variant="outline-brand"
          size="sm"
          className="rounded-pill bg-blue-10 max-sm:min-h-11"
          data-result-filter="source"
          aria-label={`Remove ${sourceLabel} source filter`}
          onClick={(event) => clearFilter("source", event.currentTarget.closest("section"))}
        >
          {sourceLabel}
          <X aria-hidden="true" strokeWidth={1.5} />
        </Button>
      )}
      {category !== "all" && (
        <Button
          variant="outline-brand"
          size="sm"
          className="rounded-pill bg-blue-10 max-sm:min-h-11"
          data-result-filter="category"
          aria-label={`Remove ${categoryLabel} category filter`}
          onClick={(event) => clearFilter("category", event.currentTarget.closest("section"))}
        >
          {categoryLabel}
          <X aria-hidden="true" strokeWidth={1.5} />
        </Button>
      )}
    </div>
  ) : null;
  const chipRow = chips && <div className="bench-result-controls">{chips}</div>;
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            scoring: `The score averages the ${measureWord}-page rate of each scored category, giving every category equal weight. Failed, unresolved, and pending results remain in the page counts; requests rejected by our own account limits are excluded. ${accessOnly ? "Access does not measure relevance, identity, completeness, or extraction quality." : "A useful result contains substantive content matching the requested page."}`,
            filters: { source, category },
            dailyRun: run?.id,
            scores: rows,
            pairs,
            categories: cats,
            latency: lat,
            failures: fails,
            quality: { funnel, signals: quality },
            cost: costs,
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
    link.download = "trace-filtered.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const sampleSelect = (
    <Select
      value={selection}
      onValueChange={setSelection}
      label="Sample date (UTC)"
      appearance="field"
      className="bench-date"
      icon={
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 11h18" />
        </svg>
      }
      options={[
        { value: "latest", label: "Latest completed sample" },
        ...visibleHistory.map((r) => ({
          value: r.id,
          label: r.day,
          description: r.status !== "completed" ? "In progress" : undefined,
        })),
      ]}
    />
  );
  const glance = (
    <dl aria-label={`${accessOnly ? "Pages accessed" : "Useful content"} with 95% confidence intervals`}>
      <div className="bench-glance-head">
        <dt>{accessOnly ? "Accessed" : "Useful"}</dt>
        <dd>95% CI</dd>
      </div>
      {order.map((id) => {
        const row = rows.find((r) => r.id === id);
        return (
          <div key={id}>
            <dt>
              <Swatch id={id} />
              {providerName(id)}
            </dt>
            <dd>
              {percent(row?.rate)}
              {row?.ci != null && <small> {points(row.ci)}</small>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
  const filterControls = (
    <div className="bench-filters" id="sample" aria-label="Benchmark filters">
      <Select
        value={source}
        onValueChange={setSource}
        label="Source"
        appearance="ghost"
        options={[
          { value: "all", label: "All daily sources" },
          { value: "wikipedia_daily", label: "Daily Wikipedia discoveries" },
        ]}
      />
      <Select
        value={category}
        onValueChange={setCategory}
        label="Category"
        appearance="ghost"
        options={[
          { value: "all", label: "All categories" },
          ...benchmarkCategories
            .filter((c) => c.id !== "arts_sports_reference")
            .map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      {hasFilters && (
        <button type="button" className="bench-reset" onClick={reset}>
          Reset filters
        </button>
      )}
      <p className="sr-only" role="status">
        {hasFilters ? `Results filtered by ${sourceLabel} · ${categoryLabel}.` : "Showing all daily sources and categories."}
      </p>
    </div>
  );
  const leaderTable = (
    <Table
      label={accessOnly ? "Page access results" : "Useful content results"}
      headers={["Provider", "Place", accessOnly ? "Accessed" : "Useful", accessOnly ? "Not accessed" : "Not useful", "Unresolved", "Excluded", "Pending", "Score", "95% CI"]}
      rows={order.map((id) => {
        const r = rows.find((x) => x.id === id)!;
        const rank = ranks.get(id);
        return {
          id,
          cells: [
            <Name key={id} id={id} />,
            rank ? `${rank.place}${rank.tied ? " (tied)" : ""}` : "—",
            integer(r.useful),
            integer(r.failed),
            integer(r.unknown),
            integer(r.excluded ?? 0),
            integer(r.pending),
            percent(r.rate),
            points(r.ci) || "—",
          ],
        };
      })}
    />
  );

  return (
    <Surface kind="site" className="bench-page">
      <BenchRail
        sample={sampleSelect}
        meta={
          run ? (
            <>
              <i className={cn("bench-live", data.collecting && "is-collecting")} aria-hidden="true" />
              {`${scoringLabel(run.protocol)} · ${integer(selected.length)} pages`}
            </>
          ) : (
            "No sample yet"
          )
        }
        glance={glance}
        onFilters={() => {
          document.getElementById("useful-content")?.scrollIntoView({ behavior: "smooth" });
          setTimeout(() => document.querySelector<HTMLElement>("#sample button")?.focus({ preventScroll: true }), 400);
        }}
        shortDate={requestedRun ? shortDate(requestedRun.day) : "Sample"}
      />
      <div className="bench-app">
        <div className="bench-status">
          <p>
            <span className="bench-status-chip">
              <i aria-hidden="true" />
              {data.collecting ? "Collecting" : "Live"}
            </span>
            <span>
              New sample every day at 00:15 UTC
              {run?.finishedAt ? ` · Last completed ${utcTime(run.finishedAt)}` : ""}
              {loading ? " · Updating…" : ""}
            </span>
          </p>
          <div className="bench-status-actions">
            <Button variant="pill" size="sm" className="bench-status-download" onClick={download} disabled={!run} data-download-results>
              <Download aria-hidden="true" />
              Download data
            </Button>
            <Button variant="ghost" size="icon" className="size-11 rounded-pill text-fg" asChild>
              <a href={repo} aria-label="Trace benchmark on GitHub">
                <svg viewBox="0 0 16 16" fill="currentColor" className="size-5" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 3.86c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
              </a>
            </Button>
          </div>
        </div>
        <main id="main">
          <div id="results" className="contents" aria-busy={loading || sampleLoading}>
          <Frame
            id="overview"
            index={1}
            as="h1"
            eyebrow="Daily web scraping benchmark"
            title="How reliably can web scrapers"
            accent="read a page?"
          >
            <div className="bench-hero-field" aria-hidden="true">
              <HeroDotField fine streams miniStreams />
            </div>
            <p className="bench-intro-text">
              Every day we send a new fresh sample of about 2,500 web pages to context.dev, Exa, Firecrawl, and Keenable.
              We publish how often each one gets through, how fast it answers, whether it returns the right page,
              what it costs, and why it fails.
            </p>
            <div className="bench-overview">
              <div className="bench-findings">
                <h2 className="bench-findings-title">
                  Key findings{run ? ` · ${longDate(run.day)} sample` : ""}
                </h2>
                {sampleUnavailable ? (
                  <p className="bench-note">{sampleStatus}</p>
                ) : view.findings.length ? (
                  <ol>
                    {view.findings.map((f) => (
                      <li key={f.lead}>
                        <span>
                          <strong>{f.lead}</strong> {f.detail}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="bench-note">Findings appear once the selected sample has scores.</p>
                )}
              </div>
              <div className="bench-stats">
                <dl className="bench-stats-group sample-metrics" aria-live="polite">
                  <div>
                    <dt>pages, each sent to all four providers</dt>
                    <dd data-sample-count>{sampleUnavailable ? "—" : integer(selected.length)}</dd>
                  </div>
                  <div>
                    <dt>categories, weighted equally</dt>
                    <dd>{sampleUnavailable ? "—" : integer(view.categoryIds.length)}</dd>
                  </div>
                </dl>
                <dl className="bench-stats-group">
                  <div>
                    <dt>daily samples scored{history[0] ? ` since ${shortDate(history[0].day).replace(" ", "\u00a0")}` : ""}</dt>
                    <dd className="text-fg-brand">{integer(scoredSamples)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </Frame>

          <Frame
            id="useful-content"
            index={2}
            eyebrow="Leaderboard"
            title={accessOnly ? "Pages" : "Pages with"}
            accent={accessOnly ? "accessed" : "useful content"}
            lede={
              accessOnly
                ? "The score measures whether page data loaded, rather than only a block, error, or empty shell. Partial content and populated landing pages count. Ranks change only where a paired test on the same pages shows a real difference."
                : "The score summarizes how often each provider returned meaningful content from the requested pages. Every provider is tested on the same selected pages."
            }
          >
            <div className="bench-toolbar">
              {/* Below the sidebar breakpoint the sample date sits with the filters. */}
              <div className="bench-toolbar-date">{sampleSelect}</div>
              {filterControls}
              <p className="bench-sample bench-sample-line" aria-live="polite">
                {requestedRun ? (
                  <>
                    Sample <strong>{requestedRun.day}</strong> UTC{run ? ` · ${integer(selected.length)} pages` : ""}
                  </>
                ) : (
                  "No daily sample available"
                )}
                {sampleUnavailable ? ` · ${sampleLoading ? "Loading…" : sampleStatus}` : loading && " · Updating…"}
              </p>
            </div>
            {error && <p role="alert" className="bench-notice">{error}</p>}
            {run && retainedDaily < run.pages && (
              <p className="bench-notice" role="status" data-retention-notice>
                Only {integer(retainedDaily)} of {integer(run.pages)} daily page records are available for {run.day}.
                Older page records expire under the retention policy. The filters and scores below use available
                records only; original daily scores remain available in the history under All daily sources.
              </p>
            )}
            {!sampleUnavailable && source === "wikipedia_daily" && selected.length === 0 && (
              <p className="bench-notice" role="status">
                No daily Wikipedia pages match this sample and these filters. Choose another sample date to see available results.
              </p>
            )}
            <ChartTabs
              label="Leaderboard"
              chart={sampleUnavailable ? samplePlaceholder : <Bars rows={rows} ranks={ranks} />}
              table={sampleUnavailable ? samplePlaceholder : leaderTable}
              controls={chips}
            />
            <Notes
              items={[
                {
                  title: accessOnly ? "What counts as accessed" : "What counts as useful",
                  body: accessOnly
                    ? "A page counts when real page data loads: an article, a listing, a filing, or a partial preview. A login wall, CAPTCHA, error page, or empty shell does not. An automated judge decides from the returned text and never sees which provider sent it."
                    : "A page counts as useful when the response contains substantive content that matches the requested page. An automated judge decides from the returned text and never sees which provider sent it.",
                },
                {
                  title: "How to read the ranges",
                  body: (
                    <>
                      The ± value is a 95% confidence interval. Two providers get separate places only when a paired
                      test on the pages they disagree on passes at the 95% level; otherwise they share a place.
                      {excluded > 0 && ` ${integer(excluded)} ${excluded === 1 ? "request" : "requests"} rejected by our own account limits ${excluded === 1 ? "is" : "are"} excluded and listed in the table.`}
                    </>
                  ),
                },
              ]}
            />
            <p className="bench-note">
              context.dev runs this benchmark and is one of the providers tested. See the <a href="#methodology">methodology</a> for scoring rules and limitations.
              {pending > 0 && " Results for this selection are still being collected."}
            </p>
          </Frame>

          <Frame
            id="head-to-head"
            index={3}
            eyebrow="Head-to-head"
            title="Same pages,"
            accent="paired"
            lede={(() => {
              const called = pairs.filter((p) => p.winner).length;
              return `Every provider gets the identical sample, so we can count the pages one got and another missed. ${called === pairs.length ? "On this selection, every pair shows a clear winner." : `${called} of ${pairs.length} pairs show a clear winner; the rest are within the noise.`}`;
            })()}
          >
            {chipRow}
            {sampleUnavailable ? samplePlaceholder : (<>
            <div className="bench-split">
              <PairMatrix pairs={pairs} order={order} />
              <div className="bench-verdicts">
                <h3>Pair verdicts</h3>
                <ul>
                  {order.flatMap((a, i) =>
                    order.slice(i + 1).map((b) => {
                      const pair = pairBetween(pairs, a, b)!;
                      return (
                        <li key={`${a}-${b}`}>
                          <span>
                            {providerName(a)} vs {providerName(b)}
                          </span>
                          <span className="bench-verdict-count">
                            {integer(pair.aOnly)} to {integer(pair.bOnly)}
                          </span>
                          <span className={cn("bench-verdict", pair.winner && "is-called")}>
                            {pair.winner ? (
                              <>
                                <Swatch id={pair.winner} />
                                {providerName(pair.winner)} ahead
                              </>
                            ) : (
                              "Tied"
                            )}
                          </span>
                        </li>
                      );
                    }),
                  )}
                </ul>
                <p className="bench-note">
                  A pair is called only when an exact McNemar test on the pages the two disagree on passes at the 95% level.
                  Requests rejected by our own account limits are left out of both sides.
                </p>
              </div>
            </div>
            </>)}
          </Frame>

          <Frame
            id="categories"
            index={4}
            eyebrow="Categories"
            title="Results by"
            accent="category"
            lede={view.findings[1] ? `${view.findings[1].lead} ${view.findings[1].detail}` : "Compare how reliably each provider handles different kinds of pages."}
          >
            <ChartTabs
              label="Categories"
              controls={chips}
              chart={
                sampleUnavailable ? (
                  samplePlaceholder
                ) : view.categoryList.length >= 3 ? (
                  <Radar rows={rows} chartCategories={view.categoryList} accessOnly={accessOnly} />
                ) : (
                  <p className="bench-notice">The chart needs at least three categories. Switch to Table to see this selection.</p>
                )
              }
              table={
            sampleUnavailable ? samplePlaceholder : <Table
              className="bench-category-table"
              label="Results by category"
              headers={["Category", ...order.map(providerName), "No provider", "Verdict"]}
              rows={cats.map((c) => {
                const best = Math.max(...order.map((id) => c.rates[id] ?? -1));
                return {
                  id: c.id,
                  cells: [
                    `${categoryName(c.id)}`,
                    ...order.map((id) => (
                      <span key={id} className={cn(c.rates[id] === best && "is-best")}>
                        {percent(c.rates[id])}
                      </span>
                    )),
                    integer(c.nobody),
                    c.verdict === "leads" && c.leader ? (
                      <span key="v" className="bench-chip is-called">
                        <Swatch id={c.leader} />
                        {providerName(c.leader)} leads
                      </span>
                    ) : c.verdict === "tied" ? (
                      <span key="v" className="bench-chip">Tied</span>
                    ) : (
                      "—"
                    ),
                  ],
                };
              })}
            />
              }
            />
            <p className="bench-note">
              In the table, black marks the highest rate in each row. “No provider” counts sample pages that all four failed. A verdict
              compares the top two providers in that category with a paired test on the same pages; “Tied” means the gap
              is within the noise. Categories hold up to 300 pages each.
            </p>
          </Frame>

          <Frame
            id="latency"
            index={5}
            eyebrow="Latency"
            title="How long a"
            accent="page takes"
            lede={view.findings.find((f) => f.lead.includes("median")) ? `${view.findings.find((f) => f.lead.includes("median"))!.lead} ${view.findings.find((f) => f.lead.includes("median"))!.detail}` : undefined}
          >
            {sampleUnavailable ? (
              <>
                {chipRow}
                {samplePlaceholder}
              </>
            ) : timedPages ? (
              <ChartTabs
                label="Latency"
                controls={chips}
                chart={<LatencyStrips rows={order.map((id) => lat.find((l) => l.id === id)!)} />}
                table={
                  <Table
                    label="Response time percentiles"
                    headers={["Provider", "p50", "p90", "p95", "p99", "Successful p50", "Successful p95", "Timeouts"]}
                    rows={order.map((id) => {
                      const l = lat.find((x) => x.id === id)!;
                      return {
                        id,
                        cells: [
                          <Name key={id} id={id} />,
                          seconds(l.p50),
                          seconds(l.p90),
                          seconds(l.p95),
                          seconds(l.p99),
                          seconds(l.successP50),
                          seconds(l.successP95),
                          `${integer(l.timeouts)} (${percent(l.timeoutRate)})`,
                        ],
                      };
                    })}
                  />
                }
              />
            ) : (
              <>
                {chipRow}
                <p className="bench-notice">Response times were not recorded for this selection.</p>
              </>
            )}
            <Notes
              items={[
                {
                  title: "Requests that hit the deadline",
                  body: (
                    <>
                      <span className="bench-inline-stats">
                        {[...lat].sort((a, b) => (a.timeoutRate ?? 0) - (b.timeoutRate ?? 0)).map((l) => (
                          <span key={l.id}>
                            {providerName(l.id)} <strong>{percent(l.timeoutRate)}</strong>
                          </span>
                        ))}
                      </span>
                      context.dev, Exa, and Firecrawl are asked to give up at {DEADLINE_MS / 1000} seconds; Keenable offers no
                      deadline setting, so our 30-second cutoff applies. Any failure at the deadline counts as a timeout,
                      whatever error the provider returns.
                    </>
                  ),
                },
                {
                  title: "How we measure",
                  body: "Time runs from sending the request to receiving the full response, measured from Vercel's US East region. Caching is turned off for every provider, and any response a provider marks as cached is excluded. Requests rejected by our own account limits are left out.",
                },
              ]}
            />
          </Frame>

          <Frame
            id="quality"
            index={6}
            eyebrow="Quality"
            title="From response to"
            accent="useful page"
            lede="Getting through is only the first step. A page can still be the wrong document, or a title with no real content. Each line follows one provider from response to useful page."
          >
            {chipRow}
            {sampleUnavailable ? samplePlaceholder : (<>
            <div className="bench-split is-wide">
              <FunnelChart rows={order.map((id) => funnel.find((f) => f.id === id)!)} />
              <dl className="bench-stages">
                <div><dt>Returned content</dt><dd>The provider answered with text before the deadline.</dd></div>
                <div><dt>Page accessed</dt><dd>The text is real page data, not a block or error screen{accessOnly ? "" : " (earlier samples need a page-access regrade)"}.</dd></div>
                <div><dt>Right page</dt><dd>It is the requested document, not a homepage or a different item.</dd></div>
                <div><dt>Substantive</dt><dd>It holds the page&apos;s main content, not just a title or navigation.</dd></div>
              </dl>
            </div>
            {!graded && (
              <p className="bench-notice" role="status">
                Right-page and substantive-content grades are not available for this sample yet, so the chart stops at
                the stages that are graded.
              </p>
            )}
            <Table
              label="Quality signals"
              headers={["Provider", "Right page", "Substantive", "Ended on another page", "Median length", "Length vs. other providers"]}
              rows={order.map((id) => {
                const f = funnel.find((x) => x.id === id)!;
                const q = quality.find((x) => x.id === id)!;
                return {
                  id,
                  cells: [
                    <Name key={id} id={id} />,
                    f.rightPage != null && f.n ? percent(f.rightPage / f.n) : "—",
                    f.substantive != null && f.n ? percent(f.substantive / f.n) : "—",
                    q.redirectRate != null ? percent(q.redirectRate) : "—",
                    q.medianChars != null ? `${integer(q.medianChars)} chars` : "—",
                    q.lengthRatio != null ? `${q.lengthRatio.toFixed(2)}×` : "—",
                  ],
                };
              })}
            />
            <p className="bench-note">
              “Ended on another page” compares the final URL with the requested one, ignoring the scheme, “www.”, query
              strings, and trailing slashes. Length compares each provider with the median length across providers that
              returned the same page. context.dev and Firecrawl request main content only while Exa returns full text, so length is a
              signal, not a score.
            </p>
            </>)}
          </Frame>

          <Frame
            id="cost"
            index={7}
            eyebrow="Cost"
            title="What a"
            accent="page costs"
            lede="A cheap request is not cheap if it fails. We divide each published price by the access rate to get the cost of 1,000 pages that actually load."
          >
            {chipRow}
            {sampleUnavailable ? samplePlaceholder : (<>
            <div className="bench-cost">
              <div className="bench-cost-row is-head" aria-hidden="true">
                <span>Provider</span>
                <span>Published price used</span>
                <span>Per 1,000 requests</span>
                <span>{accessOnly ? "Access rate" : "Useful rate"}</span>
                <span>Per 1,000 {accessOnly ? "accessed" : "useful"} pages</span>
              </div>
              {[...costs].sort((a, b) => (a.perAccessed1k ?? Infinity) - (b.perAccessed1k ?? Infinity)).map((c) => {
                const entry = prices.providers[c.id];
                const max = Math.max(...costs.map((x) => x.perAccessed1k ?? 0));
                return (
                  <div className="bench-cost-row" key={c.id}>
                    <span className="bench-cost-name"><Swatch id={c.id} />{providerName(c.id)}</span>
                    <span className="bench-cost-plan">
                      <a href={entry.source}>{entry.plan}</a> · {entry.price}
                    </span>
                    <span>${c.per1k.toFixed(2)}</span>
                    <span>{percent(c.rate)}</span>
                    <span className="bench-cost-value">
                      <i aria-hidden="true">
                        <i style={{ width: `${((c.perAccessed1k ?? 0) / (max || 1)) * 100}%`, backgroundColor: providers.find((p) => p.id === c.id)?.color }} />
                      </i>
                      <strong>{c.perAccessed1k != null ? `$${c.perAccessed1k.toFixed(2)}` : "—"}</strong>
                      {c.assumed && <span className="bench-cost-flag" title="Assumes failed requests are billed">*</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="bench-note">
              {prices.note} Prices checked {longDate(prices.checked)}. context.dev and Keenable say they do not bill failed
              requests, so their cost per accessed page equals their request price. * Exa and Firecrawl do not say, so we
              assume failed requests are billed. Keenable&apos;s first 100,000 requests each month are free.
            </p>
            </>)}
          </Frame>

          <Frame
            id="failures"
            index={8}
            eyebrow="Failures"
            title="Why pages"
            accent="fail"
            lede={(() => {
              const top = [...fails].map((f) => {
                const [reason, count] = Object.entries(f.reasons).sort((a, b) => b[1] - a[1])[0] ?? [];
                return { id: f.id, reason, count, share: f.total ? f.failed / f.total : 0 };
              });
              const least = [...top].sort((a, b) => a.share - b.share)[0];
              return least ? `${providerName(least.id)} fails least. Each bar shows the share of pages a provider missed, split by the first reason we recorded.` : undefined;
            })()}
          >
            {chipRow}
            {sampleUnavailable ? samplePlaceholder : (<>
            <FailureBars rows={fails} />
            <p className="bench-note">
              Bars show the share of all scored pages each provider failed to {accessOnly ? "access" : "return useful content for"}.
              Hover a segment for the count. Provider-reported failures and missed deadlines count as failures, even when
              the provider did not return an error code. {accessOnly ? "Wrong documents and thin pages count as accessed and appear under Quality." : "Thin pages and wrong documents count as failures under this scoring rule."}
            </p>
            </>)}
          </Frame>

          <Frame
            id="history"
            index={9}
            eyebrow="History"
            title="Daily results"
            accent="over time"
            lede={
              firstPlace?.scored
                ? `Daily results from ${longDate(firstSampleDay)} onward. ${providerName(firstPlace.id)} ranked first in ${integer(firstPlace.firsts)} of ${integer(firstPlace.scored)} scored samples.`
                : `Daily results from ${longDate(firstSampleDay)} onward.`
            }
          >
            <ChartTabs
              label="History"
              controls={chips}
              chart={<Trend history={history} filtered={hasFilters} />}
              table={
                <Table
                  label="Daily results history"
                  headers={["Date (UTC)", "Status", "Pages", ...providers.map((p) => p.name)]}
                  rows={filteredHistory.map((r) => ({
                    id: r.id,
                    cells: [
                      r.day,
                      r.status === "unavailable"
                        ? "Filtered results unavailable"
                        : hasFilters && r.pages === 0
                          ? "No matching pages"
                          : r.status !== "completed"
                            ? "In progress"
                            : r.providers.every((p) => p.rate == null)
                              ? "Completed · partial coverage"
                              : "Scored",
                      r.status === "unavailable" ? "—" : integer(r.pages),
                      ...providers.map((p) => historyResult(r, p.id)),
                    ],
                  }))}
                />
              }
            />
            <Notes
              items={[
                {
                  title: "Reading the daily history",
                  body: `Source and category filters apply to every daily result, including its page count and provider scores. Gaps mark missing scores or dates with no matching pages; they are not estimated. Source-filtered history requires complete retained page records, and category-only history uses saved daily summaries. A dash means no score is available.${duplicateDays.length ? ` ${duplicateDays.length === 1 ? "One day has" : `${duplicateDays.length} days have`} more than one run (${duplicateDays.map(([d]) => shortDate(d)).join(", ")}); the most recently created run is shown.` : ""}`,
                },
                {
                  title: "Same evidence, new rules",
                  body: "When a sample is regraded from its stored evidence under a newer scoring rule, both grades are kept so they can be compared on identical pages. The original grades are never overwritten.",
                },
              ]}
            />
          </Frame>
          </div>

          <Frame
            id="sources"
            index={10}
            method
            eyebrow="Sample & sources"
            title="Where the"
            accent="pages come from"
            lede={`Each day we collect new pages from ${integer(sources.total - 1)} public feeds, registries, and sitemaps, plus links freshly added to English Wikipedia. No page is ever tested twice.`}
          >
            <div className="bench-split is-table">
              <ol className="bench-steps">
                <li><span><strong>Discover.</strong> On each source&apos;s schedule we poll publisher feeds, job boards, SEC and Federal Register listings, and sitemaps for new URLs. Wikipedia edits from the previous UTC day are checked once a day for new external links.</span></li>
                <li><span><strong>Sample.</strong> At 00:15 UTC we draw up to 300 previously unseen pages per category, with at most 125 from one organization and 375 from one website.</span></li>
                <li><span><strong>Freeze.</strong> The sample is locked and sent to all four providers with caching turned off for every one.</span></li>
                <li><span><strong>Grade.</strong> A blind judge reads each response. Every URL, verdict, and timing is published in the page-level data.</span></li>
              </ol>
              <div>
                <Table
                  className="bench-text-table"
                  label="Discovery sources by category"
                  headers={["Category", "Sources", "Examples"]}
                  rows={sources.categories.map((c) => ({
                    id: c.id,
                    cells: [categoryName(c.id) === "Wikipedia links" ? "Other" : categoryName(c.id), integer(c.count), c.examples.join(", ")],
                  }))}
                />
                <div className="bench-actions">
                  <Button
                    variant="pill-outline"
                    size="sm"
                    onClick={() => {
                      void setFilters({ source: "wikipedia_daily", category: null });
                      document.getElementById("useful-content")?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    View daily Wikipedia results
                  </Button>
                  <Button asChild variant="pill-outline" size="sm">
                    <a href={`${repo}/blob/main/config/sources.json`}>Browse all {integer(sources.total)} sources ↗</a>
                  </Button>
                </div>
              </div>
            </div>
            <details id="daily-sources" className="bench-details">
              <summary>Daily source examples by category</summary>
              <p>
                These feeds, APIs, and sitemaps supply the URLs for the daily sample. We follow those links and test
                whether each provider can recover content from the destination page. We assign each page the category of
                the source that supplied it. Pages are new to the benchmark, but may have been published earlier.
              </p>
              <dl className="bench-example-list">
                {dailyExamples.map((example) => (
                  <div key={example.category}>
                    <dt>{example.category}</dt>
                    <dd>
                      {example.description} · <a href={example.url}>{example.name} ↗</a>
                    </dd>
                  </div>
                ))}
              </dl>
              <p>These are configured discovery sources, not a guarantee that every source contributes to every daily sample.</p>
            </details>
          </Frame>

          <Frame
            id="methodology"
            index={11}
            method
            eyebrow="Methodology"
            title="How the"
            accent="benchmark works"
            lede="Every rule that affects a score is written down here. Each topic opens for the full detail, and all of it stays on the page for readers, search engines, and AI assistants."
          >
            <div className="bench-accordion">
              <details open>
                <summary>How scores are calculated</summary>
                <p>
                  {accessOnly
                    ? "A page counts as accessed when actual page data or file content loaded. A partial preview, populated listing, publication landing page, or raw file can pass. Blocks, mandatory login screens, main-page errors, and empty shells fail when they contain no page data. Relevance, document identity, completeness, and extraction quality are not part of the access score; they are reported separately under Quality."
                    : "A page counts as useful when the response contains substantive content that matches the requested page."}{" "}
                  We calculate the percentage of {measureWord} pages within each category, then average those percentages,
                  so every category has the same influence regardless of its page count. Failed requests, unresolved
                  judgments, and pending results remain in the denominator and lower the score. Requests rejected by our
                  own account limits (HTTP 401, 402, or 429, or exhausted credits) are excluded from that provider&apos;s
                  score and listed separately; they are not retried, so no provider gets a second attempt at a page.
                </p>
                <p>
                  The ± range is a 95% confidence interval for the category-weighted score. Rankings use an exact McNemar
                  test on the pages two providers disagree on; providers that do not differ at the 95% level share a place.
                </p>
                {(unknown > 0 || pending > 0) && (
                  <p>
                    For the current selection, {integer(unknown)} provider results remain unresolved and {integer(pending)} are
                    pending. These results count against the score until {accessOnly ? "access" : "useful content"} is confirmed.
                  </p>
                )}
              </details>
              <details>
                <summary>The judge, and how we audit it</summary>
                <p>
                  TypeSafe&apos;s Jev 1.13.0 model grades up to 12,000 characters taken from the beginning, middle, and end of
                  each response.{" "}
                  {accessOnly
                    ? "For the access score it sees only that text and whether it was sampled, never the provider name or the requested URL."
                    : "For the useful-content score it checks for substantive content matching the requested page, without seeing the provider name."}{" "}
                  Unclear evidence and judge failures stay unresolved rather than being guessed.
                  Document and content grades for the Quality section use a separate judge call that also sees the requested
                  URL, title, and category, still without the provider name.
                </p>
                <p>
                  {audit
                    ? `People have hand-checked ${integer(audit.pages)} judged pages for ${scoringLabel(audit.rubric).toLowerCase()} since ${audit.since?.slice(0, 10)}; they agreed with the judge on ${percent(audit.pages ? audit.agreed / audit.pages : null)} of them. Reviewers see the requested URL and the same evidence as the judge, but not the provider or the judge's verdict.`
                    : "Each week we hand-check a random sample of judged pages. Reviewers see the requested URL and the same evidence as the judge, but not the provider or the judge's verdict. No audit has been published for this scoring rule yet; agreement will appear here once it has."}
                </p>
              </details>
              <details>
                <summary>Fresh content and cache checks</summary>
                <p>
                  Every request asks for a fresh fetch, and every response is checked for the provider&apos;s own record of
                  where the content came from. A response that a provider marks as served from cache is left out of the
                  scores and latency instead of being counted as a success.
                </p>
                <Table
                  label="How each provider's cache status is checked"
                  headers={["Provider", "Fresh-content setting", "Response field checked"]}
                  rows={[
                    ["context", "maxAgeMs: 0", "cache_metadata.status, cache_metadata.age_ms"],
                    ["exa", "maxAgeHours: 0", "statuses[].source"],
                    ["firecrawl", "maxAge: 0, storeInCache: false", "metadata.cacheState"],
                    ["keenable", "live=true", "usage.sku must be fetch.live"],
                  ].map(([id, setting, field]) => ({ id, cells: [<Name key={id} id={id} />, <code key="s">{setting}</code>, <code key="f">{field}</code>] }))}
                />
              </details>
              <details open>
                <summary>Request settings for each provider</summary>
                <p>Each provider&apos;s API is different, so these are the closest equivalent settings. Any change to them is logged in the repository with the date it took effect.</p>
                <Table
                  label="Request settings"
                  headers={["Provider", "Endpoint", "Fresh content", "Content", "Deadline"]}
                  rows={[
                    ["context", "/v1/web/scrape", "maxAgeMs: 0", "Main content only", "27 s"],
                    ["exa", "/contents", "maxAgeHours: 0", "Full text", "27 s"],
                    ["firecrawl", "/v2/scrape", "maxAge: 0, storeInCache: false", "Main content only", "27 s"],
                    ["keenable", "/v1/fetch", "live=true", "Default", "30 s cutoff (no setting)"],
                  ].map(([id, endpoint, fresh, content, deadline]) => ({
                    id,
                    cells: [<Name key={id} id={id} />, <code key="e">{endpoint}</code>, <code key="f">{fresh}</code>, content, deadline],
                  }))}
                />
                <p>All outputs are limited to 250,000 characters.</p>
              </details>
              <details>
                <summary>Deadlines, timeouts, and rate limits</summary>
                <p>
                  Each request has a 30-second hard cutoff on our side. context.dev, Exa, and Firecrawl are also asked to give up
                  at 27 seconds. Providers report a missed deadline in different ways: an HTTP 408, an empty failure, or our
                  cutoff. All of them count as timeouts.
                </p>
                <p>
                  Scheduled collection checks every fifteen minutes, and workers continue through the queued sample.
                  Limits are 4,000 requests per provider per UTC day, plus a separate grading budget. HTTP 401, 402, and
                  429 responses pause the affected provider across workers.
                  Results reflect our own account plans, and requests those limits reject are excluded from scores.
                  Interrupted requests are not automatically repeated, which avoids giving a provider extra
                  attempts at the same page.
                </p>
              </details>
              <details>
                <summary>Reruns, duplicate days, and retention</summary>
                <p>
                  {duplicateDays.length
                    ? `${duplicateDays.map(([d, n]) => `${longDate(d)} has ${n} runs`).join("; ")}. The most recently created run for a day is shown, and every run is in the downloadable summaries.`
                    : "Every sampled day has exactly one run."}
                </p>
                <p>
                  Grading evidence (the excerpts the judge reads) is compressed and kept for 30 days so samples can be
                  regraded and audited. Page-level records are kept for 180 days, and daily summaries are kept permanently.
                  Raw responses are not published.
                </p>
              </details>
              <details>
                <summary>Daily collection and Wikipedia discovery</summary>
                {run && run.pages < run.target && (
                  <p>
                    The selected daily run collected {integer(run.pages)} of {integer(run.target)} targeted pages. In the
                    unfiltered daily-only view, a missing category withholds the overall score.
                  </p>
                )}
                <p>
                  Wikipedia discovery runs once before the daily sample is created, using up to 1,200 non-bot article edits
                  spread across the previous UTC day. We compare the old and new revision text. Only new external URLs
                  that have not been tested before are eligible. The daily sample includes up to 300 of these pages in the
                  Other category, without inferring their subject from the citing article. This is a sample of edits, not
                  every link added to Wikipedia. If discovery fails, the other sources can still form the daily sample, and
                  Wikipedia is checked again the next day.
                </p>
                <p>
                  This group receives the same weight as each other category when present; missing Wikipedia pages do not
                  suppress the eight-category daily score.
                </p>
              </details>
              <details>
                <summary>Known limitations</summary>
                <p>
                  The sample is drawn from sources we chose; it is not a random sample of the web. The judge can make
                  mistakes, which is why its agreement with human reviewers is published. Provider rate limits, request
                  budgets, and the number of available pages can reduce a daily sample. Latency is measured from one
                  region with caching turned off, which is slower than many real workloads.
                </p>
                {data.collecting && data.collecting.day >= firstSampleDay && data.collecting.id !== run?.id && (
                  <p>
                    Collection for {data.collecting.day} is in progress, with{" "}
                    {integer(data.collecting.providers.reduce((n, p) => n + p.total - p.pending, 0))} of{" "}
                    {integer(data.collecting.pages * providers.length)} results ready.
                  </p>
                )}
                <p>
                  {data.health.healthySources} of {data.health.sources} sources last fetched successfully. Last collector update:{" "}
                  {utcTime(data.health.lastTick) ?? "not yet recorded"}.{data.health.error && ` ${data.health.error}`}
                </p>
              </details>
            </div>
          </Frame>

          <Frame
            id="data"
            index={12}
            method
            eyebrow="Data & API"
            title="Check our"
            accent="work"
            lede="Every number on this page comes from public records you can download. Each record has the URL, provider, timing, HTTP status, judge verdict, and a hash of the returned text."
          >
            <div className="bench-split">
              <ul className="bench-downloads">
                <li>
                  <span>Filtered results for this view</span>
                  <button type="button" onClick={download} disabled={!run}>JSON <Download aria-hidden="true" /></button>
                </li>
                {run && (
                  <li>
                    <span>Every page-level record for {run.day}</span>
                    <a href={`/api/download?run=${encodeURIComponent(run.id)}`}>NDJSON <Download aria-hidden="true" /></a>
                  </li>
                )}
                <li>
                  <span>Daily summaries with intervals</span>
                  <a href="/api/report">JSON <ArrowRight aria-hidden="true" /></a>
                </li>
                <li>
                  <span>Judge prompts and request settings</span>
                  <a href={`${repo}/blob/main/src/lib/benchmark/providers.ts`}>GitHub ↗</a>
                </li>
                <li>
                  <span>Full source code</span>
                  <a href={repo}>MIT license ↗</a>
                </li>
                <li>
                  <span>Plain-text summary for AI assistants</span>
                  <a href="/llms.txt">llms.txt <ArrowRight aria-hidden="true" /></a>
                </li>
              </ul>
              <CodeWindow label="report.sh">
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="API example">
                  <CodeBlock
                    code={`curl -s https://trace.context.dev/api/report \\\n  | jq '.latest.providers[] | {id, rate, ci, p50, p95}'`}
                    className="[&_span]:whitespace-pre-wrap [&_span]:wrap-anywhere"
                  />
                </div>
              </CodeWindow>
            </div>
          </Frame>

          <Frame id="faq" index={13} method eyebrow="FAQ" title="Common" accent="questions">
            <div className="bench-faq">
              {faqItems(view).map((item) => (
                <div key={item.q}>
                  <h3>{item.q}</h3>
                  <p>{item.a}</p>
                </div>
              ))}
            </div>
          </Frame>

          <Frame
            id="citation"
            index={14}
            method
            eyebrow="Citation"
            title="Cite the"
            accent="benchmark"
            lede={
              <>
                If you use TRACE in your work, please cite:
              </>
            }
          >
            <div className="bench-split">
              <p className="bench-note">
                Our approach is inspired by{" "}
                <a href="https://keenableai.github.io/needle/">NEEDLE: A Live Open-Source Search Benchmark for AI Agents</a>{" "}
                (2026), by Andrey Styskin, Matthias Petri, and Ilya Gusev. Its fresh-query methodology and transparent
                comparisons informed this benchmark, which evaluates scraping rather than search.
              </p>
              <div className="flex min-w-0 flex-col gap-3">
                <CodeWindow
                  label="trace.bib"
                  windowClassName="[&>div:first-child]:flex-wrap"
                  actions={
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
                  }
                >
                  <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="BibTeX citation">
                    <CodeBlock code={citation} className="[&_span]:whitespace-pre-wrap [&_span]:wrap-anywhere" />
                  </div>
                </CodeWindow>
                <span className={!copyStatus || copyStatus === "Copied" ? "sr-only" : "bench-note"} role="status">
                  {copyStatus}
                </span>
              </div>
            </div>
          </Frame>
        </main>
        <footer className="bench-footer">
          <p>
            Published by <a href="https://context.dev">context.dev</a> to compare how reliably scraping APIs access content
            from a shared sample of web pages.
          </p>
          <p className="bench-footer-links">
            <a href={repo}>GitHub</a>
            <a href="#data">Data</a>
            <a href="/llms.txt">llms.txt</a>
          </p>
        </footer>
      </div>
    </Surface>
  );
}
