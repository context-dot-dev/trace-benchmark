# TRACE protocol · trace-live-v3

TRACE compares live page readers on the same public URLs. It is operated by
Context, one of the measured providers. Selection and scoring are open source.

## URL selection

Independent URLs come from the versioned registry in config/sources.json.
Sources are polled at their recorded 1-, 6- or 24-hour intervals. Eight categories
receive equal daily ceilings of 375 pages (3,000 total). Each daily run selects
at most 375 per category (3,000 total), with 125 per organization and 375 per hostname
per UTC day. A large inventory does not guarantee sustained new-URL replenishment.
Selection uses a saved seed before outcomes exist. Publication within seven days
is preferred, but old or unknown-age pages remain eligible. First seen is not
publication time. Duplicate identities already selected are not reused in this
cohort. Sources sharing a platform remain a limitation of domain diversity.

The separate NEEDLE stream snapshots an upstream Hugging Face revision and reads
queries produced within 24 hours. Context Search receives the unchanged query,
requests ten results, and all ten ranked slots are preserved. The limit is ten
searches per family per day, across news, scholar, rare and legal, with at most
up to ten queries per family in the daily run. Duplicate URLs
reuse the same day's acquisition; cross-day repeats are flagged. Query families
are not independently verified page categories. Search-conditioned selection may
favor Context and is never pooled with independent discovery.

A manifest freezes each selected page, provider list, source metadata, settings,
selection hash and code hashes. Empty sources and unmet quotas are retained.
Inventory is not a measured daily replenishment rate; the initial poll is stock.

## Matched requests

Context Markdown, Exa Contents, Firecrawl Markdown and Keenable Fetch receive the
same URL. Calls for a page start together in rotated order with a 30-second client
deadline. Every adapter requests live retrieval: Context `maxAgeMs=0`, Exa
`maxAgeHours=0`, Firecrawl `maxAge=0` with `storeInCache=false`, and Keenable
`live=true`. Saved request parameters are audited separately from provider-reported
cache evidence. Missing cache evidence is unreported; a reported cache hit remains
unresolved. A live request is not independent proof that the provider fetched fresh content. There are no automatic
scraper retries or alternate-provider fallbacks. Returned text is capped at
250,000 characters; truncation is recorded. Measurements include the entire API
response, not the reference browser, queue wait, discovery or judge. API failures
count in latency, but account/configuration/harness errors do not. P50/P95 use
nearest-rank quantiles. Small samples make P95 unstable.

## Useful content

Jev 1.13.0 first receives neutral URL/title metadata and up to 12,000 characters
from the beginning, middle and end. If no positive match is found in a long
response, it reviews overlapping 12,000-character chunks until a match is found,
the entire returned text is inspected, or a judge request fails. Provider names
are omitted. Every assessment, offset and usage receipt is retained. A success requires
substantive content from the correct page; partial content can qualify. Empty
responses and provider errors fail. Unknown identity, missing judgments and
harness/account errors are unresolved. A negative requires full returned-text
coverage and negative assessments throughout. Truncation at the collection cap
remains disclosed; this is not a claim about text beyond that cap. Success uses
all selected pages as its denominator. Unresolved results give an explicit upper
bound of (success + unresolved) / selected. Model confidence is not a calibrated
probability of correctness on this benchmark. These are not factual accuracy or
full-document completeness scores.

## Best observed output

New runs do not render browser references. Each selected URL goes to all providers
with their fresh-fetch setting. After the existing content/identity judgments,
Jev compares the anonymous useful outputs in one request with independent pairwise
choice questions. Each output contributes up to 12,000 characters from its start,
middle and end. This is sampled preference, not full-document recall or factual gold.

The judge considers matching content, meaningful details, tables, structure and
boilerplate. Length alone is not quality. Exact whitespace-normalized duplicates
tie without a model call. A winner must beat or tie every other candidate; several
winners may tie. Low-confidence choices (<0.75), uncertain comparisons and cycles
remain unresolved. The threshold is provisional, not calibrated on human labels.

A complete comparison requires resolved useful-content judgments for every provider,
verified fresh-fetch request settings, no reported cache hits, and request starts
within 120 seconds. A sole useful response is reported separately; if no provider
returns useful content, recoverability is unknown. Missing/account-failed evidence
makes the comparison incomplete. Best-output share uses the same resolved-page
set for every provider, including failed scrapes as non-winners. The useful-content
rate continues to include all selected pages. Correlated errors across providers
can still fool this method; it is never described as ground truth.

Raw comparison requests, responses, anonymous-label mappings, input hashes, usage,
policy and elapsed time are retained privately. Public records include status,
winners, evidence hash, sampling flag and capture-time spread. Comparison
reservations share the daily Jev budget. Interrupted dispatched comparisons are
not silently replayed. Historical browser references remain in the archive and
are not used in this metric. Runtime policy overrides are recorded separately
from frozen manifests, with reasons and execution segments.

