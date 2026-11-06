// Post-collection grading: v6 access regrades of an earlier sample and quality grades of a v6
// sample, stored apart from the collection grade. Uses a stub judge; no external calls.
//   DATABASE_URL=postgresql://localhost/benchmark_verify npx tsx tests/grades.e2e.ts
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { openStore, migrateStore } from "../src/lib/benchmark/store";
import { attempts, grades, runs } from "../src/lib/benchmark/schema";
import { gradeCandidates, gradeRun } from "../src/lib/benchmark/grades";
import type { Readers } from "../src/lib/benchmark/providers";
import type { RunSummary } from "../src/lib/benchmark/types";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl && /localhost|127\.0\.0\.1/.test(databaseUrl), "Use a disposable local database; this test truncates scraping_bench");
const store = openStore(databaseUrl);
const calls: { protocol: string | undefined; url: string }[] = [];
const readers = {
  ready: () => true,
  read: async () => { throw new Error("not used"); },
  grade: async (target: { url: string }, _receipt: unknown, protocol?: string) => {
    calls.push({ protocol, url: target.url });
    const failing = target.url.endsWith("/2");
    return protocol === "scraping-bench-v6"
      ? { inputTokens: 10, success: !failing, content: failing ? "not_accessed" : "accessed", identity: null, confidence: 0.9, error: null }
      : { inputTokens: 10, success: !failing, content: failing ? "thin" : "substantive", identity: failing ? "wrong_target" : "match", confidence: 0.9, error: null };
  },
} as unknown as Readers;
const checks: string[] = [];
try {
  await migrateStore(store);
  await store.db.execute(sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs`);
  const summary = (id: string, protocol: string) => ({ id, day: "2026-11-07", protocol, status: "completed", pages: 3, target: 3, finishedAt: null, providers: [], categories: {} }) as RunSummary;
  for (const [id, protocol] of [["old:2026-11-06", "scraping-bench-v5"], ["new:2026-11-07", "scraping-bench-v6"]] as const) {
    await store.db.insert(runs).values({ id, day: "2026-11-07", protocol, status: "completed", summary: summary(id, protocol) });
    await store.db.insert(attempts).values([0, 1, 2, 3].map((i) => ({
      id: `${id}:${i}`, runId: id, day: "2026-11-07", pageId: `p${i}`, provider: "context", url: `https://example.org/${i}`,
      title: "Target", category: "news", state: "done",
      // Page 3 failed at collection: no evidence, so it is never graded again.
      success: i === 3 ? false : protocol === "scraping-bench-v6" ? i !== 2 : true,
      error: i === 3 ? "HTTP_404" : null,
      evidence: i === 3 ? null : gzipSync(`[Case ${i}] page text`), evidenceBytes: 20, chars: 20,
    })));
  }
  const access = await gradeCandidates(store, "old:2026-11-06", "access");
  assert.equal(access.rows.length, 3);
  assert.equal((await gradeCandidates(store, "new:2026-11-07", "access")).rows.length, 0, "v6 samples are never regraded for access");
  const quality = await gradeCandidates(store, "new:2026-11-07", "quality");
  assert.equal(quality.rows.length, 2, "only accessed v6 pages get a quality grade");
  checks.push("Candidates exclude failed requests, missing evidence, v6 access regrades, and pages that were not accessed");

  const first = await gradeRun(store, { runId: "old:2026-11-06", rubric: "access", readers, requestsPerSecond: 1000 });
  assert.deepEqual([first.graded, first.failed], [3, 0]);
  await gradeRun(store, { runId: "new:2026-11-07", rubric: "quality", readers, requestsPerSecond: 1000 });
  assert.ok(calls.filter((c) => c.protocol === "scraping-bench-v6").length === 3);
  assert.ok(calls.filter((c) => c.protocol === "quality").length === 2);
  const stored = await store.db.select().from(grades).orderBy(grades.id);
  assert.equal(stored.length, 5);
  assert.deepEqual(stored.filter((g) => g.rubric === "access").map((g) => g.access), ["accessed", "accessed", "not_accessed"]);
  assert.deepEqual(stored.filter((g) => g.rubric === "quality").map((g) => [g.content, g.identity]), [["substantive", "match"], ["substantive", "match"]]);
  const original = await store.db.execute(sql`select count(*)::int as n from scraping_bench.attempts where content is not null`);
  assert.equal(original.rows[0].n, 0, "collection grades are never overwritten");
  checks.push("Regrades and quality grades are stored separately and leave collection grades untouched");

  const again = await gradeRun(store, { runId: "old:2026-11-06", rubric: "access", readers, requestsPerSecond: 1000 });
  assert.equal(again.candidates, 0, "a page is graded once per rubric");
  checks.push("Grading is idempotent");
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await store.close();
}
