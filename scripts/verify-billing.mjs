// Failure cases: zero usage lost, billed error pages treated as free, timeouts
// treated as free, account blocks discounted, missing providers discounted,
// category weights mismatched, subscription minima lost, special tariffs guessed,
// incomplete billing presented as an invoice, and absent judgments priced as useful.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {billingSummary} from '../src/billing.js';
import {priceRows,DEFAULT_PRICING} from '../src/pricing-data.js';
const checks=[];
function check(name,condition){checks.push({name,passed:!!condition});assert.ok(condition,name);}
const record=(provider,extra={})=>({provider,run_id:'r',task_id:'1',category:'news',started_at:'2026-10-14',outcome:'returned',api_status:200,text_chars:100,success:false,url:'https://example.com/',...extra});
const summarize=(p,extra={})=>billingSummary([record(p,extra)],p);
check('Explicit zero credit takes precedence over returned content',summarize('context',{credits:0}).low===0);
check('Billed 404 remains billed despite failed quality',summarize('context',{credits:1,origin_status:404}).low===1);
check('Explicit zero Exa cost is retained',summarize('exa',{cost_usd:0}).high===0);
check('Exa response USD is an estimate',summarize('exa',{cost_usd:.001}).estimated===1);
check('Firecrawl billed error page is not free',summarize('firecrawl',{credits:1,outcome:'provider_error',origin_status:403}).low===1);
check('Firecrawl response with no document is uncharged',summarize('firecrawl',{api_status:429,outcome:'provider_error',text_chars:0,error_code:'HTTP_429'}).high===0);
check('Client timeout has uncertain billing',summarize('firecrawl',{api_status:null,outcome:'provider_error',error_code:'CLIENT_DEADLINE',text_chars:0}).unknown===1);
check('Unknown Keenable failure spans zero to base charge',summarize('keenable',{api_status:500,outcome:'provider_error',text_chars:0}).low===0&&summarize('keenable',{api_status:500,outcome:'provider_error',text_chars:0}).high===1);
check('Successful Keenable standard fetch uses verified account base rate',summarize('keenable').low===1&&summarize('keenable').modeled===1);
check('Account block suppresses extrapolation',summarize('context',{outcome:'harness_error',api_status:402}).high===null);
check('Missing attempts suppress extrapolation',billingSummary([record('exa')],'context').high===null);
check('Special Firecrawl URL without usage does not invent a tariff',summarize('firecrawl',{url:'https://x.com/example/status/1'}).high===null);
check('Special URL with explicit receipt is usable',summarize('firecrawl',{url:'https://x.com/example/status/1',credits:5}).high===5);
const records=[record('context',{task_id:'1',credits:0}),record('context',{task_id:'2',credits:0}),record('context',{task_id:'3',category:'jobs',credits:1})];
check('Balanced billing uses equal category weights',billingSummary(records,'context',true).low===.5);
check('Unbalanced billing uses the actual page mix',billingSummary(records,'context').low===1/3);
const row={id:'context',count:100,success:50,unknown:0,billing:{low:.5,high:.5,unknown:0}};
check('Subscription minimum survives uncharged failures',priceRows([row],DEFAULT_PRICING)[0].quote.monthly===99);
const small={...DEFAULT_PRICING,monthlyPages:10000};
check('Automatic plan uses billable volume and preserves whole blocks',priceRows([row],small)[0].quote.monthly===19&&priceRows([row],small)[0].plan.name==='Developer');
const uncertain={...row,billing:{low:0,high:1,unknown:50}};
check('Price range uses the same selected plan at both ends',priceRows([uncertain],DEFAULT_PRICING)[0].quoteLow.monthly===99);
check('Billing and judgment uncertainty both affect useful-price range',priceRows([{...row,unknown:10,billing:{low:.5,high:1,unknown:50}}],small)[0].usefulPriceLow<priceRows([{...row,unknown:10,billing:{low:.5,high:1,unknown:50}}],small)[0].usefulPrice);
check('Incomplete sample is not presented as cheap',priceRows([{...row,billing:{low:null,high:null}}],DEFAULT_PRICING)[0].comparisonPrice===null);
check('Zero useful results have no useful-cost estimate',priceRows([{...row,success:0}],DEFAULT_PRICING)[0].usefulPrice===null);
await fs.mkdir('artifacts/billing-comparison',{recursive:true});
await fs.writeFile('artifacts/billing-comparison/billing-verification.json',JSON.stringify({passed:true,checks},null,2));
console.log(JSON.stringify({passed:true,checks:checks.length}));
