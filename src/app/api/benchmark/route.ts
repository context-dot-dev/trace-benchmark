import { benchmarkDataset } from "@/lib/benchmark/dataset";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const run = new URL(request.url).searchParams.get("run") || undefined;
    const data = await benchmarkDataset(run);
    if (run && !data.report.latest)
      return Response.json({ error: "Sample not found" }, { status: 404 });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Results are temporarily unavailable" },
      { status: 503 },
    );
  }
}
