"""Offline acquisition E2E: both roles must reach all four adapters, controls must
fetch again on later runs, resume must not duplicate calls, and every request must
set fresh retrieval. Provider transport uses fixtures; no external calls or keys.
PYTHONPATH=. python3 scripts/verify-daily-acquisition.py
"""
import asyncio
import json
import os
import tempfile
from pathlib import Path
import httpx
from bench.storage import Store
from bench.runner import Runner
from bench.providers import KEYS

async def main():
    calls=[]
    async def respond(request):
        calls.append(str(request.url))
        return httpx.Response(503,json={'error':'fixture unavailable'})
    for key in KEYS.values():os.environ[key]='fixture-credential'
    with tempfile.TemporaryDirectory() as tmp:
        store=Store(Path(tmp));store.meta('collection_profile','live')
        tasks=[dict(id=role,url='https://example.org/'+role,category='news',source_id='fixture',organization='fixture',sample_role=role) for role in ('new','control')]
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            runner=Runner(store,Path(tmp)/'data/latest.json')
            providers=('context','exa','firecrawl','keenable')
            runner.reader_clients={p:client for p in providers}
            for run in ('day-one','day-two'):
                store.create_run(run,tasks,{})
                for task in tasks:
                    for provider in providers:await runner.acquire(run,task,provider)
            assert len(calls)==16,'Every provider must freshly fetch both roles in each run'
            for task in tasks:
                for provider in providers:await runner.acquire('day-two',task,provider)
            assert len(calls)==16,'Resume must not re-dispatch completed attempts'
            receipts=[json.loads(r[0]) for r in store.db.execute('SELECT data FROM observations')]
            assert all(r['freshness']['requested'] for r in receipts),'Fresh-fetch parameters must survive real adapters'
            report={'passed':True,'requests':len(calls),'provider_counts':{p:sum(r['provider']==p for r in receipts) for p in providers},'fresh_requests':sum(r['freshness']['requested'] for r in receipts),'paid_calls':0}
            Path('artifacts/daily-controls').mkdir(parents=True,exist_ok=True)
            Path('artifacts/daily-controls/acquisition-verification.json').write_text(json.dumps(report,indent=2))
            print(json.dumps(report))
asyncio.run(main())
