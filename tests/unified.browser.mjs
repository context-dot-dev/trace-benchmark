import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const base = process.env.BENCHMARK_URL || "http://localhost:3159";
const evidence = resolve("artifacts/unified");
mkdirSync(evidence, { recursive: true });
const checks = [];
function browser(...args) {
  return execFileSync(
    "agent-browser",
    ["--session", "unified-verified", ...args],
    { encoding: "utf8", timeout: 60000 },
  ).trim();
}
function check(expression, label) {
  assert.equal(browser("eval", expression), "true", label);
  checks.push(label);
  console.log(label);
}
function choose(label, option) {
  browser("click", `[role="combobox"][aria-label="${label}"]`);
  browser("wait", "200");
  browser("snapshot", "-i");
  browser("find", "role", "option", "click", "--name", option, "--exact");
  browser("wait", "200");
  browser("wait", "--fn", "!document.querySelector('[role=listbox]')");
}
const response = await fetch(base + "/api/benchmark");
assert.equal(response.status, 200, "Unified dataset endpoint exists");
const dataset = await response.json();
const wiki = await (await fetch(base + "/data/wikipedia-study.json")).json();
assert.equal(
  dataset.pages.filter((p) => p.source === "wikipedia").length,
  wiki.pages.length,
);
assert.equal(
  dataset.pages.filter((p) => p.source === "daily").length,
  dataset.report.latest.pages,
);
const dailyDownload = (
  await (
    await fetch(
      base +
        "/api/download?run=" +
        encodeURIComponent(dataset.report.latest.id),
    )
  ).text()
)
  .trim()
  .split("\n")
  .map(JSON.parse);
for (const provider of ["context", "exa", "firecrawl", "keenable"]) {
  assert.equal(
    dataset.pages.filter(
      (p) => p.source === "daily" && p.results[provider]?.success === true,
    ).length,
    dailyDownload.filter((r) => r.provider === provider && r.success === true)
      .length,
  );
}
checks.push("Dataset matches original Wikipedia study and daily download");
const key = (u) => {
  const url = new URL(u);
  url.hash = "";
  return url.href;
};
const unique = [
  ...new Map([...dataset.pages].reverse().map((p) => [key(p.url), p])).values(),
];
const cats = [...new Set(unique.map((p) => p.category))];
const expected = Object.fromEntries(
  ["context", "exa", "firecrawl", "keenable"].map((provider) => [
    provider,
    (
      (cats.reduce((n, c) => {
        const rows = unique.filter((p) => p.category === c);
        return (
          n +
          rows.filter((p) => p.results[provider]?.success === true).length /
            rows.length
        );
      }, 0) /
        cats.length) *
      100
    ).toFixed(1) + "%",
  ]),
);
browser("open", base);
browser("wait", "--fn", '!!document.querySelector("[data-sample-count]")');
check(
  "!document.querySelector('[aria-label=\"Benchmark sample\"]')",
  "One view, no source tabs",
);
check(
  '!document.querySelector("#page-results") && !document.querySelector("#page-range") && !document.body.textContent.includes("Inspect the pages")',
  "Reader view omits page inspector and pagination",
);
check(
  '!document.querySelector("#page-search") && document.querySelectorAll(".sample-filters [role=combobox]").length === 3',
  "Only source, category and validation filters are shown",
);
check(
  `document.querySelector('[data-sample-count]').textContent === '${unique.length.toLocaleString("en-US")}'`,
  "Default includes both sources, deduplicated",
);
for (const [provider, value] of Object.entries(expected))
  check(
    `document.querySelector('[data-score="${provider}"]').textContent === '${value}'`,
    `${provider}: combined score independently reconciles`,
  );
choose("Source", "Wikipedia citations");
check(
  'document.querySelector("[data-sample-count]").textContent === "1,041"',
  "Wikipedia source is a filter",
);
choose("Validation", "Screened hard candidates");
check(
  'document.querySelector("[data-sample-count]").textContent === "73"',
  "Hard cohort has 73 pages",
);
choose("Category", "News");
check(
  'document.querySelector("[data-sample-count]").textContent === "38"',
  "Category and validation intersect",
);
choose("Category", "Jobs");
check(
  'document.querySelector("[data-sample-count]").textContent === "0" && document.querySelector("[data-score=context]").textContent === "—"',
  "Empty cohort is not zero percent",
);
choose("Category", "All categories");
choose("Validation", "Reference checked");
check(
  'document.querySelector("[data-sample-count]").textContent === "5"',
  "Reference cohort excludes unresolved audits",
);
choose("Source", "Daily feeds & registries");
check(
  'document.querySelector("[data-sample-count]").textContent === "0"',
  "Unaudited daily pages cannot enter reference cohort",
);
choose("Validation", "All pages");
check(
  `document.querySelector('[data-sample-count]').textContent === '${dataset.report.latest.pages.toLocaleString("en-US")}'`,
  "Daily-only denominator preserved",
);
for (const row of dataset.report.latest.providers)
  check(
    `document.querySelector('[data-score="${row.id}"]').textContent === '${(row.rate * 100).toFixed(1)}%'`,
    `${row.id}: original daily score preserved`,
  );
