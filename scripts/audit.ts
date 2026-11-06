// Human audit of the automated judge.
//
// 1. Export a blind random sample. Reviewers see the requested URL and the evidence the judge saw,
//    but not the provider or the judge's verdict:
//      npx tsx scripts/audit.ts export --run scraping-bench-v6:2026-11-07 --per-provider 25 --out audit.json
// 2. Reviewers fill in "label" with pass, fail, or unclear (and an optional "note").
// 3. Import the labels. Agreement with the judge is published on the page:
//      npx tsx scripts/audit.ts import audit.json --reviewer "Reviewer name" --write
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { openStore } from "../src/lib/benchmark/store";
import { attempts, audits, runs } from "../src/lib/benchmark/schema";
import { providers } from "../src/lib/benchmark/types";

config({ path: ".env.local", quiet: true });
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    run: { type: "string" },
    "per-provider": { type: "string", default: "25" },
    out: { type: "string", default: "audit.json" },
    reviewer: { type: "string" },
    write: { type: "boolean", default: false },
  },
});
const [command, file] = positionals;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const store = openStore(process.env.DATABASE_URL);
type Entry = { attemptId: string; url: string; title: string; evidence: string; label: string; note?: string };
try {
  if (command === "export") {
    if (!values.run) throw new Error("--run is required");
    const per = Number(values["per-provider"]);
    const sample: Entry[] = [];
    for (const provider of providers) {
      const rows = await store.db
        .select({ id: attempts.id, url: attempts.url, title: attempts.title, evidence: attempts.evidence })
        .from(attempts)
        .where(and(eq(attempts.runId, values.run), eq(attempts.provider, provider.id), eq(attempts.state, "done"), isNotNull(attempts.evidence)))
        .orderBy(sql`random()`)
        .limit(per);
      sample.push(...rows.map((r) => ({
        attemptId: r.id, url: r.url, title: r.title,
        evidence: gunzipSync(r.evidence!).toString("utf8"), label: "",
      })));
    }
    sample.sort(() => Math.random() - 0.5);
    await writeFile(values.out!, JSON.stringify(sample, null, 2));
    console.log(JSON.stringify({ exported: sample.length, file: values.out }));
  } else if (command === "import") {
    if (!file || !values.reviewer) throw new Error("Usage: import <file> --reviewer <name> [--write]");
    const entries = (JSON.parse(await readFile(file, "utf8")) as Entry[]).filter((e) => ["pass", "fail", "unclear"].includes(e.label));
    const rows = await store.db
      .select({ id: attempts.id, runId: attempts.runId, provider: attempts.provider, protocol: runs.protocol })
      .from(attempts)
      .innerJoin(runs, eq(runs.id, attempts.runId))
      .where(inArray(attempts.id, entries.map((e) => e.attemptId)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const values_ = entries.filter((e) => byId.has(e.attemptId)).map((e) => {
      const row = byId.get(e.attemptId)!;
      return {
        id: `${e.attemptId}:${values.reviewer}`, attemptId: e.attemptId, runId: row.runId,
        provider: row.provider, rubric: row.protocol, label: e.label, reviewer: values.reviewer!, note: e.note ?? null,
      };
    });
    console.log(JSON.stringify({ labelled: values_.length, skipped: entries.length - values_.length, write: values.write }));
    if (values.write && values_.length)
      await store.db.insert(audits).values(values_).onConflictDoUpdate({
        target: audits.id, set: { label: sql`excluded.label`, note: sql`excluded.note` },
      });
  } else {
    throw new Error("Usage: audit.ts export|import ...");
  }
} finally {
  await store.close();
}
