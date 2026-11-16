import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { verifyPage, type SpaCandidate, type SpaVerification } from "./verify.ts";

type Candidate = SpaCandidate & { id: string; organization: string; organizationKey: string; platform: string; source: string };
const { values: args } = parseArgs({ options: { candidates: { type: "string" }, out: { type: "string" }, target: { type: "string" }, concurrency: { type: "string" }, "platform-cap": { type: "string" } } });
const input = args.candidates;
const output = args.out;
if (!input || !output) throw new Error("Usage: tsx scripts/spa/sample.ts --candidates candidates.jsonl --out directory [--target 1000] [--concurrency 16] [--platform-cap 600]");
const target = Number(args.target ?? 1000);
const concurrency = Number(args.concurrency ?? 16);
const platformCap = Number(args["platform-cap"] ?? 600);
if (![target, concurrency, platformCap].every(value => Number.isSafeInteger(value) && value > 0) || concurrency > 50) throw new Error("Invalid positive sampling limits; concurrency must be at most 50");
const out = path.resolve(output);
await mkdir(out, { recursive: true });
const lockPath = path.join(out, "sampling.lock");
let lockFd: number;
try { lockFd = openSync(lockPath, "wx"); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  const owner = Number((await readFile(lockPath, "utf8")).trim());
  let running = Number.isSafeInteger(owner) && owner > 0;
  if (running) {
    try { process.kill(owner, 0); }
    catch (probe) { if ((probe as NodeJS.ErrnoException).code === "ESRCH") running = false; }
  }
  throw new Error(running ? `Sampling output is locked by running process ${owner}` : `Stale sampling lock: verify no sampler owns this directory, then remove ${lockPath} before resuming`);
}
writeFileSync(lockFd, String(process.pid));
fsyncSync(lockFd);
process.once("exit", () => { closeSync(lockFd); unlinkSync(lockPath); });
const raw = await readFile(input, "utf8");
const candidates: Candidate[] = raw.trim().split("\n").map(line => JSON.parse(line));
const urls = new Set<string>();
const organizations = new Set<string>();
const ids = new Set<string>();
for (const candidate of candidates) {
  if (!candidate.id || !candidate.organization || !candidate.organizationKey || !candidate.platform || !candidate.source || !/^https:\/\//.test(candidate.url)) throw new Error("Invalid candidate");
  if (urls.has(candidate.url) || organizations.has(candidate.organizationKey) || ids.has(candidate.id)) throw new Error("Candidates must have unique IDs, URLs and organization keys");
  urls.add(candidate.url); organizations.add(candidate.organizationKey); ids.add(candidate.id);
}
const verifier = await readFile(fileURLToPath(new URL("./verify.ts", import.meta.url)));
const settings = { protocol: "trace-spa-browser-v1", verifierSha256: createHash("sha256").update(verifier).digest("hex"), candidatesSha256: createHash("sha256").update(raw).digest("hex"), target, concurrency, platformCap, timeoutMs: 24_000, settleMs: 1200, selection: "candidate order; completed fixed batches; max one URL per organization key" };
const settingsPath = path.join(out, "sampling.json");
try {
  const previous = JSON.parse(await readFile(settingsPath, "utf8"));
  if (JSON.stringify(previous.settings) !== JSON.stringify(settings)) throw new Error("Sampling settings or candidate list changed; choose a new output directory");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  await writeFile(settingsPath, JSON.stringify({ settings, startedAt: new Date().toISOString(), candidateCount: candidates.length }, null, 2));
}
const completed = new Map<string, SpaVerification>();
try { for (const line of (await readFile(path.join(out, "verifications.jsonl"), "utf8")).trim().split("\n").filter(Boolean)) { const result: SpaVerification = JSON.parse(line); completed.set(result.id, result); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const admitted: (Candidate & { title: string; verdict: "verified_spa"; evidence: SpaVerification })[] = [];
const platforms: Record<string, number> = {};
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
let cursor = 0;
try {
  const browserPath = path.join(out, "browser.json");
  const metadata = { engine: "chromium", version: browser.version(), viewport: { width: 1365, height: 900 } };
  try {
    const previous = JSON.parse(await readFile(browserPath, "utf8"));
    if (previous.engine !== metadata.engine || previous.version !== metadata.version || previous.viewport?.width !== metadata.viewport.width || previous.viewport?.height !== metadata.viewport.height)
      throw new Error("Browser version or viewport changed; resume with the frozen browser or choose a new output directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(browserPath, JSON.stringify(metadata, null, 2));
  }
  while (cursor < candidates.length && admitted.length < target) {
    const batch = candidates.slice(cursor, cursor + concurrency);
    cursor += batch.length;
    await Promise.all(batch.map(async candidate => {
      if (completed.has(candidate.id) || (platforms[candidate.platform] ?? 0) >= platformCap) return;
      const result = await verifyPage(browser, candidate, { outputDir: path.join(out, "evidence"), screenshotDir: completed.size < 12 ? path.join(out, "screenshots") : undefined, timeoutMs: settings.timeoutMs, settleMs: settings.settleMs });
      completed.set(candidate.id, result);
      await appendFile(path.join(out, "verifications.jsonl"), JSON.stringify(result) + "\n");
    }));
    for (const candidate of batch) {
      const result = completed.get(candidate.id);
      if (result?.status !== "verified" || (platforms[candidate.platform] ?? 0) >= platformCap || admitted.length >= target) continue;
      admitted.push({ ...candidate, title: result.anchors.h1.join(" / ") || result.anchors.title, verdict: "verified_spa", evidence: result });
      platforms[candidate.platform] = (platforms[candidate.platform] ?? 0) + 1;
    }
    const statuses: Record<string, number> = {};
    const reasons: Record<string, number> = {};
    for (const result of completed.values()) { statuses[result.status] = (statuses[result.status] ?? 0) + 1; reasons[result.reason.split(":")[0]] = (reasons[result.reason.split(":")[0]] ?? 0) + 1; }
    const progress = { considered: cursor, verified: admitted.length, target, platforms, statuses, reasons, updatedAt: new Date().toISOString() };
    await writeFile(path.join(out, "progress.json"), JSON.stringify(progress, null, 2));
    await writeFile(path.join(out, "manifest.jsonl"), admitted.map(candidate => JSON.stringify(candidate)).join("\n") + (admitted.length ? "\n" : ""));
    console.log(JSON.stringify(progress));
  }
} finally { await browser.close(); }
if (admitted.length < target) { console.error(`Only ${admitted.length}/${target} strictly verified SPA URLs; do not label this a complete cohort.`); process.exitCode = 2; }
