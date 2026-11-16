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

The API retains names such as `useful` for compatibility. Interpret those fields using the run's `protocol`.

## Latency, quality, and cost

Latency percentiles cover individual retrieval requests, with successful-only percentiles also available. Excluded account-limit responses, interrupted requests, and observed cached responses do not contribute to the latency distribution. Retrieval latency is distinct from total collection time.

The quality funnel separates returned content, page access, document identity, and substantive content. Missing optional grades are unavailable rather than inferred from an access success. Redirects and response length are descriptive signals, not quality scores.

Cost estimates use dated published prices in [config/pricing.json](../config/pricing.json), divided by the observed success rate. Where failed-request billing is unknown, the report states its assumption. Account terms and prices can change.

## Reproducibility and limits

The public report and downloads expose URLs, provenance, outcomes, timing, and retained result metadata. Code, provider settings, judge prompts, and protocol identifiers are in this repository. Private raw responses and grading evidence are not part of the public source or download.

A rerun on the live web will not necessarily reproduce the same bytes or outcome: websites, provider infrastructure, account limits, and models change. Category balance reduces some concentration effects, but it does not remove source-selection bias. Sample scores, uncertainty, and failure reasons should be read together.

The implementation lives in [discovery.ts](../src/lib/benchmark/discovery.ts), [collect.ts](../src/lib/benchmark/collect.ts), [report.ts](../src/lib/benchmark/report.ts), [analysis.ts](../src/lib/benchmark/analysis.ts), and the shared [view builder](../src/lib/benchmark/view.ts).

## Standalone company SPA study

The standalone study compares Context.dev and Firecrawl on public company-career pages whose useful content requires JavaScript and whose navigation changes content within the same browser document. It has its own manifest and reports; it does not change the scheduled collector or contribute to its scores. A React framework marker, a JavaScript bundle, or an empty initial HTML response alone does not qualify a URL as a single-page application.

### Candidate sources and preparation

