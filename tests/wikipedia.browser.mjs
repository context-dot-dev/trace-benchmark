// Failure cases: missing/dead tab, lost deep link, contaminated daily scores,
// mismatched cohort denominators, stale pagination, empty search, overflow,
// broken evidence download, and inaccessible keyboard tab selection.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const base = process.env.BENCHMARK_URL || "http://localhost:3159";
const evidence = resolve("artifacts/wikipedia");
mkdirSync(evidence, { recursive: true });
const checks = [];
function browser(...args) {
  return execFileSync(
    "agent-browser",
    ["--session", "wiki-benchmark-e2e", ...args],
    { encoding: "utf8", timeout: 60000 },
  ).trim();
}
function check(expression, label) {
  assert.equal(browser("eval", expression), "true", label);
  checks.push(label);
}
const tab = '[role="tab"][data-tab-id="wikipedia"]';
browser("open", base);
browser("wait", "--fn", '!!document.querySelector("h1")');
check(`!!document.querySelector('${tab}')`, "Wikipedia tab exists");
browser("click", tab);
browser("wait", "--fn", '!!document.querySelector("[data-wikipedia-count]")');
check('location.hash === "#wikipedia"', "Tab has a deep link");
check(
  'document.querySelector("[data-wikipedia-count]").textContent === "1,041"',
  "Full sample excludes pilot retests",
);
check('!document.querySelector("#results")', "Daily results are isolated");
browser("select", "#wiki-cohort", "hard");
check(
  'document.querySelector("[data-wikipedia-count]").textContent === "73"',
  "Screened cohort denominator",
);
browser("select", "#wiki-category", "news");
check(
  'document.querySelector("[data-wikipedia-count]").textContent === "38"',
  "Category applies to scores and pages",
);
browser("select", "#wiki-cohort", "reference");
browser("select", "#wiki-category", "all");
check(
  'document.querySelector("[data-wikipedia-count]").textContent === "5"',
  "Reference cohort excludes unverified pages",
);
browser("fill", "#wiki-search", "no-such-page-xyz");
check(
  'document.querySelector("#wiki-pages").textContent.includes("No pages match")',
  "Empty search is explicit",
);
browser("fill", "#wiki-search", " ");
browser(
  "wait",
  "--fn",
  'document.querySelector("#wiki-search").value.trim() === ""',
);
browser("select", "#wiki-cohort", "all");
browser("click", 'button[aria-label="Next pages"]');
check(
  'document.querySelector("#wiki-page-range").textContent.includes("21–40")',
  "Page list advances",
);
browser("select", "#wiki-category", "jobs");
check(
  'document.querySelector("#wiki-page-range").textContent.includes("1–") || document.querySelector("#wiki-pages").textContent.includes("No pages match")',
  "Filter resets page position",
);
browser("select", "#wiki-category", "all");
browser("open", base + "/#wikipedia");
browser(
  "wait",
  "--fn",
  `document.querySelector('${tab}')?.getAttribute('aria-selected') === 'true'`,
);
check(
  'document.querySelector("[data-wikipedia-count]").textContent === "1,041"',
  "Direct navigation restores Wikipedia",
);
for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844],
]) {
  browser("set", "viewport", String(width), String(height));
  check(
    "document.documentElement.scrollWidth <= window.innerWidth",
    `${name}: no document overflow`,
  );
  browser("eval", 'window.scrollTo({top:0,behavior:"instant"})');
  browser("screenshot", resolve(evidence, `${name}-after.png`));
  if (name === "mobile") {
    check(
      'Array.from(document.querySelectorAll(".wiki-page-scroll td")).every(el => !!el.dataset.label)',
      "Mobile outcomes name their providers",
    );
    browser(
      "eval",
      'document.querySelector("#wiki-pages").scrollIntoView({behavior:"instant"})',
    );
    browser("screenshot", resolve(evidence, "mobile-pages.png"));
  }
}
browser("set", "viewport", "1440", "1000");
browser("click", tab);
browser("press", "ArrowLeft");
browser("wait", "--fn", 'location.hash === "#daily"');
check(
  '!!document.querySelector("#results")',
  "Keyboard returns to daily results",
);
browser("click", '[aria-label="Quality over time view"] [data-tab-id="table"]');
const dailyReport = await (await fetch(base + "/api/report")).json();
check(
  `document.querySelectorAll('[aria-label="Daily quality history"] tbody tr').length === ${dailyReport.history.length}`,
  "Complete daily timeline survives the merge",
);
check(
  `document.querySelector('[aria-label="Daily quality history"]').textContent.includes('Protocol')`,
  "Timeline retains protocol labels",
);
browser("back");
browser("wait", "--fn", 'location.hash === "#wikipedia"');
check(
  `document.querySelector('${tab}').getAttribute('aria-selected') === 'true'`,
  "Back restores tab",
);
browser("click", 'nav a[href="#wikipedia-citation"]');
check(
  `document.querySelector('${tab}').getAttribute('aria-selected') === 'true'`,
  "Citation keeps the selected cohort tab",
);
browser("select", "#wiki-cohort", "hard");
browser("select", "#wiki-category", "jobs");
check(
  'document.querySelector("[data-wikipedia-count]").textContent === "0"',
  "Empty category has a zero denominator",
);
check(
  'document.querySelector(".wiki-study .bench-bars").getAttribute("aria-label").includes("Context: —")',
  "Empty category is not scored as zero percent",
);
browser("select", "#wiki-category", "all");
browser(
  "click",
  '[aria-label="Wikipedia useful content view"] [data-tab-id="table"]',
);
check(
  'Array.from(document.querySelectorAll(".wiki-score-scroll tbody tr")).every(row => Array.from(row.querySelectorAll("td")).slice(0,3).reduce((sum,cell)=>sum+Number(cell.textContent),0) === 73)',
  "Provider outcomes reconcile to the cohort denominator",
);
const download = await fetch(base + "/data/wikipedia-study.json");
assert.equal(download.status, 200);
const data = await download.json();
assert.equal(data.pages.length, 1041);
assert.equal(data.pages.filter((p) => p.screened).length, 73);
assert.equal(
  data.pages.filter((p) => p.audit === "reference_checked").length,
  5,
);
checks.push("Download matches displayed cohorts");
writeFileSync(
  resolve(evidence, "browser-checks.json"),
  JSON.stringify({ base, checks, passed: true }, null, 2),
);
console.log(JSON.stringify({ passed: checks.length, evidence }));
browser("close");
