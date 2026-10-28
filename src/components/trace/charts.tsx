"use client";

import * as React from "react";

import { isNumber, percent } from "@/lib/trace/format";
import { cn } from "@/lib/utils";

import { MeterDot } from "./chart-kit";
import { MONO, toneFor } from "./chart-utils";
import { ProviderLogo } from "./provider-logo";

export type ChartProvider = { id: string; name: string };
export type ScoreDatum = ChartProvider & { value: number | null; note?: string };

export function ScoreColumns({ data, xTitle = "Provider", yTitle = "Useful content (%)" }: { data: ScoreDatum[]; xTitle?: string; yTitle?: string }) {
  const rows = [...data].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return (
    <div role="group" aria-label={`${yTitle} by ${xTitle.toLowerCase()}`} className="flex flex-col gap-5 py-3">
      <div className="grid grid-cols-[6rem_minmax(0,1fr)_3rem] gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_4rem] sm:gap-6">
        <span className="sr-only">{xTitle}</span>
        <div className="col-start-2 flex justify-between font-mono text-caption tabular-nums text-fg-muted">
          {[0, 25, 50, 75, 100].map((tick) => (
            <span key={tick} className={tick === 25 || tick === 75 ? "max-sm:hidden" : undefined}>
              {tick}%
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <React.Fragment key={row.id}>
            <span className="col-start-1 flex items-center gap-2 text-body-sm text-fg">
              <ProviderLogo id={row.id} className="size-4 shrink-0" />
              {row.name}
            </span>
            <div
              role="img"
              aria-label={`${row.name}: ${isNumber(row.value) ? percent(row.value) : "score unavailable"}${row.note ? `, ${row.note}` : ""}`}
              className="relative h-7 overflow-hidden rounded-control bg-subtle"
            >
              {isNumber(row.value) && (
                <div
                  className={cn("h-full rounded-control", toneFor(row.id).solid)}
                  style={{ width: `${Math.max(0, Math.min(100, row.value * 100))}%` }}
                />
              )}
            </div>
            <span className="self-center text-right font-mono text-body-sm tabular-nums text-fg">
              {isNumber(row.value) ? percent(row.value) : "—"}
            </span>
          </React.Fragment>
        ))}
      </div>
      <p className="text-center text-caption text-fg-muted">{yTitle}</p>
    </div>
  );
}

export type GroupDatum = { id: string; label: string; values: Record<string, { rate: number | null; success: number; count: number } | undefined> };

export function PageTypeChart({ providers, groups }: { providers: ChartProvider[]; groups: GroupDatum[] }) {
  return (
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
      {groups.map((group) => (
        <div key={group.id}>
          <h3 className="mb-3 flex items-baseline justify-between gap-3 text-body font-medium">{group.label}<span className="text-caption font-normal text-fg-muted">{Math.max(0, ...providers.map(provider => group.values[provider.id]?.count ?? 0)).toLocaleString("en-US")} pages</span></h3>
          {providers.every((provider) => !group.values[provider.id]?.count) && <p className="text-body-sm text-fg-muted">No pages were collected in this category.</p>}
          <ScoreColumns
            data={providers.map((provider) => ({
              ...provider,
              value: group.values[provider.id]?.rate ?? null,
              note: group.values[provider.id] ? `${group.values[provider.id]!.success} useful of ${group.values[provider.id]!.count} pages` : "No pages collected",
            }))}
            yTitle="Useful content (%)"
          />
        </div>
      ))}
    </div>
  );
}

export function MeterChart({
  data,
  format,
  xTitle,
  yTitle = "Provider",
  tipSuffix = "",
}: {
  data: ScoreDatum[];
  format: (value: number) => string;
  xTitle: string;
  yTitle?: string;
  tipSuffix?: string;
}) {
  const rows = [...data].sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity));
  const max = Math.max(1, ...rows.map((row) => row.value ?? 0));
  return (
    <div role="group" aria-label={`${xTitle} by ${yTitle.toLowerCase()}`} className="flex flex-col gap-4">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[6rem_minmax(0,1fr)_4rem] items-center gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_4rem]">
          <span className="flex items-center gap-2 text-body-sm">
            <ProviderLogo id={row.id} className="size-4" />
            {row.name}
          </span>
          <div
            role="img"
            aria-label={`${row.name}: ${isNumber(row.value) ? format(row.value) : "unavailable"}${tipSuffix}`}
            className="h-7 overflow-hidden rounded-control bg-subtle"
          >
            {isNumber(row.value) && (
              <div className={cn("h-full rounded-control", toneFor(row.id).solid)} style={{ width: `${(row.value / max) * 100}%` }} />
            )}
          </div>
          <span className="text-right text-body-sm tabular-nums">{isNumber(row.value) ? format(row.value) : "—"}</span>
        </div>
      ))}
      <p className="text-center text-caption text-fg-muted">{xTitle}; bars start at zero.</p>
    </div>
  );
}

/** A small meter for a table cell: ten dots, one per 10 percent. */
export function MiniMeter({ value, providerId, dots = 10 }: { value: number | null | undefined; providerId: string; dots?: number }) {
  const tone = toneFor(providerId);
  const filled = isNumber(value) ? Math.round(value * dots) : 0;
  return (
    <span aria-hidden="true" className="inline-grid w-16 gap-px" style={{ gridTemplateColumns: `repeat(${dots}, minmax(0, 1fr))` }}>
      {Array.from({ length: dots }, (_, step) => (
        <MeterDot key={step} solid={step < filled} tone={tone} className="max-w-1.5" />
      ))}
    </span>
  );
}

/** The providers in the order their marks appear, each by logo and name. */
export function ChartLegend({ providers }: { providers: ChartProvider[] }) {
  return (
    <ul aria-label="Legend" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
      {providers.map((provider) => (
        <li key={provider.id} className={cn("flex items-center gap-1.5 text-axis", MONO, "text-fg-secondary")}>
          <span aria-hidden="true" className={cn("size-2 rounded-pill border", toneFor(provider.id).solid)} />
          <ProviderLogo id={provider.id} className="size-3.5" />
          {provider.name}
        </li>
      ))}
    </ul>
  );
}
