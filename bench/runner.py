"""Bounded four-reader runs. No silent retry of dispatched acquisitions."""
import asyncio
from contextlib import AsyncExitStack
import httpx
import json
import math
import os
import socket
import shutil
import ipaddress
import time
from urllib.parse import urlsplit
from .storage import now,safe_json,digest
from .providers import fetch_reader
from .judging import judge,deterministic,reservation_estimate
from .export import PROVIDERS,publish,run_providers,publish_progress_async
from .capacity import profile
from .execution import settings,record,policy,LEGACY


async def public_url(url):
    parsed=urlsplit(url)
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password:
        return False
    try:
        addresses=await asyncio.get_running_loop().getaddrinfo(parsed.hostname,parsed.port or (443 if parsed.scheme=='https' else 80),type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(a[4][0]).is_global for a in addresses)
    except (OSError,ValueError):return False


class Runner:
    def __init__(self,store,export_path):
        self.store=store;self.export_path=export_path;self.profile=profile(store)
        self.providers=PROVIDERS
        self.references=None
        self.reader_clients={}
        self.score_ready=None
        self.config=LEGACY
        self.sem=asyncio.Semaphore(3);self.pace_lock=asyncio.Lock();self.host_locks={}

    async def pace(self,url):
        host=urlsplit(url).hostname
        while True:
            async with self.pace_lock:
                saved=self.store.meta('reader_pacing') or {'global':0,'hosts':{}}
                current=time.time()
                global_gap=self.config['global_interval_seconds'];host_gap=self.config['host_interval_seconds']
                delay=max(0,min(global_gap,global_gap-(current-saved['global'])),min(host_gap,host_gap-(current-saved['hosts'].get(host,0))))
                if delay<=0:
                    recent={h:t for h,t in saved['hosts'].items() if current-t<60}
                    recent[host]=current
                    self.store.meta('reader_pacing',{'global':current,'hosts':recent})
                    return
            await asyncio.sleep(delay)

    def save_observation(self,oid,obs):
        existing=self.store.db.execute('SELECT blob FROM observations WHERE id=?',(oid,)).fetchone()
        if not existing or existing['blob']:
            raise ValueError('Observation missing or already finalized; create a new attempt instead')
        blob=self.store.blob(obs)
        public={k:v for k,v in obs.items() if k not in ('text','raw')}
        # Public evidence is only a short excerpt, not a full copyrighted document.
        public.update(text_chars=len(obs.get('text','')),text_preview=obs.get('text','')[:180])
        with self.store.db:
            self.store.db.execute('UPDATE observations SET status=?,data=?,blob=? WHERE id=?',('completed',safe_json(public),blob,oid))

    async def acquire(self,run_id,task,provider):
        oid=run_id+':'+task['id']+':'+provider
        if self.store.db.execute('SELECT 1 FROM observations WHERE id=?',(oid,)).fetchone():return
        circuit=self.store.meta('circuit:'+provider)
        if circuit:
            obs={'provider':provider,'url':task['url'],'started_at':None,'finished_at':now(),'elapsed_ms':None,'outcome':'harness_error','error_code':'account_blocked_not_attempted','error_message':'Earlier account/configuration failure; no additional request dispatched.','text':'','text_sha256':digest(''),'raw':{}}
            with self.store.db:self.store.db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?)',(oid,run_id,task['id'],provider,'not_attempted',None,None,now()))
            self.save_observation(oid,obs)
            return
        buckets=[('reader_requests:'+provider,self.profile['reader_requests'])]
        if provider=='context':buckets.append(('context_credit_reservations',self.profile['context_reservations']))
        attempt=self.store.meta('acquisition_attempt:'+run_id+':'+task['id']) or 1
        reservation=oid if attempt==1 else oid+':attempt:'+str(attempt)
        if not self.store.reserve_all(buckets,reservation):return
        with self.store.db:self.store.db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?)',(oid,run_id,task['id'],provider,'dispatched',None,None,now()))
        if getattr(self.store,'serverless',False):
            obs=await asyncio.to_thread(lambda: asyncio.run(fetch_reader(provider,task['url'])))
        else:
            obs=await fetch_reader(provider,task['url'],{'client':self.reader_clients.get(provider)})
        obs['acquisition_attempt']=attempt
        self.save_observation(oid,obs)
        if obs.get('outcome')=='harness_error' and (obs.get('api_status') in (401,402) or obs.get('error_code') in ('MISSING_CREDENTIAL','missing_api_key','missing_key')):
            self.store.meta('circuit:'+provider,{'error_code':obs.get('error_code') or 'http_'+str(obs.get('api_status')),'at':now()})

    async def capture_reference(self,run_id,task):
        try:await self.references.capture(run_id,task)
        except Exception as exc:
            rec={'url':task['url'],'started_at':now(),'status':'unavailable','automated':True,
                 'error':'Reference worker: '+type(exc).__name__+': '+str(exc)[:300]}
            key=run_id+':'+task['id'];blob=self.store.blob(rec)
            with self.store.db:
                self.store.db.execute("INSERT INTO browser_references VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data,blob=excluded.blob WHERE browser_references.status='capturing'",(key,run_id,task['id'],'unavailable',safe_json(rec),blob))

    async def task(self,run_id,task):
        existing=self.store.db.execute('SELECT COUNT(*) FROM observations WHERE run_id=? AND task_id=?',(run_id,task['id'])).fetchone()[0]
        reference_done=not self.references or self.store.db.execute('SELECT 1 FROM browser_references WHERE run_id=? AND task_id=?',(run_id,task['id'])).fetchone()
        if existing==len(self.providers) and reference_done:return
        host=urlsplit(task['url']).hostname
        host_lock=self.host_locks.setdefault(host,asyncio.Semaphore(self.config['host_concurrency']))
        async with host_lock, self.sem:
            if not await public_url(task['url']):
                for p in self.providers:
                    oid=run_id+':'+task['id']+':'+p['id']
                    if self.store.db.execute('SELECT 1 FROM observations WHERE id=?',(oid,)).fetchone():continue
                    with self.store.db:self.store.db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?)',(oid,run_id,task['id'],p['id'],'not_attempted',None,None,now()))
                    self.save_observation(oid,{'provider':p['id'],'url':task['url'],'text':'','text_sha256':digest(''),'outcome':'harness_error','error_code':'unsafe_or_unresolved_target','raw':{}})
                return
            await self.pace(task['url'])
            # Rotated invocation order, parallel deadlines; all see the same URL.
            ids=[p['id'] for p in self.providers]
            offset=int(digest(task['id'])[:4],16)%len(ids)
            work=[self.acquire(run_id,task,p) for p in ids[offset:]+ids[:offset]]
            if self.references:work.append(self.capture_reference(run_id,task))
            await asyncio.gather(*work)
            if self.score_ready:self.score_ready.set()
        await publish_progress_async(self.store,self.export_path)

    async def run(self,run_id,task_limit=None):
        self.config=settings(self.store,run_id)
        self.sem=asyncio.Semaphore(self.config['page_concurrency'])
        record(self.store,run_id,'acquisition',self.config)
        if not getattr(self.store,'serverless',False) and self.profile['scheduled'] and shutil.disk_usage(self.store.root).free < 10_000_000_000:
            raise RuntimeError('Collection paused: less than10GB free for immutable receipts; expand/archive storage before dispatch.')
        metadata=json.loads(self.store.db.execute('SELECT metadata FROM runs WHERE id=?',(run_id,)).fetchone()[0])
        self.providers=run_providers(metadata)
        self.references=None
        if policy(self.store,run_id,metadata).get('browser_reference'):
            from .references import BrowserReferences
            self.references=await BrowserReferences(self.store).start()
            if self.references.error:
                error=self.references.error
                await self.references.close()
                raise RuntimeError('Reference browser failed before any reader dispatch: '+error[:180])
        tasks=[json.loads(r[0]) for r in self.store.db.execute('SELECT data FROM tasks WHERE run_id=? ORDER BY id',(run_id,))]
        all_tasks=tasks
        if task_limit is not None:
            counts={r['task_id']:r['n'] for r in self.store.db.execute('SELECT task_id,COUNT(*) AS n FROM observations WHERE run_id=? GROUP BY task_id',(run_id,))}
            tasks=[t for t in tasks if counts.get(t['id'],0)<len(self.providers)][:task_limit]
        pipeline=task_limit is None and policy(self.store,run_id,metadata).get('pipeline_scoring') is True
        self.score_ready=asyncio.Event() if pipeline else None
        done=asyncio.Event()
        async def score_loop():
            while True:
                await self.score_ready.wait()
                self.score_ready.clear()
                await score_available(self.store,run_id,self.export_path,self.config)
                if done.is_set() and not self.score_ready.is_set():return
        scoring=None
        if pipeline:
            record(self.store,run_id,'pipelined_scoring',self.config)
            scoring=asyncio.create_task(score_loop())
        try:
            async with AsyncExitStack() as stack:
                self.reader_clients={p['id']:await stack.enter_async_context(httpx.AsyncClient(
                    timeout=30,follow_redirects=False,trust_env=False,
                    limits=httpx.Limits(max_connections=self.config['page_concurrency'],
                                       max_keepalive_connections=self.config['page_concurrency']))) for p in self.providers}
                await asyncio.gather(*(self.task(run_id,t) for t in tasks))
        finally:
            self.reader_clients={}
            if scoring:
                done.set()
                self.score_ready.set()
            try:
                if scoring:await scoring
            finally:
                self.score_ready=None
                if self.references:
                    try:await self.references.close()
                    except Exception as exc:print(safe_json({'action':'reference_cleanup_failed','run_id':run_id,'error':type(exc).__name__}),flush=True)
        missing=self.store.db.execute("SELECT COUNT(*) FROM observations WHERE run_id=? AND status='dispatched'",(run_id,)).fetchone()[0]
        count=self.store.db.execute('SELECT COUNT(*) FROM observations WHERE run_id=?',(run_id,)).fetchone()[0]
        if task_limit is not None and count<len(all_tasks)*len(self.providers):
            return
        self.store.close_run(run_id,'acquired' if not missing and count==len(all_tasks)*len(self.providers) else 'incomplete')
        publish(self.store,self.export_path)


