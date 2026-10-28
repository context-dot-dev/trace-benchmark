"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { percent, usd, usdRange } from "@/lib/trace/format";
import { PRICING_CATALOG, VOLUME_OPTIONS, type PricingScenario, type ProviderPrice } from "@/lib/trace/pricing";

import { Choice } from "../choice";
import { CellDetail, DataTable } from "../data-table";
import { TabbedPanel } from "../panel";
import { ProviderName } from "../provider-logo";
import { ControlLabel, Controls, Notes, ReportSection, TextLink } from "../report-section";
import { ValueScatter } from "../value-scatter";

export function PricingSection({
  prices,
  scenario,
  onScenarioChange,
}: {
  prices: ProviderPrice[];
  scenario: PricingScenario;
  onScenarioChange: (change: Partial<PricingScenario>) => void;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const pages = scenario.monthlyPages;
  const custom = scenario.selection === "custom";
  const hasPricedResults = prices.some((price) => price.comparisonPrice !== null && price.quality !== null);

  return (
    <ReportSection
      id="pricing"
      title="Quality vs."
      accent="cost"
      description="Compare useful-content scores with estimated cost for the same workload; providers toward the top left return more useful content at a lower price."
    >
      <div className="flex flex-col gap-5">
        <Controls>
          <Choice
            label="Pricing comparison"
            value={scenario.selection}
            onValueChange={(selection) => onScenarioChange({ selection })}
            options={[
              { value: "lowest", label: "Lowest-cost plans" },
              { value: "custom", label: "Custom scenario" },
            ]}
          />
          <Choice
            label="Pricing billing period"
            value={scenario.billing}
            onValueChange={(billing) => onScenarioChange({ billing })}
            options={[
              { value: "monthly", label: "Monthly billing" },
              { value: "annual", label: "Annual billing" },
            ]}
          />
          {custom && (
            <Choice
              label="Cost calculation"
              value={scenario.basis}
              onValueChange={(basis) => onScenarioChange({ basis })}
              options={[
                { value: "workload", label: "At your volume" },
                { value: "allowance", label: "Full allowance" },
              ]}
            />
          )}
        </Controls>
        <Controls>
          <ControlLabel>Attempts / month</ControlLabel>
          <Choice
            label="Monthly page volume"
            value={String(pages)}
            onValueChange={(value) => onScenarioChange({ monthlyPages: Number(value) })}
            options={VOLUME_OPTIONS.map((volume) => ({ value: String(volume), label: volume.toLocaleString("en-US") }))}
          />
        </Controls>
        <Notes>
          <p>
            {custom
              ? "Custom scenario: prices reflect your selected plans and may include unused capacity."
              : "Lowest-cost plans for the same workload. Plans include subscription minimums and top-ups, using estimated billable usage."}
          </p>
          <p>
            {scenario.basis === "allowance"
              ? "Full-allowance rate: assumes full credit utilization, then applies the sample’s billable usage."
              : "Failed requests follow billing evidence; a charged page can still be unusable."}{" "}
            <span className={pages === 93_000 ? undefined : "invisible"} aria-hidden={pages !== 93_000}>
              93,000 attempts = 3,000 a day in a 31-day month.
            </span>
          </p>
        </Notes>
      </div>

      {custom && (
        <div className="flex flex-col gap-3">
          {PRICING_CATALOG.filter((provider) => provider.plans.some((plan) => plan.annual)).map((provider) => (
            <div key={provider.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ProviderName id={provider.id} name={provider.name} className="w-28 text-body-sm" />
              <Choice
                label={`${provider.name} pricing plan`}
                size="sm"
                value={scenario.plans[provider.id]}
                onValueChange={(plan) => onScenarioChange({ plans: { ...scenario.plans, [provider.id]: plan } })}
                options={provider.plans.filter((plan) => plan.annual).map((plan) => ({ value: plan.name, label: plan.name }))}
              />
            </div>
          ))}
        </div>
      )}

      <TabbedPanel
        label="Quality and cost view"
        footer={
          hasPricedResults ? (
            <p className="text-body-sm leading-relaxed text-fg-muted">
              Points use the upper cost estimate. Horizontal lines show the modeled cost range, and vertical lines show pending judgments.
            </p>
          ) : undefined
        }
        tabs={[
          {
            id: "chart",
            label: "Chart",
            content: (
              <>
                <ValueScatter prices={prices} selectedId={selected} onSelect={setSelected} />
                {prices
                  .filter((price) => price.comparisonPrice === null && price.quality !== null)
                  .map((price) => (
                    <p key={price.id} className="text-caption text-fg-subtle">
                      {price.name} is not plotted: billing evidence or the selected tariff is incomplete.
                    </p>
                  ))}
              </>
            ),
          },
          {
            id: "table",
            label: "Table",
            content: (
              <>
                <DataTable
                  caption="Plan-specific scraping prices"
                  minWidth="min-w-120"
                  framed={false}
                  columns={[
                    { key: "provider", label: "Provider & plan", className: "min-w-48" },
                    { key: "attempts", label: "Estimated / 1k attempts", align: "right" },
                    { key: "quality", label: "Useful content", align: "right" },
                    { key: "useful", label: "Estimated / 1k useful", align: "right" },
                  ]}
                  rows={prices.map((price) => ({
                    key: price.id,
                    cells: {
                      provider: (
                        <>
                          <ProviderName id={price.id} name={price.name} />
                          <CellDetail className="mt-1">
                            {price.plan.name}
                            {price.plan.annual ? ` · ${scenario.billing}` : ""}
                          </CellDetail>
                          <CellDetail>
                            {price.comparisonPrice === null ? "Billing incomplete" : `${usdRange(price.quoteLow.monthly, price.quote.monthly)}/mo`}
                            {price.quote.commitment === null ? "" : ` · ${usd(price.quote.commitment)} yearly upfront`}
                          </CellDetail>
                        </>
                      ),
                      attempts: <span className="whitespace-nowrap">{usdRange(price.comparisonPriceLow, price.comparisonPrice)}</span>,
                      quality: price.quality === null ? "Unavailable" : percent(price.quality),
                      useful: (
                        <>
                          <span className="whitespace-nowrap">{usdRange(price.usefulPriceLow, price.usefulPrice)}</span>
                          {price.comparisonPrice !== null && price.usefulPrice === null && <CellDetail>Useful-content score unavailable</CellDetail>}
                        </>
                      ),
                    },
                  }))}
                  footnote="Estimates, not invoices. Ranges include pending judgments and missing charges modeled at zero to one base charge."
                />
              </>
            ),
          },
        ]}
      />

      <details className="group max-w-(--ds-layout-heading) border-y border-line">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-body font-medium marker:hidden focus-visible:outline-2 focus-visible:outline-focus-ring [&::-webkit-details-marker]:hidden">
          How costs are estimated
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-muted transition-transform duration-150 group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-2 pb-2 pt-1 text-body leading-relaxed">
          <p>
            We project recorded usage onto {pages.toLocaleString("en-US")} attempts, with equal category weights when quality is balanced. Subscription minimums, unused capacity
            and whole top-up blocks still apply. Lowest-cost mode selects a paid plan at the upper usage estimate and keeps that plan for both endpoints. Full-allowance mode
            instead applies the published per-credit rate, assuming full credit utilization, to the same estimated usage.
          </p>
          <p>
            Context credits take precedence, including zero-charge failures and billed 404s. Firecrawl charges returned documents, even unusable 403/404 pages; an API failure
            returning no document costs zero. Exa’s costDollars is a provider estimate, not an invoice. Successful standard requests without usage are modeled at the base rate;
            Keenable uses the account-verified $4 per 1,000 live fetches.
          </p>
          <p>
            For calls without known failure billing, the range assumes zero to one base charge. This is a scenario range, not a guaranteed invoice bound. Timeouts are not assumed
            free. Unknown special tariffs and incomplete/account-blocked samples suppress workload projections. Free credits, discounts, extras, taxes and operating costs are
            excluded consistently.
          </p>
          <p>
            Useful-page cost divides the cost estimate by confirmed useful content, with pending judgments included only in the lower endpoint. Changing pricing does not change the
            measured results or imply collection on that plan. Content recovery does not establish factual accuracy.
          </p>
          {prices.map((price) => (
            <p key={price.id}>
              <span className="text-fg">{price.name}:</span>{" "}
              {price.billing
                ? `${price.billing.reported} reported credit amounts; ${price.billing.estimated} provider cost estimates; ${price.billing.documented} documented no-result/404 charges; ${price.billing.modeled} base-rate estimates; ${price.billing.unknown} unknown charges; ${price.billing.unavailable} unavailable attempts or tariffs.`
                : "No per-request billing evidence in this publication; assumes one base charge per attempt."}
            </p>
          ))}
          <p>
            Plan prices checked September 30, 2026; failure billing reviewed October 14, 2026. <TextLink href="#pricing-details">Plans & billing evidence</TextLink> ·{" "}
            <TextLink href="/pricing.json" download>
              Download published prices
            </TextLink>
          </p>
        </div>
      </details>
    </ReportSection>
  );
}
