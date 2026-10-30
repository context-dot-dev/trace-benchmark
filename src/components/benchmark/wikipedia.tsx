"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProviderName } from "@/components/trace/provider-logo";
import { providers } from "@/lib/benchmark/types";
import study from "../../../public/data/wikipedia-study.json";

const categoryNames: Record<string, string> = {
  news: "News",
  research: "Research",
  legal_government: "Legal & government",
  community_social: "Community",
  commerce: "Commerce",
  jobs: "Jobs",
  finance: "Finance",
  finance_filings: "Financial filings",
  software_docs: "Software & docs",
  arts_sports_reference: "Arts, sports & reference",
  other: "Other",
};
const reviewNames: Record<string, string> = {
  reference_checked: "Reference checked",
  unresolved: "Reference unresolved",
  reject_grader: "Grader error",
  reject_repeatability: "Not repeatable",
};
const categoryIds = [...new Set(study.pages.map((p) => p.category))].sort();
const number = (n: number) => n.toLocaleString("en-US");
const rate = (n: number, total: number) =>
  total ? `${((100 * n) / total).toFixed(1)}%` : "—";
const pageSize = 20;

export default function WikipediaBenchmark() {
  const [cohort, setCohort] = useState("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const selected = study.pages.filter(
    (p) =>
      (cohort === "all" ||
        (cohort === "hard" ? p.screened : p.audit === "reference_checked")) &&
      (category === "all" || p.category === category),
  );
  const query = search.trim().toLowerCase();
  const matches = selected.filter((p) =>
    `${p.url} ${p.article}`.toLowerCase().includes(query),
  );
  const visible = matches.slice(page * pageSize, (page + 1) * pageSize);
  const metrics = providers.map((provider) => ({
    ...provider,
    useful: selected.filter((p) => p.results[provider.id].success === true)
      .length,
    failed: selected.filter((p) => p.results[provider.id].success === false)
      .length,
    unresolved: selected.filter((p) => p.results[provider.id].success === null)
      .length,
  }));
  const plain = selected.filter(
    (p) => p.results.plain_http.success === true,
  ).length;

  return (
    <div className="wiki-study">
      <div className="bench-section-head">
        <div>
          <p className="bench-note">
            External URLs added on October 25 & 27, 2026 · Measured October 29 ·
            Fixed study
          </p>
        </div>
        <Button asChild variant="outline" className="wiki-download">
          <a href="/data/wikipedia-study.json" download>
            Download results ↗
          </a>
        </Button>
      </div>
      <div className="wiki-filters">
        <label htmlFor="wiki-cohort">
          Sample
          <select
            id="wiki-cohort"
            value={cohort}
            onChange={(e) => {
              setCohort(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All sampled pages</option>
            <option value="hard">Screened hard candidates</option>
            <option value="reference">Reference-checked pages</option>
          </select>
        </label>
        <label htmlFor="wiki-category">
          Category
          <select
            id="wiki-category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All categories</option>
            {categoryIds.map((id) => (
              <option key={id} value={id}>
                {categoryNames[id] ?? id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <dl className="wiki-metrics" aria-live="polite">
        <div>
          <dt>Pages in sample</dt>
          <dd data-wikipedia-count>{number(selected.length)}</dd>
        </div>
        <div>
          <dt>Registered domains</dt>
          <dd>{number(new Set(selected.map((p) => p.domain)).size)}</dd>
        </div>
        <div>
          <dt>Screened hard candidates</dt>
          <dd>{number(selected.filter((p) => p.screened).length)}</dd>
        </div>
        <div>
          <dt>Reference checked</dt>
          <dd>
            {number(
              selected.filter((p) => p.audit === "reference_checked").length,
            )}
          </dd>
        </div>
      </dl>
      {cohort !== "all" && (
        <p className="bench-notice">
          {cohort === "hard"
            ? "These candidates were selected because providers failed on them. This view measures performance on a deliberately hard subset; it is not an unbiased provider ranking. Independent validation is incomplete."
            : "Five pages matched independently visible article bodies or public abstracts. This small audited subset is not representative; abstract recovery does not establish full-paper recovery."}
        </p>
      )}
      <section className="bench-section">
        <Tabs defaultValue="chart">
          <div className="bench-section-head">
            <h2>Useful content</h2>
            <TabsList
              variant="segmented"
              aria-label="Wikipedia useful content view"
            >
              <TabsTrigger value="chart">Chart</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
            </TabsList>
          </div>
          <p className="bench-note">
            Original first-run grades across {number(selected.length)} pages,
            weighted equally per page. Unresolved results stay in the
            denominator. This study uses a different protocol from the daily
            score; two known grader errors are flagged in the page list.
          </p>
          <TabsContent value="chart">
            <div
              className="bench-bars"
              role="img"
              aria-label={metrics
                .map((p) => `${p.name}: ${rate(p.useful, selected.length)}`)
                .join(", ")}
            >
              <div className="bench-axis">
                <span>0%</span>
                <span>100%</span>
              </div>
              {metrics.map((p) => (
                <div className="bench-bar-row" key={p.id}>
                  <ProviderName id={p.id} name={p.name} />
                  <div className="bench-track">
                    <div
                      className="bench-bar"
                      style={{
                        width: `${selected.length ? (100 * p.useful) / selected.length : 0}%`,
                        background: p.color,
                      }}
                    />
                  </div>
                  <strong>{rate(p.useful, selected.length)}</strong>
                </div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="table">
            <div
              className="bench-scroll wiki-score-scroll"
              tabIndex={0}
              role="region"
              aria-label="Wikipedia provider scores"
            >
              <table>
                <caption className="sr-only">
                  Original grades for the selected Wikipedia sample
                </caption>
                <thead>
                  <tr>
                    {[
                      "Provider",
                      "Useful",
                      "Not useful",
                      "Unresolved",
                      "Share",
                    ].map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((p) => (
                    <tr key={p.id}>
                      <th scope="row">
                        <ProviderName id={p.id} name={p.name} />
                      </th>
                      <td data-label="Useful">{p.useful}</td>
                      <td data-label="Not useful">{p.failed}</td>
                      <td data-label="Unresolved">{p.unresolved}</td>
                      <td data-label="Share">
                        {rate(p.useful, selected.length)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
        <p className="bench-note">
          Plain HTTP + Trafilatura baseline: {number(plain)} /{" "}
          {number(selected.length)} useful ({rate(plain, selected.length)}).
        </p>
      </section>
      <section id="wiki-pages" className="bench-section">
        <div className="bench-section-head">
          <h2>Inspect the pages</h2>
          <label className="wiki-search" htmlFor="wiki-search">
            <span className="sr-only">Search pages</span>
            <input
              id="wiki-search"
              type="search"
              placeholder="Search URL or citing article…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        <p className="bench-note">
          Useful / Not useful are automated first-run grades. Review notes show
          independent audit findings. Search filters this list only.
        </p>
        {matches.length ? (
          <>
            <div
              className="bench-scroll wiki-page-scroll"
              tabIndex={0}
              role="region"
              aria-label="Wikipedia page results"
            >
              <table>
                <caption className="sr-only">
                  Per-page outcomes and Wikipedia citation provenance
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Page & citation</th>
                    <th scope="col">Review</th>
                    {providers.map((p) => (
                      <th key={p.id} scope="col">
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id}>
                      <th scope="row" className="wiki-page-cell">
                        <a href={p.url} target="_blank" rel="noreferrer">
                          {p.domain} ↗
                        </a>
                        <span className="wiki-url">{p.url}</span>
                        <a
                          className="wiki-citation"
                          href={`https://en.wikipedia.org/w/index.php?oldid=${p.revision}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Cited in {p.article}
                        </a>
                        <span className="wiki-category">
                          {categoryNames[p.category] ?? p.category}
                        </span>
                      </th>
                      <td className="wiki-review-cell" data-label="Review">
                        <span>
                          {reviewNames[p.audit] ??
                            (p.screened ? "Hard candidate" : "Not audited")}
                        </span>
                        {p.auditReason && (
                          <details>
                            <summary>Review note</summary>
                            <p>{p.auditReason}</p>
                          </details>
                        )}
                      </td>
                      {providers.map((provider) => {
                        const result = p.results[provider.id];
                        return (
                          <td
                            key={provider.id}
                            data-label={provider.name}
                            title={result.error ?? undefined}
                          >
                            {result.success === null
                              ? "Unresolved"
                              : result.success
                                ? "Useful"
                                : "Not useful"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="wiki-pagination">
              <p id="wiki-page-range" aria-live="polite">
                {number(page * pageSize + 1)}–
                {number(Math.min((page + 1) * pageSize, matches.length))} of{" "}
                {number(matches.length)} pages
              </p>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Previous pages"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Next pages"
                  disabled={(page + 1) * pageSize >= matches.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          <p className="bench-notice" role="status">
            No pages match these filters.
          </p>
        )}
      </section>
      <section id="wikipedia-methodology" className="bench-method">
        <h2>How this sample was collected</h2>
        <p>
          Full parent/current revisions from 4,777 sampled edits revealed 1,041
          distinct external URLs across 616 domains. Discovery used 48
          two-minute windows across two UTC days, with no search queries. Newly
          cited does not mean newly published.
        </p>
        <p>
          99 persistent candidates defeated plain HTTP and at least two
          commercial readers while another reader succeeded. 79 met that
          criterion again; 73 survived basic quality screening. Only 55 fit the
          daily benchmark’s categories. No qualifying jobs, commerce, software
          documentation, or financial filings remained.
        </p>
        <p>
          Of 20 randomly audited strict candidates, five were reference checked,
          three rejected, and twelve unresolved. A short but complete record can
          be incorrectly rejected by the judge. Original automated grades are
          retained here, with those errors flagged rather than silently
          relabeled.
        </p>
        <details>
          <summary>Protocol, novelty, and daily supply limits</summary>
          <p>
            The study used frozen Python adapters from commit f23e72c and
            identity-content-jev-v2 grading. Context requested full Markdown
            with mainContentOnly=false. Provider settings and request paths
            differ from the current daily protocol, so the two scores must not
            be merged. Repeat tests are used for screening; the chart uses
            first-run results only.
          </p>
          <p>
            None of these URLs overlapped the saved 2,265-URL benchmark snapshot
            or the earlier 303-URL pilot. This does not prove all-history
            novelty. 955 citations remained present, 83 were absent, and three
            unresolved when rechecked.
          </p>
          <p>
            Weighted estimates suggest 1,240–1,657 category-matched candidate
            additions per day before independent validation, historical
            deduplication, and domain caps. They are not counts of daily
            validated pages. A reliable supply of 1,000 pages per day has not
            been established, and this tab does not start recurring collection.
          </p>
          <p>
            The download includes original grades, citation revisions, review
            notes, and SHA-256 hashes of the source ledger and manifest. Raw
            provider text and private browser state are excluded.
          </p>
        </details>
      </section>
    </div>
  );
}
