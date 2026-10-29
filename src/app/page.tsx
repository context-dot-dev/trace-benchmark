import { BenchmarkReport } from "@/components/benchmark/report";
import { cachedReport } from "@/lib/benchmark/cached-report";
export const dynamic = "force-dynamic";
export default async function Page() {
  const data = await cachedReport({
    run: undefined,
    provider: undefined,
    page: 0,
  });
  return <BenchmarkReport initial={data} />;
}
