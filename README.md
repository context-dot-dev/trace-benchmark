# Scraping Bench

Daily comparison of Context, Exa, Firecrawl, and Keenable on the same pages, with category scores, historical results, and downloadable page-level outcomes.

[View the live report](https://trace-benchmark-contextdev.vercel.app/)

## How scoring works

All four providers receive the same daily sample. Protocol v6 measures access only: did page data load, or did the scraper receive only a block, error, or empty shell? TypeSafe's Jev 1.13.0 judge receives up to 12,000 characters from the response's beginning, middle, and end, plus whether the evidence was sampled. It receives no provider name or target metadata. Relevance, document identity, completeness, usefulness, and extraction quality are not graded.

Partial previews, populated listings, publication landing pages, and raw file data count as accessed. Mandatory login screens, CAPTCHA challenges, main-page errors, and empty shells count as not accessed when no page data loaded. A cookie banner or broken secondary widget does not fail an otherwise populated page. Unclear sampled evidence and judge failures remain unresolved; determinate access failures are scored even when the text was sampled.

Daily scores average each category's accessed-page rate equally. Failed requests, unresolved judgments, and pending results remain in the denominator. Missing any of the eight core categories withholds the overall daily score; the optional Other category of newly added Wikipedia links contributes when present.

Earlier protocols and unfinished runs created under them retain their original substantive-content and document-identity grading. Their scores are not directly comparable with v6. The separate historical Wikipedia study is excluded from access scores and remains available with its original useful-content grades. API metric fields named `useful` remain unchanged for compatibility; interpret them using the run's protocol.

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

A 30–60-second collection requires account capacity for the entire sample. The current defaults reflect observed constraints: Context's benchmark key allows 700 requests/minute, Firecrawl allows 50 concurrent browsers, and Keenable publishes 10 requests/second. Exa rejected a 90-request/second probe, so its default is 5 pending confirmation of the account allowance. Jev's sustained account allowance has not been verified. Raising these settings without provider capacity can create rate errors and queue timeouts. Collection time also excludes discovery and sample preparation.

Vercel stores workflow execution state; benchmark data stays in Neon. Parallel collection increases peak traffic, database connections, and Workflow usage costs. Retrieval latency under this load may differ from historical runs even though grading and scoring rules are unchanged.

## Verification

Use a disposable local PostgreSQL database: the E2E tests clear the benchmark tables and use HTTP fixtures instead of paid provider calls.

```sh
DATABASE_URL=postgresql://localhost/benchmark_verify npm run test:e2e
npm run lint
npm run build
```

The E2E runs write repeatable results to `artifacts/rebuild/`, `artifacts/daily-wikipedia/`, `artifacts/continuous/`, and `artifacts/parallel/`, which CI retains. Tests use real PostgreSQL and Next.js with Turbopack to exercise workflow deduplication, provider isolation, stalled bodies, rate-limit pauses, claim ownership, budgets, and injected database failures. The full-scale fixture explicitly grants 1,024 concurrent requests and 200 requests/second per provider, plus 1,000 judge requests/second, to verify the 60-second collection target. This measures pipeline capacity with local HTTP fixtures, not live provider capacity, discovery time, quality, or hosted scheduler delivery.
