# Scraping Bench

Daily comparison of context.dev, Exa, Firecrawl, and Keenable on a new sample of pages each day, with category scores, historical results, and downloadable page-level outcomes.

[View the live report](https://trace-benchmark-contextdev.vercel.app/)

## How scoring works

All four providers receive the same daily sample. Protocol v6 measures access only: did page data load, or did the scraper receive only a block, error, or empty shell? TypeSafe's Jev 1.13.0 judge receives up to 12,000 characters from the response's beginning, middle, and end, plus whether the evidence was sampled. For the access score it receives no provider name or target metadata. Relevance, document identity, completeness, usefulness, and extraction quality are not graded.

Partial previews, populated listings, publication landing pages, and raw file data count as accessed. Mandatory login screens, CAPTCHA challenges, main-page errors, and empty shells count as not accessed when no page data loaded. A cookie banner or broken secondary widget does not fail an otherwise populated page. Unclear sampled evidence and judge failures remain unresolved; determinate access failures are scored even when the text was sampled.

Daily scores average each category's accessed-page rate equally. Failed requests, unresolved judgments, and pending results remain in the denominator. Missing any of the eight core categories withholds the overall daily score; the optional Other category of newly added Wikipedia links contributes when present.

Requests rejected by our own account limits (HTTP 401, 402, or 429, or exhausted credits) are excluded from that provider's score and reported separately as `excluded`. They are not retried, so no provider gets a second attempt at a page. When a provider reports that it could not return a page, the result counts as failed, not unresolved.

Earlier protocols and unfinished runs created under them retain their original substantive-content and document-identity grading. Their scores are not directly comparable with v6. The separate historical Wikipedia study is excluded from access scores and remains available with its original useful-content grades. API metric fields named `useful` remain unchanged for compatibility; interpret them using the run's protocol.

## What the report publishes

Every number comes from page-level outcomes, so the page filters apply to every section.

- **Leaderboard.** Each provider's category-weighted score with a 95% confidence interval. Providers share a place unless an exact McNemar test on the pages they disagree on separates them at the 95% level.
- **Head-to-head.** For each pair, the pages one provider accessed and the other missed, with a verdict.
- **Categories.** Rates by category, the pages no provider accessed, and a paired verdict for the top two providers.
- **Latency.** p50, p90, p95, and p99 for all requests and for successful requests, and the timeout rate. A failure at the 27-second deadline counts as a timeout whatever the provider returns: HTTP 408, an empty failure, or our 30-second cutoff.
- **Quality.** A funnel from returned content to accessed, right page, and substantive content, plus redirect and length signals. The last two stages need document and content grades; see *Grading after collection*.
- **Cost.** Each published price in `config/pricing.json`, divided by the access rate, gives the cost per 1,000 pages that load. Providers that do not bill failed requests are marked; for others, failed requests are assumed billed.
- **Failures.** Why pages were not accessed: timeout, HTTP error, no content returned, a block or error screen, or unresolved.
- **History.** Daily scores by protocol and rank stability. Every run is listed, including extra runs on the same day; the most recently created run for a day is charted.

`/llms.txt` serves a plain-text summary of the latest results, and the page includes Dataset and FAQ structured data.

### Cache checks

Every request asks for fresh content, and every response is checked for the provider's own cache marker. A response served from cache is recorded as `CACHED_RESPONSE`, left unresolved, and excluded from latency.

| Provider | Request | Response check |
|---|---|---|
| context.dev | `maxAgeMs: 0` | `cache_metadata.status`, `cache_metadata.age_ms` |
| Exa | `maxAgeHours: 0` | `statuses[].source` |
| Firecrawl | `maxAge: 0`, `storeInCache: false` | `metadata.cacheState` |
| Keenable | `live=true` | `usage.sku` must be `fetch.live` |

## Grading after collection

Collection grades are never overwritten. Extra grades go to the `grades` table:

```sh
npm run grade -- --rubric access --run scraping-bench-v5:2026-11-05          # preview
npm run grade -- --rubric access --run scraping-bench-v5:2026-11-05 --write  # regrade under v6
npm run grade -- --rubric quality --recent 2 --write                         # right page and substantive content
```

`access` regrades a sample from an earlier protocol under the reviewed v6 access rubric, so both scores can be compared on identical evidence. `quality` asks the document and content questions for pages that were accessed; that judge call also receives the requested URL, title, and category, never the provider name. Each graded page costs one judge call, and evidence must still be retained. Set `TRACE_QUALITY_GRADING=1` to grade new samples automatically after collection.

## Judge audit

```sh
npm run audit -- export --run scraping-bench-v6:2026-11-07 --per-provider 25 --out audit.json
# Reviewers set "label" to pass, fail, or unclear for each entry. They see the URL and the judge's evidence, not the provider or verdict.
npm run audit -- import audit.json --reviewer "Name" --write
```

The page publishes how often reviewers agree with the judge once labels exist.

## Retention

| Setting | Default | Meaning |
|---|---|---|
| `TRACE_EVIDENCE_DAYS` | 30 | Days to keep compressed grading evidence for regrades and audits |
| `TRACE_EVIDENCE_MAX_MB` | 900 | Evidence size cap; the oldest evidence is cleared first |
| `TRACE_RECORD_DAYS` | 180 | Days to keep page-level records of completed runs |

Evidence is about 25 MB per day. Daily summaries are kept permanently. After changing scoring rules, `npm run resummarize -- --write` recomputes stored summaries from the records that remain.

## Run locally

Use Node.js 24 and PostgreSQL.

```sh
npm ci
cp .env.example .env.local
```

Set `DATABASE_URL` in `.env.local` to your development database, then run:

```sh
npm run db:migrate
npm run dev
```

Open [localhost:3000](http://localhost:3000). A fresh database has no daily results. Collection is disabled by default; provider credentials are only needed to collect new results.

## Deployment

The backend runs in Vercel Functions and stores data in Neon PostgreSQL through Drizzle. Configure `DATABASE_URL` directly in Vercel with a pooled Neon URL using TLS; a Vercel Marketplace integration is not required. Apply database migrations before enabling collection.

In the Vercel production environment, set the four provider keys and `TYPESAFE_API_KEY` listed in `.env.example`, generate a random `CRON_SECRET`, and set `TRACE_WORKER_ENABLED=1`. Vercel Cron calls `/api/cron` every 15 minutes using that secret. The route rejects unauthenticated requests and preview deployments. Sample dates use UTC.

Cron starts one deduplicated Vercel Workflow. After discovery and sample selection, independent provider workers drain the queue with rolling concurrency. Judging runs in a separate pool, and database claims and results are saved in batches. Slow responses do not hold up other pages or providers. Bounded steps continue immediately; the cron remains for discovery and recovery. Provider requests retain their 30-second deadline, judging retains its 60-second deadline, and daily budgets remain unchanged.

`TRACE_<PROVIDER>_CONCURRENCY` and `TRACE_<PROVIDER>_RPS` set aggregate limits across that provider's shards; `TRACE_JUDGE_RPS` sets the aggregate judge dispatch rate. Defaults are in `.env.example`. HTTP 401, 402, and 429 pause the affected provider across shards; judge rejections pause grading across providers while retrieved evidence stays available. Unsent reservations return to the queue. In-flight requests finish normally. Interrupted paid requests are not automatically repeated.

A 30–60-second collection requires account capacity for the entire sample. The current defaults reflect observed constraints: context.dev's benchmark key allows 700 requests/minute, Firecrawl allows 50 concurrent browsers, and Keenable publishes 10 requests/second. Exa rejected a 90-request/second probe, so its default is 5 pending confirmation of the account allowance. Jev's sustained account allowance has not been verified. Raising these settings without provider capacity can create rate errors and queue timeouts. Collection time also excludes discovery and sample preparation.

Vercel stores workflow execution state; benchmark data stays in Neon. Parallel collection increases peak traffic, database connections, and Workflow usage costs. Retrieval latency under this load may differ from historical runs even though grading and scoring rules are unchanged.

## Verification

Use a disposable local PostgreSQL database: the E2E tests clear the benchmark tables and use HTTP fixtures instead of paid provider calls.

```sh
npm run test:unit
DATABASE_URL=postgresql://localhost/benchmark_verify npm run test:e2e
npm run lint
npm run build
```

The E2E runs write repeatable results to `artifacts/rebuild/`, `artifacts/daily-wikipedia/`, `artifacts/access-judge/`, `artifacts/continuous/`, and `artifacts/parallel/`, which CI retains. Tests use real PostgreSQL and Next.js with Turbopack to exercise workflow deduplication, provider isolation, stalled bodies, rate-limit pauses, claim ownership, budgets, and injected database failures. The full-scale fixture explicitly grants 1,024 concurrent requests and 200 requests/second per provider, plus 1,000 judge requests/second, to verify the 60-second collection target. This measures pipeline capacity with local HTTP fixtures, not live provider capacity, discovery time, quality, or hosted scheduler delivery.
