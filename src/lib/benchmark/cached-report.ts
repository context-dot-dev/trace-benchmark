import { unstable_cache } from "next/cache";
import { report } from "./report";
import { database } from "./store";

export const cachedReport = unstable_cache(
  (options: Parameters<typeof report>[1] = {}) => report(database(), options),
  ["trace-report-v4"],
  { revalidate: 900 },
);
