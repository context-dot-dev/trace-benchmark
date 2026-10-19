"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { collectionRange, count, percent, seconds } from "@/lib/trace/format";
import type { CohortId, SampleRole } from "@/lib/trace/types";
import { cn } from "@/lib/utils";

import { Choice } from "../choice";
import { CellDetail, DataTable, type SortState } from "../data-table";
import { ScoreColumns } from "../charts";
import { OURS, ProviderName } from "../provider-logo";
import type { ReportModel } from "../report-model";
import { Controls, Notes, ReportSection, SubHeading, TextLink } from "../report-section";

// A note that interrupts the results sits in the site's ringed card, like every other card on the page.
const NOTICE = "m-2 max-w-(--ds-layout-heading) rounded-card bg-surface px-4 py-3 text-body-sm leading-relaxed text-fg-muted shadow-[0_0_0_1px_var(--ds-color-border-hairline),0_0_0_var(--ds-space-2)_var(--ds-color-ring-tint)]";

function AccountNotices({ model }: { model: ReportModel }) {
  const affected = model.rows.filter((row) => row.accountAffected > 0);
  if (!affected.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {affected.map((row) => (
        <p key={row.id} role="status" className={NOTICE}>
          <span className="text-fg">
            {row.name}: incomplete run — {row.creditsRejected > 0 || row.status_detail === "HTTP_402" ? "credits exhausted" : "account access failed"}.
          </span>{" "}
          {row.accountSkipped.toLocaleString("en-US")} pages skipped; {row.accountRejected} requests rejected by the account.{" "}
          {row.measuredAttempts > 0 && (
            <>
              {percent(row.attemptedUsefulRate)} useful across {row.measuredAttempts.toLocaleString("en-US")} non-account-error attempts.{" "}
            </>
          )}
          This subset is not a replacement for the full-sample comparison. The recorded coverage includes unresolved pages.{" "}
          {row.id === "firecrawl" && (
            <>
              <TextLink href="https://www.firecrawl.dev/app/settings?tab=billing">Restore Firecrawl credits</TextLink> before a new shared run.{" "}
            </>
          )}
          Original results are retained.
        </p>
      ))}
    </div>
  );
}

