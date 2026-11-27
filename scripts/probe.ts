// Runs the neutral difficulty probe outside the collector, without a database.
//
//   npx tsx scripts/probe.ts sources [--category news] [--per-source 40] [--registry file] [--out probes.json]
//       Discover every registry source now and probe a day-seeded sample of its candidates.
//       Shows which sources still supply pages that need more than a plain HTTP GET.
//       --registry tests proposed sources from another file before they are added.
//   npx tsx scripts/probe.ts urls <file> [--out probes.json]
//       Probe URLs from a text file (one per line) or a TRACE NDJSON download.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import registry from "../config/sources.json";
import { discoverSource, type Source } from "../src/lib/benchmark/discovery";
import { probeMany, probePage, type Probe } from "../src/lib/benchmark/probe";

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const mode = args[0];
const concurrency = Number(flag("concurrency", "24"));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
type Row = { url: string; category: string; source: string; probe: Probe };
const rows: Row[] = [];

async function probeAll(items: Omit<Row, "probe">[]) {
  // Mix sites so workers are not all queued behind one host's two connections.
  items.sort((a, b) => hash(a.url).localeCompare(hash(b.url)));
  let finished = 0;
  await probeMany(items, async (item) => {
    rows.push({ ...item, probe: await probePage(item.url) });
    if (++finished % 100 === 0) console.error(`probed ${finished}/${items.length}`);
  }, concurrency);
}

function table(key: (row: Row) => string) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  const lines = [...groups].sort().map(([name, group]) => {
    const count = (v: string) => group.filter((r) => r.probe.verdict === v).length;
    const reasons = new Map<string, number>();
    for (const r of group) if (r.probe.verdict !== "easy") reasons.set(r.probe.reason, (reasons.get(r.probe.reason) ?? 0) + 1);
    const top = [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} ${n}`).join(", ");
    const testable = group.length - count("dead");
    const share = testable ? Math.round((100 * count("hard")) / testable) : 0;
    return `${name.padEnd(40)} ${String(group.length).padStart(5)} ${String(count("easy")).padStart(5)} ${String(count("hard")).padStart(5)} ${String(count("dead")).padStart(5)} ${String(share).padStart(4)}%  ${top}`;
  });
  console.log(`${"group".padEnd(40)} ${"pages".padStart(5)} ${"easy".padStart(5)} ${"hard".padStart(5)} ${"dead".padStart(5)} ${"hard".padStart(5)}  non-easy reasons`);
  console.log(lines.join("\n"));
}

if (mode === "sources") {
  const category = flag("category");
  const perSource = Number(flag("per-source", "40"));
  const day = new Date().toISOString().slice(0, 10);
  const file = flag("registry");
  const sources = file ? (JSON.parse(readFileSync(file, "utf8")) as Source[]) : (registry as Source[]);
  const selected = sources.filter((s) => !category || s.category === category);
  const items: Omit<Row, "probe">[] = [];
  const supply: string[] = [];
  await probeMany(selected, async (source) => {
    try {
      const found = await discoverSource(source);
      supply.push(`${source.source_id.padEnd(40)} ${String(found.length).padStart(5)} candidates`);
      found.sort((a, b) => hash(day + a.id).localeCompare(hash(day + b.id)));
      for (const c of found.slice(0, perSource))
        items.push({ url: c.url, category: c.category, source: source.source_id });
    } catch (error) {
      supply.push(`${source.source_id.padEnd(40)} ERROR ${(error as Error).message.slice(0, 60)}`);
    }
  }, 8);
  console.log(supply.sort().join("\n") + "\n");
  await probeAll(items);
  console.log("\nBy source");
  table((r) => r.source);
} else if (mode === "urls" && args[1]) {
  const text = readFileSync(args[1], "utf8");
  const items = new Map<string, Omit<Row, "probe">>();
  for (const line of text.split("\n").filter(Boolean)) {
    if (line.startsWith("{")) {
      const r = JSON.parse(line);
      items.set(r.url, { url: r.url, category: r.category ?? "", source: new URL(r.url).hostname });
    } else items.set(line.trim(), { url: line.trim(), category: "", source: new URL(line.trim()).hostname });
  }
  await probeAll([...items.values()]);
} else {
  console.error("Usage: tsx scripts/probe.ts sources [--category id] [--per-source n] | urls <file> [--out file]");
  process.exit(1);
}
console.log("\nBy category");
table((r) => r.category || "(none)");
const out = flag("out");
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
