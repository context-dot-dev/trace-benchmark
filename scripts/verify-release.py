"""Replay the published benchmark against private receipts; no network or paid calls."""
import argparse
import hashlib
import json
import sqlite3
import gzip
import os
import sys
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--state',type=Path,required=True)
p.add_argument('--export',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
p.add_argument('--sqlite',action='store_true',help='Audit the retained SQLite copy instead of the configured database')
a=p.parse_args()
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1]/'.env')
if not a.sqlite and (os.environ.get('DATABASE_URL_UNPOOLED') or os.environ.get('DATABASE_URL')):
 from bench.storage import Store
 db=Store(a.state).db
else:
 db=sqlite3.connect(f'file:{a.state / "state.sqlite3"}?mode=ro',uri=True)
 db.row_factory=sqlite3.Row
saved_runs={r['id']:r for r in db.execute('SELECT * FROM runs')}
saved_observations={r['id']:r for r in db.execute('SELECT * FROM observations')}
data=json.loads(a.export.read_text())
checks=[]
def check(name,condition):
 checks.append({'check':name,'passed':bool(condition)})
def blob(key):
 return json.loads(gzip.decompress((a.state/'blobs'/key[:2]/(key+'.json.gz')).read_bytes()))
check('Release protocol', data['protocol_version']=='trace-live-v3')
completed={r['id'] for r in data['runs'] if r['status']=='completed'}
check('Measured observations exist',len(data['records'])>0)
check('Explicit unknown outcomes', all(r['success'] in (True,False,None) for r in data['records']))
check('No duplicate run/page/provider slots',len({(r['run_id'],r['task_id'],r['provider']) for r in data['records']})==len(data['records']))
for run in data['runs']:
 saved=saved_runs.get(run['id'])
 meta=json.loads(saved['metadata'])
 records=[r for r in data['records'] if r['run_id']==run['id']]
 if meta['protocol_version']!=data['protocol_version']:continue
 if run.get('detail_available',True):
  check(run['id']+': frozen provider set',set(r['provider'] for r in records)==set(meta['provider_ids']))
  check(run['id']+': full denominator',len(records)==run['selected_count']*len(meta['provider_ids']))
 else:check(run['id']+': archived details omitted together',not records and run['status']=='completed')
 manifest=json.loads((a.export.parent/'runs'/(run['id']+'.json')).read_text())
 check(run['id']+': downloadable manifest',len(manifest['tasks'])==run['selected_count'] and bool(manifest['selection_sha256']))
 check(run['id']+': public manifest hash',hashlib.sha256(json.dumps(manifest['tasks'],ensure_ascii=False,sort_keys=True).encode()).hexdigest()==manifest['public_tasks_sha256'])
for record in data['records']:
 row=saved_observations.get(record['id'])
 if not row or not row['blob']:continue
 raw=blob(row['blob'])
 if record['protocol_version']=='trace-live-v3' and raw.get('request_config'):
  from bench.freshness import audit
  audited=audit(record['provider'],raw['request_config'],raw.get('cache',{}))
  check(record['id']+': fresh retrieval requested',audited['requested'])
  check(record['id']+': freshness evidence replays',record['freshness']==audited)
 check(record['id']+': output hash',hashlib.sha256(raw['text'].encode()).hexdigest()==record['text_sha256'])
 check(record['id']+': recorded duration',record['elapsed_ms']==raw.get('elapsed_ms'))
 ref=record.get('reference') or {}
 check(record['id']+': failed references unscored',ref.get('status')=='eligible' or record.get('browser_recall') is None)
 check(record['id']+': coverage range',record.get('browser_recall') is None or 0<=record['browser_recall']<=1)
for cohort,providers in data.get('metrics',{}).get('cohorts',{}).items():
 for provider,metrics in providers.items():
  rows=[r for r in data['records'] if r['cohort']==cohort and r['provider']==provider and r['protocol_version']==data['protocol_version'] and not r.get('run_exclusion') and r['run_id'] in completed]
  check(cohort+':'+provider+': ranked denominator excludes invalidated batches',metrics['pages']==len(rows))
  check(cohort+':'+provider+': useful count replays',metrics['success']==sum(r['success'] is True for r in rows))
  check(cohort+':'+provider+': unresolved count replays',metrics['unknown']==sum(r['success'] is None for r in rows))
check('No private receipts in public artifact',not any(x in a.export.read_text() for x in ['Bearer ','ctxt_secret_','TYPESAFE_API_KEY','"reference_text":']))
report={'artifact_sha256':hashlib.sha256(a.export.read_bytes()).hexdigest(),'checks':checks,'passed':all(x['passed'] for x in checks),'count':len(checks)}
a.out.parent.mkdir(parents=True,exist_ok=True)
a.out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':report['passed'],'checks':len(checks),'report':str(a.out)}))
raise SystemExit(0 if report['passed'] else 1)
