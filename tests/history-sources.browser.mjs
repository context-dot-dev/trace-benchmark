import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const evidence = resolve("artifacts/history-sources");
mkdirSync(evidence, { recursive: true });
const before = process.argv.includes("--before");
const providers = ["context", "exa", "firecrawl", "keenable"];
const run = (day, status, pages = 8) => ({
  id: day,
  day,
  status,
  pages,
  target: 2400,
  protocol: "scraping-bench-v4",
  finishedAt: status === "completed" ? `${day}T23:00:00Z` : null,
  categories: {},
  providers: providers.map((id) => ({
    id,
    total: pages,
    useful: pages,
    failed: 0,
    unknown: 0,
    pending: status === "completed" ? 0 : pages,
    rate: status === "completed" ? 1 : null,
    p50: null,
    p95: null,
    rateLimited: 0,
    categories: {},
  })),
});
const wiki = JSON.parse(
  readFileSync("public/data/wikipedia-study.json", "utf8"),
);
const history = [
  run("2026-11-02", "insufficient_supply", 0),
  run("2026-11-01", "completed"),
  run("2026-10-29", "completed"),
];
const original = {
  report: {
    latest: history[1],
    history,
    collecting: null,
    records: [],
    totalRecords: 0,
    page: 0,
    health: {
      lastTick: null,
      error: null,
      sources: 0,
      healthySources: 0,
      evidenceBytes: 0,
    },
  },
  pages: wiki.pages.map((p) => ({
    ...p,
    source: "wikipedia",
    day: wiki.measuredAt,
    protocol: wiki.grading,
    results: Object.fromEntries(
      providers.map((id) => [id, { ...p.results[id], state: "done" }]),
    ),
  })),
};
let dataset = structuredClone(original);
const fixture = createServer((_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(dataset));
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const port = process.env.TEST_PORT || "3186";
const app = spawn("bun", ["run", "dev", "--port", port], {
  env: {
    ...process.env,
    BENCHMARK_DATA_ORIGIN: `http://127.0.0.1:${fixture.address().port}`,
    TRACE_WORKER_ENABLED: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
app.stdout.on("data", (data) => (log += data));
app.stderr.on("data", (data) => (log += data));
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
const base = `http://localhost:${port}`;
const card = page.locator('.bench-history-day[data-active="true"]');
async function expectDate(day, label) {
  await page.waitForFunction(
    (day) =>
      document
        .querySelector('.bench-history-day[data-active="true"] h3')
        ?.textContent.includes(day),
    day,
    { timeout: 5000 },
  );
  checks.push(label);
}
async function capture(name, selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(evidence, `${name}.png`) });
}
try {
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        if ((await fetch(base)).ok) {
          clearInterval(timer);
          resolve();
        }
      } catch {}
      if (Date.now() - started > 60000) {
        clearInterval(timer);
        reject(new Error(log));
      }
    }, 500);
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await capture(
    before ? "history-before" : "history-after",
    ".bench-history-detail",
  );
  await capture(
    before ? "sources-before" : "sources-after",
    before ? "#methodology" : "#sources",
  );
  if (before) {
    assert.match(await card.textContent(), /November 2, 2026/);
    console.log(
      "Reproduced: empty November 2 selected instead of completed November 1",
    );
    process.exitCode = 0;
  } else {
    await expectDate(
      "November 1, 2026",
      "Latest completed sample wins over newer empty run",
    );
    const slider = page.getByRole("slider", { name: "History date" });
    await slider.focus();
    await page.keyboard.press("Home");
    await expectDate(
      "October 29, 2026",
      "Keyboard inspection preserves historical dates",
    );
    await page.getByRole("button", { name: "Latest completed result" }).click();
    await expectDate(
      "November 1, 2026",
      "Latest control restores newest completed sample",
    );
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    await page.mouse.move(box.x + 46, box.y + 100);
    await expectDate("October 29, 2026", "Hover inspects an older day");
    await page.mouse.move(0, 0);
    await expectDate(
      "November 1, 2026",
      "Leaving hover restores latest result",
    );
    await slider.focus();
    await page.keyboard.press("End");
    assert.match(await card.textContent(), /No pages were collected/);
    checks.push("An empty run is labeled without presenting zero scores");

    dataset = structuredClone(original);
    dataset.report.history[0] = run("2026-11-02", "completed");
    dataset.report.latest = dataset.report.history[0];
    await page.route("**/api/benchmark?*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ json: dataset });
    });
    // The server initially renders yesterday; the delayed refresh completes today.
    const refreshed = structuredClone(dataset);
    dataset = structuredClone(original);
    await page.goto(base, { waitUntil: "domcontentloaded" });
    dataset = refreshed;
    await expectDate(
      "November 2, 2026",
      "Newly completed day becomes default after delayed refresh",
    );
    await page.unrouteAll({ behavior: "wait" });

    dataset = structuredClone(original);
    dataset.report.history = [
      run("2026-11-02", "insufficient_supply", 0),
      run("2026-11-01", "collecting"),
    ];
    dataset.report.latest = dataset.report.history[1];
    await page.goto(base, { waitUntil: "networkidle" });
    await expectDate(
      "November 1, 2026",
      "Without completed runs, newest nonempty sample is shown",
    );
    assert.match(await card.textContent(), /Collection in progress/);
    dataset.report.history = [];
    dataset.report.latest = null;
    await page.goto(base, { waitUntil: "networkidle" });
    assert.match(
      await page.locator("#history").textContent(),
      /No historical samples/,
    );
    checks.push("Empty history has a truthful empty state");

    dataset = structuredClone(original);
    await page.goto(base, { waitUntil: "networkidle" });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page
        .getByRole("link", { name: "Explore the sources and example pages" })
        .click();
      assert.equal(new URL(page.url()).hash, "#sources");
      await page
        .getByRole("link", { name: "About the original Wikipedia study" })
        .click();
      assert.equal(new URL(page.url()).hash, "#wikipedia");
      assert.match(await page.locator("#wikipedia").textContent(), /1,041/);
      assert.equal(
        await page.locator('#wikipedia a[href*="oldid="]').count(),
        3,
      );
      await page
        .getByRole("button", { name: "View original Wikipedia results" })
        .click();
      assert.match(
        await page
          .getByRole("combobox", { name: "Source", exact: true })
          .textContent(),
        /Wikipedia/,
      );
      assert.equal(
        await page.locator("[data-sample-count]").textContent(),
        "1,041",
      );
      assert.equal(
        await page
          .getByRole("combobox", { name: "Sample date (UTC)" })
          .isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "Reset filters" }).click();
      await page
        .getByRole("link", { name: "Wikipedia screening and reference checks" })
        .click();
      assert.equal(new URL(page.url()).hash, "#wikipedia-methodology");
      assert.equal(
        await page.locator("#methodology summary").filter({ hasText: "Wikipedia screening" }).count(),
        1,
      );
      assert.equal(await page.locator("#wikipedia details").count(), 0);
      await capture(`wikipedia-${width}-after`, "#wikipedia");
      await capture(`sources-${width}-after`, "#sources");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      checks.push(
        `${width}px: source anchors, linked revisions, filter action and layout work`,
      );
    }
    const dailyWiki = {
      id: "daily-wiki-fixture", url: "https://example.org/newly-cited", title: "",
      source: "wikipedia_daily", category: "other", day: "2026-11-01",
      protocol: "scraping-bench-v5", article: "Example article", revision: 123,
      citedAt: "2026-11-01T00:10:00Z",
      results: Object.fromEntries(providers.map(id => [id, { success: true, state: "done", error: null }])),
    };
    dataset.pages.push(dailyWiki);
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "View daily Wikipedia results", exact: true }).click();
    assert.equal(await page.locator("[data-sample-count]").textContent(), "1");
    assert.equal(await page.getByRole("combobox", { name: "Sample date (UTC)" }).isDisabled(), false);
    assert.equal(await page.locator("[data-score]").count(), 4);
    for (const text of await page.locator("[data-score]").allTextContents()) assert.equal(text, "100.0%");
    await capture("daily-wikipedia-after", "#sample");
    dataset.pages = dataset.pages.filter(p => p.source !== "wikipedia_daily");
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "View daily Wikipedia results", exact: true }).click();
    assert.match(await page.locator("#results").textContent(), /No daily Wikipedia pages/);
    await page.getByRole("button", { name: "View original Wikipedia results", exact: true }).click();
    assert.equal(await page.locator("[data-sample-count]").textContent(), "1,041");
    checks.push("Daily Wikipedia uses the selected date, shows only fresh records and has a truthful empty state; the original study remains separate");
    assert.deepEqual(errors, []);
    console.log(checks.join("\n"));
  }
  writeFileSync(
    resolve(evidence, before ? "before.json" : "checks.json"),
    JSON.stringify({ base, checks, before, errors }, null, 2),
  );
} finally {
  writeFileSync(resolve(evidence, "server.log"), log);
  await browser.close();
  app.kill("SIGTERM");
  fixture.close();
}
