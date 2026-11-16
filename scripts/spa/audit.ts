import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Browser } from "playwright-core";
import { verifyPage, type SpaCandidate, type SpaVerification } from "./verify.ts";

type ManifestEntry = SpaCandidate & { id: string; evidence: SpaVerification; [key: string]: unknown };
type EvidenceMetrics = {
  initialWords: number;
  noJsWords: number;
  jsOnlyUniqueWords: number;
  noJsCoverage: number;
  destinationWords: number;
  destinationUniqueWords: number;
  destinationAddedUniqueWords: number;
  hasWorkdayDetailMarkers: boolean;
};
export type SpaAuditProof = {
  protocol: "trace-spa-audit-v1";
  status: "passed";
  initialJsTextSha256: string;
  noJsTextSha256: string;
  navigationTextSha256: string;
  addedDestinationWords: number;
  initialWords: number;
  destinationWords: number;
  destinationUniqueWords: number;
  jsOnlyUniqueWords: number;
  noJsCoverage: number;
};
type EvidenceReview = { issues: string[]; metrics?: EvidenceMetrics; spaAudit?: SpaAuditProof };
export type AuditEntry = {
  id: string;
  url: string;
  approved: boolean;
  originalIssues: string[];
  originalReceipt: string;
  selectedReceipt: string;
  metrics?: EvidenceMetrics;
  supplemental?: { issues: string[]; receipt: string; metrics?: EvidenceMetrics };
};
export type AuditReport = {
  protocol: "trace-spa-evidence-audit-v1";
  manifest: string;
  manifestSha256: string;
  auditSourceSha256: string;
  verifierSourceSha256: string;
  auditedAt: string;
  total: number;
  approved: number;
  rejected: number;
  revalidated: number;
  revalidationSettings: { enabled: boolean; settleMs: 5000; timeoutMs: 30000; concurrency: number };
  reasons: Record<string, number>;
  entries: AuditEntry[];
};
export type AuditOptions = {
  manifest: string;
  out: string;
  revalidate?: boolean;
  browser?: Browser;
  concurrency?: number;
};
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
const difference = (left: Set<string>, right: Set<string>) => [...left].filter(word => !right.has(word)).length;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const title = (html: string) => html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, " ").trim() ?? "";
function blocker(text: string, pageTitle: string) {
  const heading = `${pageTitle}\n${text.slice(0, 1000)}`;
  if (/verify (?:that )?you are (?:a )?human|complete (?:the |a )?captcha|checking your browser|just a moment\.\.\.|access denied|attention required!|enable javascript and cookies to continue/i.test(heading)) return "bot_or_access_challenge";
  if (/sign in to (?:continue|access|view)|log in to (?:continue|access|view)|authentication required|you must (?:sign|log) in/i.test(heading) || /^(?:sign in|log in|login)$/i.test(pageTitle)) return "login_required";
  if (/^(?:404|not found|page not found|service unavailable|internal server error)(?:\b|$)/im.test(heading)) return "error_page";
  return undefined;
}
async function reviewEvidence(candidate: ManifestEntry, evidence: SpaVerification, baseDirectory: string): Promise<EvidenceReview> {
  const issues: string[] = [];
  if (evidence.id !== candidate.id || evidence.url !== candidate.url) issues.push("candidate_identity_mismatch");
  if (evidence.status !== "verified" || !evidence.jsDependent || !evidence.navigation?.verified || !evidence.navigation.documentUnchanged || !evidence.navigation.contentChanged) issues.push("source_spa_gates_not_verified");
  if (evidence.finalUrl !== evidence.noJsFinalUrl || evidence.navigation?.fromUrl !== evidence.finalUrl || evidence.navigation?.toUrl === evidence.finalUrl) issues.push("source_url_evidence_mismatch");
  try {
    if (new URL(evidence.navigation.toUrl!).origin !== new URL(evidence.finalUrl).origin) issues.push("destination_is_cross_origin");
  } catch { issues.push("invalid_navigation_url"); }
  try {
    const [jsBytes, noJsBytes, navigationBytes, jsHtmlBytes, noJsHtmlBytes, receiptBytes] = await Promise.all([
      evidence.artifacts.jsText, evidence.artifacts.noJsText, evidence.artifacts.navigationText,
      evidence.artifacts.jsHtml, evidence.artifacts.noJsHtml, evidence.artifacts.result,
    ].map(file => readFile(path.resolve(baseDirectory, file))));
    const [js, noJs, navigation, jsHtml, noJsHtml, receipt] = [jsBytes, noJsBytes, navigationBytes, jsHtmlBytes, noJsHtmlBytes, receiptBytes].map(buffer => buffer.toString("utf8"));
    const storedVerification = { ...JSON.parse(receipt), artifacts: undefined };
    const referencedVerification = { ...evidence, artifacts: undefined };
    if (JSON.stringify(storedVerification) !== JSON.stringify(referencedVerification)) issues.push("source_receipt_mismatch");
    const initial = words(js);
    const noJsTokens = words(noJs);
    const destination = words(navigation);
    const initialSet = new Set(initial);
    const noJsSet = new Set(noJsTokens);
    const destinationSet = new Set(destination);
    const jsOnlyUniqueWords = difference(initialSet, noJsSet);
    const noJsCoverage = initialSet.size ? 1 - jsOnlyUniqueWords / initialSet.size : 1;
    const metrics: EvidenceMetrics = {
      initialWords: initial.length, noJsWords: noJsTokens.length, jsOnlyUniqueWords, noJsCoverage,
      destinationWords: destination.length, destinationUniqueWords: destinationSet.size,
      destinationAddedUniqueWords: difference(destinationSet, initialSet),
      hasWorkdayDetailMarkers: /Return to selected search result|job requisition id/i.test(navigation),
    };
    if (initial.length !== evidence.metrics?.jsWords || noJsTokens.length !== evidence.metrics?.noJsWords || jsOnlyUniqueWords !== evidence.metrics?.jsOnlyWords || !Number.isFinite(evidence.metrics?.noJsCoverage) || Math.abs(noJsCoverage - evidence.metrics.noJsCoverage) > 1e-9) issues.push("saved_metrics_do_not_replay");
    if (initial.length < 80 || initialSet.size < 50 || jsOnlyUniqueWords < 50 || noJsCoverage > 0.25) issues.push("initial_content_not_strictly_js_dependent");
    for (const [phase, text, pageTitle] of [["initial", js, title(jsHtml)], ["nojs", noJs, title(noJsHtml)], ["destination", navigation, ""]]) {
      const firstLine = text.split(/\r?\n/).find(line => line.trim())?.trim() ?? "";
      const blocked = phase === "nojs" && /^(?:sign in|log in|login)$/i.test(firstLine) ? "login_required" : blocker(text, pageTitle);
      if (blocked) issues.push(`${phase}_${blocked}`);
    }
    if (destination.length < 80) issues.push("destination_words_below_80");
    if (destinationSet.size < 50) issues.push("destination_unique_words_below_50");
    if (metrics.destinationAddedUniqueWords < 25) issues.push("destination_added_unique_words_below_25");
    const spaAudit: SpaAuditProof = {
      protocol: "trace-spa-audit-v1", status: "passed", initialJsTextSha256: hash(jsBytes),
      noJsTextSha256: hash(noJsBytes), navigationTextSha256: hash(navigationBytes),
      addedDestinationWords: metrics.destinationAddedUniqueWords, initialWords: metrics.initialWords,
      destinationWords: metrics.destinationWords, destinationUniqueWords: metrics.destinationUniqueWords,
      jsOnlyUniqueWords: metrics.jsOnlyUniqueWords, noJsCoverage: metrics.noJsCoverage,
    };
    return { issues, metrics, spaAudit: issues.length ? undefined : spaAudit };
  } catch (error) {
    issues.push(`evidence_read_failed: ${error instanceof Error ? error.message : String(error)}`);
    return { issues };
  }
}

