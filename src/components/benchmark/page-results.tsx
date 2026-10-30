"use client";
import { Button } from "@/components/ui/button";
import { providers } from "@/lib/benchmark/types";
import {
  categoryName,
  sourceName,
  type BenchmarkPage,
} from "@/lib/benchmark/combined";
const reviewNames: Record<string, string> = {
  reference_checked: "Reference checked",
  unresolved: "Reference unresolved",
  reject_grader: "Grader error",
  reject_repeatability: "Not repeatable",
};
export function PageResults({
  pages,
  page,
  setPage,
}: {
  pages: BenchmarkPage[];
  page: number;
  setPage: (page: number) => void;
}) {
  const size = 20;
  const position = Math.min(
    page,
    Math.max(0, Math.ceil(pages.length / size) - 1),
  );
  return (
    <section id="page-results" className="bench-section">
      <h2>Inspect the pages</h2>
      <p className="bench-note">
        Original grades for the filtered sample. Open a page or citation to
        inspect its source; review notes retain known grading errors.
      </p>
      {pages.length ? (
        <>
          <div
            className="bench-scroll sample-page-scroll"
            role="region"
            aria-label="Page results"
            tabIndex={0}
          >
            <table>
              <caption className="sr-only">
                Page provenance, validation and provider outcomes
              </caption>
              <thead>
                <tr>
                  <th scope="col">Page & source</th>
                  <th scope="col">Validation</th>
                  {providers.map((p) => (
                    <th scope="col" key={p.id}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pages
                  .slice(position * size, (position + 1) * size)
                  .map((p) => (
                    <tr key={`${p.source}:${p.id}`}>
                      <th scope="row" className="sample-page-cell">
                        <a href={p.url} target="_blank" rel="noreferrer">
                          {new URL(p.url).hostname} ↗
                        </a>
                        <span className="sample-url">{p.url}</span>
                        <span className="sample-category">
                          {categoryName(p.category)} · {sourceName(p.source)}
                        </span>
                        <span className="sample-category">
                          {p.day} · {p.protocol}
                        </span>
                        {p.revision && (
                          <a
                            className="sample-citation"
                            href={`https://en.wikipedia.org/w/index.php?oldid=${p.revision}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Cited in {p.article}
                          </a>
                        )}
                      </th>
                      <td
                        className="sample-review-cell"
                        data-label="Validation"
                      >
                        {reviewNames[p.audit ?? ""] ??
                          (p.screened ? "Hard candidate" : "Not audited")}
                        {p.auditReason && (
                          <details>
                            <summary>Review note</summary>
                            <p>{p.auditReason}</p>
                          </details>
                        )}
                      </td>
                      {providers.map((provider) => {
                        const r = p.results[provider.id];
                        return (
                          <td key={provider.id} data-label={provider.name}>
                            {r && r.state !== "done"
                              ? "Pending"
                              : r?.success == null
                                ? "Unresolved"
                                : r.success
                                  ? "Useful"
                                  : "Not useful"}
                            {r?.error && (
                              <details className="sample-error">
                                <summary>Error</summary>
                                <p>{r.error}</p>
                              </details>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="sample-pagination">
            <p id="page-range" aria-live="polite">
              {(position * size + 1).toLocaleString()}–
              {Math.min((position + 1) * size, pages.length).toLocaleString()}{" "}
              of {pages.length.toLocaleString()} pages
            </p>
            <div>
              <Button
                variant="outline"
                size="sm"
                aria-label="Previous pages"
                disabled={position === 0}
                onClick={() => setPage(position - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="Next pages"
                disabled={(position + 1) * size >= pages.length}
                onClick={() => setPage(position + 1)}
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
  );
}
