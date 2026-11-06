import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.BENCHMARK_URL || "http://localhost:3297";
const phase = process.env.CAPTURE_PHASE || "after";
const evidence = resolve("artifacts/findings");
const session = process.env.AGENT_BROWSER_SESSION || "trace-findings-check";
mkdirSync(evidence, { recursive: true });
const checks = [];
function browser(...args) {
  return execFileSync("agent-browser", ["--session", session, ...args], {
    encoding: "utf8", timeout: 60000,
  }).trim();
}
function evaluate(code) {
  const result = JSON.parse(browser("eval", code));
  return typeof result === "string" && (result.startsWith("{") || result.startsWith("[")) ? JSON.parse(result) : result;
}
let failure;
try {
  browser("open", base);
  browser("wait", "--fn", "document.querySelectorAll('.bench-findings li').length > 0");
  browser("eval", "document.documentElement.style.scrollBehavior = 'auto'");
  const content = evaluate(`JSON.stringify({
    findings: [...document.querySelectorAll('.bench-findings li')].map(el => el.textContent.replace(/\\s+/g, ' ').trim()),
    scores: [...document.querySelectorAll('[data-score]')].map(el => el.textContent),
    count: document.querySelector('[data-sample-count]').textContent
  })`);
  writeFileSync(resolve(evidence, `${phase}-content.json`), JSON.stringify(content, null, 2));
  const baseline = process.env.FINDINGS_BASELINE;
  if (phase === "after" && baseline) {
    assert.deepEqual(content, JSON.parse(readFileSync(baseline)), "Findings, scores and sample count remain unchanged");
    checks.push("Findings, scores and sample count match the baseline");
  }
  for (const [label, width, height, dark] of [
    ["desktop", 1440, 1000, false], ["mobile", 390, 844, false],
    ["narrow", 320, 900, false], ["tablet", 768, 1000, false],
    ["desktop-dark", 1440, 1000, true], ["mobile-dark", 390, 844, true],
  ]) {
    browser("set", "viewport", String(width), String(height));
    if (evaluate("document.documentElement.dataset.theme === 'dark'") !== dark) {
      browser("click", '.bench-rail button[aria-label="Dark appearance"]');
    }
    browser("eval", "window.scrollTo({top:0, behavior:'instant'})");
    browser("wait", "--fn", "document.fonts.status === 'loaded'");
    assert.equal(evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `${label}: no page overflow`);
    if (phase === "after") {
      const layout = evaluate(`JSON.stringify([...document.querySelectorAll('.bench-findings li')].map(el => {
        const lead = el.querySelector('strong');
        const detail = el.querySelector('p');
        const a = lead.getBoundingClientRect();
        const b = detail?.getBoundingClientRect();
        return { separate: !b || b.top >= a.bottom, fits: a.left >= 0 && a.right <= innerWidth && (!b || b.right <= innerWidth),
          emphasis: !detail || Number(getComputedStyle(lead).fontWeight) > Number(getComputedStyle(detail).fontWeight) };
      }))`);
      assert.ok(layout.every(row => row.separate && row.fits && row.emphasis), `${label}: readable lead/detail hierarchy without clipping`);
      assert.equal(evaluate("document.querySelector('.bench-findings h2').textContent.trim()"), "Key findings");
      assert.ok(evaluate("document.querySelector('.bench-findings time')?.dateTime"), "Sample date remains machine readable");
    }
    const captureHeight = Math.ceil(evaluate("document.querySelector('.bench-findings').getBoundingClientRect().bottom")) + 200;
    if (captureHeight > height) browser("set", "viewport", String(width), String(captureHeight));
    browser("screenshot", ".bench-findings", resolve(evidence, `${label}-${phase}.png`));
    checks.push(`${label}: all findings visible without horizontal overflow`);
  }
  assert.equal(browser("errors"), "", "No browser runtime errors");
} catch (error) {
  failure = error;
} finally {
  writeFileSync(resolve(evidence, `${phase}-checks.json`), JSON.stringify({ checks, failure: failure?.stack ?? null }, null, 2));
  browser("close");
}
if (failure) throw failure;
console.log(JSON.stringify({ checks, evidence }, null, 2));
