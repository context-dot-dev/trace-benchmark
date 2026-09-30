import { useEffect, useState } from "react";
import { Table } from "@/components/ui/heroui-table";
import { ProviderLogo } from "./provider-logo";
import { pct, secs, date } from "./model";
import { Replenishment } from "./run-sampling";
import { MetricPanels } from "./comparisons";

export function LiveStatus({ data, cohort }) {
  const [now,setNow]=useState(()=>Date.parse(data?.rendered_at)||Date.now());
  useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
  if (!data) return null;
  const tick=data.operations?.last_tick;
  const age=tick?.finished_at ? (now-Date.parse(tick.finished_at))/3600000 : Infinity;
  const enabled=data.operations?.scheduler_status==="enabled";
  const current=data.cohorts[cohort]?.latestRun;
  const daily=data.operations?.collection_profile?.cadence==='daily';
  const activeLimit=(daily?18*60:45)*60*1000;
  const staleHours=daily?30:2;
  const collecting=Boolean(current && ["running","acquired"].includes(current.status) && now-Date.parse(current.started_at)<activeLimit) || (enabled && tick?.started_at && !tick.finished_at && now-Date.parse(tick.started_at)<activeLimit);
  const status=collecting ? "Collecting new pages" : enabled && age<staleHours && !tick?.errors?.length ? (daily?"Updating daily":"Updating hourly") : tick?.errors?.length ? "Collection needs attention" : enabled && age>=staleHours ? "Collection delayed" : "Manual collection";
  const completed=data.cohorts[cohort]?.lastCompleted;
  const phase={running:"collecting",acquired:"scoring",pending_budget:"waiting for daily budget",review_pending:"needs review",incomplete:"incomplete"}[current?.status]||current?.status;
  return <p className="study-note" role="status"><strong>{status}.</strong> {completed ? `Last completed run: ${date(completed.finished_at)}.` : "No completed run for this protocol yet."} {current && current.status!=="completed" && <span>Current run: {current.selected_count.toLocaleString("en-US")} pages · {phase}. {current.observed_count||0}/{current.selected_count*data.providers.length} responses, {current.judged_count||0} graded. </span>} {data.operations?.next_run_at && <span>Next scheduled: {date(data.operations.next_run_at)}. </span>}<a href="#runs">Inspect runs</a></p>;
}
export function AccountIssues({rows}) {
  return rows.filter(row=>row.accountAffected>0).map(row=><p className="study-note" role="status" key={row.id}>
    <strong>{row.name}: incomplete run — {row.creditsRejected>0 || row.status_detail==='HTTP_402' ? 'credits exhausted' : 'account access failed'}.</strong>{' '}
    {row.accountSkipped.toLocaleString('en-US')} pages skipped; {row.accountRejected} requests rejected by the account.{' '}
    {row.measuredAttempts>0 && <>{pct(row.attemptedUsefulRate)} useful across {row.measuredAttempts.toLocaleString('en-US')} non-account-error attempts. </>}
    This subset is not a replacement for the full-sample comparison. The recorded coverage includes unresolved pages.{' '}
    {row.id==='firecrawl'&&<><a href="https://www.firecrawl.dev/app/settings?tab=billing">Restore Firecrawl credits</a> before a new shared run. </>}
    Original results are retained.
  </p>);
}

