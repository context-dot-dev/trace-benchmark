// Pure, client-safe statistics computed from page-level outcomes. Every number on the page comes
// from these functions, so filters change every section consistently.
import { providers, type Provider, type ProviderMetric, type RunSummary } from "./types";
import type { BenchmarkPage, PageOutcome } from "./combined";
import {
  failureReason,
  failureReasons,
  hostOf,
  isAccountLimited,
  NOT_SCORED_ERRORS,
  type FailureReason,
} from "./outcomes";
import pricing from "../../../config/pricing.json";

export type ProviderId = Provider;
const ids = providers.map((p) => p.id) as ProviderId[];

/** A result that counts toward the provider's score. */
export const scored = (o: PageOutcome | undefined): o is PageOutcome =>
  !!o && !isAccountLimited(o.error);
const done = (o: PageOutcome | undefined): o is PageOutcome =>
  scored(o) && o.state === "done";

export function quantile(sorted: number[], p: number) {
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
}
const median = (values: number[]) => quantile([...values].sort((a, b) => a - b), 0.5);

// ---------------------------------------------------------------------------------------------
// Significance

function logChoose(n: number, k: number) {
  let sum = 0;
  for (let i = 1; i <= k; i++) sum += Math.log((n - k + i) / i);
  return sum;
}
/** Two-sided exact McNemar (binomial) p-value for discordant counts b and c. */
export function mcnemarP(b: number, c: number) {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  if (n > 2000) {
    const z = (Math.abs(b - c) - 1) / Math.sqrt(n);
    return Math.min(1, 2 * (1 - normalCdf(z)));
  }
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}
function normalCdf(z: number) {
  // Abramowitz and Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
export const ALPHA = 0.05;

// ---------------------------------------------------------------------------------------------
// Head-to-head

export type Pair = {
  a: ProviderId;
  b: ProviderId;
  /** Pages a accessed and b did not. */
  aOnly: number;
  /** Pages b accessed and a did not. */
  bOnly: number;
  shared: number;
  p: number;
  winner: ProviderId | null;
};
export function pairwise(pages: BenchmarkPage[], success = isSuccess): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      let aOnly = 0, bOnly = 0, shared = 0;
      for (const page of pages) {
        const ra = page.results[a], rb = page.results[b];
        if (!done(ra) || !done(rb)) continue;
        shared++;
        const sa = success(ra), sb = success(rb);
        if (sa && !sb) aOnly++;
        else if (sb && !sa) bOnly++;
      }
      const p = mcnemarP(aOnly, bOnly);
      pairs.push({ a, b, aOnly, bOnly, shared, p, winner: p < ALPHA ? (aOnly > bOnly ? a : b) : null });
    }
  return pairs;
}
export function pairBetween(pairs: Pair[], a: ProviderId, b: ProviderId) {
  const pair = pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  if (!pair) return null;
  return pair.a === a ? pair : { ...pair, a: pair.b, b: pair.a, aOnly: pair.bOnly, bOnly: pair.aOnly };
}
const isSuccess = (o: PageOutcome) => o.success === true;

/** Places that respect ties: a provider shares the place above unless a paired test separates them. */
export function places(rows: ProviderMetric[], pairs: Pair[]) {
  const ranked = [...rows].filter((r) => r.rate != null).sort((x, y) => (y.rate ?? 0) - (x.rate ?? 0));
  const result = new Map<string, { place: number; tied: boolean }>();
  ranked.forEach((row, index) => {
    if (index === 0) return result.set(row.id, { place: 1, tied: false });
    const above = ranked[index - 1];
    const pair = pairBetween(pairs, above.id as ProviderId, row.id as ProviderId);
    const separated = pair?.winner === above.id;
    const place = separated ? index + 1 : result.get(above.id)!.place;
    if (!separated) result.set(above.id, { ...result.get(above.id)!, tied: true });
    result.set(row.id, { place, tied: !separated });
  });
  return result;
}

// ---------------------------------------------------------------------------------------------
// Categories

