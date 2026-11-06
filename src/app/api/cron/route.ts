import { start } from "workflow/api";
import { HookConflictError } from "workflow/errors";
import { authorizeCron } from "@/lib/benchmark/collect";
import { collectContinuously } from "@/lib/benchmark/workflow";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const status = authorizeCron(request);
  if (status !== 200)
    return Response.json({ error: "Unauthorized" }, { status });
  if (process.env.TRACE_WORKER_ENABLED !== "1")
    return Response.json({ status: "disabled" });
  try {
    const run = await start(collectContinuously, [], {
      experimental_hook: { token: "scraping-bench-collector" },
    });
    return Response.json({ status: "started", runId: run.runId }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (HookConflictError.is(error))
      return Response.json({ status: "busy", runId: error.conflictingRunId }, {
        headers: { "Cache-Control": "no-store" },
      });
    console.error(
      "Benchmark workflow could not start; the next cron will retry.",
    );
    return Response.json({ error: "Collection failed" }, { status: 500 });
  }
}
