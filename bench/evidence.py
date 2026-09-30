"""Offline normalized reference-span recovery; never a semantic factuality judge."""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit

SCORER_VERSION = 'normalized-span-recovery-v1'


def text_sha256(text: str) -> str:
    """Hash exact UTF-8 text, without normalization or newline conversion."""
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def normalize(text: str) -> str:
    """Decode HTML entities once, apply NFKC, then collapse Unicode whitespace."""
    return ' '.join(unicodedata.normalize('NFKC', html.unescape(text)).split())


def validate_reference(reference: dict) -> dict:
    """Validate shape/offsets, not the truth or independence of a reference.

    start/end are Python Unicode character indices, start inclusive/end exclusive.
    Their hash binds the original UTF-8 bytes; offsets are NOT byte offsets.
    Overlap and repeated normalized passages are prohibited to avoid double weight.
    """
    if not isinstance(reference, dict):
        raise ValueError('reference must be an object')
    version = reference.get('schema_version', 1)
    if type(version) is not int or version != 1:
        raise ValueError('unsupported reference schema_version')
    source_url = reference.get('source_url')
    try:
        if not isinstance(source_url, str) or any(c.isspace() for c in source_url):
            raise ValueError
        parsed = urlsplit(source_url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError
        _ = parsed.port
    except (ValueError, TypeError):
        raise ValueError('source_url must be an absolute HTTP(S) URL without credentials') from None
    captured_at = reference.get('captured_at')
    try:
        if not isinstance(captured_at, str) or 'T' not in captured_at:
            raise ValueError
        captured = datetime.fromisoformat(captured_at.replace('Z', '+00:00'))
        if captured.tzinfo is None or captured.utcoffset() is None:
            raise ValueError
    except (TypeError, ValueError):
        raise ValueError('captured_at must be an ISO-8601 timestamp with timezone') from None
    text = reference.get('reference_text')
    if not isinstance(text, str) or not normalize(text):
        raise ValueError('reference_text must be nonempty text')
    expected_hash = reference.get('reference_sha256')
    if not isinstance(expected_hash, str) or not re.fullmatch('[0-9a-f]{64}', expected_hash):
        raise ValueError('reference_sha256 must be lowercase SHA-256 hex')
    try:
        if text_sha256(text) != expected_hash:
            raise ValueError('reference_sha256 does not match exact UTF-8 reference_text')
    except UnicodeEncodeError:
        raise ValueError('reference_text must be valid UTF-8 encodable Unicode') from None
    provenance = reference.get('provenance')
    if not isinstance(provenance, dict) or provenance.get('method') not in ('independent_browser', 'publisher_source'):
        raise ValueError('unsupported reference provenance method')
    if type(provenance.get('independent_of_readers')) is not bool:
        raise ValueError('independent_of_readers must be an explicit boolean claim')
    if reference.get('review_status') not in ('candidate', 'adjudicated'):
        raise ValueError('review_status must be candidate or adjudicated')
    units = reference.get('evidence_units')
    if not isinstance(units, list) or not units:
        raise ValueError('evidence_units must be a nonempty list')
    ids, passages, ranges = set(), set(), []
    for unit in units:
        if not isinstance(unit, dict):
            raise ValueError('each evidence unit must be an object')
        ident, start, end = unit.get('id'), unit.get('start'), unit.get('end')
        if not isinstance(ident, str) or not ident.strip() or ident in ids:
            raise ValueError('evidence unit IDs must be nonempty and unique')
        if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
            raise ValueError(f'invalid character range for evidence unit {ident}')
        if type(unit.get('required')) is not bool:
            raise ValueError(f'required must be an explicit boolean for {ident}')
        passage = normalize(text[start:end])
        if not passage or passage in passages:
            raise ValueError('evidence spans must contain distinct nonempty normalized passages')
        ids.add(ident)
        passages.add(passage)
        ranges.append((start, end))
    ordered = sorted(ranges)
    if any(right[0] < left[1] for left, right in zip(ordered, ordered[1:])):
        raise ValueError('overlapping evidence spans are not supported in schema v1')
    return reference


def score_evidence(reference: dict, provider_text: str, *, is_output_truncated: bool) -> dict:
    """Find normalized exact spans in ALL captured text; unmatched is not false.

    Truncation must be supplied explicitly. A match is a textual occurrence, not
    proof of entailment, source identity, reference quality, or page completeness.
    """
    validate_reference(reference)
    if not isinstance(provider_text, str):
        raise ValueError('provider_text must be a string; missing output is not empty output')
    if type(is_output_truncated) is not bool:
        raise ValueError('is_output_truncated must be an explicit boolean')
    normalized = normalize(provider_text)
    try:
        output_hash = text_sha256(provider_text)
    except UnicodeEncodeError:
        raise ValueError('provider_text must be valid UTF-8 encodable Unicode') from None
    results = []
    for unit in reference['evidence_units']:
        span = reference['reference_text'][unit['start']:unit['end']]
        needle = normalize(span)
        offset = normalized.find(needle)
        results.append({
            'id': unit['id'], 'required': unit['required'],
            'status': 'matched' if offset >= 0 else 'unmatched',
            'reference_start': unit['start'], 'reference_end': unit['end'],
            'reference_span_sha256': text_sha256(span),
            'match_start_normalized': offset if offset >= 0 else None,
            'match_end_normalized': offset + len(needle) if offset >= 0 else None,
        })
    required = [u for u in results if u['required']]
    matched = [u for u in results if u['status'] == 'matched']
    required_matched = [u for u in matched if u['required']]
    all_required = (len(required_matched) == len(required)) if required else None
    return {
        'schema_version': 1, 'scorer_version': SCORER_VERSION,
        'assessment_scope': 'normalized_exact_span_recovery_in_captured_text',
        'source_url': reference['source_url'], 'captured_at': reference['captured_at'],
        'reference_sha256': reference['reference_sha256'],
        'reference_review_status': reference['review_status'],
        'reference_provenance_claim': dict(reference['provenance']),
        'reference_adjudication_verified_by_scorer': False,
        'provider_text_sha256': output_hash,
        'provider_normalized_text_sha256': text_sha256(normalized),
        'is_output_truncated': is_output_truncated,
        'page_completeness_assessed': False,
        'units': results,
        'unit_count': len(results), 'matched_unit_count': len(matched),
        'normalized_span_recovery': len(matched) / len(results),
        'unmatched_ids': [u['id'] for u in results if u['status'] == 'unmatched'],
        'required_unit_count': len(required), 'matched_required_unit_count': len(required_matched),
        'required_span_recovery': len(required_matched) / len(required) if required else None,
        'unmatched_required_ids': [u['id'] for u in required if u['status'] == 'unmatched'],
        'all_required_spans_found_in_captured_text': all_required,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--text', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    truncation = parser.add_mutually_exclusive_group(required=True)
    truncation.add_argument('--is-output-truncated', dest='truncated', action='store_true')
    truncation.add_argument('--output-not-truncated', dest='truncated', action='store_false')
    args = parser.parse_args(argv)
    try:
        reference = json.loads(args.reference.read_bytes().decode('utf-8'))
        provider_text = args.text.read_bytes().decode('utf-8')
        result = score_evidence(reference, provider_text, is_output_truncated=args.truncated)
        # Never silently replace earlier evidence-scoring receipts or an input.
        with args.out.open('x', encoding='utf-8') as output:
            json.dump(result, output, ensure_ascii=False, indent=2)
            output.write('\n')
    except (OSError, ValueError, UnicodeError) as exc:
        parser.exit(2, f'evidence scoring failed: {exc}\n')


if __name__ == '__main__':
    main()
