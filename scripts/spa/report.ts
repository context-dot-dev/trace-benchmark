import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

type Metric = { success: number; failure: number; unknown: number; denominator: number; rate: number | null; ci95: number[] | null };
type Latency = { n: number; p50: number | null; p90: number | null; p95: number | null; p99: number | null };
type ProviderSummary = {
  total: number; attempted: number; notAttempted: number; accountExcluded: number; unknown: number;
  access: Metric; quality: { unknown: number }; latencyMs: { all: Latency; successful: Latency };
};
type Page = {
  url: string; organization: string; platform: string;
  results: Record<string, { receipt: unknown; access: unknown; excluded: boolean; accessSuccess: boolean | null; qualitySuccess: boolean | null }>;
};
export type SpaReport = {
  run: { id: string; settings: { manifestSha256: string; requestsPerSecondPerProvider: number; concurrencyPerProvider: number; providerTimeoutMs: number } };
  generatedAt: string;
  sample: { pages: number; status: string; requiredForFinal: number; sampleSizeMet: boolean; collectionComplete: boolean; uniqueHosts: number; uniqueOrganizations: number };
  providers: Record<string, ProviderSummary>;
  platforms: Record<string, { pages: number; providers: Record<string, ProviderSummary> }>;
  paired: { shared: number; contextOnly: number; firecrawlOnly: number; p: number };
  timing: { pairDispatchSkewMs: { p50: number | null; p95: number | null }; providerSpans: Record<string, { startedAt: string | null; completedAt: string | null }> };
  limitations: string[]; pages: Page[];
};
const providers = ["context", "firecrawl"] as const;
const names = { context: "Context.dev", firecrawl: "Firecrawl" };
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const percent = (value: number | null) => value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
const milliseconds = (value: number | null) => value === null ? "—" : value.toLocaleString("en-US");
function rate(metric: Metric) {
  const interval = metric.ci95 ? `<small>95% CI ${percent(metric.ci95[0])}–${percent(metric.ci95[1])}</small>` : "";
  return `${escape(metric.success)}/${escape(metric.denominator)} · ${percent(metric.rate)}${interval}`;
}
function pageLink(url: string) {
  try {
    const parsed = new URL(url);
    if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) return `<a href="${escape(url)}" rel="noreferrer">${escape(url)}</a>`;
  } catch { /* Malformed URLs remain visible as inert evidence. */ }
  return escape(url);
}
function table(id: string, headers: string[], rows: string) {
  return `<div class="table-scroll" role="region" aria-labelledby="${id}" tabindex="0"><table><thead><tr>${headers.map((header) => `<th scope="col">${escape(header)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export async function renderReport(report: SpaReport, sourceHref = "report.json"): Promise<string> {
  if (!Array.isArray(report.pages) || !report.pages.length || !providers.every((provider) => report.providers?.[provider]?.access)) throw new Error("Report requires page-level results and both provider access summaries");
  const brand = await readFile(new URL("../../src/app/_context-ds/brand.css", import.meta.url), "utf8");
  const accessComplete = report.pages.every((page) => providers.every((provider) => typeof page.results[provider]?.accessSuccess === "boolean"));
  const qualityComplete = report.pages.every((page) => providers.every((provider) => typeof page.results[provider]?.qualitySuccess === "boolean"));
  const qualityUnknown = providers.reduce((count, provider) => count + report.providers[provider].quality.unknown, 0);
  const accessRows = providers.map((provider) => {
    const row = report.providers[provider];
    return `<tr><th scope="row">${names[provider]}</th><td>${rate(row.access)}</td><td>${escape(row.access.failure)}</td><td>${escape(row.access.unknown)}</td><td>${escape(row.accountExcluded)}</td><td>${escape(row.notAttempted)}</td></tr>`;
  }).join("");
  const platformRows = Object.entries(report.platforms).map(([platform, group]) => `<tr><th scope="row">${escape(platform)}</th><td>${escape(group.pages)}</td>${providers.map((provider) => `<td>${rate(group.providers[provider].access)}</td>`).join("")}</tr>`).join("");
  const latencyRows = providers.flatMap((provider) => (["all", "successful"] as const).map((kind) => {
    const row = report.providers[provider].latencyMs[kind];
    return `<tr><th scope="row">${names[provider]}</th><td>${kind === "all" ? "All eligible reads" : "Accessed pages"}</td><td>${escape(row.n)}</td>${[row.p50, row.p90, row.p95, row.p99].map((value) => `<td>${milliseconds(value)}</td>`).join("")}</tr>`;
  })).join("");
  const evidence = report.pages.map((page) => `<details><summary>${escape(page.organization)} · ${escape(page.platform)}</summary><p>${pageLink(page.url)}</p>${providers.map((provider) => {
    const result = page.results[provider];
    return `<h3>${names[provider]}</h3><pre>${escape(JSON.stringify({ receipt: result.receipt, access: result.access, excluded: result.excluded, accessSuccess: result.accessSuccess }, null, 2))}</pre>`;
  }).join("")}</details>`).join("");
  const settings = report.run.settings;
  const spans = providers.map((provider) => `<li>${names[provider]}: ${escape(report.timing.providerSpans[provider].startedAt)} to ${escape(report.timing.providerSpans[provider].completedAt)}</li>`).join("");
  const limitations = report.limitations.filter((text) => !/quality/i.test(text)).map((text) => `<li>${escape(text)}</li>`).join("");
  return `<!doctype html>
<html lang="en" class="ds-product"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SPA scraping comparison</title><style>${brand}
html.ds-product{font-size:var(--ds-text-body)}
body::after,main>section::before{content:none}
main>section{border:0}
body{margin:var(--ds-space-0);font-family:var(--ds-font-sans);font-size:var(--ds-text-body);line-height:var(--ds-leading-normal);color:var(--ds-color-text-default);background:var(--ds-color-bg-canvas)}
main{box-sizing:border-box;max-width:min(var(--ds-layout-column),var(--ds-frame-column));margin-inline:auto;padding:var(--ds-space-8) var(--ds-space-4)}
h1{font-size:var(--ds-text-h3);line-height:var(--ds-leading-heading);letter-spacing:var(--ds-tracking-tight);font-weight:var(--ds-font-weight-regular);margin:var(--ds-space-0) var(--ds-space-0) var(--ds-space-4)}
h2{font-size:var(--ds-text-h5);font-weight:var(--ds-font-weight-medium);margin:var(--ds-space-0) var(--ds-space-0) var(--ds-space-3)}
h3{font-size:var(--ds-text-body);font-weight:var(--ds-font-weight-medium);margin-block:var(--ds-space-4) var(--ds-space-2)}
p{margin-block:var(--ds-space-0) var(--ds-space-4)}
section,aside{margin-block:var(--ds-space-8)}
aside{padding:var(--ds-space-5);background:var(--ds-color-bg-tint);border-radius:var(--ds-radius-card)}
small{white-space:nowrap;display:block;font-size:var(--ds-text-caption);color:var(--ds-color-text-secondary);margin-top:var(--ds-space-1)}
.muted{color:var(--ds-color-text-secondary)}
.table-scroll{overflow:auto;background:var(--ds-color-bg-default);border-radius:var(--ds-radius-card);box-shadow:var(--ds-shadow-card)}
table{width:100%;border-collapse:collapse;font-size:var(--ds-text-body-sm);font-variant-numeric:tabular-nums;text-align:left}
thead{background:var(--ds-color-bg-subtle)}
th,td{padding:var(--ds-space-3);vertical-align:top;border-bottom:var(--ds-space-px) solid var(--ds-color-border-subtle)}
th{font-weight:var(--ds-font-weight-medium)}
thead th{white-space:nowrap;color:var(--ds-color-text-secondary);font-size:var(--ds-text-caption)}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--ds-font-mono);font-size:var(--ds-text-caption);padding:var(--ds-space-4);background:var(--ds-color-bg-subtle);border-radius:var(--ds-radius-control)}
code{font-family:var(--ds-font-mono);overflow-wrap:anywhere}
details{margin-block:var(--ds-space-3);padding:var(--ds-space-4);background:var(--ds-color-bg-default);border-radius:var(--ds-radius-card)}
summary{cursor:pointer;overflow-wrap:anywhere}
details p{margin-top:var(--ds-space-3);overflow-wrap:anywhere}
a{color:var(--ds-color-text-brand);text-underline-offset:var(--ds-space-1)}
a:focus-visible,summary:focus-visible,.table-scroll:focus-visible{outline:var(--ds-space-px) solid var(--ds-color-focus-ring);outline-offset:var(--ds-space-1)}
ul{padding-left:var(--ds-space-6);margin-block:var(--ds-space-3)}
li{margin-block:var(--ds-space-2)}
</style></head><body><main>
<header><h1>SPA scraping comparison</h1><p>${escape(report.sample.pages.toLocaleString("en-US"))} verified company-careers SPA URLs · ${escape(report.sample.uniqueHosts)} hosts · ${escape(report.sample.uniqueOrganizations)} organization names</p><p>${report.sample.sampleSizeMet ? "Cohort target met." : `Pilot: fewer than ${report.sample.requiredForFinal} pages.`}</p><p>Access means actual page data loaded, including company prose. It does not establish that a job list rendered or that content is complete, relevant, or the requested document.</p></header>
<section aria-labelledby="access"><h2 id="access">Page access</h2>${table("access", ["Provider", "Accessed", "Failed", "Unresolved", "Account excluded", "Unsent"], accessRows)}<p class="muted">Eligible attempted pages form each rate's denominator, including unresolved outcomes. Intervals are per-page Wilson 95% confidence intervals.</p><p>Matched determinate pairs: ${escape(report.paired.shared)}. Context-only access: ${escape(report.paired.contextOnly)}; Firecrawl-only access: ${escape(report.paired.firecrawlOnly)}; exact McNemar p=${report.paired.p.toPrecision(4)}.</p></section>
<section aria-labelledby="platforms"><h2 id="platforms">Access by platform</h2>${table("platforms", ["Platform", "Pages", "Context.dev access", "Firecrawl access"], platformRows)}</section>
<section aria-labelledby="latency"><h2 id="latency">Retrieval latency</h2>${table("latency", ["Provider", "Reads", "Count", "p50 ms", "p90 ms", "p95 ms", "p99 ms"], latencyRows)}<p class="muted">Read time excludes queue wait and grading. Cached, interrupted, and account-limit responses are excluded.</p></section>
<section aria-labelledby="completion"><h2 id="completion">Completion</h2><p>Collection complete: ${escape(report.sample.collectionComplete)}. Access grading complete: ${accessComplete}.</p><p class="muted">Legacy quality grading complete: ${qualityComplete}; ${escape(qualityUnknown)} unresolved. This separate legacy status does not change access grading completion.</p></section>
<aside aria-labelledby="legacy-warning"><h2 id="legacy-warning">Legacy quality grades are exploratory and unreliable</h2><p>The legacy rubric can penalize populated career listings as generic listings. Its labels and rates do not provide a valid job-list rendering or extraction-quality comparison for this cohort and are excluded from the comparison tables.</p><p>Original grades remain unchanged in the <a href="${escape(sourceHref)}">source JSON evidence</a>. Grading uses excerpts and cannot establish complete extraction or browser-reference recall.</p></aside>
<section aria-labelledby="conditions"><h2 id="conditions">Measurement conditions</h2><p>${escape(settings.requestsPerSecondPerProvider)} requests/second and up to ${escape(settings.concurrencyPerProvider)} in flight per provider; fresh main-content Markdown; ${settings.providerTimeoutMs / 1000}-second provider timeout.</p><p>Same-URL dispatch skew: median ${milliseconds(report.timing.pairDispatchSkewMs.p50)} ms; p95 ${milliseconds(report.timing.pairDispatchSkewMs.p95)} ms.</p><ul>${spans}</ul><ul>${limitations}</ul><details><summary>Frozen run provenance</summary><p>Run: <code>${escape(report.run.id)}</code><br>Manifest SHA-256: <code>${escape(settings.manifestSha256)}</code><br>Recorded report time: ${escape(report.generatedAt)}<br>Original combined sample status: ${escape(report.sample.status)}</p></details></section>
<section aria-labelledby="evidence"><h2 id="evidence">Page-level retrieval and access evidence</h2><p>Legacy quality labels remain in the source JSON and are omitted here because they are exploratory and unreliable.</p>${evidence}</section>
</main></body></html>`;
}

async function main() {
  const { values } = parseArgs({ options: { report: { type: "string" }, out: { type: "string" } } });
  if (!values.report || !values.out) throw new Error("Usage: tsx scripts/spa/report.ts --report report.json --out report.html");
  const source = path.resolve(values.report), output = path.resolve(values.out);
  if (source === output) throw new Error("HTML output must differ from the source JSON report");
  const report = JSON.parse(await readFile(source, "utf8")) as SpaReport;
  const href = "./" + path.relative(path.dirname(output), source).split(path.sep).map(encodeURIComponent).join("/");
  const html = await renderReport(report, href);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output + ".tmp", html);
  await rename(output + ".tmp", output);
  console.log(JSON.stringify({ source, output, pages: report.sample.pages, offline: true }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : "Report rendering failed"); process.exitCode = 1; });
