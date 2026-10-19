import { SiteHeader, type NavItem } from "@/components/site/site-header";
import { ThemeToggle } from "@/components/trace/theme-toggle";
import { ContextMark } from "@/components/trace/provider-logo";
import { TraceReport } from "@/components/trace/trace-report";
import { dateTimeUtc } from "@/lib/trace/format";
import { getSummary } from "@/lib/trace/summary";

const NAV: NavItem[] = [
  { label: "Results", href: "#quality" },
  { label: "Content", href: "#page-types" },
  { label: "Quality vs. cost", href: "#pricing" },
  { label: "Latency", href: "#efficiency" },
  { label: "Quality over time", href: "#trends" },
  { label: "Appendix", href: "#appendix" },
];

export default async function Page() {
  const { summary, source } = await getSummary();

  return (
    <>
      <SiteHeader
        logo={<ContextMark />}
        wordmark="Trace"
        logoHref="#overview"
        logoLabel="Trace overview"
        className="data-[scrolled=false]:bg-surface max-[879px]:bg-surface max-[879px]:data-[scrolled=true]:border-b max-[879px]:data-[scrolled=true]:border-hairline"
        items={NAV}
        primaryAction={{ label: "Download all data", href: "/data/latest.json" }}
        endAction={<ThemeToggle />}
        announcement={source === "snapshot" ? { text: `Live results are unavailable right now. Showing the saved run from ${dateTimeUtc(summary.generated_at)}.` } : undefined}
      />
      <main id="main">
        <TraceReport initialSummary={summary} />
      </main>
    </>
  );
}
