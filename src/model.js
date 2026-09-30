const ALLOWED_PROVIDERS = new Set(['hetzner', 'context', 'exa', 'keenable', 'firecrawl']);
const FALLBACK_COLORS = {hetzner:'#7c8796',context:'#4266db',exa:'#8970c9',keenable:'#219386',firecrawl:'#dd642d'};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const taskKey = record => JSON.stringify([record.run_id, record.task_id]);
function quantile(values, q) {
  const sorted = values.filter(finite).sort((a,b) => a-b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(q*sorted.length)-1)] : null;
}
function summarize(records, provider, universe = [...new Set(records.map(taskKey))]) {
  const own = records.filter(r => r.provider === provider);
  const byTask = new Map(own.map(r => [taskKey(r), r]));
  let success=0, failed=0, unknown=0;
  for (const key of universe) {
    const value = byTask.get(key)?.success;
    if(value === true) success++; else if(value === false) failed++; else unknown++;
  }
  const count = universe.length;
  const attempted=own.filter(r=>Boolean(r.started_at));
  const measured=attempted.filter(r=>r.outcome!=='harness_error');
  const accountRejected=own.filter(r=>r.outcome==='harness_error'&&[401,402].includes(r.api_status)).length;
  const creditsRejected=own.filter(r=>r.outcome==='harness_error'&&r.api_status===402).length;
  const accountSkipped=own.filter(r=>r.error_code==='account_blocked_not_attempted').length;
  const timing = own.filter(r => r.outcome!=='harness_error' && finite(r.elapsed_ms) && r.elapsed_ms >= 0).map(r => r.elapsed_ms / 1000);
  const usd = own.filter(r => finite(r.cost_usd) && r.cost_usd >= 0);
  const coverage=own.filter(r=>finite(r.browser_recall));
  const meanCoverage=coverage.length ? coverage.reduce((sum,r)=>sum+r.browser_recall,0)/coverage.length : null;
  const comparisons=own.filter(r=>r.output_comparison?.status==='resolved');
  const best=comparisons.filter(r=>r.output_comparison.winners.includes(provider)).length;
  const sole=own.filter(r=>r.output_comparison?.status==='single_source'&&r.output_comparison.winners.includes(provider)).length;
  const credits = own.filter(r => finite(r.credits) && r.credits >= 0);
  return {attempted:attempted.length,measuredAttempts:measured.length,
    attemptedUsefulRate:measured.length?measured.filter(r=>r.success===true).length/measured.length:null,
    accountRejected,creditsRejected,accountSkipped,accountAffected:accountRejected+accountSkipped,
    bestObserved:best,compared:comparisons.length,bestRate:comparisons.length?best/comparisons.length:null,soleUseful:sole,browserRecall:meanCoverage,referenceRate:count?coverage.length/count:null,referenceScored:coverage.length,
    costPerUseful:usd.length===count&&success&&unknown===0?usd.reduce((sum,r)=>sum+r.cost_usd,0)/success*1000:null,
    count,observed:own.length,success,failed,unknown,rate:count?success/count:null,
    upper:count?(success+unknown)/count:null,p50:quantile(timing,.5),p95:quantile(timing,.95),timed:timing.length,
    cost_usd:usd.length?usd.reduce((sum,r)=>sum+r.cost_usd,0):null,cost_known:usd.length,
    credits:credits.length?credits.reduce((sum,r)=>sum+r.credits,0):null,credits_known:credits.length};
}
function paired(records, first, second) {
  const universe=[...new Set(records.map(taskKey))];
  const map=new Map(records.map(r=>[JSON.stringify([taskKey(r),r.provider]),r.success]));
  const result={count:universe.length,both:0,first_only:0,second_only:0,neither:0,unknown:0,lower:null,upper:null};
  let low=0,high=0;
  for(const key of universe) {
    const a=map.get(JSON.stringify([key,first])),b=map.get(JSON.stringify([key,second]));
    if(typeof a!=='boolean'||typeof b!=='boolean') result.unknown++;
    else if(a&&b) result.both++; else if(a) result.first_only++; else if(b) result.second_only++; else result.neither++;
    low+=(a===true?1:0)-(b===false?0:1);
    high+=(a===false?0:1)-(b===true?1:0);
  }
  if(universe.length){result.lower=low/universe.length;result.upper=high/universe.length;}
  return result;
}
function validatePayload(value) {
  if(!value || value.schema_version!==1 || !Array.isArray(value.records) || !Array.isArray(value.providers) || !Array.isArray(value.categories) || !Array.isArray(value.runs) || (!value.run && (value.runs.length || value.records.length)) || !Number.isFinite(Date.parse(value.generated_at))) throw new Error('The result artifact has an unsupported or incomplete schema.');
  const providers=new Set();
  for(const p of value.providers) {
    if(!ALLOWED_PROVIDERS.has(p.id)||providers.has(p.id)||typeof p.name!=='string') throw new Error('Provider metadata is invalid.');
    providers.add(p.id);
  }
  const ids=new Set(),slots=new Set();
  for(const r of value.records) {
    if(typeof r.id!=='string'||typeof r.task_id!=='string'||typeof r.run_id!=='string'||!providers.has(r.provider)||ids.has(r.id)) throw new Error('An observation has an invalid identity.');
    if(r.success!==null&&r.success!==true&&r.success!==false) throw new Error('An observation is missing its explicit success or unknown label.');
    const slot=JSON.stringify([r.run_id,r.task_id,r.provider]);
    if(slots.has(slot)) throw new Error('Duplicate provider/task observations need resolution before publication.');
    ids.add(r.id);slots.add(slot);
  }
  return value;
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const human=value=>String(value??'Unavailable').replace(/_/g,' ');
const fmt=value=>finite(value)?new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(value):'Unavailable';
const pct=value=>finite(value)?`${(value*100).toFixed(1)}%`:'—';
const secs=value=>finite(value)?`${value.toFixed(2)}s`:'—';
const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC':'Unavailable';
const safeUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}};
const json=value=>JSON.stringify(value??null,null,2);
const color=p=>/^#[0-9a-f]{6}$/i.test(p?.color)?p.color:(FALLBACK_COLORS[p?.id]||'#7c8796');

export { finite, taskKey, quantile, summarize, paired, validatePayload, esc, human, fmt, pct, secs, date, safeUrl, json, color };
