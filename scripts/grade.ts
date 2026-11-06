// Grades stored evidence after collection, without touching the collection grade.
//
//   npx tsx scripts/grade.ts --rubric access --run scraping-bench-v5:2026-11-05          # preview
//   npx tsx scripts/grade.ts --rubric access --run scraping-bench-v5:2026-11-05 --write  # grade
//   npx tsx scripts/grade.ts --rubric quality --recent 3 --write
//
// "access" regrades an earlier sample under the v6 access rubric so both scores can be compared
// on identical evidence. "quality" adds the right-page and substantive-content grades used by
// the quality funnel. Each graded page costs one judge call; evidence must still be retained.
import { config } from "dotenv";
import { parseArgs } from "node:util";
import { desc } from "drizzle-orm";
import { openStore } from "../src/lib/benchmark/store";
import { runs } from "../src/lib/benchmark/schema";
import { gradeCandidates, gradeRun, gradeSummary, type Rubric } from "../src/lib/benchmark/grades";

config({ path: ".env.local", quiet: true });
const { values } = parseArgs({
  options: {
    rubric: { type: "string" },
    run: { type: "string", multiple: true },
    recent: { type: "string" },
    limit: { type: "string" },
    rps: { type: "string" },
    write: { type: "boolean", default: false },
  },
});
const rubric = values.rubric as Rubric;
if (rubric !== "access" && rubric !== "quality")
  throw new Error("--rubric must be access or quality");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const store = openStore(process.env.DATABASE_URL);
try {
  const ids = values.run?.length
    ? values.run
    : (
        await store.db
          .select({ id: runs.id })
          .from(runs)
          .orderBy(desc(runs.day), desc(runs.createdAt))
          .limit(Number(values.recent ?? 1))
      ).map((r) => r.id);
  for (const runId of ids) {
    const { run, rows } = await gradeCandidates(store, runId, rubric);
    const limit = Number(values.limit ?? 0);
    const planned = limit > 0 ? Math.min(limit, rows.length) : rows.length;
    console.log(
      JSON.stringify({ run: runId, protocol: run.protocol, rubric, candidates: rows.length, judgeCalls: planned, write: values.write }),
    );
    if (!values.write || !planned) continue;
    const result = await gradeRun(store, {
      runId,
      rubric,
      limit,
      requestsPerSecond: Number(values.rps ?? 20),
    });
    console.log(JSON.stringify({ run: runId, ...result, totals: await gradeSummary(store, runId) }));
  }
  if (!values.write) console.log("Preview only. Add --write to call the judge and store grades.");
} finally {
  await store.close();
}
