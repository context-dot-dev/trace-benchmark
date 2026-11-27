import { authorizeCron, refreshSupply } from "@/lib/benchmark/collect";
import { database } from "@/lib/benchmark/store";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Daily supply refresh between weekly samples: polls every due source and probes new candidates.
// It makes no provider or judge calls, so it adds no paid retrievals.
export async function GET(request: Request) {
  const status = authorizeCron(request);
  if (status !== 200)
    return Response.json({ error: "Unauthorized" }, { status });
  if (process.env.TRACE_WORKER_ENABLED !== "1")
    return Response.json({ status: "disabled" });
  try {
    const result = await refreshSupply(database(), { deadlineMs: 270_000 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Supply refresh failed; the next run will retry.");
    return Response.json({ error: "Supply refresh failed" }, { status: 500 });
  }
}
