// End-to-end contracts established before implementation: no archive download
// on initial load; exact rankings; bounded pages; stable publication versions;
// correct filters; on-demand evidence; fresh publications; cached 304s; no secrets.
import fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { summarize, paired } from '../src/model.js';
const origin=process.env.TRACE_DASHBOARD_URL||'http://127.0.0.1:8795';
const checks=[];
function check(name,pass){checks.push({name,pass:!!pass});if(!pass)throw new Error(name);}
try {
 const archive=await (await fetch(origin+'/data/latest.json')).json();
 const response=await fetch(origin+'/api/summary');
 check('Summary endpoint exists',response.ok);
 const summary=await response.json();
 check('Summary excludes full records',!('records' in summary));
 check('Summary is over 100 times smaller',JSON.stringify(summary).length<JSON.stringify(archive).length/100);
 const eligible=archive.records.filter(r=>r.protocol_version===archive.protocol_version&&!r.run_exclusion&&archive.runs.some(run=>run.id===r.run_id&&run.status==='completed'));
 const latestDaily=Object.fromEntries(['independent','needle'].map(cohort=>[cohort,archive.runs.find(r=>r.cohort===cohort&&r.protocol_version===archive.protocol_version&&r.status==='completed'&&!r.exclusion&&r.collection_profile?.cadence==='daily')?.id]));
 const valid=eligible.filter(r=>!latestDaily[r.cohort]||r.run_id===latestDaily[r.cohort]);
 for(const [cohort,group] of Object.entries(summary.cohorts)) {
  const [baseCohort,role]=cohort.split(':');
  const rows=valid.filter(r=>r.cohort===baseCohort&&(!role||r.sample_role===role));
  for(const p of group.rows)check(cohort+':'+p.id+' exact statistics',isDeepStrictEqual(summarize(rows,p.id),Object.fromEntries(Object.entries(p).filter(([k])=>k in summarize(rows,p.id)))));
  if(role)continue;
  const page=await (await fetch(origin+'/api/results?'+new URLSearchParams({cohort,version:summary.version}))).json();
  check(cohort+' bounded page',page.records.length<=8&&page.total===rows.length);
  if(page.records.length){
   const record=page.records[0];
   check('List omits evidence',!('text_preview' in record)&&!('judgment' in record));
   const detail=await (await fetch(origin+'/api/result?'+new URLSearchParams({id:record.id,version:summary.version}))).json();
   check('Evidence loads on demand',isDeepStrictEqual(detail,rows.find(r=>r.id===record.id)));
  }
 }
 const empty=await (await fetch(origin+'/api/results?'+new URLSearchParams({cohort:'independent',q:'impossible-no-matches-390481',version:summary.version}))).json();
 check('Search filter',empty.total===0&&empty.records.length===0);
 const stale=await fetch(origin+'/api/results?version=not-a-current-publication');
 check('Stale versions do not mix results',stale.status===409);
 const same=await fetch(origin+'/api/summary',{headers:{'If-None-Match':response.headers.get('etag')}});
 check('Unchanged summary is 304',same.status===304);
 const html=await (await fetch(origin+'/')).text();
 check('Leaderboard present without JavaScript',html.includes('Provider content results')&&html.includes('trace-summary')&&html.includes('Exa'));
 check('No credentials in HTML',!html.includes('postgresql://')&&!html.includes('ctxt_secret_'));
 await fs.mkdir('artifacts/fast-dashboard',{recursive:true});
 await fs.writeFile('artifacts/fast-dashboard/contracts.json',JSON.stringify({passed:true,checks,summaryBytes:JSON.stringify(summary).length,archiveBytes:JSON.stringify(archive).length},null,2));
 console.log(JSON.stringify({passed:true,checks:checks.length}));
} catch(error){await fs.mkdir('artifacts/fast-dashboard',{recursive:true});await fs.writeFile('artifacts/fast-dashboard/contracts.json',JSON.stringify({passed:false,checks,error:error.message},null,2));throw error;}