async def score_available(store,run_id,export_path,config):
    metadata=json.loads(store.db.execute('SELECT metadata FROM runs WHERE id=?',(run_id,)).fetchone()[0])
    work=[judge_observations(store,run_id,export_path,config)]
    if policy(store,run_id,metadata).get('browser_reference'):
        from .references import assess_references
        if policy(store,run_id,metadata).get('pipeline_scoring') is True:
            work.append(assess_references(store,run_id))
        else:
            await assess_references(store,run_id)
    await asyncio.gather(*work)
    if policy(store,run_id,metadata).get('output_comparison'):
        from .comparison import compare_run
        await compare_run(store,run_id)


async def judge_observations(store,run_id,export_path,config,limit=None):
    semaphore=asyncio.Semaphore(config['judge_concurrency'])
    rows=list(store.db.execute('SELECT o.*,t.data AS task_data FROM observations o JOIN tasks t ON t.run_id=o.run_id AND t.id=o.task_id WHERE o.run_id=? AND o.blob IS NOT NULL AND NOT EXISTS (SELECT 1 FROM judgments j WHERE j.observation_id=o.id)',(run_id,)))
    if limit is not None: rows=rows[:limit]
    async def one(row):
        oid=row['id']
        if store.db.execute('SELECT 1 FROM judgments WHERE observation_id=?',(oid,)).fetchone():return
        async with semaphore:
            obs=store.load_blob(row['blob']);task=json.loads(row['task_data'])
            simple=deterministic(obs)
            reservation_day=now()[:10]
            if not simple:
                # Conservative pre-dispatch reservation. Actual usage is separately retained.
                estimate=reservation_estimate(task,obs)
                if not store.reserve('jev_input_token_reservations',oid,estimate,profile(store)['judge_input_reservations'],day=reservation_day):return
            with store.db:store.db.execute('INSERT INTO judgments VALUES(?,?,?,?)',(oid,'dispatched',None,None))
            j=await judge(task,obs,client=judge_client)
            blob=store.blob(j)
            public={k:v for k,v in j.items() if k!='private'}
            with store.db:store.db.execute('UPDATE judgments SET status=?,data=?,blob=? WHERE observation_id=?',('completed',safe_json(public),blob,oid))
            usage=j.get('usage',{})
            measured=usage.get('input_tokens')
            if j.get('judgment_status')=='triaged' and isinstance(measured,int) and not isinstance(measured,bool) and 0<=measured<=estimate:
                store.settle('jev_input_token_reservations',oid,measured,day=reservation_day)
            await publish_progress_async(store,export_path)
    async with httpx.AsyncClient(timeout=60,limits=httpx.Limits(max_connections=config['judge_concurrency'])) as judge_client:
        await asyncio.gather(*(one(row) for row in rows))


