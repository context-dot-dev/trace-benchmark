// Unit checks for the neutral difficulty probe. No database or network needed:
//   npx tsx tests/probe.test.ts
import assert from "node:assert/strict";
import { classifyResponse, probePage, readableText, EASY_TEXT_CHARS } from "../src/lib/benchmark/probe";
import { interleave } from "../src/lib/benchmark/collect";

const checks: string[] = [];
const article = "<p>" + "A populated article paragraph with real reporting. ".repeat(60) + "</p>";
const page = (body: string, title = "Story") => `<!doctype html><html><head><title>${title}</title><script>var x = "${"js ".repeat(500)}";</script></head><body>${body}</body></html>`;

assert.equal(readableText(page("<h1>Hi &amp; bye</h1><style>.a{}</style><nav>Menu</nav>")), "Hi & bye Menu");
assert.equal(readableText("<p>caf&#233; &#x2014; ok</p>"), "café — ok");
checks.push("Readable text drops scripts, styles, head and markup, and decodes entities");

assert.deepEqual(classifyResponse(200, "text/html", page(article)).verdict, "easy");
assert.equal(classifyResponse(200, "text/html", page('<div id="root"></div>')).reason, "thin_html");
assert.equal(classifyResponse(200, "application/pdf", "%PDF-1.7").verdict, "easy");
assert.equal(classifyResponse(200, "application/pdf", "%PDF-1.7").reason, "document");
assert.ok(readableText(page(article)).length >= EASY_TEXT_CHARS);
checks.push("Populated static HTML and downloaded files are easy; empty app shells are hard");

const cloudflare = page("<p>Checking your browser</p>", "Just a moment...");
assert.equal(classifyResponse(403, "text/html", cloudflare).reason, "challenge");
assert.equal(classifyResponse(200, "text/html", page(article + '<script src="https://geo.captcha-delivery.com/c.js"></script>')).reason, "challenge");
assert.equal(classifyResponse(200, "text/html", page(article + '<div class="g-recaptcha"></div>')).verdict, "easy");
checks.push("Bot-management interstitials are hard even with a 200; an ordinary form CAPTCHA is not");

assert.deepEqual(
  [403, 401, 429, 503, 404, 410].map((status) => classifyResponse(status, "text/html", page(article))),
  [
    { verdict: "hard", reason: "blocked", textChars: readableText(page(article)).length },
    { verdict: "hard", reason: "blocked", textChars: readableText(page(article)).length },
    { verdict: "hard", reason: "rate_limited", textChars: readableText(page(article)).length },
    { verdict: "hard", reason: "server_error", textChars: readableText(page(article)).length },
    { verdict: "dead", reason: "not_found", textChars: readableText(page(article)).length },
    { verdict: "dead", reason: "not_found", textChars: readableText(page(article)).length },
  ],
);
checks.push("Blocks, rate limits and server errors are hard; removed pages are dead and never sampled");

type Fetcher = NonNullable<Parameters<typeof probePage>[1]>["fetch"];
const respond = (responses: (() => Response)[]) => {
  const seen: string[] = [];
  const fetcher = (async (url: string) => {
    seen.push(String(url));
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next();
  }) as unknown as Fetcher;
  return { fetcher, seen };
};
{
  const { fetcher, seen } = respond([
    () => new Response(null, { status: 301, headers: { location: "/moved" } }),
    () => new Response(page(article), { headers: { "content-type": "text/html; charset=utf-8" } }),
  ]);
  const result = await probePage("https://example.org/a?utm_source=x", { fetch: fetcher });
  assert.deepEqual(seen, ["https://example.org/a", "https://example.org/moved"]);
  assert.equal(result.verdict, "easy");
  assert.equal(result.status, 200);
  assert.equal(result.version, "http-get-v1");
}
{
  const { fetcher } = respond([() => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } })]);
  assert.equal((await probePage("https://example.org/a", { fetch: fetcher })).verdict, "dead");
}
for (const [error, expected] of [
  [Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }), "unresolvable"],
  [new DOMException("The operation timed out.", "TimeoutError"), "timeout"],
  [Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }), "network"],
] as const) {
  const fetcher = (async () => { throw error; }) as unknown as Fetcher;
  assert.equal((await probePage("https://example.org/a", { fetch: fetcher })).reason, expected);
}
checks.push("Redirects are followed safely, private redirect targets are refused, and failures are labeled");

// Interleaving is the order both probing and selection use: round-robin across organizations,
// deterministic for a day, and different across days.
const rows = ["a", "b", "c"].flatMap((org) => [1, 2, 3].map((n) => ({ id: org + n, organization: org })));
const order = interleave(rows, "2026-11-27");
assert.equal(order.length, rows.length);
assert.equal(new Set(order.slice(0, 3).map((r) => r.organization)).size, 3);
assert.deepEqual(interleave([...rows].reverse(), "2026-11-27"), order);
assert.notDeepEqual(interleave(rows, "2026-11-28").map((r) => r.id), order.map((r) => r.id));
checks.push("Candidate order is a day-seeded round-robin across organizations");

console.log(JSON.stringify({ ok: true, checks }, null, 2));