The candidate frame uses the public JobHive company inventories for [Workday](https://storage.stapply.ai/jobhive/v1/workday/companies.csv), [Dayforce](https://storage.stapply.ai/jobhive/v1/dayforce/companies.csv), and [Eightfold](https://storage.stapply.ai/jobhive/v1/eightfold/companies.csv). The source manifest records each CSV's SHA-256, byte size, and row count. Its `generated_at` timestamp is source provenance, not the date of a scraping comparison. The retained snapshot for this study was generated on November 15, 2026, at 17:46:28 UTC.

Retrieve the source manifest and complete CSV bytes through the connected Context.dev MCP URL-reading tools, preserving the original bytes. Highlights or a truncated Markdown table cannot replace the CSV. When a source needs byte-range reads, retain the range boundaries and request IDs, assemble the ranges without gaps or overlap, and verify the complete file against the source manifest. The inventories are public; the study does not sign in to career pages. The preparation command reads local files and makes no network requests.

Place the decoded manifest at `artifacts/spa-study/inventory-manifest.json` and the original CSVs at `artifacts/spa-study/{workday,dayforce,eightfold}.csv`, then run:

```sh
npx tsx scripts/spa/prepare.ts \
  --inventory artifacts/spa-study/inventory-manifest.json \
  --sources artifacts/spa-study \
  --out artifacts/spa-study/candidates.jsonl
```

[prepare.ts](../scripts/spa/prepare.ts) checks every source's exact byte size and SHA-256 before CSV parsing. It then checks logical CSV record counts, including quoted fields containing commas, escaped quotes, or newlines. It preserves URL path case, query strings, and fragment routes. Invalid source metadata or candidate URLs stop preparation rather than being silently dropped.

Candidates are ordered by SHA-256 of `seed + ":" + url`, using `trace-spa-v1-20261115` by default; `--seed` selects another explicit order. Only the first URL for each platform tenant is retained. Workday and hosted Eightfold tenants use the first hostname component; Dayforce uses the first path component. Eightfold custom domains use the inventory's tenant slug. Tenant path and slug case are preserved. This is a tenant diversity limit, not proof that distinct tenants belong to distinct corporate groups. The adjacent `.provenance.json` file records the source hashes, source timestamp, seed, counts, and output hash.

### Browser admission

Install the browser engine once before sampling or running the browser E2Es:

```sh
npx playwright-core install chromium
```

```sh
npx tsx scripts/spa/sample.ts \
  --candidates artifacts/spa-study/candidates.jsonl \
  --out artifacts/spa-study/cohort \
  --target 1000 --concurrency 50 --platform-cap 600
```

The sampler defaults to 16 concurrent browser checks and accepts an explicit `--concurrency` up to 50. It considers the fixed candidate order in completed batches and admits at most one URL per tenant and 600 URLs per platform. It retains rejections and inconclusive checks as well as admitted pages. Fewer than 1,000 admitted URLs is an incomplete cohort, even if the available pages are valid SPAs.

An exclusive `sampling.lock` prevents concurrent runs from writing the same output directory. A resume preserves the original `browser.json` and rejects a different browser version or viewport. After an interrupted process leaves a stale lock, verify that its recorded PID is no longer running before removing only `sampling.lock` and repeating the same command. The sampler does not automatically remove a stale or malformed lock.

[verify.ts](../scripts/spa/verify.ts) opens each candidate with JavaScript enabled and disabled in separate Chromium contexts, without account credentials. Admission requires all of the following:

- Both contexts reach the same final URL with no observed HTTP failure. The JavaScript-enabled page has no mandatory login, bot challenge, or main-page error.
- JavaScript-enabled main content contains at least 80 words and 50 distinct words, with a title or visible heading. At least 50 distinct words are absent without JavaScript, and no-JavaScript coverage of the JavaScript word set is at most 25%.
- The initial rendered content is stable before navigation. Clicking a visible, safe, same-origin link changes the URL and substantive content while preserving a document marker installed before load. A full document reload fails this check.

The browser checks avoid submission, application, purchase, account, and destructive actions. Evidence includes JavaScript/no-JavaScript text and HTML, navigation text, verification decisions, browser version, and selected paired screenshots. A failed or timed-out browser check is inconclusive unless the verifier has evidence for a specific rejection.

Initial checks excluded Ashby pages whose links caused a full document reload; the declared preparation frame therefore contains the three platforms above. Server-rendered React sites with useful no-JavaScript content also fail the JavaScript-dependence gate. Neither exclusion implies that an entire platform or framework always behaves that way.

### Evidence replay and final admission

```sh
npx tsx scripts/spa/audit.ts \
  --manifest artifacts/spa-study/cohort/manifest.jsonl \
  --out artifacts/spa-study/audited --revalidate
```

The primary navigation check measures changed content in both directions. Removing a large results list while leaving only a sidebar can therefore pass that first check without loading a substantive destination. The required [audit.ts](../scripts/spa/audit.ts) replays the saved JavaScript, no-JavaScript, and destination texts, checks their metrics against the original verification receipt, and rejects missing or inconsistent evidence, barriers, and insubstantial destinations. In addition to the JavaScript-dependence requirements, a destination must contain at least 80 words, 50 distinct words, and 25 distinct words added relative to the initial page. Removing existing content alone cannot satisfy that gate.

`--revalidate` is optional. It reruns only pages that fail this stronger saved-evidence audit, with a fixed five-second settling period and a 30-second verification budget, then applies the same audit to the supplemental evidence. Original receipts and issues remain retained. Pages that still fail are excluded. The final audited manifest and admission rules are frozen before the full provider comparison; supplemental checks are not selected using provider outcomes.

### Paired retrieval and interpretation

```sh
npx tsx scripts/spa/compare.ts \
  --manifest artifacts/spa-study/audited/final-manifest.jsonl \
  --out artifacts/spa-study/comparison --concurrency 50
```

For a smoke comparison, add `--limit 4` and use a separate output directory. Small runs are labeled pilots; they do not establish the 1,000-page study. The full source manifest hash remains in the pilot metadata. Provider and judge credentials come from `.env` or the process environment, using `CONTEXT_API_KEY`, `FIRECRAWL_API_KEY`, and `TYPESAFE_API_KEY`.

[compare.ts](../scripts/spa/compare.ts) requires positive final-audit admission, the verifier's JavaScript-dependence and same-document navigation evidence, consistent URLs, and retained browser text files. It checks the final destination-content thresholds and freezes the manifest, all three browser-text hashes, source-code hashes, Git revision, and request settings before dispatch. Changed inputs or settings require a new output directory. A durable per-stage ledger and an exclusive output lock prevent a resume or concurrent invocation from repeating dispatched reads or grades; interrupted stages remain unresolved.

Both providers receive each exact URL, including its fragment, with main-content Markdown and caching disabled. Each receives a 27-second upstream timeout and a 30-second full-response cutoff, at five requests per second. Concurrency defaults to 16 and accepts an explicit limit up to 50, as in the full-study command above. Per-page provider work begins concurrently; recorded collection spans and same-URL dispatch skew expose timing differences. Retrieval and grading are separate measurements. Account-limit failures stop new requests for that provider, while judge account rejections stop new grading and preserve retrieval evidence.

The primary report measures TRACE v6 access and retrieval latency. Access includes actual company prose even if a job list remains loading; it does not establish successful job-list rendering. The retained legacy target-content and identity grades are exploratory: a disagreement-focused review of ten saved pairs found contradictory labels on matching populated job lists, including a loading list passing on company prose while a populated list failed. These quality labels cannot support a provider ranking. Both graders omit provider identity; only the legacy quality grader receives target metadata. The adapters retain at most 12,000 sampled characters from output capped at 250,000 characters. Browser snapshots establish SPA admission, not an exhaustive extraction gold standard.

JSON and self-contained HTML reports include page-level evidence, per-platform results, successful/failed/unresolved counts, account exclusions, unsent pages, Wilson confidence intervals, paired access wins with an exact McNemar test, and retrieval latency percentiles for all eligible reads and successful reads. Cached and interrupted reads do not contribute to latency. Rates include unresolved eligible attempts in their denominator; resolved-only rates are separately descriptive. Confidence intervals and paired tests operate on pages and do not account for shared platform implementations or corporate ownership.

This is a dated company-careers SPA stress test, not a representative sample of all SPAs, company websites, languages, or public-web scraping. Source inventories can contain stale or renamed companies; browser checks and live provider calls occur at different times. Read platform counts, unresolved outcomes, request settings, and retained evidence alongside any aggregate comparison.

The local fixture checks make no paid provider calls and retain repeatable JSON evidence:

```sh
npm run test:spa
```

### November 16, 2026 UTC result

The [public dataset](../public/data/spa-company-study-2026-11-16.json) contains the exact 1,000 URLs, tenant identifiers, per-page access/timing outcomes, browser-proof metrics and hashes, request conditions, and aggregate results. It excludes raw scraped text and local filesystem paths. There are 606 hosts and 999 distinct organization names across 1,000 unique platform tenants; this is not a corporate-ownership deduplication.

The initial 1,000 primary admissions yielded 835 strong-audit passes after supplemental checks. An independent Dayforce candidate pool, starting at index 2,400 in the same fixed seed order, supplied 186 read-only audit passes; the first 165 filled the cohort. The original primary prefix ended at index 2,040. The resulting 593 Workday, 395 Dayforce, and 12 Eightfold URLs were frozen before provider requests. No provider results affected selection.

| Provider | Accessed / attempted | Access rate | Median read | p95 read |
| --- | ---: | ---: | ---: | ---: |
| Context.dev | 979 / 1,000 | 97.9% | 2.951 s | 5.218 s |
| Firecrawl | 1,000 / 1,000 | 100.0% | 3.785 s | 6.089 s |

All 2,000 reads completed with determinate access outcomes and no account exclusions. All 21 Context failures were Workday pages (572/593 access); both providers accessed every Dayforce and Eightfold page. The 1,000 matched pairs had 21 Firecrawl-only accesses and no Context-only accesses. The exact paired p-value is 9.54e-7, subject to shared-platform clustering. Median same-URL dispatch skew was 5 ms (p95 10 ms). Collection ran from 07:22:13 to 07:25:37 UTC using fresh main-content Markdown, one attempt per provider/URL, five requests per second, up to 50 in flight, and matching timeout budgets.

The raw run's aggregate status remains `incomplete` because its legacy quality stage has 12 unresolved judgments; collection and all primary access judgments are complete. Legacy quality rates are deliberately excluded from this comparison. Browser admission and read results are different measurements: the URLs are demonstrated SPAs, while the access score alone does not prove full SPA content extraction.

To render a saved report without new provider or judge requests:

```sh
npx tsx scripts/spa/report.ts \
  --report artifacts/spa-study/comparison/report.json \
  --out artifacts/spa-study/comparison/report.html
```

A supplementary offline diagnostic measures exact browser-vocabulary matches in the retained provider excerpts. It subtracts no-JavaScript words from each browser reference, replays reference hashes, and keeps every URL in the denominator:

```sh
npx tsx scripts/spa/coverage.ts \
  --manifest artifacts/spa-study/frozen/manifest.jsonl \
  --report artifacts/spa-study/comparison/report.json \
  --out artifacts/spa-study/coverage
```

This is observed lexical coverage, not semantic quality or job completeness. The 12,000-character excerpt limit affected 354 Context and 365 Firecrawl responses, so observed matches only bound full-output vocabulary matches from below. JavaScript-rendered boilerplate can also match. The diagnostic cannot establish a quality winner.
