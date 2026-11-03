import { createHash } from "node:crypto";
import { lookup } from "node:dns";
import { Agent, fetch as publicFetch } from "undici";
import ipaddr from "ipaddr.js";
import { XMLParser } from "fast-xml-parser";
import study from "../../../public/data/wikipedia-study.json";
import type { Candidate } from "./types";
export type Source = {
  source_id: string;
  url: string;
  kind: string;
  category: string;
  organization: string;
  poll_interval_hours: number;
  max_sitemaps?: number;
  sitemap_filter?: string;
  url_contains?: string;
  actor?: string;
};
const dispatcher = new Agent({
  connections: 2,
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true }, (error, addresses) => {
        if (error) return callback(error, "", 4);
        if (
          !addresses.length ||
          addresses.some((a) => ipaddr.process(a.address).range() !== "unicast")
        )
          return callback(new Error("PRIVATE_DESTINATION"), "", 4);
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      });
    },
  },
});
export function canonical(url: string) {
  const u = new URL(url);
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    !u.hostname.includes(".") ||
    u.hostname.endsWith(".local") ||
    u.hostname.endsWith(".internal") ||
    u.hostname.endsWith(".localhost") ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw new Error("INVALID_URL");
  if (
    ipaddr.isValid(u.hostname.replace(/^\[|\]$/g, "")) &&
    ipaddr.process(u.hostname.replace(/^\[|\]$/g, "")).range() !== "unicast"
  )
    throw new Error("PRIVATE_DESTINATION");
  u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (key.startsWith("utm_") || ["at_medium", "at_campaign"].includes(key))
      u.searchParams.delete(key);
  return u.href;
}
export async function fetchPublic(url: string, deadline?: AbortSignal) {
  const signal = AbortSignal.any([
    AbortSignal.timeout(20000),
    ...(deadline ? [deadline] : []),
  ]);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await publicFetch(canonical(url), {
      dispatcher,
      signal,
      redirect: "manual",
      headers: {
        "User-Agent": "Context.dev Research (https://context.dev)",
        Accept: "application/json, application/xml, text/xml, */*",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) throw new Error("INVALID_REDIRECT");
      url = new URL(next, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("SOURCE_HTTP_" + response.status);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw new Error("EMPTY_SOURCE");
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 12_000_000) throw new Error("SOURCE_TOO_LARGE");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("TOO_MANY_REDIRECTS");
}
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  processEntities: false,
});
const list = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string =>
  typeof v === "object"
    ? String((v as Record<string, unknown> | null)?.["#text"] ?? "")
    : String(v ?? "");
