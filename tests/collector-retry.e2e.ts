import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { runTick } from "../src/lib/benchmark/collect.ts";
import { createReaders } from "../src/lib/benchmark/providers.ts";
import { migrateStore, openStore } from "../src/lib/benchmark/store.ts";
import { categories, providers } from "../src/lib/benchmark/types.ts";

// A failed DB write must not release the worker while other billed requests run:
// an immediate durable retry would otherwise overlap another eight-page batch.
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl && ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname),
  "Use a disposable local database; this test truncates scraping_bench");
const store = openStore(databaseUrl);
const requests: { provider: string; url: string; started: number; ended?: number }[] = [];
const active: Record<string, number> = {};
const maximum: Record<string, number> = {};
const fixture = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const incoming = new URL(req.url!, "http://127.0.0.1");
  const provider = incoming.pathname.slice(1);
  const url = body.url ?? body.urls?.[0] ?? body.state?.text?.match(/^Fixture URL: (\S+)/)?.[1] ?? incoming.searchParams.get("url");
  const record = { provider, url, started: Date.now(), ended: undefined as number | undefined };
  requests.push(record);
  active[provider] = (active[provider] ?? 0) + 1;
  maximum[provider] = Math.max(maximum[provider] ?? 0, active[provider]);
  res.once("close", () => { active[provider]--; record.ended = Date.now(); });
  if (provider === "judge") assert.deepEqual(Object.keys(body.questions), ["access"]);
  const fast = provider === "judge" || (provider === "context" && url.endsWith("/0"));
  await new Promise((resolve) => setTimeout(resolve, fast ? 50 : 2000));
  const text = "Fixture URL: " + url + "\n" + "Substantive requested target article. ".repeat(30);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(provider === "judge" ? {
    answers: { access: { choice: "accessed", confidence: 1 } },
    usage: { input_tokens: 100 },
  } : provider === "context" ? { markdown: { requested: true, success: true, data: text }, url }
    : provider === "exa" ? { results: [{ text, url }] }
    : provider === "firecrawl" ? { success: true, data: { markdown: text } }
    : { content: text, url }));
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const base = "http://127.0.0.1:" + (fixture.address() as { port: number }).port;
const readers = createReaders({
  endpoints: Object.fromEntries(providers.map((p) => [p.id, base + "/" + p.id])),
  judgeEndpoint: base + "/judge",
  keys: Object.fromEntries([...providers.map((p) => p.id), "judge"].map((p) => [p, "fixture-key"])),
});
let failure: string | undefined;
let activeAtRejection: Record<string, number> = {};
try {
  await migrateStore(store);
  await store.db.execute(sql`truncate scraping_bench.grades, scraping_bench.audits, scraping_bench.attempts, scraping_bench.runs, scraping_bench.candidates, scraping_bench.seen, scraping_bench.budgets, scraping_bench.worker, scraping_bench.sources`);
  const clock = new Date("2026-11-06T00:20:00Z");
  await store.seedCandidates(Array.from({ length: 16 }, (_, i) => ({
    id: "retry-" + String(i).padStart(3, "0"), url: "https://example.org/retry/" + i,
    title: "Article " + i, category: categories[i % categories.length].id,
    organization: "fixture-" + i, sourceId: "fixture", discoveredAt: clock,
  })));
  await store.db.execute(sql`create sequence scraping_bench.e2e_write_failures`);
  await store.db.execute(sql`
    create function scraping_bench.e2e_fail_first_save() returns trigger language plpgsql as $$
    begin
      if new.page_id='retry-000' and new.provider='context' and new.state='fetched'
        and nextval('scraping_bench.e2e_write_failures')=1 then
        raise exception 'E2E_TRANSIENT_WRITE_FAILURE';
      end if;
      return new;
    end $$`);
  await store.db.execute(sql`create trigger e2e_failed_save before update on scraping_bench.attempts
    for each row execute function scraping_bench.e2e_fail_first_save()`);
  const options = { now: () => clock, readers, discover: false, maxPages: 8, deadlineMs: 20000 };
  await assert.rejects(runTick(store, options));
  activeAtRejection = { ...active };
  await runTick(store, { ...options, maxPages: 0 });
  const health = await store.db.execute(sql`select error from scraping_bench.worker where id='collector'`);
  assert.ok(health.rows[0].error, "Preparation must preserve a visible collector error while a provider worker remains failed");
  // Reproduce immediate durable retry while any abandoned siblings are still running.
  await runTick(store, options);
  // Paced calls cancelled before dispatch return to the queue without a charge.
  for (let remainingTicks = 0; remainingTicks < 3; remainingTicks++) {
    const pending = await store.db.execute(sql`select count(*)::int as count from scraping_bench.attempts where state in ('queued','fetched')`);
    if (!pending.rows[0].count) break;
    await runTick(store, options);
  }
  for (const provider of providers) {
    const calls = requests.filter((r) => r.provider === provider.id);
    assert.equal(calls.length, 16);
    assert.equal(new Set(calls.map((r) => r.url)).size, 16);
    assert.ok(maximum[provider.id] <= 8, `${provider.id} overlapped ${maximum[provider.id]} requests after retry`);
  }
  assert.ok(Object.values(activeAtRejection).every((n) => n === 0),
    "A rejected batch must drain sibling HTTP requests before releasing its worker lease");
  const orphan = await store.db.execute(sql`select state from scraping_bench.attempts where page_id='retry-000' and provider='context'`);
  assert.equal(orphan.rows[0].state, "fetching", "Failed persistence must not automatically repeat the billed request");
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await store.db.execute(sql`drop trigger if exists e2e_failed_save on scraping_bench.attempts`);
  await store.db.execute(sql`drop function if exists scraping_bench.e2e_fail_first_save()`);
  await store.db.execute(sql`drop sequence if exists scraping_bench.e2e_write_failures`);
  fixture.closeAllConnections();
  fixture.close();
  await store.close();
  await mkdir("artifacts/continuous", { recursive: true });
  await writeFile("artifacts/continuous/retry-e2e.json", JSON.stringify({
    ok: !failure, failure, maximum, activeAtRejection, requests,
    check: "Transient Postgres receipt-write failure drains sibling HTTP calls before immediate retry; no duplicate billed requests",
    limitation: "The orphaned already-billed request retains its lease and is later recovered as interrupted, never silently fetched again.",
    repeat: "DATABASE_URL=postgresql://...@127.0.0.1/... npx tsx tests/collector-retry.e2e.ts",
  }, null, 2));
}
console.log(JSON.stringify({ ok: true, maximum, activeAtRejection, artifact: "artifacts/continuous/retry-e2e.json" }, null, 2));
