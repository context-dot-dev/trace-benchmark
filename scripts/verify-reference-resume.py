"""End-to-end replay of delayed observations using saved real captures, without APIs.

Failure cases: eligible references skipped on resume; late output compared with
old content; missing timestamps treated as contemporaneous; rerun changes scores.
"""
import json,sqlite3,gzip,subprocess,tempfile,sys
from pathlib import Path
from datetime import datetime,timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from bench.storage import Store,safe_json
source=Path(sys.argv[1] if len(sys.argv)>1 else 'state/release-v2')
db=sqlite3.connect(f'file:{source}/state.sqlite3?mode=ro',uri=True);db.row_factory=sqlite3.Row
row=db.execute("SELECT r.*,t.data AS task FROM browser_references r JOIN tasks t ON t.run_id=r.run_id AND t.id=r.task_id WHERE r.status='eligible' LIMIT 1").fetchone()
ref=json.loads(gzip.decompress((source/'blobs'/row['blob'][:2]/(row['blob']+'.json.gz')).read_bytes()))
checks=[]
with tempfile.TemporaryDirectory() as directory:
 store=Store(directory);store.meta('collection_profile','live')
 task=json.loads(row['task']);store.create_run('resume-proof',[task],{})
 public={k:v for k,v in ref.items() if k not in ['dom','reference_text','screenshot_file','assessment']}
 with store.db:
  store.db.execute('INSERT INTO browser_references VALUES(?,?,?,?,?,?)',('resume-proof:'+task['id'],'resume-proof',task['id'],'eligible',safe_json(public),store.blob(ref)))
  for provider,started in [('context',ref['started_at']),('exa',(datetime.fromisoformat(ref['started_at'])+timedelta(days=1)).isoformat()),('firecrawl',None),('keenable',ref['started_at'])]:
   oid='resume-proof:'+task['id']+':'+provider
   obs={'provider':provider,'outcome':'returned','started_at':started,'text':ref['reference_text'],'text_chars':len(ref['reference_text']),'text_sha256':__import__('hashlib').sha256(ref['reference_text'].encode()).hexdigest()}
   store.db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?)',(oid,'resume-proof',task['id'],provider,'completed',safe_json({k:v for k,v in obs.items() if k!='text'}),store.blob(obs),ref['started_at']))
   store.db.execute('INSERT INTO judgments VALUES(?,?,?,?)',(oid,'completed',safe_json({'success':True,'judgment_status':'triaged'}),None))
 store.db.close()
 subprocess.run([sys.executable,'-m','bench.cli','judge','--run-id','resume-proof','--state',directory,'--export',directory+'/latest.json'],check=True)
 data=json.loads(Path(directory+'/latest.json').read_text());by={r['provider']:r for r in data['records']}
 checks=[{'check':'resumed contemporaneous output scores','passed':by['context'].get('browser_recall')==1},
         {'check':'late output remains unscored','passed':by['exa'].get('browser_recall') is None and by['exa'].get('reference_score_reason')=='capture_time_mismatch'},
         {'check':'missing time remains unscored','passed':by['firecrawl'].get('reference_score_reason')=='capture_time_mismatch'}]
 first=sqlite3.connect(directory+'/state.sqlite3').execute('select * from reference_scores order by 1').fetchall()
 subprocess.run([sys.executable,'-m','bench.cli','judge','--run-id','resume-proof','--state',directory,'--export',directory+'/latest.json'],check=True)
 second=sqlite3.connect(directory+'/state.sqlite3').execute('select * from reference_scores order by 1').fetchall()
 checks.append({'check':'repeat scoring immutable','passed':first==second})
report={'passed':all(c['passed'] for c in checks),'checks':checks}
Path('artifacts/release-verification/reference-resume.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
raise SystemExit(0 if report['passed'] else 1)
