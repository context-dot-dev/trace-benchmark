# Methodology

TRACE measures scraping on a changing sample of public web pages. Context.dev maintains the project and is one of the measured providers. The goal is a comparison that other people can inspect, challenge, and reproduce.

## A shared, fresh sample

The registry in [config/sources.json](../config/sources.json) contains 198 sources: 197 public feeds, registries, APIs, and sitemaps, and one English Wikipedia recent-changes source. A daily job polls every source that is due under its polling interval, and the weekly Workflow polls again before sampling. Wikipedia discovery compares revisions from the previous UTC day to identify newly added external links, retaining the article, revision, and timestamp as provenance.

Every Friday at 00:15 UTC, the collector draws up to 300 previously untested URLs in each of eight core categories, plus Other when available. It groups candidates by organization, uses day-seeded hashes to order organizations and pages, and selects across those groups. Limits of 125 pages per organization and 375 per hostname apply across the sample. The maximum target is 2,700 pages; supply and budgets can reduce it.

The sample is persisted before any provider runs. A durable seen-URL ledger excludes previously selected URLs from future samples. It prevents repeated test URLs; distinct URLs can still contain the same material, and providers may already know a page independently.

Source coverage is a design choice. This is a sample of the public web reachable through the configured sources, not a representative census of every website, language, file type, or geographic region.

## Provider requests and caching

Each provider receives the same URLs through its production client, with comparable main-content settings and one retrieval attempt per provider and page. Clients have a 30-second full-response deadline. Providers that support an upstream timeout receive a 27-second deadline. For timeout reporting, a failed request reaching the 27-second deadline counts as timed out regardless of its specific error.

| Provider | Fresh-fetch request setting | Cache evidence checked |
| :--- | :--- | :--- |
| context.dev | `maxAgeMs: 0` | `cache_metadata.status` and `cache_metadata.age_ms` |
| Exa | `maxAgeHours: 0` | `statuses[].source` |
| Firecrawl | `maxAge: 0`, `storeInCache: false` | `metadata.cacheState` |
| Keenable | `live=true` | `usage.sku` must be `fetch.live` |

An observed cache hit is recorded as `CACHED_RESPONSE`, remains unresolved, and is excluded from latency. It does not receive a successful grade. The benchmark relies on provider cache metadata; it cannot independently prove what happened inside a provider.

Provider-specific concurrency and request pacing obey configured account limits. Requests interrupted after dispatch are not automatically repeated, to avoid duplicate paid retrievals. Provider or judge rejections pause affected work while already retrieved evidence remains available.

The exact adapters are in [providers.ts](../src/lib/benchmark/providers.ts); dispatch and reservations are in [parallel.ts](../src/lib/benchmark/parallel.ts) and [batch-store.ts](../src/lib/benchmark/batch-store.ts).

## Protocol v7: hard-first sample

The current collector creates `scraping-bench-v7` samples. They use the v6 page-access rubric below on a different sample: pages that a plain HTTP request cannot already read.

Most pages from feeds and sitemaps are published by sites that want to be read. On the November 27, 2026 v6 sample, all four providers accessed 83% of pages, so most of the sample could not separate them. v7 spends the sample on pages that need real scraping.

**Neutral probe.** Before the sample is drawn, each candidate is requested once with a plain HTTP GET: a declared research user agent, no JavaScript, browser, proxy, cookies, or retry, a 15-second deadline, at most 5 MB, and up to five redirects with the same private-address checks as discovery. The probe classifies the response without consulting any provider:

| Verdict | Responses |
| :--- | :--- |
| easy | 2xx HTML with at least 1,500 readable characters after scripts, styles, the document head, and markup are removed; or a non-HTML file (such as a PDF) that the request downloaded |
| hard | 401 or 403, 429, 5xx, a bot-management interstitial (Cloudflare, DataDome, PerimeterX, Imperva, AWS WAF, Kasada, Akamai), a timeout, a connection failure, a redirect loop, or HTML with fewer than 1,500 readable characters |
| dead | 404 or 410, or a host that does not resolve; never sampled |

**Selection.** The collector walks candidates in the same day-seeded order and under the same organization and hostname limits as v6, and admits hard pages first. A category with fewer hard pages than its quota is topped up with easy pages to 50 pages, so every core category stays scored. The run summary reports hard and easy pages per category, and each page's probe label is part of the page-level download.

**Probe budget.** Probing follows the same order and stops for a category once it holds 120% of its quota in hard pages that its organizations can still contribute under their cap, or after 2,000 probes. A probe is reused for 14 days and repeated after that, because sites change their defenses. A probe interrupted by the collector's own deadline is discarded.

