// End-to-end proof against the explicitly synthetic, uneven-category fixture from
// verify-daily-sample.py. Never publish this fixture as benchmark measurements.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const origin=process.env.TRACE_ORIGIN||'http://127.0.0.1:8796';
const folder='artifacts/daily-controls',session='trace-daily-sample-proof',checks=[];
const command=(...args)=>execFileSync('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:35000});
const evaluate=source=>JSON.parse(execFileSync('agent-browser',['--session',session,'--json','eval','--stdin'],{input:source,encoding:'utf8',timeout:35000})).data.result;
function check(name,ok){checks.push({name,passed:Boolean(ok)});assert.ok(ok,name);}
try {
 const data=await (await fetch(origin+'/api/summary')).json();
 check('New pages use equal category weights',data.cohorts['independent:new'].rows.every(r=>r.rate===.125&&r.count===10));
 check('Control score remains separate',data.cohorts['independent:control'].rows.every(r=>r.rate===1&&r.count===8));
 command('set','viewport','1280','1000');command('open',origin+'/#quality');command('wait','--text','New pages · 10');
 check('Leaderboard shows weighted quality',evaluate('document.querySelector(".score").textContent')==='12.5%');
 check('Cost plot uses the same weighted quality',evaluate('document.querySelector(".value-point").getAttribute("aria-label").includes("12.5%")'));
 command('find','role','button','click','--name','Control pages · 8');
 check('Controls update score and denominator',evaluate('document.querySelector(".score").textContent=== "100.0%" && document.querySelector("#collection-summary").textContent.includes("8 unique URLs")'));
 check('Control history identifies panel version',evaluate('document.querySelector(".quality-history").textContent.includes("Panel ")'));
 command('find','role','button','click','--name','New pages · 10');
 check('New history uses weighted score',evaluate('document.querySelector(".history-reading").textContent.includes("12.5%")'));
 for(const width of [1280,390,320]){
  command('set','viewport',String(width),width===1280?'1000':'844');
  evaluate("document.querySelector('#quality').scrollIntoView({block:'start'})");
  check(`Fits ${width}px`,evaluate('document.documentElement.scrollWidth<=innerWidth'));
  command('screenshot',`${folder}/fixture-${width}.png`);
 }
 command('scrollintoview','#runs');
 check('Shortages appear separately for each role',evaluate('document.querySelector(".run-sample-detail").textContent.includes("Short:")'));
 command('screenshot',`${folder}/fixture-run-details.png`);
 const manifest=await (await fetch(origin+'/'+data.runs[0].manifest_url)).json();
 check('Auditable manifest tags all pages',manifest.tasks.every(t=>['new','control'].includes(t.sample_role)));
} finally {
 await fs.writeFile(folder+'/browser-verification.json',JSON.stringify({syntheticFixture:true,origin,checks},null,2));
 command('close');
}
console.log(JSON.stringify({passed:true,checks:checks.length}));
