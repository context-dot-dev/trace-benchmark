"""E2E: due discovery must retain receipts without publishing the full archive.

Failure modes: paid work dispatched, a not-due source fetched, receipt loss,
archive regeneration exhausting memory, or the worker lock not respected.
Uses a real public feed and retains its SQLite state and receipts under artifacts.
"""
import json, os, subprocess, sys
from pathlib import Path
from bench.storage import Store, now
root=Path('artifacts/discovery-cli')/now().replace(':','-')
state=root/'state'; export=root/'export'; store=Store(state)
sources=json.loads(Path('config/sources.json').read_text())
for source in sources: store.meta('source_poll:'+source['source_id'],now())
source=sources[0]
store.meta('source_poll:'+source['source_id'],'2000-01-01T00:00:00+00:00')
store.db.close()
command=[sys.executable,'-m','bench.cli','discover','--due-only','--state',str(state),'--export',str(export)]
first=subprocess.run(command,text=True,capture_output=True,timeout=120)
second=subprocess.run(command,text=True,capture_output=True,timeout=120)
store=Store(state); receipts=store.meta('latest_receipts') or {}
checks={'commands_succeed':first.returncode==second.returncode==0,'one_due_source':list(receipts)==[source['source_id']],
        'no_archive_regeneration':not export.exists(),'not_due_skipped':'"action": "discover"' not in second.stdout,
        'receipt_retained':all(Path(r['raw_path']).exists() for r in receipts.values() if r.get('raw_path')),
        'no_paid_reservations':not store.usage()}
report={'passed':all(checks.values()),'checks':checks,'first':first.stdout,'second':second.stdout,'errors':first.stderr+second.stderr}
(root/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));print(root)
if not report['passed']:raise SystemExit(1)
