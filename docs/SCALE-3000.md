# TRACE: 3,000 URLs/day and annual operating costs

Updated17 September2026 local time (deployment18 SeptemberUTC). User request interpreted as3,000 **distinct independent-source URLs per UTC day**, each attempted by every configured reader. Errors remain results; success is not required for a URL to count as an attempted test. No provider plans were purchased by this change.

## Implemented collection profile

- Target375 URLs in each of eight existing categories =3,000/day. All-history URL/document aliases remain excluded from new independent selections. Cross-category quotas are not borrowed; source shortages are visible.
- Hourly batches contain up to20/category =160 URLs. This leaves catch-up room above the125/hour average required; daily caps stop selection at375/category. Activation day can be partial. A target is not a guarantee of availability, throughput or success.
- Global per-organization cap125/day; global per-hostname cap375/day. The current development panel still has concentrated slices, particularly SEC finance. These caps do not satisfy the stricter per-category diversity proposal for confirmatory results. Provisional organization labels are disclosed in the registry; shared platforms and ownership need further review.
-107 registered discovery sources after promoting64 validated additions. A local merged inventory dry-run selected3,000 URLs across97 hostnames. This proves stock for a first panel, not3,000 newly arriving URLs every day. The live worker refreshes a next-day inventory capacity report after discovery.
- Existing readers remain Hetzner, Context, Exa and Keenable. Firecrawl/Jina/Bright Data/Zyte/ScrapingBee prices below are expansion estimates; they have not silently become live benchmark arms.

Paid call ceilings:3,300 attempts/reader/day,4,000 shared Context search/read reservations,60M conservative Jev input-token reservations/day. Existing NEEDLE lane remains40 searches/day and up to80 additional pages, reported separately; these are outside the3,000 independent target. No new repeat panels are scheduled in scale mode. Pre-existing repeat jobs remain preserved.

The worker now reserves multiple request budgets atomically, retains never-started work as `pending_budget` for later resumption, preserves uncertain dispatched requests without automatically repeating them, persists pacing across runs, and emits progress snapshots at most once per60seconds rather than after every observation. Final/lane exports remain unconditional. Less than10GB free storage pauses scaled reader dispatch; no receipts are automatically deleted.

## Current pricing

The September 17 estimates have been superseded by the [September 30 provider
pricing catalog](research/provider-costs-3000-daily.md). That generated report
covers all active providers, full-allowance unit rates, monthly and annual
commitments, overage, and the separate 3,000-page daily workload. Keenable live
fetch still needs an account-specific price, so a complete benchmark budget
cannot be asserted. Collection and verification notes in this document are
historical; consult the live protocol for current cadence and limits.

## Storage and sustainable supply

The previous188MB/952-observation snapshot already includes gzip receipts. A crude linear extrapolation at12,000 observations/day is around2.37GB/day or865GB/year before backup copies; mix and database growth can change this substantially. The current Hetzner filesystem has roughly134GB free. At the crude rate it provides only about50days before the10GB collection guard, not a year of retention. Archive storage must be provisioned and verified before then; current server and storage invoice amounts were not available in this audit. We did not order storage.

The first bottleneck after launch is **daily replenishment**, particularly company filings, research papers, job boards and finite product catalogues. Inspect per-day first-seen candidate arrivals and category shortfalls over several days. Add independently chosen publishers/organizations and source pagination under recorded rules; do not call repeated old URLs new, weaken quotas silently, or fill all shortages from apparel sitemaps. Temporal rereads belong in their own repeat cohort.

## Verification

Local regression suite passed114 tests before deployment, including exact3,000 unique selections across bounded batches, daily/category/host limits, no padding with excess commerce, budget atomicity, resumable unstarted work, persisted pacing and throttled exports. The3,000-selection test uses synthetic metadata and makes no provider calls. Free source tests made73 metadata requests and saved failures as well as successes. Live validation is recorded separately below/with exported run receipts.

Commands (under the normal worker lock):

```sh
python -m bench.cli capacity --profile scale3000 --state /var/lib/trace-bench
python -m bench.cli set-profile --profile scale3000 --state /var/lib/trace-bench
```

`capacity` makes no network/provider calls and creates no run. `set-profile` persists settings; the already-installed hourly worker uses them. `set-profile --profile shadow` restores conservative quotas for future work without rewriting historical results. An open scaled run may exceed shadow quotas and remain pending until budget allows; a rollback does not discard it.


## Live activation receipt

The `scale3000` profile was activated on Hetzner at2026-09-18T01:37UTC. The existing hourly timer remains enabled. Its first scaled tick fetched64 new source endpoints, parsed2,018 candidate rows, and increased the stored inventory to12,636 URLs. The resulting live capacity check selected3,000 eligible URLs,375/category, across92 hostnames with no category deficit. This differs from the local97-host dry run because discovery responses depend on time and egress.

The first bounded scaled reader run is `independent-20260918T013721.524635Z`; real provider observations were being saved during verification. This receipt does not claim all3,000 pages have already completed or that daily replenishment has been established. Counts from the ongoing run will change in the live artifact.
