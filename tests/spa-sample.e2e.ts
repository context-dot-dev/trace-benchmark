import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Failures covered before implementation: active output locks ignored before browser
// launch; concurrent CLI invocations overwriting sampling artifacts; stale locks silently
// stolen; resumed runs overwriting the frozen browser version. Browser-launch fixtures
// and cached receipts avoid external website requests or paid providers.
const out = path.resolve("artifacts/spa-sample-e2e");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const input = path.join(out, "candidates.jsonl");
const id = "cached-fixture";
await writeFile(input, JSON.stringify({ id, url: "https://fixture.example/careers", organization: "Fixture", organizationKey: "fixture:company", platform: "fixture", source: "https://fixture.example/inventory.csv" }) + "\n");
const stub = path.join(out, "browser-stub.cjs");
await writeFile(stub, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.SPA_LAUNCH_MARKER,"launched");setTimeout(()=>process.exit(1),Number(process.env.SPA_HOLD_MS||0));\n');
await chmod(stub, 0o755);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function exists(file: string) { try { await readFile(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
function launch(destination: string, options: { marker?: string; hold?: number; realBrowser?: boolean } = {}) {
  const env = { ...process.env };
  if (!options.realBrowser) {
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = stub;
    env.SPA_LAUNCH_MARKER = options.marker ?? path.join(out, "unexpected-launch");
    env.SPA_HOLD_MS = String(options.hold ?? 0);
  }
  const startedAt = Date.now();
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/spa/sample.ts", "--candidates", input, "--out", destination, "--target", "1"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const result = once(child, "exit").then(([code]) => ({ code, output, elapsedMs: Date.now() - startedAt }));
  return { child, result };
}
const checks: string[] = [];
let failure: string | undefined;
try {
  const active = path.join(out, "active");
  await mkdir(active);
  await writeFile(path.join(active, "sampling.lock"), String(process.pid));
  const blocked = await launch(active).result;
  assert.notEqual(blocked.code, 0);
  assert.match(blocked.output, /locked.*running|running.*locked/i);
  assert.ok(blocked.elapsedMs < 3000);
  assert.equal(await exists(path.join(out, "unexpected-launch")), false);
  assert.equal(await exists(path.join(active, "sampling.json")), false);
  assert.equal(await readFile(path.join(active, "sampling.lock"), "utf8"), String(process.pid));
  checks.push("An active owner lock rejects the real sampling CLI before browser launch or sampling writes");
  const race = path.join(out, "race"), marker = path.join(out, "race-launched");
  const first = launch(race, { marker, hold: 1800 });
  const deadline = Date.now() + 3000;
  while (!await exists(marker) && Date.now() < deadline) await delay(25);
  assert.ok(await exists(marker), "First sampler must reach the browser-launch fixture while holding its output lock");
  const second = await launch(race).result;
  assert.match(second.output, /locked.*running|running.*locked/i);
  assert.notEqual(second.code, 0);
  await first.result;
  assert.equal(await exists(path.join(race, "sampling.lock")), false);
  checks.push("Concurrent CLI invocation rejects an in-progress sampler; normal exit releases its lock");
  const stale = path.join(out, "stale");
  await mkdir(stale);
  await writeFile(path.join(stale, "sampling.lock"), "2147483647");
  const staleResult = await launch(stale).result;
  assert.match(staleResult.output, /stale.*lock|lock.*stale/i);
  assert.equal(await readFile(path.join(stale, "sampling.lock"), "utf8"), "2147483647");
  checks.push("A stale lock fails explicitly for documented manual recovery instead of silently stealing the output directory");
  const drift = path.join(out, "browser-drift");
  await mkdir(drift);
  const browserMetadata = JSON.stringify({ engine: "chromium", version: "0.fixture-old", viewport: { width: 1365, height: 900 } });
  await writeFile(path.join(drift, "browser.json"), browserMetadata);
  await writeFile(path.join(drift, "verifications.jsonl"), JSON.stringify({ id, status: "rejected", reason: "cached_fixture" }) + "\n");
  const resumed = await launch(drift, { realBrowser: true }).result;
  assert.notEqual(resumed.code, 0);
  assert.match(resumed.output, /browser.*changed|browser.*mismatch/i);
  assert.equal(await readFile(path.join(drift, "browser.json"), "utf8"), browserMetadata);
  assert.equal(await exists(path.join(drift, "sampling.lock")), false);
  checks.push("A real Chromium launch detects frozen browser-version drift before processing cached candidates and preserves original metadata");
} catch (error) { failure = error instanceof Error ? error.stack : String(error); throw error; }
finally { await writeFile(path.join(out, "e2e.json"), JSON.stringify({ ok: !failure, failure, checks, repeat: "npx tsx tests/spa-sample.e2e.ts", limitation: "CLI locking and browser-version checks only; no website requests or provider performance measurement." }, null, 2)); }
console.log(JSON.stringify({ ok: true, checks, artifact: path.join(out, "e2e.json") }, null, 2));
