import { useState } from 'react';
import { Table } from '@/components/ui/heroui-table';

const number=value=>value==null?'—':value.toLocaleString('en-US');
const label=run=>new Date(run.started_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'});
const kinds={rerun:'Rerun',daily_selection:'Daily selection',query_selection:'Search selection',earlier_batch:'Earlier batch'};

export function RunSampling({data,categoryName}) {
  const runs=data?.runs||[];
  const [selected,setSelected]=useState(null);
  const run=runs.find(r=>r.id===selected)||runs.find(r=>r.cohort==='independent')||runs[0];
  const sample=run?.sampling;
  return <div id="runs" className="run-sampling">
    <h3>Run samples</h3>
    <p className="micro">First-time means a URL or known document alias was never selected in an earlier run, across both page sets. A new selection can be an old page. Counts describe selected tasks, including failed requests. Select a row to inspect its categories and publication ages.</p>
    <Table><Table.ScrollContainer><Table.Content aria-label="Run sample history" onRowAction={key=>setSelected(String(key))} keyboardNavigationBehavior="arrow" className="comparison-table sampling-history-table"><Table.Header><Table.Column isRowHeader>Run · UTC</Table.Column><Table.Column>Pages</Table.Column><Table.Column>First-time</Table.Column><Table.Column>Repeat</Table.Column><Table.Column>Shortfall</Table.Column></Table.Header><Table.Body>{runs.map(r=><Table.Row key={r.id} id={r.id}><Table.Cell><span className="run-sample-link" data-active={run?.id===r.id}>{label(r)}</span><span className="cell-detail">{{independent:'Independent',needle:'Search',repeat:'Repeat'}[r.cohort]||r.cohort} · {kinds[r.sampling?.kind]||'Unclassified'}</span></Table.Cell><Table.Cell>{number(r.selected_count)}</Table.Cell><Table.Cell>{number(r.sampling?.first_time_urls)}</Table.Cell><Table.Cell>{number(r.sampling?.repeated_urls)}</Table.Cell><Table.Cell>{number(r.sampling?.shortfall)}</Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table>
    {run && <div className="run-sample-detail" aria-live="polite">
      <h4>{label(run)} UTC · {kinds[sample?.kind]||'Run'}</h4>
      <p className="micro">{run.status} · <a href={run.manifest_url} download>Download this run</a>{run.exclusion && <> · Excluded: {run.exclusion.reason}</>}</p>
      {sample ? <>
        {sample.roles && <p className="micro">One daily sample: {number(sample.roles.new.selected)} new pages / {number(sample.roles.new.target)} target · {number(sample.roles.control.selected)} controls / {number(sample.roles.control.target)} target. Panel {sample.control_panel.version}, fixed until {sample.control_panel.expires_at.slice(0,10)} UTC. Controls may be first-time URLs on their first day.</p>}
        {sample.parent_run_id && <p className="micro">Re-tests an earlier panel. This is not a fresh-supply run. <a href={`data/runs/${sample.parent_run_id}.json`} download>Original panel</a></p>}
        <p className="micro">Publication age at run start, from source metadata: <strong>{number(sample.publication_age.within_24h)}</strong> within 24h · <strong>{number(sample.publication_age.one_to_seven_days)}</strong> 1–7 days · <strong>{number(sample.publication_age.older_than_seven_days)}</strong> older than 7 days · <strong>{number(sample.publication_age.unknown)}</strong> unknown · <strong>{number(sample.publication_age.future)}</strong> future-dated.</p>
        <Table><Table.ScrollContainer><Table.Content aria-label="Selected run categories" className="comparison-table"><Table.Header><Table.Column isRowHeader>Category</Table.Column><Table.Column>Selected / target</Table.Column><Table.Column>{sample.roles?'New / control':'First / repeat'}</Table.Column><Table.Column>Shortfall</Table.Column></Table.Header><Table.Body>{Object.entries(sample.categories).map(([id,c])=><Table.Row key={id}><Table.Cell>{categoryName(id)}</Table.Cell><Table.Cell>{number(c.selected)} / {number(c.target)}</Table.Cell><Table.Cell>{sample.roles?<>{number(sample.roles.new.categories[id]?.selected)} / {number(sample.roles.control.categories[id]?.selected)}<span className="cell-detail">Short: {number(sample.roles.new.categories[id]?.shortfall)} / {number(sample.roles.control.categories[id]?.shortfall)}</span></>:<>{number(c.first_time)} / {number(c.repeated)}</>}</Table.Cell><Table.Cell>{number(c.shortfall)}</Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table>
      </> : <p className="micro">Sampling provenance is unavailable in this older export.</p>}
    </div>}
    <p className="micro">The daily target is 300 new + 75 control pages per category. Earlier runs targeted 375 new pages. Missing new-page supply is never filled with repeats or other categories; control shortfalls stay fixed for the panel’s 30-day lifetime. Reruns and search selections have no fresh-supply quota (—). <a href="data/run-sampling.json" download>Download sampling history for every run</a>.</p>
  </div>;
}

export function Replenishment({data,categoryName}) {
  const days=data?.replenishment?.days||[];
  const latest=days.at(-1);
  return <div className="replenishment">
    <h3>Daily URL replenishment</h3>
    <p className="micro">Measured discoveries, not a promise of 300 new pages per category per day. Each source’s entire initial inventory day is counted separately. Later arrivals may still be old publications or ineligible for selection. The current UTC day is partial.</p>
    {days.length ? <>
      <Table><Table.ScrollContainer><Table.Content aria-label="Daily URL replenishment" className="comparison-table"><Table.Header><Table.Column isRowHeader>UTC day</Table.Column><Table.Column>New arrivals</Table.Column><Table.Column>Initial inventory</Table.Column><Table.Column>Source polls</Table.Column></Table.Header><Table.Body>{days.slice(-7).reverse().map(d=><Table.Row key={d.day}><Table.Cell>{d.day}</Table.Cell><Table.Cell>{number(d.new_urls)}</Table.Cell><Table.Cell>{number(d.baseline_urls)}</Table.Cell><Table.Cell>{number(d.polls)}<span className="cell-detail">{d.failed_polls} failed</span></Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table>
      <p className="micro">Latest recorded day ({latest.day}), arrivals after the initial inventory day: {Object.entries(latest.categories).map(([id,count])=>`${categoryName(id)} ${number(count)}`).join(' · ')}.</p>
    </> : <p className="micro">No daily discovery history is available yet.</p>}
    <p className="micro">Days without recorded polls do not prove zero supply. <a href="data/replenishment.json" download>Download 90 days of category counts</a>.</p>
  </div>;
}
