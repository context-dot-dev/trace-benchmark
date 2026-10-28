import { database } from "./database";
import { isSummary, type Summary } from "./types";

export async function getSummary(): Promise<Summary> {
  const summary: unknown = await database().summary();
  if (!isSummary(summary)) throw new Error("Invalid benchmark summary");
  return summary;
}
