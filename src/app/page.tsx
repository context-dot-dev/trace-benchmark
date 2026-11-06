import { BenchmarkReport } from "@/components/benchmark/report";
import { benchmarkDataset } from "@/lib/benchmark/dataset";
import { firstSampleDay } from "@/lib/benchmark/history";
import { loadBenchmarkQuery } from "@/lib/benchmark/query";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const { run } = loadBenchmarkQuery(params);
  const initial = await benchmarkDataset(run === "latest" ? undefined : run);
  if (run !== "latest" && !initial.report.history.some((sample) =>
    sample.id === run && sample.day >= firstSampleDay)) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "run" || value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
    }
    redirect(query.size ? `/?${query}` : "/");
  }
  return <BenchmarkReport initial={initial} />;
}
