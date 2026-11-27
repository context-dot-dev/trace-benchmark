import { createHash } from "node:crypto";
import { fetch as publicFetch } from "undici";
import { canonical, publicDispatcher } from "./discovery";

// A neutral difficulty probe. Before a page can enter a hard-first sample, one plain HTTP GET
// requests it the way a simple script would: no JavaScript, no browser, no proxy, no retries.
// The probe never consults provider results, so it cannot steer the sample toward or away from
// any provider's strengths.
//
// easy  the static HTML already contains a populated page, or the URL is a file (PDF, JSON,
//       plain text) that the GET downloaded
// hard  the GET was blocked, challenged, rate limited, timed out, or returned an empty shell
//       or too little readable text
// dead  the page is gone (404/410) or its host does not resolve; no provider can score it

export const PROBE_VERSION = "http-get-v1";
/** Readable characters a static response needs before the page counts as easy. */
export const EASY_TEXT_CHARS = 1500;
const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 15_000;

export type ProbeVerdict = "easy" | "hard" | "dead";
export type ProbeReason =
  | "static_html"
  | "document"
  | "thin_html"
  | "challenge"
  | "blocked"
  | "rate_limited"
  | "server_error"
  | "http_status"
  | "timeout"
  | "network"
  | "redirect_loop"
  | "not_found"
  | "unresolvable";
export type ProbeLabel = { verdict: ProbeVerdict; reason: ProbeReason; version: string };
export type Probe = ProbeLabel & {
  status: number | null;
  textChars: number;
  elapsedMs: number;
};

export const probeId = (url: string) => createHash("sha256").update(url).digest("hex");

// Interstitials from common bot-management vendors. Each marker is specific to a challenge page,
// so a normal page that merely loads a CAPTCHA widget for a form does not match.
const CHALLENGE_MARKERS = [
  /<title>\s*just a moment\.\.\.\s*<\/title>/i,
  /cdn-cgi\/challenge-platform/i,
  /cf-chl-|cf_chl_|cf-browser-verification/i,
  /<title>\s*attention required! \| cloudflare/i,
  /captcha-delivery\.com|geo\.captcha-delivery/i,
  /px-captcha|_pxcaptcha|perimeterx/i,
  /_incapsula_resource|incapsula incident id/i,
  /awswaf|aws-waf-token|challenge\.js\?awswaf/i,
  /<title>\s*access denied\s*<\/title>[\s\S]{0,4000}reference\s*#\s*[0-9a-f.]+/i,
  /kpsdk|kasada/i,
  /<title>\s*(are you a robot|robot or human|verify you are human|security check)\b/i,
  /enable javascript and cookies to continue/i,
];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Text a reader would see in the static HTML, without scripts, styles, templates or markup. */
export function readableText(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head|iframe|canvas)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? " ";
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Classifies one completed HTTP response. Exported for tests and offline re-labelling. */
export function classifyResponse(
  status: number,
  contentType: string,
  body: string,
): { verdict: ProbeVerdict; reason: ProbeReason; textChars: number } {
  const challenged = CHALLENGE_MARKERS.some((marker) => marker.test(body.slice(0, 200_000)));
  const html = /html|xml/i.test(contentType) || (!contentType && /<html|<!doctype html/i.test(body.slice(0, 2000)));
  const textChars = html ? readableText(body).length : 0;
  if (status === 404 || status === 410) return { verdict: "dead", reason: "not_found", textChars };
  if (challenged) return { verdict: "hard", reason: "challenge", textChars };
  if (status === 401 || status === 403) return { verdict: "hard", reason: "blocked", textChars };
  if (status === 429) return { verdict: "hard", reason: "rate_limited", textChars };
  if (status >= 500) return { verdict: "hard", reason: "server_error", textChars };
  if (status < 200 || status >= 300) return { verdict: "hard", reason: "http_status", textChars };
  if (!html) return { verdict: "easy", reason: "document", textChars };
  if (textChars < EASY_TEXT_CHARS) return { verdict: "hard", reason: "thin_html", textChars };
  return { verdict: "easy", reason: "static_html", textChars };
}

const HEADERS = {
  // Declared research client, the same identity discovery uses. Sites that refuse a declared
  // non-browser client count as hard: reading them takes more than a plain request.
  "User-Agent": "Context.dev Research (https://context.dev)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

type Fetcher = typeof publicFetch;

export async function probePage(
  url: string,
  options: { fetch?: Fetcher; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Probe> {
  const started = Date.now();
  const fetcher = options.fetch ?? publicFetch;
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    ...(options.signal ? [options.signal] : []),
  ]);
  const done = (
    result: { verdict: ProbeVerdict; reason: ProbeReason; textChars?: number },
    status: number | null = null,
  ): Probe => ({
    verdict: result.verdict,
    reason: result.reason,
    version: PROBE_VERSION,
    status,
    textChars: result.textChars ?? 0,
    elapsedMs: Date.now() - started,
  });
  try {
    let target = canonical(url);
    for (let hop = 0; hop < 6; hop++) {
      const response = await fetcher(target, {
        dispatcher: publicDispatcher,
        signal,
        redirect: "manual",
        headers: HEADERS,
      });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        await response.body?.cancel();
        if (!next) return done({ verdict: "hard", reason: "http_status" }, response.status);
        target = canonical(new URL(next, target).href);
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      let body = "";
      if (response.body && !/^(image|video|audio|font)\//i.test(contentType)) {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of response.body) {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_BYTES) break;
        }
        body = Buffer.concat(chunks).toString("utf8");
      } else await response.body?.cancel();
      return done(classifyResponse(response.status, contentType, body), response.status);
    }
    return done({ verdict: "hard", reason: "redirect_loop" });
  } catch (error) {
    const err = error as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
    const code = err.cause?.code ?? err.code ?? "";
    const message = `${err.message ?? ""} ${err.cause?.message ?? ""}`;
    if (err.name === "TimeoutError" || err.name === "AbortError" || /UND_ERR_.*TIMEOUT/.test(code))
      return done({ verdict: "hard", reason: "timeout" });
    if (code === "ENOTFOUND" || /ENOTFOUND|PRIVATE_DESTINATION|INVALID_URL/.test(message))
      return done({ verdict: "dead", reason: "unresolvable" });
    return done({ verdict: "hard", reason: "network" });
  }
}

/** Runs `probe` over `items` with bounded concurrency, stopping early when `signal` aborts. */
export async function probeMany<T>(
  items: T[],
  probe: (item: T) => Promise<void>,
  concurrency: number,
  signal?: AbortSignal,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length && !signal?.aborted) await probe(items[next++]);
    }),
  );
}
