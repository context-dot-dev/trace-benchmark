"use client";

import * as React from "react";

import { count, isNumber, runStart, usd, usdRange } from "@/lib/trace/format";
import { PRICING_CATALOG, planMonthlyLabel, quotePlan, unitPrice, type PricedProvider, type PricingScenario, type ProviderPrice } from "@/lib/trace/pricing";
import type { ProviderRow, Run, Summary } from "@/lib/trace/types";

import { CellDetail, DataTable } from "../data-table";
import { ProviderName } from "../provider-logo";
import { Fine, Notes, SubHeading, TextLink } from "../report-section";

const FRESH_SETTING: Record<string, string> = { context: "maxAgeMs = 0", exa: "maxAgeHours = 0", firecrawl: "maxAge = 0", keenable: "live = true" };

export function FreshRetrieval({ rows }: { rows: ProviderRow[] }) {
  return (
    <div className="flex flex-col gap-5">
      <SubHeading id="fresh-retrieval">Fresh retrieval</SubHeading>
      <Notes>
        <p>
          Every selected page is requested fresh, with one attempt and the same 30-second deadline. “Unreported” means the provider did not supply usable cache evidence. A reported cache hit remains unresolved, not a fresh-content success.
          Firecrawl also receives storeInCache=false.
        </p>
      </Notes>
      <DataTable
        caption="Provider freshness audit"
        minWidth="min-w-112"
        columns={[
          { key: "provider", label: "Provider" },
          { key: "setting", label: "Request setting" },
          { key: "fresh", label: "Fresh", align: "right" },
          { key: "unreported", label: "Unreported", align: "right" },
        ]}
        rows={rows.map((row) => ({
          key: row.id,
          cells: {
            provider: <ProviderName id={row.id} name={row.name} />,
            setting: (
              <>
                <code className="rounded-sm bg-subtle px-1.5 py-0.5 text-body-sm">{FRESH_SETTING[row.id] ?? "—"}</code>
                <CellDetail className="mt-1">
                  {row.freshness?.requested ?? 0}/{row.observed} requests verified
                </CellDetail>
              </>
            ),
            fresh: (
              <>
                {row.freshness?.reportedFresh ?? 0}
                <CellDetail>{row.freshness?.reportedCached ?? 0} cache hits</CellDetail>
              </>
            ),
            unreported: row.freshness?.unreported ?? 0,
          },
        }))}
      />
      <details className="max-w-(--ds-layout-heading) border-t border-line">
        <summary className="min-h-11 cursor-pointer list-none py-3 text-body font-normal">Content judgment details</summary>
        <div className="flex flex-col gap-2 pb-4 text-body leading-relaxed">
            {rows.map((row) => (
              <p key={row.id}>
                <span className="text-fg">{row.name}:</span>{" "}
                {row.unknown
                  ? Object.entries(row.unresolvedCauses ?? {})
                      .map(([cause, total]) => `${total} ${cause.replaceAll("_", " ")}`)
                      .join("; ")
                  : row.count
                    ? "All selected results resolved."
                    : "Awaiting the first completed run."}
              </p>
            ))}
        </div>
      </details>
    </div>
  );
}

