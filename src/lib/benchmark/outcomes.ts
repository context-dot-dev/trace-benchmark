// Shared, client-safe rules for reading a stored provider result.

/** Rejections caused by our own account plan or credits, not by the provider's ability to read a page. */
export const ACCOUNT_LIMIT_ERRORS = new Set([
  "HTTP_401",
  "HTTP_402",
  "HTTP_429",
  "RATE_LIMIT_EXCEEDED",
  "RATE_LIMITED",
  "NO_MORE_CREDITS",
  "account_blocked_not_attempted",
]);

/** Errors where the provider itself reported that it could not return the page. */
export const PROVIDER_FAILURE_ERRORS = new Set([
  "INVALID_CONTENT_RESPONSE",
  "EMPTY_CONTENT",
  "ORIGIN_ERROR",
  "EMPTY_RESPONSE",
  "RESPONSE_TOO_LARGE",
]);

/** Results that are neither a provider success nor a provider failure. */
export const NOT_SCORED_ERRORS = new Set([
  "CACHED_RESPONSE",
  "INTERRUPTED_REQUEST",
  "MISSING_CREDENTIAL",
]);

/** Every provider is asked to give up at 27 s; anything failing after this counts as a timeout. */
export const DEADLINE_MS = 27_000;
export const TIMEOUT_THRESHOLD_MS = 25_000;

export const isAccountLimited = (error: string | null | undefined) =>
  error != null && ACCOUNT_LIMIT_ERRORS.has(error);

export type FailureReason =
  | "timeout"
  | "http_error"
  | "no_content"
  | "barrier"
  | "thin"
  | "unresolved";

export const failureReasons: { id: FailureReason; name: string; color: string }[] = [
  { id: "timeout", name: "Timeout", color: "var(--ds-color-brand)" },
  { id: "http_error", name: "HTTP error", color: "var(--ds-color-blue-70)" },
  { id: "no_content", name: "No content returned", color: "var(--ds-color-blue-40)" },
  { id: "barrier", name: "Block, login, or error screen", color: "var(--ds-color-neutral-80)" },
  { id: "thin", name: "Thin page or wrong document", color: "var(--ds-color-neutral-50)" },
  { id: "unresolved", name: "Unresolved", color: "var(--ds-color-neutral-30)" },
];

export type OutcomeFields = {
  state: string;
  success: boolean | null;
  error: string | null;
  elapsedMs?: number | null;
  /** v6 access label when known: accessed, not_accessed, unclear. */
  access?: string | null;
  /** Content label: substantive, thin, blocked, error, unclear. */
  content?: string | null;
};

/** True when a provider error means the page was not returned, even if the stored success is null. */
export function providerFailed(o: OutcomeFields) {
  if (o.success === false) return true;
  if (!o.error) return false;
  if (o.error === "REQUEST_TIMEOUT" || o.error === "HTTP_408") return true;
  if (PROVIDER_FAILURE_ERRORS.has(o.error)) return true;
  return /^HTTP_\d+$/.test(o.error) && !ACCOUNT_LIMIT_ERRORS.has(o.error);
}

/**
 * The first reason a page was not accessed, normalized across providers. Each provider reports
 * a missed deadline differently (HTTP 408, our client cutoff, or an empty failure), so all of
 * those are counted as timeouts.
 */
export function failureReason(o: OutcomeFields): FailureReason | null {
  if (o.success === true || o.state !== "done") return null;
  if (isAccountLimited(o.error) || (o.error && NOT_SCORED_ERRORS.has(o.error))) return null;
  const late = (o.elapsedMs ?? 0) >= TIMEOUT_THRESHOLD_MS;
  if (o.error === "REQUEST_TIMEOUT" || o.error === "HTTP_408") return "timeout";
  if (o.error && PROVIDER_FAILURE_ERRORS.has(o.error)) return late ? "timeout" : "no_content";
  if (o.error && /^HTTP_\d+$/.test(o.error)) return "http_error";
  if (o.error === "REQUEST_FAILED") return late ? "timeout" : "no_content";
  if (o.access === "not_accessed") return "barrier";
  if (o.content === "blocked" || o.content === "error") return "barrier";
  if (o.access == null && (o.content === "thin" || o.content === "substantive")) return "thin";
  if (o.success === false) return "no_content";
  return "unresolved";
}

/** Normalized host and path, ignoring scheme, "www.", query, fragment and a trailing slash. */
export function pageKey(url: string) {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, "") || "/";
    return u.hostname.replace(/^www\./, "").toLowerCase() + path.toLowerCase();
  } catch {
    return url;
  }
}

/** True when the provider ended on a different page than requested. */
export function redirected(requested: string, finalUrl: string | null | undefined) {
  if (!finalUrl) return null;
  return pageKey(requested) !== pageKey(finalUrl);
}

/** The site a page belongs to: its lowercase hostname without a leading "www.". */
export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url;
  }
}
