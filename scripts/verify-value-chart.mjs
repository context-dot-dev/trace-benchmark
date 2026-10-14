// Browser E2E: plan/billing changes must move costs without changing measured
// quality; unknown tariffs must never plot at zero; mobile and keyboard work.
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const origin=process.env.TRACE_ORIGIN||'https://trace.2.28.61.111.sslip.io';
const summaryResponse=await fetch(`${origin}/api/summary`);
assert.ok(summaryResponse.ok,'Live summary is available');
const summary=await summaryResponse.json();
const searchCount=summary.cohorts.needle.rows.find(row=>row.id==='exa').count;
const session=`trace-value-verify-${process.pid}`;
const folder=process.env.TRACE_ARTIFACT_DIR||'artifacts/value-chart';
const checks=[];
const layoutObservations=[];
let completed=false;
function command(...args){return execFileSync('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:35000});}
function evaluate(source){return JSON.parse(execFileSync('agent-browser',['--session',session,'--json','eval','--stdin'],{input:source,encoding:'utf8',timeout:35000})).data.result;}
function check(name,condition){checks.push({name,passed:Boolean(condition)});assert.ok(condition,name);}
const points=()=>evaluate("[...document.querySelectorAll('.value-point')].map(p=>({id:p.dataset.provider,label:p.getAttribute('aria-label')}))");
const provider=(items,id)=>items.find(p=>p.id===id)?.label;
await fs.mkdir(folder,{recursive:true});
try {
 command('set','viewport','1280','1000');
 command('open',`${origin}/?review=value-e2e-${Date.now()}#pricing`);
 command('wait','--text','Quality vs. cost');
 command('snapshot','-i','-s','#pricing');
 const initial=points();
 check('All four verified providers are plotted',initial.length===4&&provider(initial,'keenable').includes('$4.000'));
 check('Chart is the next section after results',evaluate("document.querySelector('#quality').nextElementSibling.id==='pricing'"));
 check('Navigation links directly to the plot',evaluate("!!document.querySelector('.article-nav a[href=\"#pricing\"]')"));
 check('Each point shows quality and price without hovering',evaluate("[...document.querySelectorAll('.value-point')].every(p=>p.querySelector('.value-label-metrics')?.textContent.includes('%'))"));
 check('Default has no manual provider plans',evaluate("!document.querySelector('[aria-label=\"Context pricing plan\"]')&&!document.querySelector('[aria-label=\"Cost calculation\"]')"));
 check('Matched comparison is explicit',evaluate("document.querySelector('#pricing').textContent.includes('Lowest-cost plans for the same workload')"));
 check('Default covers the full workload cost',provider(initial,'context').includes('$1.065')&&provider(initial,'context').includes('Pro'));
 command('click','[aria-label="Pricing billing period"] button:nth-child(2)');
 const annual=points();
 check('Annual commitment moves the cost coordinate',provider(annual,'context').includes('$0.887'));
 command('click','[aria-label="Monthly page volume"] button:nth-child(3)');
 const million=points();
 check('Higher volume picks covering paid plans',provider(million,'context').includes('Scale')&&provider(million,'firecrawl').includes('Scale'));
 check('Exact annual totals determine prices',provider(million,'firecrawl').includes('$0.599')&&provider(million,'context').includes('$0.416'));
 command('click','[aria-label="Monthly page volume"] button:nth-child(2)');
 command('find','role','button','click','--name','Custom scenario','--exact');
 check('Custom mode is labeled above the chart',evaluate("document.querySelector('#pricing').textContent.includes('Custom scenario: prices reflect your selected plans')"));
 command('click','[aria-label="Cost calculation"] button:nth-child(2)');
 const allowance=points();
 check('Full allowance has a distinct basis',provider(allowance,'context').includes('$0.660'));
 check('Price controls never change measured quality',allowance.every(p=>p.label.split(' useful content')[0]===provider(initial,p.id).split(' useful content')[0]));
 command('click','[aria-label="Context pricing plan"] button:nth-child(4)');
 check('Manual plan choice moves its point',provider(points(),'context').includes('$0.416'));
 command('click','[data-provider="firecrawl"]');
 check('Tap reveals provider detail',evaluate("document.querySelector('.value-reading').textContent.includes('Firecrawl')"));
 command('focus','[data-provider="exa"]');command('press','Enter');
 check('Keyboard focus reveals provider detail',evaluate("document.querySelector('.value-reading').textContent.includes('Exa')"));
 command('find','role','button','click','--name','Search-discovered pages');
 check('Chart follows the selected page set',evaluate(`document.querySelector('.value-reading').textContent.includes(${JSON.stringify(`/ ${searchCount.toLocaleString('en-US')} pages`)})`));
 command('find','role','button','click','--name','Independent pages');
 command('click','[aria-label="Pricing billing period"] button:nth-child(1)');
 command('find','role','button','click','--name','Lowest-cost plans','--exact');
 check('Returning to matched mode resets the basis and plans',provider(points(),'context').includes('$1.065')&&provider(points(),'context').includes('Pro')&&evaluate("!document.querySelector('[aria-label=\"Context pricing plan\"]')"));
 command('click','[aria-label="Monthly page volume"] button:nth-child(1)');
 check('Small monthly workload includes whole top-up blocks',provider(points(),'context').includes('$2.560')&&provider(points(),'firecrawl').includes('$4.400'));
 command('click','[aria-label="Pricing billing period"] button:nth-child(2)');
 check('Small annual workload is recalculated for both subscriptions',provider(points(),'context').includes('$2.243')&&provider(points(),'firecrawl').includes('$4.083'));
 command('click','[aria-label="Monthly page volume"] button:nth-child(2)');
 command('click','[aria-label="Pricing billing period"] button:nth-child(1)');
 check('Appendix agrees with the headline comparison',evaluate("document.querySelector('[aria-label=\"Selected plan monthly budgets\"]').textContent.includes('$1.065')&&!document.querySelector('[aria-label=\"Selected plan monthly budgets\"]').textContent.includes('$299.00')"));
 for(const width of [1280,390,320]){
   command('set','viewport',String(width),width===1280?'1000':'844');
   command('wait','--fn',`Math.abs(document.querySelector('.value-chart svg').viewBox.baseVal.width-document.querySelector('.value-chart').clientWidth)<2`);
   evaluate("document.querySelector('#pricing').scrollIntoView({block:'start'})");
   const layout=evaluate("({viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,pricingRight:document.querySelector('#pricing').getBoundingClientRect().right,pricingWidth:document.querySelector('#pricing').clientWidth,pricingScrollWidth:document.querySelector('#pricing').scrollWidth})");
   layoutObservations.push(layout);
   check(`Pricing fits at ${width}px`,layout.pricingRight<=layout.viewport&&layout.pricingScrollWidth<=layout.pricingWidth);
   check(`Provider labels fit at ${width}px`,evaluate("[...document.querySelectorAll('.value-label-bg')].every(e=>{const b=e.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth})"));
   command('screenshot',`${folder}/e2e-${width}.png`);
 }
 command('find','role','button','click','--name','Dark appearance');
 evaluate("document.querySelector('#pricing').scrollIntoView({block:'start'})");
 check('Dark appearance keeps chart readable',evaluate("document.documentElement.classList.contains('dark')&&getComputedStyle(document.querySelector('.value-label')).fill!==getComputedStyle(document.querySelector('.value-label-bg')).fill"));
 command('screenshot',`${folder}/dark-mobile.png`);
 completed=true;
} finally {
 await fs.writeFile(`${folder}/browser-verification.json`,JSON.stringify({passed:completed&&checks.length>0&&checks.every(c=>c.passed),at:new Date().toISOString(),origin,checks,layoutObservations},null,2));
 command('close');
}
console.log(JSON.stringify({passed:true,checks:checks.length,origin}));
