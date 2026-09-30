"""Allowlisted public data export. Raw API bodies, credentials and gold stay private."""
import json
import time
from pathlib import Path
from urllib.parse import urlsplit
from datetime import datetime,timezone,timedelta
from .storage import atomic_json,now,digest,safe_json

CATEGORIES=[{'id':i,'label':l} for i,l in [('news','News'),('commerce','Commerce'),('jobs','Jobs'),('finance_filings','Finance'),('research','Research'),('legal_regulatory','Legal & government'),('software_docs','Software & docs'),('community_social','Community')]]
PROVIDERS=[{'id':'context','name':'Context','color':'#4266db','capability':'Fresh native Markdown','config':{'maxAgeMs':0,'timeout_seconds':27}}, {'id':'hetzner','name':'Hetzner','color':'#7c8796','capability':'Datacenter requests + conversion, no JS/proxy','config':{'version':'v3','wall_seconds':30}}, {'id':'exa','name':'Exa','color':'#219386','capability':'Live Contents text','config':{'maxAgeHours':0,'livecrawlTimeout':27000}}, {'id':'keenable','name':'Keenable','color':'#8970c9','capability':'Live Fetch','config':{'live':True}}]
RELEASE_PROVIDERS=PROVIDERS+[{'id':'firecrawl','name':'Firecrawl','color':'#dd642d','capability':'Fresh main-content Markdown','config':{'maxAge':0,'timeout_seconds':27}}]
PROTOCOL='trace-live-v3'
LEGACY_PROVIDERS=['context','hetzner','exa','keenable']

def run_providers(metadata):
    ids=metadata.get('provider_ids',LEGACY_PROVIDERS)
    return [next(p for p in RELEASE_PROVIDERS if p['id']==ident) for ident in ids]

DECISION_POLICY='sampled-negative-is-unknown-v1'


def reported_decision(judgment,text_chars):
    # Excerpts can establish presence, but not absence in text the judge never saw.
    if judgment.get('judgment_status')=='triaged' and judgment.get('success') is False and text_chars>12000 and not judgment.get('review',{}).get('complete'):
        return None
    return judgment.get('success')


