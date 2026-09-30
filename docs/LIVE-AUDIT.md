# Initial live-run audit — 2026-09-17

**One clear false failure in eight deterministically sampled observations.** Six substantive-content classifications agree with the saved text; one additional sparse release page exposes a rubric boundary. This is a small qualitative audit, not gold labels or an estimate of the full run's error rate. No historical judgment was changed.

The audited run is `independent-20260917T160444.588946Z`. For each provider, select the two observation IDs with the lowest SHA256 of `observation_id + 'audit-v1'`. The eight IDs and selection timestamp were saved in [manual-audit.json](../artifacts/live-verification/manual-audit.json) before retrieving texts or labels. SQLite access on Hetzner used read-only mode; only saved text and neutral task metadata were inspected. Saved labels were read after the text review. Provider identity was visible. No new source fetches or paid API requests occurred.

| Provider | Target | Saved triage | Audit |
|---|---|---|---|
| Context | [Taylor Stitch Moto Jacket](https://www.taylorstitch.com/products/the-moto-jacket-in-black-steerhide) | substantive / match | Agree: exact product, price and specifications |
| Context | [eLife 108241](https://elifesciences.org/articles/108241) | substantive / match | Agree: exact title and substantive abstract and article passages |
| Exa | [Rust 1.77.0](https://github.com/rust-lang/rust/releases/tag/1.77.0) | substantive / match | Agree: specific release changes |
| Exa | [Palantir internship](https://jobs.lever.co/palantir/774cf5c9-bf6a-4d77-bf60-d50ef1beb1a0) | substantive / match | Agree: exact role and substantial job description |
| Hetzner | [NPR coastal homes article](https://www.npr.org/2026/09/17/nx-s1-5844642/fema-homes-collapse-ocean-climate-north-carolina-maine) | substantive / match | Agree: exact article with extensive reporting |
| Hetzner | [Allbirds Tree Skipper](https://www.allbirds.com/products/mens-tree-skippers-jet-black) | thin / wrong_target | **Clear false failure:** exact product and substantial details present |
| Keenable | [VSCode 1.138.0](https://github.com/microsoft/vscode/releases/tag/1.138.0) | thin / match | Defensible but ambiguous: release metadata and an external notes link |
| Keenable | [geckodriver v0.9.0](https://github.com/mozilla/geckodriver/releases/tag/v0.9.0) | substantive / match | Agree: specific Added and Changed release notes |

## Reproducible failure mechanism

The Allbirds saved text has 104,706 characters. The current judge receives three 4,000-character windows starting at 0, 50,353 and 100,706. The exact product heading and price begin at character 4,759, followed by sizes, fit, materials and care details. None of those body passages is in the judge input: the first window is navigation, and the latter windows are largely policies/footer content. The model's 0.85 confidence does not repair missing evidence. This is principally an evidence-selection failure; it should not be presented as proof that the reader fetched the wrong page.

The artifact retains a short exact quotation, character offset and full saved-text hash per reviewed observation. The audit checked main-content existence and identity, not every character of each long document, full field recall, factual correctness, freshness or completeness.

## Consequences for the benchmark

1. Current rates must remain explicitly labeled provisional model triage. Providers returning more boilerplate can lose points solely because the judge misses the body; clean extraction and content availability are different dimensions.
2. Version a provider-independent evidence policy and replay **all saved provider outputs**, preserving old labels. Prefer full-text judging within context limits, or exhaustive chunks with document identity checked against actual target passages. A negative conclusion should require coverage of the whole captured text, not three arbitrary windows. Validate cost/context limits before spending.
3. Keep a fixed adjudication sample separate from policy development. This inspected panel is now development data; it cannot become an untouched test set. Expand later with separately reported low-confidence/negative oversamples and a fresh random sample.
4. Define sparse release pages explicitly. A valid release page can intentionally link elsewhere for detailed notes. Score recovery of the requested landing page separately from following links or recovering external release notes.

All eight sampled observations returned text, so this audit supplies no direct check of empty responses, account failures or timeouts. Two per provider is much too small for provider rankings or error-rate claims; sampled targets differ across providers and are not paired comparisons. The original 80-URL run predates repeat preselection and is not retrospectively described as having a predeclared repeat panel.

## Immediate export guard

The root implementation now adds a uniform decision guard: when a model-triaged negative used a text longer than 12,000 characters, export its benchmark decision as **unknown** while preserving the original model labels and original success value. The full text was not observed by the judge, so its excerpts cannot establish that target content is absent. This applies to every provider and every model-negative class, including wrong-target judgments. Exactly 12,000 characters fits the original judge window and is outside the guard. Deterministic empty/provider failures and infrastructure unknowns retain their existing treatment. Positive triage still means sampled content was found, not that the document was fully recovered. This immediate guard does not replace the broader evidence-policy improvement above.

Code review and six direct boundary checks confirmed the guard preserves a negative at 12,000 characters, guards it at 12,001, covers wrong-target negatives, and preserves deterministic failures, positive results and infrastructure unknowns. Raw receipts were not edited.
