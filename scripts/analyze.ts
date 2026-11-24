// Deep-dive report for one published sample: failures, per-site success and latency, latency
// budgets, fallbacks, and site-clustered uncertainty. Needs no database or provider keys.
//
//   npm run analyze                                   # latest sample from trace.context.dev
//   npm run analyze -- --run scraping-bench-v5:2026-11-06
//   npm run analyze -- --provider keenable --min-pages 10
//   npm run analyze -- --file dataset.json --json > deep-dive.json
//
// Options:
//   --origin <url>     Where to read /api/benchmark from (default https://trace.context.dev,
//                      or BENCHMARK_DATA_ORIGIN when set).
//   --file <path>      Read a saved /api/benchmark response instead of fetching one.
//   --run <id>         A specific sample; defaults to the latest completed one.
//   --category <id>    Restrict to one category.
//   --provider <id>    Add a focused section for one provider: its recoverable failures by site.
//   --min-pages <n>    Smallest site to list in the site tables (default 10).
//   --sites <n>        Rows in each site table (default 25).
//   --json             Print the computed structures as JSON instead of Markdown.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { BUDGETS_MS, failureSignal, type ProviderId, type SiteResult } from "../src/lib/benchmark/analysis";
import type { BenchmarkDataset } from "../src/lib/benchmark/combined";
import { failureReasons, hostOf } from "../src/lib/benchmark/outcomes";
import { providers } from "../src/lib/benchmark/types";
import { buildView, categoryName, providerName } from "../src/lib/benchmark/view";

const { values } = parseArgs({
  options: {
    origin: { type: "string", default: process.env.BENCHMARK_DATA_ORIGIN ?? "https://trace.context.dev" },
    file: { type: "string" },
    run: { type: "string" },
    category: { type: "string", default: "all" },
    provider: { type: "string" },
    "min-pages": { type: "string", default: "10" },
    sites: { type: "string", default: "25" },
    json: { type: "boolean", default: false },
  },
});

