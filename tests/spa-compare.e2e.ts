import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

// Failures covered before implementation: unverified/duplicate URLs entering paid calls;
// hash routes lost; mismatched provider settings; judge identity leaking; cached responses
// counted as successes; account limits silently omitted; reruns duplicating paid reads;
// changed manifests/settings resuming; concurrent runners double spending; interrupted
// dispatch repeated; judge account failures fanning out; partial extraction called complete;
// pilot called final.
// Report failures: legacy quality rates promoted as reliable outcomes; access confused
// with job-list rendering; complete access hidden by unresolved legacy quality; offline
// presentation triggering paid calls or rewriting evidence; unescaped report evidence.
// Mobile tables must expose every labeled value without horizontal scrolling;
// changing their visual layout must preserve table semantics and keyboard disclosures.
// An attempted cohort with cached/interrupted reads or unfinished judgments must
// expose collection/grading readiness independently from cohort size.
const out = path.resolve("artifacts/spa-compare-e2e");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const calls: { provider: string; url: string; body: Record<string, unknown> }[] = [];
const checks: string[] = [];
const fixture = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const provider = req.url!.slice(1);
  res.setHeader("content-type", "application/json");
  if (provider === "judge") {
    assert.ok(!raw.includes('"provider"'));
    const state = body.state;
    const text = state.text ?? state.excerpts;
    calls.push({ provider, url: String(text).match(/URL: (\S+)/)?.[1] ?? "", body });
    if (String(text).includes("judge-limited")) { res.statusCode = 429; res.end("{}"); return; }
    if (body.questions.access) {
      assert.deepEqual(Object.keys(state).sort(), ["sampled", "text"]);
      res.end(JSON.stringify({ answers: { access: { choice: "accessed", confidence: 0.99 } } }));
    } else {
      res.end(JSON.stringify({ answers: {
        content: { choice: "substantive", confidence: 0.98 },
        identity: { choice: "match", confidence: 0.98 },
      } }));
    }
    return;
  }
  assert.ok(provider === "context" || provider === "firecrawl");
  calls.push({ provider, url: body.url, body });
  assert.equal(req.headers.authorization, "Bearer fixture-secret");
  if (body.url.startsWith("https://limited.example/") && provider === "context") {
    res.statusCode = 429;
    res.end("{}");
    return;
  }
  const text = `URL: ${body.url}\nActual company product information. fixture-secret`;
  const cached = body.url.includes("cached");
  res.end(JSON.stringify(provider === "context"
    ? { markdown: { requested: true, success: true, data: text }, cache_metadata: { status: cached ? "hit" : "miss" } }
    : { success: true, data: { markdown: text, metadata: { statusCode: 200, cacheState: cached ? "hit" : "miss" } } }));
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
const fixtureFile = path.join(out, "fixture.json");
await writeFile(fixtureFile, JSON.stringify({ endpoints: { context: origin + "/context", firecrawl: origin + "/firecrawl" }, judgeEndpoint: origin + "/judge" }));
const jsText = path.join(out, "browser-js.txt"), noJsText = path.join(out, "browser-nojs.txt"), navigationText = path.join(out, "browser-navigation.txt");
const initial = Array.from({ length: 90 }, (_, index) => `initial${index}`).join(" ");
const destination = Array.from({ length: 90 }, (_, index) => `destination${index}`).join(" ");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
await writeFile(jsText, initial);
await writeFile(noJsText, "");
await writeFile(navigationText, destination);
const row = (url: string) => ({ url, title: "Example company", organization: "Example", platform: "fixture", verdict: "verified_spa", evidence: {
  status: "verified", url, finalUrl: url, noJsFinalUrl: url, jsDependent: true,
  metrics: { jsWords: 90, noJsWords: 0, jsOnlyWords: 90, noJsCoverage: 0 },
  navigation: { verified: true, fromUrl: url, toUrl: new URL("#/different", url).href, documentUnchanged: true, contentChanged: true },
  artifacts: { jsText, noJsText, navigationText },
}, spaAudit: { protocol: "trace-spa-audit-v1", status: "passed", initialJsTextSha256: sha256(initial), noJsTextSha256: sha256(""), navigationTextSha256: sha256(destination), initialWords: 90, destinationWords: 90, destinationUniqueWords: 90, addedDestinationWords: 90, jsOnlyUniqueWords: 90, noJsCoverage: 0 } });
const manifestFile = path.join(out, "manifest.jsonl");
const manifest = [row("https://company.example/#/product"), row("https://company.example/#/about"), row("https://company.example/cached")];
await writeFile(manifestFile, manifest.map((r) => JSON.stringify(r)).join("\n") + "\n");
async function run(manifest: string, destination: string, extra: string[] = []) {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/spa/compare.ts", "--manifest", manifest, "--out", destination, "--fixture", fixtureFile, ...extra], {
    cwd: process.cwd(), env: { ...process.env, CONTEXT_API_KEY: "fixture-secret", FIRECRAWL_API_KEY: "fixture-secret", TYPESAFE_API_KEY: "fixture-secret" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const [code] = await once(child, "exit");
  return { code, output };
}
let failure: string | undefined;
try {
  const resultDir = path.join(out, "result");
  const first = await run(manifestFile, resultDir);
  assert.equal(first.code, 0, first.output);
  const report = JSON.parse(await readFile(path.join(resultDir, "report.json"), "utf8"));
  assert.equal(report.sample.pages, 3);
  assert.equal(report.sample.status, "pilot");
  assert.equal(report.sample.requiredForFinal, 1000);
  assert.equal(report.sample.sampleSizeMet, false);
  assert.equal(report.sample.collectionComplete, false);
  assert.equal(report.sample.gradingComplete, false);
  assert.equal(report.providers.context.access.success, 2);
  assert.equal(report.providers.context.unknown, 1);
  assert.equal(report.providers.firecrawl.quality.success, 2);
  assert.equal(report.paired.shared, 2);
  assert.equal(report.platforms.fixture.pages, 3);
  assert.equal(report.platforms.fixture.providers.context.access.success, 2);
  assert.ok(report.run.settings.evidenceHashes[report.pages[0].id].jsText);
  assert.ok(report.timing.providerSpans.context.startedAt);
  assert.equal(calls.filter((c) => c.provider === "context").length, 3);
  assert.ok(calls.some((c) => c.url.endsWith("#/product")));
  assert.ok(calls.some((c) => c.url.endsWith("#/about")));
  const contextBody = calls.find((c) => c.provider === "context")!.body;
  assert.equal(contextBody.maxAgeMs, 0);
  assert.deepEqual(contextBody.timeoutOpts, { milliseconds: 27000, behavior: "fail" });
  const firecrawlBody = calls.find((c) => c.provider === "firecrawl")!.body;
  assert.equal(firecrawlBody.maxAge, 0);
  assert.equal(firecrawlBody.storeInCache, false);
  assert.equal(firecrawlBody.timeout, 27000);
  const ledger = await readFile(path.join(resultDir, "attempts.jsonl"), "utf8");
  assert.ok(!ledger.includes("fixture-secret"));
  assert.ok(ledger.includes("[REDACTED]"));
  const firstHtml = await readFile(path.join(resultDir, "report.html"), "utf8");
  assert.match(firstHtml, /excerpts|excerpt/i);
  assert.match(firstHtml, /Legacy quality grades are exploratory and unreliable/);
  assert.match(firstHtml, /including company prose/);
  assert.match(firstHtml, /does not establish that a job list rendered/);
  assert.ok(!firstHtml.includes("<th>Target content</th>"));
  assert.ok(!firstHtml.includes("<th>Context target content</th>"));
  checks.push("CLI compares the same fragment-preserving manifest with fresh-fetch settings, blind access/quality grading, cache rejection, redacted durable evidence and explicit pilot status");
  const beforeResume = calls.length;
  const resumed = await run(manifestFile, resultDir);
  assert.equal(resumed.code, 0, resumed.output);
  assert.equal(calls.length, beforeResume);
  checks.push("A completed resume makes no additional provider or judge calls");
  const changed = path.join(out, "changed.jsonl");
  await writeFile(changed, [...manifest, row("https://other.example/")].map((r) => JSON.stringify(r)).join("\n"));
  assert.notEqual((await run(changed, resultDir)).code, 0);
  assert.notEqual((await run(manifestFile, resultDir, ["--limit", "1"])).code, 0);
  assert.notEqual((await run(manifestFile, path.join(out, "invalid-concurrency"), ["--concurrency", "0"])).code, 0);
  for (const [name, rows] of [
    ["duplicate", [manifest[0], manifest[0]]],
    ["unverified", [{ ...manifest[0], verdict: "framework_detected" }]],
    ["forged", [{ ...manifest[0], evidence: { ok: true } }]],
    ["missing-audit", [{ ...manifest[0], spaAudit: undefined }]],
    ["tampered-audit", [{ ...manifest[0], spaAudit: { ...manifest[0].spaAudit, navigationTextSha256: "0".repeat(64) } }]],
    ["false-audit-metrics", [{ ...manifest[0], spaAudit: { ...manifest[0].spaAudit, addedDestinationWords: 1000 } }]],
  ] as const) {
    const file = path.join(out, name + ".jsonl");
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join("\n"));
    assert.notEqual((await run(file, path.join(out, name))).code, 0);
  }
  assert.equal(calls.length, beforeResume);
  await writeFile(navigationText, initial);
  assert.notEqual((await run(manifestFile, path.join(out, "tampered-evidence"))).code, 0);
  await writeFile(navigationText, destination);
  assert.equal(calls.length, beforeResume);
  checks.push("Changed manifest/settings, duplicate URLs, nonverified pages, missing/forged strong SPA audits and modified evidence fail before paid calls");
  const limitedFile = path.join(out, "limited.jsonl");
  await writeFile(limitedFile, [row("https://limited.example/"), row("https://later.example/")].map((r) => JSON.stringify(r)).join("\n"));
  const limitedDir = path.join(out, "limited");
  const limited = await run(limitedFile, limitedDir);
  assert.equal(limited.code, 0, limited.output);
  const limitedReport = JSON.parse(await readFile(path.join(limitedDir, "report.json"), "utf8"));
  assert.equal(limitedReport.providers.context.accountExcluded, 1);
  assert.equal(limitedReport.providers.context.notAttempted, 1);
  assert.equal(limitedReport.providers.context.stopped, "HTTP_429");
  assert.equal(limitedReport.sample.collectionComplete, false);
  assert.equal(limitedReport.sample.gradingComplete, false);
  assert.equal(limitedReport.providers.firecrawl.access.success, 2);
  assert.equal(calls.filter((c) => c.provider === "context" && c.url.includes("later")).length, 0);
  checks.push("Account limits stop that provider lane, preserve excluded and unsent counts, and let the other provider finish");
  const interruptedDir = path.join(out, "interrupted");
  await mkdir(interruptedDir, { recursive: true });
  await writeFile(path.join(interruptedDir, "run.json"), await readFile(path.join(resultDir, "run.json")));
  const events = ledger.trim().split("\n").map((line) => JSON.parse(line));
  const firstEvent = events.find((event) => event.provider === "context" && event.stage === "read" && event.phase === "started");
  await writeFile(path.join(interruptedDir, "attempts.jsonl"), events.filter((event) => event.id !== firstEvent.id || event.provider !== "context" || event.stage === "read" && event.phase === "started").map((event) => JSON.stringify(event)).join("\n") + "\n");
  const beforeInterruption = calls.length;
  assert.equal((await run(manifestFile, interruptedDir)).code, 0);
  assert.equal(calls.length, beforeInterruption);
  const interruptedReport = JSON.parse(await readFile(path.join(interruptedDir, "report.json"), "utf8"));
  assert.equal(interruptedReport.providers.context.errors.INTERRUPTED_REQUEST, 1);
  assert.equal(interruptedReport.sample.collectionComplete, false);
  assert.equal(interruptedReport.sample.gradingComplete, false);
  checks.push("Dispatched reads without durable receipts remain unresolved after resume and are never repeated");
  const raceDir = path.join(out, "race");
  const concurrent = await Promise.all([run(manifestFile, raceDir), run(manifestFile, raceDir)]);
  assert.equal(concurrent.filter((result) => result.code === 0).length, 1, JSON.stringify(concurrent));
  assert.match(concurrent.find((result) => result.code !== 0)!.output, /locked|running/i);
  checks.push("An exclusive output lock prevents concurrent invocations from duplicating paid calls");
  const judgeFile = path.join(out, "judge-limited.jsonl");
  await writeFile(judgeFile, [row("https://judge-limited.example/"), row("https://judge-later.example/")].map((r) => JSON.stringify(r)).join("\n"));
  const judgeDir = path.join(out, "judge-limited");
  assert.equal((await run(judgeFile, judgeDir)).code, 0);
  const judgeReport = JSON.parse(await readFile(path.join(judgeDir, "report.json"), "utf8"));
  assert.equal(judgeReport.judgeStopped, "JUDGE_HTTP_429");
  assert.equal(judgeReport.providers.context.unknown, 2);
  assert.equal(judgeReport.providers.firecrawl.attempted, 2);
  assert.equal(judgeReport.sample.collectionComplete, true);
  assert.equal(judgeReport.sample.gradingComplete, false);
  checks.push("Judge account rejection stops new grading while retrieval evidence remains durable and unresolved");
  const completeFile = path.join(out, "complete-pilot.jsonl");
  const relativeRow = row("https://complete.example/");
  relativeRow.evidence.artifacts = { jsText: path.basename(jsText), noJsText: path.basename(noJsText), navigationText: path.basename(navigationText) };
  await writeFile(completeFile, JSON.stringify(relativeRow) + "\n");
  const completeDir = path.join(out, "complete-pilot");
  assert.equal((await run(completeFile, completeDir, ["--concurrency", "50"])).code, 0);
  const completeReport = JSON.parse(await readFile(path.join(completeDir, "report.json"), "utf8"));
  assert.equal(completeReport.sample.sampleSizeMet, false);
  assert.equal(completeReport.sample.collectionComplete, true);
  assert.equal(completeReport.sample.gradingComplete, true);
  assert.equal(completeReport.sample.finalSampleRequirementMet, false);
  assert.equal(completeReport.sample.status, "pilot");
  assert.equal(completeReport.run.settings.concurrencyPerProvider, 50);
  assert.match(await readFile(path.join(completeDir, "report.html"), "utf8"), /up to 50 in flight/);
  assert.equal(completeReport.run.settings.evidenceHashes[completeReport.pages[0].id].navigationText, sha256(destination));
  checks.push("Browser evidence paths resolve relative to the manifest and all three immutable text artifacts are frozen in run metadata");
  checks.push("Cohort size, fresh collection completeness, and resolved access/quality grading are reported independently");
  const offline = structuredClone(completeReport);
  offline.sample.status = "incomplete";
  offline.sample.gradingComplete = false;
  offline.providers.context.quality.unknown = 1;
  offline.pages[0].results.context.qualitySuccess = null;
  offline.pages[0].organization = '<img src=x onerror="alert(1)">';
  offline.pages[0].url = "javascript:alert(1)";
  offline.platforms['<script>alert("platform")</script>'] = offline.platforms.fixture;
  delete offline.platforms.fixture;
  const offlineSource = path.join(out, "offline-source.json"), offlineOutput = path.join(out, "offline.html");
  const originalBytes = JSON.stringify(offline, null, 2);
  await writeFile(offlineSource, originalBytes);
  const callsBeforeOffline = calls.length;
  const render = spawn(process.execPath, ["--import", "tsx", "scripts/spa/report.ts", "--report", offlineSource, "--out", offlineOutput], { stdio: ["ignore", "pipe", "pipe"] });
  let renderLog = "";
  render.stdout.on("data", (chunk) => { renderLog += chunk; });
  render.stderr.on("data", (chunk) => { renderLog += chunk; });
  const [renderCode] = await once(render, "exit");
  assert.equal(renderCode, 0, renderLog);
  assert.equal(calls.length, callsBeforeOffline);
  assert.equal(await readFile(offlineSource, "utf8"), originalBytes);
  const offlineHtml = await readFile(offlineOutput, "utf8");
  assert.match(offlineHtml, /Collection complete: true/);
  assert.match(offlineHtml, /Access grading complete: true/);
  assert.match(offlineHtml, /Legacy quality grading complete: false/);
  assert.match(offlineHtml, /Legacy quality grades are exploratory and unreliable/);
  assert.ok(offlineHtml.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(!offlineHtml.includes('<img src=x onerror="alert(1)">'));
  assert.ok(!offlineHtml.includes('href="javascript:'));
  assert.ok(offlineHtml.includes('&lt;script&gt;alert(&quot;platform&quot;)&lt;/script&gt;'));
  assert.ok(!/<th[^>]*>[^<]*(?:quality|target content)/i.test(offlineHtml));
  checks.push("Offline token-based rendering leaves source JSON and provider/judge calls unchanged, separates completed access from legacy quality, removes quality comparison rates, and escapes untrusted evidence");
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(offlineOutput).href);
    const mobile = await page.evaluate(() => ({
      width: innerWidth, pageWidth: document.documentElement.scrollWidth,
      tables: [...document.querySelectorAll<HTMLElement>(".table-scroll")].map((table) => ({ client: table.clientWidth, scroll: table.scrollWidth })),
      cells: [...document.querySelectorAll<HTMLElement>("tbody td,tbody th")].map((cell) => ({ left: cell.getBoundingClientRect().left, right: cell.getBoundingClientRect().right, client: cell.clientWidth, scroll: cell.scrollWidth })),
      semantics: [...document.querySelectorAll("table")].every((table) => table.getAttribute("role") === "table" && table.querySelectorAll('[role="columnheader"]').length > 0),
      labels: [...document.querySelectorAll<HTMLElement>("tbody td")].every((cell) => Boolean(cell.dataset.label) && Boolean(cell.getAttribute("headers")) && cell.getAttribute("headers")!.split(/\s+/).every((id) => Boolean(document.getElementById(id))) && [...cell.querySelectorAll<HTMLElement>(".cell-label")].some((label) => getComputedStyle(label).display !== "none")),
    }));
    assert.ok(mobile.tables.every((table) => table.scroll <= table.client + 1), JSON.stringify(mobile));
    assert.ok(mobile.cells.every((cell) => cell.left >= 0 && cell.right <= mobile.width + 1 && cell.scroll <= cell.client + 1), JSON.stringify(mobile));
    assert.ok(mobile.pageWidth <= mobile.width);
    assert.equal(mobile.semantics, true);
    assert.equal(mobile.labels, true);
    const summary = page.locator("#evidence").locator("..").locator("details summary").first();
    await page.keyboard.press("Tab");
    await summary.focus();
    assert.equal(await summary.evaluate((node) => document.activeElement === node), true);
    await summary.press("Enter");
    assert.equal(await summary.evaluate((node) => (node.parentElement as HTMLDetailsElement).open), true);
    assert.notEqual(await summary.evaluate((node) => getComputedStyle(node).outlineStyle), "none");
    await summary.press("Space");
    assert.equal(await summary.evaluate((node) => (node.parentElement as HTMLDetailsElement).open), false);
    await page.setViewportSize({ width: 1440, height: 900 });
    const measure = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.cssText = "display:block;width:75ch";
      document.body.append(probe);
      const cap = probe.getBoundingClientRect().width;
      probe.remove();
      return { cap, longest: Math.max(...[...document.querySelectorAll("main p,main li")].map((node) => node.getBoundingClientRect().width)) };
    });
    assert.ok(measure.longest <= measure.cap + 1, JSON.stringify(measure));
    assert.equal(calls.length, callsBeforeOffline);
  } finally { await browser.close(); }
  checks.push("At 390px every table value is visible with a label, explicit table/header semantics survive stacking, disclosures work by keyboard, and desktop prose stays below 75 characters per line");
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  fixture.closeAllConnections();
  fixture.close();
  await writeFile(path.join(out, "e2e.json"), JSON.stringify({ ok: !failure, failure, checks, calls, repeat: "npx tsx tests/spa-compare.e2e.ts", limitation: "Local HTTP fixtures demonstrate orchestration and report behavior, not live provider quality or capacity." }, null, 2));
}
console.log(JSON.stringify({ ok: true, checks, artifact: path.join(out, "e2e.json") }, null, 2));
