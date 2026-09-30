# TRACE

A live scraping benchmark. The source repository is currently private. Fresh URLs, matched API calls, useful-content
judgments, best-observed-output comparisons, P50/P95 latency, reported costs and
inspectable run manifests. The website is a mobile-friendly article with real
comparisons; it contains no synthetic rankings.

Live site: https://trace.2.28.61.111.sslip.io/

Private repository: https://github.com/context-dot-dev/trace-benchmark

Authors: Michael Ryaboy (michael@context.dev) and Yahia Bakour (yahia@context.dev). Inspired by [NEEDLE](https://keenableai.github.io/needle/).

See [deployment and scheduling](deploy/README.md) for the running architecture and next steps.

## Run locally

Requires Python 3.12+ and Node 22.12+.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-lock.txt
npm ci
cp .env.example .env
# Fill the five API keys; never put them in site/.
# The production collector uses SQLite; Neon is optional for the dashboard read model.
.venv/bin/python -m bench.cli set-profile --profile live --state state/live
.venv/bin/python -m bench.cli discover --state state/live
.venv/bin/python -m bench.cli run --per-category 1 --state state/live
npm run build
npm run serve
```

Open http://127.0.0.1:8794. The first run selects up to eight independent pages and
makes four reader calls per page, plus content and output-comparison judgments. Commands
that collect or judge incur API usage. Discovery itself uses free public sources.

```sh
# Separate search-discovered cohort: up to 4 searches, 40 URL slots.
.venv/bin/python -m bench.cli needle --per-category 1 --state state/live
# Scheduled workload, bounded by daily ceilings.
.venv/bin/python -m bench.cli tick --state state/live
# Resume only unstarted work. Existing attempts are never silently replayed.
.venv/bin/python -m bench.cli resume --run-id RUN_ID --state state/live
# Deterministic integrity check against retained real receipts; no paid calls.
.venv/bin/python scripts/verify-release.py --state state/live \
  --export site/data/latest.json --out artifacts/verification.json
```

## What the scores mean

- **Useful content:** Jev sees substantive content from the correct page. Partial
  content can pass. Unresolved cases remain in the selected-page denominator.
- **Best observed output:** anonymous pairwise Jev preferences among useful fresh
  responses. Ties, sole useful responses and unresolved cases stay distinct.
  This is sampled preference, not factual gold; new runs do not launch Chromium.
- **Latency:** full response duration, including provider failures, excluding
  account/configuration errors. Same 30-second deadline; P95 needs enough samples.
- **Cost:** provider-reported USD or credits. Missing is unknown. Cost per useful
  page requires complete USD reporting and resolved judgments; credits are not converted to invented prices. Published plan prices and workload budgets are separate projections from the shared `src/pricing-data.js` catalog, exported by the build to `site/pricing.json` and the provider pricing research.

The independent and Context-search-discovered cohorts are always separate. Context
operates this benchmark and is one of the providers. The initial inventory does
not establish daily new-URL supply or scraping difficulty. Read [the protocol](site/plan.md)
for comparison limitations, denominators, sampling, cache requests and audit details.

## Architecture

`config/sources.json → discovery → frozen manifest → parallel readers → pipelined Jev judgments + output comparisons → database → atomic publication → server-rendered React + paginated API`

The existing Python collector owns discovery, accounting, immutable receipts,
resumption and exports. `config/benchmark.json` declares the release provider set;
`bench/capacity.py` holds daily collection ceilings. Each run freezes both. The
legacy `shadow` and `scale3000` profiles preserve earlier experiment behavior.
The `live` profile targets at most 3,000 independent URLs and 400 search-result slots
per UTC day. A single daily run freezes up to 3,000 independent URLs, bounded by
3,500 requests per reader and 4,000 shared Context requests. These are ceilings,
not guaranteed throughput: source replenishment, pacing and budget availability
can reduce collection. The leaderboard uses the latest completed daily run; earlier
small batches remain labeled until that first daily run finishes. A 90-day daily
quality series is retained independently of the detailed result archive.
Registry changes and protocol changes must be recorded, not mixed silently.

React, HeroUI tables, shadcn Base UI, TypeScript and Tailwind power the UI.
Vite builds browser assets into `site/` and server rendering into `server/render/`.
Run `npm run build && npm run serve`; rebuild and restart after source changes.
The Node server embeds precomputed comparisons in the first HTML response. It
serves eight result rows at a time, with evidence fetched only when inspected.
The browser checks the small summary every minute using conditional requests. Components are in `src/components/ui`
via the `@/components/ui` alias. The runtime needs no public database or browser keys.

## Optional Neon dashboard

Production currently uses SQLite for the collector and atomic JSON exports for
the dashboard. This checkout matches that deployed collector; it does not include
the separate, unfinished collector-to-Neon migration.

The optional `trace_dashboard` read model is queried through Drizzle. To use it,
configure server-only Neon credentials, apply the included read-model migrations
and publish a current export with `npm run publish:neon`. Set
`TRACE_DASHBOARD_BACKEND=neon` for the dashboard. This does not move canonical
collector records or private receipt blobs. Without that setup, explicitly use
`TRACE_DASHBOARD_BACKEND=artifact`. See [deployment](deploy/README.md).

## Deploy and release

See [deployment](deploy/README.md). Private receipts and secrets must stay outside
the served directory. The production collector stores structured records in its private SQLite database.
Raw receipts, discovery responses and screenshots still live under `TRACE_STATE`;
back them up separately. The database alone does not contain those private files. The source packager creates a secret-checked ZIP under ignored `artifacts/release/`, never the public site:

```sh
.venv/bin/python scripts/package-release.py
```

The source lives in the private Context organization repository. Caddy serves the
Node dashboard over HTTPS. Only `site/` assets and the explicit API routes are public;
serving the built directory alone does not provide the API or server rendering. The ZIP
contains code, configuration, lockfiles, license and UI assets, not private state
or raw third-party content. Before calling a deployment live, inspect its actual
systemd timer and last completed run; an export timestamp alone is insufficient.

Historical design/research documents in `docs/` describe earlier studies and are
not the v3 specification. `site/plan.md` is authoritative for this release.
Code: MIT. Third-party content, fonts and provider marks: see NOTICE.
