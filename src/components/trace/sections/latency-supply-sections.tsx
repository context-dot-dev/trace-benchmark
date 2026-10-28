"use client";

import { count, seconds } from "@/lib/trace/format";
import { cn } from "@/lib/utils";

import { TabbedPanel } from "../panel";
import { MeterChart } from "../charts";
import { CellDetail, DataTable } from "../data-table";
import { OURS, ProviderName } from "../provider-logo";
import type { ReportModel } from "../report-model";
import { Fine, Notes, ReportSection, SubHeading, TextLink } from "../report-section";

const formatSeconds = (value: number) => `${value.toFixed(2)}s`;

export function LatencySection({ model }: { model: ReportModel }) {
  const median = model.rows.map((row) => ({ id: row.id, name: row.name, value: row.p50 }));
  const tail = model.rows.map((row) => ({ id: row.id, name: row.name, value: row.p95 }));
  return (
    <ReportSection
      id="efficiency"
      title="Latency"
      description="Timing starts when the API request begins and ends after the complete response arrives. It includes provider failures, excludes judging and account/configuration errors, and uses the same 30-second deadline. P95 is unstable for small samples."
    >
      <TabbedPanel
        label="Latency view"
        tabs={[
          {
            id: "chart",
            label: "Chart",
            content: (
              <>
                <div className="grid items-end gap-10 lg:grid-cols-2">
                  <div className="flex flex-col gap-4">
                    <SubHeading>Median latency</SubHeading>
                    <p className="text-body-sm text-fg-muted">Seconds, all timed requests · lower is better</p>
                    <MeterChart data={median} format={formatSeconds} xTitle="Median time to content (seconds)" tipSuffix=" median" />
                  </div>
                  <div className="flex flex-col gap-4">
                    <SubHeading>Tail latency</SubHeading>
                    <p className="text-body-sm text-fg-muted">95th percentile, seconds · lower is better</p>
                    <MeterChart data={tail} format={formatSeconds} xTitle="95th percentile time to content (seconds)" tipSuffix=" at P95" />
                  </div>
                </div>
              </>
            ),
          },
          {
            id: "table",
            label: "Table",
            content: (
              <>
                <DataTable
                  caption="Latency comparison"
                  columns={[
                    { key: "provider", label: "Provider" },
                    { key: "p50", label: "P50", align: "right" },
                    { key: "p95", label: "P95", align: "right" },
                    { key: "timed", label: "Timed requests", align: "right" },
                  ]}
                  rows={[...model.rows]
                    .sort((a, b) => (a.p50 ?? Infinity) - (b.p50 ?? Infinity))
                    .map((row) => ({
                      key: row.id,
                      cells: {
                        timed: count(row.timed),
                        provider: <ProviderName id={row.id} name={row.name} />,
                        p50: <span className={cn(row.id === OURS && "text-fg-brand")}>{seconds(row.p50)}</span>,
                        p95: <span className={cn(row.id === OURS && "text-fg-brand")}>{seconds(row.p95)}</span>,
                      },
                    }))}
                />
              </>
            ),
          },
        ]}
      />
    </ReportSection>
  );
}

export function SupplySection({ model }: { model: ReportModel }) {
  const { summary, categoryName } = model;
  const days = summary.replenishment?.days ?? [];
  const latest = days.at(-1);
  return (
    <ReportSection
      id="supply"
      title="URL"
      accent="supply"
      description="Public feeds, sitemaps and registries supply the independent sample. NEEDLE supplies changing queries, which Context Search turns into a separate stream of URLs. New pages exclude previously selected documents; controls repeat daily for 30 days; search URLs can repeat on later days."
    >
      <p className="text-body-sm text-fg-muted">
        {summary.sourceHealth?.healthy ?? 0} of {summary.sourceHealth?.total ?? 0} source endpoints succeeded at their latest poll. Failed sources remain in the registry and are
        retried on their next scheduled poll.
      </p>
      <DataTable
        caption="URL discovery supply"
        columns={[
          { key: "category", label: "Category" },
          { key: "inventory", label: "Inventory", align: "right" },
          { key: "new", label: "First seen, 24h", align: "right" },
          { key: "domains", label: "Domains", align: "right" },
        ]}
        rows={Object.entries(summary.supply ?? {}).map(([id, supply]) => ({
          key: id,
          cells: { category: categoryName(id), inventory: count(supply.inventory), new: count(supply.new_24h), domains: supply.domains },
        }))}
        footnote={
          <Notes className="text-fg-subtle">
            <p>
              “First seen” means new to this collector, not necessarily newly published. The first poll includes existing inventory. Category and domain counts do not establish
              scraping difficulty. Shortfalls are retained, without substituting easier categories.
            </p>
          </Notes>
        }
      />

      <div className="flex flex-col gap-5">
        <SubHeading>Daily URL replenishment</SubHeading>
        <Notes>
          <p>
            Measured discoveries, not a promise of 300 new pages per category per day. Each source’s entire initial inventory day is counted separately. Later arrivals may still be
            old publications or ineligible for selection. The current UTC day is partial.
          </p>
        </Notes>
        {latest ? (
          <>
            <DataTable
              caption="Daily URL replenishment"
              columns={[
                { key: "day", label: "UTC day" },
                { key: "new", label: "New arrivals", align: "right" },
                { key: "baseline", label: "Initial inventory", align: "right" },
                { key: "polls", label: "Source polls", align: "right" },
              ]}
              rows={days
                .slice(-7)
                .reverse()
                .map((day) => ({
                  key: day.day,
                  cells: {
                    day: <span className="whitespace-nowrap tabular-nums">{day.day}</span>,
                    new: count(day.new_urls),
                    baseline: count(day.baseline_urls),
                    polls: (
                      <>
                        {count(day.polls)}
                        <CellDetail>{day.failed_polls} failed</CellDetail>
                      </>
                    ),
                  },
                }))}
            />
            <Fine>
              Latest recorded day ({latest.day}), arrivals after the initial inventory day:{" "}
              {Object.entries(latest.categories)
                .map(([id, arrivals]) => `${categoryName(id)} ${count(arrivals)}`)
                .join(" · ")}
              .
            </Fine>
          </>
        ) : (
          <Fine>No daily discovery history is available yet.</Fine>
        )}
        <Fine>
          Days without recorded polls do not prove zero supply.{" "}
          <TextLink href="/data/replenishment.json" download>
            Download 90 days of category counts
          </TextLink>
          .
        </Fine>
      </div>
    </ReportSection>
  );
}
