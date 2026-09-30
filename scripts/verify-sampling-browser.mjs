// E2E proof: real export → summary API → responsive run history → saved evidence.
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const origin=process.env.TRACE_ORIGIN||'http://127.0.0.1:8796';
const folder=process.env.TRACE_ARTIFACT_DIR||'artifacts/sampling';
const session=`sampling-proof-${process.pid}`;
const checks=[];
const command=(...args)=>execFileSync('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:35000});
const evaluate=source=>JSON.parse(execFileSync('agent-browser',['--session',session,'--json','eval','--stdin'],{input:source,encoding:'utf8',timeout:35000})).data.result;
function check(name,condition){checks.push({name,passed:Boolean(condition)});assert.ok(condition,name);}
await fs.mkdir(folder,{recursive:true});
const summary=await (await fetch(`${origin}/api/summary`)).json();
const original=summary.runs.find(r=>r.sampling?.kind==='daily_selection');
const rerun=summary.runs.find(r=>r.cohort==='independent'&&r.sampling?.kind==='rerun');
try {
 check('Run counts partition every selection',summary.runs.every(r=>r.sampling.first_time_urls+r.sampling.repeated_urls===r.selected_count));
 check('Publication ages partition every selection',summary.runs.every(r=>Object.values(r.sampling.publication_age).reduce((a,b)=>a+b,0)===r.selected_count));
 check('Daily targets remain balanced',Object.values(original.sampling.categories).every(c=>c.target===375&&c.shortfall===Math.max(0,375-c.selected)));
 const manifest=await (await fetch(`${origin}/${rerun.manifest_url}`)).json();
 check('Downloaded manifest agrees with summary',JSON.stringify(manifest.sampling)===JSON.stringify(rerun.sampling));
 check('All-run ledger is available',(await fetch(`${origin}/data/run-sampling.json`)).ok);
 check('Daily discovery download is available',(await fetch(`${origin}/data/replenishment.json`)).ok);
 command('set','viewport','1280','1000');command('open',`${origin}/#runs`);command('wait','--text','Run samples');command('snapshot','-i','-s','#runs');
 check('Selected rerun is explicitly identified',evaluate("document.querySelector('.run-sample-detail').textContent.includes('not a fresh-supply run')"));
 const index=summary.runs.findIndex(r=>r.id===original.id);
 command('focus','[aria-label="Run sample history"]');command('press','Control+Home');
 for(let i=0;i<index;i++)command('press','ArrowDown');
 command('press','Enter');
 check('Keyboard selects original category breakdown',evaluate("document.querySelector('.run-sample-detail h4').textContent.includes('Daily selection')"));
 check('Publication age is visible',evaluate("document.querySelector('.run-sample-detail').textContent.includes('Publication age at run start')"));
 check('Eight category rows shown',evaluate("document.querySelectorAll('[aria-label=\"Selected run categories\"] tbody tr').length===8"));
 for(const width of [1280,390,320]){
   command('set','viewport',String(width),width===1280?'1000':'844');
   evaluate("document.querySelector('#runs').scrollIntoView({block:'start'})");
   check(`Page fits ${width}px`,evaluate('document.documentElement.scrollWidth<=innerWidth'));
   check(`Run table fits ${width}px`,evaluate("document.querySelector('.sampling-history-table').getBoundingClientRect().right<=innerWidth"));
   command('screenshot',`${folder}/${width===1280?'desktop-after':width===390?'mobile-after':'mobile-320'}.png`);
 }
 evaluate("document.querySelector('.run-sample-detail').scrollIntoView({block:'start'})");
 command('screenshot',`${folder}/category-detail.png`);
 evaluate("document.querySelector('.replenishment').scrollIntoView({block:'start'})");
 check('Initial stock is separate from new arrivals',evaluate("document.querySelector('.replenishment').textContent.includes('Initial inventory')"));
 command('screenshot',`${folder}/supply-after.png`);
}finally{
 await fs.writeFile(`${folder}/browser-verification.json`,JSON.stringify({origin,checks},null,2));command('close');
}
console.log(JSON.stringify({passed:true,checks:checks.length,origin}));
