# Pipeline review — September 17, 2026

**All 20 focused pipeline regression tests pass after fixes by the root agent.** This review covered `bench/storage.py`, `runner.py`, `judging.py`, and `export.py`. The reviewer wrote only `tests/test_pipeline.py` and this report; implementation corrections were made by root. All provider and judge calls in these tests were mocked. No additional paid requests were made.

## Findings corrected during review

1. Completed observation pointers could be overwritten by a second `save_observation` call. They now reject silent mutation; recovery must use another attempt.
2. Negative or nonfinite budget amounts could corrupt reservation accounting. Invalid values now fail before insertion.
3. The missing-credential circuit checked older lowercase error codes instead of the adapter's `MISSING_CREDENTIAL`. The circuit now prevents a subsequent dispatch.
4. Export looked for a nonexistent top-level truncation flag, silently showing false. It now reflects the adapter's truncation metadata.
5. Ten-second host start spacing alone allowed overlapping 27-second reads against the same host. Per-host task locks now serialize whole in-flight groups.
6. Judge HTTP failures discarded the response and request ID. Error receipts now retain the private response.
7. Out-of-range judge confidence values could become successful judgments. They now remain unresolved rather than successful.
8. Account-blocked, unattempted placeholders inherited a fake dispatch timestamp from their bookkeeping row. Their public start time now remains null.
9. Character-count divided by two was not a conservative multilingual token reservation. The new UTF-8-byte-based allowance is larger and explicitly reserves overhead. This is a safety estimate, not a documented exact Jev tokenizer calculation; actual token usage still needs monitoring.
10. Private storage inherited permissive default directory modes. The store root now uses0700 and SQLite0600.

The first test run exposed three remaining failures after root's initial corrections; the expanded run exposed the privacy and multilingual-budget issues. The final run passed every test. Tests were not weakened to accept the old behavior.

## Behaviors verified

- Identical private blobs reuse the same content hash; changed content creates another immutable blob.
- Completed observation pointers cannot silently change.
- Duplicate reservations consume no additional budget; cap rejection causes no dispatch; invalid amounts cannot reduce recorded usage.
- A previously dispatched observation or judge job is not automatically replayed on resume. This preserves unknown completion/billing after interruption.
- Missing readers remain explicit placeholders for every selected document/provider, with null success and no fabricated start time.
- Harness failures are unknown; real provider failures are unsuccessful; a substantive wrong target is unsuccessful.
- Judge requests expose target metadata and one arm's text, without provider/status/competing-reader metadata.
- HTTP judge errors retain private evidence and yield unknown success.
- Public export excludes full raw bodies and request credentials; its file serialization redacts a deliberately echoed test key.
- Reader truncation is visible, same-host groups do not overlap, and local private storage is inaccessible to other Unix users through its root directory.

Command:

```sh
/Users/mike/Projects/context-experiments/.venv/bin/python -m unittest discover -s tests -p test_pipeline.py -v
```

Result: **20 tests passed**. These are the reviewer's focused tests, separate from provider, discovery or UI suites.

## Datacenter endpoint inspection

A read-only SSH inspection checked the deployed `/opt/deepresearcher-scrape-eval/server.py`, SHA-256 `aaaa5a5677276b4db163a3a7ddd28217f233b4bbb1bd75a1d20aeeae4be38647`.

The worker validates every DNS-resolved address at actual connection time and rejects nonpublic addresses. It manually follows redirects and reapplies URL validation on each hop; URLs with userinfo or nonstandard ports are rejected. Ambient proxies are disabled. Redirect count and downloaded body size are capped. No endpoint changes or target fetches were made during this check. This was source inspection, not an adversarial network penetration test.

## Limits that must remain explicit

This is a **shadow acquisition/triage pipeline**. Provider-hidden model labels are not independent gold, factual recall, full-document completeness or proof of better RL training. The implementation reviewed does not establish the plan's first200 independent-audit/calibration gate, long-term reference collection, or certified public-ranking readiness. Low-confidence and provider-disagreement cases still require the planned independent review workflow before stronger publication claims.

The common visible-text cap and 12k-character judge windows can hide evidence. Their metadata makes the limitation observable; passing these tests does not solve it. Native provider freshness settings are requested, while internal caches and extraction methods remain different.

Interrupted dispatched attempts remain visibly unresolved and are not silently resumed. A deliberate recovery run needs separate identifiers. The CLI worker lock is important: storage helpers are not designed as a general concurrent multi-process job service or a public API.

Publication must continue to serve only the allowlisted static export, never the private storage directory or whole working tree. The private root permissions and export tests are evidence for that separation, not a substitute for deployment routing checks. No UI files were modified in this subtask, so visual evidence is not applicable.
