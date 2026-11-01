import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const engines = require(process.argv[2] || "playwright");
const browser = await engines[process.argv[4] || "chromium"].launch();
const base = process.argv[3] || "http://localhost:3010";

try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#results").getAttribute("aria-busy") === "false");
  const originalDay = await page.locator(".bench-sample strong").textContent();
  const originalCount = await page.locator("[data-sample-count]").textContent();
  await page.evaluate(async () => {
    window.testDataset = await (await fetch("/api/benchmark")).json();
    window.pendingBenchmarkRequests = [];
    const originalFetch = window.fetch;
    window.fetch = (input, options) => {
      if (String(input).startsWith("/api/benchmark?")) {
        return new Promise((resolve, reject) => window.pendingBenchmarkRequests.push({ resolve, reject, options }));
      }
      return originalFetch(input, options);
    };
  });
  const chooseSample = async (position) => {
    await page.getByRole("combobox", { name: "Sample date (UTC)", exact: true }).click();
    await page.keyboard.press("Home");
    for (let index = 0; index < position; index += 1) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
  };
  await chooseSample(1);
  await page.waitForFunction(() => window.pendingBenchmarkRequests.length === 1);
  await chooseSample(2);
  await page.waitForFunction(() => window.pendingBenchmarkRequests.length === 2);
  assert.equal(await page.evaluate(() => window.pendingBenchmarkRequests[0].options.signal.aborted), true);
  await page.evaluate(() => {
    const stale = structuredClone(window.testDataset);
    stale.report.latest.day = "1999-01-01";
    window.pendingBenchmarkRequests[0].resolve(Response.json(stale));
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.locator(".bench-sample strong").textContent(), originalDay);
  assert.equal(await page.locator("#results").getAttribute("aria-busy"), "true");
  await page.evaluate(() => window.pendingBenchmarkRequests[1].resolve(new Response(null, { status: 503 })));
  await page.locator("#results").getByRole("alert").waitFor();
  await page.waitForFunction(() => document.querySelector("#results").getAttribute("aria-busy") === "false");
  assert.equal(await page.locator("[data-sample-count]").textContent(), originalCount);
  await chooseSample(0);
  await page.waitForFunction(() => window.pendingBenchmarkRequests.length === 3);
  await page.evaluate(() => window.pendingBenchmarkRequests[2].resolve(Response.json(window.testDataset)));
  await page.locator("#results").getByRole("alert").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.querySelector("#results").getAttribute("aria-busy") === "false");
  assert.equal(await page.locator(".bench-sample strong").textContent(), originalDay);

  await page.locator("#categories").getByRole("tab", { name: "Table", exact: true }).click();
  const categoryRows = page.locator("#categories tbody tr");
  const categoryName = await categoryRows.nth(1).locator("th").textContent();
  await categoryRows.nth(1).evaluate((row) => window.originalCategoryRow = row);
  await page.getByRole("combobox", { name: "Category", exact: true }).click();
  await page.getByRole("option", { name: categoryName, exact: true }).click();
  assert.equal(await categoryRows.count(), 1);
  assert.equal(await categoryRows.first().evaluate((row) => row === window.originalCategoryRow), true);
  assert.deepEqual(errors, []);
  console.log("PASS: aborted responses cannot overwrite data or clear newer loading state; failures keep the last sample; successful refresh clears errors; filtered rows keep their identity.");

  const bundle = await build({
    stdin: {
      contents: `
        import { createElement, StrictMode } from "react";
        import { createRoot } from "react-dom/client";
        import { flushSync } from "react-dom";
        import { useScrollingScrollbars } from "./src/hooks/use-scrolling-scrollbars";
        const roots = new Map();
        function Consumer() { useScrollingScrollbars(); return null; }
        window.mountConsumer = (id) => {
          const element = document.createElement("div");
          document.body.append(element);
          const root = createRoot(element);
          roots.set(id, root);
          flushSync(() => root.render(createElement(StrictMode, null, createElement(Consumer))));
        };
        window.unmountConsumer = (id) => { roots.get(id).unmount(); roots.delete(id); };
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  });
  const harness = await browser.newPage();
  await harness.setContent('<div id="scroller" class="ds-scrollbar"></div>');
  await harness.evaluate(() => {
    window.scrollListeners = new Set();
    window.scrollTimers = new Set();
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    document.addEventListener = (type, listener, options) => {
      if (type === "scroll") window.scrollListeners.add(listener);
      add(type, listener, options);
    };
    document.removeEventListener = (type, listener, options) => {
      if (type === "scroll") window.scrollListeners.delete(listener);
      remove(type, listener, options);
    };
    const schedule = window.setTimeout.bind(window);
    const cancel = window.clearTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      const timer = schedule(() => { window.scrollTimers.delete(timer); callback(...args); }, delay);
      if (delay === 900) window.scrollTimers.add(timer);
      return timer;
    };
    window.clearTimeout = (timer) => { window.scrollTimers.delete(timer); cancel(timer); };
  });
  await harness.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const order of [["first", "second"], ["second", "first"]]) {
    await harness.evaluate(() => { window.mountConsumer("first"); window.mountConsumer("second"); });
    assert.equal(await harness.evaluate(() => window.scrollListeners.size), 1);
    await harness.locator("#scroller").dispatchEvent("scroll");
    await harness.locator("#scroller").dispatchEvent("scroll");
    assert.equal(await harness.evaluate(() => window.scrollTimers.size), 1);
    await harness.evaluate((id) => window.unmountConsumer(id), order[0]);
    assert.equal(await harness.evaluate(() => window.scrollListeners.size), 1);
    assert.equal(await harness.locator("#scroller").getAttribute("data-scrolling"), "");
    await harness.evaluate((id) => window.unmountConsumer(id), order[1]);
    assert.equal(await harness.evaluate(() => window.scrollListeners.size), 0);
    assert.equal(await harness.evaluate(() => window.scrollTimers.size), 0);
    assert.equal(await harness.locator("#scroller").getAttribute("data-scrolling"), null);
  }
  await harness.evaluate(() => window.mountConsumer("expiry"));
  await harness.locator("#scroller").dispatchEvent("scroll");
  await harness.waitForFunction(() => !document.querySelector("#scroller").hasAttribute("data-scrolling"));
  assert.equal(await harness.evaluate(() => window.scrollTimers.size), 0);
  await harness.evaluate(() => window.unmountConsumer("expiry"));
  console.log("PASS: shared scroll subscription survives either unmount order, clears every timer on final unmount, and expires after scrolling in React Strict Mode.");
} finally {
  await browser.close();
}
