import { appendFileSync } from "node:fs";

// Only this E2E child process can reroute the real provider clients.
const fixture = process.env.BENCHMARK_E2E_FIXTURE;
if (!fixture || new URL(fixture).hostname !== "127.0.0.1")
  throw new Error("The provider fixture must be local");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname))
  throw new Error("The E2E database must be local");
const endpoints = new Map([
  ["https://api.context.dev/v1/web/scrape", "context"],
  ["https://api.exa.ai/contents", "exa"],
  ["https://api.firecrawl.dev/v2/scrape", "firecrawl"],
  ["https://api.keenable.ai/v1/fetch", "keenable"],
  ["https://api.typesafe.ai/v1/systemone", "judge"],
]);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  // Next dev checks package advisories during startup; keep that request offline too.
  if (url.href === "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk")
    return Response.json({});
  const provider = endpoints.get(url.origin + url.pathname);
  if (provider) {
    const redirected = fixture + "/" + provider + url.search;
    return originalFetch(input instanceof Request ? new Request(redirected, input) : redirected, init);
  }
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname))
    return originalFetch(input, init);
  appendFileSync(process.env.BENCHMARK_E2E_BLOCKED, url.origin + url.pathname + "\n");
  throw new Error("Unexpected external fetch in benchmark E2E");
};
