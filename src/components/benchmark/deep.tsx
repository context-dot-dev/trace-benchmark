"use client";

// Deeper views: per-site success and latency, failure detail, latency budgets, and fallbacks.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { percent } from "@/lib/benchmark/format";
import { categoryName, providerName } from "@/lib/benchmark/view";
import {
  BUDGETS_MS,
  type BudgetResult,
  type Clustered,
  type FailureDetail,
  type Fallback,
  type LatencyByCategory,
  type ProviderId,
  type SiteResult,
} from "@/lib/benchmark/analysis";
import { failureReasons } from "@/lib/benchmark/outcomes";
import { Name, Table, integer, points, seconds } from "./charts";

/** Sites smaller than this are left out of the site table: a rate from three pages says little. */
export const MIN_SITE_PAGES = 5;
const SITE_ROWS = 15;

type SiteSort = "pages" | "spread" | "slow";
const siteSorts: { id: SiteSort; label: string; sort: (a: SiteResult, b: SiteResult) => number }[] = [
  { id: "pages", label: "Most pages", sort: (a, b) => b.pages - a.pages || a.host.localeCompare(b.host) },
  { id: "spread", label: "Biggest gap", sort: (a, b) => (b.spread ?? 0) - (a.spread ?? 0) || b.pages - a.pages },
  { id: "slow", label: "Widest latency gap", sort: (a, b) => (b.latencyGap ?? 0) - (a.latencyGap ?? 0) || b.pages - a.pages },
];

function SiteCell({ site, id, bestRate, fastest }: { site: SiteResult; id: ProviderId; bestRate: number; fastest: number }) {
  const p = site.providers[id];
  const reason = failureReasons.find((r) => r.id === p.topReason)?.name;
  return (
    <span
      className="bench-site-cell"
      title={p.failed ? `${integer(p.failed)} failed${reason ? `, mostly ${reason.toLowerCase()}` : ""}. p95 ${seconds(p.p95)}` : `p95 ${seconds(p.p95)}`}
    >
      <span className={cn(p.rate != null && p.rate === bestRate && "is-best")}>{percent(p.rate)}</span>
      <small className={cn(p.p50 != null && p.p50 === fastest && "is-best")}>{seconds(p.p50)}</small>
    </span>
  );
}

