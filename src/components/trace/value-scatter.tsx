"use client";

import * as React from "react";

import { count, percent } from "@/lib/trace/format";
import type { ProviderPrice } from "@/lib/trace/pricing";
import { cn } from "@/lib/utils";

import { AxisFrame } from "./chart-kit";
import { AXIS, MONO, toneFor, providerColor, spreadLabels, useElementWidth, useGrowIn } from "./chart-utils";
import { ProviderLogo } from "./provider-logo";

const PLOT_HEIGHT = 320;
const LABEL_GAP = 40;
const LABEL_WIDTH = 168;
const COMPACT_LABEL_WIDTH = 80;
const COMPACT_LABEL_HEIGHT = 18;
const TILE = 32;
const LEADER = 36;

const priceLabel = (price: ProviderPrice) => {
  const low = `$${price.comparisonPriceLow!.toFixed(2)}`;
  const high = `$${price.comparisonPrice!.toFixed(2)}`;
  return low === high ? high : `${low}–${high}`;
};

/**
 * Quality against estimated cost per 1,000 attempts: each provider's logo tile at its point, its name and figures in a
 * label beside it on a leader line. Horizontal whiskers are the modeled cost range, vertical ones pending judgments.
 */
export function ValueScatter({ prices, selectedId, onSelect }: { prices: ProviderPrice[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { ref, shown } = useGrowIn();
  const { ref: plotRef, width, measured } = useElementWidth<HTMLDivElement>(640);
  const plotted = prices.filter((price) => price.comparisonPrice !== null && price.quality !== null);
  const selected = plotted.find((price) => price.id === selectedId) ?? plotted[0];

  if (!plotted.length) {
    return (
      <div ref={ref} className="flex flex-col items-center justify-center gap-2 px-4 py-2 text-center">
        <p className="text-body text-fg">{prices.some(price => price.quality !== null) ? "Pricing evidence is incomplete for this page set; inspect the table for the available values." : "A quality–cost comparison needs a complete useful-content score."}</p>
      </div>
    );
  }

  const maxPrice = Math.max(...plotted.map((price) => price.comparisonPrice!), 0.1);
  const magnitude = 10 ** Math.floor(Math.log10(maxPrice));
  const xMax = Math.ceil((maxPrice * 1.2) / magnitude) * magnitude;
  const yMin = Math.max(0, Math.floor((Math.min(...plotted.map((price) => price.quality!), 1) - 0.1) * 10) / 10);
  const toX = (price: number) => (price / xMax) * width;
  const toY = (quality: number) => PLOT_HEIGHT - ((quality - yMin) / (1 - yMin)) * PLOT_HEIGHT;
  const labelYs = spreadLabels(
    plotted.map((price) => toY(price.quality!)),
    LABEL_GAP,
    LABEL_GAP / 2,
    PLOT_HEIGHT - LABEL_GAP / 2,
  );
  // Narrow plots have no room beside a point, so each name sits under its tile with no leader and the card below carries
  // the figures.
  const compact = width < 2 * LABEL_WIDTH;
  // A name moves above its tile when another provider's tile would cover it below.
  const compactLabel = (price: ProviderPrice) => {
    const x = toX(price.comparisonPrice!);
    const y = toY(price.quality!);
    const left = Math.min(Math.max(x - COMPACT_LABEL_WIDTH / 2, 0), width - COMPACT_LABEL_WIDTH);
    const covered = (top: number) =>
      plotted.some((other) => {
        if (other === price) return false;
        const ox = toX(other.comparisonPrice!);
        const oy = toY(other.quality!);
        return ox + TILE / 2 > left && ox - TILE / 2 < left + COMPACT_LABEL_WIDTH && oy + TILE / 2 > top && oy - TILE / 2 < top + COMPACT_LABEL_HEIGHT;
      });
    const below = y + TILE / 2 + 2;
    const above = y - TILE / 2 - 2 - COMPACT_LABEL_HEIGHT;
    return { left, top: covered(below) && !covered(above) ? above : below };
  };
  // A label sits right of its point unless only the left has room, or neither side does and the left has more. A left
  // label starts past the cost whisker, so it never covers the range it describes. Either way its near edge is clamped so
  // the whole label stays inside the plot.
  const placeLabel = (price: ProviderPrice) => {
    const x = toX(price.comparisonPrice!);
    const low = toX(price.comparisonPriceLow!);
    const roomRight = width - x - LEADER;
    const roomLeft = low - LEADER;
    const fitsRight = roomRight >= LABEL_WIDTH;
    const fitsLeft = roomLeft >= LABEL_WIDTH;
    const left = fitsLeft ? !fitsRight || x > width * 0.55 : !fitsRight && roomLeft > roomRight;
    return left
      ? { left, anchor: low, edge: Math.max(low - LEADER, LABEL_WIDTH) }
      : { left, anchor: x, edge: Math.min(x + LEADER, width - LABEL_WIDTH) };
  };
  const xTicks = [0, 1, 2, 3, 4].map((i) => (xMax * i) / 4);
  const yTicks = [0, 1, 2, 3, 4].map((i) => yMin + ((1 - yMin) * i) / 4);

  return (
    <div ref={ref} className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <span className={cn(AXIS, "normal-case")}>↖ Higher quality, lower cost</span>
      </div>
      <AxisFrame y="Useful content (%)" x="Estimated cost per 1,000 attempts (USD)" xInset="ml-10">
        <div className="flex flex-col gap-2">
          <div className="relative ml-10" style={{ height: PLOT_HEIGHT }}>
            {yTicks.map((tick) => (
              <span key={tick} className={cn("absolute -left-10 -translate-y-1/2", AXIS)} style={{ top: toY(tick) }}>
                {Number((tick * 100).toFixed(1))}%
              </span>
            ))}
            <div className="absolute inset-x-0 -bottom-px z-10 border-t border-node" />
            <div className="absolute inset-y-0 left-0 z-10 border-l border-node" />
            <div ref={plotRef} className="absolute inset-0">
              <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible">
                {/* Points and labels wait for the real width; at the fallback they would sit off the edges of a phone's plot. */}
                {measured && plotted.map((price, index) => {
                  const x = toX(price.comparisonPrice!);
                  const y = toY(price.quality!);
                  const { anchor, edge } = placeLabel(price);
                  return (
                    <g key={price.id} className={cn("transition-opacity duration-300 ease-out motion-reduce:transition-none", toneFor(price.id).stroke)} style={{ opacity: shown ? 1 : 0, transitionDelay: `${index * 90}ms` }}>
                      {/* On narrow plots the cost range is a stub beside the tile that reads as a glitch; the card below gives the range. */}
                      {!compact && price.comparisonPriceLow! < price.comparisonPrice! && <line x1={toX(price.comparisonPriceLow!)} x2={x} y1={y} y2={y} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />}
                      {price.qualityUpper! > price.quality! && <line x1={x} x2={x} y1={toY(price.qualityUpper!)} y2={y} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />}
                      {!compact && <path d={`M${anchor},${y} L${edge},${labelYs[index]}`} stroke="currentColor" strokeWidth={1} strokeDasharray="2 3" fill="none" />}
                    </g>
                  );
                })}
              </svg>
              {measured && plotted.map((price, index) => {
                const x = toX(price.comparisonPrice!);
                const y = toY(price.quality!);
                const label = placeLabel(price);
                const isSelected = price.id === selected?.id;
                // A label fades in with its tile, so a name never shows without the point it names.
                const reveal = { opacity: shown ? 1 : 0, transitionDelay: `${index * 90}ms` };
                return (
                  <React.Fragment key={price.id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={`${price.name}: ${percent(price.quality)} useful content, ${priceLabel(price)} per 1,000 attempts, ${price.plan.name}`}
                      onClick={() => onSelect(price.id)}
                      onFocus={() => onSelect(price.id)}
                      onPointerEnter={() => onSelect(price.id)}
                      className={cn(
                        "absolute z-20 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-card bg-surface shadow-key outline-none transition-[opacity,scale,box-shadow] duration-300 ease-out focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none",
                        isSelected ? "ring-2" : "ring-1",
                      )}
                      style={{ "--tw-ring-color": providerColor(price.id), left: x, top: y, opacity: shown ? 1 : 0, scale: shown ? "1" : "0.9", transitionDelay: `${index * 90}ms` } as React.CSSProperties}
                    >
                      <ProviderLogo id={price.id} className="size-4.5" />
                    </button>
                    {compact ? (
                      <span
                        aria-hidden="true"
                        className={cn("absolute z-10 flex justify-center text-axis leading-tight whitespace-nowrap transition-opacity duration-300 ease-out motion-reduce:transition-none", MONO, "text-fg")}
                        style={{ ...compactLabel(price), width: COMPACT_LABEL_WIDTH, ...reveal }}
                      >
                        <span className="bg-surface/90 px-1 py-0.5">{price.name}</span>
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className={cn("absolute z-10 flex -translate-y-1/2 flex-col bg-surface/90 px-1.5 py-0.5 text-axis leading-tight whitespace-nowrap transition-opacity duration-300 ease-out motion-reduce:transition-none", MONO, label.left ? "items-end" : "items-start", "text-fg")}
                        style={{ ...(label.left ? { right: width - label.edge } : { left: label.edge }), top: labelYs[index], ...reveal }}
                      >
                        <span>{price.name}</span>
                        <span className="text-fg-subtle tabular-nums">
                          {percent(price.quality)} · {priceLabel(price)}
                        </span>
                      </span>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          <div className="relative ml-10 h-4">
            {xTicks.map((tick) => (
              <span key={tick} className={cn("absolute -translate-x-1/2", AXIS)} style={{ left: `${(tick / xMax) * 100}%` }}>
                ${Number(tick.toPrecision(3))}
              </span>
            ))}
          </div>
        </div>
      </AxisFrame>
      {selected && (
        <div aria-live="polite" className="flex items-start gap-3 rounded-card bg-subtle px-4 py-3">
          <ProviderLogo id={selected.id} className="mt-0.5 size-5" />
          <p className="text-body-sm leading-relaxed text-fg-muted">
            <span className="text-fg">{selected.name}</span> · {percent(selected.quality)} useful · {priceLabel(selected)} / 1k attempts
            <span className="block text-caption text-fg-subtle">
              {selected.plan.name} · {count(selected.success)} / {count(selected.count)} pages
              {selected.unknown > 0 ? ` · ${selected.unknown} pending review` : ""}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
