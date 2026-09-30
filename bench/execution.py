"""Bounded execution settings, frozen per run and recorded on every worker phase."""
import math
from pathlib import Path
from .storage import digest,now,safe_json

LEGACY={'page_concurrency':3,'host_concurrency':1,'global_interval_seconds':2.1,
        'host_interval_seconds':10,'judge_concurrency':2,'reference_judge_concurrency':1}
LIMITS={'page_concurrency':(1,128),'host_concurrency':(1,16),'global_interval_seconds':(.001,10),
        'host_interval_seconds':(.005,60),'judge_concurrency':(1,24),'reference_judge_concurrency':(1,12)}


def policy(store,run_id,metadata=None):
    import json
    if metadata is None:metadata=json.loads(store.db.execute('SELECT metadata FROM runs WHERE id=?',(run_id,)).fetchone()[0])
    result={key:metadata.get('benchmark_config',{}).get(key) for key in ('pipeline_scoring','output_comparison')}
    result['browser_reference']=metadata.get('browser_reference',False)
    return dict(result,**(store.meta('analysis_override:'+run_id) or {}))


def settings(store,run_id):
    import json
    metadata=json.loads(store.db.execute('SELECT metadata FROM runs WHERE id=?',(run_id,)).fetchone()[0])
    configured=store.meta('execution_override:'+run_id) or metadata.get('benchmark_config',{}).get('execution') or LEGACY
    result=dict(LEGACY,**configured)
    if set(result)!=set(LIMITS):raise ValueError('Unknown execution setting')
    for key,(low,high) in LIMITS.items():
        value=result[key]
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not low<=value<=high:raise ValueError('Invalid execution setting: '+key)
        if key.endswith('concurrency') and not isinstance(value,int):raise ValueError('Concurrency must be an integer')
    if policy(store,run_id,metadata).get('browser_reference') and (result['page_concurrency']>12 or result['host_concurrency']>2):raise ValueError('Browser runs require lower concurrency')
    return result


def record(store,run_id,phase,config):
    files={name:digest((Path(__file__).parent/name).read_bytes()) for name in ('runner.py','providers.py','comparison.py','references.py','execution.py','export.py','recovery.py')}
    segments=store.meta('execution:'+run_id) or []
    segments.append({'started_at':now(),'phase':phase,'settings':config,'analysis_policy':policy(store,run_id),'code_manifest':files,'code_sha256':digest(safe_json(files))})
    store.meta('execution:'+run_id,segments)
