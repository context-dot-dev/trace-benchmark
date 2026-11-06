import { Button } from "@/components/ui/button";
import { SiteSection, SectionHeading } from "@/components/site/section";
export const dailyExamples = [
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
  onViewDailyWikipedia,
}: {
  onViewDailyWikipedia: () => void;
}) {
  return (
    <SiteSection id="sources" lines className="bench-sources">
      <SectionHeading
        title="Where the pages come from"
        description="Each day, we find pages through publisher feeds, public databases, sitemaps, and links added to English Wikipedia. All four providers retrieve the same selected pages."
      />
      <div className="grid gap-10 mt-10 md:grid-cols-2">
        <div>
          <h3>Feeds, registries, and sitemaps</h3>
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
          <h3>Wikipedia</h3>
          <p>
            We check English Wikipedia edits once a day for newly added links
            and select linked pages that the benchmark has not tested before.
            We test the content on those websites, rather than the Wikipedia
            articles that link to them. A link added today may point to a page
            published earlier.
          </p>
          <Button variant="outline-brand" onClick={onViewDailyWikipedia}>
            View daily Wikipedia results
          </Button>
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
  );
}
