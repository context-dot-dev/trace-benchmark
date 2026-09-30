"""TRACE CLI: collection, immutable reader runs, triage and local dashboard exports."""
import argparse
import asyncio
import fcntl
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from .storage import Store, now, digest, safe_json
from .export import publish, CATEGORIES
from .runner import Runner,judge_run
from .capacity import profile,plan,PROFILES,schedule_slot

ROOT=Path(__file__).resolve().parents[1]


def discover_into(store, due_only=False):
    from .discovery import discover
    sources=json.loads((ROOT/'config/sources.json').read_text())
    if isinstance(sources,dict):sources=sources.get('sources',sources.get('registry',[]))
    if due_only:
        current=datetime.now(timezone.utc)
        sources=[source for source in sources if not store.meta('source_poll:'+source['source_id']) or (current-datetime.fromisoformat(store.meta('source_poll:'+source['source_id']))).total_seconds()>=source.get('poll_interval_hours',1)*3600]
    if not sources:return {'candidates':[],'receipts':[]}
    receipt_dir=store.root/'discovery'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    result=discover(sources,receipt_dir)
    latest=store.meta('latest_receipts') or {}
    for receipt in result['receipts']:
        latest[receipt['source_id']]=receipt
        store.meta('source_poll:'+receipt['source_id'],now())
    store.meta('latest_receipts',latest)
    store.ingest(dict(result,receipts=list(latest.values())))
    print(json.dumps({'action':'discover','candidates':len(result['candidates']),'sources':len(result['receipts'])}),flush=True)
    return result


def select_run(store,per_category,cohort='independent'):
    from .discovery import select_candidates
    p=profile(store)
    daily_cap=p['daily_per_category'];org_cap=p['organization_cap']
    day=now()[:10]
    prior=list(store.db.execute('SELECT t.data,r.metadata AS run_metadata FROM tasks t JOIN runs r ON r.id=t.run_id WHERE r.cohort=? AND r.started_at LIKE ?',(cohort,day+'%')))
    counts={c['id']:0 for c in CATEGORIES};orgs={};hosts={}
    from urllib.parse import urlsplit
    for r in prior:
        if p.get('cadence')=='daily' and json.loads(r['run_metadata']).get('collection_profile',{}).get('cadence')!='daily':continue
        c=json.loads(r[0]);counts[c['category']]=counts.get(c['category'],0)+1;org=c.get('organization');orgs[org]=orgs.get(org,0)+1
        host=urlsplit(c['url']).hostname;hosts[host]=hosts.get(host,0)+1
    candidates=[c for c in store.candidates() if counts.get(c['category'],0)<daily_cap and orgs.get(c.get('organization'),0)<org_cap]
    seed='trace-live-v1:'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
    selection=select_candidates(candidates,store.seen(),per_category,seed,organization_cap=org_cap,organization_used=orgs,hostname_cap=p['hostname_cap'],hostname_used=hosts)
    # The selector caps a batch; this second guard enforces caps across every run today.
    accepted=[]
    for c in selection['selected']:
        cat,org=c['category'],c.get('organization')
        if counts.get(cat,0)>=daily_cap or orgs.get(org,0)>=org_cap:continue
        accepted.append(c);counts[cat]=counts.get(cat,0)+1;orgs[org]=orgs.get(org,0)+1
    selection['selected']=accepted
    selection['counts']={c['id']:sum(t['category']==c['id'] for t in accepted) for c in CATEGORIES}
    selection['organization_counts']={org:sum(t.get('organization')==org for t in accepted) for org in {t.get('organization') for t in accepted}}
    selection['daily_counts']=counts
    selection['collection_profile']=p
    selection['repeat_quota']=0 if p['scheduled'] else (8 if per_category==10 else 2)
    selection['shortfalls']={c['id']:max(0,daily_cap-counts[c['id']]) for c in CATEGORIES}
    store.meta('last_shortfalls',selection['shortfalls'])
    if not accepted:return None
    run_id='independent-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    store.blob({'run_id':run_id,'selection':selection})
    store.create_run(run_id,accepted,selection)
    from .repeats import schedule
    schedule(store,run_id,accepted,quota=selection['repeat_quota'])
    return run_id


async def execute(store,run_id,export_path):
    run=store.db.execute('SELECT cohort,metadata FROM runs WHERE id=?',(run_id,)).fetchone()
    metadata=json.loads(run['metadata'])
    if store.db.execute('SELECT status FROM runs WHERE id=?',(run_id,)).fetchone()[0]=='completed':
        publish(store,export_path)
        return
    if run['cohort']=='independent' and 'repeat_quota' in metadata and not store.db.execute('SELECT 1 FROM observations WHERE run_id=? LIMIT 1',(run_id,)).fetchone():
        from .repeats import schedule
        frozen=[json.loads(r[0]) for r in store.db.execute('SELECT data FROM tasks WHERE run_id=? ORDER BY id',(run_id,))]
        schedule(store,run_id,frozen,quota=metadata['repeat_quota'])
    print(json.dumps({'action':'acquire','run_id':run_id}),flush=True)
    await Runner(store,export_path).run(run_id)
    print(json.dumps({'action':'judge','run_id':run_id}),flush=True)
    await judge_run(store,run_id,export_path)
    print(json.dumps({'action':'complete','run_id':run_id}),flush=True)


