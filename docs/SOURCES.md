# Independent discovery registry v1

This collector discovers candidate URLs from 43 registered, free public metadata endpoints. It does not query a scraper provider, visit candidate pages, or infer scraper performance. `config/sources.json` is the exact endpoint registry. Freeze it with the run; changes create a new registry/method version. Historical discovery has already inspected these sources, so this is a development stream.

## Reproduce

From the prototype directory, load the JSON list and call `bench.discovery.discover(sources, Path("data/private/discovery/<unique-run>"))`. The function returns `candidates`, one `receipts` entry per source, the requested `sources`, and `registry_path`. `limit_sources` limits the first N registry entries for a smoke test; it does not produce a balanced sample. No credentials are required. Each call saves a unique immutable registry snapshot and raw responses; the caller persists the returned manifest/receipts in its run database.

Call `select_candidates(candidates, seen_ids, per_category=2, seed="<committed epoch>/<UTC date>/<batch>", organization_cap=5)` for the first 16-URL batch. It returns selected rows, counts, shortfalls, excluded reasons, overflow IDs and organization counts. Persist the frozen manifest before any page-reader request. The seed must be fixed before outcomes are observed. The selector is pure and order-independent; its freshness reference is the latest discovery response timestamp in the input pool (metadata `discovery_observed_at`, falling back to `discovered_at`), so save the exact pool for replay.

## Sources

| Category | Source IDs / organizations |
|---|---|
| news | `bbc` BBC; `npr` NPR; `aljazeera` Al Jazeera; `cnbc` CNBC; `nytimes_rss` New York Times |
| commerce | `allbirds` Allbirds; `bombas` Bombas; `taylorstitch` Taylor Stitch; `gymshark` Gymshark; `tentree` tentree; `vuori` Vuori |
| jobs | `stripe` Stripe; `figma` Figma; `anthropic` Anthropic; `palantir` Palantir; `spotify` Spotify |
| finance_filings | `apple` Apple; `microsoft` Microsoft; `nvidia` Nvidia; `federalreserve` Federal Reserve Board; `jpmorgan` JPMorgan Chase; `berkshire` Berkshire Hathaway |
| research | `arxiv` arXiv; `plos` PLOS; `nature` Springer Nature; `elife` eLife; `pnas` National Academy of Sciences |
| legal_regulatory | `federalregister` US Federal Register; `uklegislation` UK National Archives; `ftc` US Federal Trade Commission; `cma` UK Competition and Markets Authority; `cfpb` US Consumer Financial Protection Bureau |
| software_docs | `vscode` Microsoft; `rust` Rust Foundation; `kubernetes` Cloud Native Computing Foundation; `firefox` Mozilla; `postgresql` PostgreSQL Global Development Group |
| community_social | `hn` Hacker News; `stackoverflow` Stack Exchange; `bluesky` Bluesky; `nasa` NASA; `nytimes` New York Times; `mastodon` Mastodon |

Transport platforms are not independent organizations: five issuers share SEC, three employers share Greenhouse, releases share GitHub, and public authors share Bluesky. Keep both organization and target-host fields. `firefox` is a historical source ID for Mozilla **geckodriver release pages**, not Firefox browser documentation. The NASA Bluesky handle and Bombas sitemap failed in the initial discovery study; the collector retains and reports those failures instead of dropping them from the registry.

## Exact acquisition and parsing bounds

Six worker threads fetch discovery endpoints with a 20-second socket timeout, a 12 MB body limit, and at least 350 ms pacing between requests to the same host within the process. There are no automatic retries and no paid API calls. Responses retain hashes and immutable raw file paths even when parsing fails; HTTP-error bodies are retained up to 300 KB. RSS/Atom entries, JSON first pages, the first product sitemap, and at most five Hacker News item records are inspected. These bounds intentionally limit the discovery request count; they are not exhaustive inventories. Status `partial` means some candidates were parsed but an adapter/child request failed, `error` means no candidates plus a failure, and `ok` may legitimately contain zero candidates.

Only public HTTP(S) URLs without credentials are accepted. Actual discovery fetches and redirects reject DNS resolutions to non-public addresses. This guard is for a fixed trusted source registry, not a hardened untrusted-URL fetch service: validation and network connection are separate and do not pin DNS. Target URLs receive syntax/literal-IP screening without fetching or resolving thousands of target hosts. Do not advertise target reachability or identity verification from discovery alone.

