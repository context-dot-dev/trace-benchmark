"""Deterministic public statistics with explicit denominators and missing values."""
import math
from collections import defaultdict
from datetime import datetime,timezone,timedelta


def quantile(values,q):
    values=sorted(v for v in values if isinstance(v,(float,int)) and not isinstance(v,bool) and math.isfinite(v) and v>=0)
    return values[max(0,math.ceil(q*len(values))-1)] if values else None


def valid_cost(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and value>=0


def summarize(records):
    n=len(records)
    success=sum(r['success'] is True for r in records)
    unknown=sum(r['success'] is None for r in records)
    attempted=[r for r in records if r.get('started_at')]
    timing=[r['elapsed_ms'] for r in attempted if r.get('elapsed_ms') is not None and r.get('outcome')!='harness_error']
    coverage=[r['browser_recall'] for r in records if r.get('browser_recall') is not None]
    known=[r for r in attempted if valid_cost(r.get('cost_usd'))]
    credits=[r for r in attempted if valid_cost(r.get('credits'))]
    cost=sum(r['cost_usd'] for r in known) if known else None
    complete=bool(attempted) and len(known)==len(attempted) and len(attempted)==n
    return {'pages':n,'attempted':len(attempted),'success':success,'unknown':unknown,
            'success_rate':success/n if n else None,'success_upper_bound':(success+unknown)/n if n else None,
            'p50_ms':quantile(timing,.5),'p95_ms':quantile(timing,.95),'timed':len(timing),
            'timeout_count':sum(r.get('error_code')=='CLIENT_DEADLINE' for r in records),
            'browser_recall':sum(coverage)/len(coverage) if coverage else None,'reference_scored_pages':len(coverage),
            'reported_cost_usd':cost,'cost_reported_pages':len(known),'cost_complete':complete,
            'usd_per_1000_useful':1000*cost/success if complete and success and unknown == 0 else None,
            'reported_credits':sum(r['credits'] for r in credits) if credits else None,'credit_reported_pages':len(credits)}


def aggregate(records):
    cohorts={}
    for cohort in sorted({r['cohort'] for r in records}):
        subset=[r for r in records if r['cohort']==cohort]
        cohorts[cohort]={p:summarize([r for r in subset if r['provider']==p]) for p in sorted({r['provider'] for r in subset})}
    daily=defaultdict(list)
    for r in records:
        date=(r.get('selected_at') or r.get('started_at') or '')[:10]
        daily[(date,r['cohort'],r['provider'])].append(r)
    return {'cohorts':cohorts,'daily':[dict(day=k[0],cohort=k[1],provider=k[2],**summarize(v)) for k,v in sorted(daily.items())]}


def supply(store):
    categories=defaultdict(lambda:dict(inventory=0,new_24h=0,domains=set()))
    cutoff=(datetime.now(timezone.utc)-timedelta(hours=24)).isoformat()
    from urllib.parse import urlsplit
    import json
    for row in store.db.execute('SELECT data,first_seen FROM candidates'):
        c=json.loads(row['data']);v=categories[c['category']]
        v['inventory']+=1;v['new_24h']+=row['first_seen']>=cutoff;v['domains'].add(urlsplit(c['url']).hostname)
    return {k:dict(v,domains=len(v['domains'])) for k,v in categories.items()}
