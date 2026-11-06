import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.BENCHMARK_URL || "http://localhost:3308";
const session = process.env.AGENT_BROWSER_SESSION || "trace-social-preview";
const evidence = resolve("artifacts/og");
mkdirSync(evidence, { recursive: true });
const browser = (...args) => execFileSync("agent-browser", ["--session", session, ...args], {
  encoding: "utf8", timeout: 60000,
}).trim();
let failure;
let metadata;
try {
  browser("open", base);
  metadata = JSON.parse(browser("eval", `Object.fromEntries([...document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]')].map(el => [el.getAttribute('property') || el.name, el.content]))`));
  assert.ok(metadata["og:image"], "Shared links have an Open Graph image");
  const image = new URL(metadata["og:image"]);
  assert.equal(image.origin, "https://trace.context.dev", "Image URL uses the public site origin");
  assert.equal(metadata["og:image:width"], "1200");
  assert.equal(metadata["og:image:height"], "630");
  assert.match(metadata["og:image:alt"], /TRACE.*web scraping benchmark/);
  assert.equal(metadata["twitter:card"], "summary_large_image");
  assert.equal(metadata["twitter:image"], image.href, "Both sharing formats use the same image");
  assert.equal(metadata["twitter:image:alt"], metadata["og:image:alt"]);
  const response = await fetch(new URL(image.pathname + image.search, base));
  assert.equal(response.status, 200, "Image is publicly served without authentication");
  assert.match(response.headers.get("content-type"), /^image\/png/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  assert.ok(bytes.length < 5_000_000, "Image fits social card size limits");
  writeFileSync(resolve(evidence, "served-image.png"), bytes);
  browser("set", "viewport", "1200", "630");
  browser("open", new URL(image.pathname + image.search, base).href);
  browser("wait", "--fn", "document.querySelector('img')?.complete && document.querySelector('img').naturalWidth === 1200");
  browser("screenshot", resolve(evidence, "social-preview.png"));
} catch (error) {
  failure = error;
} finally {
  writeFileSync(resolve(evidence, "metadata-checks.json"), JSON.stringify({ metadata, passed: !failure, failure: failure?.stack }, null, 2));
  browser("close");
}
if (failure) throw failure;
console.log(`Social preview metadata, PNG response and browser decode verified. Evidence: ${evidence}`);