## Cost and denominators

USD costs and credits are recorded only when returned by the provider. Different
vendors' credits are not comparable. Missing billing is never zero. USD per 1,000
useful pages is published only with complete reported USD coverage for every
selected page, fully resolved content judgments and at least one useful result. Search, judging, independent browser
and hosting are separate operational costs and are excluded from that metric.
The separate published-price comparison defaults to the lowest-cost public paid
plans for 93,000 monthly base pages (3,000 per day in a 31-day month). Its workload
rate includes subscription fees, unused capacity and whole top-up blocks. The
full-allowance view instead divides the base subscription by all included credits,
following NEEDLE's unit-rate convention. Annual fees use exact commitments divided
by 12. Free allowances and negotiated quotes are excluded. Plan selection models
cost only; it does not establish that a plan meets the measured throughput.

The scatter plot pairs that modeled USD per 1,000 attempted base pages with
confirmed useful pages divided by all selected pages. Unresolved pages stay in
the denominator; their all-useful upper bound is disclosed. Projected cost per
1,000 useful pages uses the same rate, with an optimistic bound for unresolved
results. This projection differs from the stricter provider-reported cost metric
above. Unknown live-fetch prices are excluded from the plot, never treated as zero.
Keenable uses the verified production-account live-fetch price: one credit per
page and $4 per 1,000 purchased credits. Its shared 100,000-credit monthly free
allowance is excluded from the gross comparison. Historical HTTP receipts remain
unknown; the account tariff does not turn them into measured charges.
Changing volume, plan or billing does not change measured quality or latency.
Neither modeled cost is an invoice. Current rates and sources are in
[the pricing catalog](pricing.json) and [provider research](research/provider-costs-3000-daily.md).

Daily reservations cap each reader at 4,000 calls, Context searches+scrapes at 4,000
calls, and judging at 120 million conservative input-token reservations. Full-text
review reserves for every potential chunk before issuing requests and settles
against reported input usage when available. These
limits are not dollar budgets or account-wide limits; other applications can
consume the same account. Failed calls may still be billed.

## Live operation and reproducibility

A persistent systemd timer starts one daily run at 00:15 UTC. One process lock prevents overlapping
workers. Partial runs retain observations and resume only unstarted work. A
capturing/dispatched observation interrupted by process termination is not
silently retried. A missed schedule does not promise backfill. The UI refreshes
its summary every minute and labels stale collector state after 30 hours. It
shows the selected cohort’s last completed run, any current run, and the next
scheduled tick. The leaderboard uses the latest completed daily run, with earlier small batches
clearly labeled until a daily run finishes. All comparisons use non-excluded runs
under v3; earlier
protocols remain downloadable but are not mixed into the new scores.

Browser-free execution uses at most 64 concurrent pages and eight per hostname,
with starts spaced by at least 50 ms globally and 250 ms per hostname. Output
judgments and comparisons each use concurrency sixteen, and scoring overlaps
collection. API deadlines, fresh-fetch parameters and the selected URL set remain
unchanged. Throughput depends on provider quotas; five-minute completion is not
guaranteed. Legacy browser runs keep their lower concurrency limits.
Progress exports run in a separate process so serialization does not block measured
API requests. Run manifests retain execution settings and code hashes for each
worker phase; a run upgraded in place has multiple execution segments, which must
be considered when interpreting its latency. Completed API calls are never replayed.

Public exports contain the latest completed daily panels and in-progress results, 12 run summaries, downloadable selection
manifests, summary metrics, short previews and hashes. Compact daily quality totals
are retained separately for 90 days. Daily points never include unfinished runs;
a completed daily panel replaces earlier small batches on the same UTC date.
Gaps are not interpolated. Small batches from before the daily schedule remain
labeled. The initial migration may select its first daily panel after earlier
hourly batches on the same day; API budgets still include every dispatched call. Full API bodies, browser DOM,
screenshots, credentials and database state stay private. Structured state supports
Neon Postgres; private raw artifacts remain on the collector filesystem. Code is MIT licensed;
third-party content and provider marks retain their own rights. Re-running a URL
later does not reproduce the historical page; exact replay requires the retained
private capture. A release source archive contains no credentials or private data.

A batch invalidated by a documented collector/deployment failure is excluded
for every provider, regardless of outcomes. Its manifest, available observations
and exclusion reason remain public. Account failures within an otherwise valid
batch stay unresolved and remain in its denominator.

Daily comparisons are descriptive: page mix and publisher/platform correlation
prevent treating them as independent randomized trials. Reference coverage,
unknown rates, source failures and category counts must accompany rankings.

A documented worker interruption can be recovered only while stopped: all providers for an affected page are re-acquired together, every original receipt and budget reservation is retained, and the manifest exposes the recovery and attempt numbers. This is never a retry chosen from provider quality scores.
