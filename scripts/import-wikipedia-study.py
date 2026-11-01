import csv, hashlib, json, sys
from pathlib import Path

ledger, manifest = map(Path, sys.argv[1:])
tasks = {t['id']: t for t in json.loads(manifest.read_text())}
pages = []
for row in csv.DictReader(ledger.open()):
    if row['group'] != 'wikipedia_expanded':
        continue
    task = tasks[row['id']]
    pages.append({
        'id': row['id'], 'url': row['url'], 'domain': row['domain'],
        'days': task['days'], 'article': task['articles'][0], 'revision': task['revisions'][0],
        'category': row['category'], 'screened': row['screened_candidate'] == 'True',
        'repeated': row['repeated_strict_hardness'] == 'True',
        'audit': row['audit_status'], 'auditReason': row['audit_reason'],
        'results': {p: {'success': {'True': True, 'False': False}.get(row[p+'_success']),
                        'error': row[p+'_error'] or None}
                    for p in ['context', 'exa', 'firecrawl', 'keenable', 'plain_http']},
    })
assert len({p['id'] for p in pages}) == len(pages) == 1041
assert sum(p['screened'] for p in pages) == 73
assert sum(p['audit'] == 'reference_checked' for p in pages) == 5
out = Path('public/data/wikipedia-study.json')
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({'measuredAt': '2026-10-29', 'sampleDays': ['2026-10-25', '2026-10-27'],
    'ledgerSha256': hashlib.sha256(ledger.read_bytes()).hexdigest(),
    'manifestSha256': hashlib.sha256(manifest.read_bytes()).hexdigest(),
    'grading': 'identity-content-jev-v2', 'pages': pages}, ensure_ascii=False, separators=(',', ':'))+'\n')
print(f'{len(pages)} pages exported to {out}')
