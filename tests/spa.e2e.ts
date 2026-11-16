import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const failures = [
  "SSR content with a hydrated client router is not JS-dependent",
  "a document reload must not count as client-side routing",
  "a URL-only client route must not count as meaningful navigation",
  "a client-rendered page without router evidence remains inconclusive",
  "empty shells, login forms, bot challenges, and failed HTTP pages are not SPAs",
  "hash routes must retain their requested route identity",
  "consent text outside main must not count as useful page content",
  "the original JS snapshot must survive navigation and be saved with no-JS evidence",
  "partially server-rendered pages must not pass as strict JS-dependent SPAs",
  "delayed client content must be awaited within the bounded page budget",
  "job-card anchors with role=button must retain client route evidence even with target=_blank",
  "client startup URL normalization must compare the exact final route without JavaScript",
];
const first = "Build public systems with our infrastructure team. You will design reliable distributed services, collaborate with product engineers, improve observability and document production decisions. This role offers flexible work, learning opportunities, competitive compensation, generous benefits, and a supportive workplace. Applicants should demonstrate practical experience with databases, networking, testing, security, and communication. Responsibilities include managing delivery pipelines, optimizing performance, reviewing architecture proposals, creating documentation, investigating incidents, understanding customer requirements, coordinating releases, supporting international operations, and ensuring dependable outcomes throughout the development lifecycle.";
const second = "Explore our research department and the open machine learning scientist position. Successful candidates investigate novel training techniques, publish rigorous experiments, evaluate model behavior, develop reproducible benchmarks, mentor colleagues, present discoveries, and engage with the wider scientific community. The organization supports independent thinking, academic partnerships, inclusive hiring, transparent feedback, professional development, travel, and excellent healthcare.";
function html(mode: string) {
  const serverRendered = mode === "ssr" || mode === "partial-ssr";
  const script = `
    const mode = ${JSON.stringify(mode)};
    const first = ${JSON.stringify(first)};
    const second = ${JSON.stringify(second)};
    function render(next = false) {
      document.querySelector('main').innerHTML = '<h1>' + (next ? 'Research scientist' : 'Infrastructure engineer') + '</h1><p>' + (next ? second : first) + '</p><a ' + (mode === 'roleblank' ? 'role="button" target="_blank" ' : '') + 'href="' + (mode === 'hash' ? '#/research' : (mode === 'roleblank' ? '/job/research?mode=' : '/research?mode=') + mode) + '">View research position</a>';
    }
    if (mode === 'canonical' && !location.search.includes('canonical=1')) history.replaceState({}, '', location.href + '&canonical=1');
    ${["empty", "consent"].includes(mode) ? "" : mode === "delayed" ? "setTimeout(() => render(), 800);" : "render(location.pathname === '/research' || location.hash === '#/research');"}
    document.addEventListener('click', event => {
      const link = event.target.closest('a');
      if (!link || ['reload', 'no-router'].includes(mode)) return;
      if (mode === 'roleblank' && link.getAttribute('role') !== 'button') return;
      event.preventDefault();
      history.pushState({}, '', link.href);
      if (mode !== 'url-only') render(true);
    });
  `;
  if (mode === "captcha") return "<title>Security challenge</title><main><h1>Verify you are human</h1><p>Complete the CAPTCHA to continue.</p></main>";
  if (mode === "login") return `<title>Sign in</title><main><h1>Sign in to continue</h1><input type="password"><p>${first}</p></main>`;
  return `<title>Example company careers</title><aside>${mode === "consent" ? first.repeat(3) : mode === "roleblank" ? '<a href="/">Jobs</a>' : ""}</aside><main>${serverRendered ? `<h1>Infrastructure engineer</h1><p>${mode === "partial-ssr" ? first.slice(0, 260) : first}</p><a href="/research?mode=ssr">View research position</a>` : ""}</main><script>${script}</script>`;
}
const server = createServer((req, res) => {
  const incoming = new URL(req.url!, "http://localhost");
  const mode = incoming.searchParams.get("mode") ?? "spa";
  res.writeHead(mode === "http-error" ? 503 : 200, { "content-type": "text/html" });
  res.end(mode === "http-error" ? "<main><h1>Service unavailable</h1></main>" : html(mode));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const artifactDir = path.resolve(process.env.SPA_E2E_ARTIFACT_DIR ?? `artifacts/spa-e2e-${Date.now()}`);
await mkdir(artifactDir, { recursive: true });
await writeFile(path.join(artifactDir, "failure-modes.json"), JSON.stringify(failures, null, 2));
const { verifyPage } = await import("../scripts/spa/verify.ts");
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
const cases = [
  ["spa", "verified"], ["hash", "verified"], ["ssr", "rejected"],
  ["partial-ssr", "rejected"], ["delayed", "verified"],
  ["roleblank", "verified"], ["canonical", "verified"],
  ["reload", "inconclusive"], ["url-only", "inconclusive"], ["no-router", "inconclusive"],
  ["empty", "rejected"], ["consent", "rejected"], ["captcha", "rejected"],
  ["login", "rejected"], ["http-error", "inconclusive"],
] as const;
const results = [];
try {
  for (const [mode, status] of cases) {
    const result = await verifyPage(browser, { id: mode, url: `${origin}/careers?mode=${mode}${mode === "hash" ? "#/engineering" : ""}` }, { outputDir: artifactDir, screenshotDir: ["spa", "hash"].includes(mode) ? artifactDir : undefined, timeoutMs: 7000, settleMs: 100 });
    results.push(result);
    assert.equal(result.status, status, `${mode}: ${result.reason}`);
    assert.ok((await readFile(result.artifacts.jsText, "utf8")).includes(mode === "spa" || mode === "hash" ? "Infrastructure engineer" : ""));
    if (status === "verified") {
      assert.equal(result.navigation.documentUnchanged, true);
      assert.equal(result.navigation.contentChanged, true);
      assert.ok(result.metrics.jsOnlyWords >= 25);
      assert.ok((await readFile(result.artifacts.noJsText, "utf8")).length < 100);
      assert.ok((await readFile(result.artifacts.jsText, "utf8")).includes(first));
    }
    if (mode === "hash") assert.ok(result.finalUrl.endsWith("#/engineering"));
  }
  await writeFile(path.join(artifactDir, "results.json"), JSON.stringify({ failures, results }, null, 2));
  console.log(JSON.stringify({ passed: results.length, artifactDir }));
} finally {
  await browser.close();
  server.close();
}
