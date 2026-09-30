"""Fresh NEEDLE query cohorts, single-attempt search, immutable ranked URL selection."""
import asyncio
import json
import os
import time
import unicodedata
from datetime import datetime, timezone
from urllib.parse import urldefrag, urlsplit

import httpx

from .providers import _public_url
from .storage import digest, now, safe_json

DATASET = 'keenable-ai/needle-results'
FAMILIES = ('news', 'scholar', 'agentic_rare', 'legal')
SEARCH_URL = 'https://api.context.dev/v1/web/search'
SEED = 'needle-stream-pilot-20260917-v1'
QUERY_PREFIX = 'needle:query:'


def normalized(text):
    return ' '.join(unicodedata.normalize('NFKC', text).lower().split())


def _object(value):
    return json.loads(value) if isinstance(value, str) else value


def _timestamp(row):
    return row.get('query_produced_at') or row.get('hour_ts')


def _request(method, url, *, headers=None, body=None):
    """A 30-second total deadline and bounded body, including slow streaming."""
    async def perform():
        started = time.monotonic()
        receipt = {'url': url, 'method': method, 'started_at': now(), 'request_body': body,
                   'status': None, 'body_text': '', 'error': None}
        try:
            async with asyncio.timeout(30):
                async with httpx.AsyncClient(timeout=30, trust_env=False, follow_redirects=method=='GET') as client:
                    async with client.stream(method, url, headers=headers, json=body) as response:
                        receipt['status'] = response.status_code
                        chunks, size = [], 0
                        async for chunk in response.aiter_bytes():
                            size += len(chunk)
                            if size > 8 * 1024 * 1024:
                                raise ValueError('Response exceeded 8 MiB')
                            chunks.append(chunk)
                        raw = b''.join(chunks)
                        receipt.update(body_text=raw.decode('utf-8', errors='replace'), body_sha256=digest(raw))
        except (TimeoutError, httpx.HTTPError, ValueError) as exc:
            receipt['error'] = type(exc).__name__
        receipt.update(finished_at=now(), elapsed_ms=round((time.monotonic()-started)*1000))
        return receipt
    return asyncio.run(perform())


def _snapshot(store):
    info = _request('GET', f'https://huggingface.co/api/datasets/{DATASET}')
    info_blob = store.blob(info)
    if info['status'] != 200 or info.get('error'):
        raise ValueError('Hugging Face repository metadata unavailable')
    revision = json.loads(info['body_text'])['sha']
    if not isinstance(revision, str) or len(revision) != 40 or any(c not in '0123456789abcdef' for c in revision):
        raise ValueError('Hugging Face revision was not an immutable commit')
    url = f'https://huggingface.co/datasets/{DATASET}/resolve/{revision}/daily_queries.jsonl'
    daily = _request('GET', url)
    daily_blob = store.blob(daily)
    if daily['status'] != 200 or daily.get('error'):
        raise ValueError('Hugging Face immutable daily query stream unavailable')
    rows = [json.loads(line) for line in daily['body_text'].splitlines() if line.strip()]
    snapshot = {'hf_revision': revision, 'metadata_blob': info_blob, 'daily_blob': daily_blob,
                'url': url, 'downloaded_at': now(), 'rows': len(rows)}
    store.meta('needle:last_snapshot', snapshot)
    return rows, snapshot


def _claim(store, row, snapshot):
    """Claim identity and all three reservations in one transaction before dispatch."""
    key = digest(normalized(row['query_text']))
    stamp = now()
    receipt = {'query_hash': key, 'family': row['bench'], 'upstream_run_id': row['run_id'],
               'query_row': row, 'snapshot': snapshot, 'dispatched_at': stamp,
               'status': 'dispatched_completion_unknown', 'receipt_blob': None, 'run_id': None}
    from .capacity import profile
    buckets = [('context_credit_reservations', profile(store)['context_reservations']), ('needle_search_requests', 40),
               ('needle_search_requests:'+row['bench'], 10)]
    with store.db:
        store.db.execute('BEGIN IMMEDIATE')
        if store.db.execute('SELECT 1 FROM metadata WHERE key=?', (QUERY_PREFIX+key,)).fetchone():
            return None
        for bucket, cap in buckets:
            used = store.db.execute('SELECT COALESCE(SUM(amount),0) FROM budget WHERE day=? AND bucket=?', (stamp[:10],bucket)).fetchone()[0]
            if used+1 > cap:
                return None
        for bucket, _ in buckets:
            store.db.execute('INSERT INTO budget VALUES(?,?,?,?)', (stamp[:10],bucket,'needle:'+key,1))
        store.db.execute('INSERT INTO metadata VALUES(?,?)', (QUERY_PREFIX+key,safe_json(receipt)))
    return receipt


