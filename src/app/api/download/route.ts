import { asc, eq } from "drizzle-orm";
import { database } from "@/lib/benchmark/store";
import { attempts, runs } from "@/lib/benchmark/schema";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("run") ?? "";
  const { db } = database();
  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.id, runId));
  if (!run)
    return Response.json({ error: "Sample not found" }, { status: 404 });
  let offset = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const rows = await db
          .select({
            id: attempts.id,
            day: attempts.day,
            url: attempts.url,
            category: attempts.category,
            provenance: attempts.provenance,
            provider: attempts.provider,
            state: attempts.state,
            success: attempts.success,
            elapsedMs: attempts.elapsedMs,
            error: attempts.error,
            content: attempts.content,
            identity: attempts.identity,
            chars: attempts.chars,
            hash: attempts.hash,
          })
          .from(attempts)
          .where(eq(attempts.runId, runId))
          .orderBy(asc(attempts.id))
          .limit(500)
          .offset(offset);
        if (!rows.length) {
          controller.close();
          return;
        }
        controller.enqueue(
          encoder.encode(
            rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
          ),
        );
        offset += rows.length;
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition":
        'attachment; filename="trace-results.ndjson"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