def tick(store,export_path):
    health={'started_at':now(),'finished_at':None,'errors':[]}
    store.meta('last_tick',health)
    def lane(name,work):
        try:work()
        except Exception as exc:
            health['errors'].append({'lane':name,'type':type(exc).__name__,'message':str(exc)[:500]})
            print(safe_json({'action':'lane_error',**health['errors'][-1]}),flush=True)
        store.meta('last_tick',health)
        publish(store,export_path)
    from .repeats import materialize_due
    def repeats():
        for run in materialize_due(store):asyncio.run(execute(store,run,export_path))
    lane('repeats',repeats)
    lane('discovery',lambda:discover_into(store,due_only=True))
    if profile(store)['scheduled']:store.meta('capacity_plan',plan(store,profile(store)['name']))
    def independent():
        unfinished=list(store.db.execute("SELECT id FROM runs WHERE cohort='independent' AND status IN ('running','acquired','pending_budget') ORDER BY started_at"))
        for row in unfinished:asyncio.run(execute(store,row['id'],export_path))
        if profile(store).get('cadence')=='daily' and store.db.execute("SELECT 1 FROM runs WHERE cohort='independent' AND status IN ('running','acquired','pending_budget') LIMIT 1").fetchone():return
        utc=datetime.now(timezone.utc)
        p=profile(store)
        slot=schedule_slot(p,utc.isoformat())
        if (p['scheduled'] or utc.hour%6==0) and store.meta('last_slot')!=slot:
            run=select_run(store,p['batch_per_category'] if p['name']=='live' else (20 if p['scheduled'] else (2 if utc.hour in (0,6) else 3)))
            store.meta('last_slot',slot)
            if run:asyncio.run(execute(store,run,export_path))
    lane('independent',independent)
    def needle():
        from .needle import collect_needle
        run=collect_needle(store,per_family=10)
        if run:asyncio.run(execute(store,run,export_path))
    lane('needle',needle)
    health['finished_at']=now()
    store.meta('last_tick',health)
    publish(store,export_path)
    if health['errors']:raise RuntimeError('TRACE tick completed with lane errors; see last_tick health record')


def main():
    load_dotenv(ROOT/'.env',override=False)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['discover','run','resume','judge','export','tick','status','reset-provider','needle','capacity','set-profile'])
    parser.add_argument('--state',type=Path,default=Path(os.environ.get('TRACE_STATE',ROOT/'state')))
    parser.add_argument('--export',type=Path,default=ROOT/'site/data/latest.json')
    parser.add_argument('--per-category',type=int,default=2)
    parser.add_argument('--run-id')
    parser.add_argument('--provider',choices=['context','hetzner','exa','keenable','firecrawl'])
    parser.add_argument('--profile',choices=list(PROFILES),default='scale3000')
    args=parser.parse_args()
    if not 1<=args.per_category<=375:parser.error('--per-category must be1..375')
    store=Store(args.state)
    with (store.root/'worker.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print('Another TRACE worker holds the lock; no requests dispatched.');return
        if args.command=='capacity':print(json.dumps(plan(store,args.profile),indent=2));return
        elif args.command=='set-profile':
            store.meta('collection_profile',args.profile)
            store.meta('capacity_plan',plan(store,args.profile))
            print(json.dumps({'active_profile':profile(store),'capacity':store.meta('capacity_plan')},indent=2))
        elif args.command=='discover':discover_into(store)
        elif args.command=='run':
            if not store.candidates():discover_into(store)
            run=select_run(store,args.per_category)
            if run:asyncio.run(execute(store,run,args.export))
            else:print('No eligible unseen candidates within daily quotas.')
        elif args.command in ('resume','judge'):
            if not args.run_id:parser.error('--run-id required')
            if not store.db.execute('SELECT 1 FROM runs WHERE id=?',(args.run_id,)).fetchone():parser.error('unknown run id')
            if args.command=='resume':asyncio.run(execute(store,args.run_id,args.export))
            else:asyncio.run(judge_run(store,args.run_id,args.export))
        elif args.command=='reset-provider':
            if not args.provider:parser.error('--provider required')
            with store.db:store.db.execute('DELETE FROM metadata WHERE key=?',('circuit:'+args.provider,))
            print('Circuit cleared for future attempts; historical failures preserved.')
        elif args.command=='needle':
            from .needle import collect_needle
            run=collect_needle(store,per_family=args.per_category)
            if run:asyncio.run(execute(store,run,args.export))
        elif args.command=='tick':
            tick(store,args.export)
        elif args.command=='status':
            print(json.dumps({'runs':[dict(r) for r in store.db.execute('SELECT id,status,started_at FROM runs ORDER BY started_at DESC LIMIT 5')],'candidates':len(store.candidates()),'budget_reservations_today':store.usage()},indent=2))
        publish(store,args.export)


if __name__=='__main__':main()
