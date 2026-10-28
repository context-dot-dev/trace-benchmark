import { parameters } from "../../../../server/publication.js";
import { database, requestError, streamedJson } from "@/lib/trace/database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ operation: string }> }) {
  const { operation } = await params;
  if (!["summary", "results", "result", "download"].includes(operation)) return new Response(null, { status: 404 });
  try {
    const url = new URL(request.url);
    const source = database();
    const data =
      operation === "summary"
        ? await source.summary()
        : operation === "result"
          ? await source.detail(url.searchParams.get("id") || "", url.searchParams.get("version"))
          : await source.page(parameters(url), operation === "download");
    return streamedJson(JSON.stringify(data), {
      "Cache-Control": "no-store",
      "X-Benchmark-Storage": "neon",
      ...(operation === "download" ? { "Content-Disposition": 'attachment; filename="scraping-bench-results.json"' } : {}),
    });
  } catch (error) {
    return requestError(error);
  }
}
