"""Bounded, restartable collector slices driven exclusively by Vercel Cron."""
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
from collections import Counter
from urllib.parse import urlsplit
from .postgres import PostgresStore
from .storage import now
from .capacity import profile
from .execution import settings, policy, record
from .export import PROTOCOL, run_providers, publish
from .runner import Runner, judge_observations
from .comparison import compare_run

ROOT = Path(__file__).resolve().parents[1]


def discover_due(store):
    from .discovery import discover
    sources = json.loads((ROOT/'config/sources.json').read_text())
    if isinstance(sources, dict): sources = sources.get('sources', sources.get('registry', []))
    clock = datetime.now(timezone.utc)
    due = [source for source in sources if not store.meta('source_poll:'+source['source_id']) or
           (clock-datetime.fromisoformat(store.meta('source_poll:'+source['source_id']))).total_seconds() >= source.get('poll_interval_hours', 1)*3600]
    if not due: return False
    due.sort(key=lambda source: (clock-datetime.fromisoformat(store.meta('source_poll:'+source['source_id']))).total_seconds() / (source.get('poll_interval_hours', 1)*3600) if store.meta('source_poll:'+source['source_id']) else float('inf'), reverse=True)
    chosen, hosts = [], Counter()
    for source in due:
        host = urlsplit(source['url']).hostname
        if hosts[host] >= 2:
            continue
        chosen.append(source); hosts[host] += 1
        if len(chosen) == 16:
            break
    with tempfile.TemporaryDirectory(dir=store.root) as directory:
        result = discover(chosen, Path(directory))
        prefix = 'discovery/vercel/'+Path(directory).name+'/'
        paths = {}
        for path in Path(directory).rglob('*'):
            if path.is_file():
                saved = prefix+str(path.relative_to(directory))
                store.put_file(saved, path.read_bytes())
                paths[str(path.resolve())] = saved
        result['registry_path'] = paths[result['registry_path']]
        for candidate in result['candidates']:
            metadata = candidate['metadata']
            metadata['raw_path'] = paths[metadata['raw_path']]
        for receipt in result['receipts']:
            for request in [receipt, *receipt['requests']]:
                if request.get('raw_path'):
                    request['raw_path'] = paths[request['raw_path']]
        latest = store.meta('latest_receipts') or {}
        for receipt in result['receipts']:
            latest[receipt['source_id']] = receipt
            store.meta('source_poll:'+receipt['source_id'], now())
        store.meta('latest_receipts', latest)
        store.ingest(dict(result, receipts=list(latest.values())))
    return True


async def advance_run(store, run):
    run_id = run['id']
    metadata = json.loads(run['metadata'])
    providers = run_providers(metadata)
    config = settings(store, run_id)
    record(store,run_id,'serverless_slice',config,{'pages':8,'judgments':32,'comparisons':8})
    expected = store.db.execute('SELECT COUNT(*) FROM tasks WHERE run_id=?', (run_id,)).fetchone()[0]*len(providers)
    before = store.db.execute('SELECT COUNT(*) FROM observations WHERE run_id=?', (run_id,)).fetchone()[0]
    if before < expected:
        await Runner(store, None).run(run_id, task_limit=8)
    await judge_observations(store, run_id, None, config, limit=32)
    if policy(store, run_id, metadata).get('output_comparison'):
        await compare_run(store, run_id, limit=8)
    observed = store.db.execute('SELECT COUNT(*) FROM observations WHERE run_id=?', (run_id,)).fetchone()[0]
    judged = store.db.execute("SELECT COUNT(*) FROM judgments j JOIN observations o ON o.id=j.observation_id WHERE o.run_id=? AND j.status='completed'", (run_id,)).fetchone()[0]
    missing = store.db.execute('SELECT COUNT(*) FROM observations o LEFT JOIN judgments j ON j.observation_id=o.id WHERE o.run_id=? AND o.blob IS NOT NULL AND j.observation_id IS NULL', (run_id,)).fetchone()[0]
    comparisons = 0
    if policy(store, run_id, metadata).get('output_comparison'):
        saved={r['key']:json.loads(r['value']) for r in store.db.execute('SELECT key,value FROM metadata WHERE key LIKE ?',('output_comparison:'+run_id+':%',))}
        ready=store.db.execute("SELECT o.task_id FROM observations o JOIN judgments j ON j.observation_id=o.id WHERE o.run_id=? AND j.status='completed' GROUP BY o.task_id HAVING COUNT(*)=?",(run_id,len(providers)))
        for task in ready:
            comparison=saved.get('output_comparison:'+run_id+':'+task['task_id'])
            if not comparison or comparison.get('status')=='pending_budget':comparisons+=1
    if observed<expected and observed==before:
        store.close_run(run_id,'pending_budget')
    if observed == expected and not missing and not comparisons:
        store.close_run(run_id, 'completed' if judged == expected else 'review_pending')
    return run_id


