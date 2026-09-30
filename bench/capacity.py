"""Explicit collection profiles and network-free supply planning."""
from collections import Counter
from urllib.parse import urlsplit
from .discovery import CATEGORIES, select_candidates
from .storage import digest, safe_json

PROFILES = {
    'live': dict(version='daily-controls-v1', cadence='daily', daily_per_category=375, batch_per_category=375,
                 new_per_category=300, control_per_category=75, control_days=30, organization_cap=125,
                 hostname_cap=375, reader_requests=4000, context_reservations=4000,
                 judge_input_reservations=120_000_000, scheduled=True),
    'shadow': dict(version='shadow-80-v1', daily_per_category=10, organization_cap=5,
                   hostname_cap=None, reader_requests=300, context_reservations=400,
                   judge_input_reservations=4_000_000, scheduled=False),
    'scale3000': dict(version='development-3000-v1', cadence='hourly', daily_per_category=375, organization_cap=125,
                      hostname_cap=375, reader_requests=3300, context_reservations=4000,
                      judge_input_reservations=60_000_000, scheduled=True),
}


def profile(store):
    name=store.meta('collection_profile') or 'shadow'
    if name not in PROFILES: raise ValueError('Unknown collection profile')
    return dict(PROFILES[name],name=name)


def plan(store, name='scale3000'):
    if name not in PROFILES: raise ValueError('Unknown collection profile')
    p=PROFILES[name]
    candidates=store.candidates()
    if name=='live':
        from .daily_sample import daily_sample
        from .storage import now
        selection=daily_sample(store,p,now())
    else:
        selection=select_candidates(candidates, store.seen(), p['daily_per_category'],
            'capacity:'+p['version'], organization_cap=p['organization_cap'],hostname_cap=p['hostname_cap'])
    selected=selection['selected']
    hosts=Counter(urlsplit(c['url']).hostname for c in selected)
    return dict(profile=name,settings=p,daily_target=8*p['daily_per_category'],
                candidate_inventory=len(candidates),eligible_selection=len(selected),
                target_met=len(selected)==8*p['daily_per_category'],
                category_counts=selection['counts'],shortfalls=selection['shortfalls'],roles=selection.get('roles'),control_panel=selection.get('control_panel'),
                selected_hostnames=len(hosts),largest_hosts=hosts.most_common(8),
                selected_organizations=len({c['organization'] for c in selected}),
                selected_manifest_sha256=digest(safe_json(sorted(c['id'] for c in selected))),
                qualification='Next-day inventory capacity, not measured daily replenishment or completed reads. New pages exclude all earlier selections. Controls repeat for 30 days; no substitution across categories.',
                annual_base_reads_per_provider=8*p['daily_per_category']*365,
                extra_lane_note=('NEEDLE adds up to 400 result slots/day separately. The base sample includes up to 600 control pages.' if name=='live' else 'NEEDLE adds up to80 pages/day; repeats disabled in scale3000. Extra lanes excluded from base workload.'))


def schedule_slot(settings, timestamp):
    from datetime import datetime
    utc=datetime.fromisoformat(timestamp)
    if settings.get('cadence')=='daily':return utc.strftime('%Y-%m-%d')
    if settings['scheduled']:return utc.strftime('%Y-%m-%dT%H')
    return utc.strftime('%Y-%m-%dT')+str(utc.hour//6)
