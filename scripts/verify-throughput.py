"""Collector integration failure contract (written before the change):
concurrency stays at three; one host blocks others; limits are exceeded; completed
requests are replayed; shared denominators change; parallel judging drops rows;
progress export blocks requests; interrupted references become eligible evidence.
Runs the real store/runner/export against delayed local HTTP fixtures. No API calls.
"""
import asyncio,json,tempfile,time,threading
from pathlib import Path
from unittest.mock import patch,AsyncMock
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import httpx
from bench.storage import Store,now,digest,safe_json
from bench.runner import Runner,judge_run
from bench.execution import settings
counts={'reader':0,'judge':0,'max_reader':0,'max_judge':0,'calls':0};lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  kind='judge' if self.path.startswith('/judge') else 'reader'
  with lock:
   counts[kind]+=1;counts['max_'+kind]=max(counts['max_'+kind],counts[kind]);counts['calls']+=1
  time.sleep(.08)
  with lock:counts[kind]-=1
  self.send_response(200);self.end_headers();self.wfile.write(b'{}')
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.request_queue_size=128
threading.Thread(target=server.serve_forever,daemon=True).start()
checks=[]
def check(name,value):
 checks.append({'check':name,'passed':bool(value)});assert value,name
async def main():
 async with httpx.AsyncClient(timeout=10,limits=httpx.Limits(max_connections=100)) as client:
  async def fetch(provider,url,config):
   await client.get(f'http://127.0.0.1:{server.server_port}/reader')
   text=' '.join('word'+str(i) for i in range(100))
   return dict(provider=provider,url=url,outcome='returned',started_at=now(),elapsed_ms=80,text=text,text_sha256=digest(text),raw={})
  async def judge(task,obs,**kwargs):
   await client.get(f'http://127.0.0.1:{server.server_port}/judge')
   return dict(success=True,judgment_status='triaged',content_label='substantive',identity_label='match',usage={'input_tokens':1},version='identity-content-jev-v2')
  class References:
   def __init__(self,store):self.store=store;self.error=None
   async def start(self):return self
   async def close(self):pass
   async def capture(self,rid,t):
    key=rid+':'+t['id']
    if self.store.db.execute('select 1 from browser_references where id=?',(key,)).fetchone():return
    await asyncio.sleep(.1)
    if t['id']=='0':raise RuntimeError('Injected browser cleanup failure')
    rec={'started_at':now(),'reference_text':' '.join('word'+str(i) for i in range(100)),'status':'candidate'}
    with self.store.db:self.store.db.execute('insert into browser_references values(?,?,?,?,?,?)',(key,rid,t['id'],'candidate',safe_json(rec),self.store.blob(rec)))
  with tempfile.TemporaryDirectory() as tmp:
   store=Store(Path(tmp)/'state');store.meta('collection_profile','live')
   tasks=[dict(id=str(i),url=f'https://host{i%30}.example/{i}',category='news',source_id='fixture',organization='fixture',title='Fixture') for i in range(60)]
   store.create_run('throughput',tasks,{})
   metadata=json.loads(store.db.execute('select metadata from runs').fetchone()[0]);metadata['benchmark_config']['execution'].update(global_interval_seconds=.001,host_interval_seconds=.005)
   with store.db:store.db.execute('update runs set metadata=?',(safe_json(metadata),))
   config=settings(store,'throughput');check('Parallel configuration is bounded',config['page_concurrency']==12 and config['host_concurrency']==2)
   with patch('bench.runner.public_url',AsyncMock(return_value=True)),patch('bench.runner.fetch_reader',fetch),patch('bench.references.BrowserReferences',References),patch('bench.runner.judge',judge),patch('bench.references.judge',judge,create=True):
    start=time.monotonic();await Runner(store,Path(tmp)/'latest.json').run('throughput');elapsed=time.monotonic()-start
    check('Acquisition really overlaps more than three pages',counts['max_reader']>12)
    check('Reader concurrency stays bounded',counts['max_reader']<=48)
    check('Every provider sees every URL once',counts['calls']==240)
    before=counts['calls'];await Runner(store,Path(tmp)/'latest.json').run('throughput')
    check('Resume never repeats completed requests',counts['calls']==before)
    with patch('bench.judging.judge',judge):await judge_run(store,'throughput',Path(tmp)/'latest.json')
    check('Judging is parallel and bounded',2<counts['max_judge']<=16)
    check('All judgments complete',store.db.execute("select count(*) from judgments where status='completed'").fetchone()[0]==240)
    check('Available reference assessments complete',store.db.execute("select count(*) from browser_references where status='eligible'").fetchone()[0]==59)
    check('Browser failure is recorded without aborting readers',store.db.execute("select status from browser_references where task_id='0'").fetchone()[0]=='unavailable')
    check('The run completes without changing its denominator',store.db.execute('select status from runs').fetchone()[0]=='completed' and len(json.loads(Path(tmp+'/latest.json').read_text())['records'])==240)
    check('Execution conditions are retained',bool(store.meta('execution:throughput')))
   store.db.close()
 return elapsed
try:
 elapsed=asyncio.run(main());report={'passed':True,'checks':checks,'fixture_acquisition_seconds':elapsed,'http':counts};Path('artifacts/throughput/contracts.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
finally:server.shutdown()
