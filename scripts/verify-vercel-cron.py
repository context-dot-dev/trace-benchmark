"""HTTP E2E: missing/wrong secrets, disabled collection, and concurrent ticks.

Requires a disposable localhost database prepared by verify-neon-migration.py.
No paid providers or external feed requests are dispatched.
"""
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from pathlib import Path
import httpx
from bench.postgres import PostgresStore

assert os.environ['TRACE_DATABASE_URL'].split('@')[-1].startswith(('127.0.0.1:', 'localhost:'))
secret = secrets.token_urlsafe(32)
checks = {}
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
for configured in (False, True):
    env = dict(os.environ, TRACE_WORKER_ENABLED='0')
    env.pop('CRON_SECRET', None)
    if configured: env['CRON_SECRET'] = secret
    code = f'from http.server import ThreadingHTTPServer; from api.cron import handler; ThreadingHTTPServer(("127.0.0.1", {port}), handler).serve_forever()'
    process = subprocess.Popen([sys.executable, '-c', code], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                response = httpx.get(f'http://127.0.0.1:{port}/api/cron')
                break
            except httpx.ConnectError: time.sleep(0.1)
        checks['missing_auth_'+str(configured)] = response.status_code == 401
        response = httpx.get(f'http://127.0.0.1:{port}/api/cron', headers={'Authorization': 'Bearer wrong'})
        checks['wrong_auth_'+str(configured)] = response.status_code == 401
        response = httpx.get(f'http://127.0.0.1:{port}/api/cron', headers={'Authorization': 'Bearer '+secret})
        checks['disabled_or_unconfigured_'+str(configured)] = response.status_code == (200 if configured else 401) and (not configured or response.json()['status'] == 'disabled')
    finally:
        process.terminate(); process.wait(timeout=10)
store = PostgresStore()
assert store.acquire_worker()
env = dict(os.environ, CRON_SECRET=secret, TRACE_WORKER_ENABLED='1')
process = subprocess.Popen([sys.executable, '-c', code], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            response = httpx.get(f'http://127.0.0.1:{port}/api/cron', headers={'Authorization': 'Bearer '+secret})
            break
        except httpx.ConnectError: time.sleep(0.1)
    checks['concurrent_tick_skipped'] = response.status_code == 200 and response.json()['status'] == 'busy'
finally:
    process.terminate(); process.wait(timeout=10); store.db.close()
store = PostgresStore()
store.close_run('historical-run', 'completed')
store.meta('vercel:migration_verified', True)
store.meta('vercel:lane', 2)
for provider in ('context', 'exa', 'firecrawl', 'keenable'):
    store.meta('circuit:'+provider, {'error_code': 'verification_account_blocked'})
tasks = [{'id': 'page-'+str(i), 'url': 'https://example.com/?trace='+str(i),
          'category': 'news', 'title': 'Verification page', 'source_id': 'verification',
          'organization': 'example', 'discovered_at': '2026-01-01T00:00:00+00:00'} for i in range(9)]
store.create_run('bounded-http-proof', tasks, {'seed': 'serverless-proof'})
env.update({key: 'verification-no-network-circuit' for key in
            ('CONTEXT_API_KEY','EXA_API_KEY','FIRECRAWL_API_KEY','KEENABLE_API_KEY','TYPESAFE_API_KEY')})
process = subprocess.Popen([sys.executable, '-c', code], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            response = httpx.get(f'http://127.0.0.1:{port}/api/cron', headers={'Authorization': 'Bearer '+secret}, timeout=60)
            break
        except httpx.ConnectError: time.sleep(0.1)
    count = store.db.execute('SELECT COUNT(*) FROM observations WHERE run_id=?', ('bounded-http-proof',)).fetchone()[0]
    checks['bounded_first_slice'] = response.status_code == 200 and response.json()['status'] == 'advanced' and count == 32
    checks['unfinished_run_stays_open'] = store.db.execute('SELECT status FROM runs WHERE id=?', ('bounded-http-proof',)).fetchone()[0] == 'running'
    response = httpx.get(f'http://127.0.0.1:{port}/api/cron', headers={'Authorization': 'Bearer '+secret}, timeout=60)
    count = store.db.execute('SELECT COUNT(*) FROM observations WHERE run_id=?', ('bounded-http-proof',)).fetchone()[0]
    checks['next_tick_resumes_without_duplicates'] = response.status_code == 200 and count == 36
    checks['run_completed_after_all_judgments'] = store.db.execute('SELECT status FROM runs WHERE id=?', ('bounded-http-proof',)).fetchone()[0] == 'completed'
    checks['receipts_and_judgments_persist'] = store.db.execute("SELECT COUNT(*) FROM observations o JOIN judgments j ON j.observation_id=o.id WHERE o.run_id=? AND o.blob IS NOT NULL AND j.status='completed'", ('bounded-http-proof',)).fetchone()[0] == 36
finally:
    process.terminate(); process.wait(timeout=10); store.db.close()
result = {'passed': all(checks.values()), 'checks': checks}
path = Path('artifacts/vercel/cron.json'); path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result)); assert result['passed']
