import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { openStore, migrateStore } from "../src/lib/benchmark/store";
import { attempts, budgets, runs, seen } from "../src/lib/benchmark/schema";
import { summarize } from "../src/lib/benchmark/report";
import { canonical } from "../src/lib/benchmark/discovery";
import { categories } from "../src/lib/benchmark/types";

config({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required for migration");
const store = openStore(process.env.DATABASE_URL);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
try {
  await migrateStore(store);
  const file = process.argv[2];
  if (file) {
    const archive = JSON.parse(
      gunzipSync(await readFile(file)).toString("utf8"),
    );
    const candidates = archive.candidates.flatMap(
      (c: Record<string, string>) => {
        try {
          if (!categories.some((k) => k.id === c.category)) return [];
          return [
            {
              id: hash(c.organization + "\0" + (c.document_id || c.url)),
              url: canonical(c.url),
              title: (c.title || "").toWellFormed(),
              category: c.category,
              organization: c.organization,
              sourceId: c.source_id,
              discoveredAt: new Date(c.discovered_at),
            },
          ];
        } catch {
          return [];
        }
      },
    );
    await store.seedCandidates(candidates);
    const identities = new Set<string>();
    for (const c of archive.seen) {
      try {
        identities.add(hash(canonical(c.url)));
        identities.add(hash(c.organization + "\0" + (c.document_id || c.url)));
      } catch {
      }
    }
    const ids = [...identities];
    for (let i = 0; i < ids.length; i += 500)
      await store.db
        .insert(seen)
        .values(ids.slice(i, i + 500).map((id) => ({ id, day: "legacy" })))
        .onConflictDoNothing();
    for (const run of archive.runs) {
      const rows = archive.records
        .filter((r: { runId: string }) => r.runId === run.id)
        .map((r: typeof attempts.$inferInsert) => ({
          ...r,
          day: run.started_at.slice(0, 10),
          state: "done",
          evidence: null,
          evidenceBytes: 0,
          judgeCalls: 0,
          claim: null,
          leaseUntil: null,
          startedAt: null,
          confidence: null,
          credits: null,
          costUsd: null,
        }));
      if (!rows.length) continue;
      const summary = summarize(
        run.id,
        run.started_at.slice(0, 10),
        run.protocol,
        rows,
        2400,
        new Date(run.finished_at),
      );
      await store.db.transaction(async (tx) => {
        await tx
          .insert(runs)
          .values({
            id: run.id,
            day: summary.day,
            protocol: run.protocol,
            status: "completed",
            summary,
            createdAt: new Date(run.started_at),
            finishedAt: new Date(run.finished_at),
          })
          .onConflictDoNothing();
        for (let i = 0; i < rows.length; i += 200)
          await tx
            .insert(attempts)
            .values(rows.slice(i, i + 200))
            .onConflictDoNothing();
      });
    }
    for (const [day, bucket, used] of archive.budgets) {
      if (
        !bucket.startsWith("reader_requests:") &&
        bucket !== "jev_input_token_reservations"
      )
        continue;
      await store.db
        .insert(budgets)
        .values({
          day,
          bucket:
            bucket === "jev_input_token_reservations"
              ? "judge"
              : bucket.split(":")[1],
          used: Math.ceil(used),
        })
        .onConflictDoUpdate({
          target: [budgets.day, budgets.bucket],
          set: { used: sql`greatest(${budgets.used}, ${Math.ceil(used)})` },
        });
    }
    console.log({
      importedCandidates: candidates.length,
      seenIdentities: ids.length,
      historicalRuns: new Set(
        archive.records.map((r: { runId: string }) => r.runId),
      ).size,
      historicalResults: archive.records.length,
    });
  }
  console.log("Drizzle migration complete");
} finally {
  await store.close();
}
