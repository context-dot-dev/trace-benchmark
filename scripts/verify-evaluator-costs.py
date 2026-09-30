"""Exercise scoring, persistence, resumption and budgets against a local HTTP fixture.

Failure modes: unresolved or malformed answers hide billed usage; missing usage
becomes free; comparisons over-reserve shared state; resume bills twice; caps
fail open or reset between phases; underestimated receipts disappear; accounting
omits comparisons or changes the benchmark denominator.
"""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from bench.storage import Store, now, safe_json, digest
from bench.runner import judge_observations
from bench.comparison import compare_run

checks=[]; calls=[]
def check(name, value):
    checks.append({'check':name, 'passed':bool(value)})
    assert value, name

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        calls.append(body)
        target=body['state']['target']['title']
        response={'usage':{'input_tokens':100,'output_tokens':12},'answers':{}}
        for key in body['questions']:
            choice=('substantive' if key=='content' else 'match') if key in ('content','identity') else 'tie'
            if target=='uncertain':choice='unclear' if key=='content' else 'unknown'
            response['answers'][key]={'choice':choice,'confidence':.95}
        if target=='malformed':response['answers']={}
        if target=='missing':response.pop('usage')
        encoded=json.dumps(response).encode()
        self.send_response(503 if target=="http-error" else 200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(encoded)

server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
RealClient=httpx.AsyncClient
class LocalClient(RealClient):
    async def post(self, url, **kwargs):
        assert url=='https://api.typesafe.ai/v1/systemone'
        return await super().post(f'http://127.0.0.1:{server.server_port}/',**kwargs)

async def no_publish(*args):pass

def add_run(store, rid, titles, providers=('context',)):
    tasks=[dict(id=str(i),url=f'https://example.org/{rid}/{i}',title=title,category='news',source_id='fixture') for i,title in enumerate(titles)]
    store.create_run(rid,tasks,{})
    meta=json.loads(store.db.execute('SELECT metadata FROM runs WHERE id=?',(rid,)).fetchone()[0])
    meta['provider_ids']=list(providers)
    with store.db:
        store.db.execute('UPDATE runs SET metadata=? WHERE id=?',(safe_json(meta),rid))
        for task in tasks:
            for provider in providers:
                oid=f'{rid}:{task["id"]}:{provider}'
                text='' if task['title']=='empty' else f'{provider} Main content about {task["title"]}.'
                obs=dict(text=text,text_sha256=digest(text),text_chars=len(text),outcome='returned',started_at=now(),freshness={'requested':True,'evidence':'fresh_reported'})
                store.db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?)',(oid,rid,task['id'],provider,'completed',safe_json(obs),store.blob(obs),now()))
    return tasks

