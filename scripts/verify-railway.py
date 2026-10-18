"""Run the production entrypoint against a private volume, without paid collection.

Failure cases: missing database, duplicate supervisors, public private files,
missing exports, port binding, process shutdown, and state lost on restart.
"""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from bench.storage import Store

checks = []

def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)

with tempfile.TemporaryDirectory() as temporary:
    volume = Path(temporary)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = {**os.environ, 'TRACE_VOLUME_PATH': str(volume), 'PORT': str(port),
           'TRACE_WORKER_ENABLED': '0', 'HOST': '0.0.0.0'}
    command = [sys.executable, 'deploy/railway.py']
    missing = subprocess.run(command, env=env, capture_output=True, timeout=15)
    check('Refuses an unimported volume', missing.returncode != 0)
    state = Store(volume / 'private')
    state.meta('migration-check', 'retained')
    state.db.close()
    (volume / 'private' / 'secret.txt').write_text('private-receipt-sentinel')
    no_secrets = {key: value for key, value in env.items() if not key.endswith('_API_KEY')}
    no_secrets['TRACE_WORKER_ENABLED'] = '1'
    missing_secrets = subprocess.run(command, env=no_secrets, capture_output=True, timeout=15)
    check('Collector refuses missing secrets', missing_secrets.returncode != 0 and b'Missing Doppler secrets' in missing_secrets.stderr)
    for cycle in range(2):
        with (volume / f'run-{cycle}.log').open('w') as log:
            process = subprocess.Popen(command, env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 30
                while True:
                    if process.poll() is not None:
                        raise AssertionError('Runtime exited before readiness: ' + (volume / f'run-{cycle}.log').read_text())
                    try:
                        with urlopen(f'http://127.0.0.1:{port}/healthz', timeout=2) as response:
                            health = json.load(response)
                        break
                    except (URLError, HTTPError):
                        if time.monotonic() > deadline:
                            raise AssertionError('Readiness timeout')
                        time.sleep(.1)
                check(f'Healthy after start {cycle}', health['status'] == 'ok')
                with urlopen(f'http://127.0.0.1:{port}/') as response:
                    check(f'SSR after start {cycle}', 'trace-summary' in response.read().decode())
                with urlopen(f'http://127.0.0.1:{port}/data/latest.json') as response:
                    check(f'Persistent export after start {cycle}', json.load(response)['schema_version'] == 1)
                for path in ['/private/secret.txt', '/data/../private/secret.txt', '/data/%2e%2e/private/secret.txt', '/.env']:
                    try:
                        urlopen(f'http://127.0.0.1:{port}{path}')
                        raise AssertionError('Private path served: ' + path)
                    except HTTPError as error:
                        check(f'Private path blocked {cycle}: {path}', error.code == 404)
                (volume / 'public' / 'leak.txt').symlink_to(volume / 'private' / 'secret.txt')
                try:
                    urlopen(f'http://127.0.0.1:{port}/data/leak.txt')
                    raise AssertionError('Private symlink served')
                except HTTPError as error:
                    check(f'Private symlink blocked {cycle}', error.code == 404)
                (volume / 'public' / 'leak.txt').unlink()
                duplicate = subprocess.run(command, env=env, capture_output=True, timeout=15)
                check(f'Duplicate runtime rejected {cycle}', duplicate.returncode != 0)
            finally:
                process.send_signal(signal.SIGTERM)
                process.wait(timeout=15)
            check(f'Clean shutdown {cycle}', process.returncode == 0)
            with socket.socket() as sock:
                check(f'Child releases port {cycle}', sock.connect_ex(('127.0.0.1', port)) != 0)
    state = Store(volume / 'private')
    check('SQLite survives restarts', state.meta('migration-check') == 'retained')
    state.db.close()

out = Path('artifacts/railway')
out.mkdir(parents=True, exist_ok=True)
(out / 'verification.json').write_text(json.dumps({'passed': True, 'checks': checks}, indent=2) + '\n')
print(json.dumps({'passed': True, 'checks': len(checks)}))