export function Coverage({ group, rows }) {
  const c=group?.comparisons||{};
  const resolved=c.resolved||0;
  const pending=(c.pending||0)+(c.pending_budget||0)+(c.dispatched||0);
  return <section id="coverage"><h2>Who returns the best output?</h2>
    <p className="section-intro">Compare the fresh responses directly. Jev compares anonymous outputs for useful detail, coverage and cleanliness. Identical text ties automatically. Extra length alone does not win.</p>
    <p className="micro">{resolved} comparable pages · {c.single_source||0} with only one useful response · {c.no_useful_output||0} with none · {(c.incomplete||0)+(c.unresolved||0)} unresolved · {pending} pending</p>
    {resolved || c.single_source ? <Table><Table.ScrollContainer><Table.Content aria-label="Best observed output" className="comparison-table"><Table.Header><Table.Column isRowHeader>Provider</Table.Column><Table.Column>Best or tied</Table.Column><Table.Column>Share</Table.Column><Table.Column>Only useful</Table.Column></Table.Header><Table.Body>{rows.map(r=><Table.Row key={r.id}><Table.Cell><span className="provider-name"><ProviderLogo id={r.id}/>{r.name}</span></Table.Cell><Table.Cell>{r.bestObserved||0}<span className="cell-detail">of {r.compared||0} compared</span></Table.Cell><Table.Cell>{pct(r.bestRate)}</Table.Cell><Table.Cell>{r.soleUseful||0}</Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table> : <p>Output comparisons are not available for these results yet.</p>}
    <p className="micro">Best among the observed outputs, not verified ground truth. Ties count for each winning provider. Pages with missing, uncertain, cached or non-contemporaneous evidence do not enter this comparison. The useful-content score above still includes every selected page.</p>
  </section>;
}
export function Efficiency({ rows }) {
  return <section id="efficiency"><h2>Latency</h2><p className="section-intro">Timing starts when the API request begins and ends after the complete response arrives. It includes provider failures, excludes judging and account/configuration errors, and uses the same 30-second deadline. P95 is unstable for small samples.</p><div className="wide-comparison"><MetricPanels label="Latency" rows={rows} metrics={[
    {key:"p50",title:"Median latency",short:"P50",detail:"Seconds, all timed requests",lower:true,format:secs},
    {key:"p95",title:"Tail latency",short:"P95",detail:"95th percentile, seconds",lower:true,format:secs},
  ]}/></div></section>;
}
export function Supply({ data, categoryName }) {
  const healthy=data?.sourceHealth?.healthy||0;
  const total=data?.sourceHealth?.total||0;
  return <section id="supply"><h2>URL supply</h2><p className="section-intro">Public feeds, sitemaps and registries supply the independent sample. NEEDLE supplies changing queries, which Context Search turns into a separate stream of URLs. New pages exclude previously selected documents; controls repeat daily for 30 days; search URLs can repeat on later days.</p><p className="micro">{healthy} of {total} source endpoints succeeded at their latest poll. Failed sources remain in the registry and are retried on their next scheduled poll.</p><Table><Table.ScrollContainer><Table.Content aria-label="URL discovery supply" className="comparison-table"><Table.Header><Table.Column isRowHeader>Category</Table.Column><Table.Column>Inventory</Table.Column><Table.Column>First seen, 24h</Table.Column><Table.Column>Domains</Table.Column></Table.Header><Table.Body>{Object.entries(data?.supply||{}).map(([id,s])=><Table.Row key={id}><Table.Cell>{categoryName(id)}</Table.Cell><Table.Cell>{s.inventory.toLocaleString("en-US")}</Table.Cell><Table.Cell>{s.new_24h.toLocaleString("en-US")}</Table.Cell><Table.Cell>{s.domains}</Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table><p className="micro">“First seen” means new to this collector, not necessarily newly published. The first poll includes existing inventory. Category and domain counts do not establish scraping difficulty. Shortfalls are retained, without substituting easier categories.</p><p className="micro">Last saved capacity check: {data?.operations?.capacity_plan?.eligible_selection ?? "—"} eligible pages against a 3,000-page target, including fixed controls. This inventory estimate predates the next discovery refresh and does not measure daily replenishment.</p><Replenishment data={data} categoryName={categoryName}/></section>;
}


export function Freshness({ rows }) {
  const settings={context:"maxAgeMs = 0",exa:"maxAgeHours = 0",firecrawl:"maxAge = 0",keenable:"live = true"};
  return <><h3>Fresh retrieval</h3><p className="micro">Every selected page is requested fresh, with one attempt and the same 30-second deadline. “Unreported” means the provider did not supply usable cache evidence. A reported cache hit remains unresolved, not a fresh-content success. Firecrawl also receives storeInCache=false.</p><Table><Table.ScrollContainer><Table.Content aria-label="Provider freshness audit" className="comparison-table freshness-table"><Table.Header><Table.Column isRowHeader>Provider</Table.Column><Table.Column>Request setting</Table.Column><Table.Column>Fresh</Table.Column><Table.Column>Unreported</Table.Column></Table.Header><Table.Body>{rows.map(r=><Table.Row key={r.id}><Table.Cell>{r.name}</Table.Cell><Table.Cell><span className="freshness-setting">{settings[r.id]}</span><span className="cell-detail">{r.freshness?.requested||0}/{r.observed} requests verified</span></Table.Cell><Table.Cell>{r.freshness?.reportedFresh||0}<span className="cell-detail">{r.freshness?.reportedCached||0} cache hits</span></Table.Cell><Table.Cell>{r.freshness?.unreported||0}</Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table><h3>Unresolved results</h3>{rows.map(r=><p className="micro" key={r.id}><strong>{r.name}:</strong> {r.unknown ? Object.entries(r.unresolvedCauses||{}).map(([reason,count])=>`${count} ${reason.replaceAll('_',' ')}`).join('; ') : (r.count ? 'All selected results resolved.' : 'Awaiting the first completed run.')}</p>)}</>;
}
