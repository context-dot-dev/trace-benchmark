import "server-only";

import { NeonSource } from "../../../server/neon";

let source: NeonSource | undefined;

export function database() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw Object.assign(new Error("The benchmark database is not configured"), { status: 503 });
  return (source ??= new NeonSource(url));
}

export function requestError(error: unknown) {
  const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 503;
  return Response.json(
    { error: status === 503 ? "Benchmark data is temporarily unavailable; please try again." : error instanceof Error ? error.message : "Request failed" },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function streamedJson(json: string, headers: Record<string, string> = {}) {
  const bytes = Buffer.from(json);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.subarray(offset, offset + 64 * 1024));
        offset += 64 * 1024;
      },
    }),
    { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } },
  );
}
