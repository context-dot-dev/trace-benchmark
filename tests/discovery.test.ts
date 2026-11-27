// Unit checks for source discovery that need no network:
//   npx tsx tests/discovery.test.ts
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { decodeSource, discoverSource, type Source } from "../src/lib/benchmark/discovery";

const checks: string[] = [];
const urlset = (urls: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;

const xml = urlset(["https://www.example-store.com/ip/widget/123"]);
assert.equal(decodeSource(gzipSync(Buffer.from(xml))), xml);
assert.equal(decodeSource(Buffer.from(xml)), xml);
checks.push("Gzip-compressed sitemap files are decompressed; plain responses pass through");

const pages = [
  "https://www.example-store.com/ip/widget/123",
  "https://www.example-store.com/products/gadget",
  "https://www.example-store.com/browse/shoes",
];
const store: Source = {
  source_id: "store", url: "https://www.example-store.com/sitemap.xml", kind: "sitemap",
  category: "commerce", organization: "Example Store", poll_interval_hours: 24,
};
const read = async () => urlset(pages);
assert.deepEqual((await discoverSource(store, { read })).map((c) => c.url), [pages[1]]);
assert.deepEqual(
  (await discoverSource({ ...store, eligibility: { path_contains: "/ip/" } }, { read })).map((c) => c.url),
  [pages[0]],
);
checks.push("Commerce sources keep product pages by their own path, defaulting to the Shopify /products/ layout");

const index = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.example-store.com/pdp-1.xml.gz</loc></sitemap><sitemap><loc>https://www.example-store.com/stores.xml</loc></sitemap></sitemapindex>`;
const requested: string[] = [];
const found = await discoverSource(
  { ...store, url: "https://www.example-store.com/index.xml", sitemap_filter: "pdp", eligibility: { path_contains: "/ip/" } },
  { read: async (u) => { requested.push(u); return u.endsWith("index.xml") ? index : urlset(pages); } },
);
assert.deepEqual(requested, ["https://www.example-store.com/index.xml", "https://www.example-store.com/pdp-1.xml.gz"]);
assert.deepEqual(found.map((c) => c.url), [pages[0]]);
checks.push("A sitemap index is narrowed to matching child sitemaps before product pages are filtered");

console.log(JSON.stringify({ ok: true, checks }, null, 2));
