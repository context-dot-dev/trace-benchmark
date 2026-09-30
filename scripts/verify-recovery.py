"""Store-to-collector integration failure cases, established before recovery code:
resend an unaffected URL; choose a provider's best attempt; erase old receipts or
billing; recover without a reason; leave partial denominators; recover twice.
"""
import json,tempfile
from pathlib import Path
from bench.storage import Store,now,safe_json
from bench.recovery import recover
with tempfile.TemporaryDirectory() as tmp:
 s=Store(Path(tmp));s.meta('collection_profile','live')
 s.create_run('broken',[dict(id=i,url='https://example.org/'+i,category='news',source_id='fixture') for i in ['whole','partial']],{})
 for task in ['whole','partial']:
  for provider in ['context','exa','firecrawl','keenable']:
   oid='broken:'+task+':'+provider;complete=task=='whole' or provider=='exa';data=safe_json({'text':'prior'}) if complete else None;blob=s.blob({'private':'prior'}) if complete else None
   with s.db:s.db.execute('insert into observations values(?,?,?,?,?,?,?,?)',(oid,'broken',task,provider,'completed' if complete else 'dispatched',data,blob,now()))
   s.reserve('reader_requests:'+provider,oid,1,100)
 before=s.usage();whole=[dict(r) for r in s.db.execute("select * from observations where task_id='whole'")]
 result=recover(s,'broken','Integration fixture: worker stopped after browser failure')
 checks={'only_interrupted_task':result['task_ids']==['partial'],'whole_provider_group_replaced':s.db.execute("select count(*) from observations where task_id='partial'").fetchone()[0]==0,'unaffected_unchanged':whole==[dict(r) for r in s.db.execute("select * from observations where task_id='whole'")],'old_budget_retained':s.usage()==before,'raw_receipts_retained':len(s.load_blob(result['archive_sha256'])['observations'])==4,'new_attempt_number':s.meta('acquisition_attempt:broken:partial')==2,'second_recovery_empty':recover(s,'broken','Already recovered')['task_ids']==[]}
 assert all(checks.values()),checks
 s.db.close()
Path('artifacts/throughput/recovery-contracts.json').write_text(json.dumps({'passed':True,'checks':checks},indent=2));print(checks)
