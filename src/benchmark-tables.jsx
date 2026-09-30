import { ArrowUpRight } from "lucide-react";
import { Table } from "@/components/ui/heroui-table";
import { Button } from "@/components/ui/button";
import { Outcome } from "./controls";
import { finite, pct, secs } from "./model";
import { ProviderLogo } from "./provider-logo";

export function QualityTable({ rows, sort, ascending, onSort, onProvider, loading }) {
  return <Table>
    <Table.ScrollContainer>
      <Table.Content aria-label="Provider content results" className="quality-table tabular-nums"
        sortDescriptor={{ column: sort, direction: ascending ? "ascending" : "descending" }}
        onSortChange={onSort}>
        <Table.Header>
          <Table.Column id="name" isRowHeader allowsSorting>
            {({ sortDirection }) => <Table.SortableColumnHeader sortDirection={sortDirection}>Provider</Table.SortableColumnHeader>}
          </Table.Column>
          <Table.Column id="rate" allowsSorting>
            {({ sortDirection }) => <Table.SortableColumnHeader sortDirection={sortDirection}>Useful</Table.SortableColumnHeader>}
          </Table.Column>
          <Table.Column id="p50" allowsSorting>
            {({ sortDirection }) => <Table.SortableColumnHeader sortDirection={sortDirection}>Time</Table.SortableColumnHeader>}
          </Table.Column>
        </Table.Header>
        <Table.Body renderEmptyState={() => loading ? "Loading observations…" : "No collection loaded."}>
          {rows.map(p => <Table.Row key={p.id} id={p.id}>
            <Table.Cell textValue={p.name}><Button variant="ghost" className="provider-button" onClick={() => onProvider(p.id)}><ProviderLogo id={p.id} /><span>{p.name}{p.id === "hetzner" && <small className="reader-label">Self-hosted</small>}</span></Button></Table.Cell>
            <Table.Cell><span className="score">{p.accountAffected>0?"Incomplete":pct(p.rate)}</span>{p.accountAffected>0&&<span className="cell-detail">{pct(p.rate)} confirmed coverage</span>}<span className="cell-detail">{p.success} / {p.count} pages</span>{p.unknown>0 && <span className="cell-detail">{p.unknown} unresolved · up to {pct(p.upper)}</span>}</Table.Cell>
            <Table.Cell>{secs(p.p50)}</Table.Cell>
          </Table.Row>)}
        </Table.Body>
      </Table.Content>
    </Table.ScrollContainer>
  </Table>;
}

export function ResultsTable({ records, categoryName, providerName, onInspect }) {
  return <Table>
    <Table.ScrollContainer className="results-scroller">
      <Table.Content aria-label="Individual observed results" className="tabular-nums results-table">
        <Table.Header>
          <Table.Column isRowHeader>Page / source</Table.Column>
          <Table.Column>Provider</Table.Column>
          <Table.Column>Outcome</Table.Column>
          <Table.Column><span className="sr-only">Inspect</span></Table.Column>
        </Table.Header>
        <Table.Body>
          {records.map(r => <Table.Row key={r.id} id={r.id}>
            <Table.Cell textValue={r.title || r.url || r.task_id}><span className="result-title">{r.title || r.url || r.task_id}</span><span className="cell-detail">{r.domain || r.source_id || "Source unavailable"} · {categoryName(r.category)}</span><span className="mobile-provider"><ProviderLogo id={r.provider} />{providerName(r.provider)}</span></Table.Cell>
            <Table.Cell><span className="provider-name"><ProviderLogo id={r.provider} />{providerName(r.provider)}</span></Table.Cell>
            <Table.Cell><Outcome record={r} /><span className="cell-detail">{finite(r.elapsed_ms) ? secs(r.elapsed_ms / 1000) : "—"}</span></Table.Cell>
            <Table.Cell><Button variant="ghost" size="icon" aria-label={`Inspect ${providerName(r.provider)} result for ${r.title || r.url || r.task_id}`} onClick={e => onInspect(r, e.currentTarget)}><ArrowUpRight /></Button></Table.Cell>
          </Table.Row>)}
        </Table.Body>
      </Table.Content>
    </Table.ScrollContainer>
  </Table>;
}
