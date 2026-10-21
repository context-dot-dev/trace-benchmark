export type Provider = { id: string; name: string; status: string; status_detail: string | null };

export type Category = { id: string; label: string };

export type Billing = {
  low: number | null;
  high: number | null;
  reported: number;
  estimated: number;
  documented: number;
  modeled: number;
  unknown: number;
  unavailable: number;
  count: number;
};

export type ProviderRow = Provider & {
  attempted: number;
  measuredAttempts: number;
  attemptedUsefulRate: number | null;
  accountRejected: number;
  creditsRejected: number;
  accountSkipped: number;
  accountAffected: number;
  bestObserved: number;
  compared: number;
  bestRate: number | null;
  soleUseful: number;
  costPerUseful: number | null;
  count: number;
  observed: number;
  success: number;
  failed: number;
  unknown: number;
  rate: number | null;
  upper: number | null;
  p50: number | null;
  p95: number | null;
  timed: number;
  cost_usd: number | null;
  cost_known: number;
  credits: number | null;
  credits_known: number;
  billing?: Billing | null;
  balanced?: boolean;
  categoriesPresent?: number;
  unresolvedCauses?: Record<string, number>;
  freshness?: { requested: number; reportedFresh: number; reportedCached: number; unreported: number };
};

export type PageTypeResult = { rate: number | null; success: number; count: number };
export type PageTypeGroup = { id: string; results: Record<string, PageTypeResult> };

export type Pair = {
  a: Provider;
  b: Provider;
  count: number;
  both: number;
  first_only: number;
  second_only: number;
  neither: number;
  unknown: number;
};

export type Comparisons = {
  resolved: number;
  single_source: number;
  no_useful_output: number;
  incomplete: number;
  unresolved: number;
  pending_budget: number;
  dispatched: number;
  pending: number;
};

export type SamplingCategory = { first_time: number; repeated: number; selected: number; shortfall: number | null; target: number | null };
export type SamplingRole = { selected: number; target: number; shortfall: number; categories: Record<string, { selected: number; shortfall: number | null }> };

export type Sampling = {
  kind: string;
  categories: Record<string, SamplingCategory>;
  control_panel: { version: string; starts_at: string; expires_at: string; replaces: string | null } | null;
  first_time_urls: number;
  repeated_urls: number;
  parent_run_id: string | null;
  publication_age: { future: number; older_than_seven_days: number; one_to_seven_days: number; unknown: number; within_24h: number };
  roles: { new: SamplingRole; control: SamplingRole } | null;
  sample_design: unknown;
  shortfall: number | null;
  target: number | null;
};

export type Run = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  cohort: string;
  selected_count: number;
  observed_count?: number;
  judged_count?: number;
  manifest_url: string;
  exclusion: { reason: string } | null;
  sampling: Sampling | null;
};

export type Cohort = {
  sampleRole: "new" | "control" | null;
  sampleKind: string;
  uniqueUrls: number;
  domains: number;
  latestRun: Run | null;
  lastCompleted: Run | null;
  tasks: number;
  count: number;
  categories: number;
  first: string | null;
  last: string | null;
  comparisons: Comparisons;
  references: number;
  rows: ProviderRow[];
  pageTypes: PageTypeGroup[];
  pairs: Pair[];
};

export type DailyPoint = {
  day: string;
  cohort: string;
  provider: string;
  success_rate: number | null;
  pages: number;
  sample_kind?: string;
  sample_role?: "new" | "control";
  categories_present?: number;
  control_panel_version?: string | null;
  run_id?: string;
};

export type ReplenishmentDay = {
  day: string;
  baseline_urls: number;
  new_urls: number;
  polls: number;
  failed_polls: number;
  categories: Record<string, number>;
};

export type Summary = {
  schema_version: number;
  version: string;
  generated_at: string;
  rendered_at?: string;
  protocol_version: string;
  providers: Provider[];
  categories: Category[];
  cohorts: Record<string, Cohort | undefined>;
  runs: Run[];
  operations?: {
    last_tick?: { errors?: unknown[]; started_at?: string; finished_at?: string | null };
    scheduler_status?: string;
    next_run_at?: string;
    collection_profile?: { cadence?: string; daily_per_category?: number };
    capacity_plan?: { eligible_selection?: number };
  };
  metrics?: { daily?: DailyPoint[]; sample_daily?: DailyPoint[] };
  replenishment?: { days: ReplenishmentDay[] };
  supply?: Record<string, { domains: number; inventory: number; new_24h: number }>;
  sourceHealth?: { healthy: number; total: number };
};

export type CohortId = "independent" | "needle";
export type SampleRole = "new" | "control";

export type ResultRecord = {
  id: string;
  title: string | null;
  url: string | null;
  task_id: string;
  domain: string | null;
  source_id: string | null;
  category: string;
  provider: string;
  sample_role: SampleRole | null;
  outcome: string | null;
  content_label: string | null;
  identity_label: string | null;
  success: boolean | null;
  elapsed_ms: number | null;
  text_chars: number | null;
};

export type ResultsPage = { version: string; page: number; total: number; records: ResultRecord[] };

export type ResultDetail = ResultRecord & {
  final_url?: string | null;
  text_preview?: string | null;
  judgment?: unknown;
  [key: string]: unknown;
};

export function isSummary(value: unknown): value is Summary {
  const summary = value as Summary | null;
  return (
    !!summary &&
    summary.schema_version === 2 &&
    typeof summary.version === "string" &&
    Array.isArray(summary.providers) &&
    Array.isArray(summary.runs) &&
    !!summary.cohorts?.independent?.rows &&
    !!summary.cohorts?.needle?.rows
  );
}
