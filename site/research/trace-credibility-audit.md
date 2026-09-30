# TRACE credibility audit: what the current experiment can support

**Freeze this snapshot as development evidence, fix and validate the measurement, then collect a prospectively specified confirmatory panel.** TRACE currently demonstrates a functioning paired reader harness and a promising Context-versus-datacenter signal on selected pages. It does not yet establish an externally validated reader ranking, factual QA improvement, or better RL training. More unverified labels alone will not fix that.

This review used `artifacts/live-verification/final.json`, its source registry, reader/discovery/judging/export code, the implemented methodology, and the prior eight-observation saved-text audit. No paid APIs, new source fetches, live changes, or historical relabeling were performed. Recomputable counts and snapshot SHA256 are in [trace-credibility-stats.json](trace-credibility-stats.json). Publication ages below treat date-only publication metadata as UTC dates; sub-day age precision is not implied.

## 1. Actual sample size and what happened

There are **150 distinct URLs and 600 provider observations**, not 600 independent examples: 80 independent-panel URLs and 70 NEEDLE-derived URLs. The snapshot has one independent run and two NEEDLE acquisition batches, all on one date, with no repeat cohort. The 150 URLs occupy 75 distinct hostnames. Documents sharing a host, template, organization, query, or collection time can have strongly correlated outcomes. Even calling all 150 URLs statistically independent would overstate the evidence.

| Cohort / reader | Positive | Negative | Unknown | Positive / selected | Unknown-outcome bounds |
|---|---:|---:|---:|---:|---:|
| Independent / Context | 60 | 12 | 8 | 75.0% | 75.0–85.0% |
| Independent / Hetzner | 40 | 25 | 15 | 50.0% | 50.0–68.8% |
| Independent / Exa | 60 | 18 | 2 | 75.0% | 75.0–77.5% |
| Independent / Keenable | 56 | 20 | 4 | 70.0% | 70.0–75.0% |
| NEEDLE URLs / Context | 54 | 12 | 4 | 77.1% | 77.1–82.9% |
| NEEDLE URLs / Hetzner | 38 | 31 | 1 | 54.3% | 54.3–55.7% |
| NEEDLE URLs / Exa | 49 | 20 | 1 | 70.0% | 70.0–71.4% |
| NEEDLE URLs / Keenable | 50 | 19 | 1 | 71.4% | 71.4–72.9% |

These are **guarded model-triage outcomes**, not audited true success counts. The bounds assign unresolved outcomes both ways while assuming resolved labels are correct; they are not confidence intervals and do not include label error. In the independent panel, Context ties Exa in number of positives. A generic claim that Context dominates these providers is unsupported.

The useful Context–Hetzner comparison is paired:

| Cohort | Both positive | Context positive / DC negative | DC positive / Context negative | Both negative | Either unknown |
|---|---:|---:|---:|---:|---:|
| Independent, 80 URLs | 39 | 13 | 1 | 9 | 18 |
| NEEDLE URLs, 70 URLs | 38 | 15 | 0 | 12 | 5 |

Only 62 independent pairs and 65 NEEDLE pairs have two resolved outcomes. Complete-case comparisons are not automatically unbiased: unknown rates depend on returned text length and therefore on provider/extraction behavior. The largest independent-panel cluster explains much of the observed advantage: **8 of the 13 Context-only wins are SEC URLs on one hostname**. Removing SEC leaves 5 Context-only versus 1 datacenter-only resolved wins. This is useful evidence about SEC access, but eight related filings are not eight independent demonstrations across the web.

Pair timing is a strength: the recorded start spread across readers is approximately 75 ms median and under 119 ms maximum. This verifies closely paired client dispatch, not identical upstream fetch times or identical cache states.

## 2. Provider-neutral discovery is not representative discovery

The independent panel deliberately balances eight categories at ten URLs each. It contains 31 hostnames and 38 organization labels. Those labels are insufficient clustering units: several different issuers all use SEC; several projects all use GitHub; different employers use the same ATS platforms. Finance is 8/10 SEC, software/docs is 8/10 GitHub. Jobs comprise five companies, primarily Greenhouse/Lever-style infrastructure; every reader is positive on all ten. That stratum currently differentiates no reader.

The registry has 43 handpicked feeds/APIs/sitemaps. Forty discovery receipts succeeded and three failed: Bombas 429, CNBC 403, NASA Bluesky 400. Those failures yield no candidate pages. The evaluated population is therefore conditional on the discovery method working, although failures are appropriately retained. A generic datacenter discovery collector can exclude precisely the publishers whose access difficulty matters. This does not prove directional bias for a particular reader; it does prove that the sampling frame is narrower than “the web.” Repair discovery against official neutral metadata or add independently obtained URL frames, without using reader success as eligibility.