export async function auditManifest(options: AuditOptions): Promise<AuditReport> {
  const concurrency = options.concurrency ?? 12;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 24) throw new Error("Audit concurrency must be between 1 and 24");
  const raw = await readFile(options.manifest, "utf8");
  const baseDirectory = path.dirname(path.resolve(options.manifest));
  const candidates: ManifestEntry[] = raw.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id || !candidate.url || !candidate.evidence || seenIds.has(candidate.id) || seenUrls.has(candidate.url)) throw new Error("Manifest must contain unique candidate IDs and URLs with evidence");
    seenIds.add(candidate.id);
    seenUrls.add(candidate.url);
  }
  const out = path.resolve(options.out);
  await mkdir(out, { recursive: true });
  const [auditSource, verifierSource] = await Promise.all([readFile(fileURLToPath(import.meta.url)), readFile(fileURLToPath(new URL("./verify.ts", import.meta.url)))]);
  const report: AuditReport = {
    protocol: "trace-spa-evidence-audit-v1", manifest: path.resolve(options.manifest), manifestSha256: hash(raw),
    auditSourceSha256: hash(auditSource), verifierSourceSha256: hash(verifierSource), auditedAt: new Date().toISOString(),
    total: candidates.length, approved: 0, rejected: 0, revalidated: 0,
    revalidationSettings: { enabled: options.revalidate ?? false, settleMs: 5000, timeoutMs: 30000, concurrency }, reasons: {}, entries: [],
  };
  const selected = new Map<string, { evidence: SpaVerification; spaAudit: SpaAuditProof }>();
  for (const candidate of candidates) {
    const review = await reviewEvidence(candidate, candidate.evidence, baseDirectory);
    const approved = !review.issues.length;
    const receipt = path.resolve(baseDirectory, candidate.evidence.artifacts.result);
    report.entries.push({ id: candidate.id, url: candidate.url, approved, originalIssues: review.issues, originalReceipt: receipt, selectedReceipt: receipt, metrics: review.metrics });
    if (approved) selected.set(candidate.id, { evidence: candidate.evidence, spaAudit: review.spaAudit! });
  }
  const pending = report.entries.filter(entry => !entry.approved);
  let browser = options.browser;
  let ownsBrowser = false;
  try {
    if (options.revalidate && pending.length) {
      if (!browser) {
        browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
        ownsBrowser = true;
      }
      const supplemental = path.join(out, "supplemental", `${Date.now()}-${report.manifestSha256.slice(0, 12)}`);
      const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
      for (let cursor = 0; cursor < pending.length; cursor += concurrency) {
        await Promise.all(pending.slice(cursor, cursor + concurrency).map(async entry => {
          const candidate = byId.get(entry.id)!;
          const evidence = await verifyPage(browser!, candidate, { outputDir: supplemental, settleMs: 5000, timeoutMs: 30000 });
          const review = await reviewEvidence(candidate, evidence, baseDirectory);
          entry.supplemental = { issues: review.issues, receipt: evidence.artifacts.result, metrics: review.metrics };
          report.revalidated++;
          if (!review.issues.length) {
            entry.approved = true;
            entry.selectedReceipt = evidence.artifacts.result;
            entry.metrics = review.metrics;
            selected.set(entry.id, { evidence, spaAudit: review.spaAudit! });
          }
        }));
        console.log(JSON.stringify({ auditRevalidated: report.revalidated, pending: pending.length, approved: selected.size }));
      }
    }
  } finally { if (ownsBrowser) await browser?.close(); }
  for (const entry of report.entries) {
    if (entry.approved) report.approved++;
    else {
      report.rejected++;
      for (const reason of entry.supplemental?.issues ?? entry.originalIssues) report.reasons[reason] = (report.reasons[reason] ?? 0) + 1;
    }
  }
  const final = candidates.filter(candidate => selected.has(candidate.id)).map(candidate => {
    const selection = selected.get(candidate.id)!;
    const artifacts = Object.fromEntries(Object.entries(selection.evidence.artifacts).map(([key, value]) => [key, typeof value === "string" ? path.resolve(baseDirectory, value) : value])) as SpaVerification["artifacts"];
    return { ...candidate, evidence: { ...selection.evidence, artifacts }, spaAudit: selection.spaAudit };
  });
  await writeFile(path.join(out, "audit.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(out, "final-manifest.jsonl"), final.map(candidate => JSON.stringify(candidate)).join("\n") + (final.length ? "\n" : ""));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { manifest: { type: "string" }, out: { type: "string" }, revalidate: { type: "boolean", default: false }, concurrency: { type: "string" } } });
  if (!values.manifest || !values.out) throw new Error("Usage: tsx scripts/spa/audit.ts --manifest primary-manifest.jsonl --out audit-directory [--revalidate] [--concurrency 12]");
  const report = await auditManifest({ manifest: values.manifest, out: values.out, revalidate: values.revalidate, concurrency: Number(values.concurrency ?? 12) });
  console.log(JSON.stringify({ total: report.total, approved: report.approved, rejected: report.rejected, revalidated: report.revalidated, reasons: report.reasons, out: path.resolve(values.out) }));
}
