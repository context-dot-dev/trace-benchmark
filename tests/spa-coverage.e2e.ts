import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Failures specified before implementation: a changed manifest/reference or an
// omitted, duplicated, reordered or extra report page silently changes the cohort;
// Unicode/case or no-JS boilerplate inflate coverage; failures disappear from the
// denominator; retained excerpts are described as complete provider output.
const out = path.resolve("artifacts/spa-coverage-e2e");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const extras = Array.from({ length: 47 }, (_, index) => `reference${index}`);
const tokens = ["naïve", "東京", "résumé", ...extras];
const js = ["Café", ...tokens, ...tokens.slice(0, 29)].join(" ");
const noJs = "Café";
await writeFile(path.join(out, "js.txt"), js);
await writeFile(path.join(out, "nojs.txt"), noJs);
const manifest = ["one", "two"].map((slug) => ({
  url: `https://${slug}.example/careers`, organization: `${slug} company`, platform: "fixture", verdict: "verified_spa",
  evidence: { status: "verified", artifacts: { jsText: "js.txt", noJsText: "nojs.txt" } },
  spaAudit: { protocol: "trace-spa-audit-v1", status: "passed", initialJsTextSha256: sha256(js), noJsTextSha256: sha256(noJs), initialWords: 80, jsOnlyUniqueWords: 50, noJsCoverage: 1 - 50 / 51 },
}));
const manifestText = manifest.map((row) => JSON.stringify(row)).join("\n") + "\n";
const manifestFile = path.join(out, "manifest.jsonl");
await writeFile(manifestFile, manifestText);
const half = [tokens[0].toUpperCase(), tokens[1], ...extras.slice(0, 23), "CAFÉ", "unrelated"].join(" ");
const receipt = (text: string, chars = text.length, error: string | null = null) => ({ text, chars, error, success: error ? false : null });
const report = {
  run: { settings: {
    manifestSha256: sha256(manifestText), manifestPages: 2, selectedPages: 2,
    evidenceHashes: Object.fromEntries(manifest.map((row) => [sha256(row.url), { jsText: sha256(js), noJsText: sha256(noJs) }])),
  } },
  sample: { pages: 2 },
  pages: manifest.map((row, index) => ({ url: row.url, id: sha256(row.url), results: {
    context: { receipt: index ? receipt("", 0, "REQUEST_TIMEOUT") : receipt(half) },
    firecrawl: { receipt: index ? receipt(half, 13000) : receipt(tokens.join(" ")) },
  } })),
};
const reportFile = path.join(out, "report.json");
await writeFile(reportFile, JSON.stringify(report));
async function run(destination: string, inputReport = reportFile, inputManifest = manifestFile) {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/spa/coverage.ts", "--manifest", inputManifest, "--report", inputReport, "--out", destination], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const [code] = await once(child, "exit");
  return { code, output };
}
const checks: string[] = [];
let failure: string | undefined;
try {
  const resultDir = path.join(out, "result");
  const result = await run(resultDir);
  assert.equal(result.code, 0, result.output);
  const coverage = JSON.parse(await readFile(path.join(resultDir, "coverage.json"), "utf8"));
  assert.equal(coverage.pages.length, 2);
  assert.equal(coverage.pages[0].referenceWords, 50);
  assert.equal(coverage.pages[0].providers.context.matchedWords, 25);
  assert.equal(coverage.pages[0].providers.context.observedCoverage, 0.5);
  assert.equal(coverage.pages[1].providers.context.observedCoverage, 0);
  assert.equal(coverage.providers.context.denominator, 2);
  assert.equal(coverage.providers.context.mean, 0.25);
  assert.equal(coverage.providers.context.median, 0.25);
  assert.equal(coverage.providers.context.p10, 0);
  assert.equal(coverage.providers.context.p90, 0.5);
  assert.equal(coverage.providers.firecrawl.mean, 0.75);
  assert.equal(coverage.providers.firecrawl.sampledOutput, 1);
  assert.equal(coverage.providers.context.failedOrMissingReads, 1);
  assert.match(coverage.metric, /retained excerpts/);
  assert.ok(coverage.limitations.some((text: string) => /lower bound/i.test(text)));
  assert.ok(coverage.limitations.some((text: string) => /not.*semantic|not.*quality/i.test(text)));
  const publicText = await readFile(path.join(resultDir, "coverage-public.json"), "utf8");
  assert.ok(!publicText.includes(out));
  assert.ok(!publicText.includes("reference46"));
  checks.push("Offline CLI computes deterministic Unicode/case-normalized coverage over JS-specific unique words, includes failed reads as zero, and reports excerpt sampling without raw text/local paths in public data");
  const variants: [string, typeof report][] = [];
  const missing = structuredClone(report); missing.pages.pop(); variants.push(["missing", missing]);
  const duplicate = structuredClone(report); duplicate.pages[1] = duplicate.pages[0]; variants.push(["duplicate", duplicate]);
  const reordered = structuredClone(report); reordered.pages.reverse(); variants.push(["reordered", reordered]);
  const wrongHash = structuredClone(report); wrongHash.run.settings.manifestSha256 = "0".repeat(64); variants.push(["manifest-hash", wrongHash]);
  const wrongEvidence = structuredClone(report); wrongEvidence.run.settings.evidenceHashes[report.pages[0].id].jsText = "0".repeat(64); variants.push(["evidence-hash", wrongEvidence]);
  for (const [name, variant] of variants) {
    const file = path.join(out, name + ".json");
    await writeFile(file, JSON.stringify(variant));
    assert.notEqual((await run(path.join(out, name), file)).code, 0, name);
  }
  await writeFile(path.join(out, "js.txt"), js + " changed");
  assert.notEqual((await run(path.join(out, "changed-reference"))).code, 0);
  await writeFile(path.join(out, "js.txt"), js);
  const unaudited = structuredClone(manifest);
  unaudited[0].spaAudit.status = "rejected";
  const badManifest = path.join(out, "unaudited.jsonl");
  await writeFile(badManifest, unaudited.map((row) => JSON.stringify(row)).join("\n") + "\n");
  assert.notEqual((await run(path.join(out, "unaudited"), reportFile, badManifest)).code, 0);
  checks.push("Changed manifests, missing/duplicate/reordered cohort pages, unaudited rows and changed or mismatched browser-reference hashes abort instead of silently excluding evidence");
  const missingRead = structuredClone(report);
  (missingRead.pages[1].results.context as { receipt: ReturnType<typeof receipt> | null }).receipt = null;
  const missingReadFile = path.join(out, "missing-read.json");
  await writeFile(missingReadFile, JSON.stringify(missingRead));
  const missingReadOut = path.join(out, "missing-read");
  assert.equal((await run(missingReadOut, missingReadFile)).code, 0);
  const zero = JSON.parse(await readFile(path.join(missingReadOut, "coverage.json"), "utf8"));
  assert.equal(zero.providers.context.denominator, 2);
  assert.equal(zero.pages[1].providers.context.observedCoverage, 0);
  checks.push("An explicitly missing provider receipt remains a zero-coverage cohort row");
} catch (error) { failure = error instanceof Error ? error.stack : String(error); throw error; }
finally { await writeFile(path.join(out, "e2e.json"), JSON.stringify({ ok: !failure, failure, checks, repeat: "npx tsx tests/spa-coverage.e2e.ts", limitation: "Local files prove offline evidence validation and aggregation; lexical coverage does not establish semantic quality or full-output recall." }, null, 2)); }
console.log(JSON.stringify({ ok: true, checks, artifact: path.join(out, "e2e.json") }, null, 2));