Additional limitations are concrete: commerce is six preselected apparel brands in the registry and five in this sample; legal is US/UK governmental material; software coverage is mostly release pages rather than documentation pages; the social feed panel uses a few named accounts; many sources expose only their first response or first product sitemap. Category labels do not establish coverage of the underlying topic. Equal category weights are a design choice, not an empirical web-traffic distribution.

The NEEDLE lane is more diverse in hostnames (45), but every page was selected by **Context Search**. Forty queries produced 70 top-two URL slots after five zero-result searches; original ranked slots and zero results remain recorded. This answers “how do readers behave on these Context Search results?” It does not answer which search engine is better, whether the pages answer NEEDLE questions, or how the original NEEDLE benchmark scores. Query families are not verified page types: the scholar lane includes social/video pages, and the news lane includes product/organization sites. Selection through Context Search may correlate with Context's retrievability. The direction and size of that bias are unmeasured.

For a stronger conditional comparison, publish search provenance and either keep one explicitly named search distribution, or predeclare a cross-search frame: original source URLs where available plus deduplicated results from multiple engines with engine/rank strata. Never replace failed top-ranked URLs with easier ones after seeing reader outcomes.

## 3. “Live” describes acquisition, not necessarily document freshness

Of the 80 independent URLs, 68 have publication metadata and 12 do not. Forty-five are at most seven days old, 23 are older than seven days, 22 older than 30 days, and nine older than one year. The oldest dated example is approximately 3,731 days old. All ten commerce pages and two legal pages lack publication dates. All 70 NEEDLE-derived pages lack publication dates in the exported task metadata.

Fresh query generation, a recent discovery timestamp, a live API flag, and a newly published source document are four different properties. The current panel verifies none of their equivalence. Historical filings and releases are legitimate scrape targets; they should be explicitly labeled historical instead of presented as a fresh-web challenge. Keep age strata and unknown-age counts, and maintain an independently verified recent-document subset if freshness is a claim. Do not fabricate publication dates from sitemap modification times.

## 4. The main blocker is measurement validity

The earlier label-blind-selection audit found one obvious false failure among eight reviewed observations. Hetzner's Allbirds page included the exact requested product, price and details beginning around character 4,759. The judge saw characters 0–3,999, 50,353–54,352 and 100,706–104,705, mostly navigation/policies, and reported thin/wrong-target. The audit was provider-visible and small; it cannot estimate a general mislabeling rate. It nevertheless falsifies the assumption that three fixed windows reliably establish absence.

The uniform export guard correctly makes sampled negatives unknown, preserving raw judgments. It affects 11 Context, 13 Hetzner, one Exa and one Keenable observation in this combined snapshot. Another nine observations are judge errors, and one is unresolved model triage. Therefore 26/36 unknowns are a known evidence-window limitation, not unreadable pages. Current unknown fractions are 8.0% Context, 10.7% Hetzner, 2.0% Exa and 3.3% Keenable. Independent-only unknowns reach 18.8% for Hetzner and 10.0% for Context. The asymmetry is methodological, not a finding that some providers are intrinsically uncertain.

Presence judgments can still be false: excerpts may show a related product, syndicated teaser, outdated version, suggested article, or hallucinated provider text. Provider-hidden labels reduce obvious favoritism but do not make Jev ground truth. Confidence is uncalibrated; evidence spans are empty in these saved automated judgments. Sparse releases expose a separate rubric ambiguity: a complete landing page can intentionally contain only metadata and an external release-note link. Paper abstracts count as substantive here; that says nothing about full-paper recovery.

Before confirmatory collection, specify target-dependent acceptance criteria and validate a common evidence policy against independently reviewed outputs. Prefer complete captured text when feasible or exhaustive chunk coverage with verifiable target evidence. Do not let output length become either automatic success or automatic failure. Keep distinct fields for content presence, target identity, completeness, cleanliness and field correctness.

## 5. What exactly is being compared?

The current comparison is **whole reader services against a requests/converter datacenter baseline**. That baseline has no JS/proxy, a 10 MiB origin-body cap, and its own connection/read deadlines. The APIs may internally render, retry, extract, cache and use proxy networks. Native caps and extraction policies differ despite the common visible text limit and 30-second outer budget. A Context advantage is not identifiable as an IP-reputation effect, nor as superiority to every generic scraper.

The contract should state one production question: useful content within a fixed user-visible latency/cost envelope. Keep a requests baseline, and optionally add a documented browser-rendering datacenter baseline as a separate arm if that reflects the intended competitor. Freeze versions and tuning before holdout collection, give all arms equal documented setup effort, and disclose internal retry behavior where known. Do not tune the baseline to obtain a desired 40–50% failure rate.