def make_export(store):
    from .credibility import evidence_card
    from .sampling import sampling_history,replenishment
    samples=sampling_history(store)
    runs=[];records=[]
    recent=list(store.db.execute('SELECT * FROM runs ORDER BY started_at DESC LIMIT 12'))
    recent_sql='SELECT id FROM runs ORDER BY started_at DESC LIMIT 12'
    tasks_by_run={}
    for task in store.db.execute('SELECT * FROM tasks WHERE run_id IN ('+recent_sql+') ORDER BY id'):
        tasks_by_run.setdefault(task['run_id'],[]).append(task)
    observations={r['id']:r for r in store.db.execute('SELECT * FROM observations WHERE run_id IN ('+recent_sql+')')}
    judgments={r['observation_id']:r for r in store.db.execute('SELECT j.* FROM judgments j JOIN observations o ON o.id=j.observation_id WHERE o.run_id IN ('+recent_sql+')')}
    references={(r['run_id'],r['task_id']):r for r in store.db.execute('SELECT * FROM browser_references WHERE run_id IN ('+recent_sql+')')}
    scores={r['observation_id']:r for r in store.db.execute('SELECT s.* FROM reference_scores s JOIN observations o ON o.id=s.observation_id WHERE o.run_id IN ('+recent_sql+')')}
    metadata_values={r['key']:json.loads(r['value']) for r in store.db.execute('SELECT key,value FROM metadata')}
    def meta(key):return metadata_values.get(key)
    for run in recent:
        tasks=tasks_by_run.get(run['id'],[])
        run_public={k:run[k] for k in ('id','started_at','finished_at','status','cohort')}
        run_public['selected_count']=len(tasks)
        run_public['sampling']=samples[run['id']]
        run_public['observed_count']=sum(r['run_id']==run['id'] and r['status']=='completed' for r in observations.values())
        run_public['judged_count']=sum(oid in observations and observations[oid]['run_id']==run['id'] and j['status']=='completed' for oid,j in judgments.items())
        metadata=json.loads(run['metadata'])
        run_public['protocol_version']=metadata.get('protocol_version',PROTOCOL)
        run_public['code_sha256']=metadata.get('code_sha256')
        run_public['collector']=metadata.get('collector')
        run_public['collection_profile']=metadata.get('collection_profile')
        run_public['execution_segments']=meta('execution:'+run['id']) or []
        run_public['recovery']=meta('recovery:'+run['id'])
        run_public['comparison_policy']=meta('output_comparison_policy:'+run['id'])
        run_public['analysis_override']=meta('analysis_override:'+run['id'])
        run_public['provider_ids']=[p['id'] for p in run_providers(metadata)]
        run_public['selection_sha256']=metadata.get('selection_sha256')
        run_public['manifest_url']='data/runs/'+run['id']+'.json'
        if run['cohort']=='needle':
            queries=metadata.get('queries',[]);slots=metadata.get('slots',[])
            run_public['query_stream']={k:metadata.get(k) for k in ('selected_query_count','selected_slot_count','unique_urls','new_acquisition_count','reused_url_count','reused_slot_count','repeated_url_count')}
            run_public['query_stream'].update(zero_result_queries=sum(q.get('result_count')==0 for q in queries),search_failures=sum(q.get('state')!='completed' for q in queries),invalid_slots=sum(not s.get('valid_url') for s in slots),reused_slots=sum(bool(s.get('acquisition_reused')) for s in slots))
        run_public['exclusion']=meta('run_exclusion:'+run['id'])
        runs.append(run_public)
        for t in tasks:
            task=json.loads(t['data'])
            for p in run_providers(metadata):
                oid=run['id']+':'+t['id']+':'+p['id']
                row=observations.get(oid)
                obs=json.loads(row['data']) if row and row['data'] else {}
                jr=judgments.get(oid)
                j=json.loads(jr['data']) if jr and jr['data'] else {}
                record={'id':oid,'run_id':run['id'],'task_id':t['id'],'provider':p['id'],'url':task['url'],'final_url':obs.get('final_url'), 'title':task.get('title') or task['url'], 'category':task['category'],'source_id':task['source_id'],'organization':task.get('organization'),'domain':urlsplit(task['url']).hostname,'discovered_at':task.get('discovered_at'),'published_at':task.get('published_at'),'started_at':obs.get('started_at') if 'started_at' in obs else (row['dispatched_at'] if row and row['status']=='dispatched' else None), 'elapsed_ms':obs.get('elapsed_ms'),'api_status':obs.get('api_status'),'origin_status':obs.get('origin_status'),'outcome':obs.get('outcome','not_attempted'),'content_label':j.get('content_label','unknown'),'identity_label':j.get('identity_label','unknown'),'judgment_status':j.get('judgment_status','pending'),'success':j.get('success'),'text_chars':obs.get('text_chars',0),'text_sha256':obs.get('text_sha256'),'text_preview':obs.get('text_preview',''),'error_code':obs.get('error_code'),'error_message':obs.get('error_message'),'credits':obs.get('credits'),'cost_usd':obs.get('cost_usd'),'cache':obs.get('cache',{}),'cohort':run['cohort'],'judgment':{k:j.get(k) for k in ('model','version','confidence','evidence','reason','review')},'truncated':bool(obs.get('truncated') or obs.get('truncation',{}).get('local_applied') or obs.get('truncation',{}).get('at_provider_cap'))}
                from .freshness import audit
                record['freshness']=obs.get('freshness') or audit(p['id'],obs.get('request_config',{}),obs.get('cache',{}))
                record['acquisition_attempt']=obs.get('acquisition_attempt',1)
                record['protocol_version']=run_public['protocol_version']
                record['selected_at']=run['started_at']
                record['run_exclusion']=run_public['exclusion']
                ref=references.get((run['id'],t['id']))
                record['reference']=json.loads(ref['data']) if ref and ref['data'] else {'status':ref['status'] if ref else 'not_captured'}
                score=scores.get(oid)
                record.update(json.loads(score['data']) if score else {'browser_recall':None})
                record['output_comparison']=meta('output_comparison:'+run['id']+':'+t['id'])
                records.append(record)
                record['repeated_url']=task.get('repeated_url')
                record['prior_run_id']=task.get('prior_run_id')
                record['judgment']['saved_model_success']=j.get('success')
                record['judgment']['decision_policy']='full-returned-text-review-v2' if j.get('version')=='identity-content-jev-v2' else DECISION_POLICY
                record['success']=reported_decision(j,obs.get('text_chars',0))
                if record['success'] is None and j.get('success') is False:
                    record['judgment']['reason']='Sampled text cannot establish absence in the uninspected content. The saved negative model judgment is retained; the reported result is unknown.'
                    record['judgment_status']='sampled_negative_unresolved'
    providers=[]
    used={r['provider'] for r in records}
    if not used:
        used=set(json.loads((Path(__file__).resolve().parents[1]/'config/benchmark.json').read_text())['providers'])
    for p in RELEASE_PROVIDERS:
        if p['id'] not in used:continue
        circuit=meta('circuit:'+p['id'])
        providers.append(dict(p,status='account_blocked' if circuit else 'configured',status_detail=circuit.get('error_code') if circuit else None))
    last=store.db.execute('SELECT data FROM discoveries ORDER BY id DESC LIMIT 1').fetchone()
    d=json.loads(last[0]) if last else {}
    receipts=[{k:r.get(k) for k in ('source_id','status','http_status','error','candidate_count','received_at','sha256')} for r in d.get('receipts',[])]
    utc=datetime.now(timezone.utc)
    from .capacity import profile
    daily=profile(store).get('cadence')=='daily'
    next_run=utc.replace(hour=0 if daily else utc.hour,minute=15,second=0,microsecond=0)
    if next_run<=utc:next_run+=timedelta(days=1) if daily else timedelta(hours=1)
    operations={'last_collection_at':meta('last_collection_at'),'next_run_at':next_run.isoformat() if meta('scheduler_enabled') else None,'scheduler_status':'enabled' if meta('scheduler_enabled') else 'manual','budgets':store.usage(),'notes':['Useful-content judgments and best-observed-output preferences are distinct measurements, not verified factual accuracy. Historical browser scores remain in the archive.','Independent-source and NEEDLE-search cohorts are separate.','Unknown costs are not zero. Text previews are truncated; full receipts remain private.','Content freshness is requested but provider cache policies differ; see adapter metadata.']}
    operations['collection_profile']=profile(store)
    operations['capacity_plan']=meta('capacity_plan')
    operations['last_tick']=meta('last_tick')
    needle=meta('needle:last_status') or {}
    operations['needle_status']={k:needle.get(k) for k in ('at','status','reason','families') if k in needle}
    if needle.get('snapshot'):
        operations['needle_status']['snapshot']={k:needle['snapshot'].get(k) for k in ('hf_revision','downloaded_at','rows')}
    operations['exported_history']='Latest completed daily panels and in-progress results; 12 run summaries and 90 days of quality history. Full receipts remain in the private database.'
    operations['original_reservations']=store.usage_reserved()
    judged=[json.loads(r[0]) for r in store.db.execute('SELECT data FROM judgments WHERE data IS NOT NULL')]
    today=[j for j in judged if str(j.get('judged_at','')).startswith(now()[:10])]
    operations['judge_reported_usage_today']={'scope':'Provider-output judgments only; reference and output-comparison judgments are included in reservations but excluded from these reported token totals.','input_tokens':sum(j.get('usage',{}).get('input_tokens',0) for j in today),'output_tokens':sum(j.get('usage',{}).get('output_tokens',0) for j in today),'responses_with_usage':sum(bool(j.get('usage')) for j in today)}
    if operations['last_tick'] and operations['last_tick'].get('errors'):
        operations['notes'].append('Latest worker tick had errors; inspect its retained health record. Last valid measurements are preserved.')
    categories=CATEGORIES+[{'id':'needle_'+family,'label':label+' queries'} for family,label in [('news','News'),('scholar','Scholar'),('agentic_rare','Rare'),('legal','Legal')] if any(r['category']=='needle_'+family for r in records)]
    from .metrics import aggregate,supply
    completed={r['id'] for r in runs if r['status']=='completed'}
    scored=[r for r in records if r['protocol_version']==PROTOCOL and not r.get('run_exclusion') and r['run_id'] in completed]
    metrics=aggregate(scored)
    for run in runs:
        key='run_metrics:'+run['id']
        if run['status']!='completed' or run['exclusion'] or run['protocol_version']!=PROTOCOL or key in metadata_values:continue
        summary={'run_id':run['id'],'protocol_version':PROTOCOL,'sample_kind':'daily' if (run.get('collection_profile') or {}).get('cadence')=='daily' else 'pilot',
                 'day':run['started_at'][:10],'cohort':run['cohort'],'providers':aggregate([r for r in scored if r['run_id']==run['id']])['cohorts'].get(run['cohort'],{})}
        store.meta(key,summary);metadata_values[key]=summary
    history=[v for k,v in metadata_values.items() if k.startswith('run_metrics:') and v['protocol_version']==PROTOCOL and not meta('run_exclusion:'+v['run_id']) and v['day']>=(utc-timedelta(days=89)).date().isoformat()]
    replaced=set()
    completed_runs={r['id']:r for r in store.db.execute("SELECT id,started_at,cohort,metadata FROM runs WHERE status='completed'")}
    for saved_run in completed_runs.values():
        saved_metadata=json.loads(saved_run['metadata'])
        if saved_metadata.get('operator_rerun') and saved_metadata.get('protocol_version')==PROTOCOL and not meta('run_exclusion:'+saved_run['id']):
            parent=saved_metadata.get('parent_run_id')
            original=completed_runs.get(parent)
            if original and original['cohort']==saved_run['cohort'] and original['started_at'][:10]==saved_run['started_at'][:10]:
                replaced.add(parent)
    history=[item for item in history if item['run_id'] not in replaced]
    daily_days={(v['day'],v['cohort']) for v in history if v['sample_kind']=='daily'}
    totals={}
    for item in history:
        if (item['day'],item['cohort']) in daily_days and item['sample_kind']!='daily':continue
        for provider,values in item['providers'].items():
            key=(item['day'],item['cohort'],provider)
            row=totals.setdefault(key,{'day':item['day'],'cohort':item['cohort'],'provider':provider,'sample_kind':item['sample_kind'],'pages':0,'success':0,'unknown':0})
            for field in ('pages','success','unknown'):row[field]+=values[field]
    detail_ids={r['id'] for r in runs if r['protocol_version']!=PROTOCOL or r['status']!='completed'}
    for cohort in ('independent','needle'):
        eligible=[r for r in runs if r['cohort']==cohort and r['status']=='completed' and r['protocol_version']==PROTOCOL and not r['exclusion']]
        daily_run=next((r for r in eligible if (r.get('collection_profile') or {}).get('cadence')=='daily'),None)
        detail_ids.update([daily_run['id']] if daily_run else [r['id'] for r in eligible])
    for run in runs:run['detail_available']=run['id'] in detail_ids
    records=[r for r in records if r['run_id'] in detail_ids]
    metrics=aggregate([r for r in scored if r['run_id'] in detail_ids])
    metrics['daily']=[dict(row,success_rate=row['success']/row['pages'] if row['pages'] else None) for _,row in sorted(totals.items())]
    return {'sampling_history':samples,'replenishment':replenishment(store),'metrics':metrics,'supply':supply(store),'schema_version':1,'generated_at':now(),'protocol_version':PROTOCOL,'decision_policy':'full-returned-text-review-v2','mode':'live' if profile(store)['name']=='live' else 'shadow','benchmark_card':evidence_card([r for r in records if not r.get('run_exclusion')]),'run':runs[0] if runs else None,'runs':runs,'providers':providers,'categories':categories,'records':records,'discovery':{'sources':len(receipts),'total_candidates':store.db.execute('SELECT COUNT(*) FROM candidates').fetchone()[0],'receipts':receipts,'shortfalls':meta('last_shortfalls') or {}},'operations':operations}


