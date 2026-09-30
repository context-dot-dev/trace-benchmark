"""Independent rendered-page evidence. Automated references are explicitly not gold."""
import asyncio
from collections import Counter
import html
import json
from datetime import datetime
import re
import time
import unicodedata
from urllib.parse import urlsplit
from .storage import now, digest

VERSION='chromium-trafilatura-5gram-v1'
POLICY={'viewport':[1280,900],'locale':'en-US','timezone':'UTC','navigation':'domcontentloaded',
        'settle_ms':1500,'scroll_steps':3,'scroll_settle_ms':500,'deadline_seconds':30,
        'authentication':False,'consent_clicks':False,'dom_byte_limit':4000000,
        'main_text_character_limit':250000,'screenshot_max_height':8000,'max_reference_skew_seconds':120}


def grams(text):
    # Markdown destinations do not belong to the rendered prose token stream.
    text=re.sub(r'!?\[([^\]]*)\]\([^)]*\)',r'\1',text)
    words=re.findall(r'\w+',unicodedata.normalize('NFKC',html.unescape(text)).casefold())
    return Counter(tuple(words[i:i+5]) for i in range(max(0,len(words)-4)))


def recovery(reference_text,output):
    expected,actual=grams(reference_text),grams(output)
    n=sum(expected.values())
    return {'browser_recall':sum((expected & actual).values())/n if n else None,
            'reference_ngrams':n,'matched_ngrams':sum((expected & actual).values()),
            'scorer_version':VERSION}


class BrowserReferences:
    def __init__(self,store):
        self.store=store
        self.browser=None
        self.runtime=None
        self.error=None
        self.launch_lock=asyncio.Lock()

    async def start(self):
        async with self.launch_lock:
            try:
                from playwright.async_api import async_playwright
                if not self.runtime:self.runtime=await async_playwright().start()
                if not self.browser or not self.browser.is_connected():
                    self.browser=await self.runtime.chromium.launch(headless=True,channel="chromium")
                self.error=None
            except Exception as exc:
                self.error=type(exc).__name__+': '+str(exc)[:1200]
        return self

    async def close(self):
        try:
            if self.browser:await self.browser.close()
        finally:
            if self.runtime:await self.runtime.stop()

    async def capture(self,run_id,task):
        key=run_id+':'+task['id']
        if self.store.db.execute('SELECT 1 FROM browser_references WHERE id=?',(key,)).fetchone():return
        rec={'url':task['url'],'started_at':now(),'captured_at':None,'version':VERSION,'policy':POLICY,
             'status':'unavailable','reference_text':'','error':self.error,'automated':True}
        with self.store.db:
            self.store.db.execute('INSERT INTO browser_references VALUES(?,?,?,?,?,?)',(key,run_id,task['id'],'capturing',None,None))
        started=time.monotonic()
        context=None
        try:
            await self.start()
            if self.error:raise RuntimeError(self.error)
            from .runner import public_url
            context=await self.browser.new_context(viewport={'width':1280,'height':900},locale='en-US',timezone_id='UTC',
                                                   service_workers='block',accept_downloads=False)
            allowed={}
            async def guard(route):
                url=route.request.url
                if url.startswith(('data:','blob:')):return await route.continue_()
                host=urlsplit(url).hostname
                if host not in allowed:allowed[host]=await public_url(url)
                if not allowed[host]:return await route.abort()
                await route.continue_()
            await context.route('**/*',guard)
            page=await context.new_page()
            async with asyncio.timeout(30):
                response=await page.goto(task['url'],wait_until='domcontentloaded',timeout=22000)
                rec['origin_status']=response.status if response else None
                await page.wait_for_timeout(1500)
                for _ in range(3):
                    await page.evaluate('window.scrollBy(0, window.innerHeight)')
                    await page.wait_for_timeout(500)
                rec.update(final_url=page.url,title=await page.title())
                dom=await page.content()
                if len(dom.encode())>POLICY['dom_byte_limit']:raise ValueError('DOM exceeds reference limit')
                import trafilatura
                text=await asyncio.to_thread(trafilatura.extract,dom,include_comments=False,include_tables=True,output_format='txt')
                rec.update(reference_text=(text or '')[:250000],dom_sha256=digest(dom),dom=dom,
                           captured_at=now(),truncated=bool(text and len(text)>250000),browser_version=self.browser.version)
                height=await page.evaluate('Math.min(document.documentElement.scrollHeight,8000)')
                await page.evaluate('window.scrollTo(0,0)')
                shot=await page.screenshot(clip={'x':0,'y':0,'width':1280,'height':height},timeout=3000)
                path=self.store.root/'screenshots'/(digest(key)+'.png')
                path.parent.mkdir(exist_ok=True)
                path.write_bytes(shot)
                rec.update(screenshot_sha256=digest(shot),screenshot_file=path.name)
                rec['status']='candidate' if rec['reference_text'].strip() and rec.get('origin_status',500)<400 and not rec['truncated'] else 'unavailable'
                if rec['status']=='unavailable':rec['error']='Empty, HTTP error, or truncated reference'
        except Exception as exc:
            rec['error']=type(exc).__name__+': '+str(exc)[:180]
        finally:
            if context:
                try:await context.close()
                except Exception as exc:
                    rec.update(status='unavailable',error=rec.get('error') or 'Browser cleanup: '+type(exc).__name__+': '+str(exc)[:180])
        rec['reference_text_sha256']=digest(rec['reference_text'])
        rec['elapsed_ms']=round((time.monotonic()-started)*1000)
        blob=self.store.blob(rec)
        public={k:v for k,v in rec.items() if k not in ('reference_text','dom','screenshot_file')}
        with self.store.db:
            from .storage import safe_json
            self.store.db.execute('UPDATE browser_references SET status=?,data=?,blob=? WHERE id=?',(rec['status'],safe_json(public),blob,key))