Origin-status transparency also differs: Context/Keenable expose no verified origin statuses in this snapshot, Exa exposes them for 21 failures, Hetzner for 146/150 attempts. HTTP 200 at the API is not origin access success. Nonempty-return counts are 145 Context, 111 Hetzner, 129 Exa and 137 Keenable; these are useful operational diagnostics, not factual-content quality. Latency summaries include failures, so a reader failing quickly can appear fastest. Report all-attempt latency and successful-content latency separately; missing billing fields preclude complete cost rankings.

## 6. Concrete publication gates

These are proposed gates to freeze **before** a new confirmatory run, not standards retroactively applied to rescue this snapshot.

1. **Define the estimand.** Publish source frame, provider versions/settings, page eligibility, neutral exclusions, time/cost budget, primary outcome and category weights. Commit selection seed and manifest before outcomes. Source failures and all excluded tasks remain visible. Initial 80-page records lack a per-run code hash; disclose that historical limitation and require hashes for every new run.
2. **Validate labels first.** Build a fresh, provider-hidden audit set balanced across providers, page types, length and outcome classes, including unknowns. Two independent reviewers plus adjudication verify target identity and category-specific content requirements against source evidence; track disagreements. As a practical starting size, review at least 400 reader outputs, with a separate random probability sample for estimating prevalence and targeted oversamples for finding defects. Do not quote unweighted error rates from the oversample. Predeclare acceptable false-positive/false-negative uncertainty and increase auditing until supported. Any provider-specific systematic error blocks a ranking.
3. **Resolve missingness.** A provisional threshold of no more than 5% unresolved judgments per provider overall and no more than 10% per primary stratum is reasonable as a workflow gate, not a law of statistics. Always retain selected denominators and worst-case bounds. A claimed advantage should survive unresolved-outcome assignments and audited label uncertainty; otherwise publish it as inconclusive.
4. **Collect independent variation.** Start power planning around 1,000 new URLs, at least 80 hostnames and 14 days, with a frozen target of multiple genuinely different hosts/platforms per category. These are planning targets, not a guarantee of power. Use pilot discordance and domain intraclass correlation to simulate the sample size needed for the minimum useful paired difference. Expand hosts/days before adding many near-identical pages on one host. Report URL count, hostname/platform clusters, organization count, query clusters and repeat count separately.
5. **Analyze paired clusters.** Report paired wins/losses and rate differences within the frozen population, with a domain/platform-aware resampling or hierarchical analysis; for query-derived examples, account for shared queries too. Do not pretend a hostname bootstrap makes a convenience sample representative. Preregister the primary contrast, require its confidence interval to exceed the prespecified practical threshold for a superiority claim, and report all category outcomes and leave-one-large-domain-out sensitivity. Report the result if it is null or unfavorable.
6. **Preserve replay and temporal honesty.** Publish machine-readable manifests, protocol/code hashes, adapter contracts, outcomes, error taxonomy, costs with missingness, and versioned adjudication decisions with evidence locations. Keep a rights-appropriate saved-output replay path and a separately labeled live rerun path. Schedule repeats before acquisition; repeated URLs estimate stability and never inflate the count of independent documents. Current inspected data is development data, not untouched holdout.

A credible pilot can be released before these gates pass if explicitly descriptive, with its failures and unresolved comparisons visible. A public leaderboard or superiority headline should wait.

## 7. Claims ladder: do not skip a rung

| Claim | Evidence required | Current status |
|---|---|---|
| Requests returned nonempty text within budget | Paired immutable request receipts | Available for this finite panel |
| Correct target's substantive content recovered | Validated identity/content rubric with independent audit | Provisional; known judge sampling defect |
| More complete or accurate extraction | Independently verified fields/spans, precision/recall and missing-field scoring | Not implemented |
| Better factual QA | Frozen questions, independently verified answers/evidence, fixed agent/search/model, paired reader substitution, answer grading | Not implemented |
| Better model after RL | Matched training data/compute/base model, randomized training seeds, reader-only training intervention, common-tool and crossed-tool held-out evaluations | Not implemented |

The current defensible sentence is: **“On this 80-URL fixed-source pilot, preliminary guarded triage found useful target content for 60 Context outputs and 40 datacenter outputs; 8 and 15 respectively remain unresolved. Eight of the thirteen resolved Context-only wins are SEC filings. These results motivate independent validation and a broader paired study.”**

The corresponding NEEDLE sentence must explicitly name Context Search as the URL selector. Neither sentence implies a better trained model. For that ultimate claim, use a 2×2 train-reader × eval-reader design, common held-out questions and matched multiple training seeds to separate learned improvements from simply receiving better pages at inference time. Evaluate factual answers and citations, not just final-answer style or reward-model agreement.
