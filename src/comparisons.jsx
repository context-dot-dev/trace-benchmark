import { useState } from "react";
import { Table } from "@/components/ui/heroui-table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProviderLogo } from "./provider-logo";
import { finite, pct, secs } from "./model";

const colors = { context: "#536d56", exa: "#2459db", keenable: "#5575c5", hetzner: "#c54a4c", firecrawl: "#dd642d", perplexity: "#24818a", parallel: "#60606b", brave: "#d55a35", linkup: "#987298" };

export function MetricPanels({ rows, metrics, label }) {
  const [view, setView] = useState("charts");
  return <div className="metric-panels">
    <div className="view-choice"><ToggleGroup variant="segmented" value={[view]} onValueChange={v => v[0] && setView(v[0])} aria-label={`${label} view`}><ToggleGroupItem value="charts">Charts</ToggleGroupItem><ToggleGroupItem value="table">Table</ToggleGroupItem></ToggleGroup></div>
    {view === "charts" ? <div className="metric-grid">{metrics.map(metric => {
      const ranked = [...rows].sort((a, b) => (metric.lower ? 1 : -1) * ((a[metric.key] ?? (metric.lower ? Infinity : -Infinity)) - (b[metric.key] ?? (metric.lower ? Infinity : -Infinity))));
      const max = metric.max || Math.max(...rows.map(r => r[metric.key] || 0), 1);
      return <figure className="metric-figure" key={metric.key}><figcaption><h3>{metric.title}</h3><p>{metric.detail} · {metric.lower ? "lower" : "higher"} is better</p></figcaption><div className="bar-chart">{ranked.map(r => <div className="bar-column" key={r.id}>
        <div className="bar-area"><div className="chart-bar" style={{ height: `${Math.max(0, (r[metric.key] || 0) / max * 100)}%`, background: colors[r.id] }}><span className="bar-value">{metric.format(r[metric.key])}</span></div></div>
        <ProviderLogo id={r.id} /><span className="bar-name">{r.name}</span>{r.mode && <span className="bar-mode">{r.mode}</span>}{r.accountAffected>0&&<span className="bar-mode">Incomplete run</span>}
      </div>)}</div></figure>;
    })}</div> : <Table><Table.ScrollContainer><Table.Content aria-label={`${label} comparison`} className="comparison-table"><Table.Header><Table.Column isRowHeader>Provider</Table.Column>{metrics.map(m => <Table.Column key={m.key}>{m.short || m.title}</Table.Column>)}</Table.Header><Table.Body>{rows.map(r => <Table.Row key={r.id}><Table.Cell><span className="provider-name"><ProviderLogo id={r.id} /><span>{r.name}{r.mode && <small>{r.mode}</small>}</span></span></Table.Cell>{metrics.map(m => <Table.Cell key={m.key}>{m.format(r[m.key])}</Table.Cell>)}</Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table>}
  </div>;
}

export function PageTypes({ groups, providers, categoryName }) {
  return <Table><Table.ScrollContainer><Table.Content aria-label="Content recovery by page type" className="category-table"><Table.Header><Table.Column isRowHeader>Page type</Table.Column>{providers.map(p => <Table.Column key={p.id} textValue={p.name}><span className="category-provider" aria-label={p.name}><ProviderLogo id={p.id} /><span>{p.name}</span></span></Table.Column>)}</Table.Header><Table.Body>{groups.map(({id, results}) => {
    return <Table.Row key={id}><Table.Cell>{categoryName(id)}</Table.Cell>{providers.map(p => {
      const result = results[p.id];
      return <Table.Cell key={p.id}><span className="heat-value" style={{ "--strength": `${Math.round((result.rate || 0) * 18)}%` }} title={`${result.success} useful pages out of ${result.count}`}>{finite(result.rate) ? `${Math.round(result.rate * 100)}%` : "—"}</span></Table.Cell>;
    })}</Table.Row>;
  })}</Table.Body></Table.Content></Table.ScrollContainer></Table>;
}

export function HeadToHead({ pairs }) {
  return <div className="pair-grid">{pairs.map(p => <figure className="pair-figure" key={`${p.a.id}-${p.b.id}`}>
    <figcaption className="pair-title"><span><ProviderLogo id={p.a.id} />{p.a.name}</span><span className="versus">vs.</span><span><ProviderLogo id={p.b.id} />{p.b.name}</span></figcaption>
    <div className="pair-track" aria-hidden="true">{[[p.both,"both"],[p.first_only,"first"],[p.second_only,"second"],[p.neither,"neither"],[p.unknown,"unknown"]].map(([n, key]) => <span key={key} className={`pair-${key}`} style={{width:`${p.count ? n/p.count*100 : 0}%`}} />)}</div>
    <dl className="pair-values"><div><dt>Both</dt><dd>{p.both}</dd></div><div><dt>{p.a.name} only</dt><dd>{p.first_only}</dd></div><div><dt>{p.b.name} only</dt><dd>{p.second_only}</dd></div><div><dt>Neither</dt><dd>{p.neither}</dd></div></dl>
    <p className="micro">{p.unknown} unresolved · {p.count} matched page tests</p>
  </figure>)}</div>;
}

export const scrapingMetrics = [
  { key:"rate", title:"Confirmed useful content", detail:"Share of all page tests, including unresolved", max:1, format:pct },
];
