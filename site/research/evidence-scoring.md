# Offline reference-span recovery v1

`bench.evidence` is a deterministic component check for saved reader output. It does not call a network service or LLM, generate references, alter TRACE's existing metrics, or evaluate answer correctness. Its score means **a normalized reference passage occurred in the captured text**. An unmatched passage is not a false fact: it may be missing, paraphrased, formatted differently, changed since reference capture, or outside a truncated capture.

## Reference contract

A v1 JSON object contains:

| Field | Meaning and validation |
|---|---|
| `schema_version` | Integer `1`; omission also denotes v1. Explicit unsupported versions and booleans are rejected. |
| `source_url` | Absolute HTTP(S) URL with a hostname, valid port syntax and no credentials or whitespace. This is syntax validation, not target identity verification; no URL is fetched. |
| `captured_at` | ISO-8601 timestamp with timezone, such as `2026-09-17T12:00:00Z`. It is an asserted capture time, not independently verified. |
| `reference_text` | Exact nonempty Unicode reference text. |
| `reference_sha256` | Lowercase SHA-256 hex of `reference_text.encode('utf-8')`, before any normalization. This is not the hash of the JSON file. |
| `provenance.method` | `independent_browser` or `publisher_source`. |
| `provenance.independent_of_readers` | Explicit boolean claim; a false value remains visible and is not promoted to independence. |
| `review_status` | `candidate` or `adjudicated`; the scorer preserves the supplied label and never verifies adjudication. |
| `evidence_units` | Nonempty list of `{id, start, end, required}` objects. IDs must be nonempty unique strings; `required` must be an actual boolean. |

`start` and `end` are **Python Unicode character offsets**, with start inclusive and end exclusive: the exact span is `reference_text[start:end]`. They are not UTF-8 byte offsets or JavaScript UTF-16 indices. Bounds must be actual integers (not booleans), satisfy `0 <= start < end <= len(reference_text)`, and identify a nonempty normalized passage. For example, `é` occupies one Python character and two UTF-8 bytes. A JavaScript annotation interface must convert its offsets before exporting this schema.

V1 rejects overlapping spans, repeated IDs and repeated normalized passage text, including repeats at different reference positions. Adjacent spans are allowed. This prevents redundant passages from receiving extra weight. A reference needing nested or duplicate-context units must be reannotated into distinct contextual passages; the scorer does not silently merge or delete them. Repeated occurrences in provider output earn one match per unit, with the first occurrence's position recorded.

No empty reference or empty unit list is scored. If all supplied units are optional, required-unit recovery and the all-required flag are null, not a vacuous success.

## Scoring and limitations

Call:

```python
from bench.evidence import score_evidence
result = score_evidence(reference, saved_provider_text, is_output_truncated=False)
```

The truncation flag is required and must be an actual boolean. A missing provider value is an error; an explicitly saved empty string is valid and leaves every unit unmatched. The caller must distinguish these upstream states.

Both reference spans and the **entire** saved output undergo the same transformation: decode HTML entities once, apply Unicode NFKC, and collapse Unicode whitespace to single spaces. Matching is case-sensitive substring matching. There is no beginning/middle/end sampling, lowercasing, stemming, punctuation deletion, HTML-tag removal or semantic paraphrase matching. Decimal punctuation, minus signs and negation words are not deliberately removed; compatibility normalization can still transform Unicode representations, so this remains a string-level diagnostic.

A matched span does not establish entailment: surrounding text could negate it, quote an incorrect claim, or belong to the wrong document. A short span can occur inside a longer word or number. Reference annotations should therefore include enough relational context, including entities, dates, units, table headers and negation, and undergo separate review. The scorer does not use this advice to invent or auto-approve evidence units. It reports neither factual precision nor certified gold coverage.

The result includes:

- Original reference hash, raw output hash and normalized output hash.
- Source URL, capture timestamp, supplied provenance and supplied review status.
- Per-unit matched/unmatched status, original reference offsets/hash, and first-match offsets in the **normalized output**. These positions must not be applied directly to the raw output.
- All-unit and required-unit matched counts, recovery fractions, and unmatched ID lists.
- `all_required_spans_found_in_captured_text`, explicitly limited to captured text; `is_output_truncated` remains visible even when every required span matches.
- `page_completeness_assessed: false` and `reference_adjudication_verified_by_scorer: false` on every result.

The boolean capture flag is caller metadata, not an independent test for hidden provider truncation. The scorer never concludes that a full page was acquired. It also cannot validate authorship, licensing, truth, freshness, reference independence or human adjudication from metadata alone. Candidate references may be scored for development diagnostics but retain `candidate` status. Reference eligibility for a published benchmark belongs in a separate audited workflow.

## CLI and receipts

Run from the prototype directory with saved local files:

```sh
python -m bench.evidence --reference reference.json --text provider.txt \
  --out evidence-result.json --output-not-truncated
```

For a known truncated capture, replace the final flag with `--is-output-truncated`. Omitting both flags is an error. Input text is read as exact UTF-8 bytes, preserving CRLF rather than converting newlines before hashing. The output path must not already exist, and its parent directory must exist. Existing result files and input files are never overwritten. Invalid references fail before producing a scoring receipt.

## Verification

`tests/test_evidence.py` uses **synthetic fixtures only**, all labeled as such and using an example.com synthetic-fixture URL. These are not fabricated real-world references or benchmark gold. The tests exercise full-text matching beyond 12,000 characters; Unicode, entities and whitespace; decimal/minus/negation changes; invalid hashes, offsets, URLs, dates and provenance; overlap/duplicate policy; optional-only and empty-output behavior; truncation and unverified review labels; input immutability; and an actual CLI subprocess that preserves CRLF and refuses to overwrite receipts.

Run `python -m unittest tests.test_evidence -v`. This primitive needs no additional dependencies and does not publish a new TRACE quality score by itself.
