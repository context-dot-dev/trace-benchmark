import { cachedReport } from "@/lib/benchmark/cached-report";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? 0);
  if (!Number.isSafeInteger(page) || page < 0)
    return Response.json({ error: "Invalid page" }, { status: 400 });
  try {
    return Response.json(
      await cachedReport({
        run: params.get("run") || undefined,
        provider: params.get("provider") || undefined,
        page,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Results are temporarily unavailable" },
      { status: 503 },
    );
  }
}