def _slots(store, item):
    if not item.get('receipt_blob'):
        return [], None
    receipt = store.load_blob(item['receipt_blob'])
    try:
        payload = json.loads(receipt['body_text'])
        results = payload.get('results') if isinstance(payload,dict) else None
    except (ValueError, TypeError):
        results = None
    if receipt.get('status') != 200 or receipt.get('error') or not isinstance(results,list):
        return [], None
    slots = []
    for rank, result in enumerate(results[:10] if store.meta('collection_profile')=='live' else results[:2],1):
        result = result if isinstance(result,dict) else {}
        original = result.get('url')
        url = urldefrag(original)[0] if isinstance(original,str) else ''
        slots.append({'query_hash':item['query_hash'],'family':item['family'],
                      'rank':rank,'original_url':original,'url':url,'valid_url':_public_url(url),
                      'title':result.get('title'),'description':result.get('description')})
    return slots, len(results)


def _materialize(store):
    items = [json.loads(r[0]) for r in store.db.execute('SELECT value FROM metadata WHERE key LIKE ? ORDER BY key',(QUERY_PREFIX+'%',))]
    pending = [r for r in items if not r.get('run_id')]
    assigned_missing = [r for r in items if r.get('run_id') and not store.db.execute('SELECT 1 FROM runs WHERE id=?',(r['run_id'],)).fetchone()]
    if assigned_missing:
        run_id = assigned_missing[0]['run_id']
        selected = [r for r in assigned_missing if r['run_id']==run_id]
    elif pending:
        selected = pending
        run_id = 'needle-'+now().replace(':','').replace('+0000','Z')+'-'+digest('|'.join(r['query_hash'] for r in selected))[:8]
        with store.db:
            for item in selected:
                item['run_id'] = run_id
                store.db.execute('UPDATE metadata SET value=? WHERE key=?',(safe_json(item),QUERY_PREFIX+item['query_hash']))
    else:
        return None
    selected.sort(key=lambda r:(r['dispatched_at'],FAMILIES.index(r['family']),r['query_hash']))
    # A URL selected earlier today already owns its acquisition, even if its
    # readers have not finished. Never copy those observations into this run.
    day = now()[:10]
    prior_urls, same_day = {}, {}
    for prior in store.db.execute('''
        SELECT t.id AS task_id,t.data,r.id AS run_id,r.started_at
        FROM tasks t JOIN runs r ON r.id=t.run_id
        WHERE r.cohort='needle' ORDER BY r.started_at DESC,r.id DESC
    '''):
        url = json.loads(prior['data'])['url']
        reference = {'run_id':prior['run_id'],'task_id':prior['task_id']}
        prior_urls.setdefault(url,reference)
        if prior['started_at'][:10] == day:
            same_day.setdefault(url,reference)
    tasks, all_slots, queries = {}, [], []
    for item in selected:
        slots, result_count = _slots(store,item)
        all_slots.extend(slots)
        row = item['query_row']
        origin = {'query_id':row.get('query_id'),'query':row['query_text'],'query_family':item['family'],
                  'query_timestamp':_timestamp(row),'upstream_run_id':row['run_id'],
                  'hf_revision':item['snapshot']['hf_revision'],'query_origin':_object(row.get('query_origin',{}))}
        queries.append({'query_hash':item['query_hash'],'family':item['family'],'state':item['status'],
                        'receipt_blob':item.get('receipt_blob'),'result_count':result_count,
                        'selected_slot_count':len(slots),'origin':origin})
        for slot in slots:
            if not slot['valid_url']:
                continue
            url = slot['url']
            if url in same_day:
                slot['acquisition_ref'] = same_day[url]
                slot['acquisition_reused'] = True
                continue
            slot['acquisition_ref'] = {'run_id':run_id,'task_id':digest(url)}
            slot['acquisition_reused'] = False
            if url not in tasks:
                tasks[url] = {'id':digest(url),'url':url,'title':slot.get('title') or url,
                    'category':'needle_'+item['family'],'source_id':'needle-'+item['family'],
                    'organization':urlsplit(url).hostname,'document_id':url,'discovered_at':item['dispatched_at'],
                    'published_at':None,'query_family':item['family'],'query_origin_metadata':[],
                    'language':'unknown','language_status':'unverified',
                    'category_semantics':'query family, not verified page topic','selection_slots':[],
                    'repeated_url':url in prior_urls,'prior_run_id':prior_urls.get(url,{}).get('run_id')}

            tasks[url]['query_origin_metadata'].append(origin)
            tasks[url]['selection_slots'].append(slot)
    metadata = {'cohort':'needle','queries':queries,'slots':all_slots,
        'selected_query_count':len(selected),'selected_slot_count':len(all_slots),
        'unique_urls':len({s['url'] for s in all_slots if s['valid_url']}),
        'new_acquisition_count':len(tasks),
        'reused_url_count':len({s['url'] for s in all_slots if s.get('acquisition_reused')}),
        'reused_slot_count':sum(bool(s.get('acquisition_reused')) for s in all_slots),
        'repeated_url_count':sum(t['repeated_url'] for t in tasks.values()),
        'selection':('Top ten' if store.meta('collection_profile')=='live' else 'Top two')+' ranked results unchanged; malformed slots retained but not fetched; URL duplicates retain all provenance and reuse an existing NEEDLE acquisition in the same UTC day; cross-day URLs are marked repeated; first selected slot assigns display category for a new acquisition.',
        'snapshot_blobs':list({r['snapshot']['daily_blob'] for r in selected}),
        'claim':'URLs returned by Context Search for NEEDLE queries; source language and page category unverified.'}
    store.blob(metadata)
    store.create_run(run_id,list(tasks.values()),metadata,cohort='needle')
    return run_id


