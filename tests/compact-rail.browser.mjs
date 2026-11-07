import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Failures: a collapsed rail stretches to fill tall screens; empty footer space
// dominates navigation; number-only links lose their names; hover/focus labels
// are clipped; short screens hide lower links or the theme control; responsive
// auto-collapse differs from manual collapse; navigation loses filters/sample;
// persisted collapse, expanded labels, or the mobile section sheet regress.
// Short-screen failures: 600px height silently clips a destination; on smaller
// screens the active destination stays outside the nav viewport; revealing it
// scrolls the page away from the section the reader chose.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const evidence = resolve("artifacts/compact-rail/browser");
mkdirSync(evidence, { recursive: true });
const labels = ["Overview", "Leaderboard", "Head-to-head", "Categories", "Latency", "Quality", "Cost", "Failures", "Sites", "History", "Sample & sources", "Methodology", "Data & API", "FAQ", "Citation"];
const ids = ["overview", "useful-content", "head-to-head", "categories", "latency", "quality", "cost", "failures", "sites", "history", "sources", "methodology", "data", "faq", "citation"];
const providers = ["context", "exa", "firecrawl", "keenable"];
const day = "2026-11-05";
const run = `scraping-bench-v5:${day}`;
const latest = { id: run, day, protocol: "scraping-bench-v5", status: "completed", pages: 1, target: 1,
  finishedAt: `${day}T23:00:00Z`, categories: { jobs: 1 },
  providers: providers.map(id => ({ id, total: 1, useful: 1, failed: 0, unknown: 0, pending: 0, rate: 1, p50: 100, p95: 100, rateLimited: 0, categories: { jobs: { total: 1, useful: 1, unknown: 0, completed: 1 } } })) };
const dataset = { report: { latest, history: [latest], collecting: null, records: [], totalRecords: 0, page: 0,
  health: { lastTick: null, error: null, sources: 0, healthySources: 0, evidenceBytes: 0 } },
  pages: [{ id: "fixture-jobs", url: "https://fixture.example/jobs", title: "Fixture job", source: "daily", category: "jobs", day,
    protocol: "scraping-bench-v5", results: Object.fromEntries(providers.map(id => [id, { success: true, state: "done", error: null, ms: 100 }])) }] };
