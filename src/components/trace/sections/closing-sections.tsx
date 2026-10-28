"use client";

import * as React from "react";

import { CodeBlock, CodeWindow, WindowCopyButton } from "@/components/site/code-window";
import { FaqPlainList } from "@/components/site/faq";
import { SectionHeading, SiteSection } from "@/components/site/section";
import { CITATION } from "@/lib/trace/citation";

import { Fine, SubHeading, TextLink } from "../report-section";

const FAQ = [
  {
    question: "01 What counts as a successful scrape?",
    answer: "The response must contain substantive content from the requested page. A successful HTTP response alone is not enough. A login screen, error message, or the wrong page does not count.",
  },
  {
    question: "02 Is the best output ground truth?",
    answer:
      "It is the strongest output observed in this run, rather than independently verified ground truth. Jev compares anonymous responses, and ties are allowed. Every provider can miss content or return the same error. If none returns useful content, recoverability stays unknown. Fresh-fetch settings reduce cache reuse but do not prove that the origin is current.",
  },
  {
    question: "03 How do new pages enter the benchmark?",
    answer: "URLs come from public feeds and registries. A separate set uses URLs found through Context Search with NEEDLE queries. Keeping those sets separate makes the effect of page selection visible.",
  },
  {
    question: "04 Are these results live?",
    answer:
      "One daily sample targets 2,400 new URLs and 600 controls. Control URLs stay fixed for 30 days. New-page and control scores give all eight categories equal weight and are reported separately. The status at the top reflects its last saved completion and flags delayed collection. The leaderboard shows the latest completed daily run; the chart retains earlier days. This page checks for progress every minute. Source shortages, account limits and failures can reduce the number of new pages.",
  },
  {
    question: "05 Can I inspect or reproduce a result?",
    answer:
      "The appendix links the complete dataset and protocol, so you can inspect how each result was collected. Open any individual result to inspect its source URL, returned text, timing, and assessment. Re-running a changing page can produce a different result, so keep the original capture when comparing runs.",
  },
];

export function FaqBlock() {
  return (
    <SiteSection id="faq" aria-labelledby="faq-title" className="scroll-mt-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <SectionHeading title={<span id="faq-title">Frequently asked</span>} accent="questions" />
        <div className="m-2 rounded-card shadow-[0_0_0_var(--ds-space-2)_var(--ds-color-ring-tint)] [&_[data-slot=faq-answer]>div]:text-body">
          <FaqPlainList items={FAQ} idPrefix="trace-faq" />
        </div>
      </div>
    </SiteSection>
  );
}



export function Citation() {
  return (
    <SiteSection id="citation" aria-labelledby="citation-title" className="scroll-mt-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="flex flex-col gap-6">
        <SectionHeading title={<span id="citation-title">Citation</span>} description="If you use Scraping Bench in your work, please cite:" />
          <Fine>
            By Michael Ryaboy and Yahia Bakour at Context. Contact <TextLink href="mailto:michael@context.dev">michael@context.dev</TextLink> or <TextLink href="mailto:yahia@context.dev">yahia@context.dev</TextLink>.{" "}
            <TextLink href="https://github.com/context-dot-dev/trace-benchmark">GitHub repository</TextLink> (private; access required).
          </Fine>
        </div>
        <div className="flex min-w-0 flex-col gap-10">
          <CodeWindow label="scraping-bench.bib" actions={<WindowCopyButton value={CITATION} label="Copy" />}>
            <div className="overflow-x-auto">
              <CodeBlock code={CITATION} />
            </div>
          </CodeWindow>
          <div className="flex flex-col gap-3">
            <SubHeading>Inspiration</SubHeading>
            <p className="max-w-(--ds-layout-heading) text-body-sm leading-relaxed text-fg-muted">
              Scraping Bench is inspired by <TextLink href="https://keenableai.github.io/needle/">NEEDLE: A Live Open-Source Search Benchmark for AI Agents</TextLink> (2026), by Andrey Styskin, Matthias Petri and Ilya Gusev. Its fresh-query methodology
              and transparent comparisons informed this benchmark. Scraping Bench evaluates scraping; NEEDLE evaluates search.
            </p>
          </div>
        </div>
      </div>
    </SiteSection>
  );
}