def collect_needle(store, per_family=10):
    """Return one ready reader run, or None. Caller holds the normal worker lock.

    Repeated calls can consume remaining fresh queries from an upstream family run.
    Claims persist globally; failures and interrupted dispatches are never re-searched.
    """
    if isinstance(per_family,bool) or not isinstance(per_family,int) or not 1 <= per_family <= 10:
        raise ValueError('per_family must be an integer from 1 through 10')
    recovered = _materialize(store)
    if recovered:
        return recovered
    running = store.db.execute("SELECT id FROM runs WHERE cohort='needle' AND status IN ('running','acquired','pending_budget') ORDER BY started_at LIMIT 1").fetchone()
    if running:
        return running['id']
    if not os.environ.get('CONTEXT_API_KEY') or store.meta('circuit:context'):
        store.meta('needle:last_status',{'status':'blocked','reason':'Context credential missing or account circuit open','at':now()})
        return None
    try:
        rows, snapshot = _snapshot(store)
    except (ValueError,KeyError,TypeError) as exc:
        store.meta('needle:last_status',{'status':'discovery_error','reason':str(exc),'at':now()})
        return None
    clock = datetime.fromisoformat(now())
    last_dispatch = 0.0
    family_status = {}
    for family in FAMILIES:
        family_rows = [r for r in rows if r.get('bench')==family and isinstance(r.get('query_text'),str) and r.get('run_id')]
        if not family_rows:
            family_status[family] = {'status':'missing','searched':0}
            continue
        latest = max(r['run_id'] for r in family_rows)
        distinct = {}
        for row in sorted((r for r in family_rows if r['run_id']==latest),key=lambda r:(_timestamp(r) or '',r.get('query_id','')),reverse=True):
            try:
                stamp=datetime.fromisoformat((_timestamp(row) or '').replace('Z','+00:00'))
                age=(clock-stamp).total_seconds()
            except (ValueError,TypeError):
                continue
            if 0 <= age <= 86400 and normalized(row['query_text']):
                distinct.setdefault(normalized(row['query_text']),row)
        candidates = sorted(distinct.values(),key=lambda r:digest(SEED+'\0'+normalized(r['query_text'])))
        candidates.sort(key=lambda r:_timestamp(r) or '',reverse=True)
        searched=0
        for row in candidates:
            if searched>=per_family:
                break
            claim=_claim(store,row,snapshot)
            if not claim:
                continue
            time.sleep(max(0,2.1-(time.monotonic()-last_dispatch)))
            last_dispatch=time.monotonic()
            receipt=_request('POST',SEARCH_URL,headers={'Authorization':'Bearer '+os.environ['CONTEXT_API_KEY']},
                body={'query':row['query_text'],'numResults':10,'queryFanout':False,'markdownOptions':{'enabled':False}})
            receipt.update(query_hash=claim['query_hash'],hf_revision=snapshot['hf_revision'])
            claim.update(status='completed' if receipt.get('status')==200 and not receipt.get('error') else 'search_failed',receipt_blob=store.blob(receipt))
            store.meta(QUERY_PREFIX+claim['query_hash'],claim)
            searched+=1
            if receipt.get('status') in (401,402):
                store.meta('circuit:context',{'error_code':'HTTP_'+str(receipt['status']),'at':now()})
                break
        remaining=sum(store.meta(QUERY_PREFIX+digest(normalized(r['query_text']))) is None for r in candidates)
        status={'upstream_run_id':latest,'hf_revision':snapshot['hf_revision'],'eligible_distinct':len(candidates),'remaining_unclaimed':remaining,'searched':searched,
                'status':'consumed' if candidates and remaining==0 else 'partial' if candidates else 'stale_or_invalid'}
        family_status[family]=status
        store.meta('needle:family:'+family,status)
        if store.meta('circuit:context'):
            break
    store.meta('needle:last_status',{'at':now(),'families':family_status,'snapshot':snapshot})
    return _materialize(store)
