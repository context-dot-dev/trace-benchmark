import { database, requestError, streamedJson } from "@/lib/trace/database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!/^(latest|run-sampling|replenishment)\.json$|^runs\/[A-Za-z0-9._:-]+\.json$/.test(path)) return new Response(null, { status: 404 });
  try {
    return streamedJson(await database().publicFile(path));
  } catch (error) {
    return requestError(error);
  }
}
