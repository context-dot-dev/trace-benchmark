import { timingSafeEqual } from "node:crypto";
import { database, requestError } from "@/lib/trace/database";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.TRACE_WORKER_ENABLED !== "1") return Response.json({ status: "disabled" });
  try {
    const source = database();
    const archive = JSON.parse(await source.publicFile("latest.json"));
    await source.publish(archive);
    return Response.json({ status: "published", generated_at: archive.generated_at }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return requestError(error);
  }
}
