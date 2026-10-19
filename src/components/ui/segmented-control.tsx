"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// Tabs used as a value picker inside a form or chart. Selected surfaces stay on their buttons, so switching choices
// never moves or resizes a shared indicator.
type Option<T extends string> = { value: T; label: React.ReactNode; count?: number };

const INNER_RADIUS = "rounded-[calc(var(--ds-radius-control)-0.125rem)]";
const SELECTED_SURFACE = { plain: "bg-wash-pill", segmented: "bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.03)]" };

function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  size = "md",
  variant = "plain",
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: Option<T>[];
  label: string;
  size?: "sm" | "md";
  variant?: "plain" | "segmented";
  className?: string;
}) {
  const segmented = variant === "segmented";
  const radius = size === "sm" || segmented ? INNER_RADIUS : "rounded-control";

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-slot="segmented-control"
      className={cn("relative isolate inline-flex w-fit items-center", segmented ? "gap-0.5 rounded-control bg-neutral-5 p-0.5" : size === "sm" ? "gap-0.5" : "gap-1", className)}
    >
      {options.map((o, index) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!options.some((option) => option.value === value) && index === 0) ? 0 : -1}
            data-tab-id={o.value}
            onClick={() => onValueChange(o.value)}
            onKeyDown={(event) => {
              const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
              if (!delta && event.key !== "Home" && event.key !== "End") return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + delta + options.length) % options.length;
              onValueChange(options[next].value);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
            }}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap outline-none transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring",
              radius,
              size === "sm" ? "h-7 px-3 text-caption" : segmented ? "h-8 px-3.5 text-body-sm" : "h-9 px-4 text-body-sm",
              // Keep the selected surface on its button; only text color responds to hover.
              selected ? "text-fg" : cn("hover:text-fg", segmented ? "text-fg-muted" : "text-fg-subtle"),
              selected && SELECTED_SURFACE[variant],
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn("tabular-nums", selected ? "text-fg-muted" : "text-fg-subtle")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl };
