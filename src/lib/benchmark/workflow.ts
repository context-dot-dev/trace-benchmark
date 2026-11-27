import { sleep } from "workflow";
import { probeCandidates, runTick } from "./collect";
import { database } from "./store";
import { providerWorkers, runProvider, type ProviderWorker } from "./parallel";
import { gradeRun, runsNeedingQuality } from "./grades";

// select=false discovers sources without drawing a pending sample, so a hard-first sample can be
// probed in its own steps first.
async function prepare(select = true) {
  "use step";

  if (process.env.VERCEL_ENV !== "production" || process.env.TRACE_WORKER_ENABLED !== "1")
    return { status: "disabled" as const, workers: [], samplePending: false, hardFirst: false };
  const result = await runTick(database(), { maxPages: 0, select });
  return {
    status: result.status,
    workers: providerWorkers(),
    samplePending: "samplePending" in result && result.samplePending === true,
    hardFirst: "mode" in result && result.mode === "hard-first",
  };
}

// One bounded pass of the neutral difficulty probe over candidates for today's sample.
async function probeSample() {
  "use step";

  if (process.env.VERCEL_ENV !== "production" || process.env.TRACE_WORKER_ENABLED !== "1")
    return { probed: 0, done: true };
  return probeCandidates(database(), {
    day: new Date().toISOString().slice(0, 10),
    deadlineMs: 200_000,
  });
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

  let prepared = await prepare(false);
  while (prepared.status === "busy") {
    await sleep("30s");
    prepared = await prepare(false);
  }
  if (prepared.status === "disabled") return;
  if (prepared.samplePending) {
    // Each pass stops at its deadline; 12 passes bound the probe phase to about 40 minutes.
    if (prepared.hardFirst)
      for (let pass = 0; pass < 12; pass++) {
        const result = await probeSample();
        if (result.done || result.probed === 0) break;
      }
    prepared = await prepare();
    while (prepared.status === "busy") {
      await sleep("30s");
      prepared = await prepare();
    }
  }
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
