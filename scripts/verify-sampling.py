"""Export integration: reruns/aliases must not become first-time URLs; dates must
not be guessed; empty categories retain quotas; the initial import is not daily
replenishment; repeat polls do not create arrivals; public manifests match UI data.
Run from the repository: PYTHONPATH=. python3 scripts/verify-sampling.py.
"""
import json
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from bench.storage import Store
from bench.export import publish

d0,d1,d2,d3=[(datetime.now(timezone.utc).date()-timedelta(days=n)).isoformat() for n in (3,2,1,0)]
checks = []
def check(name, condition):
    checks.append({'name': name, 'passed': bool(condition)})
    assert condition, name

with tempfile.TemporaryDirectory() as tmp:
    store = Store(Path(tmp)/'state')
    store.meta('collection_profile', 'live')
    task = {'id':'a','url':'https://example.org/a','title':'A','category':'news',
            'source_id':'feed','organization':'Example','published_at':d0+'T12:00:00Z',
            'discovered_at':d0+'T13:00:00Z'}
    def run(ident, tasks, stamp, **metadata):
        store.create_run(ident, tasks, metadata)
        store.db.execute('UPDATE runs SET started_at=? WHERE id=?',(stamp,ident))
        store.db.commit()
    run('original',[task],d1+'T00:00:00Z')
    run('rerun',[task],d1+'T01:00:00Z',parent_run_id='original',operator_rerun={'reason':'fixture'})
    alias = dict(task,id='alias',url='https://example.org/b',metadata={'aliases':[task['url']]},published_at='bad date')
    run('alias',[alias],d2+'T00:00:00Z')
    run('empty',[],d3+'T00:00:00Z')
    for ident, day in [('a',d0),('b',d1)]:
        t=dict(task,id=ident,url='https://example.org/'+ident,discovered_at=day+'T13:00:00Z')
        store.ingest({'candidates':[t],'receipts':[]})
    store.ingest({'candidates':[task],'receipts':[]})
    for ident, success in [('original',0),('rerun',1)]:
        store.close_run(ident,'completed')
        store.meta('run_metrics:'+ident,{'run_id':ident,'protocol_version':'trace-live-v3','sample_kind':'daily','day':d1,'cohort':'independent','providers':{'exa':{'pages':1,'success':success,'unknown':0}}})
    path=Path(tmp)/'site/data/latest.json'
    data=publish(store,path)
    runs={r['id']:r for r in data['runs']}
    check('First selection is first-time',runs['original']['sampling']['first_time_urls']==1)
    check('Rerun is repeated with explicit parent',runs['rerun']['sampling']['repeated_urls']==1 and runs['rerun']['sampling']['parent_run_id']=='original')
    check('Alias is not a new document',runs['alias']['sampling']['first_time_urls']==0)
    check('Age is measured at run start',runs['original']['sampling']['publication_age']['within_24h']==1)
    check('Invalid publication date stays unknown',runs['alias']['sampling']['publication_age']['unknown']==1)
    check('Empty categories retain 375 target',len(runs['empty']['sampling']['categories'])==8 and runs['empty']['sampling']['shortfall']==3000)
    check('Reruns are not fresh-supply attempts',runs['rerun']['sampling']['shortfall'] is None)
    daily=data['replenishment']['days']
    check('Initial import distinguished from replenishment',daily[0]['baseline_urls']==1 and daily[0]['new_urls']==0)
    check('Repeat discovery does not duplicate arrival',daily[1]['new_urls']==1 and sum(d['new_urls']+d['baseline_urls'] for d in daily)==2)
    manifest=json.loads((path.parent/'runs/rerun.json').read_text())
    check('Manifest and dashboard agree',manifest['sampling']==runs['rerun']['sampling'])
    check('All-run sampling ledger is downloadable',(path.parent/'run-sampling.json').exists())
    check('Completed replacement does not double-weight its parent',data['metrics']['daily'][0]['pages']==1 and data['metrics']['daily'][0]['success']==1)
    run('next-day-rerun',[task],d2+'T01:00:00Z',parent_run_id='rerun',operator_rerun={'reason':'fixture'})
    store.close_run('next-day-rerun','completed')
    store.meta('run_metrics:next-day-rerun',{'run_id':'next-day-rerun','protocol_version':'trace-live-v3','sample_kind':'daily','day':d2,'cohort':'independent','providers':{'exa':{'pages':1,'success':1,'unknown':0}}})
    check('A later-day rerun cannot erase yesterday',len(publish(store,path)['metrics']['daily'])==2)
    store.db.close()
Path('artifacts/sampling').mkdir(parents=True,exist_ok=True)
Path('artifacts/sampling/export-verification.json').write_text(json.dumps({'checks':checks},indent=2))
print(json.dumps({'passed':True,'checks':len(checks)}))
