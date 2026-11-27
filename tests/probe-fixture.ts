import { PROBE_VERSION, type Probe, type ProbeVerdict } from "../src/lib/benchmark/probe.ts";

/** Probe stub for E2E tests: no network, a fixed verdict per URL. */
export const fixedProbe = (verdictFor: (url: string) => ProbeVerdict) =>
  async (url: string): Promise<Probe> => {
    const verdict = verdictFor(url);
    return {
      verdict,
      reason: verdict === "easy" ? "static_html" : verdict === "dead" ? "not_found" : "challenge",
      version: PROBE_VERSION,
      status: verdict === "easy" ? 200 : verdict === "dead" ? 404 : 403,
      textChars: verdict === "easy" ? 5000 : 0,
      elapsedMs: 1,
    };
  };
/** Every page is hard, so a hard-first sample draws exactly what the v6 sample would. */
export const hardProbe = fixedProbe(() => "hard");
