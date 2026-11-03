import { Button } from "@/components/ui/button";
import { SiteSection, SectionHeading } from "@/components/site/section";
import {
  benchmarkCategories,
  type BenchmarkPage,
} from "@/lib/benchmark/combined";

const dailyExamples = [
  {
    category: "News",
    description: "Publisher articles",
    name: "BBC feed",
    url: "https://feeds.bbci.co.uk/news/rss.xml",
  },
  {
    category: "Commerce",
    description: "Product pages",
    name: "Allbirds sitemap",
    url: "https://www.allbirds.com/sitemap.xml",
  },
  {
    category: "Jobs",
    description: "Individual job postings",
    name: "Stripe job API",
    url: "https://boards-api.greenhouse.io/v1/boards/stripe/jobs",
  },
  {
    category: "Finance",
    description: "Company filings and financial releases",
    name: "Apple SEC filings",
    url: "https://data.sec.gov/submissions/CIK0000320193.json",
  },
  {
    category: "Research",
    description: "Papers and scholarly articles",
    name: "Nature feed",
    url: "https://www.nature.com/nature.rss",
  },
  {
    category: "Legal & government",
    description: "Rules, notices and official records",
    name: "Federal Register API",
    url: "https://www.federalregister.gov/api/v1/documents.json?per_page=1000&order=newest",
  },
  {
    category: "Software & docs",
    description: "Release notes and documentation",
    name: "VS Code releases API",
    url: "https://api.github.com/repos/microsoft/vscode/releases?per_page=100",
  },
  {
    category: "Community",
    description: "Discussion threads and social posts",
    name: "Stack Overflow API",
    url: "https://api.stackexchange.com/2.3/questions?pagesize=100&order=desc&sort=creation&site=stackoverflow",
  },
];

export function BenchmarkSources({
  pages,
  onViewWikipedia,
  onViewDailyWikipedia,
}: {
  pages: BenchmarkPage[];
  onViewWikipedia: () => void;
  onViewDailyWikipedia: () => void;
}) {
  const wikipedia = pages.filter((page) => page.source === "wikipedia");
  const examples = ["news", "research", "arts_sports_reference"].flatMap(
    (category) => {
      const page = wikipedia.find(
        (page) => page.category === category && page.article && page.revision,
      );
      return page ? [page] : [];
    },
  );
  return (
    <>
      <SiteSection id="sources" lines className="bench-sources">
        <SectionHeading
          title="Where the pages come from"
          description="The daily sample brings together pages from feeds, public databases, sitemaps, and new Wikipedia links. The Source filter lets you inspect daily Wikipedia discoveries or the original October study separately."
        />
        <div className="grid gap-10 mt-10 md:grid-cols-2">
          <div>
            <h3>Daily web sample</h3>
            <p>
              Publisher feeds announce articles, public registries list records
              such as filings and job openings, and sitemaps list website pages.
              We collect the linked pages, aiming for 300 previously unseen
              pages in each of eight categories per day.
            </p>
            <p>
              We assign each page the category of the source that supplied it.
              These pages are new to the benchmark, but may have been published
              earlier.
            </p>
            <a
              href="#daily-sources"
              onClick={() => {
                const details =
                  document.querySelector<HTMLDetailsElement>("#daily-sources");
                if (details) details.open = true;
              }}
            >
              See daily source examples
            </a>
          </div>
          <div>
            <h3>Daily Wikipedia discoveries</h3>
            <p>
              Once a day, before building the sample, we compare revisions from
              the previous day’s English Wikipedia edits to find new external
              links. We include previously untested URLs in that day’s sample
              and ask all four providers to retrieve the linked pages. These pages
              are grouped under Other because their subjects have not been classified.
            </p>
            <Button variant="outline-brand" onClick={onViewDailyWikipedia}>
              View daily Wikipedia results
            </Button>
            <p><a href="#wikipedia">About the original Wikipedia study</a></p>
          </div>
        </div>
        <details id="daily-sources" className="mt-10">
          <summary>Daily source examples by category</summary>
          <p>
            These feeds, APIs, and sitemaps supply the URLs for the daily sample.
            We follow those links and test whether each provider can recover
            content from the destination page.
          </p>
          <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-2 mt-6">
            {dailyExamples.map((source) => (
              <div key={source.category}>
                <dt className="font-medium">{source.category}</dt>
                <dd>
                  {source.description} ·{" "}
                  <a href={source.url}>{source.name} ↗</a>
                </dd>
              </div>
            ))}
          </dl>
          <p>
            <a href="https://github.com/context-dot-dev/trace-benchmark/blob/main/config/sources.json">
              Browse the complete source registry on GitHub ↗
            </a>
            . These are configured discovery sources, not a guarantee that every
            source contributes to every daily sample.
          </p>
        </details>
      </SiteSection>
      <SiteSection id="wikipedia" lines className="bench-sources">
        <SectionHeading
          title="Original Wikipedia study"
          description="This historical sample contains 1,041 pages tested on October 29, 2026. Its saved results remain separate from the daily Wikipedia discoveries."
        />
        <dl className="grid gap-6 mt-10 sm:grid-cols-3">
          <div>
            <dt className="text-fg-muted">External pages</dt>
            <dd className="text-h4 mt-2">1,041</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Links sampled</dt>
            <dd className="text-body-lg mt-2">Oct 25 &amp; 27, 2026</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Providers tested</dt>
            <dd className="text-body-lg mt-2">Oct 29, 2026</dd>
          </div>
        </dl>
        <p>
          We compared Wikipedia revisions in 48 two-minute windows, covering
          4,777 measured edits, and kept newly added external URLs. A newly
          added link can point to an old article, a research paper or a
          reference record. It is not evidence that the page is new, difficult
          to scrape or factually correct.
        </p>
        <h3 className="mt-8">Examples from the study</h3>
        <ul className="grid gap-8 mt-6 md:grid-cols-3">
          {examples.map((page) => (
            <li key={page.id} className="min-w-0">
              <a
                href={`https://en.wikipedia.org/w/index.php?oldid=${page.revision}`}
              >
                {page.article} ↗
              </a>
              <p className="text-body-sm">
                Wikipedia article at the sampled revision
              </p>
              <a href={page.url} className="break-words">
                {new URL(page.url).hostname.replace(/^www\./, "")} ↗
              </a>
              <p className="text-body-sm">
                Tested page ·{" "}
                {benchmarkCategories.find(
                  (category) => category.id === page.category,
                )?.name ?? page.category}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-6 mt-8">
          <Button variant="outline-brand" onClick={onViewWikipedia}>
            View original Wikipedia results
          </Button>
          <a href="/data/wikipedia-study.json" download>
            Download all 1,041 URLs and results ↓
          </a>
        </div>
        <p>
          Read about <a href="#wikipedia-methodology">Wikipedia screening and reference checks</a> in
          the methodology.
        </p>
      </SiteSection>
    </>
  );
}
