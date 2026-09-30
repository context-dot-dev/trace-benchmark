"""Public sampling provenance derived from frozen tasks and discovery timestamps."""
import json
from datetime import datetime, timezone
from .discovery import CATEGORIES, identity_keys


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)
    except (AttributeError, TypeError, ValueError):
        return None


def sampling_history(store):
    tasks = {}
    for row in store.db.execute('SELECT run_id,data FROM tasks ORDER BY id'):
        tasks.setdefault(row['run_id'], []).append(json.loads(row['data']))
    seen, history = set(), {}
    for run in store.db.execute('SELECT * FROM runs ORDER BY started_at,id'):
        metadata = json.loads(run['metadata'])
        profile = metadata.get('collection_profile') or {}
        rerun = bool(metadata.get('parent_run_id') or metadata.get('operator_rerun') or run['cohort']=='repeat')
        quota = profile.get('daily_per_category') if run['cohort']=='independent' and profile.get('cadence')=='daily' and not rerun else None
        categories = {c: {'selected':0,'first_time':0,'repeated':0,'target':quota,'shortfall':quota}
                      for c in (CATEGORIES if quota is not None else [])}
        ages = dict.fromkeys(('within_24h','one_to_seven_days','older_than_seven_days','unknown','future'),0)
        start, selected_keys = timestamp(run['started_at']), set()
        for task in tasks.get(run['id'], []):
            keys = identity_keys(task)
            repeated = bool(keys & seen)
            selected_keys.update(keys)
            category = categories.setdefault(task['category'],{'selected':0,'first_time':0,'repeated':0,'target':None,'shortfall':None})
            category['selected'] += 1
            category['repeated' if repeated else 'first_time'] += 1
            published = timestamp(task.get('published_at'))
            age = (start-published).total_seconds() if start and published else None
            bucket = 'unknown' if age is None else 'future' if age<0 else 'within_24h' if age<=86400 else 'one_to_seven_days' if age<=7*86400 else 'older_than_seven_days'
            ages[bucket] += 1
        seen.update(selected_keys)
        for category in categories.values():
            if category['target'] is not None:
                category['shortfall'] = max(0,category['target']-category['selected'])
        history[run['id']] = {
            'first_time_urls':sum(c['first_time'] for c in categories.values()),
            'repeated_urls':sum(c['repeated'] for c in categories.values()),
            'publication_age':ages,'categories':categories,
            'target':quota*len(CATEGORIES) if quota is not None else None,
            'shortfall':sum(c['shortfall'] for c in categories.values()) if quota is not None else None,
            'kind':'rerun' if rerun else 'daily_selection' if quota is not None else 'query_selection' if run['cohort']=='needle' else 'earlier_batch',
            'parent_run_id':metadata.get('parent_run_id'),
        }
    return history


def replenishment(store):
    candidates = [(json.loads(r['data']),r['first_seen'][:10]) for r in store.db.execute('SELECT data,first_seen FROM candidates')]
    def original_source(candidate):
        origins=candidate.get('discovery_origins') or []
        return origins[0]['source_id'] if origins else candidate['source_id']
    first_days = {}
    for candidate, day in candidates:
        source = original_source(candidate)
        first_days[source] = min(first_days.get(source,day),day)
    days = {}
    def daily(day):
        return days.setdefault(day,{'day':day,'new_urls':0,'baseline_urls':0,'categories':{c:0 for c in CATEGORIES},'polls':0,'failed_polls':0})
    for candidate, day in candidates:
        row = daily(day)
        baseline = day==first_days[original_source(candidate)]
        row['baseline_urls' if baseline else 'new_urls'] += 1
        if not baseline:
            row['categories'][candidate['category']] = row['categories'].get(candidate['category'],0)+1
    polls = set()
    for discovery in store.db.execute('SELECT id,data FROM discoveries ORDER BY id'):
        for receipt in json.loads(discovery['data']).get('receipts',[]):
            stamp = receipt.get('received_at')
            key = (receipt.get('source_id'),stamp)
            if not stamp or key in polls:
                continue
            polls.add(key)
            row = daily(stamp[:10])
            row['polls'] += 1
            row['failed_polls'] += receipt.get('status')!='ok'
    return {'days':[days[day] for day in sorted(days)[-90:]],
            'definition':'Unique URLs first discovered after each source’s initial inventory day. Discovery is not publication, eligibility, or successful scraping. Days without recorded polls do not establish zero supply.'}
