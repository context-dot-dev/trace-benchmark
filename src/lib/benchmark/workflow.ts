import { sleep } from "workflow";
import { runTick } from "./collect";
import { database } from "./store";

async function collectBatch() {
  "use step";

  if (process.env.VERCEL_ENV !== "production" || process.env.TRACE_WORKER_ENABLED !== "1")
    return { status: "disabled" as const };
  return runTick(database());
}

export async function collectContinuously() {
  "use workflow";

  while (true) {
    const result = await collectBatch();
    if (result.status === "busy") {
      await sleep("30s");
    } else if (result.status === "disabled" || result.pages === 0) {
      return result;
    }
  }
}
