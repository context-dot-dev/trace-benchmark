import { sleep } from "workflow";
import { runTick } from "./collect";
import { database } from "./store";
import { providerWorkers, runProvider, type ProviderWorker } from "./parallel";
import { gradeRun, runsNeedingQuality } from "./grades";

async function prepare() {
  "use step";

  if (process.env.VERCEL_ENV !== "production" || process.env.TRACE_WORKER_ENABLED !== "1")
    return { status: "disabled" as const, workers: [] };
  const result = await runTick(database(), { maxPages: 0 });
  return { status: result.status, workers: providerWorkers() };
}

async function collectProvider(config: ProviderWorker) {
  "use step";

  if (process.env.VERCEL_ENV !== "production" || process.env.TRACE_WORKER_ENABLED !== "1")
    return { status: "disabled" as const, processed: 0 };
  return runProvider(database(), config);
}

// Document and content grades for the quality funnel. Off unless TRACE_QUALITY_GRADING=1,
// because it adds roughly one judge call per accessed page.
async function gradeQuality() {
  "use step";

  if (
    process.env.VERCEL_ENV !== "production" ||
    process.env.TRACE_WORKER_ENABLED !== "1" ||
    process.env.TRACE_QUALITY_GRADING !== "1"
  )
    return { graded: 0 };
  const store = database();
  const deadline = Date.now() + 200_000;
  let graded = 0;
  for (const runId of await runsNeedingQuality(store)) {
    const result = await gradeRun(store, {
      runId,
      rubric: "quality",
      limit: 4000,
      requestsPerSecond: Number(process.env.TRACE_JUDGE_RPS ?? 20) / 2,
      deadline,
    });
    graded += result.graded;
  }
  return { graded };
}

export async function collectContinuously() {
  "use workflow";

  let prepared = await prepare();
  while (prepared.status === "busy") {
    await sleep("30s");
    prepared = await prepare();
  }
  if (prepared.status === "disabled") return;
  const results = await Promise.allSettled(prepared.workers.map(async (config) => {
    while (true) {
      const result = await collectProvider(config);
      if (result.status === "busy") await sleep("30s");
      else if (result.status === "disabled" || result.paused || result.processed === 0) return;
    }
  }));
  await prepare();
  while ((await gradeQuality()).graded > 0) await sleep("1s");
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}
