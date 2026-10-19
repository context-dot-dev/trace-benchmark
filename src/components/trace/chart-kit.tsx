"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { AXIS_TITLE, type Tone } from "./chart-utils";

export function ChartRings({ className }: { className?: string }) {
  const id = React.useId();
  return (
    <svg aria-hidden="true" className={cn("pointer-events-none absolute inset-0 size-full text-brand opacity-14", className)}>
      <defs>
        <pattern id={id} width={12} height={12} patternUnits="userSpaceOnUse">
          <circle cx={6} cy={6} r={3} fill="none" stroke="currentColor" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

export function MeterDot({ solid, tone, delay = 0, className }: { solid: boolean; tone: Tone; delay?: number; className?: string }) {
  return (
    <span className="meter-cell">
      <span className={cn("meter-dot", solid && tone.solid, className)} style={delay ? { transitionDelay: `${delay}ms` } : undefined} />
    </span>
  );
}

export function MarkTip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-20 w-max max-w-[min(--spacing(56),calc(100vw-var(--ds-space-20)))] rounded-card bg-inverse px-2 py-1 text-left font-mono text-axis leading-snug text-fg-inverse opacity-0 transition-opacity duration-150 ease-out group-hover/mark:opacity-100 group-focus-visible/mark:opacity-100 motion-reduce:transition-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function AxisFrame({ y, x, xInset, children }: { y: string; x: string; xInset?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-0 sm:gap-3">
      <span className={cn("hidden shrink-0 rotate-180 self-center whitespace-nowrap [writing-mode:vertical-rl] sm:block", AXIS_TITLE)}>{y}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {children}
        <p className={cn("text-center", AXIS_TITLE, xInset)}>{x}</p>
      </div>
    </div>
  );
}
