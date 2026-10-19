"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, Download, Search, SquareArrowOutUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { humanize, isNumber, safeHttpUrl, seconds } from "@/lib/trace/format";
import type { CohortId, ResultDetail, ResultRecord, ResultsPage, Summary } from "@/lib/trace/types";

import { Choice } from "../choice";
import { CellDetail, DataTable } from "../data-table";
import { ProviderLogo, ProviderName } from "../provider-logo";

const PAGE_SIZE = 8;
const TIMEOUT_MS = 10_000;

function outcomeLabel(record: ResultRecord) {
  if (record.success === null) return "Unresolved";
  if (record.success) return "Useful content";
  if (record.outcome === "returned") {
    if (record.identity_label === "wrong_target") return "Wrong target";
    if (record.content_label === "thin") return "Too little content";
    return humanize(record.content_label || "Not useful");
  }
  return humanize(record.outcome || "Not useful");
}

function OutcomeBadge({ record }: { record: ResultRecord }) {
  return <Badge variant={record.success === true ? "success" : record.success === false ? "destructive" : "default"}>{outcomeLabel(record)}</Badge>;
}

function ExternalUrl({ url }: { url: string | null | undefined }) {
  const safe = safeHttpUrl(url);
  if (!safe) return <>{url || "Unavailable"}</>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-fg-brand underline decoration-brand/30 underline-offset-3 hover:decoration-brand">
      {url}
      <SquareArrowOutUpRight aria-hidden="true" className="size-3 shrink-0" />
    </a>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="max-h-80 overflow-auto rounded-card bg-subtle p-3 font-mono text-caption leading-relaxed whitespace-pre-wrap break-all text-fg-secondary">{JSON.stringify(value ?? null, null, 2)}</pre>;
}

type Inspecting = { title: string; loading?: boolean; error?: string; record?: ResultDetail } | null;

function providerName(summary: Summary, id: string) {
  return summary.providers.find((candidate) => candidate.id === id)?.name ?? humanize(id);
}