async def main():
    with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{'TYPESAFE_API_KEY':'local-fixture-only','TRACE_JEV_DAILY_BUDGET_USD':'5'}), patch('httpx.AsyncClient',LocalClient), patch('bench.runner.publish_progress_async',no_publish):
        store=Store(tmp);store.meta('collection_profile','live')
        add_run(store,'triage',['uncertain','malformed','missing','empty','http-error'])
        await judge_observations(store,'triage',None,{'judge_concurrency':4})
        settlements={r['reservation_id']:r['amount'] for r in store.db.execute('SELECT * FROM budget_settlements')}
        check('Uncertain answers settle reported usage',settlements.get('triage:0:context')==100)
        check('Malformed answers retain and settle billed usage',settlements.get('triage:1:context')==100)
        check('Missing usage keeps its reservation', 'triage:2:context' not in settlements and store.usage()['jev_input_token_reservations']>200)
        check('Error responses retain reported charges',settlements.get('triage:4:context')==100)
        check('Empty results require no model call',len(calls)==4)
        before=len(calls)
        await judge_observations(store,'triage',None,{'judge_concurrency':4})
        check('Resume does not repeat charged or uncertain work',len(calls)==before)
        tasks=add_run(store,'comparison',['normal'],('context','exa','firecrawl','keenable'))
        await judge_observations(store,'comparison',None,{'judge_concurrency':4})
        await compare_run(store,'comparison')
        check('Six pairwise questions use one HTTP call',len(calls)==before+5 and len(calls[-1]['questions'])==6)
        reserved=store.db.execute('SELECT amount FROM budget WHERE reservation_id=?',('output_comparison:comparison:0',)).fetchone()[0]
        check('Shared comparison state reserved once',reserved==len(safe_json(calls[-1]).encode())+2048)
        await compare_run(store,'comparison')
        check('Comparison resume is free',len(calls)==before+5)
        from bench.costs import cost_report, daily_token_cap, reconcile
        with store.db:store.db.execute('DELETE FROM budget_settlements WHERE reservation_id="output_comparison:comparison:0"')
        recovered=reconcile(store)
        check('Saved receipts repair interrupted accounting without HTTP',recovered['settled']==1 and len(calls)==before+5)
        check('Receipt reconciliation is idempotent',reconcile(store)['settled']==0)
        report=cost_report(store)
        today=report['days'][0]
        check('Cost report combines grading and comparison receipts',today['reported_input_tokens']==800 and today['unsettled_jobs']==1)
        check('USD uses input tokens only',abs(today['reported_cost_usd']-800*.042/1_000_000)<1e-12)
        check('Outstanding budget is separate from known cost',today['held_cost_usd']>0 and today['accounted_cost_usd']>today['reported_cost_usd'])
        with patch.dict(os.environ,{'TRACE_JEV_DAILY_BUDGET_USD':'0'}):
            add_run(store,'zero',['normal'])
            await judge_observations(store,'zero',None,{'judge_concurrency':4})
            check('Zero dollar cap stops dispatch before HTTP',len(calls)==before+5)
            check('Budget deferral keeps the selected page',store.db.execute('SELECT COUNT(*) FROM tasks WHERE run_id="zero"').fetchone()[0]==1 and not store.db.execute('SELECT 1 FROM judgments WHERE observation_id="zero:0:context"').fetchone())
        for bad in ('NaN','Infinity','-1','invalid'):
            with patch.dict(os.environ,{'TRACE_JEV_DAILY_BUDGET_USD':bad}):
                try: daily_token_cap(); valid=False
                except ValueError: valid=True
                check('Invalid dollar cap fails closed: '+bad, valid)
        check('Five dollars converts to a conservative whole-token ceiling',daily_token_cap()==119047619)
        # Real SQLite connections exercise the shared gate and settlement overrun.
        other=Store(Path(tmp)/'overrun')
        with patch.dict(os.environ,{'TRACE_JEV_DAILY_BUDGET_USD':'0.0000042'}):
            check('First phase reserves shared budget',other.reserve('jev_input_token_reservations','grade',80,1000))
            check('Second phase cannot exceed shared cap',not other.reserve('jev_input_token_reservations','output_comparison:run:task',21,1000))
            other.settle('jev_input_token_reservations','grade',120)
            check('Actual usage above estimate is retained',other.usage()['jev_input_token_reservations']==120)
            check('Overrun blocks later dispatch',not other.reserve('jev_input_token_reservations','next',1,1000))
            check('Overrun is visible',cost_report(other)['days'][0]['overrun_jobs']==1)
            check('Identical settlement is idempotent',other.settle('jev_input_token_reservations','grade',120) is False)
        check('All observations remain in their original slots',store.db.execute('SELECT COUNT(*) FROM observations').fetchone()[0]==10)
        store.db.close();other.db.close()

out=Path('artifacts/costs/verification.json');out.parent.mkdir(parents=True,exist_ok=True)
try:
    asyncio.run(main())
finally:
    server.shutdown()
    report={'passed':bool(checks) and all(c['passed'] for c in checks),'checks':checks,'http_calls':len(calls),'paid_api_calls':0}
    out.write_text(json.dumps(report,indent=2));print(json.dumps(report))
