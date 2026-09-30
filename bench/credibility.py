"""Evidence card for the current diagnostic protocol; never certifies a ranking."""
from collections import Counter, defaultdict
from .storage import digest,safe_json

REFERENCES=[
 {'name':'NEEDLE: live queries and inspectable runs','url':'https://github.com/keenableai/needle'},
 {'name':'HELM: standardized, transparent, multi-metric evaluation','url':'https://arxiv.org/abs/2211.09110'},
 {'name':'WebWalkerQA: questions, sources and navigation paths','url':'https://github.com/Alibaba-NLP/WebWalker'},
 {'name':'Exa: crossed training and inference backends','url':'https://exa.ai/blog/rl-search-outcomes'},
]


def evidence_card(records):
    groups=defaultdict(list)
    for record in records:groups[record['cohort']].append(record)
    cohorts=[]
    for cohort,rows in sorted(groups.items()):
        tasks={(r['run_id'],r['task_id']):r for r in rows}
        hosts=Counter(r.get('domain') for r in tasks.values() if r.get('domain'))
        by_category=defaultdict(list)
        for r in tasks.values():by_category[r['category']].append(r)
        category_rows=[]
        for category,items in sorted(by_category.items()):
            counts=Counter(r.get('domain') for r in items if r.get('domain'))
            top=counts.most_common(1)
            category_rows.append({'id':category,'tasks':len(items),'hostnames':len(counts),
                'top_host':top[0][0] if top else None,'top_host_tasks':top[0][1] if top else 0,
                'top_host_share':top[0][1]/len(items) if top else None})
        cohorts.append({'id':cohort,'task_acquisitions':len(tasks),'unique_urls':len({r['url'] for r in tasks.values()}),
            'provider_records':len(rows),'hostnames':len(hosts),'dated_tasks':sum(bool(r.get('published_at')) for r in tasks.values()),
            'categories':category_rows,'discovery':'Context Search selected URLs' if cohort=='needle' else 'Predeclared repeats' if cohort=='repeat' else 'Fixed named-source panel'})
    independent=[r for r in records if r['cohort']=='independent']
    slots=defaultdict(dict)
    for r in independent:slots[(r['run_id'],r['task_id'])][r['provider']]=r
    contrasts=[]
    for other in ('hetzner','exa','keenable'):
        wins=Counter();other_wins=0;unresolved=0;known=0
        for arms in slots.values():
            a,b=arms.get('context',{}),arms.get(other,{})
            if not isinstance(a.get('success'),bool) or not isinstance(b.get('success'),bool):
                unresolved+=1;continue
            known+=1
            if a['success'] and not b['success']:wins[a.get('domain') or 'unknown']+=1
            if b['success'] and not a['success']:other_wins+=1
        top=wins.most_common(1)
        contrasts.append({'comparison':'context / '+other,'jointly_resolved_pairs':known,'unresolved_pairs':unresolved,
            'context_only_positive':sum(wins.values()),'other_only_positive':other_wins,
            'largest_context_win_host':top[0][0] if top else None,'largest_context_win_host_count':top[0][1] if top else 0})
    manifest=sorted({(r['run_id'],r['task_id'],r['url'],r['cohort']) for r in records})
    return {'version':'trace-evidence-card-v1','status':'development_only','ranking_eligible':False,
        'selection_manifest_sha256':digest(safe_json(manifest)),
        'unit_note':'Provider records are repeated measurements of the same pages. Hostnames are shared acquisition environments, not independent trials.',
        'cohorts':cohorts,'independent_pair_diagnostics':contrasts,
        'missing_evidence':[
            {'id':'references','label':'Independent reference content','status':'not_implemented','detail':'No independently adjudicated evidence-recovery score is implemented.'},
            {'id':'grader','label':'Validated grader','status':'not_established','detail':'The inspected eight-observation audit is development data; judge error on an untouched audit set is unknown.'},
            {'id':'holdout','label':'Frozen evaluation release','status':'not_established','detail':'The visible pilot informed methodology changes and is not an untouched confirmatory test.'},
            {'id':'inference','label':'Generalizable comparison','status':'not_established','detail':'No domain-clustered confirmatory analysis or downstream answer evaluation has been completed.'}],
        'supported_use':'Inspect retrieval failures, latency, returned text and preliminary labels on the recorded source panel.',
        'unsupported_claims':['General-web provider ranking','Full-content or factual accuracy','Improved agent answers','Improved RL training'],
        'references':REFERENCES}
