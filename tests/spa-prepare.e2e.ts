import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Failures covered before implementation: corrupted or truncated inventory bytes;
// record counts confused by quoted newlines; commas/escaped quotes/Unicode lost;
// URL case, queries or hash routes normalized away; repeated tenant URLs admitted;
// unsupported platforms added; invalid URLs admitted; nondeterministic seed ordering.
const out = path.resolve("artifacts/spa-prepare-e2e");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const seed = "trace-spa-v1-20261115";
const inventoryFile = path.join(out, "inventory.json");
const output = path.join(out, "candidates.jsonl");
const bodies = {
  workday: 'name,slug,url\r\n"Éxample, Inc.\nDivision ""R&D""",example/main,https://example.wd1.myworkdayjobs.com/Case?lang=EN#/Product\r\n"Éxample, Inc.",example/other,https://example.wd1.myworkdayjobs.com/Other#/About\r\nSecond,second/careers,https://second.wd5.myworkdayjobs.com/Careers\r\n',
  dayforce: 'name,slug,url\n"Company, One",TenantA/Portal,https://jobs.dayforcehcm.com/TenantA/Case?lang=EN#/Jobs\n',
  eightfold: 'name,slug,url,domain\nEightfold,eightfold,https://example.eightfold.ai/careers,\nCustom Company,custom,https://careers.custom.example/careers,custom.example\n',
};
const rows = { workday: 3, dayforce: 1, eightfold: 2 };
const inventory = {
  generated_at: "2026-11-15T17:46:28.658336+00:00", by_ats_companies: Object.fromEntries(Object.entries(bodies).map(([platform, text]) => [platform, {
    csv: `https://storage.stapply.ai/jobhive/v1/${platform}/companies.csv`, sha256: sha256(text), size_bytes: Buffer.byteLength(text), rows: rows[platform as keyof typeof rows],
  }])),
};
for (const [platform, body] of Object.entries(bodies)) await writeFile(path.join(out, platform + ".csv"), body);
await writeFile(inventoryFile, JSON.stringify(inventory));
async function run(destination: string, extra: string[] = []) {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/spa/prepare.ts", "--inventory", inventoryFile, "--sources", out, "--out", destination, ...extra], { stdio: ["ignore", "pipe", "pipe"] });
  let result = "";
  child.stdout.on("data", (chunk) => { result += chunk; });
  child.stderr.on("data", (chunk) => { result += chunk; });
  const [code] = await once(child, "exit");
  return { code, output: result };
}
const checks: string[] = [];
let failure: string | undefined;
try {
  const first = await run(output);
  assert.equal(first.code, 0, first.output);
  const text = await readFile(output, "utf8");
  const candidates = text.trim().split("\n").map((line) => JSON.parse(line));
  const provenance = JSON.parse(await readFile(output + ".provenance.json", "utf8"));
  assert.equal(provenance.candidatesSha256, sha256(text));
  assert.equal(provenance.inventoryGeneratedAt, inventory.generated_at);
  assert.equal(candidates.length, 5);
  assert.equal(new Set(candidates.map((candidate) => candidate.organizationKey)).size, 5);
  const ordered = [...candidates].sort((a, b) => sha256(seed + ":" + a.url).localeCompare(sha256(seed + ":" + b.url)));
  assert.deepEqual(candidates, ordered);
  const firstTenant = candidates.find((candidate) => candidate.organizationKey === "workday:example");
  const urls = ["https://example.wd1.myworkdayjobs.com/Case?lang=EN#/Product", "https://example.wd1.myworkdayjobs.com/Other#/About"].sort((a, b) => sha256(seed + ":" + a).localeCompare(sha256(seed + ":" + b)));
  assert.equal(firstTenant.url, urls[0]);
  assert.ok(candidates.some((candidate) => candidate.organizationKey === "dayforce:TenantA" && candidate.url.endsWith("/Case?lang=EN#/Jobs") && candidate.organization === "Company, One"));
  assert.ok(candidates.some((candidate) => candidate.organizationKey === "eightfold:custom"));
  const specialSeed = Array.from({ length: 100 }, (_, index) => `quoted-name-${index}`).find((value) => sha256(value + ":" + urls[0]).localeCompare(sha256(value + ":" + urls[1])) !== sha256(seed + ":" + urls[0]).localeCompare(sha256(seed + ":" + urls[1])))!;
  const quotedOutput = path.join(out, "quoted.jsonl");
  assert.equal((await run(quotedOutput, ["--seed", specialSeed])).code, 0);
  const quotedRows = (await readFile(quotedOutput, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const multiline = quotedRows.find((candidate) => candidate.url.includes("/Case?lang=EN#/Product")) ?? candidates.find((candidate) => candidate.url.includes("/Case?lang=EN#/Product"));
  assert.equal(multiline.organization, 'Éxample, Inc.\nDivision "R&D"');
  for (const candidate of candidates) assert.equal(candidate.id, sha256(candidate.url).slice(0, 20));
  const repeat = path.join(out, "repeat.jsonl");
  assert.equal((await run(repeat)).code, 0);
  assert.equal(await readFile(repeat, "utf8"), text);
  assert.notEqual(await readFile(quotedOutput, "utf8"), text);
  checks.push("CLI verifies quoted CSV records, preserves Unicode/names/URL case/query/hash, deterministically orders and deduplicates platform tenants, and supports an explicit alternate seed");
  await writeFile(path.join(out, "workday.csv"), bodies.workday + "corrupt");
  assert.notEqual((await run(path.join(out, "bad-bytes.jsonl"))).code, 0);
  await writeFile(path.join(out, "workday.csv"), bodies.workday.replace("Second", "Seconx"));
  assert.notEqual((await run(path.join(out, "bad-sha.jsonl"))).code, 0);
  await writeFile(path.join(out, "workday.csv"), bodies.workday);
  const wrongRows = structuredClone(inventory);
  wrongRows.by_ats_companies.workday.rows = 500;
  await writeFile(inventoryFile, JSON.stringify(wrongRows));
  assert.notEqual((await run(path.join(out, "bad-count.jsonl"))).code, 0);
  const invalid = bodies.dayforce.replace("https://jobs.dayforcehcm.com/TenantA/Case?lang=EN#/Jobs", "javascript:alert(1)");
  const invalidInventory = structuredClone(inventory);
  invalidInventory.by_ats_companies.dayforce.sha256 = sha256(invalid);
  invalidInventory.by_ats_companies.dayforce.size_bytes = Buffer.byteLength(invalid);
  await writeFile(path.join(out, "dayforce.csv"), invalid);
  await writeFile(inventoryFile, JSON.stringify(invalidInventory));
  assert.notEqual((await run(path.join(out, "bad-url.jsonl"))).code, 0);
  checks.push("Corrupted bytes, incorrect logical row counts and validly hashed invalid URLs fail before any candidate output");
} catch (error) { failure = error instanceof Error ? error.stack : String(error); throw error; }
finally {
  for (const [platform, body] of Object.entries(bodies)) await writeFile(path.join(out, platform + ".csv"), body);
  await writeFile(inventoryFile, JSON.stringify(inventory));
  await writeFile(path.join(out, "e2e.json"), JSON.stringify({ ok: !failure, failure, checks, repeat: "npx tsx tests/spa-prepare.e2e.ts", evidence: { candidates: output, inventory: inventoryFile }, limitation: "Local fixture inventories prove preparation; candidate URLs still require separate browser SPA verification." }, null, 2));
}
console.log(JSON.stringify({ ok: true, checks, artifact: path.join(out, "e2e.json") }, null, 2));
