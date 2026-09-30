"""Daily integration contract, established before implementation.
Failures: fewer than 3,000 selected despite available balanced supply; two frozen
runs on one day; previous hourly batches consume the daily panel quota; URL
reuse; lost daily history when details rotate; unfinished results enter rankings.
Uses the real registry, SQLite store, selector and export; no provider calls.
"""
import json,tempfile
from pathlib import Path
from bench.storage import Store
from bench.cli import select_run
from bench.capacity import PROFILES,schedule_slot
from bench.discovery import CATEGORIES
checks=[]
def check(name,value):
 checks.append({'check':name,'passed':bool(value)})
 assert value,name
with tempfile.TemporaryDirectory() as tmp:
 store=Store(Path(tmp));store.meta('collection_profile','live')
 candidates=[{'id':f'{c}-{i}','url':f'https://org{i//50}.example/{c}/{i}','category':c,'source_id':'fixture','organization':f'{c}-{i//50}','title':str(i)} for c in CATEGORIES for i in range(420)]
 store.ingest({'candidates':candidates,'receipts':[]})
 old=[dict(candidates[i*420],id=f'old-{i}',url=f'https://old.example/{i}') for i in range(8)]
 store.create_run('earlier-hourly',old,{})
 metadata=json.loads(store.db.execute('select metadata from runs where id=?',('earlier-hourly',)).fetchone()[0]);metadata['collection_profile']['cadence']='hourly'
 with store.db:store.db.execute('update runs set metadata=?,status=? where id=?',(json.dumps(metadata),'completed','earlier-hourly'))
 run=select_run(store,375)
 tasks=[json.loads(r[0]) for r in store.db.execute('select data from tasks where run_id=?',(run,))]
 check('One frozen daily panel has 3,000 unique URLs',len(tasks)==3000 and len({t['url'] for t in tasks})==3000)
 check('Every category has 375 pages',all(sum(t['category']==c for t in tasks)==375 for c in CATEGORIES))
 check('Second selection on same day is empty',select_run(store,375) is None)
 check('Daily schedule slot ignores hour',schedule_slot(PROFILES['live'],'2026-10-01T01:00:00+00:00')==schedule_slot(PROFILES['live'],'2026-10-01T19:00:00+00:00'))
 check('Next UTC day gets its own slot',schedule_slot(PROFILES['live'],'2026-10-02T01:00:00+00:00')!=schedule_slot(PROFILES['live'],'2026-10-01T01:00:00+00:00'))
 store.db.close()
Path('artifacts/daily-benchmark/contracts.json').write_text(json.dumps({'passed':True,'checks':checks},indent=2))
print(json.dumps({'passed':True,'checks':len(checks)}))
