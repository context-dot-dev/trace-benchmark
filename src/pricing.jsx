import {Table} from '@/components/ui/heroui-table';
import {ToggleGroup,ToggleGroupItem} from '@/components/ui/toggle-group';
import {ProviderLogo} from './provider-logo';
import {finite} from './model';
import {PRICING,MONTHLY_PAGES,quotePlan,planRate,priceRows} from './pricing-data';

const money=(value,digits=2)=>finite(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value):'Unknown';
const rate=value=>money(value,3);
const number=value=>value.toLocaleString('en-US');
const basePrice=(plan,billing)=>billing==='annual'&&plan.annual?plan.annual/12:plan.monthly;

export function PlanTable({provider,billing}) {
  return <div className="pricing-provider">
    <h4 className="provider-name"><ProviderLogo id={provider.id}/>{provider.name}</h4>
    <p className="micro">{provider.endpoint} · <a href={provider.source}>Official pricing</a>{provider.billingSource&&<> · <a href={provider.billingSource}>Billing rules</a></>} · Checked {provider.checked}</p>
    <Table><Table.ScrollContainer><Table.Content aria-label={`${provider.name} published plans`} className="comparison-table pricing-table">
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
  return <div id="pricing" className="pricing">
    <h3>Report pricing</h3>
    <p className="section-intro">The price of 1,000 fresh, base-rate pages on a named plan. Like NEEDLE, the default is the largest published self-service tier. Change a plan to compare its rate.</p>
    <ToggleGroup variant="segmented" value={[scenario.billing]} onValueChange={v=>v[0]&&onScenarioChange({...scenario,billing:v[0]})} aria-label="Pricing billing period"><ToggleGroupItem value="monthly">Monthly billing</ToggleGroupItem><ToggleGroupItem value="annual">Annual billing</ToggleGroupItem></ToggleGroup>
    <div className="pricing-choices">{PRICING.filter(p=>p.plans.some(plan=>plan.annual)).map(provider=><div className="pricing-choice" key={provider.id}>
      <span className="provider-name"><ProviderLogo id={provider.id}/>{provider.name}</span>
      <ToggleGroup size="sm" value={[scenario.plans[provider.id]]} onValueChange={v=>v[0]&&onScenarioChange({...scenario,plans:{...scenario.plans,[provider.id]:v[0]}})} aria-label={`${provider.name} pricing plan`}>{provider.plans.filter(plan=>plan.annual).map(plan=><ToggleGroupItem key={plan.name} value={plan.name}>{plan.name}</ToggleGroupItem>)}</ToggleGroup>
    </div>)}</div>
    <Table><Table.ScrollContainer><Table.Content aria-label="Plan-specific scraping prices" className="comparison-table pricing-table">
      <Table.Header><Table.Column isRowHeader>Provider & selected plan</Table.Column><Table.Column>Base / 1k pages</Table.Column><Table.Column>Projected / 1k useful</Table.Column></Table.Header>
      <Table.Body>{prices.map(provider=><Table.Row key={provider.id}>
        <Table.Cell><span className="provider-name"><ProviderLogo id={provider.id}/>{provider.name}</span><span className="cell-detail">{provider.plan.name}{provider.plan.annual?` · ${scenario.billing}`:''}</span></Table.Cell>
        <Table.Cell>{rate(provider.unitPrice)}</Table.Cell>
        <Table.Cell>{rate(provider.usefulPrice)}{provider.unitPrice!==null&&provider.usefulPrice===null&&<span className="cell-detail">Needs resolved results and useful pages</span>}</Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table.Content></Table.ScrollContainer></Table>
    <p className="micro">Subscription rates assume the full included allowance is used. Annual rates use the exact yearly payment ÷ 12, not rounded advertised monthly prices. Rates are rounded to $0.001. Projected useful-page cost = base rate ÷ useful-content rate, assuming one billable base page per attempt; it is not a measured charge.</p>
    <p className="micro">Changing pricing does not change the measured results or imply they were collected on that plan. Free allowances, promotions and negotiated quotes are excluded. Keenable’s live-fetch price is unverified. Checked September 30, 2026. <a href="#pricing-details">Plans, budgets & billing evidence</a> · <a href="pricing.json" download>Download prices</a></p>
  </div>;
}

export function PricingAppendix({rows,scenario}) {
  const prices=priceRows(rows,scenario);
  return <div id="pricing-details" className="pricing">
    <h3>Pricing methodology</h3>
    <p className="micro"><a href="https://github.com/keenableai/needle/blob/main/dashboard/index.html">NEEDLE’s pricing catalog</a> stores a price, plan and check date for each engine and describes its comparison as the biggest self-serve tier, excluding enterprise quotes. Trace uses that convention for scraping, with the same billing period across subscriptions. Search prices are not scraping prices. The plan and billing selections in <a href="#pricing">Report pricing</a> also apply below.</p>
    <h3>Budget for 3,000 pages a day</h3>
    <p className="micro">{number(MONTHLY_PAGES)} billable base pages in a 31-day month, per provider, on your selected plans. Estimates, not invoices. This includes unused capacity and whole top-up blocks; it differs from the full-allowance unit rate above.</p>
    <Table><Table.ScrollContainer><Table.Content aria-label="Selected plan monthly budgets" className="comparison-table pricing-table">
      <Table.Header><Table.Column isRowHeader>Provider & plan</Table.Column><Table.Column>Monthly spend</Table.Column><Table.Column>Blended / 1k pages</Table.Column></Table.Header>
      <Table.Body>{prices.map(provider=><Table.Row key={provider.id}>
        <Table.Cell><span className="provider-name"><ProviderLogo id={provider.id}/>{provider.name}</span><span className="cell-detail">{provider.plan.name}</span></Table.Cell>
        <Table.Cell>{money(provider.quote.monthly)}{provider.quote.commitment!==null&&<span className="cell-detail">{money(provider.quote.commitment)}/year upfront</span>}{provider.quote.extra>0&&<span className="cell-detail">Includes {money(provider.quote.extra)} top-ups</span>}</Table.Cell>
        <Table.Cell>{rate(provider.quote.monthly===null?null:provider.quote.monthly/MONTHLY_PAGES*1000)}</Table.Cell>
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
    <h3 id="published-plans">Published plans</h3>
    <p className="micro">Included-credit rates and overage rates are different. The first assumes full use of the subscription; the second applies only after that allowance runs out. Free tiers are bounded allowances, not sustainable zero-cost tariffs.</p>
    {PRICING.map(provider=><PlanTable key={provider.id} provider={provider} billing={scenario.billing}/>)}
  </div>;
}
