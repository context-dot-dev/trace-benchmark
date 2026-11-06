import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Failures: Nov 4 omitted; pre-cutoff dates offered or charted; protocol labels
// and boundaries retained; archived results mixed into daily scores; keyboard
// selection, source/category filters, mobile layout, or empty history regressing.
// History must use the selected source/category for every day, expose the active
// filters, preserve empty intersections as gaps, and restore overall data on reset.
// Removable chips must clear exactly one global filter, preserve keyboard focus,
// stay beside Chart/Table, and disappear completely when no filters are active.
// URL failures: lost deep links on SSR/reload, replaced browser history, unrelated
// query/hash deletion, invalid values, stale date responses, or chips scoped to
// only one section instead of clearing the global filters.
// Loading failures: a different pending sample masquerades as zero pages/categories,
// score tables report fabricated zeroes, Wikipedia shows a false empty state,
// downloads advertise zero records, failed requests look empty, late responses
// overwrite newer selections, or same-sample refreshes erase already loaded data.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const evidence = resolve("artifacts/history-sources");
mkdirSync(evidence, { recursive: true });
const providers = ["context", "exa", "firecrawl", "keenable"];
const sample = (day, protocol = "scraping-bench-v5") => ({
  id: day, day, protocol, status: "completed", pages: 2, target: 2,
  finishedAt: `${day}T23:00:00Z`, categories: { news: 1, other: 1 },
  providers: providers.map(id => ({ id, total: 2, useful: 2, failed: 0,
    unknown: 0, pending: 0, rate: 1, p50: 100, p95: 100, rateLimited: 0, categories: {} })),
});
const originalHistory = [sample("2026-11-06", "scraping-bench-v6"),
  sample("2026-11-05"), sample("2026-11-04", "scraping-bench-v4"),
  sample("2026-11-03"), sample("2026-10-29", "scraping-bench-v4")];
