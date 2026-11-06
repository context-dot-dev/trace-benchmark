<div align="center">

<a href="https://trace.context.dev/">
  <img src="docs/assets/trace-header-v2.png" alt="TRACE by context.dev: how reliably can web scrapers read a page? Each day a new fresh sample goes to context.dev, Exa, Firecrawl, and Keenable." width="960">
</a>

<h1>TRACE</h1>

<p>Transparent Real-world Assessment of Content Extraction</p>

<p><strong>A live, open-source scrape benchmark for AI agents.</strong></p>
<p>Fresh pages every day. The same sample for every provider. Results you can inspect.</p>

<p>
  <a href="https://trace.context.dev/">Live leaderboard</a> ·
  <a href="#latest-published-results">Results</a> ·
  <a href="docs/methodology.md">Methodology</a> ·
  <a href="#run-locally">Quick start</a> ·
  <a href="#citation">Citation</a>
</p>

<p>Built by <a href="https://context.dev">Context.dev</a> · TypeScript · MIT licensed</p>

</div>

## Why TRACE exists

An AI agent is only as useful as the pages it can read. Websites change, new pages appear, and a scraper that works on a familiar test set may struggle on tomorrow's web.

TRACE compares **context.dev, Exa, Firecrawl, and Keenable** on a fresh daily sample of public pages. It measures whether each provider retrieves a page, how long the request takes, what fails, and what successful retrieval costs. The report includes category breakdowns, paired comparisons, history, and downloadable page-level outcomes.

Context.dev builds and maintains TRACE and is also one of the providers tested. The benchmark is designed for a fair, reproducible comparison: every provider receives the same frozen sample, caching is disabled, the automated judge does not receive the provider's name, and the collector, prompts, settings, and scoring code are public. Source selection and automated grading still involve judgment; [the methodology](docs/methodology.md) makes those choices and limitations explicit.

## Latest published results

**November 6, 2026 UTC · 2,527 pages · protocol v5 · useful-content scoring**

| Provider | Useful-content score¹ | Median latency | p95 latency |
| :--- | ---: | ---: | ---: |
| context.dev | 87.0% ± 1.3 | 1.75 s | 8.91 s |
| Exa | 79.1% ± 1.5 | 1.20 s | 18.11 s |
| Firecrawl | 82.3% ± 1.4 | 1.59 s | 11.14 s |
| Keenable | 84.2% ± 1.4 | 1.27 s | 16.78 s |

