import { BenchmarkReport } from "@/components/benchmark/report";
import { benchmarkDataset } from "@/lib/benchmark/dataset";
export const dynamic = "force-dynamic";
export default async function Page() {
  return <BenchmarkReport initial={await benchmarkDataset()} />;
}
