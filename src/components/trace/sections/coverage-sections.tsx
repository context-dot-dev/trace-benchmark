"use client";

import * as React from "react";

import { Card } from "@/components/ui/card";
import { count, isNumber, percent } from "@/lib/trace/format";
import type { Pair } from "@/lib/trace/types";
import { cn } from "@/lib/utils";

import { TabbedPanel } from "../panel";
import { PageTypeChart, ScoreColumns } from "../charts";
import { CellDetail, DataTable } from "../data-table";
import { OURS, ProviderName } from "../provider-logo";
import type { ReportModel } from "../report-model";
import { Fine, ReportSection } from "../report-section";

export function PageTypesSection({ model }: { model: ReportModel }) {
  const providers = model.summary.providers;
  return (
    <ReportSection
      id="page-types"
      title="Different pages,"
      accent="different results"
      description="Compare useful-content rates across all eight page types to understand which providers fit your workload and where the sample is incomplete."
    >
      <TabbedPanel
        label="Page type view"
        tabs={[
          {
            id: "chart",
            label: "Chart",
            content: (
              <PageTypeChart
                providers={providers}
                groups={(model.group?.pageTypes ?? []).map((type) => ({ id: type.id, label: model.categoryName(type.id), values: type.results }))}
              />
            ),
          },
          {
            id: "table",
            label: "Table",
            content: (
              <>
                <DataTable
                  caption="Content recovery by page type"
                  columns={[
                    { key: "type", label: "Page type" },
                    ...providers.map((provider) => ({
                      key: provider.id,
                      label: <ProviderName id={provider.id} name={provider.name} className="text-body-sm" logoClassName="size-4 max-sm:size-5" />,
                      align: "right" as const,
                      highlight: provider.id === OURS,
                    })),
                  ]}
                  rows={(model.group?.pageTypes ?? []).map((type) => ({
                    key: type.id,
                    cells: {
                      type: model.categoryName(type.id),
                      ...Object.fromEntries(
                        providers.map((provider) => {
                          const result = type.results[provider.id];
                          return [
                            provider.id,
                            <span
                              key={provider.id}
                              title={result ? `${result.success} useful pages out of ${result.count}` : undefined}
                              className={cn("inline-block text-right", provider.id === OURS ? "text-fg-brand" : "text-fg", !isNumber(result?.rate) && "text-fg-subtle")}
                            >
                              {isNumber(result?.rate) ? `${Math.round(result.rate * 100)}%` : "No pages"}
                              <CellDetail>
                                {count(result?.success)} / {count(result?.count)}
                              </CellDetail>
                            </span>,
                          ];
                        }),
                      ),
                    },
                  }))}
                  footnote="Same selected page set as above. Each cell is the share of page tests with useful content."
                />
              </>
            ),
          },
        ]}
      />
    </ReportSection>
  );
}