def publish(store,path):
    data=make_export(store)
    atomic_json(path,data)
    atomic_json(Path(path).parent/'run-sampling.json',data['sampling_history'])
    atomic_json(Path(path).parent/'replenishment.json',data['replenishment'])
    for run in store.db.execute('SELECT id,metadata FROM runs ORDER BY started_at DESC'):
        target=Path(path).parent/'runs'/(run['id']+'.json')
        if not target.exists() or 'public_tasks_sha256' not in json.loads(target.read_text()):
            metadata=json.loads(run['metadata'])
            tasks=[json.loads(r[0]) for r in store.db.execute('SELECT data FROM tasks WHERE run_id=? ORDER BY id',(run['id'],))]
            public_tasks=[{k:t.get(k) for k in ('id','url','title','category','source_id','organization','published_at','discovered_at')} for t in tasks]
            atomic_json(target,{'run_id':run['id'],'tasks':public_tasks,'public_tasks_sha256':digest(safe_json(public_tasks)),**{k:metadata.get(k) for k in ('selection_sha256','protocol_version','provider_ids','benchmark_config','code_sha256','code_manifest','collector','seed')}})
        segments=store.meta('execution:'+run['id']) or []
        manifest=json.loads(target.read_text())
        recovery=store.meta('recovery:'+run['id'])
        sampling=data['sampling_history'][run['id']]
        if manifest.get('execution_segments')!=segments or manifest.get('recovery')!=recovery or manifest.get('sampling')!=sampling:
            atomic_json(target,dict(manifest,execution_segments=segments,recovery=recovery,sampling=sampling))
    return data


def publish_progress(store,path,interval=60):
    """Bound expensive full-history snapshots during acquisition and judging."""
    stamp=time.monotonic()
    previous=getattr(store,'_last_progress_publish',None)
    if previous is None or stamp-previous>=interval:
        publish(store,path)
        store._last_progress_publish=stamp
        return True
    return False


async def publish_progress_async(store,path,interval=60):
    """Build snapshots outside the measured request event loop."""
    import asyncio,sys
    stamp=time.monotonic()
    previous=getattr(store,'_last_progress_publish',None)
    if previous is not None and stamp-previous<interval:return False
    store._last_progress_publish=stamp
    process=await asyncio.create_subprocess_exec(sys.executable,'-m','bench.export',str(store.root),str(path),cwd=Path(__file__).resolve().parents[1])
    code=await process.wait()
    if code:print(safe_json({'action':'progress_export_failed','exit_code':code}),flush=True)
    return code==0


if __name__=='__main__':
    import sys
    from .storage import Store
    store=Store(Path(sys.argv[1]))
    try:publish(store,Path(sys.argv[2]))
    finally:store.db.close()
