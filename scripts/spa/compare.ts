import { config } from "dotenv";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, closeSync, fsyncSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { mcnemarP, quantile } from "../../src/lib/benchmark/analysis.ts";
import { isAccountLimited, providerFailed } from "../../src/lib/benchmark/outcomes.ts";
import { createReaders } from "../../src/lib/benchmark/providers.ts";
import { ACCESS_PROTOCOL, type Grade, type Receipt, type Target } from "../../src/lib/benchmark/types.ts";
import { renderReport } from "./report.ts";

type Provider = "context" | "firecrawl";
type Evidence = {
  status: string; url: string; finalUrl: string; noJsFinalUrl: string; jsDependent: boolean;
  metrics: { jsWords: number; jsOnlyWords: number; noJsCoverage: number };
  navigation: { verified: boolean; fromUrl: string; toUrl: string; documentUnchanged: boolean; contentChanged: boolean };
  artifacts: { jsText: string; noJsText: string; navigationText: string };
};
type SpaAudit = {
  protocol: "trace-spa-audit-v1"; status: "passed"; initialJsTextSha256: string; noJsTextSha256: string; navigationTextSha256: string;
  initialWords: number; destinationWords: number; destinationUniqueWords: number; addedDestinationWords: number; jsOnlyUniqueWords: number; noJsCoverage: number;
};
type Page = Target & { organization: string; platform: string; verdict: "verified_spa"; evidence: Evidence; spaAudit: SpaAudit };
type Event = { id: string; provider: Provider; stage: "read" | "access" | "quality"; phase: "started" | "done"; at: string; receipt?: Receipt; grade?: Grade };
const providers: Provider[] = ["context", "firecrawl"];
const rps = 5;
const sha256 = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const pageId = (page: Page) => sha256(page.url);
const eventKey = (id: string, provider: Provider, stage: Event["stage"], phase: Event["phase"]) => `${id}:${provider}:${stage}:${phase}`;
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const emptyReceipt = (error: string): Receipt => ({ text: "", chars: 0, hash: "", elapsedMs: 0, httpStatus: null, error, success: null, credits: null, costUsd: null, finalUrl: null });
const interruptedGrade = (): Grade => ({ inputTokens: null, success: null, content: "unclear", identity: null, confidence: null, error: "INTERRUPTED_JUDGMENT" });
async function optionalFile(file: string) {
  try { return await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function atomicWrite(file: string, content: string) {
  await writeFile(file + ".tmp", content);
  await rename(file + ".tmp", file);
}
function wilson(success: number, n: number) {
  if (!n) return null;
  const z = 1.959963984540054;
  const p = success / n;
  const center = (p + z * z / (2 * n)) / (1 + z * z / n);
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n);
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
function latency(receipts: Receipt[]) {
  const values = receipts.filter((r) => r.error !== "CACHED_RESPONSE" && r.error !== "INTERRUPTED_REQUEST").map((r) => r.elapsedMs).sort((a, b) => a - b);
  return { n: values.length, p50: quantile(values, 0.5), p90: quantile(values, 0.9), p95: quantile(values, 0.95), p99: quantile(values, 0.99) };
}
function metric(labels: (boolean | null)[]) {
  const success = labels.filter((v) => v === true).length;
  const failure = labels.filter((v) => v === false).length;
  return { success, failure, unknown: labels.length - success - failure, denominator: labels.length, rate: labels.length ? success / labels.length : null, ci95: wilson(success, labels.length), resolvedRate: success + failure ? success / (success + failure) : null };
}
function validatePage(value: unknown, line: number): Page {
  if (!value || typeof value !== "object") throw new Error(`Invalid manifest row ${line}`);
  const page = value as Page;
  if (page.verdict !== "verified_spa" || !page.evidence || typeof page.evidence !== "object" || Array.isArray(page.evidence) || !Object.keys(page.evidence).length)
    throw new Error(`Manifest row ${line} lacks verified_spa evidence`);
  for (const key of ["url", "title", "organization", "platform"] as const)
    if (typeof page[key] !== "string" || !page[key].trim()) throw new Error(`Manifest row ${line} lacks ${key}`);
  const url = new URL(page.url);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".")) throw new Error(`Invalid public URL on manifest row ${line}`);
  const evidence = page.evidence, navigation = evidence.navigation;
  if (evidence.status !== "verified" || evidence.jsDependent !== true || navigation?.verified !== true || navigation.documentUnchanged !== true || navigation.contentChanged !== true)
    throw new Error(`Manifest row ${line} lacks verified JavaScript dependence and same-document navigation`);
  if (evidence.url !== page.url || evidence.finalUrl !== evidence.noJsFinalUrl || navigation.fromUrl !== evidence.finalUrl)
    throw new Error(`Manifest row ${line} browser evidence belongs to another URL`);
  const from = new URL(navigation.fromUrl), to = new URL(navigation.toUrl);
  if (!/^https?:$/.test(from.protocol) || from.origin !== to.origin || from.href === to.href)
    throw new Error(`Manifest row ${line} lacks a distinct same-origin SPA navigation`);
  if (!(evidence.metrics?.jsWords >= 80) || !(evidence.metrics.jsOnlyWords >= 50) || !(evidence.metrics.noJsCoverage >= 0 && evidence.metrics.noJsCoverage <= 0.25))
    throw new Error(`Manifest row ${line} lacks useful JavaScript-dependent content`);
  if ([evidence.artifacts?.jsText, evidence.artifacts?.noJsText, evidence.artifacts?.navigationText].some((file) => typeof file !== "string" || !file.trim()))
    throw new Error(`Manifest row ${line} lacks browser text artifacts`);
  if (page.spaAudit?.protocol !== "trace-spa-audit-v1" || page.spaAudit.status !== "passed")
    throw new Error(`Manifest row ${line} lacks a passed strong SPA audit`);
  return page;
}
async function auditEvidence(page: Page, manifestDirectory: string) {
  const [initial, noJs, destination] = await Promise.all(["jsText", "noJsText", "navigationText"].map((key) => readFile(path.resolve(manifestDirectory, page.evidence.artifacts[key as keyof Evidence["artifacts"]]))));
  const hashes = { jsText: sha256(initial), noJsText: sha256(noJs), navigationText: sha256(destination) };
  const audit = page.spaAudit;
  if (hashes.jsText !== audit.initialJsTextSha256 || hashes.noJsText !== audit.noJsTextSha256 || hashes.navigationText !== audit.navigationTextSha256)
    throw new Error(`SPA audit artifact hash mismatch: ${page.url}`);
  const words = (text: Buffer) => text.toString("utf8").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const initialWords = words(initial), destinationWords = words(destination);
  const initialUnique = new Set(initialWords), noJsUnique = new Set(words(noJs)), destinationUnique = new Set(destinationWords);
  const jsOnlyUniqueWords = [...initialUnique].filter((word) => !noJsUnique.has(word)).length;
  const actual = {
    initialWords: initialWords.length, destinationWords: destinationWords.length, destinationUniqueWords: destinationUnique.size,
    addedDestinationWords: [...destinationUnique].filter((word) => !initialUnique.has(word)).length,
    jsOnlyUniqueWords, noJsCoverage: initialUnique.size ? 1 - jsOnlyUniqueWords / initialUnique.size : 1,
  };
  for (const key of Object.keys(actual) as (keyof typeof actual)[])
    if (!Number.isFinite(audit[key]) || Math.abs(actual[key] - audit[key]) > 1e-12) throw new Error(`SPA audit metric mismatch (${key}): ${page.url}`);
  if (actual.initialWords < 80 || actual.jsOnlyUniqueWords < 50 || actual.noJsCoverage > 0.25 || actual.destinationWords < 80 || actual.destinationUniqueWords < 50 || actual.addedDestinationWords < 25)
    throw new Error(`SPA evidence lacks substantive JavaScript-dependent content and added destination content: ${page.url}`);
  return hashes;
}
function localEndpoint(value: unknown): string {
  if (typeof value !== "string") throw new Error("Fixture endpoint must be a localhost URL");
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password)
    throw new Error("Fixture endpoints must use plain HTTP localhost without credentials");
  return url.href;
}

