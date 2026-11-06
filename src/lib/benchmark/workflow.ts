import { sleep } from "workflow";
import { runTick } from "./collect";
import { database } from "./store";
import { providerWorkers, runProvider, type ProviderWorker } from "./parallel";

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
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}
