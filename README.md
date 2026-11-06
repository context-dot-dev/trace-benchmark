# Scraping Bench

Daily comparison of Context, Exa, Firecrawl, and Keenable on the same pages, with category scores, historical results, and downloadable page-level outcomes.

[View the live report](https://trace-benchmark-contextdev.vercel.app/)

## How scoring works

All four providers receive the same daily sample. Protocol v5 samples eight categories from public feeds, registries, and sitemaps, plus an optional Other category of newly added Wikipedia links. TypeSafe's Jev 1.13.0 judge receives the target URL, title, category, and up to 12,000 characters from the response's beginning, middle, and end, without the provider name. A result is useful when it contains substantive content matching the requested page. Partial content can pass; this does not measure completeness or factual accuracy against a reference page.

Daily scores average each category's useful-page rate equally. Failed requests, unresolved judgments, and pending results remain in the denominator. Missing any of the eight core categories withholds the overall daily score; Other contributes when present. Negative judgments based on incomplete excerpts remain unresolved. Historical samples retain their original scoring rules and are not directly comparable across protocols. The report also includes a separate historical Wikipedia study.

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

## Verification

Use a disposable local PostgreSQL database: the E2E tests clear the benchmark tables and use HTTP fixtures instead of paid provider calls.

```sh
DATABASE_URL=postgresql://localhost/benchmark_verify npm run test:e2e
npm run lint
npm run build
```

The E2E runs write repeatable check results to `artifacts/rebuild/e2e.json` and `artifacts/daily-wikipedia/e2e.json`, which CI retains. These checks verify collection behavior, not live provider quality or scheduler delivery.