¹ Category-weighted scores; ± values are percentage points for the 95% confidence interval. Latency includes successful and unsuccessful timed requests with caching off. Values come from the [published page-level dataset](https://trace.context.dev/api/benchmark?run=scraping-bench-v5%3A2026-11-06), scored with the same code as the report. This table is a dated snapshot; the [live leaderboard](https://trace.context.dev/) updates as new results arrive.

**Read the protocol alongside the score.** This published sample uses v5, which requires useful content from the requested page. The current collector creates v6 samples, which measure page access: did actual page data load instead of a block, error, login screen, or empty shell? Earlier samples retain their original scoring. Compare results within the same protocol.

## How new data arrives every day

1. **Discover.** The [source registry](config/sources.json) contains 197 public feeds, registries, APIs, and sitemaps, plus English Wikipedia's recent changes. Sources are polled on their own schedules. Wikipedia discovery compares revisions from the previous UTC day and collects newly added external links.
2. **Sample.** From **00:15 UTC**, the collector selects up to 300 previously untested URLs per category, usually about 2,500 pages in total, with a maximum target of 2,700. Selection is deterministic for the day, balances organizations, and caps any one organization at 125 pages and any one hostname at 375.
3. **Freeze and fetch.** The sample is saved before collection. All four providers receive the same URLs with fresh-fetch settings. Independent, rate-limited workers make one retrieval attempt per provider and page.
4. **Judge.** A provider-blind automated judge evaluates the returned evidence under that sample's protocol. Failures and unresolved judgments remain visible. Account-limit rejections are reported separately.
5. **Publish.** Scores fill in as results are saved. The report exposes the sample, category scores, head-to-head outcomes, latency, cost estimates, failures, and history. Previously selected URLs stay excluded from future samples.

The eight core categories are **news, commerce, jobs, finance, research, legal and government, software and documentation, and community**. New Wikipedia links form an additional **Other** category when available.

A Vercel Cron trigger runs every 15 minutes and starts one deduplicated Workflow. The Workflow continues collection between cron ticks; the daily sample is drawn once. See [collection, deployment, and retention](docs/operations.md).

## How to read the results

- **Score:** each category has equal weight. A large source cannot dominate the result just by contributing more pages. A missing core category withholds the overall score.
- **Uncertainty:** confidence intervals accompany scores. Paired comparisons use the same pages and exact McNemar tests; a numerical lead alone does not establish a winner.
- **Latency:** p50, p90, p95, and p99 describe individual retrieval requests. Total collection time also includes dispatch, rate limits, judging, and persistence.
- **Quality:** optional document-identity and substantive-content grades add detail beyond v6 page access. Those grades do not change the access score.
- **Cost:** published provider prices are divided by the observed success rate. Pricing dates, billing assumptions, and exclusions are visible in the report.
- **Failures:** timeouts, provider errors, block screens, missing content, unresolved judgments, and account limits are distinguished.

The [full methodology](docs/methodology.md) documents the prompts, cache checks, deadlines, denominator rules, legacy samples, and limitations.

## Run locally

Use the latest **Node.js 24 LTS**, npm, and PostgreSQL. An `.nvmrc` is included for nvm users.

```sh
git clone https://github.com/context-dot-dev/trace-benchmark.git
cd trace-benchmark
npm ci
cp .env.example .env.local
```

Set `DATABASE_URL` in `.env.local` to a development PostgreSQL database, then:

```sh
npm run db:migrate
npm run dev
```

Open [localhost:3000](http://localhost:3000). A fresh database starts without daily results. Collection is disabled by default; provider and judge credentials are needed only to collect new samples.

To browse the published results locally without a database or provider keys, run:

```sh
BENCHMARK_DATA_ORIGIN=https://trace.context.dev npm run dev
```

Deployment, collection limits, regrading, and retention are covered in [the operations guide](docs/operations.md).

## Explore the data

Public endpoints require no credentials:

| Endpoint | What it returns |
| :--- | :--- |
| [`/api/report`](https://trace.context.dev/api/report) | Latest sample, historical summaries, health, and paginated result rows |
| [`/api/benchmark`](https://trace.context.dev/api/benchmark) | The dataset used by the report, including page-level outcomes for the selected run |
| `/api/download?run=<run-id>` | A run's page-level outcomes as newline-delimited JSON |
| [`/llms.txt`](https://trace.context.dev/llms.txt) | Concise documentation index for agents |
| [`/llms-full.txt`](https://trace.context.dev/llms-full.txt) | Full agent reference with live results; `/llms.full.txt` is an alias |
| [`/results.md`](https://trace.context.dev/results.md) | Current scores and analysis in Markdown, without JavaScript |

```sh
# Inspect the latest published sample.
curl -fsS https://trace.context.dev/api/report | jq '.latest'

# Download the dated sample shown above.
curl -fsSG https://trace.context.dev/api/download \
  --data-urlencode 'run=scraping-bench-v5:2026-11-06' \
  -o trace-results.ndjson
```

Both JSON endpoints accept `?run=<run-id>`. `/api/report` also accepts `provider` and a zero-based `page`. Public downloads contain outcomes and provenance; raw scraped text, private grading evidence, and credentials are excluded.

Agent documentation is also committed as [llms.txt](llms.txt), [llms-full.txt](llms-full.txt), and [llms.full.txt](llms.full.txt). Run `npm run docs:agents` after editing the public documentation; production builds regenerate the full reference automatically. `/robots.txt` allows public crawling and excludes the collection trigger and Workflow callbacks. HTTP `Link` headers advertise the agent index and the Markdown report.

## Contribute

Improvements to source coverage, provider adapters, judge audits, and reproducibility are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, verification, and the code map. Explain how a proposed methodology change affects comparability across protocols.

For a security issue, use the private reporting path in [SECURITY.md](SECURITY.md).

## Citation

If you use TRACE in your work, please cite:

```bibtex
@misc{trace2026,
  author = {Bakour, Yahia and Ryaboy, Michael},
  title  = {{TRACE}: A Live Open-Source Scrape Benchmark for {AI} Agents},
  year   = {2026},
  url    = {https://github.com/context-dot-dev/trace-benchmark},
  note   = {Contact: yahia@context.dev,michael@context.dev}
}
```

## Credits and license

The fresh-sample approach is inspired by [NEEDLE: A Live Open-Source Search Benchmark for AI Agents](https://keenableai.github.io/needle/) by Andrey Styskin, Matthias Petri, and Ilya Gusev. TRACE evaluates scraping; NEEDLE evaluates search.

TRACE code is available under the [MIT license](LICENSE). Third-party pages, datasets, provider marks, and fonts retain their own rights and licenses; see [NOTICE](NOTICE).
