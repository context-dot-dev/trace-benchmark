# Operations

This guide covers your own TRACE deployment. The public [live report](https://trace.context.dev/) can be read without provider credentials.

## Local setup

Use Node.js 24 and PostgreSQL. Install dependencies with `npm ci`, copy `.env.example` to `.env.local`, set `DATABASE_URL` to a development database, and run:

```sh
npm run db:migrate
npm run dev
```

Collection is off by default. To display published data instead of using a local database, run `BENCHMARK_DATA_ORIGIN=https://trace.context.dev npm run dev`. The origin is server configuration; only point it at a report service you trust.

## Deployment and weekly collection

The backend runs in Vercel Functions and uses PostgreSQL through Drizzle; the hosted deployment uses Neon. Configure `DATABASE_URL` directly in Vercel with a pooled, TLS-protected database connection. Apply migrations before enabling collection.

Set the four provider API keys and `TYPESAFE_API_KEY` listed in [the environment template](../.env.example). Generate a random `CRON_SECRET` and set `TRACE_WORKER_ENABLED=1` in the production environment. The [cron configuration](../vercel.json) calls `/api/cron` every Friday at 00:15 UTC (`15 0 * * 5`). Deploy the configuration to production to apply the schedule. That route requires its bearer secret and rejects non-production deployments.

One deduplicated Vercel Workflow performs discovery, freezes the weekly sample, and dispatches independent provider workers. Judging uses a separate pool; database claims, request budgets, and results are persisted in batches. Bounded steps continue without waiting for another cron tick. Due sources are polled during the weekly Workflow. To resume paused or failed collection before the next Friday, call `/api/cron` with its bearer secret. Sample dates use UTC.

All clients retain a 30-second full-body retrieval deadline and judging retains a 60-second deadline. Collection duration depends on supply, provider latency, account capacity, judge throughput, and database performance.

## Capacity and budgets

`TRACE_<PROVIDER>_CONCURRENCY` and `TRACE_<PROVIDER>_RPS` control aggregate provider concurrency and request pacing across Workflow shards. `TRACE_JUDGE_RPS` controls judge dispatch. The [environment template](../.env.example) lists defaults.

Defaults are configuration choices, not statements of the capacity available to your accounts. Use your contracted allowances. The collector also enforces durable daily request and judge budgets.

HTTP 401, 402, and 429 pause affected providers across shards. Judge rejections pause grading while retrieved evidence is retained. Unsent reservations are refunded; in-flight calls finish normally. Interrupted paid retrievals are not automatically repeated.

A 30–60-second collection needs capacity for the full sample. The repository's full-scale fixture grants 1,024 concurrent requests and 200 requests per second per provider, and 1,000 judge requests per second. Its 60-second assertion measures the pipeline against local HTTP fixtures; it is not a live-provider or hosted-scheduler service guarantee. Discovery and sample preparation are outside that timed collection measurement.

## Grading after collection

Collection judgments are never overwritten. Additional grades go to the `grades` table:

```sh
# Preview an access regrade of an earlier sample.
npm run grade -- --rubric access --run scraping-bench-v5:2026-11-06

# Save access grades from retained evidence.
npm run grade -- --rubric access --run scraping-bench-v5:2026-11-06 --write

# Add document identity and substantive-content grades to recent runs.
npm run grade -- --rubric quality --recent 2 --write
```

Without `--write`, the command only previews eligible evidence and planned calls. Write mode calls the judge and persists grades. Evidence must still be retained. Set `TRACE_QUALITY_GRADING=1` to add quality grades automatically after collection. It adds approximately one judge call per accessed page.

## Blind judge audit

Replace the example run ID with a retained run:

```sh
npm run audit -- export --run scraping-bench-v5:2026-11-06 --per-provider 25 --out audit.json
# Reviewers label each item pass, fail, or unclear.
npm run audit -- import audit.json --reviewer "Reviewer name" --write
```

Reviewers receive the URL and the evidence the judge saw, without the provider identity or its verdict. Agreement is published after human labels are imported. Exported audits contain private scraped evidence; keep them outside version control and public issue attachments.

## Retention

| Setting | Default | Meaning |
| :--- | ---: | :--- |
| `TRACE_EVIDENCE_DAYS` | 30 | Days to keep private compressed grading evidence |
| `TRACE_EVIDENCE_MAX_MB` | 900 | Evidence size cap; oldest evidence is removed first |
| `TRACE_RECORD_DAYS` | 180 | Days to keep page-level rows for completed runs |

Run summaries remain after page-level rows expire. Evidence volume depends on the sample and returned content. Retention removes expired evidence without rewriting completed historical outcomes.

After changing summary rules, `npm run resummarize -- --write` recomputes stored summaries from the page-level records that remain. Review comparability before changing a protocol's interpretation.

## Verification

Use the commands and disposable-database precautions in [CONTRIBUTING.md](../CONTRIBUTING.md). Build the production app before running the HTTP Workflow tests, so the 60-second fixture assertion does not include development-server compilation.

## Agent and crawler access

The public site provides `/llms.txt` as a concise index, `/llms-full.txt` as a complete reference with live results, and `/results.md` as the current Markdown report. `/llms.full.txt` redirects to the full reference; `/index.md` redirects to the Markdown report. All support unauthenticated GET and HEAD requests without browser JavaScript or cookies. The index and full reference remain readable when results are unavailable.

`/robots.txt` permits public crawling and excludes `/api/cron` and `/.well-known/workflow/`. Robots directives are advisory; cron authentication and Workflow verification remain responsible for protecting operational routes. `/sitemap.xml` advertises the report, and HTTP `Link` headers advertise the agent index and Markdown alternative.

For a Vercel deployment, keep the AI Bots managed ruleset on Allow for this public benchmark. Check that custom rules, attack mode, or deployment protection do not challenge public read routes. Preserve system DDoS protections and operational authentication. User-agent strings alone do not prove crawler identity. Verify both project firewall configuration and actual GET/HEAD responses after deployment; a robots file cannot override an edge firewall.

Regenerate the committed full references with `npm run docs:agents` whenever public documentation changes. The generator reads only its explicit public-document list. `npm run test:agents` checks the production app against local result fixtures, including a results outage and crawler user agents.