/** Success rate and median latency for every site with enough pages, sortable three ways. */
export function SiteTable({ sites, order }: { sites: SiteResult[]; order: ProviderId[] }) {
  const [sort, setSort] = useState<SiteSort>("pages");
  const [all, setAll] = useState(false);
  const eligible = sites.filter((s) => s.pages >= MIN_SITE_PAGES);
  if (!eligible.length)
    return <p className="bench-notice">No site in this selection has {MIN_SITE_PAGES} or more pages.</p>;
  return (
    <Tabs value={sort} onValueChange={(v) => setSort(v as SiteSort)} className="bench-tabs">
      <TabsList variant="segmented" aria-label="Sort sites">
        {siteSorts.map((s) => (
          <TabsTrigger key={s.id} value={s.id}>
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {siteSorts.map((s) => {
        const sorted = [...eligible].sort(s.sort);
        const shown = all ? sorted : sorted.slice(0, SITE_ROWS);
        return (
          <TabsContent key={s.id} value={s.id}>
            <Table
              className="bench-pairs-table bench-site-table"
              label={`Sites sorted by ${s.label.toLowerCase()}`}
              headers={["Site", "Pages", ...order.map(providerName), "Median gap"]}
              rows={shown.map((site) => {
                const bestRate = Math.max(...order.map((id) => site.providers[id].rate ?? -1));
                const fastest = Math.min(...order.map((id) => site.providers[id].p50 ?? Infinity));
                return {
                  id: site.host,
                  cells: [
                    <span key="host" className="bench-site-host">
                      {site.host}
                      <small>{categoryName(site.category)}</small>
                    </span>,
                    integer(site.pages),
                    ...order.map((id) => <SiteCell key={id} site={site} id={id} bestRate={bestRate} fastest={fastest} />),
                    seconds(site.latencyGap),
                  ],
                };
              })}
            />
          </TabsContent>
        );
      })}
      {eligible.length > SITE_ROWS && (
        <Button variant="outline" size="sm" className="self-start max-sm:min-h-11" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? `Show the top ${SITE_ROWS}` : `Show all ${integer(eligible.length)} sites`}
        </Button>
      )}
    </Tabs>
  );
}

export function ClusteredTable({ rows, order }: { rows: Clustered[]; order: ProviderId[] }) {
  return (
    <Table
      className="bench-pairs-table"
      label="Scores with site-clustered uncertainty"
      headers={["Provider", "Per-page 95% CI", "Site-clustered 95% CI", "Every site counted equally"]}
      rows={order.map((id) => {
        const c = rows.find((r) => r.id === id)!;
        return { id, cells: [<Name key={id} id={id} />, points(c.naiveCi) || "—", points(c.ci) || "—", percent(c.siteWeighted)] };
      })}
    />
  );
}

/** Where each provider's failures come from: recoverable or not, raw signals, and sites. */
export function FailureDetailTable({ rows, order }: { rows: FailureDetail[]; order: ProviderId[] }) {
  const detail = (id: ProviderId) => rows.find((r) => r.id === id)!;
  return (
    <>
      <Table
        className="bench-pairs-table"
        label="Failure detail"
        headers={["Provider", "Failed", "Others read it", "Only one to miss", "Nobody read it", "Time to fail"]}
        rows={order.map((id) => {
          const f = detail(id);
          return {
            id,
            cells: [
              <Name key={id} id={id} />,
              integer(f.failed),
              `${integer(f.recoverable)} (${percent(f.failed ? f.recoverable / f.failed : null)})`,
              integer(f.exclusive),
              integer(f.universal),
              seconds(f.failedP50),
            ],
          };
        })}
      />
      <Table
        className="bench-failure-signals"
        label="Failure signals and sites"
        headers={["Provider", "Most common signals", "Sites with the most failures (failed / pages)"]}
        rows={order.map((id) => {
          const f = detail(id);
          return {
            id,
            cells: [
              <Name key={id} id={id} />,
              <span key="signals" className="bench-signal-list">
                {f.signals.slice(0, 4).map((s) => (
                  <span key={s.signal}>
                    <code>{s.signal}</code> {integer(s.count)}
                  </span>
                ))}
              </span>,
              <span key="hosts" className="bench-signal-list">
                {f.hosts.slice(0, 4).map((h) => (
                  <span key={h.host}>
                    {h.host} {integer(h.failed)}/{integer(h.pages)}
                  </span>
                ))}
              </span>,
            ],
          };
        })}
      />
    </>
  );
}

export function FallbackTable({ pairs }: { pairs: Fallback[] }) {
  return (
    <Table
      className="bench-pairs-table"
      label="Two-provider fallbacks"
      headers={["Pair", "Either provider", "First alone", "Second alone", "Gain over the better one"]}
      rows={pairs.map((f) => ({
        id: `${f.a}-${f.b}`,
        cells: [
          `${providerName(f.a)} + ${providerName(f.b)}`,
          percent(f.rate),
          percent(f.aRate),
          percent(f.bRate),
          `+${((f.rate - Math.max(f.aRate, f.bRate)) * 100).toFixed(1)} pts`,
        ],
      }))}
    />
  );
}

export function LatencyDetail({
  budgets,
  byCategory,
  order,
}: {
  budgets: BudgetResult[];
  byCategory: LatencyByCategory[];
  order: ProviderId[];
}) {
  return (
    <Tabs defaultValue="budget" className="bench-tabs">
      <TabsList variant="segmented" aria-label="Latency detail">
        <TabsTrigger value="budget">Within a time budget</TabsTrigger>
        <TabsTrigger value="category">By category</TabsTrigger>
      </TabsList>
      <TabsContent value="budget">
        <Table
          className="bench-pairs-table"
          label="Successful within a time budget"
          headers={["Provider", ...BUDGETS_MS.map((b) => `Within ${b / 1000} s`), "Any time"]}
          rows={order.map((id) => {
            const b = budgets.find((r) => r.id === id)!;
            const best = BUDGETS_MS.map((_, i) => Math.max(...budgets.map((r) => r.rates[i] ?? -1)));
            return {
              id,
              cells: [
                <Name key={id} id={id} />,
                ...b.rates.map((rate, i) => (
                  <span key={i} className={cn(rate != null && rate === best[i] && "is-best")}>
                    {percent(rate)}
                  </span>
                )),
                percent(b.any),
              ],
            };
          })}
        />
      </TabsContent>
      <TabsContent value="category">
        <Table
          className="bench-pairs-table"
          label="Median and p95 latency by category"
          headers={["Category", ...order.map(providerName)]}
          rows={byCategory.map((c) => {
            const fastest = Math.min(...order.map((id) => c.providers[id].p50 ?? Infinity));
            return {
              id: c.id,
              cells: [
                categoryName(c.id),
                ...order.map((id) => (
                  <span key={id} className="bench-site-cell">
                    <span className={cn(c.providers[id].p50 === fastest && "is-best")}>{seconds(c.providers[id].p50)}</span>
                    <small>p95 {seconds(c.providers[id].p95)}</small>
                  </span>
                )),
              ],
            };
          })}
        />
      </TabsContent>
    </Tabs>
  );
}
