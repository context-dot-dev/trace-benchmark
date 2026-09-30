import asyncio,json,os,sqlite3,fcntl
from datetime import datetime,timezone
from pathlib import Path
import httpx
from bench.storage import Store,now,safe_json,digest
from bench.capacity import PROFILES,profile
from bench.cli import execute
from bench.export import publish

PARENTS=['independent-20260930T043019.215901Z','needle-2026-09-30T043718.995385Z-75441a67']
JOB='funded-rerun-20260930'
root=Path('/var/lib/trace-bench-v2')
export=Path('/opt/trace-bench/site/data/latest.json')
store=Store(root)
with (root/'worker.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    sources=[]
    for parent in PARENTS:
        row=store.db.execute('SELECT * FROM runs WHERE id=?',(parent,)).fetchone()
        assert row and row['status']=='completed'
        tasks=[json.loads(r[0]) for r in store.db.execute('SELECT data FROM tasks WHERE run_id=? ORDER BY id',(parent,))]
        assert len(tasks)==(3000 if row['cohort']=='independent' else 206)
        sources.append((parent,row['cohort'],tasks,json.loads(row['metadata'])))
    total=sum(len(s[2]) for s in sources)
    response=httpx.get('https://api.firecrawl.dev/v2/team/credit-usage',headers={'Authorization':'Bearer '+os.environ['FIRECRAWL_API_KEY']},timeout=20)
    response.raise_for_status();body=response.json();remaining=(body.get('data') or {}).get('remainingCredits')
    if body.get('success') is not True or not isinstance(remaining,(int,float)) or remaining<total:raise RuntimeError('Firecrawl funding preflight failed')
    for provider in ['context','exa','keenable']:
        if store.meta('circuit:'+provider):raise RuntimeError(provider+' has an account block')
        if not os.environ.get(provider.upper()+'_API_KEY'):raise RuntimeError(provider+' key missing')
    if not os.environ.get('TYPESAFE_API_KEY'):raise RuntimeError('Judge key missing')
    existing=store.meta('operator_job:'+JOB)
    if not existing:
        backup=root/'backups'/JOB;backup.mkdir(parents=True,exist_ok=True)
        snapshot=sqlite3.connect(backup/'state.sqlite3');store.db.backup(snapshot);snapshot.close()
        usage=store.usage()
        caps={'reader_requests':int(max(usage.get('reader_requests:'+p,0) for p in ['context','exa','firecrawl','keenable'])+total),
              'context_reservations':int(usage.get('context_credit_reservations',0)+total),
              'judge_input_reservations':int(usage.get('jev_input_token_reservations',0)+120_000_000)}
        settings={'page_concurrency':20,'host_concurrency':8,'global_interval_seconds':0.15,'host_interval_seconds':0.25,'judge_concurrency':16,'reference_judge_concurrency':8}
        existing={'at':now(),'reason':'User confirmed Firecrawl account replenished and requested benchmark continuation. Recapture every provider on both complete frozen panels; no selective retries or historical score replacement.',
                  'firecrawl_remaining_credits_at_start':remaining,'previous_circuit':store.meta('circuit:firecrawl'),'usage_before':usage,'process_only_budget_caps':caps,
                  'execution':settings,'runs':[{'id':cohort+'-'+JOB,'parent':parent,'cohort':cohort,'pages':len(tasks)} for parent,cohort,tasks,_ in sources]}
        store.meta('operator_job:'+JOB,existing)
    PROFILES['live'].update(existing['process_only_budget_caps'])
    with store.db:store.db.execute('DELETE FROM metadata WHERE key=?',('circuit:firecrawl',))
    for source,run in zip(sources,existing['runs']):
        parent,cohort,tasks,parent_metadata=source
        if not store.db.execute('SELECT 1 FROM runs WHERE id=?',(run['id'],)).fetchone():
            metadata={'seed':JOB+':'+cohort,'parent_run_id':parent,'operator_rerun':existing,'counts':{c:sum(t['category']==c for t in tasks) for c in {t['category'] for t in tasks}},'repeat_quota':0}
            if cohort=='needle':
                for key in ('queries','slots','selected_query_count','selected_slot_count','unique_urls','new_acquisition_count','reused_url_count','reused_slot_count','repeated_url_count'):metadata[key]=parent_metadata.get(key)
                metadata['new_acquisition_count']=len(tasks)
            store.create_run(run['id'],tasks,metadata,cohort=cohort)
            store.meta('execution_override:'+run['id'],existing['execution'])
            store.meta('recovery:'+run['id'],[{'at':existing['at'],'reason':existing['reason'],'parent_run_id':parent,'policy':'New full-panel capture for all providers. Old observations retained unchanged.','process_only_budget_caps':existing['process_only_budget_caps']}])
    publish(store,export)
    print(safe_json({'action':'funded_rerun_started',**existing}),flush=True)
    for run in existing['runs']:
        asyncio.run(execute(store,run['id'],export))
        status=store.db.execute('SELECT status FROM runs WHERE id=?',(run['id'],)).fetchone()[0]
        print(safe_json({'action':'rerun_status','run_id':run['id'],'status':status}),flush=True)
        if status!='completed':raise RuntimeError('Run requires review: '+status)
    store.meta('operator_job_completed:'+JOB,{'finished_at':now(),'runs':existing['runs']})
    publish(store,export)
    print(safe_json({'action':'funded_rerun_complete','at':now(),'runs':existing['runs']}),flush=True)
