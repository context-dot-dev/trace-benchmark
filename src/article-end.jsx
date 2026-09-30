import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const questions = [
  ["What counts as a successful scrape?", "The response must contain substantive content from the requested page. A successful HTTP response alone is not enough. A login screen, error message, or the wrong page does not count."],
  ["Is the best output ground truth?", "No. It is the strongest output observed in this run. Jev compares anonymous responses, and ties are allowed. Every provider can miss content or return the same error. If none returns useful content, recoverability stays unknown. Fresh-fetch settings reduce cache reuse but do not prove that the origin is current."],
  ["How do new pages enter the benchmark?", "URLs come from public feeds and registries. A separate set uses URLs found through Context Search with NEEDLE queries. Keeping those sets separate makes the effect of page selection visible."],
  ["Are these results live?", "One daily sample targets 2,400 new URLs and 600 controls. Control URLs stay fixed for 30 days. New-page and control scores give all eight categories equal weight and are reported separately. The status at the top reflects its last saved completion and flags delayed collection. The leaderboard shows the latest completed daily run; the chart retains earlier days. This page checks for progress every minute. Source shortages, account limits and failures can reduce the number of new pages."],
  ["Can I inspect or reproduce a result?", "Yes. The appendix links the complete dataset and protocol. Open any individual result to inspect its source URL, returned text, timing, and assessment. Re-running a changing page can produce a different result, so keep the original capture when comparing runs."],
];

export function FAQ() {
  return <section id="faq"><h2>Frequently asked questions</h2><Accordion className="faq">{questions.map(([title,body],i) => <AccordionItem key={title} value={`faq-${i}`}><AccordionTrigger><span className="faq-question"><span className="faq-number">{String(i+1).padStart(2,"0")}</span>{title}</span></AccordionTrigger><AccordionContent><p>{body}</p></AccordionContent></AccordionItem>)}</Accordion></section>;
}

const citation = `@misc{trace2026,
  author = {Ryaboy, Michael and Bakour, Yahia},
  title  = {{Trace}: A Live Scraping Benchmark},
  year   = {2026},
  url    = {https://trace.2.28.61.111.sslip.io/},
  note   = {Contact: michael@context.dev, yahia@context.dev. Source repository currently private. Inspired by NEEDLE.}
}`;

export function Citation() {
  const [state,setState] = useState("Copy");
  async function copy() {
    try { await navigator.clipboard.writeText(citation); setState("Copied"); }
    catch { setState("Select the citation to copy"); }
  }
  return <section id="citation"><div className="citation-heading"><h2>Citation</h2><Button variant="ghost" onClick={copy} aria-label="Copy Trace citation">{state === "Copied" ? <Check /> : <Copy />}<span role="status">{state}</span></Button></div><p>If you use Trace in your work, please cite:</p><pre className="citation-code"><code>{citation}</code></pre><p className="micro">By Michael Ryaboy and Yahia Bakour at Context. Contact <a href="mailto:michael@context.dev">michael@context.dev</a> or <a href="mailto:yahia@context.dev">yahia@context.dev</a>. <a href="https://github.com/context-dot-dev/trace-benchmark">GitHub repository</a> (private; access required).</p><h3>Inspiration</h3><p>Trace is inspired by <a href="https://keenableai.github.io/needle/">NEEDLE: A Live Open-Source Search Benchmark for AI Agents</a> (2026), by Andrey Styskin, Matthias Petri and Ilya Gusev. Its fresh-query methodology and transparent comparisons informed this benchmark. Trace evaluates scraping; NEEDLE evaluates search.</p></section>;
}
