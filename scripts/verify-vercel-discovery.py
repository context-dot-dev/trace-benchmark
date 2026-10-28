"""Live free-feed discovery into a disposable local PostgreSQL collector.

Failure cases: a batch exceeds its source/host cap, a receipt points at deleted
scratch storage, persisted bytes differ from their hash, or polling ignores due
intervals. No paid reader APIs are called. Retains a JSON verification artifact.
"""
import json
import os
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit
from bench.postgres import PostgresStore
from bench.serverless import discover_due

assert os.environ['TRACE_DATABASE_URL'].split('@')[-1].startswith(('127.0.0.1:', 'localhost:'))
store = PostgresStore()
assert store.acquire_worker()
assert discover_due(store)
receipts = list(store.meta('latest_receipts').values())
checks = {'bounded_source_batch': 0 < len(receipts) <= 16}
sources = {s['source_id']:s for s in json.loads(Path('config/sources.json').read_text())}
checks['bounded_host_batch'] = max(Counter(urlsplit(sources[r['source_id']]['url']).hostname for r in receipts).values()) <= 2
paths = [(request['raw_path'], request['sha256']) for receipt in receipts for request in receipt['requests'] if request.get('raw_path')]
checks['durable_receipts'] = bool(paths)
for path, expected in paths:
    checksum = store.file_checksum(path)
    checks['durable_receipts'] &= bool(checksum and checksum['sha256'] == expected)
checks['candidate_receipt_paths'] = all(c['metadata']['raw_path'].startswith('discovery/vercel/') for c in store.candidates() if c['source_id'] in {r['source_id'] for r in receipts})
checks['poll_intervals_recorded'] = all(store.meta('source_poll:'+r['source_id']) for r in receipts)
report = {'passed': all(checks.values()), 'checks': checks, 'sources': len(receipts), 'receipts': len(paths)}
Path('artifacts/vercel').mkdir(parents=True, exist_ok=True)
Path('artifacts/vercel/discovery.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report));store.db.close()
if not report['passed']: raise SystemExit(1)