function PairCard({ pair }: { pair: Pair }) {
  const [hoveredSegment, setHoveredSegment] = React.useState<{ label: string; value: number; x: number; y: number; leftSide: boolean } | null>(null);
  const aOurs = pair.a.id === OURS;
  const bOurs = pair.b.id === OURS;
  const segments = [
    { key: "both", label: "Both", value: pair.both },
    { key: "first", label: `${pair.a.name} only`, value: pair.first_only },
    { key: "second", label: `${pair.b.name} only`, value: pair.second_only },
    { key: "neither", label: "Neither", value: pair.neither },
    { key: "unknown", label: "Unresolved", value: pair.unknown },
  ];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const segmentColor: Record<string, string> = {
    both: "var(--ds-color-bg-brand)",
    first: "#60a5fa",
    second: "#64748b",
    neither: "#cbd5e1",
  };
  return (
    <Card variant="ring" className="gap-5 p-5 md:p-6">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
        <ProviderName id={pair.a.id} name={pair.a.name} />
        <span className="text-body-sm text-fg-secondary">vs.</span>
        <ProviderName id={pair.b.id} name={pair.b.name} />
      </p>
      <div className="relative" onMouseLeave={() => setHoveredSegment(null)}>
        {hoveredSegment && (
          <span
            role="tooltip"
            className={cn(
              "pointer-events-none absolute z-20 whitespace-nowrap rounded-control bg-inverse px-2 py-1 font-mono text-axis leading-4 text-fg-inverse shadow-tooltip",
              hoveredSegment.leftSide ? "-translate-x-full -translate-y-1/2" : "-translate-y-1/2",
            )}
            style={{ left: hoveredSegment.x, top: hoveredSegment.y }}
          >
            {hoveredSegment.label}: {count(hoveredSegment.value)}
          </span>
        )}
        <div
          role="img"
          aria-label={`${pair.a.name} vs. ${pair.b.name}: both ${pair.both}, ${pair.a.name} only ${pair.first_only}, ${pair.b.name} only ${pair.second_only}, neither ${pair.neither}, unresolved ${pair.unknown}`}
          className="flex h-3 w-full overflow-hidden rounded-pill bg-subtle"
        >
          {segments.map((segment) => {
            return (
              <span
                key={segment.key}
                className="h-full min-w-0"
                onMouseEnter={(event) => {
                  const bounds = event.currentTarget.parentElement!.parentElement!.getBoundingClientRect();
                  const x = event.clientX - bounds.left;
                  const leftSide = x >= bounds.width / 2;
                  setHoveredSegment({ ...segment, x: x + (leftSide ? -12 : 12), y: event.clientY - bounds.top, leftSide });
                }}
                onMouseMove={(event) => {
                  const bounds = event.currentTarget.parentElement!.parentElement!.getBoundingClientRect();
                  const x = event.clientX - bounds.left;
                  const leftSide = x >= bounds.width / 2;
                  setHoveredSegment({ ...segment, x: x + (leftSide ? -12 : 12), y: event.clientY - bounds.top, leftSide });
                }}
                style={{
                  width: total ? `${(segment.value / total) * 100}%` : "0%",
                  background:
                    segment.key === "unknown"
                      ? "repeating-linear-gradient(135deg, var(--ds-color-border-default), var(--ds-color-border-default) 2px, var(--ds-color-bg-default) 2px, var(--ds-color-bg-default) 4px)"
                      : segmentColor[segment.key],
                }}
              />
            );
          })}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {segments
          .filter((segment) => segment.key !== "unknown" || segment.value > 0)
          .map((segment) => (
            <div key={segment.key} className="flex min-w-0 items-center justify-between gap-2 border-t border-line-subtle pt-2">
              <dt className="flex min-w-0 items-center gap-2 text-body-sm text-fg-muted">
                <span aria-hidden="true" className="size-3 shrink-0 rounded-sm border border-line" style={{ background: segmentColor[segment.key] }} />
                {segment.label}
              </dt>
              <dd className={cn("shrink-0 text-body-sm tabular-nums", (segment.key === "first" && aOurs) || (segment.key === "second" && bOurs) ? "text-fg-brand" : "text-fg")}>
                {count(segment.value)}
              </dd>
            </div>
          ))}
      </dl>
      <p className="text-body-sm text-fg-muted">
        {pair.unknown} unresolved · {count(pair.count)} matched page tests
      </p>
    </Card>
  );
}

export function OverlapSection({ model }: { model: ReportModel }) {
  return (
    <ReportSection
      id="head-to-head"
      title="What does one"
      accent="scraper miss?"
      description="Two providers can have the same score and recover different pages. These pairs show where their coverage overlaps."
    >
      <TabbedPanel
        label="Provider overlap view"
        tabs={[
          {
            id: "chart",
            label: "Chart",
            content: (
              <>
                <div className="grid gap-6 p-2 sm:grid-cols-2">
                  {(model.group?.pairs ?? []).map((pair) => (
                    <PairCard key={`${pair.a.id}-${pair.b.id}`} pair={pair} />
                  ))}
                </div>
              </>
            ),
          },
          {
            id: "table",
            label: "Table",
            content: (
              <DataTable
                caption="Provider overlap counts"
                columns={[
                  { key: "pair", label: "Providers (A / B)" },
                  { key: "both", label: "Both useful", align: "right" },
                  { key: "first", label: "A only", align: "right" },
                  { key: "second", label: "B only", align: "right" },
                  { key: "neither", label: "Neither", align: "right" },
                  { key: "unknown", label: "Unresolved", align: "right" },
                  { key: "total", label: "Total", align: "right" },
                ]}
                rows={(model.group?.pairs ?? []).map((pair) => ({
                  key: `${pair.a.id}-${pair.b.id}`,
                  cells: {
                    pair: `${pair.a.name} / ${pair.b.name}`,
                    both: count(pair.both),
                    first: count(pair.first_only),
                    second: count(pair.second_only),
                    neither: count(pair.neither),
                    unknown: count(pair.unknown),
                    total: count(pair.count),
                  },
                }))}
              />
            ),
          },
        ]}
      />
      <Fine>Bar segments show the share of matched pages each provider pair both recovered, recovered alone, missed, or could not resolve.</Fine>
    </ReportSection>
  );
}

