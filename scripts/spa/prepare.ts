import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

type Platform = "workday" | "dayforce" | "eightfold";
type InventoryEntry = { csv: string; sha256: string; size_bytes: number; rows: number };
type Candidate = { url: string; organization: string; platform: Platform; organizationKey: string; source: string; id: string };
const platforms: Platform[] = ["workday", "dayforce", "eightfold"];
const sha256 = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ",") {
      row.push(field); field = ""; closed = false;
    } else if (char === "\n" || char === "\r") {
      row.push(field); records.push(row); row = []; field = ""; closed = false;
      if (char === "\r" && text[index + 1] === "\n") index++;
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error("Malformed CSV quoting");
      field += char;
    }
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (row.length || field || closed) { row.push(field); records.push(row); }
  return records;
}
function candidateURL(raw: string, platform: Platform, slug: string) {
  const url = new URL(raw);
  if (/[\u0000-\u0020\u007f]/.test(raw) || url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") || isIP(url.hostname.replace(/^\[|\]$/g, "")) || /\.(?:local|internal|localhost)$/.test(url.hostname))
    throw new Error(`Invalid public candidate URL: ${raw}`);
  if (platform === "workday" && !url.hostname.endsWith(".myworkdayjobs.com")) throw new Error("Workday URL has the wrong platform hostname");
  if (platform === "dayforce" && !url.hostname.endsWith(".dayforcehcm.com")) throw new Error("Dayforce URL has the wrong platform hostname");
  const tenant = platform === "dayforce" ? url.pathname.split("/").filter(Boolean)[0]
    : platform === "eightfold" && !url.hostname.endsWith(".eightfold.ai") ? slug
      : url.hostname.split(".")[0];
  if (!tenant?.trim()) throw new Error(`Candidate URL has no ${platform} tenant: ${raw}`);
  return `${platform}:${tenant}`;
}
async function atomicWrite(file: string, contents: string) {
  await writeFile(file + ".tmp", contents);
  await rename(file + ".tmp", file);
}
async function main() {
  const { values } = parseArgs({ options: { inventory: { type: "string" }, sources: { type: "string" }, out: { type: "string" }, seed: { type: "string", default: "trace-spa-v1-20261115" } } });
  if (!values.inventory || !values.sources || !values.out || !values.seed?.trim()) throw new Error("Usage: tsx scripts/spa/prepare.ts --inventory inventory-manifest.json --sources raw-csv-directory --out candidates.jsonl [--seed trace-spa-v1-20261115]");
  const rawInventory = await readFile(values.inventory);
  const inventory = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawInventory)) as { generated_at?: string; by_ats_companies?: Partial<Record<Platform, InventoryEntry>> };
  const sources = await Promise.all(platforms.map(async (platform) => {
    const entry = inventory.by_ats_companies?.[platform];
    if (!entry || typeof entry.csv !== "string" || !/^[a-f\d]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 0 || !Number.isSafeInteger(entry.rows) || entry.rows < 0)
      throw new Error(`Invalid or missing inventory metadata for ${platform}`);
    const source = new URL(entry.csv);
    if (source.protocol !== "https:" || source.username || source.password) throw new Error(`Invalid source URL for ${platform}`);
    const bytes = await readFile(path.join(values.sources!, platform + ".csv"));
    if (bytes.length !== entry.size_bytes || sha256(bytes) !== entry.sha256) throw new Error(`${platform} source bytes do not match the inventory SHA-256 and size`);
    return { platform, entry, bytes };
  }));
  const candidates: Candidate[] = [];
  for (const { platform, entry, bytes } of sources) {
    const records = csvRecords(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const header = records.shift()?.map((column) => column.trim()) ?? [];
    if (new Set(header).size !== header.length || !["name", "slug", "url"].every((column) => header.includes(column))) throw new Error(`Invalid CSV header for ${platform}`);
    if (records.length !== entry.rows) throw new Error(`${platform} logical CSV row count ${records.length} does not match inventory ${entry.rows}`);
    for (const cells of records) {
      if (cells.length !== header.length) throw new Error(`${platform} CSV record has the wrong number of fields`);
      const record = Object.fromEntries(header.map((column, index) => [column, cells[index]]));
      if (!record.name.trim() || !record.slug.trim()) throw new Error(`${platform} CSV record lacks company or tenant identity`);
      candidates.push({ url: record.url, organization: record.name, platform, organizationKey: candidateURL(record.url, platform, record.slug), source: entry.csv, id: sha256(record.url).slice(0, 20) });
    }
  }
  const ordered = candidates.map((candidate) => ({ candidate, rank: sha256(values.seed + ":" + candidate.url) })).sort((a, b) => compare(a.rank, b.rank) || compare(a.candidate.url, b.candidate.url));
  const organizations = new Set<string>(), urls = new Set<string>();
  const selected = ordered.flatMap(({ candidate }) => {
    if (organizations.has(candidate.organizationKey) || urls.has(candidate.url)) return [];
    organizations.add(candidate.organizationKey); urls.add(candidate.url);
    return [candidate];
  });
  if (!selected.length) throw new Error("No company candidates in the selected inventories");
  const output = selected.map((candidate) => JSON.stringify(candidate)).join("\n") + "\n";
  const file = path.resolve(values.out);
  const provenance = {
    protocol: "trace-spa-candidates-v1", seed: values.seed, generatedAt: new Date().toISOString(), inventoryGeneratedAt: inventory.generated_at ?? null,
    inventorySha256: sha256(rawInventory), sourceRows: candidates.length, candidateCount: selected.length, candidatesSha256: sha256(output),
    platforms: Object.fromEntries(sources.map(({ platform, entry }) => [platform, { ...entry, selected: selected.filter((candidate) => candidate.platform === platform).length }])),
    tenantRule: "Workday/Eightfold hosted subdomain; Dayforce first path component; Eightfold custom domains use the source tenant slug. Preserve path/slug case.",
    limitation: "Company-career inventory candidates are not SPA proof; each selected URL needs browser JavaScript-dependence and same-document navigation verification.",
  };
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, output);
  await atomicWrite(file + ".provenance.json", JSON.stringify(provenance, null, 2) + "\n");
  console.log(JSON.stringify({ ...provenance, output: file }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Candidate preparation failed"); process.exitCode = 1; });
