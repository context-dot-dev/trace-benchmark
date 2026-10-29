import { BenchmarkReport } from "@/components/benchmark/report";
import { database } from "@/lib/benchmark/store";
import { report } from "@/lib/benchmark/report";
export const dynamic = "force-dynamic";
export default async function Page() {
  const data = await report(database());
  return <BenchmarkReport initial={data} />;
}
