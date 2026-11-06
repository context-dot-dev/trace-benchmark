import { gunzipSync } from "node:zlib";
import { and, desc, eq, getTableColumns, isNotNull, isNull, sql } from "drizzle-orm";
import { attempts, grades, runs } from "./schema";
import { ACCESS_PROTOCOL } from "./types";
import { createReaders, type Readers } from "./providers";
import type { Store } from "./store";

/**
 * Grades added after collection, stored apart from the collection grade:
 * - "access": the reviewed v6 access rubric, applied to samples collected under earlier
 *   protocols so both scores can be compared on identical evidence.
 * - "quality": the document and content rubric (right page, substantive content), applied to
 *   pages that were accessed, so the page can publish quality alongside access.
 */
export type Rubric = "access" | "quality";

export async function gradeCandidates(store: Store, runId: string, rubric: Rubric) {
  const [run] = await store.db.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error("Unknown run " + runId);
  if (rubric === "access" && run.protocol === ACCESS_PROTOCOL)
    return { run, rows: [] as (typeof attempts.$inferSelect)[] };
  const rows = await store.db
    .select(getTableColumns(attempts))
    .from(attempts)
    .leftJoin(grades, and(eq(grades.attemptId, attempts.id), eq(grades.rubric, rubric)))
    .where(
      and(
        eq(attempts.runId, runId),
        eq(attempts.state, "done"),
        isNull(attempts.error),
        isNotNull(attempts.evidence),
        isNull(grades.id),
        // Quality is only meaningful for pages that loaded.
        ...(rubric === "quality" && run.protocol === ACCESS_PROTOCOL ? [eq(attempts.success, true)] : []),
      ),
    )
    .orderBy(attempts.id);
  return { run, rows };
}

export async function gradeRun(
  store: Store,
  options: {
    runId: string;
    rubric: Rubric;
    limit?: number;
    readers?: Readers;
    concurrency?: number;
    requestsPerSecond?: number;
    deadline?: number;
  },
) {
  const { rows } = await gradeCandidates(store, options.runId, options.rubric);
  const batch = rows.slice(0, options.limit && options.limit > 0 ? options.limit : rows.length);
  const readers = options.readers ?? createReaders();
  const protocol = options.rubric === "access" ? ACCESS_PROTOCOL : "quality";
  const interval = 1000 / (options.requestsPerSecond ?? 20);
  let next = Date.now();
  let index = 0;
  let graded = 0;
  let failed = 0;
  const worker = async () => {
    while (index < batch.length) {
      if (options.deadline && Date.now() > options.deadline) return;
      const row = batch[index++];
      const wait = next - Date.now();
      next = Math.max(next, Date.now()) + interval;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const grade = await readers.grade(
        row,
        { text: gunzipSync(row.evidence!).toString("utf8"), chars: row.chars ?? 0 },
        protocol,
      );
      if (/^JUDGE_HTTP_(401|402|429)$/.test(grade.error ?? "")) return;
      await store.db
        .insert(grades)
        .values({
          id: `${row.id}:${options.rubric}`,
          attemptId: row.id,
          runId: row.runId,
          rubric: options.rubric,
          success: grade.success,
          access: options.rubric === "access" ? grade.content : null,
          content: options.rubric === "quality" ? grade.content : null,
          identity: options.rubric === "quality" ? grade.identity : null,
          confidence: grade.confidence,
          error: grade.error,
          inputTokens: grade.inputTokens,
        })
        .onConflictDoNothing();
      if (grade.error) failed++;
      else graded++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 16, batch.length) }, worker));
  return { candidates: rows.length, attempted: Math.min(index, batch.length), graded, failed };
}

/** The newest runs that still have pages waiting for a quality grade. */
export async function runsNeedingQuality(store: Store, limit = 2) {
  const recent = await store.db
    .select({ id: runs.id })
    .from(runs)
    .orderBy(desc(runs.day), desc(runs.createdAt))
    .limit(limit);
  return recent.map((r) => r.id);
}

export async function gradeSummary(store: Store, runId: string) {
  const result = await store.db.execute<{ rubric: string; graded: number; failed: number }>(sql`
    select rubric, count(*) filter (where error is null)::int as graded,
      count(*) filter (where error is not null)::int as failed
    from scraping_bench.grades where run_id=${runId} group by rubric`);
  return result.rows;
}