function PlanTable({ provider, billing }: { provider: PricedProvider; billing: PricingScenario["billing"] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <ProviderName id={provider.id} name={provider.name} className="text-h5" logoClassName="size-5" />
        <p className="text-body-sm leading-relaxed text-fg-muted">
          {provider.endpoint} · <TextLink href={provider.source}>Official pricing</TextLink>
          {provider.billingSource && (
            <>
              {" "}
              · <TextLink href={provider.billingSource}>Billing rules</TextLink>
            </>
          )}{" "}
          · Checked {provider.checked}
        </p>
      </div>
      <DataTable
        caption={`${provider.name} plans and rates`}
        minWidth="min-w-136"
        columns={[
          { key: "plan", label: "Plan & commitment" },
          { key: "credits", label: "Credits / mo", align: "right" },
          { key: "base", label: "Base / 1k pages", align: "right" },
          { key: "extra", label: "Extra / 1k credits", align: "right" },
        ]}
        rows={provider.plans.map((plan) => {
          const quote = quotePlan(plan, billing);
          return {
            key: plan.name,
            cells: {
              plan: (
                <>
                  <span className="text-fg">{plan.name}</span>
                  <CellDetail>{plan.custom ? "Custom quote" : isNumber(plan.perThousand) ? "No subscription" : `${usd(planMonthlyLabel(plan, billing))}/mo`}</CellDetail>
                  {quote.commitment !== null && <CellDetail>{usd(quote.commitment)}/year upfront</CellDetail>}
                  {plan.concurrency && (
                    <CellDetail>
                      {plan.concurrency} concurrent{plan.rpm ? ` · ${plan.rpm.toLocaleString("en-US")} req/min` : ""}
                    </CellDetail>
                  )}
                </>
              ),
              credits: isNumber(plan.included) ? plan.included.toLocaleString("en-US") : "—",
              base: plan.monthly === 0 ? "Limited free tier" : usd(unitPrice(plan, billing), 3),
              extra: (
                <>
                  {plan.block ? usd((plan.blockUsd! / plan.block) * 1000) : plan.custom ? "Unknown" : isNumber(plan.perThousand) ? "Same rate" : "Unavailable"}
                  {plan.block && (
                    <CellDetail>
                      {usd(plan.blockUsd)} per {plan.block.toLocaleString("en-US")}-credit block
                    </CellDetail>
                  )}
                </>
              ),
            },
          };
        })}
        footnote={<span>{provider.notes}</span>}
      />
    </div>
  );
}