## Eligibility, identity and time

1. Merchant candidates must contain `/products/` in their URL path. Collections, blogs and other sitemap rows are retained as exclusions before reader acquisition. Lastmod is an update claim, never a publication timestamp. Product variants, locale paths, and identity-bearing query parameters stay intact.
2. Canonical URL IDs are full SHA-256 hashes. Canonicalization removes fragments and known tracking parameters (`utm_*`, `at_medium`, `at_campaign`), normalizes hosts/default ports, and preserves other query strings verbatim. HTTP and HTTPS remain distinct unless explicit metadata joins them. No target request is made to discover redirects or HTML canonicals.
3. Exact URL aliases and same-organization stable document IDs deduplicate candidates. Multiple-category candidates belong to the first eligible category in the order news, commerce, jobs, finance, research, legal, software, community. Cross-day alias exclusion requires the database to persist canonical alias IDs and organization-scoped document keys (`doc:<organization>:<document_id>`), not only the chosen URL ID. `identity_keys(candidate)` exports these keys. Explicit transitive alias chains are joined before selection. Undiscovered aliases remain a limitation.
4. `discovered_at` records this response receipt, not original publication or first-ever observation. The database must preserve its first observation across polls. `published_at` is null when missing/unparseable/timezone-unknown; raw metadata stays available. Date-only publication stays `YYYY-MM-DD` with precision `date` and cannot count as exact rolling 24-hour freshness. Future publication claims are excluded; source-reported updates are separate fields. Lever creation and Bluesky author-claimed creation are explicitly weaker semantics.
5. Language comes only from item/feed metadata. Missing language stays `unknown`; it is never guessed from a title, publisher reputation, or reader success. Known non-English candidates are excluded by selection; unknown rows remain in a separately disclosed language slice. English-only conclusions must use a verified English subset. Feed-level language is inherited metadata, not independent content verification.
6. API objects are not necessarily the same document as the target: Hacker News selects the discussion page, Stack Exchange selects the question, GitHub selects the release page, research often selects an abstract, and a SEC URL is constructed from official filing fields. Save neutral reference packets and verify target identity later; API availability does not prove that a page reader returned the target.

## Selection and supply limits

Organizations receive one candidate per round in a committed hash order. Within an organization, publication reported within seven days is preferred, then candidates are hash-ordered. Unknown/old publication remains eligible as newly selected stock. Quotas are fixed per category; missing supply creates a shortfall, never quota borrowing. The cap of five per organization applies across categories. For multiple batches in a UTC day the orchestrator passes `organization_used` with prior selections so the round robin fills from alternate publishers when an organization has exhausted its remaining allowance. Returned `organization_counts` describes this batch and `organization_usage_after` includes prior usage. New York Times overlaps news/community and Microsoft overlaps finance/software.

The September 17 source study produced 10,469 metadata-eligible candidates from 43 registered sources / 52 GETs, with 50 successful response parses. These are observed stock, not 10,469 verified target pages or evidence of daily replenishment. Initial 80/day supply was demonstrated in a deterministic dry run. Sustained 200/day remains conditional: measure new stable IDs over seven days, add at least one independent news/community organization to satisfy shared organization caps, and disclose platform concentration. Merchant publication freshness cannot be promised from a sitemap. Do not poll old snapshots and relabel their stock as new publication.

No discovery output is reference truth, a sealed holdout, training-ready data, or evidence that Context beats a datacenter reader. Record provider-independent eligibility and unknown identity before the comparison.

## Verification

`python3 -m unittest discover -s tests -p test_discovery.py -v` checks canonical identity, meaningful query preservation, private destination rejection, global caps, deterministic order, aliases/seen exclusion, freshness priority, metadata product filtering, future publication rejection, update/publication separation, failed feeds and immutable receipts. No paid calls or target-page fetches are needed for these tests.

Implementation verification on September 17: the new collector made a five-source free smoke run, preserving 363 candidates and the Bombas 429 failure. Offline replay of all 43 saved source responses parsed 10,472 rows before cross-source URL deduplication and selected exactly 80 (10/category) with no quota shortfalls; the historical unique eligible count is 10,469. The replay retained Bombas HTTP 429 and NASA HTTP 400. These are collector checks, not fresh page-reader comparisons. Runtime receipts are under `state/discovery-smoke-20260917` and `state/discovery-replay-20260917`.
