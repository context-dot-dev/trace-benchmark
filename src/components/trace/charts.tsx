"use client";

import * as React from "react";

import { isNumber, percent } from "@/lib/trace/format";
import { cn } from "@/lib/utils";

import { AxisFrame, ChartRings, MarkTip, MeterDot } from "./chart-kit";
import { AXIS, DOT_STAGGER_MS, MONO, toneFor, useElementWidth, useGrowIn } from "./chart-utils";
import { OURS, ProviderLogo } from "./provider-logo";

export type ChartProvider = { id: string; name: string };
export type ScoreDatum = ChartProvider & { value: number | null; note?: string };

const STEPS = 20;
const PERCENT_TICKS = [0, 25, 50, 75, 100];

function PercentTicks() {
  return PERCENT_TICKS.map((tick) => (
    <span key={tick} className={cn("absolute -left-9 translate-y-1/2", AXIS)} style={{ bottom: `${tick}%` }}>
      {tick}%
    </span>
  ));
}

/** One wide dot column per provider, one step per 5 percent, highest first. A withheld score stays hollow. */
export function ScoreColumns({ data, xTitle = "Provider", yTitle = "Useful content (%)" }: { data: ScoreDatum[]; xTitle?: string; yTitle?: string }) {
  const { ref, shown } = useGrowIn();
  const rows = [...data].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const allWithheld = rows.length > 0 && rows.every((row) => !isNumber(row.value));
  return (
    <AxisFrame y={yTitle} x={xTitle} xInset="ml-9">
      <div ref={ref} className="flex flex-col gap-3">
        <div className="relative mt-12 ml-9 h-64 sm:h-72">
          <ChartRings className="hidden sm:block" />
          {allWithheld && (
            <div className="absolute inset-0 z-20 flex items-center justify-center">
              <p className="max-w-72 rounded-card bg-surface px-4 py-3 text-center text-body-sm text-fg-muted shadow-floating">
                <span className="block text-body text-fg">Scores withheld</span>
                A page type has no pages in this sample, so no overall score is published.
              </p>
            </div>
          )}
          <PercentTicks />
          <div className="absolute inset-x-0 -bottom-px z-10 border-t border-node" />
          <div className="absolute inset-0 flex items-end justify-around gap-3 px-2 sm:gap-8 sm:px-6">
            {rows.map((row, index) => {
              const tone = toneFor(row.id);
              const filled = isNumber(row.value) ? Math.round(row.value * STEPS) : 0;
              const label = isNumber(row.value) ? percent(row.value) : "—";
              return (
                <div key={row.id} tabIndex={0} aria-label={`${row.name}: ${isNumber(row.value) ? label : "score withheld"}${row.note ? `, ${row.note}` : ""}`} data-chart-mark className="group/mark relative h-full w-full max-w-20 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
                  <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col items-center gap-1">
                    <span className={cn("bg-surface px-1 leading-none tabular-nums", !isNumber(row.value) ? "font-mono text-body-sm text-fg-muted" : row.id === OURS ? "font-mono text-body-sm text-fg-brand sm:text-body" : "font-mono text-body-sm text-fg-secondary sm:text-body")}>{label}</span>
                  </div>
                  <div className="grid h-full grid-cols-4 gap-x-0.5 bg-surface px-0.5" style={{ gridTemplateRows: `repeat(${STEPS}, minmax(0, 1fr))` }}>
                    {Array.from({ length: STEPS * 4 }, (_, cell) => {
                      const step = STEPS - 1 - Math.floor(cell / 4);
                      return <MeterDot key={cell} solid={shown && step < filled} tone={tone} delay={index * 90 + step * DOT_STAGGER_MS} />;
                    })}
                  </div>
                  <MarkTip className={cn("bottom-1/2", index === 0 ? "left-0" : index === rows.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2")}>
                    {row.name}: {isNumber(row.value) ? label : "withheld"}
                    {row.note ? ` · ${row.note}` : ""}
                  </MarkTip>
                </div>
              );
            })}
          </div>
        </div>
        <div className="ml-9 flex justify-around gap-3 px-2 sm:gap-8 sm:px-6">
          {rows.map((row) => (
            <span key={row.id} className={cn("flex w-full max-w-20 flex-col items-center gap-1.5 text-center text-axis sm:text-caption", MONO, row.id === OURS ? "text-fg-brand" : "text-fg-secondary")}>
              <ProviderLogo id={row.id} className="size-4" />
              {row.name}
            </span>
          ))}
        </div>
      </div>
    </AxisFrame>
  );
}

export type GroupDatum = { id: string; label: string; values: Record<string, { rate: number | null; success: number; count: number } | undefined> };

/** Grouped dot columns by page type (the landing page's success chart); on phones, a meter per provider under each type. */
export function PageTypeChart({ providers, groups }: { providers: ChartProvider[]; groups: GroupDatum[] }) {
  const { ref, shown } = useGrowIn();
  const tip = (provider: ChartProvider, group: GroupDatum) => {
    const value = group.values[provider.id];
    return isNumber(value?.rate) ? `${provider.name} · ${group.label}: ${Math.round(value.rate * 100)}% (${value.success}/${value.count})` : `${provider.name} · ${group.label}: no pages`;
  };

  return (
    <div ref={ref}>
      <div className="hidden lg:block">
        <AxisFrame y="Useful content (%)" x="Page type" xInset="ml-9">
          <div className="flex flex-col gap-3">
            <div className="relative mt-12 ml-9 h-64 lg:h-72">
              <ChartRings />
              <PercentTicks />
              <div className="absolute inset-x-0 -bottom-px z-10 border-t border-node" />
              <div className="absolute inset-0 flex items-end justify-around gap-3 px-2 lg:gap-6">
                {groups.map((group, g) => (
                  <div key={group.id} className="flex h-full w-full max-w-36 items-end justify-center gap-1 lg:gap-1.5">
                    {providers.map((provider, p) => {
                      const value = group.values[provider.id]?.rate;
                      const filled = isNumber(value) ? Math.round(value * STEPS) : 0;
                      const tone = toneFor(provider.id);
                      return (
                        <div key={provider.id} tabIndex={0} aria-label={tip(provider, group)} data-chart-mark className="group/mark relative h-full w-full max-w-6 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
                          {/* Every column carries its provider's logo and figure, so the neutral columns are told apart without color. */}
                          <span className="absolute bottom-full left-1/2 mb-1.5 flex -translate-x-1/2 flex-col items-center gap-1 bg-surface px-0.5">
                            <ProviderLogo id={provider.id} className="size-3.5" />
                            <span className={cn("font-mono text-axis leading-none tabular-nums", provider.id === OURS ? "text-fg-brand" : "text-fg-secondary")}>{isNumber(value) ? Math.round(value * 100) : "—"}</span>
                          </span>
                          <div className="grid h-full grid-cols-2 gap-x-px bg-surface px-px" style={{ gridTemplateRows: `repeat(${STEPS}, minmax(0, 1fr))` }}>
                            {Array.from({ length: STEPS * 2 }, (_, cell) => {
                              const step = STEPS - 1 - Math.floor(cell / 2);
                              return <MeterDot key={cell} solid={shown && step < filled} tone={tone} delay={g * 70 + p * 40 + step * DOT_STAGGER_MS} />;
                            })}
                          </div>
                          <MarkTip className={cn("bottom-1/2", g === 0 && p === 0 ? "left-0" : g === groups.length - 1 && p === providers.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2")}>{tip(provider, group)}</MarkTip>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="ml-9 flex justify-around gap-3 px-2 lg:gap-6">
              {groups.map((group) => (
                <span key={group.id} className={cn("w-full max-w-36 text-center text-axis leading-snug text-fg-subtle", MONO)}>
                  {group.label}
                </span>
              ))}
            </div>
          </div>
        </AxisFrame>
      </div>

      <ul className="grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:hidden">
        {groups.map((group, g) => (
          <li key={group.id} className="flex flex-col gap-2">
            <span className={cn("text-axis text-fg-subtle", MONO)}>{group.label}</span>
            {providers.map((provider, p) => {
              const value = group.values[provider.id]?.rate;
              const filled = isNumber(value) ? Math.round(value * STEPS) : 0;
              const tone = toneFor(provider.id);
              return (
                <div key={provider.id} role="img" aria-label={tip(provider, group)} className="grid grid-cols-[1rem_minmax(0,1fr)_2.75rem] items-center gap-2">
                  <ProviderLogo id={provider.id} className="size-3.5" />
                  <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${STEPS}, minmax(0, 1fr))` }}>
                    {Array.from({ length: STEPS }, (_, step) => (
                      <MeterDot key={step} solid={shown && step < filled} tone={tone} delay={g * 40 + p * 30 + step * DOT_STAGGER_MS} />
                    ))}
                  </div>
                  <span className={cn("text-right leading-none tabular-nums", !isNumber(value) ? "font-mono text-caption text-fg-muted" : provider.id === OURS ? "font-mono text-caption text-fg-brand" : "font-mono text-caption text-fg-secondary")}>{isNumber(value) ? `${Math.round(value * 100)}%` : "—"}</span>
                </div>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function niceStep(max: number, targetTicks: number) {
  const rough = max / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
}

const METER_DOT_ROWS = 2;
const METER_PITCH_PX = 12;
const METER_PITCH_NARROW_PX = 7;

/** Dot meters, lowest first (the landing page's latency chart), sized to however many dots fit the plot's width. */
export function MeterChart({ data, format, xTitle, yTitle = "Provider", tipSuffix = "" }: { data: ScoreDatum[]; format: (value: number) => string; xTitle: string; yTitle?: string; tipSuffix?: string }) {
  const { ref, shown } = useGrowIn();
  const { ref: plotRef, width } = useElementWidth<HTMLDivElement>(360);
  const steps = Math.max(12, Math.floor(width / (width < 240 ? METER_PITCH_NARROW_PX : METER_PITCH_PX)));
  const rows = [...data].sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity));
  const largest = Math.max(1, ...rows.map((row) => row.value ?? 0));
  const step = niceStep(largest, width < 320 ? 3 : 5);
  const max = Math.ceil(largest / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);

  return (
    <AxisFrame y={yTitle} x={xTitle} xInset="ml-22 mr-14 sm:ml-34 sm:mr-16">
      <div ref={ref} className="flex flex-col gap-2">
        <div className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] sm:grid-cols-[8.5rem_minmax(0,1fr)]">
          <div className="flex flex-col justify-around gap-4 py-3 pr-2 sm:pr-4">
            {rows.map((row) => (
              <span key={row.id} className={cn("flex h-9 items-center justify-end gap-2 text-axis sm:text-caption", MONO, row.id === OURS ? "text-fg-brand" : "text-fg")}>
                <ProviderLogo id={row.id} className="size-4" />
                {row.name}
              </span>
            ))}
          </div>
          <div className="relative flex flex-col justify-around gap-4 border-l border-node py-3 pr-14 sm:pr-16">
            <div aria-hidden="true" className="absolute inset-y-0 right-14 left-0 sm:right-16">
              <ChartRings />
            </div>
            <div ref={plotRef} className="absolute inset-y-0 left-0 right-14 sm:right-16" aria-hidden="true" />
            {rows.map((row, index) => {
              const tone = toneFor(row.id);
              const filled = isNumber(row.value) ? Math.round((row.value / max) * steps) : 0;
              const label = isNumber(row.value) ? format(row.value) : "—";
              return (
                <div key={row.id} tabIndex={0} aria-label={`${row.name}: ${label}${tipSuffix}`} data-chart-mark className="group/mark relative flex h-9 items-center outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
                  <div className="relative grid w-full grid-flow-col gap-0.5 bg-surface py-0.5" style={{ gridTemplateColumns: `repeat(${steps}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${METER_DOT_ROWS}, auto)` }}>
                    {Array.from({ length: steps * METER_DOT_ROWS }, (_, cell) => {
                      const dot = Math.floor(cell / METER_DOT_ROWS);
                      return <MeterDot key={cell} solid={shown && dot < filled} tone={tone} delay={index * 90 + Math.round(DOT_STAGGER_MS * dot ** 0.7)} />;
                    })}
                  </div>
                  <span className={cn("absolute left-full ml-2 bg-surface px-1 leading-none tabular-nums", row.id === OURS ? "font-mono text-caption text-fg-brand sm:text-body-sm" : "font-mono text-caption text-fg-secondary sm:text-body-sm")}>{label}</span>
                  <MarkTip className="bottom-full left-0 mb-1">
                    {row.name}: {label}
                    {tipSuffix}
                  </MarkTip>
                </div>
              );
            })}
          </div>
        </div>
        <div className="relative mr-14 ml-22 h-4 sm:mr-16 sm:ml-34">
          {ticks.map((tick) => (
            <span key={tick} className={cn(AXIS, "absolute -translate-x-1/2 normal-case")} style={{ left: `${(tick / max) * 100}%` }}>
              {format(tick).replace(/\.0+s$/, "s")}
            </span>
          ))}
        </div>
      </div>
    </AxisFrame>
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
        <li key={provider.id} className={cn("flex items-center gap-1.5 text-axis", MONO, provider.id === OURS ? "text-fg-brand" : "text-fg-secondary")}>
          <span aria-hidden="true" className={cn("size-2 rounded-pill border", toneFor(provider.id).solid)} />
          <ProviderLogo id={provider.id} className="size-3.5" />
          {provider.name}
        </li>
      ))}
    </ul>
  );
}
