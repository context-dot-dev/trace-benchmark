import fs from 'node:fs/promises';
import {PRICING,DEFAULT_PRICING,MONTHLY_PAGES,planRate,quotePlan,bestPlan} from '../src/pricing-data.js';

const money=(value,digits=2)=>value===null?'Unverified':`$${value.toFixed(digits)}`;
const catalog={schema_version:1,currency:'USD',default_scenario:DEFAULT_PRICING,
  methodology:{reference:'https://github.com/keenableai/needle/blob/main/dashboard/index.html',
    unit_price:'Base subscription / monthly included credits * 1000; annual subscription / 12 replaces base. One base credit per page. Exa text-only and Keenable account-verified live fetch are metered per page.',
    default_plan:'Lowest monthly spend among public paid plans for 93,000 base pages/month; not a throughput recommendation.',
    comparison_price:'Workload basis: subscription plus whole top-up blocks divided by selected monthly pages, times 1000. Full-allowance basis: unit_price above.',
    exclusions:'Enterprise quotes, free allowances, promotional credits, search, judging, hosting, tax, extra formats and special URL surcharges. These are modeled prices, not invoices.',
    useful_price:'Selected comparison price divided by confirmed useful pages / all selected pages. Unresolved pages stay in the denominator; the optimistic bound counts them as useful. No confirmed useful pages means unknown. Assumes one billable base page per attempt.',
    budget_pages:MONTHLY_PAGES},
  providers:PRICING.map(provider=>({...provider,plans:provider.plans.map(plan=>({...plan,
    monthly_unit_usd_per_1000:planRate(plan,'monthly'),annual_unit_usd_per_1000:planRate(plan,'annual'),
    monthly_budget:quotePlan(plan,'monthly'),annual_budget:quotePlan(plan,'annual')}))}))};
await fs.writeFile('site/pricing.json',JSON.stringify(catalog,null,2)+'\n');
const lines=[
 '# Scraping provider pricing',
 '',
 'Checked **September 30, 2026** against official sources for all four active benchmark providers. Generated from `src/pricing-data.js` by `npm run build`; the report and downloadable `pricing.json` use this same catalog.',
 '',
 '## Comparison basis',
 '',
 '[NEEDLE](https://github.com/keenableai/needle/blob/main/dashboard/index.html) maintains a dated price and plan per engine and describes its price table as the biggest self-serve tier, excluding enterprise quotes. Trace offers that full-allowance comparison and defaults to the lowest-cost paid plans for a workload of 93,000 base pages/month. The workload rate includes unused subscription capacity and whole top-up blocks. Plan selection does not establish throughput suitability. Monthly billing is the default; annual rates use exact yearly fees divided by twelve. A selected plan changes price projections, not the recorded quality or latency.',
 '',
 'The unit rate assumes the full included allowance is consumed at one base credit per page. It is not the marginal overage rate or the blended rate for an underused subscription. The graph plots confirmed useful-content rate against the selected cost basis. Providers with unknown live-fetch prices are omitted from the plot, not plotted at zero. Projected cost per confirmed useful page retains unresolved pages in the denominator and shows an optimistic bound. Published rates are rounded to three decimals; full-precision values are in the JSON. Free tiers are limited allowances, never an unlimited zero-dollar tariff.',
 '',
 '## Budget at 3,000 base pages/day',
 '',
 'At most 93,000 pages in a month; 1,095,000 in a 365-day year. These are separate lowest-spend scenarios, matching the default comparison workload. The full-allowance view remains available. Every page is assumed billable, with no opening balance, shared API usage or promotional credits. Actual failure charges and special URL charges can differ.',
 '',
 '| Provider | Covering plan | Monthly bill at 93k | Annual bill for 365 days |',
 '|---|---|---:|---:|',
 ...PRICING.map(p=>{const m=bestPlan(p,'monthly'),a=bestPlan(p,'annual');return `| ${p.name} | ${m?.plan.name||'Live fetch — quote needed'} | ${money(m?.monthly??null)} | ${money(a?(a.plan.perThousand?1095*a.plan.perThousand:a.monthly*12):null)} |`;}),
 '',
 'Context Pro and Firecrawl Standard each cost $990/year on annual billing ($1,188/year paid monthly). Exa text-only adds $1,095/year gross. Keenable live fetch adds $4,380/year gross at the verified account rate. The four-provider total is $7,455/year with annual subscriptions, or $7,851/year with monthly subscriptions. Neither total includes discovery, judging, hosting, tax or special formats. A 93k-month rate is not multiplied by twelve to price the metered providers’ 365-day year. Free monthly credits are excluded for every provider.',
 '',
 '## Plans and rates',
];
for(const p of PRICING){
 lines.push('',`### ${p.name}`,'',`${p.endpoint}. [Official pricing](${p.source}).${p.billingSource?` [Billing rules](${p.billingSource}).`:''}`,'',
 '| Plan | Monthly fee | Annual upfront | Credits/month | Monthly / 1k pages | Annual / 1k pages | Extra / 1k credits |',
 '|---|---:|---:|---:|---:|---:|---:|',
 ...p.plans.map(plan=>`| ${plan.name} | ${plan.custom?'Quote':plan.perThousand?'None':money(plan.monthly)} | ${plan.annual?money(plan.annual):'—'} | ${plan.included?.toLocaleString('en-US')||'—'} | ${plan.monthly===0?'Limited free tier':money(planRate(plan,'monthly'),3)} | ${plan.monthly===0?'Limited free tier':money(planRate(plan,'annual'),3)} | ${plan.block?money(plan.blockUsd*1000/plan.block):plan.perThousand?'Same rate':'—'} |`),
 '',p.notes);
}
lines.push('','## Reported costs and unknowns','','Provider-returned USD and credit receipts remain separate from modeled prices. Credits are not converted into an invented invoice. Reported cost per 1,000 useful pages requires USD receipts on every selected page, no unresolved judgments and at least one useful page. Missing receipts are unknown, including timeouts that may still have been billed. Partial subtotals disclose coverage. Valid zero-dollar receipts remain zero.','',
 'Exa’s eligible free balance resets to $10 monthly and onboarding can add $10 once. These shared account credits are excluded from gross rates. Context grandfathered accounts may have older prices. Firecrawl annual totals are $190/$990/$3,990/$7,190, not twelve times the rounded monthly marketing labels. Firecrawl enhanced proxies have no surcharge; PDF parsing is disabled in this adapter. Returned error documents can be billed. Keenable’s live-fetch rate was verified with the production account: one credit per live fetch and $4 per 1,000 purchased credits. Its recurring 100,000-credit free allowance is shared with other calls and excluded from the gross graph; the probe itself drew from free credits. Historical HTTP responses did not report billing metadata, so their measured USD receipts remain unknown.','');
for(const dir of ['docs/research','site/research']){
 await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(`${dir}/provider-costs-3000-daily.md`,lines.join('\n'));
}
console.log('Published pricing catalog and research from the shared plan data.');
