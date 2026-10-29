import { authorizeCron, runTick } from "@/lib/benchmark/collect";
import { database } from "@/lib/benchmark/store";
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
    return Response.json(await runTick(database()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    console.error(
      "Benchmark tick failed; durable work will resume on the next tick.",
    );
    return Response.json({ error: "Collection failed" }, { status: 500 });
  }
}
