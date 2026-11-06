// Recomputes stored run summaries with the current scoring rules (account-limit exclusions,
// failure labels, confidence intervals, p90 and p99). Grades are not changed.
//
//   npx tsx scripts/resummarize.ts          # preview
//   npx tsx scripts/resummarize.ts --write  # store the new summaries
import { config } from "dotenv";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { openStore } from "../src/lib/benchmark/store";
import { attempts, runs } from "../src/lib/benchmark/schema";
import { summarize } from "../src/lib/benchmark/report";

config({ path: ".env.local", quiet: true });
const { values } = parseArgs({ options: { write: { type: "boolean", default: false } } });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const store = openStore(process.env.DATABASE_URL);
const pct = (v: number | null | undefined) => (v == null ? "—" : (v * 100).toFixed(1));
try {
  for (const run of await store.db.select().from(runs).orderBy(runs.day)) {
    const rows = await store.db
      .select({
        provider: attempts.provider, pageId: attempts.pageId, category: attempts.category, state: attempts.state,
        success: attempts.success, elapsedMs: attempts.elapsedMs, error: attempts.error,
      })
      .from(attempts)
      .where(eq(attempts.runId, run.id));
    // Records past their retention window are gone; keep the stored summary for those runs.
    if (!rows.length) continue;
    const summary = summarize(run.id, run.day, run.protocol, rows, run.summary.target, run.finishedAt);
    console.log(
      run.id,
      summary.providers.map((p) => `${p.id} ${pct(run.summary.providers.find((o) => o.id === p.id)?.rate)} -> ${pct(p.rate)}`).join(" | "),
    );
    if (values.write)
      await store.db.update(runs).set({ summary }).where(eq(runs.id, run.id));
  }
  if (!values.write) console.log("Preview only. Add --write to store the new summaries.");
} finally {
  await store.close();
}
