import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { QualityTable } from "./benchmark-tables";
import { human } from "./model";
import { useBenchmark } from "./use-benchmark";
import { MetricPanels, PageTypes, HeadToHead, scrapingMetrics } from "./comparisons";
import { LiveStatus, Freshness, Coverage, Efficiency, Supply, AccountIssues } from "./live-comparisons";
import { RunSampling } from "./run-sampling";
import { History } from "./quality-history";
import {Pricing,PricingAppendix} from "./pricing";
import {DEFAULT_PRICING} from "./pricing-data";
import { FAQ, Citation } from "./article-end";

function collectionDates(records) {
  const times = records.map(r => Date.parse(r.started_at)).filter(Number.isFinite);
  if (!times.length) return "No collection dates available";
  const format = time => new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const first = format(Math.min(...times)), last = format(Math.max(...times));
  return first === last ? first : `${first} – ${last}`;
}

const ResultsBrowser = lazy(() => import("./results-browser"));

export default function App({ initialData = null }) {
  const [pricing, setPricing] = useState(DEFAULT_PRICING);
  const [cohort, setCohort] = useState("independent");
  const [provider, setProvider] = useState("all");
  const [sort, setSort] = useState("rate");
  const [ascending, setAscending] = useState(false);
  const resultsAnchor = useRef(null);
  const [resultsVisible, setResultsVisible] = useState(false);
  const [dark, setDark] = useState(false);
  const { data, loading, error, refresh } = useBenchmark(initialData);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setResultsVisible(true); observer.disconnect(); } }, { rootMargin: "200px" });
    if (resultsAnchor.current) observer.observe(resultsAnchor.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  const group = data?.cohorts[cohort];
  const providers = data?.providers || [];
  const categoryName = id => data?.categories.find(c => c.id === id)?.label || human(id);
  const tasks = group?.tasks || 0;
  const categories = group?.categories || 0;
  const rows = [...(group?.rows || [])].sort((a, b) => {
    if (sort === "rate" && Boolean(a.accountAffected)!==Boolean(b.accountAffected)) return a.accountAffected?1:-1;
    if (sort === "name") return (ascending ? 1 : -1) * a.name.localeCompare(b.name);
    if (a[sort] === null) return b[sort] === null ? 0 : 1;
    if (b[sort] === null) return -1;
    return (ascending ? 1 : -1) * (a[sort] - b[sort]);
  });
  function changeCohort(value) {
    if (!value[0]) return;
    setCohort(value[0]); setProvider("all");
  }
  function chooseProvider(id) {
    setProvider(id); setResultsVisible(true);
    resultsAnchor.current?.scrollIntoView({ block: "start" });
  }

  return <>
    <a className="skip" href="#main">Skip to content</a>
    <div className="shell">
      <div className="masthead">
        <a href="#overview" className="brand" aria-label="Trace overview">Trace</a>
        <Button id="theme" variant="ghost" size="icon" aria-label={dark ? "Light appearance" : "Dark appearance"} aria-pressed={dark} onClick={() => setDark(!dark)}>{dark ? <Sun /> : <Moon />}</Button>
      </div>
      <main id="main">
        <header id="overview">
          <h1>Which scraper returns useful content?</h1>
          <p className="intro">The same pages. Different scrapers. A comparison of how much content comes back, how long it takes, and where each provider works best.</p>
          <LiveStatus data={data} cohort={cohort}/><nav className="article-nav" aria-label="In this article"><a href="#quality">Results</a><a href="#coverage">Content</a><a href="#pricing">Quality vs. cost</a><a href="#efficiency">Latency</a><a href="#trends">Quality over time</a><a href="#appendix">Appendix</a></nav>
        </header>
        <section id="quality">
          <h2>Which scrapers deliver?</h2>
          <ToggleGroup className="dataset-switch" variant="segmented" value={[cohort]} onValueChange={changeCohort} aria-label="Page set">
            <ToggleGroupItem value="independent">Independent pages</ToggleGroupItem>
            <ToggleGroupItem value="needle">Search-discovered pages</ToggleGroupItem>
          </ToggleGroup>
          <p className="micro">{cohort === "needle" ? "Target: up to 400 search result slots per day." : <>Target: {data?.operations?.collection_profile ? (data.operations.collection_profile.daily_per_category*8).toLocaleString("en-US") : "—"} URLs in one daily independent run. The same frozen set goes to every provider; shortages remain visible.</>}</p>
          <p className="dataset-description">{cohort === "independent" ? "How often does each scraper return the page’s main content? These URLs come from public feeds and registries." : "URLs found by Context Search using NEEDLE queries. This selection may favor Context, so these results are kept separate."}</p>
          <p className="micro">{group?.sampleKind==="daily" ? "Latest completed daily run." : "Showing earlier small batches until the first daily run finishes."}</p>
          <p id="collection-summary" className="collection-summary" role="status">{data ? `${group.uniqueUrls} unique URLs · ${group.domains} domains · ${categories} page types · ${group.count} recorded page tests. ${group.first ? `Collected ${collectionDates([{started_at:group.first},{started_at:group.last}])} (UTC).` : "Awaiting the first completed run under the new scoring protocol."}` : "Loading published results…"}</p>
          {error && <Alert variant="destructive"><AlertTitle>{data ? "Could not check for newer results" : "Could not load results"}</AlertTitle><AlertDescription>{data ? "The last loaded results are still shown." : "Check your connection and try again."}<Button variant="outline" disabled={loading} onClick={refresh}>Retry</Button></AlertDescription></Alert>}
          <AccountIssues rows={rows}/>
          <div className="leaderboard"><QualityTable rows={rows} sort={sort} ascending={ascending} onSort={descriptor => { setSort(descriptor.column); setAscending(descriptor.direction === "ascending"); }} onProvider={chooseProvider} loading={loading} /></div>
          <p className="micro">Useful = pages with matching, substantive content / all selected page tests. Partial content can qualify. Time = median request duration. <a href="#appendix">Scoring details</a></p>
          <div className="wide-comparison"><MetricPanels label="Scraping" rows={rows.map(r => ({...r, unresolvedRate:r.count ? r.unknown/r.count : null}))} metrics={scrapingMetrics} /></div>
        </section>
        <Pricing rows={rows} scenario={pricing} onScenarioChange={setPricing}/>
        <History data={data} cohort={cohort} providers={providers}/>
        <section id="page-types">
          <h2>Different pages, different results</h2>
          <p className="section-intro">An average hides the hard parts. Compare useful-content rates across page types to find the fit for your workload.</p>
          <PageTypes groups={group?.pageTypes || []} providers={providers} categoryName={categoryName} />
          <p className="micro">Same selected page set as above. Each cell is the share of page tests with useful content.</p>
        </section>
        <section id="head-to-head">
          <h2>What does one scraper miss?</h2>
          <p className="section-intro">Two providers can have the same score and recover different pages. These pairs show where their coverage overlaps.</p>
          <div className="wide-comparison"><HeadToHead pairs={group?.pairs || []} /></div>
        </section>
        <Coverage group={group} rows={rows}/>
        <Efficiency rows={rows}/>
        <Supply data={data} categoryName={categoryName}/>
        <FAQ />
        <section id="appendix" className="methodology">
          <h2>Appendix</h2>
          <Freshness rows={rows}/>
          <PricingAppendix rows={rows} scenario={pricing}/>
          <h3 id="methodology">Methodology & data</h3>
          <p><strong>Rotating pages.</strong> Inspired by <a href="https://keenableai.github.io/needle/">NEEDLE</a>, Trace collects URLs from changing public sources instead of relying on a fixed test set. Independent pages cover news, commerce, jobs, finance, research, government, software, and community sites.</p>
          <p><strong>Same task.</strong> Every reader receives the same selected URL with a 30-second deadline and a 250,000-character text limit. Their returned text, errors, and timings are saved. Each provider receives its fresh-fetch setting: maxAgeMs=0, maxAgeHours=0, maxAge=0, or live=true. Provider-reported cache evidence is tracked separately; origin freshness is not independently verified.</p>
          <p><strong>Content checks.</strong> The judge checks page identity and substantive content. The v3 protocol first checks a 12,000-character sample. If it finds no useful match, overlapping chunks cover the remaining returned text. A negative requires a completed full-text review; judge errors and ambiguous content remain unresolved. Earlier protocol results remain in the downloads and are excluded from v3 comparisons. If every unresolved result were useful, the score would rise by that count divided by the number of tests.</p>
          <p><strong>Scoring.</strong> A model grades the returned text without seeing the provider’s name. Factual accuracy has not been independently verified. Unresolved results stay in the denominator; timings include failed requests. The collected mix of sites affects the ranking. New runs compare fresh provider outputs directly without rendering a reference browser. Pairwise Jev preferences identify the best observed output, including ties. No useful output means unknown recoverability, not an impossible page. A comparison requires resolved content judgments for every provider, fresh-fetch requests, no reported cache hits and request starts within 120 seconds. Conflicting preferences remain unresolved. Providers with missing observations remain in the denominator. Entire batches invalidated by a collector fault are excluded for every provider, with reasons and raw results retained in the downloads.</p>
          <p><strong>Output comparison.</strong> Each useful output contributes up to 12,000 characters from the beginning, middle and end. Pairwise choices below 0.75 model confidence remain unresolved; this threshold is provisional. A winner must beat or tie every other useful output. This measures sampled preference, not factual accuracy or complete-page recall. Identical text ties without a model call; a sole useful response is reported separately.</p>
          <p><strong>Reproducibility.</strong> Each run freezes its URLs, provider set, configuration and code hashes before requests begin. Raw API responses and comparison receipts are retained privately. Historical browser captures remain in the archive. The public manifests and result hashes let others audit the selection and rerun the same URLs. Live pages can change.</p>
          <p className="micro">Operated by Context, one of the providers being compared. <a href="plan.md">Protocol</a> · <a href="https://github.com/context-dot-dev/trace-benchmark">GitHub (private)</a> · <a href="data/latest.json" download="trace-full-data.json">Download all data</a></p>
        <RunSampling data={data} categoryName={categoryName}/>
          <div id="result-browser" ref={resultsAnchor}>
            <h3>Individual results</h3>
            {resultsVisible && data ? <Suspense fallback={<p role="status">Loading result browser…</p>}><ResultsBrowser data={data} cohort={cohort} provider={provider} setProvider={setProvider} refresh={refresh} /></Suspense> : <p className="micro">Individual results load when you reach this section.</p>}
          </div>
        </section>
        <Citation />
      </main>
    </div>

  </>;
}