let history = structuredClone(originalHistory);
const fixturePage = (day, source, category, success = true) => ({
  id: `${day}-${source}`, url: `https://fixture.example/${day}/${source}`,
  title: `${day} ${source}`, source, category, day, protocol: "scraping-bench-v5",
  results: Object.fromEntries(providers.map(id => [id, { success, state: "done", error: null }])),
});
let filteredScenario = false;
let includeWikipediaHistory = true;
const filterPages = {};
const filteredHistory = [
  ["2026-11-06", 1, 1, 3, 2],
  ["2026-11-05", 4, 1, 2, 1],
  ["2026-11-04", 2, 1, 1, 0],
].map(([day, news, newsUseful, wiki, wikiUseful]) => {
  const pages = [
    ...Array.from({ length: news }, (_, i) => fixturePage(day, "daily", "news", i < newsUseful)),
    fixturePage(day, "daily", "jobs", day === "2026-11-04"),
    ...Array.from({ length: wiki }, (_, i) => fixturePage(day, "wikipedia_daily", "other", i < wikiUseful)),
  ].map((page, i) => ({ ...page, id: page.id + "-" + i, url: page.url + "/" + i }));
  filterPages[day] = pages;
  const categories = { news, jobs: 1, other: wiki };
  const groups = Object.fromEntries(Object.entries(categories).map(([category, total]) => [category, {
    total, useful: pages.filter(p => p.category === category && p.results.context.success).length,
    unknown: 0, completed: total,
  }]));
  const useful = pages.filter(p => p.results.context.success).length;
  return { ...sample(day), pages: pages.length, target: pages.length, categories,
    providers: providers.map(id => ({ id, total: pages.length, useful, failed: pages.length - useful,
      unknown: 0, pending: 0, rate: Object.values(groups).reduce((sum, g) => sum + g.useful / g.total, 0) / 3,
      p50: null, p95: null, rateLimited: 0, categories: groups })),
  };
});
function dataset(runId) {
  const latest = runId ? history.find(run => run.id === runId) ?? null : history[0] ?? null;
  return {
    ...(filteredScenario && includeWikipediaHistory ? { wikipediaHistory: filteredHistory.map(run => ({
      ...run, pages: run.categories.other, categories: { other: run.categories.other },
      providers: run.providers.map(metric => {
        const group = metric.categories.other;
        return { ...metric, total: group.total, useful: group.useful, failed: group.total - group.useful,
          rate: group.useful / group.total, categories: { other: group } };
      }),
    })) } : {}),
    report: { latest, history, collecting: null, records: [], totalRecords: 0, page: 0,
      health: { lastTick: null, error: null, sources: 0, healthySources: 0, evidenceBytes: 0 } },
    pages: [
      ...(latest ? filteredScenario ? filterPages[latest.day] ?? [] : [fixturePage(latest.day, "daily", "news"), fixturePage(latest.day, "wikipedia_daily", "other")] : []),
      fixturePage("2026-11-03", "daily", "news", false),
      fixturePage("2026-10-29", "wikipedia", "news", false),
    ],
  };
}
let slowRun = false;
let slowRunCompleted = false;
const fixture = createServer(async (req, res) => {
  const run = new URL(req.url, "http://localhost").searchParams.get("run");
  if (slowRun && run === "2026-11-04") {
    await new Promise(resolve => setTimeout(resolve, 800));
    slowRunCompleted = true;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(dataset(run)));
});
await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));
const port = process.env.TEST_PORT || "3186";
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", port], {
  env: { ...process.env, BENCHMARK_DATA_ORIGIN: `http://127.0.0.1:${fixture.address().port}`, TRACE_WORKER_ENABLED: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
app.stdout.on("data", data => { log += data; });
app.stderr.on("data", data => { log += data; });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 1000 }, reducedMotion: "reduce" });
await page.clock.install();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const checks = [];
const base = `http://localhost:${port}`;
let failure;
async function select(label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function sampleCount(expected) {
  await page.waitForFunction(count => document.querySelector("[data-sample-count]")?.textContent === String(count), expected);
}
async function date(day) {
  await page.waitForFunction(day => document.querySelector('.bench-history-day[data-active="true"] h3')?.textContent.includes(day), day);
}
try {
  const deadline = Date.now() + 60000;
  while (true) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (Date.now() >= deadline) throw new Error(log || "Next did not start");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("slider", { name: "History date" }).waitFor({ state: "visible" });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const initialChart = await page.locator(".bench-history").evaluate(container => ({
    container: container.getBoundingClientRect().width,
    viewBox: container.querySelector('svg[role="slider"]').viewBox.baseVal.width,
  }));
  assert.ok(Math.abs(initialChart.viewBox - initialChart.container) <= 1,
    `Initial mobile history must size its viewBox to its mounted container: ${JSON.stringify(initialChart)}`);
  checks.push("The initially mounted mobile history chart measures its actual container width");
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.match(await page.locator(".bench-history-range").textContent(), /November 4, 2026 – November 6, 2026/);
  assert.match(await page.locator(".bench-history-range").textContent(), /3 sampled days/);
  checks.push("History includes November 4, 5 and 6, and excludes every older sample");
  assert.equal(await page.locator(".bench-protocol-boundary").count(), 0);
  assert.doesNotMatch(await page.locator("body").innerText(), /\bprotocol\b|scraping-bench-v[456]|scores.*not directly comparable/i);
  assert.doesNotMatch(await page.locator("#history").textContent(), /\bv[456]\b/);
  checks.push("Mixed stored protocols produce no protocol labels, comparison notices, or chart boundaries");
  const slider = page.getByRole("slider", { name: "History date" });
  await slider.focus();
  await page.keyboard.press("Home");
  await date("November 4, 2026");
  await page.keyboard.press("End");
  await date("November 6, 2026");
  checks.push("History keyboard Home selects November 4 and End selects November 6");

  async function holdSample(run, response) {
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    let requested;
    const started = new Promise(resolve => { requested = resolve; });
    let handled;
    const completed = new Promise(resolve => { handled = resolve; });
    const pattern = `**/api/benchmark?run=${run}`;
    await page.route(pattern, async route => {
      requested();
      await ready;
      if (response) await route.fulfill(response);
      else await route.continue();
      handled();
    });
    return { started, release: async () => {
      release();
      await completed;
      await page.unroute(pattern);
    } };
  }
  async function missingSample(state) {
    assert.equal(await page.locator("[data-sample-count]").textContent(), "—",
      "A sample whose records have not loaded must not claim zero pages");
    assert.deepEqual(await page.locator(".sample-metrics dd").allTextContents(), ["—", "—"]);
    assert.match(await page.locator("#results").innerText(), state);
    assert.doesNotMatch(await page.locator("#results").innerText(), /No daily Wikipedia pages|0 pages match/);
    assert.equal(await page.locator("[data-download-results]").isDisabled(), true);
    for (const id of ["useful-content", "categories"]) {
      const section = page.locator(`#${id}`);
      for (const view of ["Table", "Chart"]) {
        await section.getByRole("tab", { name: view, exact: true }).click();
        assert.match(await section.innerText(), state);
        assert.equal(await section.locator("tbody td").filter({ hasText: /^0(?:\.0)?%?$/ }).count(), 0,
          `${id} ${view} must not display fabricated zero values`);
      }
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base, { waitUntil: "networkidle" });
    await select("Source", "Daily Wikipedia discoveries");
    await sampleCount(1);
    const pending = await holdSample("2026-11-04");
    await select("Sample date (UTC)", "2026-11-04");
    await pending.started;
    await missingSample(/Loading sample/i);
    await page.screenshot({ path: resolve(evidence, `loading-${width}.png`), fullPage: true });
    await pending.release();
    await sampleCount(1);
    assert.equal(await page.locator(".bench-sample strong").textContent(), "2026-11-04");
    assert.deepEqual(await page.locator(".sample-metrics dd").allTextContents(), ["1", "1"]);
    for (const score of await page.locator("[data-score]").allTextContents()) assert.equal(score, "100.0%");
    checks.push(`${width}px: delayed samples show loading placeholders across metrics, chart/table and downloads, then accurate results without false empty Wikipedia copy`);
  }
  const failed = await holdSample("2026-11-05", {
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture unavailable" }),
  });
  await select("Sample date (UTC)", "2026-11-05");
  await failed.started;
  await failed.release();
  await page.locator('#results [role="alert"]').waitFor({ state: "visible" });
  await missingSample(/unavailable|could not be loaded/i);
  await page.screenshot({ path: resolve(evidence, "sample-unavailable.png"), fullPage: true });
  const retry = await holdSample("2026-11-06");
  await select("Sample date (UTC)", "2026-11-06");
  await retry.started;
  await missingSample(/Loading sample/i);
  assert.equal(await page.locator('#results [role="alert"]').count(), 0,
    "Changing sample clears the previous request's error while loading");
  await retry.release();
  await sampleCount(1);
  checks.push("A failed sample is unavailable rather than empty, and another sample starts cleanly without stale error copy");
  const refresh = await holdSample("2026-11-06");
  await page.clock.fastForward(900000);
  await refresh.started;
  await sampleCount(1);
  assert.deepEqual(await page.locator(".sample-metrics dd").allTextContents(), ["1", "1"]);
  for (const score of await page.locator("[data-score]").allTextContents()) assert.equal(score, "100.0%");
  assert.equal(await page.locator("[data-download-results]").isDisabled(), false);
  await refresh.release();
  await page.waitForFunction(() => document.querySelector("#results")?.getAttribute("aria-busy") === "false");
  checks.push("An automatic background refresh of the loaded sample preserves its metrics, scores and download availability");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base, { waitUntil: "networkidle" });

  const historySection = page.locator("#history");
  await historySection.getByRole("tab", { name: "Table", exact: true }).click();
  assert.equal(await historySection.locator("tbody tr").count(), 3);
  const historyText = await historySection.locator("table").innerText();
  for (const day of ["2026-11-04", "2026-11-05", "2026-11-06"]) assert.ok(historyText.includes(day));
  assert.doesNotMatch(historyText, /2026-11-03|2026-10-29|protocol/i);
  await historySection.getByRole("tab", { name: "Chart", exact: true }).click();
  await page.getByRole("combobox", { name: "Sample date (UTC)" }).click();
  const dates = await page.getByRole("option").allTextContents();
  assert.equal(dates.length, 4);
  assert.deepEqual(dates.filter(text => /2026-/.test(text)).sort(), ["2026-11-04", "2026-11-05", "2026-11-06"]);
  await page.keyboard.press("Escape");
  checks.push("The history table and date selector expose exactly the three retained dates");

  const shared = ["useful-content", "categories", "history"];
  const deepLink = base + "?source=wikipedia_daily&category=commerce&run=2026-11-04&utm_source=e2e&tag=one&tag=two#history";
  await page.goto(deepLink, { waitUntil: "networkidle" });
  assert.match(await page.getByRole("combobox", { name: "Category", exact: true }).textContent(), /Commerce/);
  assert.match(await page.getByRole("combobox", { name: "Source", exact: true }).textContent(), /Daily Wikipedia discoveries/);
  assert.equal(await page.locator(".bench-sample strong").textContent(), "2026-11-04");
  for (const id of shared) {
    const chip = page.locator(`#${id}`).getByRole("button", { name: "Remove Commerce category filter", exact: true });
    assert.equal(await chip.count(), 1);
    assert.match(await chip.innerText(), /Commerce/);
  }
  await page.reload({ waitUntil: "networkidle" });
  assert.match(await page.getByRole("combobox", { name: "Category", exact: true }).textContent(), /Commerce/);
  assert.equal(await page.locator(".bench-sample strong").textContent(), "2026-11-04");
  checks.push("Commerce/source/date deep links and reloads retain selection, with visible Commerce chips on every chart section");
  async function query(expected) {
    await page.waitForURL(url => Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === value));
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("utm_source"), "e2e");
    assert.deepEqual(url.searchParams.getAll("tag"), ["one", "two"]);
    assert.equal(url.hash, "#history");
  }
  await select("Category", "News");
  await query({ category: "news", source: "wikipedia_daily", run: "2026-11-04" });
  await select("Source", "All daily sources");
  await query({ category: "news", source: null, run: "2026-11-04" });
  await sampleCount(1);
  await page.goBack();
  await query({ category: "news", source: "wikipedia_daily" });
  assert.match(await page.getByRole("combobox", { name: "Source", exact: true }).textContent(), /Daily Wikipedia discoveries/);
  await sampleCount(0);
  await page.goBack();
  await query({ category: "commerce", source: "wikipedia_daily" });
  assert.match(await page.getByRole("combobox", { name: "Category", exact: true }).textContent(), /Commerce/);
  await page.goForward();
  await query({ category: "news", source: "wikipedia_daily" });
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await query({ category: null, source: null, run: "2026-11-04" });
  await sampleCount(2);
  checks.push("Dropdown changes push browser history; Back/Forward restore filters and reset preserves date, unrelated repeated parameters, and hash");
  for (const id of shared) {
    await page.goto(deepLink.replace("category=commerce", "category=news"), { waitUntil: "networkidle" });
    const section = page.locator(`#${id}`);
    const categoryChip = section.getByRole("button", { name: "Remove News category filter", exact: true });
    const sourceChip = section.getByRole("button", { name: "Remove Daily Wikipedia discoveries source filter", exact: true });
    await section.getByRole("tab", { name: "Table", exact: true }).click();
    await categoryChip.focus();
    await page.keyboard.press("Enter");
    await query({ category: null, source: "wikipedia_daily", run: "2026-11-04" });
    assert.ok(await sourceChip.evaluate(button => document.activeElement === button));
    assert.equal(await page.getByRole("button", { name: "Remove News category filter", exact: true }).count(), 0);
    await sampleCount(1);
    await sourceChip.focus();
    await page.keyboard.press("Space");
    await query({ category: null, source: null, run: "2026-11-04" });
    assert.ok(await section.getByRole("tab", { name: "Table", exact: true }).evaluate(tab => document.activeElement === tab));
    await sampleCount(2);
    checks.push(`${id}: keyboard chip removal updates the URL and all sections while retaining focus in its own toolbar`);
  }
  await select("Sample date (UTC)", "Latest completed sample");
  await query({ run: null, source: null, category: null });
  await page.waitForFunction(() => document.querySelector(".bench-sample strong")?.textContent === "2026-11-06");
  slowRun = true;
  await select("Sample date (UTC)", "2026-11-04");
  await query({ run: "2026-11-04" });
  assert.notEqual(await page.evaluate(() => document.querySelector(".bench-sample strong")?.textContent ?? null), "2026-11-06",
    "A pending date selection must not display the previous date's scores");
  await select("Sample date (UTC)", "2026-11-05");
  await query({ run: "2026-11-05" });
  await page.waitForFunction(() => document.querySelector(".bench-sample strong")?.textContent === "2026-11-05");
  const slowDeadline = Date.now() + 5000;
  while (!slowRunCompleted && Date.now() < slowDeadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(slowRunCompleted);
  assert.equal(await page.locator(".bench-sample strong").textContent(), "2026-11-05");
  slowRun = false;
  await page.goBack();
  await query({ run: "2026-11-04" });
  await page.waitForFunction(() => document.querySelector(".bench-sample strong")?.textContent === "2026-11-04");
  await page.goForward();
  await query({ run: "2026-11-05" });
  await page.waitForFunction(() => document.querySelector(".bench-sample strong")?.textContent === "2026-11-05");
  checks.push("Date changes push history, omit latest defaults, hide stale results while loading, and reject late responses after a newer selection");
  await page.goto(base + "?source=invalid&category=invalid&run=2026-11-04", { waitUntil: "networkidle" });
  assert.match(await page.getByRole("combobox", { name: "Source", exact: true }).textContent(), /All daily sources/);
  assert.match(await page.getByRole("combobox", { name: "Category", exact: true }).textContent(), /All categories/);
  assert.equal(await page.getByRole("button", { name: /^Remove .* filter$/ }).count(), 0);
  for (const invalid of ["missing-run", "2026-11-03"]) {
    await page.goto(base + `?source=wikipedia_daily&category=commerce&run=${invalid}&utm_source=e2e&tag=one&tag=two`, { waitUntil: "networkidle" });
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("run"), null);
    assert.equal(url.searchParams.get("source"), "wikipedia_daily");
    assert.equal(url.searchParams.get("category"), "commerce");
    assert.equal(url.searchParams.get("utm_source"), "e2e");
    assert.deepEqual(url.searchParams.getAll("tag"), ["one", "two"]);
    assert.equal(await page.locator(".bench-sample strong").textContent(), "2026-11-06");
  }
  checks.push("Invalid source/category values use defaults; unknown or pre-cutoff runs redirect to latest without losing other parameters");
  await page.goto(base, { waitUntil: "networkidle" });
  for (const day of ["2026-11-04", "2026-11-05", "2026-11-06"]) {
    await select("Sample date (UTC)", day);
    await page.waitForFunction(day => document.querySelector(".bench-sample strong")?.textContent === day, day);
    await sampleCount(2);
    await select("Category", "News");
    await sampleCount(1);
    for (const score of await page.locator("[data-score]").allTextContents()) assert.equal(score, "100.0%");
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await sampleCount(2);
  }
  await page.getByRole("combobox", { name: "Source", exact: true }).click();
  assert.doesNotMatch((await page.getByRole("option").allTextContents()).join(" "), /original|Oct 29|archive/i);
  await page.keyboard.press("Escape");
  assert.doesNotMatch(await page.locator("#sample").innerText(), /Includes archived|Original Wikipedia study|October 29/);
  checks.push("Each historical daily sample excludes older daily and archived Wikipedia pages from its counts and scores");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await select("Source", "Daily Wikipedia discoveries");
    await sampleCount(1);
    await select("Category", "News");
    await sampleCount(0);
    assert.match(await page.locator("#results").innerText(), /No daily Wikipedia pages/);
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await sampleCount(2);
    await select("Category", "News");
    await sampleCount(1);
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    for (const id of ["useful-content", "categories", "history"]) {
      const section = page.locator(`#${id}`);
      await section.getByRole("tab", { name: "Table", exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await section.getByRole("tab", { name: "Chart", exact: true }).click();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    checks.push(`${width}px: source/category filters, reset, empty filtered results and table/chart layouts work without page overflow`);
  }
  filteredScenario = true;
  history = structuredClone(filteredHistory);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base, { waitUntil: "networkidle" });
  const chips = historySection.getByRole("button", { name: /^Remove .* filter$/ });
  const newsChip = historySection.getByRole("button", { name: "Remove News category filter", exact: true });
  const wikiChip = historySection.getByRole("button", { name: "Remove Daily Wikipedia discoveries source filter", exact: true });
  assert.equal(await chips.count(), 0);
  assert.doesNotMatch(await historySection.innerText(), /All daily sources|All categories|Filters applied:/);
  async function historyRows(expected) {
    await historySection.getByRole("tab", { name: "Table", exact: true }).click();
    for (const [day, count, rate] of expected) {
      const row = historySection.locator("tbody tr").filter({ hasText: day });
      const cells = await row.locator("th,td").allTextContents();
      assert.equal(cells[2], String(count), `${day} history pages must follow the active filters`);
      assert.deepEqual(cells.slice(3), [rate, rate, rate, rate], `${day} history rates must follow the active filters`);
    }
    await historySection.getByRole("tab", { name: "Chart", exact: true }).click();
  }
  await select("Category", "News");
  await historyRows([["2026-11-04", 2, "50.0%"], ["2026-11-05", 4, "25.0%"], ["2026-11-06", 1, "100.0%"]]);
  assert.equal(await newsChip.count(), 1);
  assert.equal(await chips.count(), 1);
  assert.equal(await historySection.getByRole("group", { name: "Applied filters" }).count(), 1);
  assert.doesNotMatch(await historySection.innerText(), /All daily sources|All categories|Filters applied:/);
  const { chipBox, tabsBox } = await historySection.evaluate(section => ({
    chipBox: section.querySelector('button[aria-label="Remove News category filter"]').getBoundingClientRect().toJSON(),
    tabsBox: section.querySelector('[role="tablist"]').getBoundingClientRect().toJSON(),
  }));
  assert.ok(Math.abs(chipBox.y + chipBox.height / 2 - tabsBox.y - tabsBox.height / 2) <= 4,
    `The active chip belongs in the same toolbar row as Chart/Table: ${JSON.stringify({ chipBox, tabsBox })}`);
  checks.push("Category filtering updates every historical day with its own page count and rate, with active filters shown beside history");
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await select("Source", "Daily Wikipedia discoveries");
  await historyRows([["2026-11-04", 1, "0.0%"], ["2026-11-05", 2, "50.0%"], ["2026-11-06", 3, "66.7%"]]);
  assert.equal(await wikiChip.count(), 1);
  assert.equal(await chips.count(), 1);
  assert.doesNotMatch(await historySection.innerText(), /All categories|Filters applied:/);
  checks.push("Wikipedia filtering updates every historical day and identifies the selected source beside history");
  await select("Category", "News");
  await historyRows([["2026-11-04", 0, "—"], ["2026-11-05", 0, "—"], ["2026-11-06", 0, "—"]]);
  assert.equal(await historySection.locator("svg circle title").count(), 0);
  assert.equal(await chips.count(), 2);
  assert.equal(await newsChip.count(), 1);
  assert.equal(await wikiChip.count(), 1);
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push("An empty source/category intersection stays empty across all days without falling back to overall scores");
  await newsChip.focus();
  await page.keyboard.press("Enter");
  assert.ok(await wikiChip.evaluate(button => document.activeElement === button));
  assert.equal(await newsChip.count(), 0);
  assert.match(await page.getByRole("combobox", { name: "Source", exact: true }).textContent(), /Daily Wikipedia discoveries/);
  assert.match(await page.getByRole("combobox", { name: "Category", exact: true }).textContent(), /All categories/);
  await sampleCount(3);
  await historyRows([["2026-11-04", 1, "0.0%"], ["2026-11-05", 2, "50.0%"], ["2026-11-06", 3, "66.7%"]]);
  await wikiChip.focus();
  await page.keyboard.press("Enter");
  assert.ok(await historySection.getByRole("tab", { name: "Chart", exact: true }).evaluate(tab => document.activeElement === tab));
  await sampleCount(5);
  assert.equal(await chips.count(), 0);
  checks.push("Keyboard category-chip removal preserves the source, updates all results, and moves focus to the remaining chip; removing the final chip focuses Chart");
  await select("Source", "Daily Wikipedia discoveries");
  await select("Category", "News");
  await wikiChip.focus();
  await page.keyboard.press("Enter");
  assert.ok(await newsChip.evaluate(button => document.activeElement === button));
  assert.match(await page.getByRole("combobox", { name: "Source", exact: true }).textContent(), /All daily sources/);
  assert.match(await page.getByRole("combobox", { name: "Category", exact: true }).textContent(), /News/);
  await sampleCount(1);
  await historyRows([["2026-11-04", 2, "50.0%"], ["2026-11-05", 4, "25.0%"], ["2026-11-06", 1, "100.0%"]]);
  await historySection.getByRole("tab", { name: "Table", exact: true }).click();
  await newsChip.focus();
  await page.keyboard.press("Space");
  assert.ok(await historySection.getByRole("tab", { name: "Table", exact: true }).evaluate(tab => document.activeElement === tab));
  await sampleCount(5);
  assert.equal(await chips.count(), 0);
  checks.push("Keyboard source-chip removal preserves the category and global results; removing the final chip focuses the selected Table tab");
  await select("Category", "News");
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await historyRows([["2026-11-04", 4, "50.0%"], ["2026-11-05", 7, "25.0%"], ["2026-11-06", 5, "55.6%"]]);
  assert.equal(await chips.count(), 0);
  assert.doesNotMatch(await historySection.innerText(), /All daily sources|All categories|Filters applied:/);
  checks.push("Reset restores the saved overall historical totals and category-weighted rates");
  includeWikipediaHistory = false;
  await page.goto(base, { waitUntil: "networkidle" });
  await select("Source", "Daily Wikipedia discoveries");
  await historyRows([["2026-11-04", "—", "—"], ["2026-11-05", "—", "—"], ["2026-11-06", "—", "—"]]);
  assert.match(await historySection.innerText(), /unavailable|not available/i);
  checks.push("Missing Wikipedia history is explicitly unavailable and never substitutes overall scores");
  filteredScenario = false;
  history = [sample("2026-11-03")];
  await page.goto(base, { waitUntil: "networkidle" });
  assert.match(await page.locator("#history").innerText(), /No historical samples/);
  await sampleCount(0);
  checks.push("Only pre-cutoff history produces no visible daily results");
  history = [];
  await page.goto(base, { waitUntil: "networkidle" });
  assert.match(await page.locator("#history").innerText(), /No historical samples/);
  await sampleCount(0);
  checks.push("Empty history stays empty even when archived pages are present");
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error.stack ?? String(error);
  throw error;
} finally {
  writeFileSync(resolve(evidence, "checks.json"), JSON.stringify({ ok: !failure, failure, base, checks, errors,
    fixture: { dates: originalHistory.map(run => run.day), dailyPagesPerDate: 2, excludedArchive: "2026-10-29" },
    filterFixture: filteredHistory.map(run => ({ day: run.day, pages: run.pages, categories: run.providers[0].categories })),
    repeat: "PLAYWRIGHT_PATH=/absolute/path/to/playwright TEST_PORT=3186 node tests/history-sources.browser.mjs" }, null, 2));
  writeFileSync(resolve(evidence, "server.log"), log);
  await browser.close();
  app.kill("SIGTERM");
  fixture.closeAllConnections();
  fixture.close();
}
console.log(JSON.stringify({ ok: true, checks, artifact: resolve(evidence, "checks.json") }, null, 2));
