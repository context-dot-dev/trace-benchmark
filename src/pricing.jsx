import {Table} from '@/components/ui/heroui-table';
import {ToggleGroup,ToggleGroupItem} from '@/components/ui/toggle-group';
import {ProviderLogo} from './provider-logo';
import {finite} from './model';
import {ValueChart} from './value-chart';
import {PRICING,MONTHLY_PAGES,quotePlan,planRate,priceRows,recommendPlans} from './pricing-data';

const money=(value,digits=2)=>finite(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value):'Unknown';
const rate=value=>money(value,3);
const number=value=>value.toLocaleString('en-US');
const basePrice=(plan,billing)=>billing==='annual'&&plan.annual?plan.annual/12:plan.monthly;

export function PlanTable({provider,billing}) {
  return <div className="pricing-provider">
    <h4 className="provider-name"><ProviderLogo id={provider.id}/>{provider.name}</h4>
    <p className="micro">{provider.endpoint} · <a href={provider.source}>Official pricing</a>{provider.billingSource&&<> · <a href={provider.billingSource}>Billing rules</a></>} · Checked {provider.checked}</p>
    <Table><Table.ScrollContainer><Table.Content aria-label={`${provider.name} plans and rates`} className="comparison-table pricing-table">
      <Table.Header><Table.Column isRowHeader>Plan & commitment</Table.Column><Table.Column>Credits / mo</Table.Column><Table.Column>Base / 1k pages</Table.Column><Table.Column>Extra / 1k credits</Table.Column></Table.Header>
      <Table.Body>{provider.plans.map(plan=>{
        const quote=quotePlan(plan,billing);
        return <Table.Row key={plan.name}>
          <Table.Cell><strong>{plan.name}</strong><span className="cell-detail">{plan.custom?'Custom quote':finite(plan.perThousand)?'No subscription':`${money(basePrice(plan,billing))}/mo`}</span>
            {quote.commitment!==null&&<span className="cell-detail">{money(quote.commitment)}/year upfront</span>}
            {plan.concurrency&&<span className="cell-detail">{plan.concurrency} concurrent{plan.rpm?` · ${number(plan.rpm)} req/min`:''}</span>}
          </Table.Cell>
          <Table.Cell>{finite(plan.included)?number(plan.included):'—'}</Table.Cell>
          <Table.Cell>{plan.monthly===0?'Limited free tier':rate(planRate(plan,billing))}</Table.Cell>
          <Table.Cell>{plan.block?money(plan.blockUsd/plan.block*1000):plan.custom?'Unknown':finite(plan.perThousand)?'Same rate':'Unavailable'}{plan.block&&<span className="cell-detail">{money(plan.blockUsd)} per {number(plan.block)}-credit block</span>}</Table.Cell>
        </Table.Row>;
      })}</Table.Body>
    </Table.Content></Table.ScrollContainer></Table>
    <p className="micro">{provider.notes}</p>
  </div>;
}

