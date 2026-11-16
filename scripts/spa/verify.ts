import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";

export type SpaCandidate = {
  url: string;
  id?: string;
  company?: string;
  organization?: string;
  platform?: string;
  title?: string;
};
export type VerifyOptions = {
  outputDir: string;
  screenshotDir?: string;
  timeoutMs?: number;
  settleMs?: number;
};
export type SpaVerification = {
  id: string;
  url: string;
  finalUrl: string;
  noJsFinalUrl?: string;
  status: "verified" | "rejected" | "inconclusive";
  reason: string;
  jsDependent: boolean;
  anchors: { title: string; h1: string[] };
  metrics: { jsWords: number; noJsWords: number; jsOnlyWords: number; noJsCoverage: number };
  navigation: {
    verified: boolean;
    fromUrl?: string;
    toUrl?: string;
    linkText?: string;
    documentUnchanged?: boolean;
    contentChanged?: boolean;
  };
  artifacts: {
    jsText: string;
    noJsText: string;
    jsHtml: string;
    noJsHtml: string;
    navigationText: string;
    result: string;
    jsScreenshot?: string;
    noJsScreenshot?: string;
  };
};
type Snapshot = {
  url: string;
  title: string;
  h1: string[];
  text: string;
  bodyText: string;
  documentId: string | undefined;
  hasPassword: boolean;
  links: { href: string; text: string }[];
};
const tokenize = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
const uniqueWords = (text: string) => new Set(tokenize(text));
function difference(left: Set<string>, right: Set<string>) {
  return [...left].filter((word) => !right.has(word)).length;
}
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main, [role="main"]');
    return {
      url: location.href,
      title: document.title,
      h1: [...document.querySelectorAll<HTMLElement>("h1")].filter((node) => node.checkVisibility()).map((node) => node.innerText.trim()).filter(Boolean),
      text: (main ?? document.body)?.innerText?.trim() ?? "",
      bodyText: document.body?.innerText?.trim() ?? "",
      documentId: (window as typeof window & { __traceSpaDocument?: string }).__traceSpaDocument,
      hasPassword: [...document.querySelectorAll<HTMLElement>('input[type="password"]')].some((node) => node.checkVisibility()),
      links: [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((link) => link.checkVisibility() && !link.download && (!link.target || link.target === "_self" || (link.getAttribute("role") === "button" && /\/jobs?\//i.test(link.pathname)))).map((link) => ({ href: link.href, text: link.innerText.trim() })),
    };
  });
}
function blockedReason(state: Snapshot) {
  const heading = `${state.title}\n${state.h1.join("\n")}\n${state.text.slice(0, 500)}`;
  if (/verify (?:that )?you are (?:a )?human|complete (?:the |a )?captcha|checking your browser|just a moment\.\.\.|access denied|attention required!|enable javascript and cookies to continue/i.test(heading)) return "bot_or_access_challenge";
  if (state.hasPassword || /^(?:sign in|log in|login)(?:\s+(?:to continue|to your account))?$/im.test(`${state.title}\n${state.h1.join("\n")}`)) return "login_required";
  if (/^(?:404|not found|page not found|service unavailable|something went wrong|internal server error)(?:\b|$)/im.test(`${state.title}\n${state.h1.join("\n")}`)) return "error_page";
  return undefined;
}
function safeLinks(state: Snapshot) {
  const current = new URL(state.url);
  const seen = new Set<string>();
  return state.links.filter((link) => {
    let target: URL;
    try { target = new URL(link.href); } catch { return false; }
    if (target.origin !== current.origin || !/^https?:$/.test(target.protocol) || target.href === current.href || seen.has(target.href)) return false;
    if (link.text.length < 3 || link.text.length > 250) return false;
    if (/log.?out|sign.?out|delete|remove|unsubscribe|purchase|checkout|submit|accept|reject|apply(?: now)?|sign.?in|log.?in|register|cookie|privacy|terms|download|join.?talent|introduceyourself|skip to main/i.test(`${target.pathname} ${link.text}`)) return false;
    if (/\.(?:pdf|zip|docx?|xlsx?|png|jpg|svg)(?:$|\?)/i.test(target.pathname)) return false;
    seen.add(target.href);
    return true;
  }).sort((a, b) => {
    const score = (link: { href: string; text: string }) => /\/jobs?\/[^/?#]+/i.test(link.href) ? 10 : /position|openings?|view all|back to/i.test(link.text) ? 4 : /jobs?|careers?/i.test(link.text + link.href) ? 1 : 0;
    return score(b) - score(a);
  });
}

export async function verifyPage(browser: Browser, candidate: SpaCandidate, options: VerifyOptions): Promise<SpaVerification> {
  const id = candidate.id ?? createHash("sha256").update(candidate.url).digest("hex").slice(0, 20);
  const stem = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  const outputDir = path.resolve(options.outputDir, stem);
  await mkdir(outputDir, { recursive: true });
  const result: SpaVerification = {
    id, url: candidate.url, finalUrl: candidate.url, status: "inconclusive", reason: "not_checked", jsDependent: false,
    anchors: { title: "", h1: [] }, metrics: { jsWords: 0, noJsWords: 0, jsOnlyWords: 0, noJsCoverage: 1 }, navigation: { verified: false },
    artifacts: {
      jsText: path.join(outputDir, "js.txt"), noJsText: path.join(outputDir, "nojs.txt"),
      jsHtml: path.join(outputDir, "js.html"), noJsHtml: path.join(outputDir, "nojs.html"),
      navigationText: path.join(outputDir, "navigation.txt"), result: path.join(outputDir, "verification.json"),
    },
  };
  const contexts: BrowserContext[] = [];
  const deadline = Date.now() + (options.timeoutMs ?? 12_000);
  const remaining = () => Math.max(1, deadline - Date.now());
  const settleMs = options.settleMs ?? 1000;
  try {
    const parsed = new URL(candidate.url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only HTTP(S) pages can be verified");
    const [jsContext, noJsContext] = await Promise.all([
      browser.newContext({ javaScriptEnabled: true, viewport: { width: 1365, height: 900 } }),
      browser.newContext({ javaScriptEnabled: false, viewport: { width: 1365, height: 900 } }),
    ]);
    contexts.push(jsContext, noJsContext);
    await jsContext.addInitScript(() => {
      (window as typeof window & { __traceSpaDocument?: string }).__traceSpaDocument = `${Date.now()}-${Math.random()}`;
    });
    const [jsPage, noJsPage] = await Promise.all([jsContext.newPage(), noJsContext.newPage()]);
    await Promise.all([jsPage, noJsPage].map((page) => page.route("**/*", (route) => ["media", "font"].includes(route.request().resourceType()) ? route.abort() : route.continue())));
    const responses = await Promise.allSettled([jsPage, noJsPage].map((page) => page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: Math.min(7000, remaining()) })));
    await jsPage.waitForTimeout(Math.min(settleMs, remaining()));
    let js = await snapshot(jsPage);
    const contentDeadline = deadline - 2500;
    while ((tokenize(js.text).length < 80 || !safeLinks(js).length) && Date.now() < contentDeadline && !blockedReason(js)) {
      await jsPage.waitForTimeout(Math.min(300, contentDeadline - Date.now()));
      js = await snapshot(jsPage);
    }
    if (noJsPage.url() !== js.url) {
      try {
        const response = await noJsPage.goto(js.url, { waitUntil: "domcontentloaded", timeout: Math.min(4000, remaining()) });
        responses[1] = { status: "fulfilled", value: response };
      } catch (reason) { responses[1] = { status: "rejected", reason }; }
    }
    const [noJs, jsHtml, noJsHtml] = await Promise.all([snapshot(noJsPage), jsPage.content(), noJsPage.content()]);
    result.finalUrl = js.url;
    result.noJsFinalUrl = noJs.url;
    result.anchors = { title: js.title, h1: js.h1 };
    await Promise.all([
      writeFile(result.artifacts.jsText, js.text), writeFile(result.artifacts.noJsText, noJs.text),
      writeFile(result.artifacts.jsHtml, jsHtml), writeFile(result.artifacts.noJsHtml, noJsHtml),
      writeFile(path.join(outputDir, "body-js.txt"), js.bodyText), writeFile(path.join(outputDir, "body-nojs.txt"), noJs.bodyText),
    ]);
    if (options.screenshotDir) {
      await mkdir(options.screenshotDir, { recursive: true });
      result.artifacts.jsScreenshot = path.resolve(options.screenshotDir, `${stem}-js.png`);
      result.artifacts.noJsScreenshot = path.resolve(options.screenshotDir, `${stem}-nojs.png`);
      await Promise.all([jsPage.screenshot({ path: result.artifacts.jsScreenshot, timeout: 2000 }), noJsPage.screenshot({ path: result.artifacts.noJsScreenshot, timeout: 2000 })]);
    }
    const jsWords = uniqueWords(js.text);
    const noJsWords = uniqueWords(noJs.text);
    const jsOnlyWords = difference(jsWords, noJsWords);
    result.metrics = { jsWords: tokenize(js.text).length, noJsWords: tokenize(noJs.text).length, jsOnlyWords, noJsCoverage: jsWords.size ? 1 - jsOnlyWords / jsWords.size : 1 };
    const httpFailure = responses.some((response) => response.status === "fulfilled" && response.value && response.value.status() >= 400);
    if (httpFailure) { result.reason = "http_error"; return result; }
    if (responses.some((response) => response.status === "rejected")) { result.reason = "page_load_failed_or_timed_out"; return result; }
    if (js.url !== noJs.url) { result.reason = "javascript_and_nojs_final_url_mismatch"; return result; }
    const blocked = blockedReason(js);
    if (blocked) { result.status = "rejected"; result.reason = blocked; return result; }
    if (result.metrics.jsWords < 80 || jsWords.size < 50 || (!js.h1.length && !js.title.trim())) {
      result.status = "rejected"; result.reason = "insufficient_useful_content"; return result;
    }
    result.jsDependent = jsOnlyWords >= 50 && result.metrics.noJsCoverage <= 0.25;
    if (!result.jsDependent) { result.status = "rejected"; result.reason = "useful_content_available_without_javascript"; return result; }
    await jsPage.waitForTimeout(Math.min(150, remaining()));
    const stable = await snapshot(jsPage);
    if (stable.url !== js.url || stable.title !== js.title || stable.h1.join("\n") !== js.h1.join("\n") || difference(jsWords, uniqueWords(stable.text)) > jsWords.size * 0.1) {
      result.reason = "initial_content_not_stable"; return result;
    }
    const links = safeLinks(js).slice(0, 3);
    result.reason = links.length ? "no_same_document_content_navigation" : "no_safe_router_link";
    for (const link of links) {
      if (remaining() < 200) break;
      const element = jsPage.locator("a[href]").filter({ visible: true });
      const matching = await element.evaluateAll((nodes, href) => nodes.findIndex((node) => (node as HTMLAnchorElement).href === href), link.href);
      if (matching < 0) continue;
      try {
        await element.nth(matching).click({ timeout: Math.min(2000, remaining()), noWaitAfter: true });
        await jsPage.waitForTimeout(Math.min(Math.max(settleMs, 250), remaining()));
        const navigated = await snapshot(jsPage);
        const documentUnchanged = Boolean(js.documentId && navigated.documentId === js.documentId);
        const afterWords = uniqueWords(navigated.text);
        const changedWords = difference(afterWords, jsWords) + difference(jsWords, afterWords);
        const contentChanged = afterWords.size >= 25 && changedWords >= 20 && changedWords / Math.max(jsWords.size, afterWords.size) >= 0.2;
        result.navigation = { verified: false, fromUrl: js.url, toUrl: navigated.url, linkText: link.text, documentUnchanged, contentChanged };
        await writeFile(result.artifacts.navigationText, navigated.text);
        if (documentUnchanged && navigated.url !== js.url && contentChanged && !blockedReason(navigated)) {
          result.navigation.verified = true;
          result.status = "verified";
          result.reason = "js_dependent_content_and_same_document_navigation";
          break;
        }
        if (!documentUnchanged) break;
      } catch { result.reason = "router_navigation_failed_or_timed_out"; }
    }
    return result;
  } catch (error) {
    result.reason = `verification_error: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await writeFile(result.artifacts.result, JSON.stringify(result, null, 2));
  }
}
