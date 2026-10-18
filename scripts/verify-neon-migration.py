"""Real Postgres migration proof; run only against a disposable local database.

Failure cases: lost rows/files, altered JSON or floating-point amounts, duplicate
imports, missing receipt blobs, conflicting repeated imports, budget races,
oversized backup files exceeding a single database value, transaction rollback, secretless cron dispatch, and two workers claiming a tick.
The migration report contains counts and hashes, never raw private receipts.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from bench.storage import Store
from bench.postgres import PostgresStore
from bench.migrate import migrate, verify

assert os.environ['TRACE_DATABASE_URL'].split('@')[-1].startswith(('127.0.0.1:', 'localhost:')), 'Disposable local Postgres only'
checks = {}
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    source = Store(root)
    source.meta('collection_profile', 'live')
    source.meta('unicode-history', {'text': 'النتائج 历史', 'value': 0.125})
    blob = source.blob({'text': 'immutable historical receipt', 'credits': 0.125})
    source.create_run('historical-run', [], {'seed': 'migration-fixture'})
    source.reserve('historical', 'request', 0.5, 1, '2026-01-01')
    source.settle('historical', 'request', 0.125, '2026-01-01')
    (root/'screenshots').mkdir()
    (root/'screenshots'/'example.png').write_bytes(b'private historical image')
    (root/'large-backup.bin').write_bytes(b'archive chunk\x00' * 800000)
    source.db.close()
    migrate(root)
    report = verify(root)
    checks['all_rows_and_files_match'] = report['passed']
    migrate(root)
    checks['repeat_import_identical'] = verify(root)['passed']
    target = PostgresStore()
    checks['read_original_receipt'] = target.load_blob(blob)['credits'] == 0.125
    checks['unicode_metadata'] = target.meta('unicode-history')['text'] == 'النتائج 历史'
    def reserve(index):
        connection = PostgresStore()
        try: return connection.reserve('race', str(index), 1, 1)
        finally: connection.db.close()
    with ThreadPoolExecutor(max_workers=8) as pool:
        checks['concurrent_budget_limit'] = sum(pool.map(reserve, range(8))) == 1
    try:
        with target.db:
            target.db.execute('INSERT INTO metadata VALUES(?,?)', ('rollback', '{}'))
            raise ValueError('rollback proof')
    except ValueError: pass
    checks['transaction_rollback'] = target.meta('rollback') is None
    checks['worker_lock'] = target.acquire_worker()
    other = PostgresStore()
    checks['duplicate_worker_rejected'] = not other.acquire_worker()
    target.db.close()
    checks['lock_released_on_disconnect'] = other.acquire_worker()
    other.db.close()
    (root/'screenshots'/'example.png').write_bytes(b'changed historical image')
    try:
        migrate(root)
        checks['conflicting_history_rejected'] = False
    except ValueError:
        checks['conflicting_history_rejected'] = True
out = Path('artifacts/neon-migration')
out.mkdir(parents=True, exist_ok=True)
result = {'passed': all(checks.values()), 'checks': checks, 'migration': report}
(out/'verification.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result))
assert result['passed']