export type CategoryResult = {
  id: string;
  pages: number;
  rates: Partial<Record<ProviderId, number | null>>;
  nobody: number;
  leader: ProviderId | null;
  runnerUp: ProviderId | null;
  verdict: "leads" | "tied" | "none";
  p: number | null;
};
export function categoryResults(pages: BenchmarkPage[], categoryIds: string[]): CategoryResult[] {
  return categoryIds.map((id) => {
    const group = pages.filter((p) => p.category === id);
    const rates = Object.fromEntries(
      ids.map((provider) => {
        const outcomes = group.map((p) => p.results[provider]).filter(scored);
        return [provider, outcomes.length ? outcomes.filter((o) => o.success === true).length / outcomes.length : null];
      }),
    ) as Partial<Record<ProviderId, number | null>>;
    const nobody = group.filter((page) =>
      ids.every((provider) => {
        const o = page.results[provider];
        return done(o) && o.success !== true;
      }),
    ).length;
    const order = ids.filter((p) => rates[p] != null).sort((x, y) => (rates[y] ?? 0) - (rates[x] ?? 0));
    const [leader, runnerUp] = order;
    if (!leader || !runnerUp) return { id, pages: group.length, rates, nobody, leader: leader ?? null, runnerUp: null, verdict: "none", p: null };
    const pair = pairBetween(pairwise(group), leader, runnerUp);
    const wins = pair?.winner === leader;
    return { id, pages: group.length, rates, nobody, leader, runnerUp, verdict: wins ? "leads" : "tied", p: pair?.p ?? null };
  });
}

// ---------------------------------------------------------------------------------------------
// Latency

