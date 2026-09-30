# Live verification — 2026-09-17

The private dashboard is [localhost:8795](http://127.0.0.1:8795/) through the documented SSH tunnel. Hetzner runs the collector and serves only the static export on loopback. The previous here.now design is not the live benchmark.

## First independent cohort

Run `independent-20260917T160444.588946Z` selected 80 URLs before acquisition: 10 per category, from 31 observed hosts, with no category shortages. Discovery retained 43 source receipts and registered 10,420 unique candidate URLs. These are registered-source pages, not a representative random sample of the entire web. The original bootstrap run predates repeat-panel scheduling and has no retroactively selected repeat panel.

All four readers completed an observation for every selected URL. HTTP success is not counted as content success. The saved judge made 282 model judgments, retained 29 deterministic outcomes and recorded nine HTTP 529 judge errors. One additional identity/content judgment remained unresolved.

| Reader | Observed useful | Known failures | Unknown after reporting guard | Useful-content bounds | p50 completion |
|---|---:|---:|---:|---:|---:|
| Context | 60/80 | 12 | 8 | 75–85% | 3.755 s |
| Hetzner | 40/80 | 25 | 15 | 50–68.75% | 0.637 s |
| Exa | 60/80 | 18 | 2 | 75–77.5% | 1.351 s |
| Keenable | 56/80 | 20 | 4 | 70–75% | 0.810 s |

These bounds treat unknowns as failure or success. They are not confidence intervals and do not cover errors in resolved model labels. Results are preliminary content triage, not full-document completeness, factual accuracy, NEEDLE's search score or evidence of improved RL training.

The first independent run reported 80 Context credits and $0.073 Exa API cost. Other costs were unavailable and were not imputed as zero. The judge reported 822,726 input and 26,116 output tokens; unknown usage from failed calls remains conservatively reserved. Original reservations and measured settlements are separately retained.

## Scoring defect found and guarded

An eight-observation deterministic audit found a false failure: the Hetzner Allbirds result contained the exact product body, but head/middle/tail judge excerpts skipped it. See [the audit](LIVE-AUDIT.md). Two observations per provider are far too few to estimate model error rates, and this inspected panel is now development data.

Decision policy `sampled-negative-is-unknown-v1` therefore marks **all** negative model judgments on text longer than 12,000 characters unknown, uniformly across providers. Seven Context and twelve Hetzner decisions in the initial cohort are affected. The saved labels, confidence, text hashes and original success values remain unchanged. Excerpts can establish observed presence; they cannot establish absence in uninspected text. Full coverage requires a separately validated evidence policy and independent reference evaluation.

## Demonstrated behavior

- The real four-reader independent run and an eight-URL NEEDLE smoke run completed on Hetzner. The smoke used one fresh query per family and unchanged top-two search ranks; cohorts remain separate.
- The dashboard was exercised in the browser: real leaderboard values, category filtering, zero-result search, clear filters, saved evidence inspector and cohort selection. Export downloaded exactly 80 Context records under a Context filter; JSON was parsed and provider/count assertions passed. No browser JavaScript errors were observed during these checks.
- Desktop and 390-pixel mobile layouts were inspected. Wide data tables use their own scrolling regions; long evidence text wraps. The mobile override was reset afterward.
- The Python suite passes 86 tests covering reader contracts, selection, budgets, immutable receipt handling, restart behavior, NEEDLE claims, durable repeats, lane failures and the sampled-negative boundary. JavaScript syntax and real-artifact aggregation checks passed.
- `trace-bench.timer` was enabled and verified for hourly `:15` UTC. A full tick was started against the deployed environment. Current completion/error details are in the exported `operations.last_tick` and systemd journal; enabled does not mean every upstream source succeeded.

## Remaining research gates

Before publishing comparative accuracy claims, create independent evidence references, validate a full-content decision policy on untouched audit data, measure disagreement and confidence calibration, and report source/host clustering. The frozen-agent test must keep model, search results and budgets fixed while swapping the reader. A better-trained-model claim then needs matched training runs and crossed training/evaluation readers. None of those claims follows from this dashboard alone.

The initial local checkpoint was created through SQLite backup during ongoing collection. Its integrity check passed, and all 769 referenced observation/judgment blobs were present in the private local copy. The original reservation ledger was preserved while 282 initial successful responses were settled to their recorded input-token usage. Credentials, database paths and worker source were confirmed unavailable through the static HTTP endpoint.

The bootstrap independent run predates per-run source hashing and therefore has no retrospective code hash. Its saved request configurations, response receipts, timestamps and judge version remain available. Later runs store protocol and Python source hashes; exports separately identify the reporting-decision policy.

## Completed launch totals

The full scheduled tick finished successfully at 2026-09-17 16:21:52 UTC with no lane errors. All three runs completed: 80 independent pages and 70 NEEDLE pages, totaling 600 reader observations. Forty NEEDLE searches produced 70 top-two URL slots; five queries returned zero results, all preserved. There were no duplicate URLs among today's 70 NEEDLE acquisitions. The two batches predate the new cross-batch reuse metadata, so their new metadata fields remain null rather than being retrospectively fabricated.

Across all launch runs, the judge reported 1,555,317 input and 47,532 output tokens across 513 responses with usage. Effective reserved input usage was 1,651,522 tokens, including unreported failed-call reservations. Context had 190 one-credit reservations: 150 reads and 40 searches. Each reader had 150 attempts. All were below their daily caps. Final browser checks confirmed the corrected initial-cohort bounds, 280 NEEDLE records for 70 task slots, an enabled scheduler and no observed console errors.

The final local database checkpoint also passed integrity verification: all 600 observations and all 1,123 referenced immutable observation/judgment blobs were present.
