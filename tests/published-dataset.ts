import assert from "node:assert/strict";
import { benchmarkDataset } from "../src/lib/benchmark/dataset";
import { serverEnv } from "../src/lib/env.server";

const originalFetch = globalThis.fetch;
const originalOrigin = serverEnv.benchmarkDataOrigin;
const published = {
  report: { latest: { day: "2026-11-01" }, history: [{ day: "2026-10-01" }] },
  pages: [{ id: "original-page", results: { context: { success: null } } }],
};
const requested: string[] = [];

try {
  serverEnv.benchmarkDataOrigin = "https://example.test";
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return Response.json(published);
  };
  assert.deepEqual(await benchmarkDataset(), published);
  assert.deepEqual(await benchmarkDataset("original:run/1"), published);
  assert.deepEqual(requested, [
    "https://example.test/api/benchmark",
    "https://example.test/api/benchmark?run=original%3Arun%2F1",
  ]);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(benchmarkDataset(), /Benchmark data is unavailable/);
  console.log("PASS: published data stays unchanged, date selection is forwarded, and failures never substitute local data.");
} finally {
  globalThis.fetch = originalFetch;
  serverEnv.benchmarkDataOrigin = originalOrigin;
}