export function PricingDetails({ rows, prices, scenario }: { rows: ProviderRow[]; prices: ProviderPrice[]; scenario: PricingScenario }) {
  const pages = scenario.monthlyPages;
  return (
    <div id="pricing-details" className="flex scroll-mt-24 flex-col gap-12">
      <div className="flex flex-col gap-5">
        <SubHeading>Pricing methodology</SubHeading>
        <Notes>
          <p>
            <TextLink href="https://github.com/keenableai/needle/blob/main/dashboard/index.html">NEEDLE’s pricing catalog</TextLink> stores a price, plan and check date for each engine and describes its comparison as the biggest self-serve tier,
            excluding enterprise quotes. Scraping Bench offers that full-allowance comparison alongside the cost of your actual workload, using the same billing period across subscriptions. Lowest-cost mode recalculates every provider’s plan from
            estimated billable volume when the sample, volume or billing changes. Manual plans and full-allowance rates are available only in Custom scenario. The default compares 93,000 monthly attempts; this is a cost fit, not a throughput
            recommendation. Search prices are not scraping prices. The plan and billing selections in <TextLink href="#pricing">Useful content and estimated cost</TextLink> also apply below.
          </p>
        </Notes>
      </div>

      <div className="flex flex-col gap-5">
        <SubHeading>Budget for {pages.toLocaleString("en-US")} pages a month</SubHeading>
        <Notes>
          <p>
            {pages.toLocaleString("en-US")} submitted attempts per month, per provider, using the selected sample’s billing evidence. Estimates, not invoices. This includes unused capacity and whole top-up blocks. Full-allowance rates instead
            assume every included credit is used.
          </p>
        </Notes>
        <DataTable
          caption="Selected plan monthly budgets"
          columns={[
            { key: "provider", label: "Provider & plan" },
            { key: "monthly", label: "Monthly spend", align: "right" },
            { key: "blended", label: "Blended / 1k pages", align: "right" },
          ]}
          rows={prices.map((price) => ({
            key: price.id,
            cells: {
              provider: (
                <>
                  <ProviderName id={price.id} name={price.name} />
                  <CellDetail className="mt-1">{price.plan.name}</CellDetail>
                </>
              ),
              monthly: (
                <>
                  {price.comparisonPrice === null ? "Unavailable" : usdRange(price.quoteLow.monthly, price.quote.monthly)}
                  {price.quote.commitment !== null && <CellDetail>{usd(price.quote.commitment)}/year upfront</CellDetail>}
                  {(price.quote.extra ?? 0) > 0 && <CellDetail>Includes {usd(price.quote.extra)} top-ups</CellDetail>}
                </>
              ),
              blended:
                price.comparisonPrice === null
                  ? "Unavailable"
                  : usdRange(price.quoteLow.monthly === null ? null : (price.quoteLow.monthly / pages) * 1000, price.quote.monthly === null ? null : (price.quote.monthly / pages) * 1000),
            },
          }))}
          footnote="Annual fees are amortized across 12 months; included credits still renew monthly. Assumes no opening balance, rollover, free credits or promotional discounts, and top-ups enabled. Failure billing and special URL charges can change the invoice. Excludes search, judging, hosting, taxes and extra formats. A plan’s throughput limits may prevent a five-minute run."
        />
      </div>

      <div className="flex flex-col gap-5">
        <SubHeading>Reported usage</SubHeading>
        <DataTable
          caption="Reported API costs"
          columns={[
            { key: "provider", label: "Provider" },
            { key: "usd", label: "USD subtotal", align: "right" },
            { key: "credits", label: "Credits subtotal", align: "right" },
            { key: "useful", label: "Reported / 1k useful", align: "right" },
          ]}
          rows={rows.map((row) => ({
            key: row.id,
            cells: {
              provider: <ProviderName id={row.id} name={row.name} />,
              usd: (
                <>
                  {usd(row.cost_usd, 3)}
                  <CellDetail>
                    {row.cost_known}/{row.count} pages reported{row.cost_known > 0 && row.cost_known < row.count ? " · partial" : ""}
                  </CellDetail>
                </>
              ),
              credits: (
                <>
                  {isNumber(row.credits) ? row.credits.toLocaleString("en-US") : "Unknown"}
                  <CellDetail>
                    {row.credits_known}/{row.count} pages reported{row.credits_known > 0 && row.credits_known < row.count ? " · partial" : ""}
                  </CellDetail>
                </>
              ),
              useful: row.unknown === 0 ? usd(row.costPerUseful, 3) : "Unknown",
            },
          }))}
          footnote="Provider-reported usage for the selected page set, not the account invoice. Exa dollar amounts are estimates, not settled charges. Missing receipts stay unknown, including timed-out requests that may still be billed. Credits are provider-specific; they are not converted to dollars at a hypothetical plan rate. Reported cost per useful page requires USD estimates for every selected page and fully resolved judgments. Subscription fees absent from receipts and operational costs are excluded."
        />
      </div>

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-5">
          <SubHeading id="published-plans">Plans & rates</SubHeading>
          <Notes>
            <p>Included-credit rates and overage rates are different. The first assumes full use of the subscription; the second applies only after that allowance runs out. Free tiers are bounded allowances, not sustainable zero-cost tariffs.</p>
          </Notes>
        </div>
        {PRICING_CATALOG.map((provider) => (
          <PlanTable key={provider.id} provider={provider} billing={scenario.billing} />
        ))}
      </div>
    </div>
  );
}

