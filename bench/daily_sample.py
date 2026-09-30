"""One daily sample: unseen pages plus a versioned 30-day control panel.

Selection runs under the CLI's worker lock. Saving a panel before creating its
first run makes crash recovery reuse the same controls rather than resample them.
"""
import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from .discovery import CATEGORIES, identity_keys, select_candidates
from .storage import digest, safe_json, now


def daily_sample(store, settings, stamp, persist=False):
    day = stamp[:10]
    candidates = store.candidates()
    panel = store.meta('control_panel')
    if not panel or day >= panel['expires_at'][:10]:
        previous = panel
        excluded = set()
        for task in (previous or {}).get('tasks', []):
            excluded.update(identity_keys(task))
        selected = select_candidates(candidates, excluded, settings['control_per_category'],
            'controls:'+day, organization_cap=settings['organization_cap'], hostname_cap=settings['hostname_cap'])['selected']
        version = day+'-'+digest(safe_json(selected))[:12]
        panel = {'version':version,'starts_at':day+'T00:00:00+00:00',
                 'expires_at':(datetime.fromisoformat(day).replace(tzinfo=timezone.utc)+timedelta(days=settings['control_days'])).isoformat(),
                 'replaces':previous['version'] if previous else None,'tasks':selected}
        if persist:
            store.meta('control_panel:'+version, panel)
            store.meta('control_panel', panel)
    controls = [dict(t,sample_role='control',control_panel_version=panel['version']) for t in panel['tasks']]
    seen = set()
    for row in store.db.execute('SELECT DISTINCT cohort FROM runs'):
        seen.update(store.seen(row['cohort']))
    for task in controls:
        seen.update(identity_keys(task))
    orgs = Counter(t['organization'] for t in controls)
    hosts = Counter(urlsplit(t['url']).hostname for t in controls)
    selection = select_candidates(candidates, seen, settings['new_per_category'], 'new:'+day,
        organization_cap=settings['organization_cap'], organization_used=orgs,
        hostname_cap=settings['hostname_cap'], hostname_used=hosts)
    selected = controls+[dict(t,sample_role='new') for t in selection['selected']]
    roles = {}
    for role, quota in [('new',settings['new_per_category']),('control',settings['control_per_category'])]:
        categories = {cat:{'selected':sum(t['category']==cat and t['sample_role']==role for t in selected),'target':quota} for cat in CATEGORIES}
        for counts in categories.values():counts['shortfall']=max(0,quota-counts['selected'])
        roles[role] = {'categories':categories,'selected':sum(c['selected'] for c in categories.values()),
                       'target':quota*len(CATEGORIES),'shortfall':sum(c['shortfall'] for c in categories.values())}
    return {'selected':selected,'seed':'daily:'+day,'sample_design':settings['version'],
            'control_panel':{k:v for k,v in panel.items() if k!='tasks'},'roles':roles,
            'counts':{cat:sum(t['category']==cat for t in selected) for cat in CATEGORIES},
            'shortfalls':{cat:sum(r['categories'][cat]['shortfall'] for r in roles.values()) for cat in CATEGORIES},
            'organization_counts':dict(Counter(t['organization'] for t in selected)),
            'collection_profile':settings,'repeat_quota':0}


def select_daily_run(store, stamp=None):
    from .capacity import profile
    stamp = stamp or now()
    for row in store.db.execute("SELECT metadata FROM runs WHERE cohort='independent' AND started_at LIKE ?",(stamp[:10]+'%',)):
        if json.loads(row['metadata']).get('collection_profile',{}).get('cadence')=='daily':
            return None
    selection = daily_sample(store,profile(store),stamp,persist=True)
    store.meta('last_shortfalls',selection['shortfalls'])
    run_id = 'independent-'+datetime.fromisoformat(stamp).strftime('%Y%m%dT%H%M%S.%fZ')
    # Even an empty sample gets a receipt: zero supply must remain observable.
    store.blob({'run_id':run_id,'selection':selection})
    store.create_run(run_id,selection['selected'],selection)
    return run_id