async def judge_run(store,run_id,export_path):
    config=settings(store,run_id)
    record(store,run_id,'scoring',config)
    metadata=json.loads(store.db.execute('SELECT metadata FROM runs WHERE id=?',(run_id,)).fetchone()[0])
    providers=run_providers(metadata)
    await score_available(store,run_id,export_path,config)
    count=store.db.execute("SELECT COUNT(*) FROM judgments j JOIN observations o ON o.id=j.observation_id WHERE o.run_id=? AND j.status='completed'",(run_id,)).fetchone()[0]
    needed=store.db.execute('SELECT COUNT(*) FROM tasks WHERE run_id=?',(run_id,)).fetchone()[0]*len(providers)
    observed=store.db.execute('SELECT COUNT(*) FROM observations WHERE run_id=?',(run_id,)).fetchone()[0]
    unstarted_judgments=store.db.execute('SELECT COUNT(*) FROM observations o LEFT JOIN judgments j ON j.observation_id=o.id WHERE o.run_id=? AND o.blob IS NOT NULL AND j.observation_id IS NULL',(run_id,)).fetchone()[0]
    status='pending_budget' if observed<needed or unstarted_judgments else ('completed' if count==needed else 'review_pending')
    store.close_run(run_id,status)
    publish(store,export_path)