**Validation.** Probing the 2,494 pages of the November 27, 2026 v6 sample afterwards, all four providers accessed 92% of the 1,882 easy pages, and category-weighted provider scores on them ranged from 96.3% to 98.3%. On the 584 hard pages, all four providers accessed 57%, and scores ranged from 78.2% to 94.1%. Dead pages failed for every provider 86% of the time. The probe rules were fixed before these provider outcomes were compared, with one exception: downloaded non-HTML files were first counted as hard and were moved to easy because a plain request does retrieve them. That change affects every provider alike.

**Limits.** Difficulty is defined from one simple client's point of view. A site that treats the declared research client differently from a browser counts as hard, even if the page is otherwise static. The probe also cannot tell a slow page from a defended one. Source coverage still bounds the sample: categories whose sources serve mostly static pages contribute mostly easy top-up pages. v7 scores are not comparable with v6 scores, because the samples are drawn differently. `TRACE_SAMPLING=all` restores the v6 sample.

## Protocol v6: page access

`scraping-bench-v6` samples draw from every discovered page. A success means actual page data loaded instead of only a barrier, error, or empty shell.

Partial previews, populated listings, publication landing pages, and raw file data count as accessed. Mandatory login screens, CAPTCHA challenges, main-page errors, and empty shells fail when no actual page data loaded. A cookie banner or a broken secondary widget does not fail an otherwise populated page.

TypeSafe's Jev 1.13.0 judge receives at most 12,000 characters from the beginning, middle, and end of the response and a flag indicating whether the evidence was sampled. The v6 access request contains no provider identity, target URL, page title, or category. The prompt treats scraped text as untrusted evidence.

Unclear sampled evidence and judge transport or schema failures remain unresolved. Explicit access failures can be scored even in sampled text. A reported provider retrieval failure counts as failed.

Access does not establish relevance, document identity, completeness, usefulness, or extraction quality. Those require separate grades.

## Earlier protocols and optional grades

Earlier samples retain their own protocol and original substantive-content and document-identity judgments. An in-flight earlier sample completes under its original rules. Its score is not directly comparable with v6 or v7 access.

The separate historical Wikipedia study in [public/data/wikipedia-study.json](../public/data/wikipedia-study.json) retains its original useful-content grades and is excluded from current access scores.

Regrading writes additional rows to the `grades` table without overwriting collection judgments:

- `access` applies the v6 access rubric to retained evidence from an earlier run.
- `quality` asks whether accessed content belongs to the requested document and contains substantive information. This separate request receives target metadata, but no provider name.

Quality grading is optional and adds approximately one judge call per accessed page. See [operations](operations.md) for preview and write commands.

Automated grades can be wrong. Evidence sampling can miss decisive text, and page content can attempt to influence a model. The exact prompt, sampled-input rules, and judge version are public. A blind human-audit workflow exports evidence for review and publishes agreement once labels exist.

## Scores and uncertainty

For each category, success rate is successful outcomes divided by scored attempts. The overall score is the arithmetic mean of the category rates. The eight core categories receive equal weight; Other receives the same weight when present. A missing core category withholds the overall score.

Failures, unresolved judgments, and pending outcomes remain in the denominator. Requests rejected by our own account limits, including HTTP 401, 402, and 429 or exhausted credits, are excluded and reported separately as `excluded`. They do not tell us whether the provider could retrieve the page.

Scores include an approximate 95% confidence interval derived from per-category binomial variance. Pairwise comparisons use exact McNemar tests on shared pages with discordant outcomes. The report groups providers into shared places when the paired test does not separate them at the 95% level. These are pairwise tests; the report does not claim a family-wide multiple-comparison correction.

The API retains names such as `useful` for compatibility. Interpret those fields using the run's `protocol`.

## Latency, quality, and cost

Latency percentiles cover individual retrieval requests, with successful-only percentiles also available. Excluded account-limit responses, interrupted requests, and observed cached responses do not contribute to the latency distribution. Retrieval latency is distinct from total collection time.

The quality funnel separates returned content, page access, document identity, and substantive content. Missing optional grades are unavailable rather than inferred from an access success. Redirects and response length are descriptive signals, not quality scores.

Cost estimates use dated published prices in [config/pricing.json](../config/pricing.json), divided by the observed success rate. Where failed-request billing is unknown, the report states its assumption. Account terms and prices can change.

## Reproducibility and limits

The public report and downloads expose URLs, provenance, outcomes, timing, and retained result metadata. Code, provider settings, judge prompts, and protocol identifiers are in this repository. Private raw responses and grading evidence are not part of the public source or download.

A rerun on the live web will not necessarily reproduce the same bytes or outcome: websites, provider infrastructure, account limits, and models change. Category balance reduces some concentration effects, but it does not remove source-selection bias. Sample scores, uncertainty, and failure reasons should be read together.

The implementation lives in [discovery.ts](../src/lib/benchmark/discovery.ts), [collect.ts](../src/lib/benchmark/collect.ts), [report.ts](../src/lib/benchmark/report.ts), [analysis.ts](../src/lib/benchmark/analysis.ts), and the shared [view builder](../src/lib/benchmark/view.ts).
