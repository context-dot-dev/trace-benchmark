export const DEFAULT_PRICING = {billing:'monthly', plans:{context:'Scale', firecrawl:'Scale', exa:'Pay as you go', keenable:'Live fetch'}};
export const MONTHLY_PAGES = 3000 * 31;
export const PRICING = [
  {
    id: 'context', name: 'Context', checked: '2026-09-30',
    source: 'https://www.context.dev/pricing', endpoint: 'Markdown scrape · maxAgeMs=0 · 1 base credit/page',
    billingSource: 'https://docs.context.dev/api-reference/web-scraping/scrape',
    notes: 'Current new-subscription prices. Annual billing saves two months on the base subscription. Overage is purchased in 1,000-credit blocks; auto top-up must be enabled. Most failures are unbilled, but 404 responses are billed. Browser actions and extra output formats cost more. Existing accounts may retain older rates and limits.',
    plans: [
      {name:'Free', monthly:0, included:1000, concurrency:1},
      {name:'Developer', monthly:19, annual:190, included:7500, block:1000, blockUsd:2.2, concurrency:10},
      {name:'Pro', monthly:99, annual:990, included:125000, block:1000, blockUsd:1.8, concurrency:100},
      {name:'Growth', monthly:299, annual:2990, included:500000, block:1000, blockUsd:1.4, concurrency:250},
      {name:'Scale', monthly:499, annual:4990, included:1000000, block:1000, blockUsd:1, concurrency:500},
      {name:'Enterprise', custom:true},
    ],
  },
  {
    id: 'firecrawl', name: 'Firecrawl', checked: '2026-09-30',
    source: 'https://www.firecrawl.dev/pricing.md', endpoint: 'Markdown scrape · maxAge=0 · parsers=[] · 1 base credit/page',
    billingSource: 'https://docs.firecrawl.dev/billing',
    notes: 'Annual commitments use the exact published totals, not rounded monthly labels. Allowances renew monthly; Scale has one month of rollover. Extra credits come in $5 blocks and require pay-as-you-go to be enabled. Returned 403/404 pages still cost a credit; a scrape with no result is uncharged. Enhanced proxy escalation has no surcharge. PDF parsing is disabled in this benchmark. X/Twitter URLs have separate billing. Extra formats and PDF parsing can cost more. Concurrency is concurrent browsers; request rate limits also apply.',
    plans: [
      {name:'Free', monthly:0, included:1000, concurrency:2, rpm:10},
      {name:'Hobby', monthly:19, annual:190, included:5000, block:1000, blockUsd:5, concurrency:5, rpm:100},
      {name:'Standard', monthly:99, annual:990, included:100000, block:2000, blockUsd:5, concurrency:25, rpm:500},
      {name:'Growth', monthly:399, annual:3990, included:500000, block:2500, blockUsd:5, concurrency:50, rpm:5000},
      {name:'Scale', monthly:749, annual:7190, included:1000000, block:5000, blockUsd:5, concurrency:100, rpm:10000},
      {name:'Enterprise', custom:true},
    ],
  },
  {
    id: 'exa', name: 'Exa', checked: '2026-09-30',
    source: 'https://exa.ai/docs/admin/pricing', endpoint: '/contents · text only · maxAgeHours=0',
    notes: 'Text content is $1 per 1,000 pages, with no subscription minimum. Each additional content type is billed separately. Published $10 monthly free credits and the onboarding bonus depend on account eligibility and shared usage; they are not deducted from this gross comparison. Enterprise discounts are custom. These are Contents prices, not Search prices.',
    plans: [{name:'Pay as you go', perThousand:1}, {name:'Enterprise', custom:true}],
  },
  {
    id: 'keenable', name: 'Keenable', checked: '2026-09-30',
    source: 'https://docs.keenable.ai/credits', endpoint: '/fetch · live=true · fetch.live SKU',
    notes: 'The docs advertise a shared monthly allowance of 100,000 requests, but live fetch has a distinct SKU and organization-specific credit pricing. A public USD tariff for this mode is not established. Search-tier prices and the ordinary-fetch allowance cannot establish its live-fetch cost. This collector has no verified HTTP billing receipt; an account-specific live-fetch tariff is needed.',
    plans: [{name:'Live fetch', custom:true}],
  },
];

export function quotePlan(plan, billing, pages = MONTHLY_PAGES) {
  if (!['monthly','annual'].includes(billing) || !Number.isSafeInteger(pages) || pages < 0) throw new Error('Invalid pricing scenario');
  if (plan.custom) return {monthly:null, commitment:null, extra:null, reason:'Quote required'};
  if (Number.isFinite(plan.perThousand)) return {monthly:pages*plan.perThousand/1000, commitment:null, extra:0, reason:null};
  const commitment=billing==='annual' && plan.annual ? plan.annual : null;
  const base=commitment===null?plan.monthly:commitment/12;
  const excess=Math.max(0,pages-plan.included);
  if(excess && !plan.block) return {monthly:null,commitment,extra:null,reason:'Allowance exceeded'};
  const extra=excess?Math.ceil(excess/plan.block)*Math.round(plan.blockUsd*100)/100:0;
  return {monthly:base+extra,commitment,extra,reason:null};
}

export function bestPlan(provider,billing,pages=MONTHLY_PAGES) {
  return provider.plans.map(plan=>({plan,...quotePlan(plan,billing,pages)}))
    .filter(q=>q.monthly!==null).sort((a,b)=>a.monthly-b.monthly)[0]||null;
}

export function planRate(plan,billing) {
  if (!['monthly','annual'].includes(billing)) throw new Error('Invalid billing period');
  if (plan.custom || plan.monthly === 0) return null;
  if (Number.isFinite(plan.perThousand)) return plan.perThousand;
  const base=billing==='annual'&&plan.annual?plan.annual/12:plan.monthly;
  return base*1000/plan.included;
}

export function priceRows(rows,scenario) {
  return PRICING.map(provider=>{
    const plan=provider.plans.find(p=>p.name===scenario.plans[provider.id]);
    if (!plan) throw new Error(`Unknown pricing plan for ${provider.id}`);
    const observed=rows.find(row=>row.id===provider.id);
    const unitPrice=planRate(plan,scenario.billing);
    const resolved=observed?.count>0 && observed.success>0 && observed.unknown===0;
    return {...provider,plan,unitPrice,quote:quotePlan(plan,scenario.billing),
      usefulPrice:unitPrice!==null&&resolved?unitPrice/(observed.success/observed.count):null};
  });
}
