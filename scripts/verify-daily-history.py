"""Isolated database-to-export integration: daily history survives rotating details,
unfinished runs never enter history, and older small batches cannot dilute a daily
panel. Synthetic receipts stay in artifacts/daily-benchmark/fixture-site only.
"""
import json,tempfile,shutil
from datetime import datetime,timezone,timedelta
from pathlib import Path
from bench.storage import Store,safe_json
from bench.export import make_export
checks=[]
def check(name,value):
 checks.append({'check':name,'passed':bool(value)});assert value,name
with tempfile.TemporaryDirectory() as tmp:
 store=Store(Path(tmp));store.meta('collection_profile','live')
 first_day=datetime.now(timezone.utc).date()-timedelta(days=15)
 for day in range(1,17):
  rid=f'fixture-daily-{day}';date=(first_day+timedelta(days=min(day,15)-1)).isoformat()+'T00:15:00+00:00'
  tasks=[dict(id=str(i),url=f'https://example.org/{day}/{i}',title='Synthetic verification fixture',category='news',source_id='fixture',organization='fixture') for i in range(3)]
  store.create_run(rid,tasks,{})
  if day==16:
   metadata=json.loads(store.db.execute('select metadata from runs where id=?',(rid,)).fetchone()[0]);metadata['collection_profile']['cadence']='hourly'
   with store.db:store.db.execute('update runs set metadata=? where id=?',(safe_json(metadata),rid))
  with store.db:
   store.db.execute('update runs set started_at=?,finished_at=?,status=? where id=?',(date,date,'completed',rid))
   for task in tasks:
    for provider in ['context','exa','firecrawl','keenable']:
     oid=rid+':'+task['id']+':'+provider
     obs={'started_at':date,'outcome':'returned','text_chars':100,'elapsed_ms':100,'freshness':{'requested':True,'evidence':'unreported'}}
     judgment={'success':(int(task['id'])+['context','exa','firecrawl','keenable'].index(provider))%4<(1+day%3),'judgment_status':'triaged','version':'identity-content-jev-v2'}
     store.db.execute('insert into observations values(?,?,?,?,?,?,?,?)',(oid,rid,task['id'],provider,'completed',safe_json(obs),None,date))
     store.db.execute('insert into judgments values(?,?,?,?)',(oid,'completed',safe_json(judgment),None))
  data=make_export(store)
 check('Detail archive is bounded',len(data['runs'])==12)
 check('15 days remain after old detail runs rotate out',len({r['day'] for r in data['metrics']['daily']})==15)
 check('Oldest daily point retained',data['metrics']['daily'][0]['day']==first_day.isoformat())
 check('Every daily provider denominator is exact',all(r['pages']==3 for r in data['metrics']['daily']))
 check('Detailed results contain only the latest completed daily panel',len(data['records'])==12)
 check('Pilot batches do not dilute daily panels',all(r['sample_kind']=='daily' for r in data['metrics']['daily']))
 store.create_run('fixture-pending',[dict(id='pending',url='https://example.org/pending',category='news',title='Synthetic pending fixture',source_id='fixture')],{})
 data=make_export(store)
 check('Unfinished daily panel stays out of history',len({r['day'] for r in data['metrics']['daily']})==15)
 store.db.close()
 root=Path('artifacts/daily-benchmark/fixture-site');(root/'data').mkdir(parents=True,exist_ok=True)
 (root/'data/latest.json').write_text(json.dumps(data))
 (root/'index.html').write_text(Path('site/index.html').read_text().replace('TRACE · Live reader benchmark','TRACE · Synthetic verification fixture'))
 for name in ['assets','logos','fonts']:
  if (root/name).is_symlink():(root/name).unlink()
  shutil.copytree(Path('site')/name,root/name,dirs_exist_ok=True)
Path('artifacts/daily-benchmark/history-contracts.json').write_text(json.dumps({'passed':True,'checks':checks},indent=2))
print(json.dumps({'passed':True,'checks':len(checks)}))