export type Latency = {
  id: ProviderId;
  n: number;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  successP50: number | null;
  successP95: number | null;
  timeouts: number;
  timeoutRate: number | null;
};
export function latency(pages: BenchmarkPage[]): Latency[] {
  return ids.map((id) => {
    const outcomes = pages.map((p) => p.results[id]).filter(done);
    const timed = outcomes
      .filter((o) => o.ms != null && !(o.error && NOT_SCORED_ERRORS.has(o.error)))
      .map((o) => o.ms!)
      .sort((a, b) => a - b);
    const ok = outcomes.filter((o) => o.success === true && o.ms != null).map((o) => o.ms!).sort((a, b) => a - b);
    const timeouts = outcomes.filter((o) => failureReason(o) === "timeout").length;
    return {
      id,
      n: timed.length,
      p50: quantile(timed, 0.5),
      p90: quantile(timed, 0.9),
      p95: quantile(timed, 0.95),
      p99: quantile(timed, 0.99),
      successP50: quantile(ok, 0.5),
      successP95: quantile(ok, 0.95),
      timeouts,
      timeoutRate: outcomes.length ? timeouts / outcomes.length : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Failures

export type Failures = { id: ProviderId; total: number; failed: number; reasons: Record<FailureReason, number> };
export function failures(pages: BenchmarkPage[]): Failures[] {
  return ids.map((id) => {
    const outcomes = pages.map((p) => p.results[id]).filter(scored);
    const reasons = Object.fromEntries(failureReasons.map((r) => [r.id, 0])) as Record<FailureReason, number>;
    let failed = 0;
    for (const o of outcomes) {
      const reason = failureReason({ ...o, elapsedMs: o.ms });
      if (!reason) continue;
      reasons[reason]++;
      failed++;
    }
    return { id, total: outcomes.length, failed, reasons };
  });
}

// ---------------------------------------------------------------------------------------------
// Quality funnel and signals

export type Funnel = {
  id: ProviderId;
  n: number;
  returned: number;
  accessed: number | null;
  rightPage: number | null;
  substantive: number | null;
  /** Pages with a document/content grade; the last two stages are based on these. */
  graded: number;
};
export function funnel(pages: BenchmarkPage[], accessProtocol: boolean): Funnel[] {
  const isGraded = (o: PageOutcome | undefined) => o?.quality != null && o?.identity != null;
  const anyGraded = pages.some((p) => ids.some((id) => isGraded(p.results[id])));
  // Document and content grades exist only for collected daily pages (which also have timings),
  // not for the archived study. When grades exist, every stage uses the daily pages only.
  const pool = anyGraded ? pages.filter((p) => ids.some((id) => p.results[id]?.ms != null)) : pages;
  return ids.map((id) => {
    const outcomes = pool.map((p) => p.results[id]).filter(done);
    const n = outcomes.length;
    const returned = outcomes.filter((o) => !o.error).length;
    const accessLabel = (o: PageOutcome) => (accessProtocol ? o.access : o.access ?? null);
    const hasAccess = outcomes.some((o) => accessLabel(o) != null);
    const accessed = hasAccess ? outcomes.filter((o) => accessLabel(o) === "accessed").length : null;
    const graded = outcomes.filter(isGraded);
    const loaded = (o: PageOutcome) =>
      accessLabel(o) != null ? accessLabel(o) === "accessed" : !o.error && o.quality !== "blocked" && o.quality !== "error";
    const rightPage = graded.length ? outcomes.filter((o) => loaded(o) && o.identity === "match").length : null;
    const substantive = graded.length
      ? outcomes.filter((o) => loaded(o) && o.identity === "match" && o.quality === "substantive").length
      : null;
    return { id, n, returned, accessed, rightPage, substantive, graded: graded.length };
  });
}

export type QualitySignals = {
  id: ProviderId;
  /** Share of accessed pages where the provider ended on a different page. */
  redirectRate: number | null;
  redirectKnown: number;
  /** Median characters returned for successful pages. */
  medianChars: number | null;
  /** Median of this provider's length divided by the median length across providers on the same page. */
  lengthRatio: number | null;
};
export function qualitySignals(pages: BenchmarkPage[]): QualitySignals[] {
  const pageMedians = new Map<string, number>();
  for (const page of pages) {
    const lengths = ids.map((id) => page.results[id]).filter((o) => o?.success === true && o.chars).map((o) => o!.chars!);
    if (lengths.length >= 2) pageMedians.set(page.id, median(lengths)!);
  }
  return ids.map((id) => {
    const ok = pages.filter((p) => p.results[id]?.success === true);
    const known = ok.filter((p) => p.results[id]?.moved != null);
    const ratios = ok
      .filter((p) => pageMedians.has(p.id) && p.results[id]?.chars)
      .map((p) => p.results[id]!.chars! / pageMedians.get(p.id)!);
    return {
      id,
      redirectRate: known.length ? known.filter((p) => p.results[id]!.moved).length / known.length : null,
      redirectKnown: known.length,
      medianChars: median(ok.map((p) => p.results[id]!.chars ?? 0).filter(Boolean)),
      lengthRatio: median(ratios),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Cost

export type PriceEntry = {
  plan: string;
  price: string;
  per1k: number;
  billsFailures: boolean | null;
  source: string;
};
export const prices = pricing as { checked: string; note: string; providers: Record<ProviderId, PriceEntry> };
export type Cost = { id: ProviderId; per1k: number; rate: number | null; perAccessed1k: number | null; assumed: boolean };
export function cost(rows: ProviderMetric[]): Cost[] {
  return ids.map((id) => {
    const entry = prices.providers[id];
    const rate = rows.find((r) => r.id === id)?.rate ?? null;
    // When failures are not billed, a provider pays only for pages it returned.
    const perAccessed1k = rate ? (entry.billsFailures === false ? entry.per1k : entry.per1k / rate) : null;
    return { id, per1k: entry.per1k, rate, perAccessed1k, assumed: entry.billsFailures == null };
  });
}

// ---------------------------------------------------------------------------------------------
// Deeper looks: sites, failure detail, latency budgets, fallbacks, and clustered uncertainty

/** A completed, timed request that counts toward latency, matching `latency()`. */
const timedMs = (o: PageOutcome | undefined) =>
  done(o) && o.ms != null && !(o.error && NOT_SCORED_ERRORS.has(o.error)) ? o.ms : null;
const failed = (o: PageOutcome | undefined): o is PageOutcome =>
  done(o) && failureReason({ ...o, elapsedMs: o.ms }) != null;
const succeeded = (o: PageOutcome | undefined) => scored(o) && o.success === true;
const sortedNumbers = (values: (number | null)[]) =>
  values.filter((v): v is number => v != null).sort((a, b) => a - b);

export type SiteProvider = {
  /** Scored results on this site. */
  n: number;
  rate: number | null;
  p50: number | null;
  p95: number | null;
  failed: number;
  /** The most common failure reason on this site, if any page failed. */
  topReason: FailureReason | null;
};
export type SiteResult = {
  host: string;
  pages: number;
  /** The category most of this site's pages belong to. */
  category: string;
  /** Pages no provider could read. */
  nobody: number;
  /** Highest minus lowest provider rate on this site: large values mark sites that separate providers. */
  spread: number | null;
  /** Slowest minus fastest provider median on this site. */
  latencyGap: number | null;
  providers: Record<ProviderId, SiteProvider>;
};
/** Success and latency per site (hostname without "www."), largest sites first. */
export function sites(pages: BenchmarkPage[], minPages = 1): SiteResult[] {
  const groups = new Map<string, BenchmarkPage[]>();
  for (const page of pages) {
    const host = hostOf(page.url);
    groups.set(host, [...(groups.get(host) ?? []), page]);
  }
  const out: SiteResult[] = [];
  for (const [host, group] of groups) {
    if (group.length < minPages) continue;
    const categoryCounts = new Map<string, number>();
    for (const p of group) categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);
    const providerRows = Object.fromEntries(
      ids.map((id) => {
        const outcomes = group.map((p) => p.results[id]).filter(scored);
        const ms = sortedNumbers(outcomes.map(timedMs));
        const reasons = new Map<FailureReason, number>();
        for (const o of outcomes) {
          const reason = failureReason({ ...o, elapsedMs: o.ms });
          if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        }
        const fails = [...reasons.values()].reduce((a, b) => a + b, 0);
        const row: SiteProvider = {
          n: outcomes.length,
          rate: outcomes.length ? outcomes.filter((o) => o.success === true).length / outcomes.length : null,
          p50: quantile(ms, 0.5),
          p95: quantile(ms, 0.95),
          failed: fails,
          topReason: [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        };
        return [id, row];
      }),
    ) as Record<ProviderId, SiteProvider>;
    const rates = ids.map((id) => providerRows[id].rate).filter((v): v is number => v != null);
    const medians = ids.map((id) => providerRows[id].p50).filter((v): v is number => v != null);
    out.push({
      host,
      pages: group.length,
      category: [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0][0],
      nobody: group.filter((p) => ids.every((id) => failed(p.results[id]))).length,
      spread: rates.length > 1 ? Math.max(...rates) - Math.min(...rates) : null,
      latencyGap: medians.length > 1 ? Math.max(...medians) - Math.min(...medians) : null,
      providers: providerRows,
    });
  }
  return out.sort((a, b) => b.pages - a.pages || a.host.localeCompare(b.host));
}

/** A readable label for the raw signal behind a failure: the provider's error code or the judge's label. */
export function failureSignal(o: PageOutcome) {
  if (o.error) return o.error;
  if (o.access === "not_accessed") return "judge: not accessed";
  if (o.quality && o.quality !== "substantive") return `judge: ${o.quality}`;
  if (o.identity === "wrong_target") return "judge: wrong page";
  if (o.identity && o.identity !== "match") return `judge: page ${o.identity}`;
  if (o.success === false) return "judge: failed";
  return "judge: unresolved";
}

export type FailureDetail = {
  id: ProviderId;
  /** Completed, scored results. */
  total: number;
  failed: number;
  /** Failed pages at least one other provider read: the provider's own headroom. */
  recoverable: number;
  /** Failed pages every other provider read. */
  exclusive: number;
  /** Failed pages no provider read: likely gone, gated, or hostile to every scraper. */
  universal: number;
  /** Raw error codes and judge labels, most common first. */
  signals: { signal: string; count: number }[];
  /** Failure share per category, worst first. */
  categories: { id: string; failed: number; total: number }[];
  /** Sites with the most failures for this provider. */
  hosts: { host: string; failed: number; pages: number; recoverable: number }[];
  /** Share of failures coming from the five sites with the most failures. */
  concentration: number | null;
  /** Median time spent on a failed request. */
  failedP50: number | null;
};
export function failureDetail(pages: BenchmarkPage[]): FailureDetail[] {
  return ids.map((id) => {
    const others = ids.filter((o) => o !== id);
    let total = 0, count = 0, recoverable = 0, exclusive = 0, universal = 0;
    const signals = new Map<string, number>();
    const cats = new Map<string, { failed: number; total: number }>();
    const hosts = new Map<string, { failed: number; pages: number; recoverable: number }>();
    const failedMs: number[] = [];
    for (const page of pages) {
      const o = page.results[id];
      if (!done(o)) continue;
      total++;
      const host = hostOf(page.url);
      const h = hosts.get(host) ?? { failed: 0, pages: 0, recoverable: 0 };
      const c = cats.get(page.category) ?? { failed: 0, total: 0 };
      h.pages++;
      c.total++;
      if (failed(o)) {
        count++;
        c.failed++;
        h.failed++;
        const otherResults = others.map((x) => page.results[x]).filter(done);
        const anyOther = otherResults.some((x) => x.success === true);
        if (anyOther) {
          recoverable++;
          h.recoverable++;
        } else universal++;
        if (otherResults.length === others.length && otherResults.every((x) => x.success === true)) exclusive++;
        const signal = failureSignal(o);
        signals.set(signal, (signals.get(signal) ?? 0) + 1);
        if (o.ms != null) failedMs.push(o.ms);
      }
      hosts.set(host, h);
      cats.set(page.category, c);
    }
    const hostRows = [...hosts.entries()]
      .map(([host, h]) => ({ host, ...h }))
      .filter((h) => h.failed > 0)
      .sort((a, b) => b.failed - a.failed || a.host.localeCompare(b.host));
    const top = hostRows.slice(0, 5).reduce((sum, h) => sum + h.failed, 0);
    return {
      id,
      total,
      failed: count,
      recoverable,
      exclusive,
      universal,
      signals: [...signals.entries()].map(([signal, n]) => ({ signal, count: n })).sort((a, b) => b.count - a.count),
      categories: [...cats.entries()]
        .map(([cat, c]) => ({ id: cat, ...c }))
        .sort((a, b) => b.failed / (b.total || 1) - a.failed / (a.total || 1)),
      hosts: hostRows.slice(0, 10),
      concentration: count ? top / count : null,
      failedP50: median(failedMs),
    };
  });
}

/** Time budgets, in milliseconds, for "useful within a deadline". */
export const BUDGETS_MS = [1_000, 2_000, 5_000, 10_000] as const;
export type BudgetResult = {
  id: ProviderId;
  n: number;
  rates: (number | null)[];
  /** Share of the same timed requests that succeeded at any speed. */
  any: number | null;
};
/**
 * Share of timed requests that both succeeded and returned within each budget. An agent with a
 * fixed time budget experiences this rate, not the unconstrained success rate.
 */
export function withinBudget(pages: BenchmarkPage[], budgets: readonly number[] = BUDGETS_MS): BudgetResult[] {
  return ids.map((id) => {
    const timed = pages.map((p) => p.results[id]).filter((o): o is PageOutcome => timedMs(o) != null);
    return {
      id,
      n: timed.length,
      rates: budgets.map((b) => (timed.length ? timed.filter((o) => o.success === true && o.ms! <= b).length / timed.length : null)),
      any: timed.length ? timed.filter((o) => o.success === true).length / timed.length : null,
    };
  });
}

export type LatencyByCategory = { id: string; providers: Record<ProviderId, { n: number; p50: number | null; p95: number | null }> };
export function latencyByCategory(pages: BenchmarkPage[], categoryIds: string[]): LatencyByCategory[] {
  return categoryIds.map((category) => {
    const group = pages.filter((p) => p.category === category);
    return {
      id: category,
      providers: Object.fromEntries(
        ids.map((id) => {
          const ms = sortedNumbers(group.map((p) => timedMs(p.results[id])));
          return [id, { n: ms.length, p50: quantile(ms, 0.5), p95: quantile(ms, 0.95) }];
        }),
      ) as LatencyByCategory["providers"],
    };
  });
}

export type Fallback = { a: ProviderId; b: ProviderId; pages: number; aRate: number; bRate: number; rate: number };
/**
 * What a two-provider fallback would reach: a page counts if either provider read it. Rates are
 * shares of pages both providers completed, not category-weighted scores. `ceiling` is the share
 * of pages at least one of the four providers read.
 */
export function fallbacks(pages: BenchmarkPage[]): { ceiling: number | null; pages: number; pairs: Fallback[] } {
  const pairs: Fallback[] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      let n = 0, sa = 0, sb = 0, either = 0;
      for (const page of pages) {
        const ra = page.results[a], rb = page.results[b];
        if (!done(ra) || !done(rb)) continue;
        n++;
        const x = ra.success === true, y = rb.success === true;
        if (x) sa++;
        if (y) sb++;
        if (x || y) either++;
      }
      if (n) pairs.push({ a, b, pages: n, aRate: sa / n, bRate: sb / n, rate: either / n });
    }
  const complete = pages.filter((p) => ids.every((id) => done(p.results[id])));
  return {
    ceiling: complete.length ? complete.filter((p) => ids.some((id) => succeeded(p.results[id]))).length / complete.length : null,
    pages: complete.length,
    pairs: pairs.sort((x, y) => y.rate - x.rate),
  };
}

export type Clustered = {
  id: ProviderId;
  /** 95% CI half-width treating pages from the same site as one cluster. */
  ci: number | null;
  /** The usual CI that treats every page as independent. */
  naiveCi: number | null;
  /** Sites in the sample: the number of independent clusters. */
  sites: number;
  /** Score when every site within a category counts equally, instead of every page. */
  siteWeighted: number | null;
};
/**
 * Pages from one site tend to succeed or fail together, so the usual binomial interval is too
 * narrow when a few sites contribute many pages. This uses a cluster-robust (CR1) variance per
 * category with sites as clusters, combined with the same equal category weights as the score.
 */
export function clustered(pages: BenchmarkPage[], categoryIds: string[]): Clustered[] {
  return ids.map((id) => {
    const counted = pages.filter((p) => !isAccountLimited(p.results[id]?.error));
    let variance = 0, naive = 0, weighted = 0, ok = categoryIds.length > 0;
    const allSites = new Set<string>();
    for (const category of categoryIds) {
      const group = counted.filter((p) => p.category === category);
      if (!group.length) {
        ok = false;
        break;
      }
      const n = group.length;
      const y = group.map((p) => (p.results[id]?.success === true ? 1 : 0));
      const rate = y.reduce<number>((a, b) => a + b, 0) / n;
      const residuals = new Map<string, { sum: number; hits: number; n: number }>();
      group.forEach((p, i) => {
        const host = hostOf(p.url);
        allSites.add(host);
        const r = residuals.get(host) ?? { sum: 0, hits: 0, n: 0 };
        r.sum += y[i] - rate;
        r.hits += y[i];
        r.n++;
        residuals.set(host, r);
      });
      const g = residuals.size;
      const correction = g > 1 ? g / (g - 1) : 1;
      variance += (correction * [...residuals.values()].reduce((s, r) => s + r.sum * r.sum, 0)) / (n * n);
      naive += (rate * (1 - rate)) / n;
      weighted += [...residuals.values()].reduce((s, r) => s + r.hits / r.n, 0) / g;
    }
    const k = categoryIds.length;
    return {
      id,
      ci: ok ? (1.96 * Math.sqrt(variance)) / k : null,
      naiveCi: ok ? (1.96 * Math.sqrt(naive)) / k : null,
      sites: allSites.size,
      siteWeighted: ok ? weighted / k : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// History

export type Stability = { id: ProviderId; firsts: number; scored: number; mean: number | null };
export function stability(history: RunSummary[]): Stability[] {
  const scoredRuns = history.filter(
    (r) => r.status === "completed" && r.providers.length && r.providers.every((p) => p.rate != null),
  );
  return ids.map((id) => {
    const firsts = scoredRuns.filter((r) => {
      const best = Math.max(...r.providers.map((p) => p.rate ?? 0));
      return r.providers.find((p) => p.id === id)?.rate === best;
    }).length;
    const rates = scoredRuns.map((r) => r.providers.find((p) => p.id === id)?.rate).filter((v): v is number => v != null);
    return { id, firsts, scored: scoredRuns.length, mean: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null };
  });
}

// ---------------------------------------------------------------------------------------------
// Plain-language findings, generated from the numbers so the copy never drifts from the data.

const name = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const sec = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`);
export function list(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")}${items.length > 2 ? "," : ""} and ${items.at(-1)}`;
}

/** Category names in running text: lowercase, except proper nouns such as Wikipedia. */
const phrase = (label: string) =>
  label.replace(/&/g, "and").replace(/^(\w)(\w*)/, (_, first: string, rest: string) => (label.startsWith("Wikipedia") ? first : first.toLowerCase()) + rest);
export type Finding = { lead: string; detail: string };
export function findings(input: {
  rows: ProviderMetric[];
  pairs: Pair[];
  categories: CategoryResult[];
  categoryName: (id: string) => string;
  latency: Latency[];
  measure: string;
  pages: number;
}): Finding[] {
  const out: Finding[] = [];
  const ranked = [...input.rows].filter((r) => r.rate != null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const [first, second] = ranked;
  if (first && second) {
    const pair = pairBetween(input.pairs, first.id as ProviderId, second.id as ProviderId);
    const gap = ((first.rate ?? 0) - (second.rate ?? 0)) * 100;
    out.push({
      lead: `${name(first.id)} ${input.measure} the most pages, ${pct(first.rate)}.`,
      detail: pair?.winner === first.id
        ? `It led ${name(second.id)} by ${gap.toFixed(1)} points across ${input.pages.toLocaleString("en-US")} shared pages, a statistically significant gap.`
        : `Its ${gap.toFixed(1)}-point lead over ${name(second.id)} is within the margin of error, so they share first place.`,
    });
  }
  const leads = new Map<string, string[]>();
  const tied: string[] = [];
  for (const c of input.categories) {
    if (c.verdict === "leads" && c.leader) leads.set(c.leader, [...(leads.get(c.leader) ?? []), input.categoryName(c.id)]);
    else if (c.verdict === "tied") tied.push(input.categoryName(c.id));
  }
  if (input.categories.length > 1) {
    const parts = [...leads.entries()].sort((a, b) => b[1].length - a[1].length);
    const [top, ...rest] = parts;
    out.push({
      lead: top ? `${name(top[0])} leads in ${list(top[1].map(phrase))}.` : "No provider leads any category outright.",
      detail: [
        ...rest.map(([id, cats]) => `${name(id)} leads in ${list(cats.map(phrase))}.`),
        tied.length ? `The top two are statistically tied in ${tied.length === 1 ? "one category" : `${tied.length} categories`}.` : "",
      ].filter(Boolean).join(" "),
    });
  }
  const fastest = [...input.latency].filter((l) => l.p50 != null).sort((a, b) => a.p50! - b.p50!)[0];
  const tail = [...input.latency].filter((l) => l.p95 != null).sort((a, b) => a.p95! - b.p95!)[0];
  if (fastest && tail)
    out.push({
      lead: `${name(fastest.id)} answers fastest at the median, ${sec(fastest.p50)}.`,
      detail: fastest.id === tail.id
        ? `It also has the shortest slow tail: 95% of its requests finish within ${sec(tail.p95)}.`
        : `${name(tail.id)} has the shortest slow tail: 95% of its requests finish within ${sec(tail.p95)}.`,
    });
  const nobody = input.categories.reduce((sum, c) => sum + c.nobody, 0);
  if (nobody > 0) {
    const worst = [...input.categories].sort((a, b) => b.nobody - a.nobody).filter((c) => c.nobody > 0).slice(0, 3);
    out.push({
      lead: `${nobody.toLocaleString("en-US")} ${nobody === 1 ? "page" : "pages"} defeated every provider.`,
      detail: `Most came from ${list(worst.map((c) => phrase(input.categoryName(c.id))))} pages.`,
    });
  }
  return out;
}
