import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {summarize} from '../src/model.js';
const checks=[];
function check(name,pass){assert.ok(pass,name);checks.push(name);}
const record=(task,extra)=>({provider:'firecrawl',run_id:'run',task_id:task,started_at:'2026-09-30T00:00:00Z',success:null,outcome:'returned',...extra});
const records=[record('good',{success:true}),record('blocked',{outcome:'harness_error',api_status:402}),record('skipped',{outcome:'harness_error',started_at:null,error_code:'account_blocked_not_attempted'}),record('origin-error',{outcome:'provider_error',api_status:403,success:false})];
const row={id:'firecrawl',name:'Firecrawl',...summarize(records,'firecrawl')};
check('Account rejected and skipped are separately counted',row.accountRejected===1&&row.accountSkipped===1&&row.accountAffected===2);
check('Skipped request is not an API attempt',row.attempted===3);
check('Attempted diagnostic includes real provider failures',row.measuredAttempts===2&&row.attemptedUsefulRate===0.5);
check('All-page denominator and unknowns are preserved',row.count===4&&row.rate===0.25&&row.unknown===2);
check('All blocked has no invented attempted quality',summarize(records.slice(1,3),'firecrawl').attemptedUsefulRate===null);
check('Provider errors are not relabeled as account issues',summarize([records[3]],'firecrawl').accountAffected===0);
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {AccountIssues}=await server.ssrLoadModule('/src/live-comparisons.jsx');
 const {QualityTable}=await server.ssrLoadModule('/src/benchmark-tables.jsx');
 const note=renderToStaticMarkup(React.createElement(AccountIssues,{rows:[row]}));
 check('Account fault is explicit beside the leaderboard',note.includes('credits exhausted')&&note.includes('skipped')&&note.includes('not a replacement'));
 const table=renderToStaticMarkup(React.createElement(QualityTable,{rows:[row],sort:'rate',ascending:false,onSort:()=>{},onProvider:()=>{},loading:false}));
 check('Affected row is labeled incomplete without rewriting results',table.includes('Incomplete')&&table.includes('25.0%')&&table.includes('1 / 4'));
 check('Healthy cohort has no account warning',renderToStaticMarkup(React.createElement(AccountIssues,{rows:[{...row,accountAffected:0}]}))==='');
 if(process.env.TRACE_ORIGIN){
  const s=await(await fetch(process.env.TRACE_ORIGIN+'/api/summary')).json();const r=s.cohorts.independent.rows.find(r=>r.id==='firecrawl');
  check('Saved daily run retains 3000-page denominator',r.count===3000&&r.success===1143&&r.accountSkipped===1622&&r.accountRejected===2);
  check('Live incomplete run exposes genuine attempted quality',r.measuredAttempts===1376&&Math.abs(r.attemptedUsefulRate-1143/1376)<1e-9);
  const html=await(await fetch(process.env.TRACE_ORIGIN+'/')).text();check('Live SSR displays account explanation',html.includes('credits exhausted')&&html.includes('Incomplete'));
 }
 await fs.mkdir('artifacts/firecrawl-audit',{recursive:true});await fs.writeFile('artifacts/firecrawl-audit/verification.json',JSON.stringify({passed:true,at:new Date().toISOString(),checks},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}finally{await server.close();}