async function load(): Promise<BenchmarkDataset> {
  if (values.file) return JSON.parse(await readFile(values.file, "utf8"));
  const url = new URL("/api/benchmark", values.origin);
  if (values.run) url.searchParams.set("run", values.run);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

const dataset = await load();
const view = buildView(dataset, { source: "all", category: values.category!, run: values.run ?? "latest" });
if (!view.run) throw new Error("The requested sample has no page-level data in this dataset.");
const minPages = Number(values["min-pages"]);
const limit = Number(values.sites);
const ids = providers.map((p) => p.id) as ProviderId[];
const order = [...ids].sort((a, b) => (view.rows.find((r) => r.id === b)?.rate ?? 0) - (view.rows.find((r) => r.id === a)?.rate ?? 0));
const bigSites = view.sites.filter((s) => s.pages >= minPages);

if (values.json) {
  console.log(
    JSON.stringify(
      {
        run: view.run.id,
        pages: view.selected.length,
        scores: view.rows.map(({ id, rate, ci }) => ({ id, rate, ci })),
        clustered: view.clustered,
        latency: view.lat,
        latencyByCategory: view.latencyByCategory,
        budgets: { budgetsMs: BUDGETS_MS, providers: view.budgets },
        failures: view.failureDetail,
        fallbacks: view.fallbacks,
        sites: bigSites,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const pts = (v: number | null | undefined) => (v == null ? "—" : `±${(v * 100).toFixed(1)}`);
const sec = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`);
/** A Markdown table; the first `left` columns are left-aligned and the rest right-aligned. */
const table = (headers: string[], rows: (string | number)[][], left = 1) =>
  [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map((_, i) => (i >= left ? "---:" : ":---")).join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
const reasonName = (id: string | null) => failureReasons.find((r) => r.id === id)?.name ?? "not scored";
const out: string[] = [];
const say = (...lines: string[]) => out.push(...lines, "");

say(
  `# TRACE deep dive · ${view.run.day} · ${view.run.protocol}`,
  `${view.selected.length.toLocaleString("en-US")} pages from ${view.sites.length.toLocaleString("en-US")} sites${values.category !== "all" ? ` · ${categoryName(values.category!)}` : ""}.`,
);

say("## Scores and site-clustered uncertainty");
say(
  table(
    ["Provider", "Score", "Page CI", "Site-clustered CI", "Site-weighted score"],
    order.map((id) => {
      const r = view.rows.find((x) => x.id === id)!;
      const c = view.clustered.find((x) => x.id === id)!;
      return [providerName(id), pct(r.rate), pts(r.ci), pts(c.ci), pct(c.siteWeighted)];
    }),
  ),
  "Pages from one site succeed or fail together, so the site-clustered interval is the honest one when a few sites contribute many pages. The site-weighted score counts every site in a category equally.",
);

say("## Where failures come from");
say(
  table(
    ["Provider", "Failed", "Another provider read it", "Every other provider read it", "No provider read it", "Top 5 sites' share", "Median time to fail"],
    order.map((id) => {
      const f = view.failureDetail.find((x) => x.id === id)!;
      return [
        providerName(id),
        `${f.failed} (${pct(f.total ? f.failed / f.total : null)})`,
        f.recoverable,
        f.exclusive,
        f.universal,
        pct(f.concentration),
        sec(f.failedP50),
      ];
    }),
  ),
);
for (const id of order) {
  const f = view.failureDetail.find((x) => x.id === id)!;
  say(
    `### ${providerName(id)}`,
    `- Signals: ${f.signals.slice(0, 8).map((s) => `\`${s.signal}\` ${s.count}`).join(", ") || "none"}`,
    `- Worst categories: ${f.categories.slice(0, 4).map((c) => `${categoryName(c.id)} ${pct(c.total ? c.failed / c.total : null)}`).join(", ")}`,
    `- Most failures: ${f.hosts.slice(0, 6).map((h) => `${h.host} ${h.failed}/${h.pages}${h.recoverable ? ` (${h.recoverable} recoverable)` : ""}`).join(", ") || "none"}`,
  );
}

if (values.provider) {
  const focus = values.provider as ProviderId;
  if (!ids.includes(focus)) throw new Error(`Unknown provider ${focus}; use one of ${ids.join(", ")}`);
  const misses = view.selected.filter((p) => {
    const o = p.results[focus];
    return o?.state === "done" && o.success !== true && ids.some((x) => x !== focus && p.results[x]?.success === true);
  });
  const byHost = new Map<string, typeof misses>();
  for (const p of misses) byHost.set(hostOf(p.url), [...(byHost.get(hostOf(p.url)) ?? []), p]);
  say(
    `## ${providerName(focus)}: pages another provider read`,
    `${misses.length} pages. Fixing the sites at the top of this list recovers the most score.`,
  );
  say(
    table(
      ["Site", "Missed", "Signals", "Read by", "Example"],
      [...byHost.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, limit)
        .map(([host, group]) => {
          const signals = new Map<string, number>();
          const readers = new Map<string, number>();
          for (const p of group) {
            const s = failureSignal(p.results[focus]!);
            signals.set(s, (signals.get(s) ?? 0) + 1);
            for (const x of ids) if (x !== focus && p.results[x]?.success === true) readers.set(x, (readers.get(x) ?? 0) + 1);
          }
          return [
            host,
            group.length,
            [...signals.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(", "),
            [...readers.entries()].map(([x, n]) => `${providerName(x)} ${n}`).join(", "),
            group[0].url,
          ];
        }),
      5,
    ),
  );
}

say("## Latency by site", `Sites with at least ${minPages} pages, by number of pages. Each cell is the success rate · median latency.`);
const siteRow = (s: SiteResult) => [
  s.host,
  s.pages,
  ...order.map((id) => `${pct(s.providers[id].rate)} · ${sec(s.providers[id].p50)}`),
  sec(s.latencyGap),
];
say(table(["Site", "Pages", ...order.map(providerName), "Median gap"], bigSites.slice(0, limit).map(siteRow)));

say("## Slowest sites per provider", "The sites where each provider's median latency is highest (same size threshold).");
say(
  table(
    ["Provider", "Slowest sites (median · p95)"],
    order.map((id) => [
      providerName(id),
      [...bigSites]
        .filter((s) => s.providers[id].p50 != null)
        .sort((a, b) => b.providers[id].p50! - a.providers[id].p50!)
        .slice(0, 5)
        .map((s) => `${s.host} ${sec(s.providers[id].p50)} · ${sec(s.providers[id].p95)}`)
        .join("; "),
    ]),
    2,
  ),
);

say("## Sites that separate providers", "Largest gap between the best and worst provider's success rate.");
say(
  table(
    ["Site", "Pages", ...order.map(providerName), "Spread", "Worst provider's top reason"],
    [...bigSites]
      .filter((s) => (s.spread ?? 0) > 0)
      .sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0))
      .slice(0, limit)
      .map((s) => {
        const worst = [...order].sort((a, b) => (s.providers[a].rate ?? 1) - (s.providers[b].rate ?? 1))[0];
        return [
          s.host,
          s.pages,
          ...order.map((id) => pct(s.providers[id].rate)),
          pct(s.spread),
          `${providerName(worst)}: ${reasonName(s.providers[worst].topReason)}`,
        ];
      }),
  ),
);

say("## Latency by category", "Median · p95 per provider.");
say(
  table(
    ["Category", ...order.map(providerName)],
    view.latencyByCategory.map((c) => [categoryName(c.id), ...order.map((id) => `${sec(c.providers[id].p50)} · ${sec(c.providers[id].p95)}`)]),
  ),
);

say("## Useful within a time budget", "Share of timed requests that succeeded and finished within the budget.");
say(
  table(
    ["Provider", ...BUDGETS_MS.map((b) => `≤ ${b / 1000} s`), "No limit"],
    order.map((id) => {
      const b = view.budgets.find((x) => x.id === id)!;
      return [providerName(id), ...b.rates.map(pct), pct(b.any)];
    }),
  ),
);

say(
  "## Fallback pairs",
  `If an agent tries one provider and falls back to another. Share of pages both completed (not category-weighted). Any of the four providers read ${pct(view.fallbacks.ceiling)} of ${view.fallbacks.pages.toLocaleString("en-US")} pages.`,
);
say(
  table(
    ["Pair", "Either", "Alone (first)", "Alone (second)", "Gain over the better one"],
    view.fallbacks.pairs.map((f) => [
      `${providerName(f.a)} + ${providerName(f.b)}`,
      pct(f.rate),
      pct(f.aRate),
      pct(f.bRate),
      `+${((f.rate - Math.max(f.aRate, f.bRate)) * 100).toFixed(1)} pts`,
    ]),
  ),
);

console.log(out.join("\n"));
