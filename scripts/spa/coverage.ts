import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { quantile } from "../../src/lib/benchmark/analysis.ts";

type Provider = "context" | "firecrawl";
type ManifestPage = {
  url: string; organization: string; platform: string; verdict: string;
  evidence: { status: string; artifacts: { jsText: string; noJsText: string } };
  spaAudit: { protocol: string; status: string; initialJsTextSha256: string; noJsTextSha256: string; initialWords: number; jsOnlyUniqueWords: number; noJsCoverage: number };
};
type Receipt = { text: string; chars: number; error: string | null; success: boolean | null };
type SavedPage = { id: string; url: string; results: Record<Provider, { receipt: Receipt | null }> };
type SavedReport = {
  run: { settings: { manifestSha256: string; manifestPages: number; selectedPages: number; evidenceHashes: Record<string, { jsText: string; noJsText: string }> } };
  sample: { pages: number }; pages: SavedPage[];
};
const providers: Provider[] = ["context", "firecrawl"];
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
async function atomicWrite(file: string, value: unknown) {
  await writeFile(file + ".tmp", JSON.stringify(value, null, 2) + "\n");
  await rename(file + ".tmp", file);
}

async function main() {
  const { values } = parseArgs({ options: { manifest: { type: "string" }, report: { type: "string" }, out: { type: "string" } } });
  if (!values.manifest || !values.report || !values.out) throw new Error("Required: --manifest frozen-manifest.jsonl --report saved-report.json --out coverage-directory");
  const [manifestBytes, reportBytes, source] = await Promise.all([readFile(values.manifest), readFile(values.report), readFile(fileURLToPath(import.meta.url))]);
  const manifest: ManifestPage[] = manifestBytes.toString("utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const report = JSON.parse(reportBytes.toString("utf8")) as SavedReport;
  const settings = report.run?.settings;
  if (!manifest.length || !settings || settings.manifestSha256 !== hash(manifestBytes)) throw new Error("Saved report does not belong to this exact manifest");
  if (!Array.isArray(report.pages) || report.pages.length !== manifest.length || report.sample?.pages !== manifest.length || settings.manifestPages !== manifest.length || settings.selectedPages !== manifest.length)
    throw new Error("Coverage requires the entire manifest cohort with exactly one saved report row per URL");
  const seen = new Set<string>();
  for (let index = 0; index < manifest.length; index++) {
    const page = manifest[index], saved = report.pages[index];
    if (typeof page.url !== "string" || typeof page.organization !== "string" || typeof page.platform !== "string") throw new Error(`Invalid manifest identity at row ${index + 1}`);
    const url = new URL(page.url);
    if (!/^https?:$/.test(url.protocol) || seen.has(url.href)) throw new Error(`Invalid or duplicate manifest URL at row ${index + 1}`);
    seen.add(url.href);
    if (saved?.url !== page.url || saved.id !== hash(page.url)) throw new Error(`Saved report URL/order/ID mismatch at row ${index + 1}`);
    if (page.verdict !== "verified_spa" || page.evidence?.status !== "verified" || page.spaAudit?.protocol !== "trace-spa-audit-v1" || page.spaAudit.status !== "passed")
      throw new Error(`Manifest row ${index + 1} lacks a passed SPA audit`);
  }
  const manifestDirectory = path.dirname(path.resolve(values.manifest));
  const pages = await Promise.all(manifest.map(async (page, index) => {
    const saved = report.pages[index], audit = page.spaAudit;
    const artifacts = page.evidence.artifacts;
    if (typeof artifacts?.jsText !== "string" || typeof artifacts.noJsText !== "string") throw new Error(`Missing browser text artifacts: ${page.url}`);
    const [initialBytes, noJsBytes] = await Promise.all([readFile(path.resolve(manifestDirectory, artifacts.jsText)), readFile(path.resolve(manifestDirectory, artifacts.noJsText))]);
    const initialHash = hash(initialBytes), noJsHash = hash(noJsBytes);
    const frozenHashes = settings.evidenceHashes?.[saved.id];
    if (initialHash !== audit.initialJsTextSha256 || noJsHash !== audit.noJsTextSha256 || initialHash !== frozenHashes?.jsText || noJsHash !== frozenHashes?.noJsText)
      throw new Error(`Browser reference hash mismatch: ${page.url}`);
    const initial = words(initialBytes.toString("utf8")), noJs = new Set(words(noJsBytes.toString("utf8")));
    const initialUnique = new Set(initial);
    const reference = [...initialUnique].filter((word) => !noJs.has(word));
    const noJsCoverage = initialUnique.size ? 1 - reference.length / initialUnique.size : 1;
    if (initial.length !== audit.initialWords || reference.length !== audit.jsOnlyUniqueWords || !Number.isFinite(audit.noJsCoverage) || Math.abs(noJsCoverage - audit.noJsCoverage) > 1e-12 || initial.length < 80 || reference.length < 50 || noJsCoverage > 0.25)
      throw new Error(`SPA audit reference vocabulary does not replay: ${page.url}`);
    const observations = Object.fromEntries(providers.map((provider) => {
      if (!saved.results?.[provider] || !Object.hasOwn(saved.results[provider], "receipt")) throw new Error(`Missing provider result envelope (${provider}): ${page.url}`);
      const receipt = saved.results[provider].receipt;
      if (receipt !== null && (typeof receipt.text !== "string" || !Number.isSafeInteger(receipt.chars) || receipt.chars < 0 || !(receipt.error === null || typeof receipt.error === "string") || ![true, false, null].includes(receipt.success)))
        throw new Error(`Invalid provider receipt (${provider}): ${page.url}`);
      const failedOrMissingRead = !receipt || Boolean(receipt.error) || receipt.success === false;
      const observed = new Set(failedOrMissingRead ? [] : words(receipt.text));
      const matchedWords = reference.filter((word) => observed.has(word)).length;
      return [provider, {
        matchedWords, observedCoverage: matchedWords / reference.length,
        receiptCharacters: receipt?.chars ?? 0, retainedCharacters: receipt?.text.length ?? 0,
        sampledOutput: Boolean(receipt && receipt.chars > 12000), failedOrMissingRead, readError: receipt?.error ?? null,
      }];
    })) as Record<Provider, { matchedWords: number; observedCoverage: number; receiptCharacters: number; retainedCharacters: number; sampledOutput: boolean; failedOrMissingRead: boolean; readError: string | null }>;
    return { id: saved.id, url: page.url, organization: page.organization, platform: page.platform, referenceWords: reference.length, providers: observations };
  }));
  const summarize = (group: typeof pages) => Object.fromEntries(providers.map((provider) => {
    const observations = group.map((page) => page.providers[provider]);
    const values = observations.map((row) => row.observedCoverage).sort((a, b) => a - b);
    return [provider, {
      denominator: group.length, mean: values.reduce((sum, value) => sum + value, 0) / group.length,
      median: (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2,
      p10: quantile(values, 0.1), p90: quantile(values, 0.9),
      sampledOutput: observations.filter((row) => row.sampledOutput).length,
      failedOrMissingReads: observations.filter((row) => row.failedOrMissingRead).length,
    }];
  }));
  const result = {
    protocol: "trace-spa-observed-coverage-v1", generatedAt: new Date().toISOString(),
    metric: "Observed browser-vocabulary coverage in retained excerpts",
    inputs: { manifestSha256: hash(manifestBytes), reportSha256: hash(reportBytes), sourceSha256: hash(source) },
    definition: "For each URL, unique normalized words in the browser's JavaScript text but absent from its no-JavaScript text form the reference. Coverage is the fraction present in retained provider text. Failed or missing reads score zero. Every manifest URL remains in the denominator.",
    aggregation: "Unweighted per-URL mean; median averages the two middle values for even cohorts; p10 and p90 use nearest rank.",
    limitations: [
      "Lexical overlap is not semantic quality, job-list completeness, correctness, or a provider quality ranking.",
      "Retained provider text is sampled at the beginning, middle and end for responses longer than 12,000 characters, after the adapter's 250,000-character cap. Observed matches are a lower bound on full-output vocabulary matches; omitted excerpts can contain additional matches.",
      "Shared company prose, navigation or other JavaScript-rendered boilerplate can increase overlap without capturing job records. No-JavaScript words are excluded but this does not remove all boilerplate.",
      "Language, inflection, spelling, formatting and temporal changes can reduce lexical overlap even when content is useful. Browser references and provider reads were collected at different times.",
      "This analysis uses saved artifacts only. It performs no provider requests, model judgments, retries or regrading.",
    ],
    providers: summarize(pages),
    platforms: Object.fromEntries([...new Set(pages.map((page) => page.platform))].map((platform) => [platform, summarize(pages.filter((page) => page.platform === platform))])),
    pages,
  };
  const out = path.resolve(values.out);
  await mkdir(out, { recursive: true });
  await atomicWrite(path.join(out, "coverage.json"), result);
  await atomicWrite(path.join(out, "coverage-public.json"), {
    ...result,
    pages: pages.map((page) => ({
      id: page.id, url: page.url, organization: page.organization, platform: page.platform, referenceWords: page.referenceWords,
      providers: Object.fromEntries(providers.map((provider) => {
        const row = page.providers[provider];
        return [provider, { matchedWords: row.matchedWords, observedCoverage: row.observedCoverage, sampledOutput: row.sampledOutput }];
      })),
    })),
  });
  console.log(JSON.stringify({ metric: result.metric, pages: pages.length, providers: result.providers, output: path.join(out, "coverage.json") }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Offline coverage analysis failed"); process.exitCode = 1; });