def tick():
    store = PostgresStore()
    try:
        if not store.acquire_worker(): return {'status': 'busy'}
        if not store.meta('vercel:migration_verified'):
            raise RuntimeError('Verified historical migration is required before collection')
        for key in ('CONTEXT_API_KEY','EXA_API_KEY','FIRECRAWL_API_KEY','KEENABLE_API_KEY','TYPESAFE_API_KEY'):
            if not os.environ.get(key): raise RuntimeError('Missing collector credential: '+key)
        if profile(store)['name'] != 'live': raise RuntimeError('Only the current live protocol runs on Vercel')
        stamp = now()
        day = stamp[:10]
        store.meta('scheduler_enabled', True)
        health = {'started_at': stamp, 'finished_at': None, 'errors': [], 'collector': 'vercel'}
        store.meta('last_tick', health)
        try:
            # Each invocation does one bounded lane. Rotation prevents a large run
            # from starving free discovery or the independent NEEDLE cohort.
            lane = (store.meta('vercel:lane') or 0) % 10
            store.meta('vercel:lane', lane+1)
            if lane in (0, 5):
                status = 'discovered' if discover_due(store) else 'discovery_current'
            elif lane == 1:
                from .needle import collect_needle
                status = 'needle'; collect_needle(store, max_searches=4)
            else:
                runs = [row for row in store.db.execute("SELECT * FROM runs WHERE status IN ('running','acquired','pending_budget','incomplete') ORDER BY started_at")
                        if json.loads(row['metadata']).get('protocol_version') == PROTOCOL]
                if runs:
                    selected = runs[(store.meta('vercel:run_cursor') or 0) % len(runs)]
                    store.meta('vercel:run_cursor', (store.meta('vercel:run_cursor') or 0)+1)
                    async def advance():
                        async with asyncio.timeout(210):
                            return await advance_run(store, selected)
                    status = 'advanced'; asyncio.run(advance())
                elif datetime.now(timezone.utc).strftime('%H:%M') >= '00:15' and store.meta('last_slot') != day:
                    from .daily_sample import select_daily_run
                    select_daily_run(store); store.meta('last_slot', day); status = 'selected'
                else: status = 'idle'
            health['finished_at'] = now(); store.meta('last_tick', health)
            return {'status': status, 'finished_at': health['finished_at']}
        except Exception as error:
            health['finished_at'] = now()
            health['errors'].append({'lane': lane, 'type': type(error).__name__})
            store.meta('last_tick', health)
            raise
    finally:
        store.db.close()


def export():
    store = PostgresStore()
    try:
        if not store.acquire_worker(): return {'status': 'busy'}
        store.defer_publish = False
        with tempfile.TemporaryDirectory(dir=store.root) as directory:
            publish(store, Path(directory)/'latest.json')
            with store.db:
                for path in Path(directory).rglob('*.json'):
                    store.publish_file(str(path.relative_to(directory)), json.loads(path.read_text()))
        return {'status': 'exported'}
    finally:
        store.db.close()
