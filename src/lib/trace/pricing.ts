import catalog from "@/data/pricing-catalog.json";

import type { Billing, ProviderRow } from "./types";

// A faithful port of the original Trace pricing model, so every estimate on this page matches the published one.

export type Plan = {
  name: string;
  monthly?: number;
  annual?: number;
  included?: number;
  block?: number;
  blockUsd?: number;
  perThousand?: number;
  concurrency?: number;
  rpm?: number;
  custom?: boolean;
};

export type PricedProvider = {
  id: string;
  name: string;
  checked: string;
  source: string;
  billingSource?: string;
  endpoint: string;
  notes: string;
  plans: Plan[];
};

export type BillingPeriod = "monthly" | "annual";
export type CostBasis = "workload" | "allowance";

export type PricingScenario = {
  selection: "lowest" | "custom";
  billing: BillingPeriod;
  basis: CostBasis;
  monthlyPages: number;
  plans: Record<string, string>;
};

export type Quote = { monthly: number | null; commitment: number | null; extra: number | null; reason: string | null };

export const DEFAULT_MONTHLY_PAGES = 93_000;
export const VOLUME_OPTIONS = [10_000, 93_000, 1_000_000];
export const PRICING_CATALOG = catalog as PricedProvider[];

const isMetered = (plan: Plan) => Number.isFinite(plan.perThousand);
const isPaid = (plan: Plan) => (plan.monthly ?? 0) > 0 || isMetered(plan);

export function quotePlan(plan: Plan, billing: BillingPeriod, pages = DEFAULT_MONTHLY_PAGES): Quote {
  if (!Number.isSafeInteger(pages) || pages < 0) throw new Error("Invalid pricing scenario");
  if (plan.custom) return { monthly: null, commitment: null, extra: null, reason: "Quote required" };
  if (isMetered(plan)) return { monthly: (pages * plan.perThousand!) / 1000, commitment: null, extra: 0, reason: null };
  const commitment = billing === "annual" && plan.annual ? plan.annual : null;
  const base = commitment === null ? (plan.monthly ?? 0) : commitment / 12;
  const overage = Math.max(0, pages - (plan.included ?? 0));
  if (overage && !plan.block) return { monthly: null, commitment, extra: null, reason: "Allowance exceeded" };
  const extra = overage ? Math.ceil(overage / plan.block!) * (Math.round(plan.blockUsd! * 100) / 100) : 0;
  return { monthly: base + extra, commitment, extra, reason: null };
}

function cheapestPlan(provider: PricedProvider, billing: BillingPeriod, pages = DEFAULT_MONTHLY_PAGES) {
  return (
    provider.plans
      .map((plan) => ({ plan, ...quotePlan(plan, billing, pages) }))
      .filter((quote) => quote.monthly !== null)
      .sort((a, b) => a.monthly! - b.monthly!)[0] ?? null
  );
}

/** The rate per 1,000 pages when the plan's allowance is fully used. */
export function unitPrice(plan: Plan, billing: BillingPeriod) {
  if (plan.custom || plan.monthly === 0) return null;
  if (isMetered(plan)) return plan.perThousand!;
  const monthly = billing === "annual" && plan.annual ? plan.annual / 12 : plan.monthly!;
  return (monthly * 1000) / plan.included!;
}

export const planMonthlyLabel = (plan: Plan, billing: BillingPeriod) => (billing === "annual" && plan.annual ? plan.annual / 12 : plan.monthly);

export function lowestCostPlans(billing: BillingPeriod, pages = DEFAULT_MONTHLY_PAGES) {
  return Object.fromEntries(
    PRICING_CATALOG.map((provider) => [provider.id, cheapestPlan({ ...provider, plans: provider.plans.filter(isPaid) }, billing, pages)?.plan.name ?? provider.plans[0].name]),
  );
}

export const DEFAULT_SCENARIO: PricingScenario = {
  selection: "lowest",
  billing: "monthly",
  basis: "workload",
  monthlyPages: DEFAULT_MONTHLY_PAGES,
  plans: lowestCostPlans("monthly"),
};

export type ProviderPrice = PricedProvider & {
  plan: Plan;
  unitPrice: number | null;
  quote: Quote;
  quoteLow: Quote;
  billing: Billing | null | undefined;
  comparisonPrice: number | null;
  comparisonPriceLow: number | null;
  quality: number | null;
  qualityUpper: number | null;
  count: number;
  success: number;
  unknown: number;
  usefulPrice: number | null;
  usefulPriceLow: number | null;
};

export function priceProviders(rows: ProviderRow[], scenario: PricingScenario): ProviderPrice[] {
  const pages = scenario.monthlyPages ?? DEFAULT_MONTHLY_PAGES;
  const basis = scenario.basis ?? "workload";
  if (!Number.isSafeInteger(pages) || pages <= 0) throw new Error("Invalid pricing scenario");

  return PRICING_CATALOG.map((provider) => {
    const row = rows.find((candidate) => candidate.id === provider.id);
    const billing = row?.billing;
    const high = billing ? billing.high : 1;
    const low = billing ? billing.low : 1;
    const billedHigh = high === null ? pages : Math.ceil(pages * high);
    const plan =
      scenario.selection === "lowest"
        ? cheapestPlan({ ...provider, plans: provider.plans.filter(isPaid) }, scenario.billing, billedHigh)?.plan
        : provider.plans.find((candidate) => candidate.name === scenario.plans[provider.id]);
    if (!plan) throw new Error(`Unknown pricing plan for ${provider.id}`);

    const rate = unitPrice(plan, scenario.billing);
    const quote = quotePlan(plan, scenario.billing, billedHigh);
    const quoteLow = quotePlan(plan, scenario.billing, low === null ? pages : Math.ceil(pages * low));
    const comparisonPrice =
      basis === "allowance" ? (rate === null || high === null ? null : rate * high) : high === null || quote.monthly === null ? null : (quote.monthly / pages) * 1000;
    const comparisonPriceLow =
      basis === "allowance" ? (rate === null || low === null ? null : rate * low) : low === null || quoteLow.monthly === null ? null : (quoteLow.monthly / pages) * 1000;

    const total = row?.count || 0;
    const success = row?.success || 0;
    const unknown = row?.unknown || 0;
    const quality = row?.balanced ? row.rate : total ? success / total : null;
    const qualityUpper = row?.balanced ? row.upper : total ? (success + unknown) / total : null;

    return {
      ...provider,
      plan,
      unitPrice: rate,
      quote,
      quoteLow,
      billing,
      comparisonPrice,
      comparisonPriceLow,
      quality,
      qualityUpper,
      count: total,
      success,
      unknown,
      usefulPrice: comparisonPrice !== null && quality !== null && quality > 0 ? comparisonPrice / quality : null,
      usefulPriceLow: comparisonPriceLow !== null && qualityUpper !== null && qualityUpper > 0 ? comparisonPriceLow / qualityUpper : null,
    };
  });
}

/** Changes a scenario the way the original controls did: picking custom pins the current plans; lowest recomputes them. */
export function updateScenario(current: PricingScenario, change: Partial<PricingScenario>, prices: ProviderPrice[]): PricingScenario {
  const next = { ...current, ...change };
  if (change.selection === "custom" && current.selection !== "custom") next.plans = Object.fromEntries(prices.map((price) => [price.id, price.plan.name]));
  if (next.selection !== "custom") {
    next.plans = lowestCostPlans(next.billing, next.monthlyPages ?? DEFAULT_MONTHLY_PAGES);
    next.basis = "workload";
  }
  return next;
}