export function BestOutputSection({ model }: { model: ReportModel }) {
  const comparisons = model.group?.comparisons;
  const resolved = comparisons?.resolved ?? 0;
  const selected = model.group?.uniqueUrls ?? 0;
  const pending = (comparisons?.pending ?? 0) + (comparisons?.pending_budget ?? 0) + (comparisons?.dispatched ?? 0);
  return (
    <ReportSection
      id="coverage"
      title="Observed output"
      accent="preferences"
      description="Jev compares fresh, anonymous responses for useful detail, coverage and cleanliness, with identical text counted as a tie and no advantage for extra length alone."
    >
      <p className="text-body text-fg">
        {count(resolved)} of {count(selected)} selected pages ({percent(selected ? resolved / selected : null)}) have a resolved comparison.
        {" "}These rankings describe that subset; unresolved pages may change the ordering. A 0% share means no wins in this subset, not that the provider returned no useful content.
      </p>
      <p className="text-body-sm text-fg-muted">
        {resolved} comparable pages · {comparisons?.single_source ?? 0} with only one useful response · {comparisons?.no_useful_output ?? 0} with none ·{" "}
        {(comparisons?.incomplete ?? 0) + (comparisons?.unresolved ?? 0)} unresolved · {pending} pending
      </p>
      {resolved || comparisons?.single_source ? (
        <TabbedPanel
          label="Best output view"
          tabs={[
            {
              id: "chart",
              label: "Chart",
              content: <>
                <ScoreColumns data={model.rows.map((row) => ({ id: row.id, name: row.name, value: row.bestRate, note: `${row.bestObserved} best or tied out of ${row.compared} compared pages` }))} yTitle="Best or tied share of compared pages (%)" />
                <p className="text-body-sm text-fg-muted">{model.rows.map(row => `${row.name}: ${count(row.bestObserved)} / ${count(row.compared)}`).join(" · ")} best or tied.</p>
              </>,
            },
            {
              id: "table",
              label: "Table",
              content: (
                <>
                  <DataTable
                    caption="Best observed output"
                    columns={[
                      { key: "provider", label: "Provider" },
                      { key: "best", label: "Best or tied", align: "right" },
                      { key: "share", label: "Share", align: "right" },
                      { key: "only", label: "Only useful", align: "right" },
                    ]}
                    rows={model.rows.map((row) => ({
                      key: row.id,
                      cells: {
                        provider: <ProviderName id={row.id} name={row.name} />,
                        best: (
                          <>
                            {row.bestObserved || 0}
                            <CellDetail>of {row.compared || 0} compared</CellDetail>
                          </>
                        ),
                        share: <span className={cn(row.id === OURS && "text-fg-brand")}>{percent(row.bestRate)}</span>,
                        only: row.soleUseful || 0,
                      },
                    }))}
                  />
                </>
              ),
            },
          ]}
        />
      ) : (
        <p className="text-body text-fg-muted">Output comparisons are not available for these results yet.</p>
      )}
      <Fine>
        The extraction settings differ: Context requests whole-page text while Firecrawl requests main content, and the judge considers cleanliness as well as coverage.
        {" "}
        Best among the observed outputs, not verified ground truth. Ties count for each winning provider. Pages with missing, uncertain, cached or non-contemporaneous evidence do
        not enter this comparison. The useful-content score above still includes every selected page.
      </Fine>
    </ReportSection>
  );
}
