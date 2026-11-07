# Contributing to TRACE

Useful contributions include broader source coverage, provider-adapter fixes, clearer failure analysis, blind judge audits, and reproducibility improvements. Open an issue to explain the problem or send a focused pull request with relevant validation. Report security issues privately using [SECURITY.md](SECURITY.md).

## Set up

Use the latest Node.js 24 LTS, npm, and a development PostgreSQL database. With nvm, run `nvm install` and `nvm use` in the repository. Follow [the README](README.md#run-locally), then read [AGENTS.md](AGENTS.md) and the files in the area you plan to change.

Keep real credentials in ignored environment files. Collection is disabled by default; running tests uses fixtures, not paid provider calls.

## Verify a change

```sh
npm ci
npm run lint
npm run test:unit
npm run build
```

The integration suite requires a **disposable local database**. It truncates benchmark tables. Set `DATABASE_URL` only to a local test database, then run against the production build:

```sh
DATABASE_URL=postgresql://localhost/benchmark_verify \
  BENCHMARK_E2E_SERVER=start npm run test:e2e
```

The suite runs real PostgreSQL and the actual HTTP provider clients against local fixtures. It checks cron authentication, private-address rejection, provider isolation, duplicate-billing prevention, budgets, rate-limit pauses, evidence retention, judge behavior, and Workflow progress. Child processes block unexpected public-network fetches.

The full-scale fixture also checks 2,500 pages across all four providers within 60 seconds under explicit fixture capacity. It needs available CPU and database capacity. Keep that performance assertion separate from claims about live-provider throughput.

For UI changes, follow the design-system checks in AGENTS.md and verify desktop, phone, keyboard, and empty/error states. For documentation, validate relative links, examples, and any score snapshot against a dated published run.

After editing public documentation, run `npm run docs:agents`. The full agent references are generated from an explicit list of public documents. After building the app, `npm run test:agents` verifies HTTP access, document freshness, crawler discovery, database-outage fallback, and protected operational routes using local fixtures.

## Code map

| Location | Responsibility |
| :--- | :--- |
| `config/sources.json` | Public discovery sources and polling schedules |
| `config/pricing.json` | Dated provider prices and billing assumptions |
| `src/lib/benchmark/discovery.ts` | Public URL validation and candidate discovery |
| `src/lib/benchmark/providers.ts` | Retrieval adapters, cache checks, and judge prompts |
| `src/lib/benchmark/collect.ts` | Sample selection, daily budgets, and retention |
| `src/lib/benchmark/parallel.ts`, `batch-store.ts` | Concurrent workers and durable reservations |
| `src/lib/benchmark/workflow.ts` | Continuous Workflow orchestration |
| `src/lib/benchmark/analysis.ts`, `view.ts` | Shared statistics and report presentation data |
| `src/app/api/` | Read-only public results and authenticated cron trigger |
| `src/components/benchmark/` | Report interface |
| `tests/` | Statistical, integration, and browser verification |

## Methodology changes

Describe how a change affects source coverage, provider request equivalence, scoring, or comparability. Update the methodology and applicable protocol version when the definition of success changes. Preserve previous run identifiers and original collection judgments.

Provider adapters should request fresh content, preserve full-body deadlines, distinguish account limits from retrieval failures, and never write credentials to public results. New source entries must point to public, credential-free URLs and retain useful provenance.

Include new assets' license and attribution where required. The MIT license covers TRACE code; third-party page content and provider marks retain their own rights.
