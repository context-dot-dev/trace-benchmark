// Unit tests for the SpecStream retrieval adapter in src/lib/benchmark/providers.ts.
// No database or network access needed:
//   npx tsx tests/specstream-provider.test.ts
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createReaders } from "../src/lib/benchmark/providers";

let lastRequest: { auth: string | undefined; body: Record<string, unknown> } | null = null;
let mode: "live" | "site" | "archive" | "blocked" | "empty" | "rate_limit" = "live";

const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  lastRequest = { auth: req.headers.authorization, body: raw ? JSON.parse(raw) : {} };
  res.setHeader("Content-Type", "application/json");
  if (mode === "rate_limit") {
    res.statusCode = 429;
    res.end(JSON.stringify({ error: "rate_limited" }));
    return;
  }
  const requestedUrl = (lastRequest.body.urls as string[])?.[0] ?? "https://example.org/page";
  if (mode === "archive") {
    res.end(
      JSON.stringify({
        results: [
          {
            status: "ok",
            text: "Archived copy",
            url: requestedUrl,
            final_url: requestedUrl,
            read_from: "archive",
          },
        ],
        price_usd: 0.0008,
      }),
    );
    return;
  }
  if (mode === "blocked") {
    res.end(
      JSON.stringify({
        results: [
          {
            status: "blocked",
            status_code: 403,
            text: "Forbidden",
            url: requestedUrl,
            final_url: requestedUrl,
            read_from: "live",
          },
        ],
        price_usd: 0,
      }),
    );
    return;
  }
  if (mode === "empty") {
    res.end(
      JSON.stringify({
        results: [{ status: "empty", text: "", url: requestedUrl, read_from: "live" }],
        price_usd: 0,
      }),
    );
    return;
  }
  res.end(
    JSON.stringify({
      results: [
        {
          status: "ok",
          text: "# Example Heading\n\nLive extracted markdown content.",
          url: requestedUrl,
          final_url: requestedUrl + "?final=1",
          read_from: mode,
        },
      ],
      price_usd: 0.0008,
    }),
  );
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
const readers = createReaders({
  endpoints: { specstream: base + "/v1/extract" },
  keys: { specstream: "test-specstream-key", judge: "test-judge-key" },
});
const target = { url: "https://example.org/article", title: "Example", category: "news" };

try {
  mode = "live";
  const live = await readers.read("specstream", target);
  assert.equal(lastRequest?.auth, "Bearer test-specstream-key");
  assert.deepEqual(lastRequest?.body, {
    urls: [target.url],
    format: "markdown",
    include: ["response"],
  });
  assert.equal(live.error, null);
  assert.equal(live.success, null);
  assert.equal(live.costUsd, 0.0008);
  assert.equal(live.finalUrl, target.url + "?final=1");
  assert.ok(live.text.includes("Live extracted markdown content."));

  mode = "site";
  const site = await readers.read("specstream", target);
  assert.equal(site.error, null);
  assert.ok(site.chars > 0);

  mode = "archive";
  const archive = await readers.read("specstream", target);
  assert.equal(archive.error, "CACHED_RESPONSE");
  assert.equal(archive.success, null);

  mode = "blocked";
  const blocked = await readers.read("specstream", target);
  assert.equal(blocked.error, "ORIGIN_ERROR");
  assert.equal(blocked.success, false);

  mode = "empty";
  const empty = await readers.read("specstream", target);
  assert.equal(empty.error, "INVALID_CONTENT_RESPONSE");
  assert.equal(empty.success, false);

  mode = "rate_limit";
  const limited = await readers.read("specstream", target);
  assert.equal(limited.error, "HTTP_429");
  assert.equal(limited.success, null);

  console.log(JSON.stringify({ ok: true, checked: 6 }));
} finally {
  server.close();
}