const METHODOLOGY: [string, React.ReactNode][] = [
  [
    "One daily sample.",
    <>
      The target is 300 previously untested pages and 75 control pages in each of eight categories: up to 3,000 pages total. Controls are frozen for 30 UTC days, with versioned replacements excluding the previous panel. Short panels stay short
      until replacement; failed controls are not swapped out. All providers fetch both roles fresh. Equal-category scores are reported separately, and no entire accumulated archive is re-fetched. New pages exclude known aliases selected in any
      earlier run. Inspired by <TextLink href="https://keenableai.github.io/needle/">NEEDLE</TextLink>, Scraping Bench collects URLs from changing public sources instead of relying on a fixed test set. Independent pages cover news, commerce, jobs,
      finance, research, government, software, and community sites.
    </>,
  ],
  [
    "Same task.",
    "Every reader receives the same selected URL with a 30-second deadline and a 250,000-character text limit. Their returned text, errors, and timings are saved. Each provider receives its fresh-fetch setting: maxAgeMs=0, maxAgeHours=0, maxAge=0, or live=true. Provider-reported cache evidence is tracked separately; origin freshness is not independently verified.",
  ],
  [
    "Content checks.",
    "The judge checks page identity and substantive content. The v3 protocol first checks a 12,000-character sample. If it finds no useful match, overlapping chunks cover the remaining returned text. A negative requires a completed full-text review; judge errors and ambiguous content remain unresolved. Earlier protocol results remain in the downloads and are excluded from v3 comparisons. For the daily sample, unresolved bounds are calculated within each category and averaged with equal weight.",
  ],
  [
    "Scoring.",
    "A model grades the returned text without seeing the provider’s name. Factual accuracy has not been independently verified. Unresolved results stay in the denominator; timings include failed requests. The collected mix of sites affects the ranking. New runs compare fresh provider outputs directly without rendering a reference browser. Pairwise Jev preferences identify the best observed output, including ties. No useful output means unknown recoverability, not an impossible page. A comparison requires resolved content judgments for every provider, fresh-fetch requests, no reported cache hits and request starts within 120 seconds. Conflicting preferences remain unresolved. Providers with missing observations remain in the denominator. Entire batches invalidated by a collector fault are excluded for every provider, with reasons and raw results retained in the downloads.",
  ],
  [
    "Output comparison.",
    "Each useful output contributes up to 12,000 characters from the beginning, middle and end. Pairwise choices below 0.75 model confidence remain unresolved; this threshold is provisional. A winner must beat or tie every other useful output. This measures sampled preference, not factual accuracy or complete-page recall. Identical text ties without a model call; a sole useful response is reported separately.",
  ],
  [
    "Reproducibility.",
    "Each run freezes its URLs, provider set, configuration and code hashes before requests begin. Raw API responses and comparison receipts are retained privately. Historical browser captures remain in the archive. The public manifests and result hashes let others audit the selection and rerun the same URLs. Live pages can change.",
  ],
];

export function Methodology() {
  return (
    <div className="flex flex-col gap-6">
      <SubHeading id="methodology">Methodology & data</SubHeading>
      <dl className="grid max-w-(--ds-layout-heading) gap-5">
        {METHODOLOGY.map(([term, body]) => (
          <div key={term} className="grid gap-1 border-t border-line-subtle pt-4 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-6">
            <dt className="text-body text-fg">{term}</dt>
            <dd className="text-body-sm leading-relaxed text-fg-muted">{body}</dd>
          </div>
        ))}
      </dl>
      <Fine>
        Operated by Context, one of the providers being compared. <TextLink href="/plan.md">Protocol</TextLink> · <TextLink href="https://github.com/context-dot-dev/trace-benchmark">GitHub (private)</TextLink> ·{" "}
        <TextLink href="/data/latest.json" download="trace-full-data.json">
          Download recent results
        </TextLink>
      </Fine>
    </div>
  );
}

const RUN_KIND: Record<string, string> = { rerun: "Rerun", daily_selection: "Daily selection", query_selection: "Search selection", earlier_batch: "Earlier batch" };
const RUN_COHORT: Record<string, string> = { independent: "Independent", needle: "Search", repeat: "Repeat" };

