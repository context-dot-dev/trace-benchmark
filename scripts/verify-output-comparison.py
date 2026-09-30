"""Failure contract written before implementation. Fresh outputs only; known cache
hits, clock skew, incomplete providers and ambiguous content cannot manufacture
winners. Exact ties need no judge. Multiple tied winners, cycles, all failures,
a sole useful output, malformed/low-confidence judgments, budget exhaustion and
resume must preserve uncertainty and immutable receipts. Browser-free Runner must
never launch Chromium. This integration runs Store/Runner/export with API fixtures.
"""
import asyncio,json,tempfile
from pathlib import Path
from unittest.mock import patch,AsyncMock
from datetime import datetime,timedelta,timezone
from bench.storage import Store,now,digest,safe_json
from bench.runner import Runner,judge_run
from bench.comparison import compare_run,VERSION
checks=[]
def check(name,ok):
 checks.append({'check':name,'passed':bool(ok)});assert ok,name
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  store=Store(tmp,database_url='');store.meta('collection_profile','live')
  names=['same','one','none','best','tie','cycle','unclear','cached','skew','missing','low','malformed']
  tasks=[dict(id=n,url='https://example.com/'+n,category='news',source_id='fixture',organization='fixture') for n in names]
  store.create_run('comparison',tasks,{})
  meta=json.loads(store.db.execute('select metadata from runs').fetchone()[0]);meta['browser_reference']=False;meta['benchmark_config']['browser_reference']=False;meta['benchmark_config']['output_comparison']=VERSION
  with store.db:store.db.execute('update runs set metadata=?',(safe_json(meta),))
  providers=['context','exa','firecrawl','keenable'];stamp=now()
  for task in tasks:
   for i,p in enumerate(providers):
    name=task['id'];oid='comparison:'+name+':'+p
    text=' '.join(['original article content']*20)+(' '+str(i) if name!='same' else '')
    outcome='returned';success=True
    if name=='none' or (name=='one' and i):outcome='provider_error';success=False;text=''
    if name=='unclear' and i==3:success=None
    if name=='missing' and i==3:outcome='harness_error';success=None;text=''
    obs=dict(provider=p,url=task['url'],started_at=(datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat() if name=='skew' and i==3 else stamp,outcome=outcome,text=text,text_sha256=digest(text),text_chars=len(text),freshness={'requested':True,'evidence':'cached_reported' if name=='cached' and i==3 else 'unreported'})
    with store.db:
     store.db.execute('insert into observations values(?,?,?,?,?,?,?,?)',(oid,'comparison',name,p,'completed',safe_json(obs),store.blob(obs),stamp))
     store.db.execute('insert into judgments values(?,?,?,?)',(oid,'completed',safe_json({'success':success,'judgment_status':'triaged'}),None))
  calls=[]
  async def request(payload,client):
   calls.append(payload);name=payload['state']['target']['url'].rsplit('/',1)[1]
   labels=list(payload['state']['outputs']);answers={}
   for key in payload['questions']:
    a,b=key.split('_');i,j=labels.index(a),labels.index(b)
    choice='left'
    if name=='tie' and i==0 and j==1:choice='tie'
    if name=='cycle' and i==0 and j==2:choice='right'
    answers[key]={'choice':choice,'confidence':.2 if name=='low' else .99}
   return {'answers':{} if name=='malformed' else answers,'usage':{'input_tokens':100}}
  with patch('bench.comparison.request_comparison',request):
   await compare_run(store,'comparison')
   result={n:store.meta('output_comparison:comparison:'+n) for n in names}
   check('Exact duplicate outputs tie without a model call',result['same']['status']=='resolved' and len(result['same']['winners'])==4 and len(calls)==5)
   check('One useful output is explicit',result['one']['status']=='single_source' and result['one']['winners']==['context'])
   check('All providers fail without claiming impossibility',result['none']['status']=='no_useful_output' and not result['none']['winners'])
   check('Best output selected without provider names',len(result['best']['winners'])==1 and all('context' not in json.dumps(p['state']) for p in calls))
   check('Multiple strongest outputs can tie',len(result['tie']['winners'])==2)
   for n in ('cycle','low','malformed'):check(n+' remains unresolved',result[n]['status']=='unresolved' and not result[n]['winners'])
   for n in ('cached','skew','missing','unclear'):check(n+' blocks a complete comparison',result[n]['status']=='incomplete' and not result[n]['winners'])
   before=len(calls);await compare_run(store,'comparison');check('Resume cannot repeat billed comparisons',len(calls)==before)
   check('Raw model receipt retained',bool(result['best']['receipt_sha256']) and store.load_blob(result['best']['receipt_sha256'])['response']['answers'])
  # Exercise browser-free acquisition through the actual Runner and export.
  task=dict(id='api-only',url='https://example.com/api-only',category='news',source_id='fixture',organization='fixture')
  store.create_run('api-only',[task],{})
  frozen=store.db.execute("select metadata from runs where id='api-only'").fetchone()[0]
  legacy=json.loads(frozen);legacy['browser_reference']=True;legacy['benchmark_config']['browser_reference']=True
  with store.db:store.db.execute("update runs set metadata=? where id='api-only'",(safe_json(legacy),))
  original=store.db.execute("select metadata from runs where id='api-only'").fetchone()[0]
  store.meta('analysis_override:api-only',{'browser_reference':False,'pipeline_scoring':True,'output_comparison':VERSION,'reason':'fixture migration'})
  async def fetch(provider,url,config):return dict(provider=provider,url=url,outcome='provider_error',text='',text_sha256=digest(''),started_at=now(),freshness={'requested':True,'evidence':'unreported'})
  browser=AsyncMock(side_effect=AssertionError('Chromium must not start'))
  with patch('bench.runner.public_url',AsyncMock(return_value=True)),patch('bench.runner.fetch_reader',fetch),patch('bench.references.BrowserReferences.start',browser):
   await Runner(store,Path(tmp)/'latest.json').run('api-only');await judge_run(store,'api-only',Path(tmp)/'latest.json')
   check('API-only run completes without Chromium',not browser.called and store.db.execute("select status from runs where id='api-only'").fetchone()[0]=='completed')
  check('Runtime migration preserves frozen manifest',store.db.execute("select metadata from runs where id='api-only'").fetchone()[0]==original)
  data=json.loads((Path(tmp)/'latest.json').read_text());records=[r for r in data['records'] if r['run_id']=='api-only']
  check('Public export carries unresolved comparison',len(records)==4 and all(r['output_comparison']['status']=='no_useful_output' for r in records))
  store.db.close()
asyncio.run(main())
report={'passed':True,'checks':checks};Path('artifacts/output-comparison/contracts.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