export async function discoverSource(
  source: Source,
  options: { now?: Date; read?: (url: string) => Promise<string> } = {},
): Promise<Candidate[]> {
  const deadline = AbortSignal.timeout(source.kind === "wikipedia" ? 120000 : 40000);
  const read = options.read ?? ((url: string) => fetchPublic(url, deadline));
  const now = options.now ?? new Date();
  if (source.kind === "wikipedia") return discoverWikipedia(source, now, read);
  const found: Candidate[] = [];
  const add = (
    url: unknown,
    title: unknown = "",
    document: unknown = url,
    organization = source.organization,
  ) => {
    try {
      const clean = canonical(String(url));
      if (
        source.category === "commerce" &&
        !new URL(clean).pathname.includes("/products/")
      )
        return;
      const id = createHash("sha256")
        .update(organization + "\0" + text(document || clean))
        .digest("hex");
      found.push({
        id,
        url: clean,
        title: text(title).slice(0, 500).toWellFormed(),
        category: source.category,
        organization,
        sourceId: source.source_id,
        discoveredAt: now,
      });
    } catch {
    }
  };
  const raw = await read(
    source.url.replace("{utc_date}", now.toISOString().slice(0, 10)),
  );
  const v = ["feed", "sitemap", "sec_xbrl"].includes(source.kind)
    ? xml.parse(raw)
    : JSON.parse(raw);
  if (source.kind === "feed")
    for (const item of [
      ...list(v.rss?.channel?.item),
      ...list(v.feed?.entry),
      ...list(v.RDF?.item),
    ]) {
      const links = list(item.link);
      const link = links.find((x) => x?.["@rel"] === "alternate") ?? links[0];
      add(
        link?.["@href"] ?? text(link),
        item.title,
        item.id ?? item.guid ?? link?.["@href"] ?? text(link),
      );
    }
  else if (source.kind === "sitemap") {
    let docs = [v];
    if (v.sitemapindex) {
      const filter =
        source.sitemap_filter ??
        (source.category === "commerce" ? "product" : "");
      const children = list(v.sitemapindex.sitemap)
        .map((x) => text(x.loc))
        .filter((u) => u.includes(filter));
      const limit = Math.min(4, source.max_sitemaps ?? 1);
      const offset =
        (Math.floor(Date.now() / 3600000) * limit) %
        Math.max(1, children.length);
      docs = await Promise.all(
        [...children.slice(offset), ...children.slice(0, offset)]
          .slice(0, limit)
          .map(async (u) => xml.parse(await read(u))),
      );
    }
    for (const doc of docs)
      for (const item of list(doc.urlset?.url)) {
        const u = text(item.loc);
        if (!source.url_contains || u.includes(source.url_contains)) add(u);
      }
  } else if (source.kind === "greenhouse")
    for (const item of v.jobs ?? [])
      add(item.absolute_url, item.title, item.id);
  else if (source.kind === "lever")
    for (const item of v) add(item.hostedUrl, item.text, item.id);
  else if (source.kind === "sec") {
    const r = v.filings?.recent ?? {};
    for (let i = 0; i < (r.form?.length ?? 0); i++)
      if (
        ["10-K", "10-Q", "8-K", "20-F", "6-K"].includes(r.form[i]) &&
        r.primaryDocument[i]
      )
        add(
          `https://www.sec.gov/Archives/edgar/data/${Number(v.cik)}/${r.accessionNumber[i].replaceAll("-", "")}/${r.primaryDocument[i]}`,
          r.form[i],
          r.accessionNumber[i],
        );
  } else if (source.kind === "sec_xbrl")
    for (const item of list(v.rss?.channel?.item)) {
      const f = item.xbrlFiling;
      if (!f) continue;
      const primary = list(f.xbrlFiles?.xbrlFile).find(
        (x) =>
          x["@type"] === text(f.formType) && /\.html?$/.test(x["@url"] ?? ""),
      );
      if (primary)
        add(
          primary["@url"],
          item.title,
          text(f.accessionNumber),
          "SEC issuer " + Number(text(f.cikNumber)),
        );
    }
  else if (source.kind === "fr")
    for (const item of v.results ?? [])
      add(item.html_url, item.title, item.document_number);
  else if (source.kind === "github") {
    for (const item of v)
      if (!item.draft) add(item.html_url, item.name, item.id);
  } else if (source.kind === "crossref") {
    for (const item of v.message?.items ?? [])
      if (item.type === "journal-article" && item.DOI && item.publisher)
        add(
          item.resource?.primary?.URL ?? item.URL,
          item.title?.[0],
          item.DOI,
          item.publisher,
        );
  } else if (source.kind === "stack")
    for (const item of v.items ?? [])
      add(item.link, item.title, item.question_id);
  else if (source.kind === "bluesky")
    for (const item of v.feed ?? []) {
      const p = item.post;
      if (
        item.reason ||
        !p ||
        p.author?.handle?.toLowerCase() !== source.actor?.toLowerCase()
      )
        continue;
      const parts = p.uri?.match(
        /^at:\/\/([^/]+)\/app.bsky.feed.post\/([^/]+)$/,
      );
      if (parts)
        add(
          `https://bsky.app/profile/${parts[1]}/post/${parts[2]}`,
          p.record?.text,
          p.uri,
        );
    }
  else if (source.kind === "hn")
    for (const id of v.slice(0, 5)) {
      const item = JSON.parse(
        await read(`https://hacker-news.firebaseio.com/v0/item/${id}.json`),
      );
      if (item && !item.dead && !item.deleted)
        add(`https://news.ycombinator.com/item?id=${id}`, item.title, id);
    }
  return [...new Map(found.map((c) => [c.id, c])).values()].slice(-1500);
}

