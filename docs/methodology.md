# Methodology

TRACE measures scraping on a changing sample of public web pages. Context.dev maintains the project and is one of the measured providers. The goal is a comparison that other people can inspect, challenge, and reproduce.

## A shared, fresh sample

The registry in [config/sources.json](../config/sources.json) contains 198 sources: 197 public feeds, registries, APIs, and sitemaps, and one English Wikipedia recent-changes source. Discovery checks due sources against their polling intervals when the weekly Workflow runs. Wikipedia discovery compares revisions from the previous UTC day to identify newly added external links, retaining the article, revision, and timestamp as provenance.

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

## Protocol v6: page access

The current collector creates `scraping-bench-v6` samples. A success means actual page data loaded instead of only a barrier, error, or empty shell.

Partial previews, populated listings, publication landing pages, and raw file data count as accessed. Mandatory login screens, CAPTCHA challenges, main-page errors, and empty shells fail when no actual page data loaded. A cookie banner or a broken secondary widget does not fail an otherwise populated page.

TypeSafe's Jev 1.13.0 judge receives at most 12,000 characters from the beginning, middle, and end of the response and a flag indicating whether the evidence was sampled. The v6 access request contains no provider identity, target URL, page title, or category. The prompt treats scraped text as untrusted evidence.

Unclear sampled evidence and judge transport or schema failures remain unresolved. Explicit access failures can be scored even in sampled text. A reported provider retrieval failure counts as failed.

Access does not establish relevance, document identity, completeness, usefulness, or extraction quality. Those require separate grades.

## Earlier protocols and optional grades

Earlier samples retain their own protocol and original substantive-content and document-identity judgments. An in-flight earlier sample completes under its original rules. Its score is not directly comparable with v6 access.

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

Pages from one site tend to succeed or fail together; sites contribute up to 375 pages each. As a robustness check, the Sites section also reports a cluster-robust (CR1) 95% interval that treats each hostname (without `www.`) as one cluster within each category, combined with the same equal category weights, and a site-weighted score that averages site-level rates within each category. These do not change the headline score or places. Gaps smaller than the site-clustered interval deserve caution.

The API retains names such as `useful` for compatibility. Interpret those fields using the run's `protocol`.

## Latency, quality, and cost

Latency percentiles cover individual retrieval requests, with successful-only percentiles also available. Excluded account-limit responses, interrupted requests, and observed cached responses do not contribute to the latency distribution. Retrieval latency is distinct from total collection time.

The quality funnel separates returned content, page access, document identity, and substantive content. Missing optional grades are unavailable rather than inferred from an access success. Redirects and response length are descriptive signals, not quality scores.

Latency is also reported by category and by site. A time-budget table gives the share of timed requests that both succeeded and finished within 1, 2, 5, and 10 seconds; it uses page counts rather than category weights.

## Failure analysis

Each failure keeps its normalized reason (timeout, HTTP error, no content, barrier, thin or wrong page, unresolved) and its raw signal: the provider's error code, or the judge's label when the request itself succeeded. Failed pages are further split by what other providers did on the same page: read by at least one other provider (recoverable), read by every other provider, or read by none. Pages no provider read are often removed, gated, or empty rather than evidence against one provider. Failures are also grouped by site. A fallback table reports how many pages each pair of providers reads together, and the share any provider reads is the ceiling for any combination. Fallback and time-budget rates are shares of pages both providers completed, not category-weighted scores.

Cost estimates use dated published prices in [config/pricing.json](../config/pricing.json), divided by the observed success rate. Where failed-request billing is unknown, the report states its assumption. Account terms and prices can change.

## Reproducibility and limits

The public report and downloads expose URLs, provenance, outcomes, timing, and retained result metadata. Code, provider settings, judge prompts, and protocol identifiers are in this repository. Private raw responses and grading evidence are not part of the public source or download.

A rerun on the live web will not necessarily reproduce the same bytes or outcome: websites, provider infrastructure, account limits, and models change. Category balance reduces some concentration effects, but it does not remove source-selection bias. Sample scores, uncertainty, and failure reasons should be read together.

The implementation lives in [discovery.ts](../src/lib/benchmark/discovery.ts), [collect.ts](../src/lib/benchmark/collect.ts), [report.ts](../src/lib/benchmark/report.ts), [analysis.ts](../src/lib/benchmark/analysis.ts), and the shared [view builder](../src/lib/benchmark/view.ts).