async function main() {
  config({ path: ".env", quiet: true });
  const { values } = parseArgs({ options: { manifest: { type: "string" }, out: { type: "string" }, limit: { type: "string" }, fixture: { type: "string" }, concurrency: { type: "string", default: "16" } } });
  if (!values.manifest || !values.out) throw new Error("Required: --manifest verified.jsonl --out artifact-directory [--limit N] [--concurrency 1..50] [--fixture localhost-config.json]");
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) throw new Error("--concurrency must be an integer from 1 to 50");
  const requestedLimit = values.limit === undefined ? null : Number(values.limit);
  if (requestedLimit !== null && (!Number.isInteger(requestedLimit) || requestedLimit < 1)) throw new Error("--limit must be a positive integer");
  const manifestText = await readFile(values.manifest, "utf8");
  const manifest = manifestText.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => validatePage(JSON.parse(line), index + 1));
  if (!manifest.length) throw new Error("Manifest is empty");
  const unique = new Set<string>();
  for (const page of manifest) {
    const canonical = new URL(page.url).href;
    if (unique.has(canonical)) throw new Error(`Duplicate URL: ${page.url}`);
    unique.add(canonical);
  }
  const pages = manifest.slice(0, requestedLimit ?? manifest.length);
  let fixtures: { endpoints: Record<string, string>; judgeEndpoint: string } | undefined;
  if (values.fixture) {
    const input = JSON.parse(await readFile(values.fixture, "utf8"));
    fixtures = { endpoints: Object.fromEntries(providers.map((p) => [p, localEndpoint(input.endpoints?.[p])])), judgeEndpoint: localEndpoint(input.judgeEndpoint) };
  }
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const manifestDirectory = path.dirname(path.resolve(values.manifest));
  const evidenceHashes = Object.fromEntries(await Promise.all(pages.map(async (page) => [pageId(page), await auditEvidence(page, manifestDirectory)])));
  const settings = {
    version: "spa-scrape-comparison-v1", manifestSha256: sha256(manifestText), manifestPages: manifest.length, selectedPages: pages.length, requestedLimit,
    codeRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
    sourceHashes: Object.fromEntries(await Promise.all(["scripts/spa/compare.ts", "src/lib/benchmark/providers.ts", "src/lib/benchmark/analysis.ts", "src/lib/benchmark/types.ts", "src/lib/benchmark/outcomes.ts"].map(async (file) => [file, sha256(await readFile(path.join(repository, file)))]))),
    evidenceHashes, providers, concurrencyPerProvider: concurrency, requestsPerSecondPerProvider: rps, providerTimeoutMs: 27000, hardTimeoutMs: 30000,
    cache: "disabled; reported hits unresolved", content: "main-content Markdown", accessProtocol: ACCESS_PROTOCOL, qualityProtocol: "quality", judgeModel: "jev-1.13.0", fixture: fixtures ?? null,
  };
  const out = path.resolve(values.out);
  await mkdir(out, { recursive: true });
  const lockFile = path.join(out, "run.lock");
  let lockFd: number;
  try { lockFd = openSync(lockFile, "wx"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const recoveryFile = path.join(out, "lock-recovery");
    let recoveryFd: number;
    try { recoveryFd = openSync(recoveryFile, "wx"); }
    catch { throw new Error("Output directory lock recovery is already running"); }
    try {
      const owner = Number((await optionalFile(lockFile))?.trim());
      let running = !Number.isSafeInteger(owner) || owner <= 0;
      if (!running) {
        try { process.kill(owner, 0); running = true; }
        catch (probe) { if ((probe as NodeJS.ErrnoException).code !== "ESRCH") running = true; }
      }
      if (running) throw new Error("Output directory is locked by another running comparison");
      unlinkSync(lockFile);
      try { lockFd = openSync(lockFile, "wx"); }
      catch { throw new Error("Output directory is locked by another running comparison"); }
    } finally { closeSync(recoveryFd); unlinkSync(recoveryFile); }
  }
  writeFileSync(lockFd, String(process.pid));
  fsyncSync(lockFd);
  process.once("exit", () => { closeSync(lockFd); unlinkSync(lockFile); });
  const runFile = path.join(out, "run.json");
  const previous = await optionalFile(runFile);
  const settingsHash = sha256(JSON.stringify(settings));
  const run = previous ? JSON.parse(previous) : { id: `spa:${settings.manifestSha256.slice(0, 16)}:${settingsHash.slice(0, 12)}`, createdAt: new Date().toISOString(), settingsHash, settings };
  if (run.settingsHash !== settingsHash || JSON.stringify(run.settings) !== JSON.stringify(settings)) throw new Error("Resume rejected: manifest, code, or settings changed; choose a new output directory");
  const ledgerFile = path.join(out, "attempts.jsonl");
  const ledgerText = await optionalFile(ledgerFile);
  if (!previous && ledgerText?.trim()) throw new Error("Existing attempt ledger has no frozen run metadata");
  if (!previous) {
    await atomicWrite(path.join(out, "manifest.jsonl"), manifestText);
    await atomicWrite(runFile, JSON.stringify(run, null, 2) + "\n");
  }
  const events = new Map<string, Event>();
  for (const line of (ledgerText ?? "").split("\n").filter(Boolean)) {
    const event = JSON.parse(line) as Event;
    if (!pages.some((p) => pageId(p) === event.id) || !providers.includes(event.provider) || !["read", "access", "quality"].includes(event.stage) || !["started", "done"].includes(event.phase)) throw new Error("Invalid attempt ledger");
    const key = eventKey(event.id, event.provider, event.stage, event.phase);
    if (events.has(key)) throw new Error("Duplicate stage in attempt ledger");
    events.set(key, event);
  }
  const unfinished = pages.some((page) => providers.some((provider) => {
    const id = pageId(page);
    const receipt = events.get(eventKey(id, provider, "read", "done"))?.receipt;
    if (!receipt) return true;
    if (receipt.error || !receipt.text.trim()) return false;
    const access = events.get(eventKey(id, provider, "access", "done"))?.grade;
    return !access || access.success === true && !events.has(eventKey(id, provider, "quality", "done"));
  }));
  if (!fixtures && unfinished && (!process.env.CONTEXT_API_KEY || !process.env.FIRECRAWL_API_KEY || !process.env.TYPESAFE_API_KEY)) throw new Error("CONTEXT_API_KEY, FIRECRAWL_API_KEY and TYPESAFE_API_KEY are required in .env or environment");
  const readers = createReaders(fixtures ? { ...fixtures, keys: { context: "fixture-secret", firecrawl: "fixture-secret", judge: "fixture-secret" } } : {});
  const fd = openSync(ledgerFile, "a");
  const record = (event: Omit<Event, "at">) => {
    const entry = { ...event, at: new Date().toISOString() };
    appendFileSync(fd, JSON.stringify(entry) + "\n");
    fsyncSync(fd);
    events.set(eventKey(entry.id, entry.provider, entry.stage, entry.phase), entry);
  };
  const get = (id: string, provider: Provider, stage: Event["stage"], phase: Event["phase"] = "done") => events.get(eventKey(id, provider, stage, phase));
  const stopped: Partial<Record<Provider, string>> = {};
  for (const event of events.values()) if (event.receipt && isAccountLimited(event.receipt.error)) stopped[event.provider] = event.receipt.error!;
  let judgeStopped: string | null = null;
  for (const event of events.values()) if (/^JUDGE_HTTP_(401|402|429)$/.test(event.grade?.error ?? "")) judgeStopped = event.grade!.error;
  const nextDispatch: Record<Provider, number> = { context: 0, firecrawl: 0 };
  const fetchPage = async (page: Page, provider: Provider) => {
    const id = pageId(page);
    let receipt = get(id, provider, "read")?.receipt;
    if (!receipt) {
      if (get(id, provider, "read", "started")) {
        receipt = emptyReceipt("INTERRUPTED_REQUEST");
        record({ id, provider, stage: "read", phase: "done", receipt });
      } else {
        if (stopped[provider]) return;
        const startAt = Math.max(Date.now(), nextDispatch[provider]);
        nextDispatch[provider] = startAt + 1000 / rps;
        await wait(Math.max(0, startAt - Date.now()));
        if (stopped[provider]) return;
        record({ id, provider, stage: "read", phase: "started" });
        receipt = await readers.read(provider, page);
        record({ id, provider, stage: "read", phase: "done", receipt });
        if (isAccountLimited(receipt.error)) stopped[provider] = receipt.error!;
      }
    }
    if (receipt.error || !receipt.text.trim()) return;
    for (const stage of ["access", "quality"] as const) {
      if (stage === "quality" && get(id, provider, "access")?.grade?.success !== true) continue;
      if (get(id, provider, stage)) continue;
      if (judgeStopped) continue;
      if (get(id, provider, stage, "started")) record({ id, provider, stage, phase: "done", grade: interruptedGrade() });
      else {
        record({ id, provider, stage, phase: "started" });
        const grade = await readers.grade(page, receipt, stage === "access" ? ACCESS_PROTOCOL : "quality");
        record({ id, provider, stage, phase: "done", grade });
        if (/^JUDGE_HTTP_(401|402|429)$/.test(grade.error ?? "")) judgeStopped = grade.error;
      }
    }
  };
  let index = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, async () => {
      while (index < pages.length) {
        const page = pages[index++];
        await Promise.all(providers.map((provider) => fetchPage(page, provider)));
      }
    }));
  } finally { closeSync(fd); }

  const outcomes = pages.map((page) => ({ ...page, id: pageId(page), results: Object.fromEntries(providers.map((provider) => {
    const id = pageId(page);
    const receipt = get(id, provider, "read")?.receipt ?? null;
    const access = get(id, provider, "access")?.grade ?? null;
    const quality = get(id, provider, "quality")?.grade ?? null;
    const excluded = receipt !== null && isAccountLimited(receipt.error);
    const accessSuccess = excluded || !receipt ? null : receipt.success === false || providerFailed({ state: "done", success: receipt.success, error: receipt.error }) ? false : access?.success ?? null;
    const qualitySuccess = accessSuccess === false ? false : accessSuccess === true ? quality?.success ?? null : null;
    return [provider, { receipt, access, quality, excluded, accessSuccess, qualitySuccess }];
  })) as Record<Provider, { receipt: Receipt | null; access: Grade | null; quality: Grade | null; excluded: boolean; accessSuccess: boolean | null; qualitySuccess: boolean | null }> }));
  let shared = 0, contextOnly = 0, firecrawlOnly = 0, both = 0, neither = 0;
  for (const page of outcomes) {
    const a = page.results.context, b = page.results.firecrawl;
    if (a.excluded || b.excluded || a.accessSuccess === null || b.accessSuccess === null) continue;
    shared++;
    if (a.accessSuccess && b.accessSuccess) both++;
    else if (a.accessSuccess) contextOnly++;
    else if (b.accessSuccess) firecrawlOnly++;
    else neither++;
  }
  const summarize = (group: typeof outcomes) => Object.fromEntries(providers.map((provider) => {
    const rows = group.map((p) => p.results[provider]);
    const attempted = rows.filter((r) => r.receipt);
    const eligible = attempted.filter((r) => !r.excluded);
    return [provider, {
      total: group.length, attempted: attempted.length, notAttempted: rows.length - attempted.length, accountExcluded: rows.filter((r) => r.excluded).length,
      stopped: stopped[provider] ?? null, unknown: eligible.filter((r) => r.accessSuccess === null).length,
      access: metric(eligible.map((r) => r.accessSuccess)), quality: metric(eligible.map((r) => r.qualitySuccess)),
      latencyMs: { all: latency(eligible.map((r) => r.receipt!)), successful: latency(eligible.filter((r) => r.accessSuccess === true).map((r) => r.receipt!)) },
      errors: Object.fromEntries([...new Set(attempted.map((r) => r.receipt!.error).filter((v): v is string => Boolean(v)))].map((error) => [error, attempted.filter((r) => r.receipt!.error === error).length])),
    }];
  }));
  const providerReports = summarize(outcomes);
  const platforms = Object.fromEntries([...new Set(pages.map((page) => page.platform))].map((platform) => {
    const group = outcomes.filter((page) => page.platform === platform);
    return [platform, { pages: group.length, providers: summarize(group) }];
  }));
  const pairSkews = pages.flatMap((page) => {
    const a = get(pageId(page), "context", "read", "started"), b = get(pageId(page), "firecrawl", "read", "started");
    return a && b ? [Math.abs(Date.parse(a.at) - Date.parse(b.at))] : [];
  }).sort((a, b) => a - b);
  const timing = {
    pairDispatchSkewMs: { n: pairSkews.length, p50: quantile(pairSkews, 0.5), p95: quantile(pairSkews, 0.95), max: pairSkews.at(-1) ?? null },
    providerSpans: Object.fromEntries(providers.map((provider) => {
      const starts = [...events.values()].filter((event) => event.provider === provider && event.stage === "read" && event.phase === "started").map((event) => event.at).sort();
      const ends = [...events.values()].filter((event) => event.provider === provider && event.stage === "read" && event.phase === "done").map((event) => event.at).sort();
      return [provider, { startedAt: starts[0] ?? null, completedAt: ends.at(-1) ?? null }];
    })),
  };
  const sampleSizeMet = pages.length >= 1000;
  const collectionComplete = outcomes.every((page) => providers.every((provider) => {
    const result = page.results[provider];
    return result.receipt && !result.excluded && !["CACHED_RESPONSE", "INTERRUPTED_REQUEST"].includes(result.receipt.error ?? "");
  }));
  const gradingComplete = outcomes.every((page) => providers.every((provider) => {
    const result = page.results[provider];
    return result.accessSuccess !== null && result.qualitySuccess !== null;
  }));
  const finalSampleRequirementMet = sampleSizeMet && collectionComplete;
  const complete = finalSampleRequirementMet && gradingComplete && !judgeStopped && !Object.keys(stopped).length;
  const p = mcnemarP(contextOnly, firecrawlOnly);
  const report = {
    run, generatedAt: new Date().toISOString(), sample: { pages: pages.length, manifestPages: manifest.length, status: complete ? "full_sample" : pages.length < 1000 ? "pilot" : "incomplete", requiredForFinal: 1000, sampleSizeMet, collectionComplete, gradingComplete, finalSampleRequirementMet, uniqueHosts: new Set(pages.map((p) => new URL(p.url).hostname)).size, uniqueOrganizations: new Set(pages.map((p) => p.organization)).size },
    providers: providerReports, platforms, timing, judgeStopped, paired: { shared, excludedOrUnresolved: pages.length - shared, contextOnly, firecrawlOnly, both, neither, p, winner: p < 0.05 ? contextOnly > firecrawlOnly ? "context" : "firecrawl" : null },
    limitations: ["A verified_spa manifest with a passed strong SPA audit is required. This runner replays text hashes and content thresholds; it does not repeat browser routing verification.", "Access follows TRACE v6 and does not measure identity, completeness or extraction quality. Separate quality grades assess substantive requested-page content using target metadata.", "Quality grades are based on adapter excerpts: at most 12,000 characters sampled from beginning, middle and end of a response truncated at 250,000 characters. They do not establish complete extraction or browser-reference recall.", "Rates use all eligible attempted pages, including unresolved judgments, as denominator; unresolved and account exclusions are also reported separately. Resolved-only rates are descriptive.", "Confidence intervals are per-page Wilson intervals; clustered URLs on the same company or platform are not statistically independent. Paired significance includes only determinate matched results.", "Latency includes read time and excludes queue wait and grading. Cached and interrupted reads are excluded from latency. Account failures are excluded from rate and latency.", "One attempt per provider and URL. Resume never repeats a dispatched read or grade; interrupted calls remain unresolved. Account-limit stops persist across resume.", ...(fixtures ? ["LOCAL HTTP FIXTURES: these results demonstrate runner behavior and are not live provider performance."] : [])],
    pages: outcomes,
  };
  await atomicWrite(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await atomicWrite(path.join(out, "report.html"), await renderReport(report));
  console.log(JSON.stringify({ run: run.id, sample: report.sample, providers: providerReports, paired: report.paired, report: path.join(out, "report.html") }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Comparison failed"); process.exitCode = 1; });