const historicalWikipediaUrls = new Set(
  study.pages.map((page) => canonical(page.url)),
);
function externalLinks(wikitext: string) {
  const clean = wikitext
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<nowiki\b[^>]*>[\s\S]*?<\/nowiki>/gi, "");
  const urls = new Set<string>();
  for (const match of clean.matchAll(/https?:\/\/[^\s<>"'\[\]{}|]+/g)) {
    try {
      const url = canonical(match[0].replace(/&amp;/g, "&"));
      const host = new URL(url).hostname;
      if (!/(^|\.)(wikipedia|wikimedia|wikidata|mediawiki)\.org$/i.test(host))
        urls.add(url);
    } catch {}
  }
  return urls;
}
async function discoverWikipedia(
  source: Source,
  now: Date,
  read: (url: string) => Promise<string>,
): Promise<Candidate[]> {
  const request = async (params: Record<string, string>) => {
    const url = new URL(source.url);
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      maxlag: "5",
      ...params,
    }).toString();
    let data;
    try {
      data = JSON.parse(await read(url.href));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new Error("WIKIPEDIA_INVALID_JSON");
      throw error;
    }
    if (data.error) throw new Error("WIKIPEDIA_API_" + String(data.error.code));
    return data;
  };
  const edits: {
    title: string;
    revid: number;
    old_revid: number;
    timestamp: string;
  }[] = [];
  const dayEnd = new Date(now);
  dayEnd.setUTCHours(0, 0, 0, 0);
  const dayStart = dayEnd.getTime() - 24 * 3600000;
  for (let hour = 0; hour < 24; hour += 4) {
    const windows = await Promise.all(
      Array.from({ length: 4 }, async (_, i) => {
        const start = dayStart + (hour + i) * 3600000;
        const changes = await request({
          list: "recentchanges",
          rcnamespace: "0",
          rctype: "edit|new",
          rcshow: "!bot|!redirect",
          rcprop: "title|ids|timestamp",
          rclimit: "50",
          rcstart: new Date(start + 3600000 - 1000).toISOString(),
          rcend: new Date(start).toISOString(),
          rcdir: "older",
        });
        if (!Array.isArray(changes.query?.recentchanges))
          throw new Error("WIKIPEDIA_INVALID_CHANGES");
        return changes.query.recentchanges;
      }),
    );
    edits.push(...windows.flat());
  }
  if (
    edits.some(
      (e) =>
        typeof e.title !== "string" ||
        !Number.isSafeInteger(e.revid) ||
        e.revid <= 0 ||
        !Number.isSafeInteger(e.old_revid) ||
        e.old_revid < 0 ||
        !Number.isFinite(Date.parse(e.timestamp)),
    )
  )
    throw new Error("WIKIPEDIA_INVALID_REVISION");
  const ids = [
    ...new Set(edits.flatMap((e) => [e.revid, e.old_revid]).filter(Boolean)),
  ];
  const contents = new Map<number, string>();
  const hidden = new Set<number>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    await Promise.all(
      Array.from(
        { length: Math.min(4, Math.ceil((ids.length - offset) / 25)) },
        async (_, i) => {
          const start = offset + i * 25;
          const data = await request({
            prop: "revisions",
            revids: ids.slice(start, start + 25).join("|"),
            rvprop: "ids|content",
            rvslots: "main",
          });
          if (!Array.isArray(data.query?.pages))
            throw new Error("WIKIPEDIA_INVALID_CONTENT");
          for (const page of data.query.pages) {
            for (const revision of page.revisions ?? []) {
              if (
                Number.isSafeInteger(revision.revid) &&
                revision.slots?.main?.texthidden === true
              )
                hidden.add(revision.revid);
              if (
                Number.isSafeInteger(revision.revid) &&
                typeof revision.slots?.main?.content === "string"
              )
                contents.set(revision.revid, revision.slots.main.content);
            }
          }
        },
      ),
    );
  }
  const readableEdits = edits.filter(
    (edit) => !hidden.has(edit.revid) && !hidden.has(edit.old_revid),
  );
  if (edits.length && !readableEdits.length)
    throw new Error("WIKIPEDIA_REVISION_UNAVAILABLE");
  if (readableEdits.length !== edits.length)
    console.warn(
      "Wikipedia discovery skipped edits with hidden revision text:",
      edits.length - readableEdits.length,
    );
  const found = new Map<string, Candidate>();
  for (const edit of readableEdits) {
    const current = contents.get(edit.revid);
    const previous = edit.old_revid ? contents.get(edit.old_revid) : "";
    if (current === undefined || previous === undefined)
      throw new Error("WIKIPEDIA_REVISION_UNAVAILABLE");
    const oldLinks = externalLinks(previous);
    for (const url of externalLinks(current)) {
      if (
        oldLinks.has(url) ||
        historicalWikipediaUrls.has(url) ||
        found.has(url)
      )
        continue;
      found.set(url, {
        id: createHash("sha256").update(url).digest("hex"),
        url,
        title: "",
        category: "other",
        organization: new URL(url).hostname,
        sourceId: source.source_id,
        discoveredAt: now,
        provenance: {
          source: "wikipedia",
          article: edit.title,
          revision: edit.revid,
          timestamp: edit.timestamp,
        },
      });
    }
  }
  return [...found.values()];
}