async def assess_references(store,run_id):
    from .judging import judge,reservation_estimate
    from .capacity import profile
    from .storage import safe_json
    rows=list(store.db.execute("SELECT r.*,t.data AS task_data FROM browser_references r JOIN tasks t ON t.run_id=r.run_id AND t.id=r.task_id WHERE r.run_id=? AND r.status='candidate'",(run_id,)))
    from .execution import settings
    concurrency=settings(store,run_id)['reference_judge_concurrency']
    semaphore=asyncio.Semaphore(concurrency)
    async def assess(row):
        async with semaphore:
            rec=store.load_blob(row['blob']);task=json.loads(row['task_data'])
            obs={'outcome':'returned','text':rec['reference_text']}
            amount=reservation_estimate(task,obs)
            reservation='reference:'+row['id']
            reservation_day=now()[:10]
            if not store.reserve('jev_input_token_reservations',reservation,amount,profile(store)['judge_input_reservations'],day=reservation_day):return
            assessment=await judge(task,obs,client=judge_client)
            # Presence can qualify a candidate; no model-generated content becomes reference text.
            eligible=assessment.get('success') is True and sum(grams(rec['reference_text']).values())>=20
            rec.update(status='eligible' if eligible else 'unavailable',assessment=assessment)
            public={k:v for k,v in rec.items() if k not in ('reference_text','dom','screenshot_file','assessment')}
            public['assessment']={k:assessment.get(k) for k in ('content_label','identity_label','model','version','confidence')}
            with store.db:
                store.db.execute('UPDATE browser_references SET status=?,data=?,blob=? WHERE id=?',(rec['status'],safe_json(public),store.blob(rec),row['id']))
            measured=assessment.get('usage',{}).get('input_tokens')
            if type(measured) is int and 0<=measured<=amount:store.settle('jev_input_token_reservations',reservation,measured,day=reservation_day)
    import httpx
    async with httpx.AsyncClient(timeout=60,limits=httpx.Limits(max_connections=concurrency)) as judge_client:
        await asyncio.gather(*(assess(row) for row in rows))
    # Resumption may create observations after a reference was already assessed.
    for row in store.db.execute("SELECT * FROM browser_references WHERE run_id=? AND status='eligible'",(run_id,)).fetchall():
        rec=store.load_blob(row['blob'])
        pending=store.db.execute('SELECT o.id,o.blob FROM observations o LEFT JOIN reference_scores s ON s.observation_id=o.id WHERE o.run_id=? AND o.task_id=? AND o.blob IS NOT NULL AND s.observation_id IS NULL',(run_id,row['task_id'])).fetchall()
        for observation in pending:
            saved=store.load_blob(observation['blob'])
            try:
                skew=abs((datetime.fromisoformat(saved['started_at'])-datetime.fromisoformat(rec['started_at'])).total_seconds())
            except (ValueError,TypeError,KeyError):
                skew=None
            if saved['outcome']=='harness_error':
                score={'browser_recall':None,'reference_score_reason':'harness_error'}
            elif skew is None or skew>POLICY['max_reference_skew_seconds']:
                score={'browser_recall':None,'reference_score_reason':'capture_time_mismatch'}
            else:
                score=dict(await asyncio.to_thread(recovery,rec['reference_text'],saved['text']),reference_score_reason='scored',capture_skew_seconds=skew)
            with store.db:
                store.db.execute('INSERT INTO reference_scores VALUES(?,?) ON CONFLICT(observation_id) DO NOTHING',(observation['id'],safe_json(score)))
