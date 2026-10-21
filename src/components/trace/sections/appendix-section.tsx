"use client";

import * as React from "react";

import { SectionHeaderRule, SectionHeading, SiteSection } from "@/components/site/section";
import type { PricingScenario, ProviderPrice } from "@/lib/trace/pricing";
import type { CohortId } from "@/lib/trace/types";
import { cn } from "@/lib/utils";

import type { ReportModel } from "../report-model";
import { SubHeading } from "../report-section";
import { FreshRetrieval, Methodology, PricingDetails, RunSamples } from "./appendix-parts";
import { ResultsBrowser } from "./results-browser";

const CONTENTS = [
  { href: "#fresh-retrieval", label: "Fresh retrieval" },
  { href: "#pricing-details", label: "Pricing methodology" },
  { href: "#published-plans", label: "Plans & rates" },
  { href: "#methodology", label: "Methodology & data" },
  { href: "#runs", label: "Run samples" },
  { href: "#result-browser", label: "Individual results" },
];

const ACTIVE_LINE_PX = 140;

/** The appendix entry being read: the last one whose heading has passed under the header. */
function useActiveEntry(ids: string[]) {
  const [active, setActive] = React.useState(ids[0]);
  React.useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = ids[0];
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= ACTIVE_LINE_PX) current = id;
      }
      // At the very bottom the last entry may never reach the line, so it takes over there.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        const last = document.getElementById(ids[ids.length - 1]);
        if (last && last.getBoundingClientRect().top < window.innerHeight) current = ids[ids.length - 1];
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [ids]);
  return [active, setActive] as const;
}

const CONTENT_IDS = CONTENTS.map((item) => item.href.slice(1));

function AppendixContents() {
  const [active, setActive] = useActiveEntry(CONTENT_IDS);
  return (
    <nav aria-label="Appendix contents" className="hidden lg:block">
      <ul className="sticky top-28 flex flex-col gap-1 border-l border-line">
        {CONTENTS.map((item) => {
          const current = item.href.slice(1) === active;
          return (
            <li key={item.href}>
              <a
                href={item.href}
                aria-current={current ? "location" : undefined}
                onClick={() => setActive(item.href.slice(1))}
                className={cn(
                  "-ml-px block border-l py-1.5 pl-4 text-body-sm transition-colors duration-150 ease-out outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none",
                  current ? "border-brand text-fg-brand" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppendixSection({
  model,
  prices,
  scenario,
  cohort,
  resultsProvider,
  onResultsProviderChange,
  resultsRequested,
  resultsRef,
  onStale,
}: {
  model: ReportModel;
  prices: ProviderPrice[];
  scenario: PricingScenario;
  cohort: CohortId;
  resultsProvider: string;
  onResultsProviderChange: (provider: string) => void;
  resultsRequested: boolean;
  resultsRef: React.RefObject<HTMLDivElement | null>;
  onStale: () => void;
}) {
  return (
    <SiteSection id="appendix" aria-labelledby="appendix-title" className="scroll-mt-24">
      <SectionHeading title={<span id="appendix-title">Appendix</span>} />
      <SectionHeaderRule />
      <div className="grid gap-12 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
        <AppendixContents />
        <div className="flex min-w-0 flex-col gap-16">
          <FreshRetrieval rows={model.rows} />
          <PricingDetails rows={model.rows} prices={prices} scenario={scenario} />
          <Methodology />
          <RunSamples summary={model.summary} categoryName={model.categoryName} />
          <div id="result-browser" ref={resultsRef} className="flex scroll-mt-24 flex-col gap-5">
            <SubHeading>Individual results</SubHeading>
            <p className="text-body-sm text-fg-muted">All pages in the latest completed run, including both new and control pages where available.</p>
            {resultsRequested ? (
              <ResultsBrowser summary={model.summary} cohort={cohort} provider={resultsProvider} onProviderChange={onResultsProviderChange} onStale={onStale} />
            ) : (
              <p className="text-body-sm text-fg-muted">Individual results load when you reach this section.</p>
            )}
          </div>
        </div>
      </div>
    </SiteSection>
  );
}
