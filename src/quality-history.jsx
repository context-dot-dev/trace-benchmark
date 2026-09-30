import { useEffect, useRef, useState } from 'react';
import { Table } from '@/components/ui/heroui-table';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ProviderLogo } from './provider-logo';
import { color, pct } from './model';

const dayLabel=day=>new Date(day+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
export function History({ data, cohort, providers }) {
  const [range,setRange]=useState('30');
  const [view,setView]=useState('chart');
  const [hidden,setHidden]=useState([]);
  const [active,setActive]=useState(null);
  const [width,setWidth]=useState(640);
  const container=useRef(null);
  useEffect(()=>{
    if(!container.current)return;
    const observer=new ResizeObserver(([entry])=>setWidth(Math.max(260,entry.contentRect.width)));
    observer.observe(container.current);return()=>observer.disconnect();
  },[view]);
  const history=(data?.metrics?.daily||[]).filter(r=>r.cohort===cohort);
  const latest=history.map(r=>r.day).sort().at(-1);
  const cutoff=latest ? Date.parse(latest)-(Number(range)-1)*86400000 : 0;
  const rows=history.filter(r=>Date.parse(r.day)>=cutoff);
  const days=[...new Set(rows.map(r=>r.day))].sort();
  const selected=days.includes(active)?active:days.at(-1);
  const shown=providers.filter(p=>!hidden.includes(p.id));
  const left=42,right=width-18,top=16,bottom=222;
  const first=Date.parse(days[0]),last=Date.parse(days.at(-1));
  const x=day=>first===last?(left+right)/2:left+(Date.parse(day)-first)/(last-first)*(right-left);
  const y=rate=>bottom-rate*(bottom-top);
  const ticks=days.filter((_,i)=>i===0||i===days.length-1||i%Math.max(1,Math.ceil(days.length/(width<450?3:5)))===0);
  const selectedRows=rows.filter(r=>r.day===selected);
  const sample=selectedRows[0];
  return <section id="trends" className="quality-history">
    <h2>Quality over time</h2>
    <p className="section-intro">One point per provider, per UTC day. {cohort==='independent'?'Each daily run targets 3,000 URLs, shared by every scraper.':'The separate search cohort samples up to 400 result slots each day.'} The leaderboard above shows the latest completed daily run.</p>
    <div className="history-controls">
      <ToggleGroup value={[range]} onValueChange={v=>v[0]&&setRange(v[0])} aria-label="History period">{['7','30','90'].map(n=><ToggleGroupItem key={n} value={n}>{n} days</ToggleGroupItem>)}</ToggleGroup>
      <ToggleGroup value={[view]} onValueChange={v=>v[0]&&setView(v[0])} aria-label="History view"><ToggleGroupItem value="chart">Chart</ToggleGroupItem><ToggleGroupItem value="table">Table</ToggleGroupItem></ToggleGroup>
    </div>
    {view==='chart' ? <>
      <div className="history-legend" aria-label="Chart providers">{providers.map(p=><Button key={p.id} variant="ghost" size="sm" aria-pressed={!hidden.includes(p.id)} onClick={()=>setHidden(h=>h.includes(p.id)?h.filter(id=>id!==p.id):[...h,p.id])}><ProviderLogo id={p.id}/>{p.name}<span className="history-swatch" style={{background:color(p)}}/></Button>)}</div>
      <div ref={container} className="history-chart">
        <svg viewBox={`0 0 ${width} 260`} width="100%" height="260" role="img" aria-label={`Daily useful-content rate for ${days.length} recorded UTC days. Exact values are available in the Table view.`}>
          {[0,.25,.5,.75,1].map(rate=><g key={rate}><line x1={left} x2={right} y1={y(rate)} y2={y(rate)} className="history-grid"/><text x={left-8} y={y(rate)+4} textAnchor="end" className="history-axis">{rate*100}%</text></g>)}
          {ticks.map(day=><text key={day} x={x(day)} y={248} textAnchor="middle" className="history-axis">{dayLabel(day)}</text>)}
          {shown.map(p=>{
            const values=rows.filter(r=>r.provider===p.id&&r.success_rate!==null).sort((a,b)=>a.day.localeCompare(b.day));
            const paths=[];
            for(const r of values){const previous=paths.at(-1)?.at(-1);if(!previous||Date.parse(r.day)-Date.parse(previous.day)>86400000)paths.push([]);paths.at(-1).push(r);}
            return <g key={p.id} style={{color:color(p)}}>{paths.map((path,i)=><polyline key={i} points={path.map(r=>`${x(r.day)},${y(r.success_rate)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2"/>)}{values.map(r=><circle key={r.day} cx={x(r.day)} cy={y(r.success_rate)} r={r.day===selected?5:3.5} fill="currentColor" tabIndex={0} onFocus={()=>setActive(r.day)} onMouseEnter={()=>setActive(r.day)} aria-label={`${dayLabel(r.day)}, ${p.name}: ${pct(r.success_rate)}, ${r.pages} URLs`}><title>{`${p.name}: ${pct(r.success_rate)} · ${r.pages.toLocaleString('en-US')} URLs · ${r.day}`}</title></circle>)}</g>;
          })}
        </svg>
      </div>
      {sample&&<div className="history-reading" aria-live="polite"><strong>{dayLabel(selected)}</strong><span>{sample.pages.toLocaleString('en-US')} URLs per provider · {sample.sample_kind==='daily'?'Daily run':'Earlier small batches'}</span><div>{shown.map(p=>{const r=selectedRows.find(r=>r.provider===p.id);return <span key={p.id}>{p.name} <strong>{pct(r?.success_rate)}</strong></span>;})}</div></div>}
    </> : <Table><Table.ScrollContainer><Table.Content aria-label="Daily useful-content rates" className="category-table"><Table.Header><Table.Column isRowHeader>UTC date</Table.Column>{providers.map(p=><Table.Column key={p.id}><span className="category-provider" aria-label={p.name}><ProviderLogo id={p.id}/><span>{p.name}</span></span></Table.Column>)}</Table.Header><Table.Body>{days.map(day=><Table.Row key={day}><Table.Cell>{dayLabel(day)}<span className="cell-detail">{rows.find(r=>r.day===day)?.sample_kind==='daily'?'Daily':'Earlier batches'}</span></Table.Cell>{providers.map(p=>{const r=rows.find(r=>r.day===day&&r.provider===p.id);return <Table.Cell key={p.id}>{pct(r?.success_rate)}<span className="cell-detail">{r?.pages.toLocaleString('en-US')||0} URLs</span></Table.Cell>;})}</Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table>}
    <p className="micro">{days.length===0?'No completed day yet. ':days.length===1?'One day recorded; a trend needs more than one day. ':''}Up to 90 days of completed results under the same scoring protocol. Missing days remain gaps. Earlier small batches are labeled and replaced by that day’s daily run once it finishes. A completed same-day replacement rerun supersedes its parent in this trend; both receipts remain available. Rates show confirmed coverage of the full sample, including unresolved and unattempted tests. Changes can reflect account availability and page mix as well as the provider. <a href="#runs">Inspect category counts and repeated URLs</a>.</p>
  </section>;
}
