import {finite,taskKey} from './model.js';

function charge(record,provider) {
  if(!record?.started_at||record.outcome==='harness_error')return null;
  if(provider==='exa'&&finite(record.cost_usd)&&record.cost_usd>=0)return {low:record.cost_usd*1000,high:record.cost_usd*1000,kind:'estimated'};
  if(provider!=='exa'&&finite(record.credits)&&record.credits>=0)return {low:record.credits,high:record.credits,kind:'reported'};
  if(provider==='firecrawl'){
    let host;try{host=new URL(record.url).hostname;}catch{return null;}
    if(/(^|\.)(x\.com|twitter\.com|linkedin\.com)$/.test(host))return null;
    if(record.api_status>=400&&record.text_chars===0)return {low:0,high:0,kind:'documented'};
  }
  if(record.outcome==='returned'&&record.api_status>=200&&record.api_status<300)return {low:1,high:1,kind:'modeled'};
  if(provider==='context'&&record.origin_status===404)return {low:1,high:1,kind:'documented'};
  // Missing usage is a zero-to-base-charge scenario, not an invoice guarantee.
  return {low:0,high:1,kind:'unknown'};
}

export function billingSummary(records,provider,balanced=false) {
  const tasks=[...new Map(records.map(r=>[taskKey(r),r])).values()];
  const own=new Map(records.filter(r=>r.provider===provider).map(r=>[taskKey(r),r]));
  const groups=new Map();
  const result={low:null,high:null,reported:0,estimated:0,documented:0,modeled:0,unknown:0,unavailable:0,count:tasks.length};
  for(const task of tasks){
    const value=charge(own.get(taskKey(task)),provider);
    if(!value){result.unavailable++;continue;}
    result[value.kind]++;
    const key=balanced?task.category:'all';
    const group=groups.get(key)||{low:0,high:0,count:0};
    group.low+=value.low;group.high+=value.high;group.count++;groups.set(key,group);
  }
  if(tasks.length&&!result.unavailable){
    result.low=[...groups.values()].reduce((sum,g)=>sum+g.low/g.count,0)/groups.size;
    result.high=[...groups.values()].reduce((sum,g)=>sum+g.high/g.count,0)/groups.size;
  }
  return result;
}
