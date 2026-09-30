"""Offline selection-to-publication checks, written before implementation.
Failures: panel drift/refill within 30 days, wrong rollover boundary, alias overlap,
reused new pages, duplicate daily dispatch, cross-category substitution, combined
host/org cap overflow, hidden shortfalls, volume-weighted or mixed-role scores,
lost role/version in receipts, and rewriting legacy history. No paid API calls.
PYTHONPATH=. python3 scripts/verify-daily-sample.py
"""
import json
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta
from bench.storage import Store
from bench.discovery import CATEGORIES, identity_keys
from bench.daily_sample import daily_sample, select_daily_run
from bench.metrics import sample_scores
from bench.export import publish

checks=[]
def check(name, ok):
    checks.append({'name':name,'passed':bool(ok)})
    assert ok, name

stamp=datetime.now(timezone.utc).replace(hour=0,minute=0,second=0,microsecond=0)
def at(days):return (stamp+timedelta(days=days)).isoformat()
settings=dict(version='daily-controls-v1',cadence='daily',daily_per_category=4,new_per_category=3,control_per_category=1,control_days=30,organization_cap=6,hostname_cap=6)
with tempfile.TemporaryDirectory() as tmp:
    store=Store(Path(tmp)/'state');store.meta('collection_profile','live')
    candidates=[dict(id=f'{cat}-{i}',url=f'https://{cat.replace("_","-")}-{i%3}.example.org/{i}',category=cat,source_id='fixture',organization=f'{cat}-{i%3}',discovered_at=at(0)) for cat in CATEGORIES for i in range(20)]
    store.ingest({'candidates':candidates,'receipts':[]})
    first=daily_sample(store,settings,at(0),persist=True)
    check('One sample has 24 new pages and 8 controls',len(first['selected'])==32 and sum(t['sample_role']=='new' for t in first['selected'])==24)
    panel=first['control_panel']
    control=lambda sample:{t['id'] for t in sample['selected'] if t['sample_role']=='control'}
    new=lambda sample:[t for t in sample['selected'] if t['sample_role']=='new']
    store.create_run('day-one',first['selected'],first)
    store.db.execute('UPDATE runs SET started_at=? WHERE id=?',(at(0),'day-one'));store.db.commit()
    before=daily_sample(store,settings,at(29),persist=True)
    check('Controls and panel version remain frozen through day 29',control(first)==control(before) and panel==before['control_panel'])
    check('New pages never reuse earlier selected identities',not any(identity_keys(t)&store.seen() for t in new(before)))
    check('Roles do not overlap',not control(before)&{t['id'] for t in new(before)})
    check('Combined organization caps hold',max(before['organization_counts'].values())<=6)
    rotated=daily_sample(store,settings,at(30),persist=True)
    check('Day 30 creates a versioned replacement',rotated['control_panel']['version']!=panel['version'] and rotated['control_panel']['replaces']==panel['version'])
    check('Replacement excludes prior controls',not control(rotated)&control(first))
    check('Old version remains auditable',store.meta('control_panel:'+panel['version'])['tasks'])
    check('Same-day selection cannot dispatch a second daily sample',select_daily_run(store,at(0)) is None)
    sparse=Store(Path(tmp)/'sparse');sparse.meta('collection_profile','live')
    sparse.ingest({'candidates':candidates[:1],'receipts':[]})
    short=daily_sample(sparse,settings,at(0),persist=True)
    sparse.ingest({'candidates':candidates,'receipts':[]})
    later=daily_sample(sparse,settings,at(1),persist=True)
    check('Underfilled panels are not silently refilled',control(short)==control(later))
    check('Shortfalls preserve all eight category targets',len(short['roles']['new']['categories'])==8 and short['roles']['new']['shortfall']==24 and short['roles']['control']['shortfall']==7)
    samples=[dict(provider='exa',category=cat,sample_role='new',success=cat=='news') for cat in CATEGORIES for _ in range(100 if cat=='news' else 1)]
    score=sample_scores(samples)['new']['exa']
    check('Eight categories receive equal weight',score['success_rate']==.125 and score['pages']==107)
    check('Missing category withholds the full score',sample_scores(samples[:-1])['new']['exa']['success_rate'] is None)
    mixed=samples+[dict(provider='exa',category=cat,sample_role='control',success=True) for cat in CATEGORIES]
    check('Control and new scores stay separate',sample_scores(mixed)['control']['exa']['success_rate']==1 and sample_scores(mixed)['new']['exa']['success_rate']==.125)
    store.close_run('day-one','completed')
    data=publish(store,Path(tmp)/'data/latest.json')
    run=next(r for r in data['runs'] if r['id']=='day-one')
    check('Sampling exposes role counts and version',run['sampling']['roles']['new']['selected']==24 and run['sampling']['control_panel']['version']==panel['version'])
    manifest=json.loads((Path(tmp)/'data/runs/day-one.json').read_text())
    check('Public receipts preserve sample roles',sum(t['sample_role']=='control' for t in manifest['tasks'])==8)
    check('Export includes all four providers for every role',len(data['records'])==128 and {r['provider'] for r in data['records']}=={'context','exa','firecrawl','keenable'})
    check('Role history remains separate from legacy daily series',len(data['metrics']['sample_daily'])==8 and not data['metrics']['daily'])
    fixture=Store(Path(tmp)/'fixture');fixture.meta('collection_profile','live')
    fixture.ingest({'candidates':[t for t in candidates if int(t['id'].rsplit('-',1)[1])<(4 if t['category']=='news' else 2)],'receipts':[]})
    selected=daily_sample(fixture,settings,at(0),persist=True)
    fixture.create_run('fixture-daily',selected['selected'],selected)
    for task in selected['selected']:
        for provider in ('context','exa','firecrawl','keenable'):
            oid='fixture-daily:'+task['id']+':'+provider
            obs=dict(started_at=at(0),elapsed_ms=1000,outcome='returned',text_chars=100)
            judgment=dict(success=task['sample_role']=='control' or task['category']=='news',judgment_status='triaged',content_label='useful',identity_label='matching')
            fixture.db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?)',(oid,'fixture-daily',task['id'],provider,'completed',json.dumps(obs),None,at(0)))
            fixture.db.execute('INSERT INTO judgments VALUES(?,?,?,?)',(oid,'completed',json.dumps(judgment),None))
    fixture.db.commit();fixture.close_run('fixture-daily','completed')
    publish(fixture,Path('artifacts/daily-controls/fixture/data/latest.json'))
Path('artifacts/daily-controls').mkdir(parents=True,exist_ok=True)
Path('artifacts/daily-controls/selection-verification.json').write_text(json.dumps({'checks':checks},indent=2))
print(json.dumps({'passed':True,'checks':len(checks)}))