const fixture = createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(dataset)); });
await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));
const port = process.env.TEST_PORT || "3190";
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", port], {
  env: { ...process.env, BENCHMARK_DATA_ORIGIN: `http://127.0.0.1:${fixture.address().port}`, TRACE_WORKER_ENABLED: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
app.stdout.on("data", data => { log += data; });
app.stderr.on("data", data => { log += data; });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const checks = [];
const base = `http://localhost:${port}`;
const url = `${base}/?category=jobs&run=${encodeURIComponent(run)}#overview`;
let failure;
const rail = page.locator(".bench-rail");
const panel = rail.locator(".bench-rail-panel");
const links = rail.locator(".bench-rail-nav a");
async function noOverflow(label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, label);
}
async function tooltip(link, label, keyboard = false) {
  if (keyboard) { await link.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); }
  else await link.hover();
  const tip = page.getByRole("tooltip", { name: label, exact: true });
  await tip.waitFor({ state: "visible" });
  const box = await tip.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= (await page.viewportSize()).width, "Section tooltip fits viewport");
  await page.mouse.move(1400, 0);
  await page.keyboard.press("Escape");
}
async function compact(label, height) {
  await page.waitForTimeout(200);
  assert.equal(await links.count(), 15);
  const geometry = await panel.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const nav = el.querySelector(".bench-rail-nav").getBoundingClientRect();
    const foot = el.querySelector(".bench-rail-foot").getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height, footerGap: foot.top - nav.bottom };
  });
  assert.ok(geometry.bottom <= height && geometry.top >= 0, `${label}: rail stays in viewport`);
  if (height >= 1000) assert.ok(geometry.height < height * 0.85, `${label}: rail fits content instead of stretching: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.footerGap < 64, `${label}: footer follows navigation without a large empty void`);
  for (let i = 0; i < labels.length; i++) {
    const link = rail.getByRole("link", { name: labels[i], exact: true });
    assert.equal(await link.count(), 1, `${label}: ${labels[i]} has an accessible name`);
    assert.equal(await link.locator("svg").isVisible(), true, `${label}: ${labels[i]} has a visible icon`);
    await link.focus();
    const box = await link.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= height, `${label}: ${labels[i]} remains keyboard reachable`);
  }
  const theme = rail.locator(".bench-rail-foot button");
  await theme.focus();
  const themeBox = await theme.boundingBox();
  assert.ok(themeBox && themeBox.y + themeBox.height <= height, `${label}: theme control remains reachable`);
  await noOverflow(label);
  checks.push(`${label}: compact geometry, named icon links, all 15 destinations and theme control reachable, no page overflow`);
}
try {
  const deadline = Date.now() + 60000;
  while (true) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (Date.now() >= deadline) throw new Error(log || "Next did not start");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await page.goto(url, { waitUntil: "networkidle" });
  await rail.getByRole("button", { name: "Collapse or expand the section list" }).click();
  await page.waitForFunction(() => document.documentElement.dataset.rail === "collapsed");
  await compact("1440×1000 manual collapse", 1000);
  await tooltip(links.first(), labels[0]);
  await tooltip(links.first(), labels[0], true);
  checks.push("Hover and keyboard focus expose readable, unclipped section labels");
  await page.screenshot({ path: resolve(evidence, "desktop-collapsed.png") });
  await rail.getByRole("link", { name: "Citation", exact: true }).click();
  await page.waitForFunction(() => location.hash === "#citation");
  assert.equal(new URL(page.url()).searchParams.get("category"), "jobs");
  assert.equal(new URL(page.url()).searchParams.get("run"), run);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.dataset.rail === "collapsed");
  checks.push("Section navigation preserves category and sample, and reload restores collapsed preference");
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(url, { waitUntil: "networkidle" });
  const shortScreenFailures = [];
  const allFit = await rail.locator(".bench-rail-nav").evaluate(nav => {
    const bounds = nav.getBoundingClientRect();
    return { clientHeight: nav.clientHeight, scrollHeight: nav.scrollHeight,
      visible: [...nav.querySelectorAll("a")].filter(link => {
        const rect = link.getBoundingClientRect();
        return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
      }).length };
  });
  try {
    assert.ok(allFit.scrollHeight <= allFit.clientHeight + 1 && allFit.visible === 15,
      `600px viewport shows all 15 destinations without nav scrolling: ${JSON.stringify(allFit)}`);
    checks.push("600px viewport exposes all 15 section icons without requiring nav scrolling");
  } catch (error) { shortScreenFailures.push(error); }
  await page.setViewportSize({ width: 1440, height: 450 });
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.querySelector(".bench-rail-nav").scrollTop = 0;
  });
  await page.waitForFunction(() => document.querySelector('.bench-rail-nav a[aria-current]')?.getAttribute("href") === "#overview");
  const selectedScrollY = await page.evaluate(() => {
    document.getElementById("citation").scrollIntoView({ behavior: "instant" });
    return window.scrollY;
  });
  await page.waitForFunction(() => document.querySelector('.bench-rail-nav a[aria-current]')?.getAttribute("href") === "#citation");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const activeGeometry = await rail.locator(".bench-rail-nav").evaluate(nav => {
    const bounds = nav.getBoundingClientRect();
    const link = nav.querySelector("a[aria-current]").getBoundingClientRect();
    return { navTop: bounds.top, navBottom: bounds.bottom, linkTop: link.top, linkBottom: link.bottom,
      navScroll: nav.scrollTop, pageScroll: window.scrollY };
  });
  try {
    assert.ok(activeGeometry.linkTop >= activeGeometry.navTop - 1 && activeGeometry.linkBottom <= activeGeometry.navBottom + 1,
      `450px viewport reveals the active Citation link within the nav: ${JSON.stringify(activeGeometry)}`);
    assert.equal(activeGeometry.pageScroll, selectedScrollY, "Revealing the active rail link must not move the page away from Citation");
    checks.push("450px viewport keeps the active Citation link visible by scrolling only the rail, preserving the reader's page position");
  } catch (error) { shortScreenFailures.push(error); }
  writeFileSync(resolve(evidence, "short-screen-geometry.json"), JSON.stringify({ allFit, selectedScrollY, activeGeometry }, null, 2));
  if (shortScreenFailures.length) throw new AggregateError(shortScreenFailures, shortScreenFailures.map(error => error.message).join("\n"));
  await page.screenshot({ path: resolve(evidence, "short-active-citation.png") });
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(url, { waitUntil: "networkidle" });
  await compact("1440×600 manual collapse", 600);
  await tooltip(links.last(), labels.at(-1));
  await page.screenshot({ path: resolve(evidence, "short-collapsed.png") });
  await page.evaluate(() => localStorage.removeItem("bench-rail"));
  await page.setViewportSize({ width: 1100, height: 768 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.dataset.rail === "auto");
  await compact("1100×768 automatic collapse", 768);
  await tooltip(links.first(), labels[0]);
  await page.screenshot({ path: resolve(evidence, "auto-collapsed.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await rail.getByRole("button", { name: "Collapse or expand the section list" }).click();
  await page.waitForFunction(() => document.documentElement.dataset.rail === "collapsed");
  await rail.getByRole("button", { name: "Collapse or expand the section list" }).click();
  await page.waitForFunction(() => document.documentElement.dataset.rail === "expanded");
  for (const text of await links.locator(".bench-nav-text").all()) assert.equal(await text.isVisible(), true);
  assert.equal(await rail.locator(".bench-rail-sample").isVisible(), true);
  await noOverflow("Expanded desktop");
  await page.screenshot({ path: resolve(evidence, "desktop-expanded.png") });
  checks.push("Expanded rail retains text labels, sample control and unclipped layout");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await rail.isVisible(), false);
  await page.locator(".bench-pill-main").click();
  const dialog = page.getByRole("dialog", { name: "Sections and sample" });
  await dialog.waitFor({ state: "visible" });
  assert.equal(await dialog.locator("nav a").count(), 15);
  for (const text of await dialog.locator(".bench-nav-text").all()) assert.equal(await text.isVisible(), true);
  await noOverflow("Mobile sheet");
  await page.screenshot({ path: resolve(evidence, "mobile-sheet.png") });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.locator(".bench-pill-main").evaluate(el => el === document.activeElement), true);
  await page.locator(".bench-pill-main").click();
  await dialog.locator('a[href="#history"]').click();
  await page.waitForFunction(() => location.hash === "#history");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(new URL(page.url()).searchParams.get("category"), "jobs");
  assert.equal(new URL(page.url()).searchParams.get("run"), run);
  checks.push("390px mobile sheet retains all labels, closes with Escape restoring focus, and navigates without losing filters");
  assert.deepEqual(errors, []);
  checks.push("No browser runtime errors");
} catch (error) { failure = error; }
finally {
  writeFileSync(resolve(evidence, "checks.json"), JSON.stringify({ checks, errors, failure: failure?.stack ?? null }, null, 2));
  writeFileSync(resolve(evidence, "server.log"), log);
  await browser.close();
  app.kill("SIGTERM");
  await new Promise(resolve => fixture.close(resolve));
}
if (failure) throw failure;
console.log(JSON.stringify({ checks: checks.length, evidence }, null, 2));
