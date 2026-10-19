import { cacheLife } from "next/cache";

import snapshot from "@/data/summary-snapshot.json";

import { TRACE_ORIGIN } from "./origin";
import { isSummary, type Summary } from "./types";

export type LoadedSummary = { summary: Summary; source: "live" | "snapshot" };

// The collector can take several seconds to assemble the summary; the result is cached, so a slow first fetch is fine.
const SUMMARY_TIMEOUT_MS = 20_000;

export async function getSummary(): Promise<LoadedSummary> {
  "use cache";

  try {
    const response = await fetch(`${TRACE_ORIGIN}/api/summary`, { signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const summary: unknown = await response.json();
    if (!isSummary(summary)) throw new Error("Invalid benchmark summary");
    cacheLife("minutes");
    return { summary, source: "live" };
  } catch (error) {
    console.error("Trace summary unavailable, serving the bundled snapshot.", error);
    // "minutes" refreshes in the background after a minute, so a missed fetch is retried soon. A shorter profile would
    // make the route dynamic and block its prerender.
    cacheLife("minutes");
    return { summary: snapshot as unknown as Summary, source: "snapshot" };
  }
}