function RunDetail({ run, categoryName }: { run: Run; categoryName: (id: string) => string }) {
  const sampling = run.sampling;
  return (
    <div aria-live="polite" className="flex flex-col gap-4 rounded-card bg-subtle p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <h4 className="text-body font-medium leading-snug text-fg">
          {runStart(run.started_at)} UTC · {RUN_KIND[sampling?.kind ?? ""] ?? "Run"}
        </h4>
        <p className="text-body-sm text-fg-muted">
          <span className="capitalize">{run.status}</span> ·{" "}
          <TextLink href={`/${run.manifest_url}`} download>
            Download this run
          </TextLink>
          {run.exclusion && ` · Excluded: ${run.exclusion.reason}`}
        </p>
      </div>
      {sampling ? (
        <>
          <Notes>
            {sampling.roles && sampling.control_panel && (
              <p>
                One daily sample: {count(sampling.roles.new.selected)} new pages / {count(sampling.roles.new.target)} target · {count(sampling.roles.control.selected)} controls / {count(sampling.roles.control.target)} target. Panel{" "}
                <code className="text-body-sm">{sampling.control_panel.version}</code>, fixed until {sampling.control_panel.expires_at.slice(0, 10)} UTC. Controls may be first-time URLs on their first day.
              </p>
            )}
            {sampling.parent_run_id && (
              <p>
                Re-tests an earlier panel. This is not a fresh-supply run.{" "}
                <TextLink href={`/data/runs/${sampling.parent_run_id}.json`} download>
                  Original panel
                </TextLink>
              </p>
            )}
            <p>
              Publication age at run start, from source metadata: <strong className="font-normal text-fg">{count(sampling.publication_age.within_24h)}</strong> within 24h ·{" "}
              <strong className="font-normal text-fg">{count(sampling.publication_age.one_to_seven_days)}</strong> 1–7 days · <strong className="font-normal text-fg">{count(sampling.publication_age.older_than_seven_days)}</strong> older than 7
              days · <strong className="font-normal text-fg">{count(sampling.publication_age.unknown)}</strong> unknown · <strong className="font-normal text-fg">{count(sampling.publication_age.future)}</strong> future-dated.
            </p>
          </Notes>
          <DataTable
            caption="Selected run categories"
            minWidth="min-w-136"
            columns={[
              { key: "category", label: "Category" },
              { key: "selected", label: "Selected / target", align: "right" },
              { key: "split", label: sampling.roles ? "New / control" : "First / repeat", align: "right" },
              { key: "shortfall", label: "Shortfall", align: "right" },
            ]}
            rows={Object.entries(sampling.categories).map(([id, category]) => ({
              key: id,
              cells: {
                category: categoryName(id),
                selected: `${count(category.selected)} / ${count(category.target)}`,
                split: sampling.roles ? (
                  <>
                    {count(sampling.roles.new.categories[id]?.selected)} / {count(sampling.roles.control.categories[id]?.selected)}
                    <CellDetail>
                      Short: {count(sampling.roles.new.categories[id]?.shortfall)} / {count(sampling.roles.control.categories[id]?.shortfall)}
                    </CellDetail>
                  </>
                ) : (
                  `${count(category.first_time)} / ${count(category.repeated)}`
                ),
                shortfall: count(category.shortfall),
              },
            }))}
          />
        </>
      ) : (
        <Fine>Sampling provenance is unavailable in this older export.</Fine>
      )}
    </div>
  );
}

export function RunSamples({ summary, categoryName }: { summary: Summary; categoryName: (id: string) => string }) {
  const runs = summary.runs;
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? runs.find((run) => run.cohort === "independent") ?? runs[0];
  return (
    <div id="runs" className="flex scroll-mt-24 flex-col gap-5">
      <SubHeading>Run samples</SubHeading>
      <Notes>
        <p>
          First-time means a URL or known document alias was never selected in an earlier run, across both page sets. A new selection can be an old page. Counts describe selected tasks, including failed requests. Select a row to inspect its
          categories and publication ages.
        </p>
      </Notes>
      <DataTable
        caption="Run sample history"
        minWidth="min-w-136"
        onRowSelect={setSelectedId}
        columns={[
          { key: "run", label: "Run · UTC" },
          { key: "pages", label: "Pages", align: "right" },
          { key: "first", label: "First-time", align: "right" },
          { key: "repeat", label: "Repeat", align: "right" },
          { key: "shortfall", label: "Shortfall", align: "right" },
        ]}
        rows={runs.map((run) => ({
          key: run.id,
          selected: run.id === selected?.id,
          cells: {
            run: (
              <>
                <span className="text-body">{runStart(run.started_at)}</span>
                <CellDetail>
                  {RUN_COHORT[run.cohort] ?? run.cohort} · {RUN_KIND[run.sampling?.kind ?? ""] ?? "Unclassified"}
                </CellDetail>
              </>
            ),
            pages: count(run.selected_count),
            first: count(run.sampling?.first_time_urls),
            repeat: count(run.sampling?.repeated_urls),
            shortfall: count(run.sampling?.shortfall),
          },
        }))}
      />
      {selected && <RunDetail run={selected} categoryName={categoryName} />}
      <Fine>
        The daily target is 300 new + 75 control pages per category. Earlier runs targeted 375 new pages. Missing new-page supply is never filled with repeats or other categories; control shortfalls stay fixed for the panel’s 30-day lifetime.
        Reruns and search selections have no fresh-supply quota (—).{" "}
        <TextLink href="/data/run-sampling.json" download>
          Download sampling history for every run
        </TextLink>
        .
      </Fine>
    </div>
  );
}
