"use client";

import * as React from "react";

import { dateTimeUtc } from "@/lib/trace/format";
import { collectionState } from "@/lib/trace/status";
import type { CohortId, Summary } from "@/lib/trace/types";
import { cn } from "@/lib/utils";

import { TextLink } from "./report-section";

function useNow(initial: number) {
  const [now, setNow] = React.useState(initial);
  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return now;
}

const DOT: Record<string, string> = { live: "bg-brand", warning: "bg-warning", idle: "bg-neutral-40" };

/** Whether collection is running on schedule, when the last run finished and when the next one starts. */
export function StatusLine({ summary, cohort, className }: { summary: Summary; cohort: CohortId; className?: string }) {
  const now = useNow(Date.parse(summary.rendered_at ?? summary.generated_at) || 0);
  const state = collectionState(summary, cohort, now);
  return (
    <p role="status" className={cn("flex max-w-(--ds-layout-heading) flex-wrap items-baseline justify-center gap-x-2 gap-y-1 text-body-sm leading-relaxed text-fg-muted", className)}>
      <span className="inline-flex items-center gap-2 text-fg">
        <span aria-hidden="true" className="relative flex size-2">
          {state.tone === "live" && <span className="absolute inset-0 animate-ping rounded-pill bg-brand opacity-40 motion-reduce:hidden" />}
          <span className={cn("relative size-2 rounded-pill", DOT[state.tone])} />
        </span>
        {state.label}.
      </span>
      <span>{state.lastCompleted ? `Last completed run: ${dateTimeUtc(state.lastCompleted.finished_at)}.` : "No completed run for this protocol yet."}</span>
      {state.current && (
        <span>
          Current run: {state.current.run.selected_count.toLocaleString("en-US")} pages · {state.current.statusLabel}. {state.current.run.observed_count ?? 0}/{state.current.run.selected_count * summary.providers.length} responses, {state.current.run.judged_count ?? 0} graded.
        </span>
      )}
      {state.nextRunAt && <span>Next scheduled: {dateTimeUtc(state.nextRunAt)}.</span>}
      <TextLink href="#runs">Inspect runs</TextLink>
    </p>
  );
}
