import registry from "../../config/sources.json";
import { BenchmarkReport, type SourceSummary } from "@/components/benchmark/report";
import { benchmarkDataset } from "@/lib/benchmark/dataset";
import { buildView, defaultFilters, faqItems, providerName } from "@/lib/benchmark/view";
import { categories } from "@/lib/benchmark/types";
import { firstSampleDay } from "@/lib/benchmark/history";
import { loadBenchmarkQuery } from "@/lib/benchmark/query";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const examples: Record<string, string[]> = {
  news: ["BBC", "NPR", "Al Jazeera", "CNBC"],
  commerce: ["Allbirds", "Bombas", "Gymshark", "Vuori"],
  jobs: ["Stripe", "Anthropic", "Spotify", "Cloudflare"],
  finance_filings: ["SEC filings", "Federal Reserve"],
  research: ["arXiv", "PLOS", "Nature", "eLife"],
  legal_regulatory: ["Federal Register", "UK legislation", "FTC"],
  software_docs: ["VS Code", "Rust", "Kubernetes", "PostgreSQL"],
  community_social: ["Hacker News", "Stack Overflow", "Bluesky"],
  other: ["New external links on English Wikipedia"],
};

function sourceSummary(): SourceSummary {
  const list = registry as { category: string }[];
  const order = [...categories.map((c) => c.id), "other"];
  return {
    total: list.length,
    categories: order.map((id) => ({
      id,
      count: list.filter((s) => s.category === id).length,
      examples: examples[id] ?? [],
    })),
  };
}

export default async function Page({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const { run: requested } = loadBenchmarkQuery(params);
  const dataset = await benchmarkDataset(requested === "latest" ? undefined : requested);
  const visible = dataset.report.history.filter((sample) => sample.day >= firstSampleDay);
  if (requested !== "latest" && !visible.some((sample) => sample.id === requested)) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "run" || value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
    }
    redirect(query.size ? `/?${query}` : "/");
  }
  // Structured data always describes the unfiltered benchmark.
  const view = buildView(dataset, defaultFilters);
  const run = dataset.report.latest;
  const site = "https://trace.context.dev/";
  const structured = [
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "TRACE: daily web scraping API benchmark",
      description:
        "Daily comparison of context.dev, Exa, Firecrawl, and Keenable on a new fresh sample of web pages each day: page access, latency, document quality, cost, and failure reasons, with page-level records.",
      url: site,
      creator: { "@type": "Organization", name: "context.dev", url: "https://context.dev" },
      license: "https://opensource.org/licenses/MIT",
      isAccessibleForFree: true,
      ...(run ? { dateModified: run.finishedAt ?? run.day, temporalCoverage: `${visible.at(-1)?.day ?? run.day}/${run.day}` } : {}),
      variableMeasured: ["Page access rate", "Response time percentiles", "Right-page rate", "Substantive-content rate", "Cost per accessed page", "Failure reasons"],
      distribution: run
        ? [{ "@type": "DataDownload", encodingFormat: "application/x-ndjson", contentUrl: `${site}api/download?run=${encodeURIComponent(run.id)}` }]
        : [],
      measurementTechnique: "Paired comparison on identical daily samples with an automated, provider-blind judge",
      keywords: ["web scraping API", "benchmark", ...view.rows.map((r) => providerName(r.id))],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItems(view).map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, "\\u003c") }}
      />
      <BenchmarkReport initial={dataset} sources={sourceSummary()} />
    </>
  );
}
