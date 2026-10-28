"""Live discovery → durable ingestion → unseen, capped daily selection.

Requires artifacts/e2e/data/supply.json.gz, a read-only production inventory
export containing candidates, seen identity keys and the frozen control panel.
Retains raw receipts and before/after manifests; does not call paid scrapers.
A full inventory is not evidence of sustained daily replenishment.
"""
import gzip
import json
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit
from bench.discovery import discover, select_candidates, identity_keys, CATEGORIES
from bench.storage import Store, now
from bench.capacity import PROFILES

root = Path('artifacts/supply-verification') / now().replace(':', '-')
root.mkdir(parents=True)
with gzip.open('artifacts/e2e/data/supply.json.gz', 'rt') as f:
    baseline = json.load(f)
store = Store(root / 'state')
store.ingest({'candidates': baseline['candidates'], 'receipts': []})
controls = baseline['panel']['tasks']
seen = set(baseline['seen'])
for task in controls:
    seen.update(identity_keys(task))
settings = PROFILES['live']
def selection():
    return select_candidates(store.candidates(), seen, settings['new_per_category'], 'verification:'+now()[:10],
        organization_cap=settings['organization_cap'], hostname_cap=settings['hostname_cap'],
        organization_used=Counter(t['organization'] for t in controls),
        hostname_used=Counter(urlsplit(t['url']).hostname for t in controls))
before = selection()
sources = json.loads(Path('config/sources.json').read_text())
result = discover(sources, root / 'receipts')
store.ingest(result)
after = selection()
checks = {
    'all_categories_have_full_new_page_inventory': all(after['counts'][c] == settings['new_per_category'] for c in CATEGORIES),
    'no_historical_page_reused': all(not identity_keys(t) & seen for t in after['selected']),
    'no_duplicate_urls': len({t['url'] for t in after['selected']}) == len(after['selected']),
    'receipts_retained': all(Path(r['raw_path']).exists() for r in result['receipts'] if r.get('raw_path')),
    'english_docs_scope': all(t['url'].startswith('https://kubernetes.io/docs/') for t in after['selected'] if t['source_id']=='kubernetes-docs'),
    'registry_ids_unique': len({s['source_id'] for s in sources}) == len(sources),
}
report = {'checked_at': now(), 'passed': all(checks.values()), 'checks': checks,
          'before': before['counts'], 'after': after['counts'], 'shortfalls': after['shortfalls'],
          'sources': len(sources), 'failed_sources': [{'source_id':r['source_id'],'error':r['error']} for r in result['receipts'] if r['status'] != 'ok'],
          'candidate_count':len(result['candidates']), 'qualification':'Current unseen inventory after historical exclusions; not a claim about future daily supply.'}
for name, value in [('before', before), ('after', after), ('discovery', result), ('report', report)]:
    (root / (name+'.json')).write_text(json.dumps(value,indent=2)+'\n')
print(json.dumps(report,indent=2)); print('Artifacts:',root)
store.db.close()
if not report['passed']: raise SystemExit(1)
