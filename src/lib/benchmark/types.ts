export const providers = [
  {
    id: "context",
    name: "context.dev",
    color: "var(--color-provider-context)",
    logo: "/logos/context-mark.svg",
  },
  {
    id: "exa",
    name: "Exa",
    color: "var(--color-provider-exa)",
    logo: "/logos/exa.svg",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    color: "var(--color-provider-firecrawl)",
    logo: "/logos/firecrawl.png",
  },
  {
    id: "keenable",
    name: "Keenable",
    color: "var(--color-provider-keenable)",
    logo: "/logos/keenable.png",
  },
] as const;
export const categories = [
  { id: "news", name: "News" },
  { id: "commerce", name: "Commerce" },
  { id: "jobs", name: "Jobs" },
  { id: "finance_filings", name: "Finance" },
  { id: "research", name: "Research" },
  { id: "legal_regulatory", name: "Legal & government" },
  { id: "software_docs", name: "Software & docs" },
  { id: "community_social", name: "Community" },
] as const;
export type Provider = (typeof providers)[number]["id"];
export type Target = { url: string; title: string; category: string };
export type WikipediaProvenance = {
  source: "wikipedia";
  article: string;
  revision: number;
  timestamp: string;
};
export type Candidate = Target & {
  id: string;
  organization: string;
  sourceId: string;
  discoveredAt: Date;
  provenance?: WikipediaProvenance | null;
};
export type Receipt = {
  text: string;
  chars: number;
  hash: string;
  elapsedMs: number;
  httpStatus: number | null;
  error: string | null;
  success: boolean | null;
  credits: number | null;
  costUsd: number | null;
  finalUrl: string | null;
};
export type Grade = {
  inputTokens: number | null;
  success: boolean | null;
  content: string;
  identity: string | null;
  confidence: number | null;
  error: string | null;
};
export type ProviderMetric = {
  id: string;
  total: number;
  useful: number;
  failed: number;
  unknown: number;
  pending: number;
  rate: number | null;
  /** Half-width of the 95% confidence interval for `rate`. Absent in older summaries. */
  ci?: number | null;
  p50: number | null;
  p90?: number | null;
  p95: number | null;
  p99?: number | null;
  rateLimited: number;
  /** Requests rejected by our own account limits; excluded from `rate`. */
  excluded?: number;
  categories: Record<
    string,
    { total: number; useful: number; unknown: number; completed: number }
  >;
};
export type RunSummary = {
  id: string;
  day: string;
  protocol: string;
  status: string;
  pages: number;
  target: number;
  finishedAt: string | null;
  providers: ProviderMetric[];
  categories: Record<string, number>;
};
export type AuditSummary = {
  rubric: string;
  pages: number;
  agreed: number;
  reviewers: number;
  since: string | null;
};
export type Report = {
  collecting: RunSummary | null;
  latest: RunSummary | null;
  history: RunSummary[];
  /** Every run, including extra runs on days that have more than one. */
  runs?: { id: string; day: string; protocol: string; status: string; createdAt: string; charted: boolean }[];
  audits?: AuditSummary[];
  health: {
    lastTick: string | null;
    error: string | null;
    sources: number;
    healthySources: number;
    evidenceBytes: number;
  };
  records: PublicResult[];
  totalRecords: number;
  page: number;
};
export type PublicResult = {
  id: string;
  url: string;
  category: string;
  provider: string;
  state: string;
  success: boolean | null;
  elapsedMs: number | null;
  error: string | null;
  content: string | null;
  identity: string | null;
  chars: number | null;
  hash: string | null;
  day: string;
};
export const ACCESS_PROTOCOL = "scraping-bench-v6";
export const PROTOCOL = ACCESS_PROTOCOL;
