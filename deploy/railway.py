"""Supervise the dashboard and daily collector on one persistent Railway volume."""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
stop = threading.Event()
for signum in (signal.SIGTERM, signal.SIGINT):
    signal.signal(signum, lambda *_: stop.set())


def terminate(process):
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main():
    os.chdir(ROOT)
    os.umask(0o077)
    volume = Path(os.environ.get('TRACE_VOLUME_PATH', '/data')).resolve()
    state, public = volume / 'private', volume / 'public'
    if not (state / 'state.sqlite3').is_file():
        raise RuntimeError('Import the existing SQLite database and receipts into the volume private directory first')
    state.mkdir(exist_ok=True, mode=0o700)
    with (state / 'runtime.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        enabled = os.environ.get('TRACE_WORKER_ENABLED', '0') == '1'
        if enabled:
            missing = [key for key in ('CONTEXT_API_KEY', 'EXA_API_KEY', 'FIRECRAWL_API_KEY', 'KEENABLE_API_KEY', 'TYPESAFE_API_KEY') if not os.environ.get(key)]
            if missing:
                raise RuntimeError('Missing Doppler secrets: ' + ', '.join(missing))
        public.mkdir(exist_ok=True)
        env = {**os.environ, 'TRACE_STATE': str(state), 'TRACE_DATA_DIR': str(public),
               'TRACE_DASHBOARD_BACKEND': 'artifact', 'TRACE_COLLECTOR': 'railway',
               'HOST': '0.0.0.0'}
        cli = [sys.executable, '-m', 'bench.cli']
        exported = subprocess.Popen([*cli, 'export', '--export', str(public / 'latest.json')], env=env)
        while exported.poll() is None and not stop.wait(.2):
            pass
        if stop.is_set():
            terminate(exported)
            return
        if exported.returncode:
            raise RuntimeError('Initial publication failed')
        dashboard = subprocess.Popen(['node', '--import', 'tsx', 'server/index.ts'], env=env)
        worker = None
        marker = state / 'railway-last-slot'
        last_slot = marker.read_text().strip() if marker.exists() else ''
        try:
            while not stop.wait(1):
                if dashboard.poll() is not None:
                    raise RuntimeError('Dashboard exited')
                now = datetime.now(timezone.utc)
                scheduled = now.replace(hour=0, minute=15, second=0, microsecond=0)
                if now < scheduled:
                    scheduled -= timedelta(days=1)
                slot = scheduled.date().isoformat()
                if worker:
                    if worker.poll() is not None:
                        print(json.dumps({'collector_exit': worker.returncode, 'slot': last_slot}), flush=True)
                        worker = None
                    elif time.monotonic() - started >= 18 * 60 * 60:
                        terminate(worker)
                        print(json.dumps({'collector_timeout': True, 'slot': last_slot}), flush=True)
                        worker = None
                if enabled and worker is None and last_slot != slot:
                    temporary = marker.with_suffix('.tmp')
                    temporary.write_text(slot)
                    temporary.replace(marker)
                    last_slot = slot
                    worker = subprocess.Popen([*cli, 'tick', '--export', str(public / 'latest.json')], env=env)
                    started = time.monotonic()
                    print(json.dumps({'collector_started': True, 'slot': slot}), flush=True)
        finally:
            terminate(worker)
            terminate(dashboard)


if __name__ == '__main__':
    main()