export function ResultsSection({
  model,
  onCohortChange,
  onRoleChange,
  sort,
  onSortChange,
  onInspectProvider,
  error,
  loading,
  onRetry,
}: {
  model: ReportModel;
  onCohortChange: (cohort: CohortId) => void;
  onRoleChange: (role: SampleRole) => void;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  onInspectProvider: (providerId: string) => void;
  error: string | null;
  loading: boolean;
  onRetry: () => void;
}) {
  const { summary, cohortId, role, cohort, hasRoles, group, rows } = model;
  const sampling = cohort?.lastCompleted?.sampling;
  const roles = sampling?.roles;
  const dailyTarget = summary.operations?.collection_profile?.daily_per_category;
  const roleNotes = hasRoles && sampling && roles
    ? (["new", "control"] as const).map((sampleRole) => {
        const panel = sampleRole === "control" && sampling.control_panel
          ? ` Panel ${sampling.control_panel.version}, fixed until ${sampling.control_panel.expires_at.slice(0, 10)} UTC.`
          : "";
        return {
          role: sampleRole,
          text: `Showing ${sampleRole} pages throughout the comparisons below. Each of eight categories has 12.5% weight. ${roles[sampleRole].shortfall} pages short of target.${panel}`,
        };
      })
    : null;
  const roleNote = roleNotes?.find((note) => note.role === role)?.text;
  const controlRoleNote = roleNotes?.find((note) => note.role === "control")?.text;

  const [view, setView] = React.useState<string | null>(null);
  const scoreData = rows.map((row) => ({
    id: row.id,
    name: row.name,
    value: row.accountAffected > 0 ? null : row.rate,
  }));

  return (
    <ReportSection
      id="quality"
      title="Which scrapers"
      accent="deliver?"
      description={
        cohortId === "independent"
          ? "How often does each scraper return the page’s main content? These URLs come from public feeds and registries."
          : "URLs found by Context Search using NEEDLE queries. This selection may favor Context, so these results are kept separate."
      }
    >
      <div className="flex flex-col gap-5">
        <Controls>
          <Choice
            label="Page set"
            value={cohortId}
            onValueChange={onCohortChange}
            options={[
              { value: "independent", label: "Independent pages" },
              { value: "needle", label: "Search-discovered pages" },
            ]}
          />
          {hasRoles && sampling?.roles && (
            <Choice
              label="Daily sample score"
              value={role}
              onValueChange={onRoleChange}
              options={[
                { value: "new", label: "New pages", count: sampling.roles.new.selected },
                { value: "control", label: "Control pages", count: sampling.roles.control.selected },
              ]}
            />
          )}
        </Controls>
        <Notes>
          <p>
            {cohortId === "needle"
              ? "Target: up to 400 search result slots per day."
              : `Target: ${dailyTarget ? (dailyTarget * 8).toLocaleString("en-US") : "—"} URLs in one daily independent run. 300 new pages + 75 control pages per category. All four providers fetch the same daily sample; shortages remain visible.`}
          </p>
          {cohortId === "independent" && <p>New pages measure breadth. Control pages measure change: the same URLs are fetched daily for 30 days, then replaced with a versioned panel. Their content can still change.</p>}
          {roleNote && controlRoleNote && (
            <div className="grid grid-cols-1">
              <p aria-hidden="true" className="invisible col-start-1 row-start-1 max-w-[85%]">
                {controlRoleNote}
              </p>
              <p className={`col-start-1 row-start-1 ${role === "control" ? "max-w-[85%]" : "max-w-full"}`}>
                {roleNote}
              </p>
            </div>
          )}
          <p>
            {group?.sampleKind === "daily"
              ? cohortId === "needle"
                ? "Latest completed daily run."
                : hasRoles
                  ? "Latest completed daily sample. Scores for new and control pages are never pooled."
                  : "Latest completed run uses the earlier sampling design; the new/control split starts with the next scheduled daily sample."
              : "Showing earlier small batches until the first daily run finishes."}
          </p>
        </Notes>
        <p role="status" className="text-body-sm text-fg-muted">
          {group
            ? `${count(group.uniqueUrls)} unique URLs · ${count(group.domains)} domains · ${group.categories} page types · ${count(group.count)} recorded page tests. ${
                group.first ? `Collected ${collectionRange([group.first, group.last])} (UTC).` : "Awaiting the first completed run under the new scoring protocol."
              }`
            : "Loading published results…"}
        </p>
      </div>

      {error && (
        <div role="alert" className={cn(NOTICE, "flex flex-wrap items-center justify-between gap-3")}>
          <span>
            <span className="text-fg">Could not check for newer results.</span> The last loaded results are still shown.
          </span>
          <Button size="sm" variant="outline" disabled={loading} onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      <AccountNotices model={model} />

      <DataTable
        caption="Provider content results"
        sort={sort}
        onSortChange={onSortChange}
                columns={[
          { key: "name", label: "Provider", sortable: true },
          { key: "rate", label: "Useful", align: "right", sortable: true },
          { key: "p50", label: "Time", align: "right", sortable: true },
          { key: "inspect", label: <span className="sr-only">Inspect</span>, align: "right", className: "hidden w-12 sm:table-cell" },
        ]}
        rows={rows.map((row) => ({
          key: row.id,
          cells: {
            name: (
              <button type="button" onClick={() => onInspectProvider(row.id)} className="rounded-sm text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" aria-label={`${row.name}: inspect results`}>
                <ProviderName id={row.id} name={row.name} className="text-body" />
              </button>
            ),
            rate: (
              <>
                <span className={cn("text-body-lg leading-none", row.id === OURS ? "text-fg-brand" : "text-fg")}>{row.accountAffected > 0 ? "Incomplete" : percent(row.rate)}</span>
                {row.accountAffected > 0 && <CellDetail>{percent(row.rate)} confirmed coverage</CellDetail>}
                <CellDetail className="whitespace-nowrap">
                  {count(row.success)} / {count(row.count)}
                  <span className="max-sm:hidden"> pages</span>
                </CellDetail>
                {row.balanced && <CellDetail className="whitespace-nowrap">{row.categoriesPresent}/8 categories</CellDetail>}
                {row.unknown > 0 && (
                  <CellDetail>
                    {row.unknown} unresolved · up to {percent(row.upper)}
                  </CellDetail>
                )}
              </>
            ),
            p50: <span className="text-body-lg leading-none">{seconds(row.p50)}</span>,
            inspect: (
              <Button variant="ghost" size="icon" className="-my-1.5" aria-label={`Inspect ${row.name} results`} title={`Inspect ${row.name} results`} onClick={() => onInspectProvider(row.id)}>
                <ArrowRight />
              </Button>
            ),
          },
        }))}
        empty={loading ? "Loading observations…" : "No collection loaded."}
        footnote={
          <>
            {hasRoles
              ? "Useful = the mean of eight category rates, each measuring matching, substantive content / selected pages. Missing categories withhold the score. Page counts below each score are raw totals."
              : "Useful = pages with matching, substantive content / all selected page tests."}{" "}
            Partial content can qualify. <span className="inline-block whitespace-nowrap">Time = median request duration. <TextLink href="#methodology">Scoring details</TextLink></span>
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <Choice
          label="Scraping view"
          value={view ?? "charts"}
          onValueChange={setView}
          options={[
            { value: "charts", label: "Charts" },
            { value: "table", label: "Table" },
          ]}
        />
        <div className="flex flex-col gap-3">
          <SubHeading>Confirmed useful content</SubHeading>
          <p className="text-body-sm text-fg-muted">{hasRoles ? "Eight equally weighted category rates, including unresolved" : "Share of all page tests, including unresolved"} · higher is better</p>
        </div>
        <div className="grid grid-cols-1">
          <div className={`col-start-1 row-start-1 ${view === "table" ? "invisible pointer-events-none" : ""}`} aria-hidden={view === "table"} inert={view === "table"}>
            <div className="min-w-0 w-full">
              <ScoreColumns data={scoreData} xTitle="Provider" yTitle="Useful content (%)" />
            </div>
          </div>
          <div className={`col-start-1 row-start-1 flex flex-col justify-center ${view === "table" ? "" : "invisible pointer-events-none"}`} aria-hidden={view !== "table"} inert={view !== "table"}>
            <DataTable
              caption="Confirmed useful content"
              columns={[{ key: "provider", label: "Provider" }, { key: "useful", label: "Useful", align: "right" }]}
              rows={scoreData.map((row) => ({ key: row.id, cells: { provider: <ProviderName id={row.id} name={row.name} />, useful: row.value === null ? "—" : percent(row.value) } }))}
            />
          </div>
        </div>
      </div>
    </ReportSection>
  );
}
