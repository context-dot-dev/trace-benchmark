"use client";

import * as React from "react";

import { isSummary, type Summary } from "@/lib/trace/types";

const POLL_MS = 60_000;
const TIMEOUT_MS = 10_000;

/** Keeps the published summary current: checks for a newer one every minute while the page is visible, never going back. */
export function useLiveSummary(initial: Summary) {
  const [state, setState] = React.useState<{ summary: Summary; loading: boolean; error: string | null }>({ summary: initial, loading: false, error: null });
  const latest = React.useRef(initial);
  const inFlight = React.useRef<AbortController | null>(null);

  const refresh = React.useCallback(async () => {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    setState((current) => ({ ...current, loading: true }));
    try {
      const response = await fetch("/api/summary", { cache: "no-cache", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}.`);
      const next: unknown = await response.json();
      if (!isSummary(next)) throw new Error("Invalid benchmark summary.");
      if (Date.parse(next.generated_at) < Date.parse(latest.current.generated_at)) throw new Error("The server returned an older summary.");
      if (next.version !== latest.current.version) latest.current = next;
      setState({ summary: latest.current, loading: false, error: null });
    } catch (error) {
      if (!controller.signal.aborted || timedOut) setState((current) => ({ ...current, loading: false, error: timedOut ? "Summary request timed out." : (error as Error).message }));
    } finally {
      clearTimeout(timer);
      inFlight.current = null;
    }
  }, []);

  React.useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => {
      clearInterval(interval);
      inFlight.current?.abort();
    };
  }, [refresh]);

  return { ...state, refresh };
}
