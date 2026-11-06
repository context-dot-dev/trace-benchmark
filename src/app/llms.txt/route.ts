import { benchmarkDataset } from "@/lib/benchmark/dataset";
import { buildView, categoryName, defaultFilters, faqItems, providerName } from "@/lib/benchmark/view";
import { percent } from "@/lib/benchmark/format";
import { ACCESS_PROTOCOL } from "@/lib/benchmark/types";

export const dynamic = "force-dynamic";

const seconds = (ms: number | null) => (ms == null ? "n/a" : `${(ms / 1000).toFixed(2)} s`);

/** A plain-text summary of the latest results for AI assistants and crawlers. */
export async function GET() {
  try {
    const dataset = await benchmarkDataset();
    const view = buildView(dataset, defaultFilters);
    const run = view.run;
    const ranked = [...view.rows].filter((r) => r.rate != null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
    const lines = [
      "# TRACE",
      "",
      "> Daily benchmark of web scraping APIs (context.dev, Exa, Firecrawl, Keenable). Every day a new fresh sample of about 2,500 never-tested web pages goes to all four providers with caching turned off. A provider-blind automated judge grades each response. Published by context.dev, which is also one of the providers tested.",
      "",
      run ? `Latest sample: ${run.day} UTC, scored for ${run.protocol === ACCESS_PROTOCOL ? "page access" : "useful content"}, ${view.selected.length} pages.` : "No sample is available yet.",
      "",
      `## ${view.accessOnly ? "Pages accessed" : "Pages with useful content"} (95% confidence interval)`,
      ...ranked.map((r) => {
        const rank = view.ranks.get(r.id);
        return `- ${rank?.place ?? "?"}${rank?.tied ? " (tied)" : ""}. ${providerName(r.id)}: ${percent(r.rate)} ±${((r.ci ?? 0) * 100).toFixed(1)}`;
      }),
      "",
      "## Key findings",
      ...view.findings.map((f) => `- ${f.lead} ${f.detail}`),
      "",
      "## Latency (all requests, caching off)",
      ...view.lat.map((l) => `- ${providerName(l.id)}: median ${seconds(l.p50)}, p90 ${seconds(l.p90)}, p95 ${seconds(l.p95)}, p99 ${seconds(l.p99)}, timeouts ${percent(l.timeoutRate)}`),
      "",
      "## By category",
      ...view.cats.map((c) => `- ${categoryName(c.id)}: ${ranked.map((r) => `${providerName(r.id)} ${percent(c.rates[r.id as keyof typeof c.rates])}`).join(", ")}; ${c.verdict === "leads" && c.leader ? `${providerName(c.leader)} leads` : "statistically tied"}`),
      "",
      "## Cost per 1,000 accessed pages (published prices)",
      ...view.costs.map((c) => `- ${providerName(c.id)}: $${c.perAccessed1k?.toFixed(2) ?? "n/a"}${c.assumed ? " (assumes failed requests are billed)" : ""}`),
      "",
      "## Questions",
      ...faqItems(view).flatMap((item) => [`### ${item.q}`, item.a, ""]),
      "## Links",
      "- [Full report](https://trace.context.dev/)",
      "- [Daily summaries API](https://trace.context.dev/api/report)",
      ...(run ? [`- [Page-level records for ${run.day}](https://trace.context.dev/api/download?run=${encodeURIComponent(run.id)})`] : []),
      "- [Source code](https://github.com/context-dot-dev/trace-benchmark)",
    ];
    return new Response(lines.join("\n") + "\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=900" },
    });
  } catch {
    return new Response("Results are temporarily unavailable.\n", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
