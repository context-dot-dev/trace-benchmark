"use client";

import * as React from "react";

import { Card } from "@/components/ui/card";
import { count, isNumber, percent } from "@/lib/trace/format";
import type { Pair } from "@/lib/trace/types";
import { cn } from "@/lib/utils";

import { CellDetail, DataTable } from "../data-table";
import { OURS, ProviderName } from "../provider-logo";
import type { ReportModel } from "../report-model";
import { Fine, ReportSection } from "../report-section";

export function PageTypesSection({ model }: { model: ReportModel }) {
  const providers = model.summary.providers;
  return (
    <ReportSection id="page-types" title="Different pages," accent="different results" description="An average hides the hard parts. Compare useful-content rates across page types to find the fit for your workload.">
      <DataTable
        caption="Content recovery by page type"
        columns={[
          { key: "type", label: "Page type" },
          ...providers.map((provider) => ({ key: provider.id, label: <ProviderName id={provider.id} name={provider.name} className="text-body-sm" logoClassName="size-4 max-sm:size-5" logoOnlyOnPhones />, align: "right" as const, highlight: provider.id === OURS })),
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
                  <span key={provider.id} title={result ? `${result.success} useful pages out of ${result.count}` : undefined} className={cn("inline-flex w-10 justify-end", provider.id === OURS ? "text-fg-brand" : "text-fg", !isNumber(result?.rate) && "text-fg-subtle")}>{isNumber(result?.rate) ? `${Math.round(result.rate * 100)}%` : "—"}</span>,
                ];
              }),
            ),
          },
        }))}
        footnote="Same selected page set as above. Each cell is the share of page tests with useful content."
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
    both: "#6d7f70",
    first: "#a5b6a2",
    second: "#8295bb",
    neither: "#b0afb1",
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
            className={cn("pointer-events-none absolute z-20 whitespace-nowrap rounded-control bg-inverse px-2 py-1 font-mono text-axis leading-4 text-fg-inverse shadow-tooltip", hoveredSegment.leftSide ? "-translate-x-full -translate-y-1/2" : "-translate-y-1/2")}
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
            const contextOnly = (segment.key === "first" && aOurs) || (segment.key === "second" && bOurs);
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
                      : contextOnly
                        ? "var(--ds-color-bg-brand)"
                        : segmentColor[segment.key],
                }}
              />
            );
          })}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {segments.filter((segment) => segment.key !== "unknown" || segment.value > 0).map((segment) => (
          <div key={segment.key} className="flex min-w-0 items-center justify-between gap-2 border-t border-line-subtle pt-2">
            <dt className="min-w-0 text-body-sm text-fg-muted">{segment.label}</dt>
            <dd className={cn("shrink-0 text-body-sm tabular-nums", (segment.key === "first" && aOurs) || (segment.key === "second" && bOurs) ? "text-fg-brand" : "text-fg")}>{count(segment.value)}</dd>
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
    <ReportSection id="head-to-head" title="What does one" accent="scraper miss?" description="Two providers can have the same score and recover different pages. These pairs show where their coverage overlaps.">
      <div className="grid gap-6 p-2 sm:grid-cols-2">
        {(model.group?.pairs ?? []).map((pair) => (
          <PairCard key={`${pair.a.id}-${pair.b.id}`} pair={pair} />
        ))}
      </div>
      <Fine>Bar segments show the share of matched pages each provider pair both recovered, recovered alone, missed, or could not resolve.</Fine>
    </ReportSection>
  );
}

export function BestOutputSection({ model }: { model: ReportModel }) {
  const comparisons = model.group?.comparisons;
  const resolved = comparisons?.resolved ?? 0;
  const pending = (comparisons?.pending ?? 0) + (comparisons?.pending_budget ?? 0) + (comparisons?.dispatched ?? 0);
  return (
    <ReportSection
      id="coverage"
      title="Who returns the"
      accent="best output?"
      description="Compare the fresh responses directly. Jev compares anonymous outputs for useful detail, coverage and cleanliness. Identical text ties automatically. Extra length alone does not win."
    >
      <p className="text-body-sm text-fg-muted">
        {resolved} comparable pages · {comparisons?.single_source ?? 0} with only one useful response · {comparisons?.no_useful_output ?? 0} with none · {(comparisons?.incomplete ?? 0) + (comparisons?.unresolved ?? 0)} unresolved · {pending} pending
      </p>
      {resolved || comparisons?.single_source ? (
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
              provider: <ProviderName id={row.id} name={row.name} logoOnlyOnPhones />,
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
      ) : (
        <p className="text-body text-fg-muted">Output comparisons are not available for these results yet.</p>
      )}
      <Fine>
        Best among the observed outputs, not verified ground truth. Ties count for each winning provider. Pages with missing, uncertain, cached or non-contemporaneous evidence do not enter this comparison. The useful-content score above still
        includes every selected page.
      </Fine>
    </ReportSection>
  );
}