export function Pricing({rows,scenario,onScenarioChange}) {
  const prices=priceRows(rows,scenario);
  const pages=scenario.monthlyPages??MONTHLY_PAGES;
  const custom=scenario.selection==='custom';
  const update=changes=>{
    const next={...scenario,...changes};
    if(next.selection!=='custom'){
      next.plans=recommendPlans(next.billing,next.monthlyPages??MONTHLY_PAGES);
      next.basis='workload';
    }
    onScenarioChange(next);
  };
  return <section id="pricing" className="pricing">
    <h2>Quality vs. cost</h2>
    <p className="section-intro">Each point is one scraper. Higher means more useful content; further left means a lower price. The best value is toward the top left.</p>
    {rows.some(r=>r.balanced)&&<p className="micro">Quality uses the selected new/control view with equal category weights. Cost per useful page projects that balanced workload; raw observed page counts may have a different mix.</p>}
    <div className="value-controls">
      <ToggleGroup variant="segmented" value={[custom?'custom':'lowest']} onValueChange={v=>v[0]&&update({selection:v[0]})} aria-label="Pricing comparison"><ToggleGroupItem value="lowest">Lowest-cost plans</ToggleGroupItem><ToggleGroupItem value="custom">Custom scenario</ToggleGroupItem></ToggleGroup>
      <ToggleGroup variant="segmented" value={[scenario.billing]} onValueChange={v=>v[0]&&update({billing:v[0]})} aria-label="Pricing billing period"><ToggleGroupItem value="monthly">Monthly billing</ToggleGroupItem><ToggleGroupItem value="annual">Annual billing</ToggleGroupItem></ToggleGroup>
      {custom&&<ToggleGroup variant="segmented" value={[scenario.basis||'workload']} onValueChange={v=>v[0]&&update({basis:v[0]})} aria-label="Cost calculation"><ToggleGroupItem value="workload">At your volume</ToggleGroupItem><ToggleGroupItem value="allowance">Full allowance</ToggleGroupItem></ToggleGroup>}
    </div>
    <div className="value-volume"><span>Pages / month</span><ToggleGroup value={[String(pages)]} onValueChange={v=>v[0]&&update({monthlyPages:Number(v[0])})} aria-label="Monthly page volume">{[10000,93000,1000000].map(n=><ToggleGroupItem key={n} value={String(n)}>{number(n)}</ToggleGroupItem>)}</ToggleGroup></div>
    <p className="micro">{custom?'Custom scenario: prices reflect your selected plans and may include unused capacity.':'Lowest-cost plans for the same workload. Each provider uses its cheapest published paid plan, including top-ups, for the selected volume and billing period.'}</p>
    <p className="micro">{scenario.basis==='allowance'?'Full-allowance rate: subscription price divided by every included credit.':'Workload rate: subscription + whole top-up blocks, divided by your volume. Includes unused capacity.'} {pages===93000?'93,000 pages = 3,000 a day in a 31-day month.':''}</p>
    <ValueChart prices={prices}/>
    {custom&&<div className="pricing-choices">{PRICING.filter(p=>p.plans.some(plan=>plan.annual)).map(provider=><div className="pricing-choice" key={provider.id}>
      <span className="provider-name"><ProviderLogo id={provider.id}/>{provider.name}</span>
      <ToggleGroup size="sm" value={[scenario.plans[provider.id]]} onValueChange={v=>v[0]&&update({plans:{...scenario.plans,[provider.id]:v[0]}})} aria-label={`${provider.name} pricing plan`}>{provider.plans.filter(plan=>plan.annual).map(plan=><ToggleGroupItem key={plan.name} value={plan.name}>{plan.name}</ToggleGroupItem>)}</ToggleGroup>
    </div>)}</div>}
    <Table><Table.ScrollContainer><Table.Content aria-label="Plan-specific scraping prices" className="comparison-table pricing-table">
      <Table.Header><Table.Column isRowHeader>Provider & plan</Table.Column><Table.Column>Cost / 1k pages</Table.Column><Table.Column>Projected / 1k useful</Table.Column></Table.Header>
      <Table.Body>{prices.map(provider=><Table.Row key={provider.id}>
        <Table.Cell><span className="provider-name"><ProviderLogo id={provider.id}/>{provider.name}</span><span className="cell-detail">{provider.plan.name}{provider.plan.annual?` · ${scenario.billing}`:''}</span><span className="cell-detail">{provider.quote.monthly===null?'Price unverified':`${money(provider.quote.monthly)}/mo`}{provider.quote.commitment!==null?` · ${money(provider.quote.commitment)} yearly upfront`:''}</span></Table.Cell>
        <Table.Cell>{rate(provider.comparisonPrice)}</Table.Cell>
        <Table.Cell>{rate(provider.usefulPrice)}{provider.unknown>0&&provider.usefulPrice!==null&&<span className="cell-detail">{provider.unknown} unresolved; as low as {rate(provider.usefulPriceLow)}</span>}{provider.comparisonPrice!==null&&provider.usefulPrice===null&&<span className="cell-detail">No confirmed useful pages yet</span>}</Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table.Content></Table.ScrollContainer></Table>
    <p className="micro">Quality = confirmed useful pages ÷ all selected pages, including failures and unresolved results. This measures content recovery, not independently verified factual accuracy. Projected useful-page cost divides the modeled price by that rate; unresolved pages can improve it. Changing pricing does not change the measured results or imply they were collected on that plan.</p>
    <p className="micro">Assumes one billable base page per attempt. Free credits, negotiated discounts and special-format charges are excluded. Keenable uses our verified account rate of $4 / 1,000 live fetches. Prices checked September 30, 2026. <a href="#pricing-details">Plans & billing evidence</a> · <a href="pricing.json" download>Download prices</a></p>
  </section>;
}

export function PricingAppendix({rows,scenario}) {
  const prices=priceRows(rows,scenario);
  const pages=scenario.monthlyPages??MONTHLY_PAGES;
  return <div id="pricing-details" className="pricing">
    <h3>Pricing methodology</h3>
    <p className="micro"><a href="https://github.com/keenableai/needle/blob/main/dashboard/index.html">NEEDLE’s pricing catalog</a> stores a price, plan and check date for each engine and describes its comparison as the biggest self-serve tier, excluding enterprise quotes. Trace offers that full-allowance comparison alongside the cost of your actual workload, using the same billing period across subscriptions. Lowest-cost mode recalculates every provider’s plan when volume or billing changes. Manual plans and full-allowance rates are available only in Custom scenario. The default compares 93,000 monthly base pages; this is a cost fit, not a throughput recommendation. Search prices are not scraping prices. The plan and billing selections in <a href="#pricing">Quality vs. cost</a> also apply below.</p>
    <h3>Budget for {number(pages)} pages a month</h3>
    <p className="micro">{number(pages)} billable base pages per month, per provider, on your selected plans. Estimates, not invoices. This includes unused capacity and whole top-up blocks. Full-allowance rates instead assume every included credit is used.</p>
    <Table><Table.ScrollContainer><Table.Content aria-label="Selected plan monthly budgets" className="comparison-table pricing-table">
      <Table.Header><Table.Column isRowHeader>Provider & plan</Table.Column><Table.Column>Monthly spend</Table.Column><Table.Column>Blended / 1k pages</Table.Column></Table.Header>
      <Table.Body>{prices.map(provider=><Table.Row key={provider.id}>
        <Table.Cell><span className="provider-name"><ProviderLogo id={provider.id}/>{provider.name}</span><span className="cell-detail">{provider.plan.name}</span></Table.Cell>
        <Table.Cell>{money(provider.quote.monthly)}{provider.quote.commitment!==null&&<span className="cell-detail">{money(provider.quote.commitment)}/year upfront</span>}{provider.quote.extra>0&&<span className="cell-detail">Includes {money(provider.quote.extra)} top-ups</span>}</Table.Cell>
        <Table.Cell>{rate(provider.quote.monthly===null?null:provider.quote.monthly/pages*1000)}</Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table.Content></Table.ScrollContainer></Table>
    <p className="micro">Annual fees are amortized across 12 months; included credits still renew monthly. Assumes no opening balance, rollover, free credits or promotional discounts, and top-ups enabled. Failure billing and special URL charges can change the invoice. Excludes search, judging, hosting, taxes and extra formats. A plan’s throughput limits may prevent a five-minute run.</p>
    <h3>Reported usage</h3>
    <Table><Table.ScrollContainer><Table.Content aria-label="Reported API costs" className="comparison-table pricing-table">
      <Table.Header><Table.Column isRowHeader>Provider</Table.Column><Table.Column>USD subtotal</Table.Column><Table.Column>Credits subtotal</Table.Column><Table.Column>Reported / 1k useful</Table.Column></Table.Header>
      <Table.Body>{rows.map(row=><Table.Row key={row.id}>
        <Table.Cell><span className="provider-name"><ProviderLogo id={row.id}/>{row.name}</span></Table.Cell>
        <Table.Cell>{money(row.cost_usd,3)}<span className="cell-detail">{row.cost_known}/{row.count} pages reported{row.cost_known>0&&row.cost_known<row.count?' · partial':''}</span></Table.Cell>
        <Table.Cell>{finite(row.credits)?number(row.credits):'Unknown'}<span className="cell-detail">{row.credits_known}/{row.count} pages reported{row.credits_known>0&&row.credits_known<row.count?' · partial':''}</span></Table.Cell>
        <Table.Cell>{row.unknown===0?rate(row.costPerUseful):'Unknown'}</Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table.Content></Table.ScrollContainer></Table>
    <p className="micro">API receipts for the selected page set, not the account invoice. Missing receipts stay unknown, including timed-out requests that may still be billed. Credits are provider-specific; they are not converted to dollars at a hypothetical plan rate. Reported cost per useful page requires USD receipts for every selected page and fully resolved judgments. Subscription fees absent from receipts and operational costs are excluded.</p>
    <h3 id="published-plans">Plans & rates</h3>
    <p className="micro">Included-credit rates and overage rates are different. The first assumes full use of the subscription; the second applies only after that allowance runs out. Free tiers are bounded allowances, not sustainable zero-cost tariffs.</p>
    {PRICING.map(provider=><PlanTable key={provider.id} provider={provider} billing={scenario.billing}/>)}
  </div>;
}