choose("Source", "All sources");
choose("Source", "Wikipedia citations");
browser("click", 'button[aria-label="Reset filters"]');
check(
  `document.querySelector('[data-sample-count]').textContent === '${unique.length.toLocaleString("en-US")}'`,
  "Reset restores overall view",
);
browser(
  "click",
  '[aria-label="Daily quality over time view"] [data-tab-id="table"]',
);
check(
  `document.querySelectorAll('[aria-label="Daily quality history"] tbody tr').length === ${dataset.report.history.length}`,
  "Complete original timeline retained",
);
check(
  'document.querySelector("#methodology").textContent.includes("identity-content-jev-v2")',
  "Different grading protocols disclosed",
);
browser("open", base + "/#wikipedia");
browser("wait", "--fn", '!!document.querySelector("[data-sample-count]")');
check(
  `document.querySelector('[data-sample-count]').textContent === '${unique.length.toLocaleString("en-US")}'`,
  "Legacy tab URL lands on overall benchmark",
);
for (const [name, w, h] of [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844],
]) {
  browser("set", "viewport", String(w), String(h));
  browser("eval", 'window.scrollTo({top:0,behavior:"instant"})');
  check(
    "document.documentElement.scrollWidth <= innerWidth",
    name + ": no horizontal overflow",
  );
  browser("screenshot", resolve(evidence, name + "-after.png"));
  check(
    'Array.from(document.querySelectorAll(".bench-radar text")).every(e=>{const b=e.getBoundingClientRect();return b.left>=0 && b.right<=innerWidth})',
    name + ": radar labels stay within viewport",
  );
  if (name === "mobile") {
    browser(
      "eval",
      'document.querySelector(".sample-metrics").scrollIntoView({behavior:"instant"})',
    );
    browser("screenshot", resolve(evidence, "mobile-scores.png"));
    browser(
      "eval",
      'document.querySelector(".bench-radar").scrollIntoView({behavior:"instant"})',
    );
    browser("screenshot", resolve(evidence, "mobile-categories.png"));
    browser(
      "eval",
      'document.querySelector("[data-download-results]").scrollIntoView({behavior:"instant",block:"start"})',
    );
    browser("screenshot", resolve(evidence, "mobile-summary.png"));
  }

  choose("Source", "Wikipedia citations");
  browser("screenshot", resolve(evidence, name + "-filtered.png"));
  browser("click", '[role="combobox"][aria-label="Category"]');
  browser("press", "Escape");
  browser(
    "wait",
    "--fn",
    'document.activeElement.getAttribute("aria-label") === "Category"',
  );
  check(
    'document.activeElement.getAttribute("aria-label") === "Category"',
    name + ": menu restores focus",
  );
  browser("click", 'button[aria-label="Reset filters"]');
}
browser(
  "download",
  "[data-download-results]",
  resolve(evidence, "filtered-results.json"),
);
const downloaded = JSON.parse(
  readFileSync(resolve(evidence, "filtered-results.json"), "utf8"),
);
assert.equal(downloaded.pages.length, unique.length);
assert.deepEqual(
  downloaded.scores.map((r) => [r.id, (r.rate * 100).toFixed(1) + "%"]),
  Object.entries(expected),
);
checks.push("Downloaded filtered results match displayed counts and scores");
browser("set", "viewport", "1440", "1000");
browser(
  "eval",
  'window.scrollTo({top:0,behavior:"instant"});document.documentElement.dataset.theme="dark"',
);
browser("wait", "300");
browser("screenshot", resolve(evidence, "dark-after.png"));
browser("eval", 'document.documentElement.dataset.theme="light"');
writeFileSync(
  resolve(evidence, "browser-checks.json"),
  JSON.stringify(
    {
      base,
      passed: true,
      checks,
      expected,
      counts: { pages: unique.length, categories: cats.length },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ passed: checks.length, evidence }));
browser("close");