function ResultEvidenceDialog({
  inspecting,
  summary,
  onClose,
  onDownload,
}: {
  inspecting: Inspecting;
  summary: Summary;
  onClose: () => void;
  onDownload: (record: ResultDetail) => void;
}) {
  const detail = inspecting?.record;
  return (
    <Dialog open={!!inspecting} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="xl" overlayClassName="z-1100">
        <DialogHeader>
          <DialogTitle className="break-all">{detail?.title || inspecting?.title || "Result"}</DialogTitle>
          <DialogDescription>Returned content and the model’s assessment.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          {inspecting?.loading && <p role="status">Loading evidence…</p>}
          {inspecting?.error && <p role="alert">{inspecting.error}</p>}
          {detail && (
            <>
              <div className="flex flex-col gap-1 text-body-sm text-fg-muted">
                <span>Requested: <ExternalUrl url={detail.url} /></span>
                <span>Final: <ExternalUrl url={detail.final_url} /></span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-body-sm text-fg-muted">
                <span className="inline-flex items-center gap-2">
                  <ProviderLogo id={detail.provider} className="size-4" />
                  {providerName(summary, detail.provider)}
                </span>
                <OutcomeBadge record={detail} />
                <span>{isNumber(detail.elapsed_ms) ? seconds(detail.elapsed_ms / 1000) : "Timing unavailable"}</span>
                <span>{isNumber(detail.text_chars) ? detail.text_chars.toLocaleString("en-US") : "Unavailable"} extracted characters</span>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <h3 className="text-body tracking-normal">Returned text</h3>
                  <pre className="max-h-96 overflow-auto rounded-card bg-code p-4 font-mono text-caption leading-relaxed whitespace-pre-wrap break-words text-white/85">
                    {detail.text_preview || "No returned text preview was published."}
                  </pre>
                  <p className="text-body-sm text-fg-muted">This preview may omit content. The text hash identifies the full saved response.</p>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <h3 className="text-body tracking-normal">Model assessment</h3>
                  <JsonBlock value={detail.judgment} />
                  <p className="text-body-sm text-fg-muted">This assessment has not been independently verified.</p>
                  <h3 className="mt-3 text-body tracking-normal">Request details</h3>
                  <JsonBlock value={Object.fromEntries(Object.entries(detail).filter(([key]) => !["text_preview", "judgment"].includes(key)))} />
                </div>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {detail && <Button variant="outline" size="sm" onClick={() => onDownload(detail)}><Download />Download this result</Button>}
          <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ResultsBrowser({
  summary,
  cohort,
  provider,
  onProviderChange,
  onStale,
}: {
  summary: Summary;
  cohort: CohortId;
  provider: string;
  onProviderChange: (provider: string) => void;
  onStale: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  // The page belongs to one set of filters; any change to them starts over at the first page.
  const filters = `${cohort}|${provider}|${debounced}|${summary.version}`;
  const [paging, setPaging] = React.useState({ filters, page: 0 });
  const page = paging.filters === filters ? paging.page : 0;
  const setPage = (next: number) => setPaging({ filters, page: next });
  const [attempt, setAttempt] = React.useState(0);
  const [response, setResponse] = React.useState<{ key: string; data: ResultsPage | null; error: string | null } | null>(null);
  const [inspecting, setInspecting] = React.useState<Inspecting>(null);
  const detailRequest = React.useRef<AbortController | null>(null);

  const params = new URLSearchParams({ cohort, provider, q: debounced, page: String(page), version: summary.version });
  const resultsUrl = `/api/results?${params}`;
  const requestKey = `${resultsUrl}#${attempt}`;
  const loading = response?.key !== requestKey;
  const data = loading ? null : response.data;
  const error = loading ? null : response.error;

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    fetch(resultsUrl, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 409) {
          onStale();
          throw new Error("Results changed. Refreshing the publication.");
        }
        if (!response.ok) throw new Error("Could not load this page of results.");
        return (await response.json()) as ResultsPage;
      })
      .then((next) => {
        if (!cancelled) setResponse({ key: requestKey, data: next, error: null });
      })
      .catch((reason: Error) => {
        if (!cancelled) setResponse({ key: requestKey, data: null, error: reason.name === "AbortError" ? "The results request timed out. Try again." : reason.message });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [resultsUrl, requestKey, onStale]);

  React.useEffect(() => () => detailRequest.current?.abort(), []);

  async function inspect(record: ResultRecord) {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    const title = record.title || record.url || record.task_id;
    setInspecting({ title, loading: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    try {
      const response = await fetch(`/api/result?${new URLSearchParams({ id: record.id, version: summary.version })}`, { signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 409 ? "This publication changed. Close this dialog and refresh results." : "Could not load this result.");
      const detail = (await response.json()) as ResultDetail;
      if (!controller.signal.aborted) setInspecting({ title, record: detail });
    } catch (reason) {
      if (!controller.signal.aborted || timedOut) setInspecting({ title, error: timedOut ? "The evidence request timed out. Close and reopen this result to retry." : (reason as Error).message });
    } finally {
      clearTimeout(timer);
    }
  }

  function downloadRecord(record: ResultDetail) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "trace-observation.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  const records = loading || error ? [] : (data?.records ?? []);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const currentPage = data?.page ?? 0;
  const categoryName = (id: string) => summary.categories.find((category) => category.id === id)?.label ?? humanize(id);
  const getProviderName = (id: string) => providerName(summary, id);

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-(--ds-layout-heading) text-body-sm leading-relaxed text-fg-muted">Open a result to see what the scraper returned and why the model accepted or rejected it.</p>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <Choice
            label="Provider"
            value={provider}
            onValueChange={onProviderChange}
            options={[{ value: "all", label: "All providers" }, ...summary.providers.map((candidate) => ({ value: candidate.id, label: candidate.name }))]}
          />
        </div>
        <div className="flex w-full flex-col gap-1.5 lg:max-w-80">
          <Label htmlFor="result-search">Find a page</Label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-faint" />
            <Input id="result-search" type="search" placeholder="Search title, URL, or page type" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="result-count" role="status" className="text-body-sm text-fg-muted">
          {loading ? "Loading results…" : error ? "Results unavailable." : `${(data?.total ?? 0).toLocaleString("en-US")} matching results`}
        </p>
        <Button asChild variant="ghost" size="sm">
          <a href={`/api/download?${params}`} download="trace-results.json">
            <Download />
            Download results
          </a>
        </Button>
      </div>
      {error && (
        <p role="alert" className="flex flex-wrap items-center gap-3 text-body-sm text-fg-muted">
          {error}
          <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </Button>
        </p>
      )}
      {/* On a phone each result is a row of its own, so the provider and outcome never scroll out of view. */}
      <ul aria-label="Individual observed results" className="flex flex-col rounded-card bg-surface ring-1 ring-hairline md:hidden">
        {records.map((record) => {
          const title = record.title || record.url || record.task_id;
          return (
            <li key={record.id} className="flex items-start gap-3 border-t border-hairline px-4 py-3.5 first:border-t-0">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="line-clamp-2 text-body-sm break-all text-fg">{title}</span>
                <CellDetail>
                  {record.domain || record.source_id || "Source unavailable"} · {categoryName(record.category)}
                  {record.sample_role && ` · ${record.sample_role === "control" ? "Control" : "New"} page`}
                </CellDetail>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <ProviderName id={record.provider} name={getProviderName(record.provider)} className="text-body-sm" logoClassName="size-3.5" />
                  <OutcomeBadge record={record} />
                  <span className="text-body-sm text-fg-muted">{isNumber(record.elapsed_ms) ? seconds(record.elapsed_ms / 1000) : "—"}</span>
                </span>
              </div>
              <Button variant="ghost" size="icon" aria-label={`Inspect ${getProviderName(record.provider)} result for ${title}`} onClick={() => inspect(record)}>
                <ArrowRight />
              </Button>
            </li>
          );
        })}
        {!records.length && <li className="px-4 py-6 text-center text-body-sm text-fg-subtle">{loading ? "Loading results…" : error ? "Results unavailable." : "No matching results. Try another provider or search term."}</li>}
      </ul>
      <DataTable
        className="hidden md:flex"
        caption="Individual observed results"
        minWidth="min-w-160"
        columns={[
          { key: "page", label: "Page / source" },
          { key: "provider", label: "Provider" },
          { key: "outcome", label: "Outcome" },
          { key: "inspect", label: <span className="sr-only">Inspect</span>, align: "right", className: "w-12" },
        ]}
        rows={records.map((record) => {
          const title = record.title || record.url || record.task_id;
          return {
            key: record.id,
            cells: {
              page: (
                <span className="block max-w-[28rem]">
                  <span className="line-clamp-2 text-body-sm break-all">{title}</span>
                  <CellDetail className="mt-1">
                    {record.domain || record.source_id || "Source unavailable"} · {categoryName(record.category)}
                    {record.sample_role && ` · ${record.sample_role === "control" ? "Control" : "New"} page`}
                  </CellDetail>
                </span>
              ),
              provider: <ProviderName id={record.provider} name={getProviderName(record.provider)} className="text-body-sm whitespace-nowrap" />,
              outcome: (
                <>
                  <OutcomeBadge record={record} />
                  <CellDetail className="mt-1">{isNumber(record.elapsed_ms) ? seconds(record.elapsed_ms / 1000) : "—"}</CellDetail>
                </>
              ),
              inspect: (
                <Button variant="ghost" size="icon" aria-label={`Inspect ${getProviderName(record.provider)} result for ${title}`} onClick={() => inspect(record)}>
                  <ArrowRight />
                </Button>
              ),
            },
          };
        })}
        empty={
          loading ? (
            "Loading results…"
          ) : error ? (
            "Results unavailable."
          ) : (
            <span className="flex flex-col items-center gap-3">
              <span className="text-body text-fg">No matching results</span>
              <span>Try another provider or search term.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onProviderChange("all");
                  setQuery("");
                  setDebounced("");
                }}
              >
                Clear filters
              </Button>
            </span>
          )
        }
      />
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" disabled={loading || !!error || currentPage === 0} onClick={() => setPage(Math.max(0, currentPage - 1))}>
          <ArrowLeft />
          Previous
        </Button>
        <span className="text-body-sm text-fg-muted">
          Page {currentPage + 1} of {pages.toLocaleString("en-US")}
        </span>
        <Button variant="outline" size="sm" disabled={loading || !!error || currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>
          Next
          <ArrowRight />
        </Button>
      </div>

      <ResultEvidenceDialog
        inspecting={inspecting}
        summary={summary}
        onClose={() => {
          detailRequest.current?.abort();
          setInspecting(null);
        }}
        onDownload={downloadRecord}
      />
    </div>
  );
}
