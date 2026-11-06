import {
  pgSchema,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  doublePrecision,
  index,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";
import type { RunSummary, WikipediaProvenance } from "./types";
export const schema = pgSchema("scraping_bench");
const bytes = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
export const runs = schema.table("runs", {
  id: text("id").primaryKey(),
  day: text("day").notNull(),
  protocol: text("protocol").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  summary: jsonb("summary").$type<RunSummary>().notNull(),
});
export const candidates = schema.table(
  "candidates",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    organization: text("organization").notNull(),
    sourceId: text("source_id").notNull(),
    provenance: jsonb("provenance").$type<WikipediaProvenance>(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("candidate_category_idx").on(t.category, t.discoveredAt)],
);
export const seen = schema.table("seen", {
  id: text("id").primaryKey(),
  day: text("day").notNull(),
});
export const attempts = schema.table(
  "attempts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    day: text("day").notNull(),
    pageId: text("page_id").notNull(),
    provider: text("provider").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    provenance: jsonb("provenance").$type<WikipediaProvenance>(),
    state: text("state").notNull(),
    claim: text("claim"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    elapsedMs: integer("elapsed_ms"),
    httpStatus: integer("http_status"),
    error: text("error"),
    success: boolean("success"),
    content: text("content"),
    identity: text("identity"),
    confidence: doublePrecision("confidence"),
    chars: integer("chars"),
    hash: text("hash"),
    evidence: bytes("evidence"),
    evidenceBytes: integer("evidence_bytes").notNull().default(0),
    judgeCalls: integer("judge_calls").notNull().default(0),
    credits: doublePrecision("credits"),
    costUsd: doublePrecision("cost_usd"),
    finalUrl: text("final_url"),
  },
  (t) => [
    index("attempt_queue_idx").on(t.state, t.day),
    index("attempt_day_idx").on(t.day, t.provider),
  ],
);
// Grades produced after collection: v6 access regrades of older samples and
// separate document/content-quality grades. Collection grades stay untouched.
export const grades = schema.table(
  "grades",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    rubric: text("rubric").notNull(),
    success: boolean("success"),
    access: text("access"),
    content: text("content"),
    identity: text("identity"),
    confidence: doublePrecision("confidence"),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    gradedAt: timestamp("graded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("grade_run_idx").on(t.runId, t.rubric)],
);
// Human labels for a random sample of judged pages, used to publish how often
// people agree with the automated judge.
export const audits = schema.table(
  "audits",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id").notNull(),
    runId: text("run_id").notNull(),
    provider: text("provider").notNull(),
    rubric: text("rubric").notNull(),
    label: text("label").notNull(),
    reviewer: text("reviewer").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("audit_run_idx").on(t.runId, t.rubric)],
);
export const sources = schema.table("sources", {
  id: text("id").primaryKey(),
  nextPoll: timestamp("next_poll", { withTimezone: true }).notNull(),
  lastPoll: timestamp("last_poll", { withTimezone: true }),
  count: integer("count").default(0).notNull(),
  error: text("error"),
});
export const budgets = schema.table(
  "budgets",
  {
    day: text("day").notNull(),
    bucket: text("bucket").notNull(),
    used: integer("used").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.bucket] })],
);
export const worker = schema.table("worker", {
  id: text("id").primaryKey(),
  claim: text("claim"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastTick: timestamp("last_tick", { withTimezone: true }),
  error: text("error"),
});
