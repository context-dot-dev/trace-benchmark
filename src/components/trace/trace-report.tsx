"use client";

import * as React from "react";

import { Hero } from "@/components/site/hero";
import { DEFAULT_SCENARIO, priceProviders, updateScenario, type PricingScenario } from "@/lib/trace/pricing";
import type { CohortId, SampleRole, Summary } from "@/lib/trace/types";

import type { SortState } from "./data-table";
import { buildModel } from "./report-model";
import { AppendixSection } from "./sections/appendix-section";
import { Citation, FaqBlock } from "./sections/closing-sections";
import { BestOutputSection, OverlapSection, PageTypesSection } from "./sections/coverage-sections";
import { LatencySection, SupplySection } from "./sections/latency-supply-sections";
import { PricingSection } from "./sections/pricing-section";
import { ResultsSection } from "./sections/results-section";
import { StatusLine } from "./status-line";
import { TrendsSection } from "./sections/trends-section";
import { useLiveSummary } from "./use-live-summary";

/** Loads the result browser once its section comes within reach, or as soon as someone asks for it. */
function useRequestedWhenNear(ref: React.RefObject<HTMLElement | null>) {
  const [requested, setRequested] = React.useState(false);
  React.useEffect(() => {
    const node = ref.current;
    if (!node || requested) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setRequested(true);
        observer.disconnect();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, requested]);
  return [requested, setRequested] as const;
}

const JUMP_SETTLE_MS = 5000;

function decodeHashTarget(hash: string) {
  try {
    return document.getElementById(decodeURIComponent(hash));
  } catch {
    return null;
  }
}

/**
 * Keeps the reader in place when a block above the viewport grows, such as the result browser loading while someone
 * jumps past it to the citation. The browser's own scroll anchoring does not hold here.
 */
function useHoldPlaceWhenGrowingAbove(ref: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let height = node.offsetHeight;
    // Only a recent jump counts, so paging through the results later never pulls the reader back down to an old anchor.
    let jumpedAt = performance.now();
    const onJump = () => (jumpedAt = performance.now());
    window.addEventListener("hashchange", onJump);
    const observer = new ResizeObserver(() => {
      const next = node.offsetHeight;
      const grew = next - height;
      height = next;
      const box = node.getBoundingClientRect();
      if (grew === 0 || box.top > 0) return;
      // After a jump to a later section, settle on that section again; it is idempotent, so it cannot fight a smooth scroll.
      const target = location.hash && performance.now() - jumpedAt < JUMP_SETTLE_MS ? decodeHashTarget(location.hash.slice(1)) : null;
      if (target && node.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) target.scrollIntoView({ block: "start", behavior: "instant" });
      else if (box.bottom <= 0) window.scrollBy({ top: grew, behavior: "instant" });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", onJump);
    };
  }, [ref]);
}

export function TraceReport({ initialSummary }: { initialSummary: Summary }) {
  const { summary, loading, error, refresh } = useLiveSummary(initialSummary);
  const [cohort, setCohort] = React.useState<CohortId>("independent");
  const [role, setRole] = React.useState<SampleRole>("new");
  const [sort, setSort] = React.useState<SortState>({ column: "rate", ascending: false });
  const [scenario, setScenario] = React.useState<PricingScenario>(DEFAULT_SCENARIO);
  const [resultsProvider, setResultsProvider] = React.useState("all");
  const resultsRef = React.useRef<HTMLDivElement>(null);
  const [resultsRequested, setResultsRequested] = useRequestedWhenNear(resultsRef);
  useHoldPlaceWhenGrowingAbove(resultsRef);

  const model = buildModel(summary, cohort, role, sort);
  const prices = priceProviders(model.rows, scenario);
  const onStale = React.useCallback(() => void refresh(), [refresh]);

  return (
    <>
      <Hero
        id="overview"
        title="Scraping Bench"
        accent="Bench"
        description="Compare how reliably web scrapers return useful content from the same pages, with daily measurements of quality, speed and cost."
        className="shadow-none"
        contentClassName="min-h-0 gap-4 py-6 sm:py-8 lg:py-8"
        media={<StatusLine summary={summary} cohort={cohort} />}
      />
      <ResultsSection
        model={model}
        onCohortChange={(next) => {
          setCohort(next);
          setResultsProvider("all");
        }}
        onRoleChange={setRole}
        sort={sort}
        onSortChange={setSort}
        onInspectProvider={(provider) => {
          setResultsProvider(provider);
          setResultsRequested(true);
          resultsRef.current?.scrollIntoView({ block: "start" });
        }}
        error={error}
        loading={loading}
        onRetry={onStale}
      />
      <TrendsSection summary={summary} cohort={cohort} sampleRole={model.hasRoles ? role : null} />
      <PageTypesSection model={model} />
      <PricingSection prices={prices} scenario={scenario} onScenarioChange={(change) => setScenario((current) => updateScenario(current, change, priceProviders(model.rows, current)))} />
      <OverlapSection model={model} />
      <BestOutputSection model={model} />
      <LatencySection model={model} />
      <SupplySection model={model} />
      <FaqBlock />
      <AppendixSection
        model={model}
        prices={prices}
        scenario={scenario}
        cohort={cohort}
        resultsProvider={resultsProvider}
        onResultsProviderChange={setResultsProvider}
        resultsRequested={resultsRequested}
        resultsRef={resultsRef}
        onStale={onStale}
      />
      <Citation />
    </>
  );
}
