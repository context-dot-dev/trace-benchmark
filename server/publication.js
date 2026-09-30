import { createHash } from 'node:crypto';
import { summarize, paired, taskKey, validatePayload, human } from '../src/model.js';

/** @param {import('./types').Archive} archive */
export function publication(archive) {
  validatePayload(archive);
  const completed=new Set(archive.runs.filter(r=>r.status==='completed').map(r=>r.id));
  const eligible=archive.records.filter(r=>r.protocol_version===archive.protocol_version&&!r.run_exclusion&&completed.has(r.run_id));
  const latestDaily=Object.fromEntries(['independent','needle'].map(cohort=>[cohort,archive.runs.find(r=>r.cohort===cohort&&r.protocol_version===archive.protocol_version&&r.status==='completed'&&!r.exclusion&&r.collection_profile?.cadence==='daily')?.id]));
  const records=eligible.filter(r=>!latestDaily[r.cohort]||r.run_id===latestDaily[r.cohort]);
  const providers=archive.providers.filter(p=>archive.records.some(r=>r.protocol_version===archive.protocol_version&&r.provider===p.id)).map(({id,name,status,status_detail})=>({id,name,status,status_detail}));
  const cohorts={};
  for(const cohort of ['independent','needle']) {
    const subset=records.filter(r=>r.cohort===cohort);
    const tasks=[...new Map(subset.map(r=>[taskKey(r),r])).values()];
    const dates=subset.map(r=>Date.parse(r.started_at)).filter(Number.isFinite);
    cohorts[cohort]={
      sampleKind:latestDaily[cohort]?'daily':'pilot',
      uniqueUrls:new Set(tasks.map(r=>r.url)).size,domains:new Set(tasks.map(r=>r.domain)).size,
      latestRun:archive.runs.find(r=>r.cohort===cohort&&r.protocol_version===archive.protocol_version)||null,
      lastCompleted:archive.runs.find(r=>r.cohort===cohort&&r.protocol_version===archive.protocol_version&&r.status==='completed'&&!r.exclusion)||null,
      tasks:tasks.length,count:subset.length,categories:new Set(subset.map(r=>r.category)).size,
      first:dates.length?new Date(Math.min(...dates)).toISOString():null,
      last:dates.length?new Date(Math.max(...dates)).toISOString():null,
      comparisons:Object.fromEntries(['resolved','single_source','no_useful_output','incomplete','unresolved','pending_budget','dispatched','pending'].map(status=>[status,tasks.filter(r=>(r.output_comparison?.status||'pending')===status).length])),
      references:tasks.filter(r=>r.reference?.status==='eligible').length,
      rows:providers.map(p=>{const own=subset.filter(r=>r.provider===p.id);return {...p,...summarize(subset,p.id),unresolvedCauses:Object.fromEntries([...new Set(own.filter(r=>r.success===null).map(r=>r.judgment_status))].map(status=>[status,own.filter(r=>r.success===null&&r.judgment_status===status).length])),freshness:{requested:own.filter(r=>r.freshness?.requested).length,reportedFresh:own.filter(r=>r.freshness?.evidence==='fresh_reported').length,reportedCached:own.filter(r=>r.freshness?.evidence==='cached_reported').length,unreported:own.filter(r=>r.freshness?.evidence==='unreported').length}};}),
      pageTypes:[...new Set(subset.map(r=>r.category))].map(id=>({id,results:Object.fromEntries(providers.map(p=>{const s=summarize(subset.filter(r=>r.category===id),p.id);return [p.id,{rate:s.rate,success:s.success,count:s.count}];}))})),
      pairs:providers.flatMap((a,i)=>providers.slice(i+1).map(b=>({a,b,...paired(subset,a.id,b.id)}))),
    };
  }
  const receipts=archive.discovery?.receipts||[];
  const version=createHash('sha256').update('account-health-v1:pricing-v2:').update(JSON.stringify(archive)).digest('hex').slice(0,24);
  const summary={schema_version:2,version,generated_at:archive.generated_at,protocol_version:archive.protocol_version,
    providers,categories:archive.categories,cohorts,
    runs:archive.runs.filter(r=>r.protocol_version===archive.protocol_version).slice(0,12).map(({id,started_at,finished_at,status,cohort,selected_count,manifest_url,exclusion})=>({id,started_at,finished_at,status,cohort,selected_count,manifest_url,exclusion})),
    operations:{last_tick:archive.operations?.last_tick,scheduler_status:archive.operations?.scheduler_status,next_run_at:archive.operations?.next_run_at,collection_profile:archive.operations?.collection_profile,capacity_plan:archive.operations?.capacity_plan},
    metrics:{daily:(archive.metrics?.daily||[]).map(({day,cohort,provider,success_rate,pages,sample_kind})=>({day,cohort,provider,success_rate,pages,sample_kind}))},
    supply:archive.supply,sourceHealth:{healthy:receipts.filter(r=>r.status==='ok').length,total:receipts.length}};
  return {summary,records};
}

/** @param {import('./types').Observation} record @param {ReturnType<typeof publication>['summary']} summary */
export function searchable(record,summary) {
  return [record.title,record.url,record.final_url,record.task_id,record.source_id,record.organization,record.domain,
    summary.categories.find(c=>c.id===record.category)?.label||human(record.category),
    summary.providers.find(p=>p.id===record.provider)?.name||human(record.provider)].join('\n').toLowerCase();
}

/** @param {import('./types').Observation} record */
export function listing(record) {
  const keys=['id','title','url','task_id','run_id','domain','source_id','category','provider','outcome','content_label','identity_label','judgment_status','success','elapsed_ms','text_chars'];
  return Object.fromEntries(keys.map(key=>[key,record[key]]));
}

/** @param {URL} url */
export function parameters(url) {
  const cohort=url.searchParams.get('cohort')||'independent';
  const provider=url.searchParams.get('provider')||'all';
  const q=(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,200);
  const page=Number(url.searchParams.get('page')||0);
  if(!['independent','needle'].includes(cohort)||!Number.isSafeInteger(page)||page<0||page>100000)throw Object.assign(new Error('Invalid page or cohort'),{status:400});
  return {cohort,provider,q,page,version:url.searchParams.get('version')};
}
