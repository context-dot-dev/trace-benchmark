import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { verifyPage } from "../scripts/spa/verify.ts";

const failures = [
  "removed sidebar words and a changed URL can falsely pass the original router gate before detail content loads",
  "a no-JavaScript bot challenge must not be mistaken for evidence of client rendering",
  "a no-JavaScript login gate must not be mistaken for evidence of client rendering",
  "saved metrics must be independently replayed, rather than trusting a verified flag",
  "a loaded destination passes without any extra browser actions",
  "revalidation must preserve candidate order and IDs and retain distinct original receipts",
  "read-only audit must not make browser or network requests",
  "relative artifact paths must resolve from the input manifest and remain usable in a different output directory",
];
const listing = "Build public systems with our infrastructure team. You will design reliable distributed services, collaborate with product engineers, improve observability and document production decisions. This role offers flexible work, learning opportunities, competitive compensation, generous benefits, and a supportive workplace. Applicants should demonstrate practical experience with databases, networking, testing, security, and communication. Responsibilities include managing delivery pipelines, optimizing performance, reviewing architecture proposals, creating documentation, investigating incidents, understanding customer requirements, coordinating releases, supporting international operations, and ensuring dependable outcomes throughout the development lifecycle.";
const sidebar = "Our company history involves manufacturing aircraft components, agricultural machinery, sustainable energy installations, specialty chemicals, medical devices, automation equipment, freight transportation, telecommunications networks, educational materials, consumer electronics, automotive supplies, biotechnology research, financial instruments, mathematical analysis, environmental protection, geological exploration, aerospace engineering, entertainment venues, sporting facilities, hospitality services, real estate investments, municipal infrastructure, renewable resources, scientific publications, and charitable foundations.";
const detail = "Research scientists investigate novel machine learning techniques and publish rigorous experimental evidence. Successful candidates develop reproducible evaluations, mentor colleagues, present discoveries, collaborate with academic partners, examine model behavior, and communicate scientific findings clearly. We welcome applicants with experience in optimization, statistics, computer vision, natural language processing, reinforcement learning, numerical computation, large scale training, and responsible deployment. The department provides independent research time, conference travel, exceptional healthcare, paid parental leave, retirement contributions, professional development resources, remote collaboration opportunities, inclusive hiring practices, transparent performance feedback, and supportive management. Applications are reviewed monthly by the technical leadership committee and selected candidates meet future teammates during structured interviews.";
let requests = 0;
const server = createServer((req, res) => {
  requests++;
  const url = new URL(req.url!, "http://localhost");
  const mode = url.searchParams.get("mode") ?? "loaded";
  const noJs = mode === "challenge" ? "<h1>Verify you are human</h1><p>Complete the CAPTCHA to continue.</p>" : mode === "login" ? '<h1>Sign in</h1><p>Email address Password</p><input type="password">' : "";
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<title>Fixture company careers</title><main>${noJs}</main><script>
    const mode=${JSON.stringify(mode)}, listing=${JSON.stringify(listing)}, sidebar=${JSON.stringify(sidebar)}, detail=${JSON.stringify(detail)};
    const main=document.querySelector('main');
    main.innerHTML='<h1>Infrastructure engineer</h1><p>'+listing+'</p><aside>'+sidebar+'</aside><a href="/job/research?mode='+mode+'">View research scientist position</a>';
    document.addEventListener('click', event=>{const link=event.target.closest('a');if(!link)return;event.preventDefault();history.pushState({},'',link.href);
      main.innerHTML='<h1>Infrastructure engineer</h1><p>'+listing+'</p>';
      const show=()=>main.innerHTML='<h1>Research scientist</h1><p>'+detail+'</p>';
      if(mode==='stale')setTimeout(show,1500);else show();
    });
  </script>`);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const out = path.resolve(process.env.SPA_AUDIT_E2E_ARTIFACT_DIR ?? `artifacts/spa-audit-e2e-${Date.now()}`);
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "failure-modes.json"), JSON.stringify(failures, null, 2));
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
try {
  const rows = [];
  for (const mode of ["loaded", "stale", "challenge", "login"]) {
    const candidate = { id: mode, url: `${origin}/careers?mode=${mode}`, organization: `Fixture ${mode}`, organizationKey: mode, platform: "fixture", source: origin, verdict: "verified_spa" };
    const evidence = await verifyPage(browser, candidate, { outputDir: path.join(out, "original"), settleMs: 100, timeoutMs: 7000 });
    assert.equal(evidence.status, "verified", `${mode} should reproduce original false positive when appropriate`);
    rows.push({ ...candidate, evidence });
  }
  const altered = structuredClone(rows[0]);
  altered.id = "tampered-metrics";
  altered.organizationKey = altered.id;
  altered.url += "&tampered=1";
  altered.evidence.id = altered.id;
  altered.evidence.url = altered.url;
  altered.evidence.metrics.jsWords++;
  rows.push(altered);
  const manifest = path.join(out, "input.jsonl");
  await writeFile(manifest, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  const { auditManifest } = await import("../scripts/spa/audit.ts");
  const beforeReadOnly = requests;
  const audit = await auditManifest({ manifest, out: path.join(out, "read-only") });
  assert.equal(requests, beforeReadOnly);
  assert.equal(audit.approved, 1);
  assert.equal(audit.revalidated, 0);
  const readOnlyRows = (await readFile(path.join(out, "read-only/final-manifest.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(readOnlyRows.map(row => row.id), ["loaded"]);
  assert.equal(readOnlyRows[0].spaAudit.protocol, "trace-spa-audit-v1");
  assert.equal(readOnlyRows[0].spaAudit.status, "passed");
  assert.ok(readOnlyRows[0].spaAudit.addedDestinationWords >= 25);
  assert.match(readOnlyRows[0].spaAudit.navigationTextSha256, /^[a-f0-9]{64}$/);
  assert.ok(audit.entries.find(row => row.id === "stale")?.originalIssues.includes("destination_added_unique_words_below_25"));
  assert.ok(audit.entries.find(row => row.id === "challenge")?.originalIssues.includes("nojs_bot_or_access_challenge"));
  assert.ok(audit.entries.find(row => row.id === "login")?.originalIssues.includes("nojs_login_required"));
  assert.ok(audit.entries.find(row => row.id === "tampered-metrics")?.originalIssues.includes("saved_metrics_do_not_replay"));
  const relativeRow = structuredClone(rows[0]);
  relativeRow.evidence.artifacts = Object.fromEntries(Object.entries(relativeRow.evidence.artifacts).map(([key, value]) => [key, path.relative(out, value)])) as typeof relativeRow.evidence.artifacts;
  const relativeManifest = path.join(out, "relative-input.jsonl");
  await writeFile(relativeManifest, JSON.stringify(relativeRow) + "\n");
  const relativeAudit = await auditManifest({ manifest: relativeManifest, out: path.join(out, "relative-output") });
  assert.equal(relativeAudit.approved, 1);
  const relativeFinal = JSON.parse((await readFile(path.join(out, "relative-output/final-manifest.jsonl"), "utf8")).trim());
  assert.ok(path.isAbsolute(relativeFinal.evidence.artifacts.jsText));
  assert.ok((await readFile(relativeFinal.evidence.artifacts.navigationText, "utf8")).includes(detail));
  const validManifest = path.join(out, "revalidate-input.jsonl");
  await writeFile(validManifest, rows.slice(0, 4).map(row => JSON.stringify(row)).join("\n") + "\n");
  const promoted = await auditManifest({ manifest: validManifest, out: path.join(out, "revalidated"), revalidate: true, browser, concurrency: 3 });
  assert.equal(promoted.approved, 2);
  assert.equal(promoted.revalidated, 3);
  const promotedRows = (await readFile(path.join(out, "revalidated/final-manifest.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(promotedRows.map(row => row.id), ["loaded", "stale"]);
  assert.deepEqual(promotedRows.map(row => row.url), rows.slice(0, 2).map(row => row.url));
  assert.equal(promotedRows[0].evidence.artifacts.result, rows[0].evidence.artifacts.result);
  assert.notEqual(promotedRows[1].evidence.artifacts.result, rows[1].evidence.artifacts.result);
  assert.ok((await readFile(promotedRows[1].evidence.artifacts.navigationText, "utf8")).includes(detail));
  assert.ok((await readFile(rows[1].evidence.artifacts.navigationText, "utf8")).includes(listing));
  await writeFile(path.join(out, "checks.json"), JSON.stringify({ passed: failures, readOnlyRequests: beforeReadOnly, supplementalRequests: requests - beforeReadOnly }, null, 2));
  console.log(JSON.stringify({ passed: failures.length, artifactDir: out }));
} finally {
  await browser.close();
  server.close();
}
