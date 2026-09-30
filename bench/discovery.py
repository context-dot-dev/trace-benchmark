"""Independent, free URL discovery. No page-reader or paid-search dependency.

Raw feed responses are immutable receipts. Candidates are metadata-only discovery,
not assertions that a target page exists, matches the API, or is readable.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import email.utils
import hashlib
import ipaddress
import json
from pathlib import Path
import socket
import threading
import time
from urllib import error, parse, request
import uuid
import xml.etree.ElementTree as ET

CATEGORIES = ("news", "commerce", "jobs", "finance_filings", "research",
              "legal_regulatory", "software_docs", "community_social")
PARSER_VERSION = "independent-discovery-v1"
MAX_BYTES = 12_000_000
TIMEOUT_S = 20
PACE_S = 0.35
USER_AGENT = "Context.dev Research/0.1 (https://context.dev; public-feed-supply-study)"


def _now():
    return datetime.now(timezone.utc)


def canonical_url(url):
    """Drop only known tracking parameters/fragments; preserve resource identity."""
    if not isinstance(url, str) or any(ord(c) < 32 for c in url):
        raise ValueError("Invalid URL")
    p = parse.urlsplit(url.strip())
    if p.scheme.lower() not in ("http", "https") or not p.hostname or p.username or p.password:
        raise ValueError("Public HTTP(S) URL without credentials required")
    host = p.hostname.lower().rstrip(".")
    if host in {"localhost", "localhost.localdomain"} or host.endswith((".localhost", ".local", ".internal")):
        raise ValueError("Private host prohibited")
    try:
        if not ipaddress.ip_address(host).is_global:
            raise ValueError("Non-public IP prohibited")
    except ValueError as exc:
        if "prohibited" in str(exc):
            raise
        if "." not in host or "\\" in host:
            raise ValueError("Public hostname required") from exc
    port = p.port  # Validate malformed port numbers.
    authority = f"[{host}]" if ":" in host else host
    if port and not ((p.scheme == "https" and port == 443) or (p.scheme == "http" and port == 80)):
        authority += f":{port}"
    # Keep encoded values/order verbatim: decoding query pairs can change signed URLs.
    query = "&".join(part for part in p.query.split("&") if part and not (
        parse.unquote_plus(part.split("=", 1)[0]).lower().startswith("utm_") or
        parse.unquote_plus(part.split("=", 1)[0]).lower() in {"at_medium", "at_campaign"}))
    return parse.urlunsplit((p.scheme.lower(), authority, p.path or "/", query, ""))


def candidate_id(url):
    return hashlib.sha256(canonical_url(url).encode()).hexdigest()


def _public_destination(url):
    clean = canonical_url(url)
    p = parse.urlsplit(clean)
    addresses = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == "https" else 80), type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(x[4][0]).is_global for x in addresses):
        raise ValueError("Discovery destination resolves to a non-public address")
    return clean


class _PublicRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _public_destination(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _date(raw):
    """Never turn an unknown/timezone-less timestamp into a known publication."""
    if not raw or not isinstance(raw, str):
        return None, "unknown"
    raw = raw.strip()
    try:
        if len(raw) == 10:
            return datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=timezone.utc), "date"
        try:
            value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            value = email.utils.parsedate_to_datetime(raw)
        if value.tzinfo is None:
            return None, "timezone_unknown"
        return value.astimezone(timezone.utc), "timestamp"
    except (ValueError, TypeError, OverflowError):
        return None, "unparseable"


def _epoch(value, divisor=1):
    return datetime.fromtimestamp(value / divisor, timezone.utc).isoformat() if value is not None else None


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _text(node, name):
    return next((x.text for x in node if _local(x.tag) == name), None)


class _Collector:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.host_locks = defaultdict(threading.Lock)
        self.lock = threading.Lock()

    def fetch(self, source, url):
        rec = {"source_id": source["source_id"], "url": url, "status": "error",
               "error": None, "http_status": None, "raw_path": None, "sha256": None}
        body = None
        host = parse.urlsplit(url).netloc
        with self.lock:
            host_lock = self.host_locks[host]
        with host_lock:
            try:
                _public_destination(url)
                opener = request.build_opener(request.ProxyHandler({}), _PublicRedirect())
                with opener.open(request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"}), timeout=TIMEOUT_S) as res:
                    body = res.read(MAX_BYTES + 1)
                    rec.update(http_status=res.status, final_url=res.url,
                               content_type=res.headers.get("Content-Type"))
                if len(body) > MAX_BYTES:
                    raise ValueError("Discovery response exceeds byte cap")
                rec["status"] = "ok"
            except Exception as exc:
                rec["error"] = f"{type(exc).__name__}: {exc}"
                if isinstance(exc, error.HTTPError):
                    rec["http_status"] = exc.code
                    body = exc.read(300_000)
            finally:
                rec["received_at"] = _now().isoformat()
                if body is not None:
                    digest = hashlib.sha256(body).hexdigest()
                    path = self.directory / f"{uuid.uuid4().hex}-{digest}.bin"
                    with path.open("xb") as f:
                        f.write(body)
                    rec.update(raw_path=str(path.resolve()), sha256=digest, bytes=len(body))
                time.sleep(PACE_S)
        return body if rec["status"] == "ok" else None, rec

    def run_source(self, source):
        candidates, rejected, requests = [], [], []
        def get(url, xml=False):
            body, rec = self.fetch(source, url)
            requests.append(rec)
            if body is None:
                return None, rec
            try:
                return ET.fromstring(body) if xml else json.loads(body), rec
            except (ValueError, ET.ParseError) as exc:
                rec.update(status="error", error=f"Parse error: {exc}")
                return None, rec

        def add(rec, url, document_id, title=None, published=None, updated=None, semantics="publisher_publication", metadata=None, language=None):
            extra = dict(metadata or {})
            try:
                clean = canonical_url(url)
            except (ValueError, TypeError) as exc:
                rejected.append({"url": url, "reason": str(exc)})
                return
            if source["category"] == "commerce" and "/products/" not in parse.urlsplit(clean).path:
                rejected.append({"url": url, "reason": "non_product_path"})
                return
            pub, precision = _date(published)
            upd, upd_precision = _date(updated)
            received = datetime.fromisoformat(rec["received_at"])
            if pub and (pub.date() > received.date() if precision == "date" else pub > received):
                rejected.append({"url": url, "reason": "future_publication", "published_raw": published})
                return
            extra.update(original_url=url, aliases=[url, clean], published_raw=published,
                         updated_raw=updated, publication_precision=precision, update_precision=upd_precision,
                         publication_semantics=semantics, discovery_url=rec["url"], discovery_observed_at=rec["received_at"],
                         raw_path=rec["raw_path"], raw_sha256=rec["sha256"],
                         parser_version=PARSER_VERSION, identity_status="metadata_only_unverified_target",
                         target_host=parse.urlsplit(clean).hostname,
                         language_basis="item_metadata" if language else "unknown")
            candidates.append(dict(id=candidate_id(clean), url=clean, title=title,
                category=source["category"], source_id=source["source_id"], organization=source["organization"],
                published_at=(pub.date().isoformat() if precision == "date" else pub.isoformat()) if pub else None,
                updated_at=(upd.date().isoformat() if upd_precision == "date" else upd.isoformat()) if upd else None,
                discovered_at=rec["received_at"], document_id=str(document_id or clean),
                language=language or "unknown", metadata=extra))

        adapter_error = None
        try:
            kind = source["kind"]
            v, rec = get(source["url"], kind in {"feed", "sitemap"})
            if v is not None and kind == "feed":
                feed_language = next((x.text for x in v.iter() if _local(x.tag) == "language"), None)
                feed_language = feed_language or v.get("{http://www.w3.org/XML/1998/namespace}lang")
                for item in (x for x in v.iter() if _local(x.tag) in {"item", "entry"}):
                    links = [x for x in item if _local(x.tag) == "link"]
                    link = next((x for x in links if x.get("rel", "alternate") == "alternate" and x.get("type", "text/html") == "text/html"), None)
                    if link is None and links:
                        link = links[0]
                    url = (link.get("href") or link.text) if link is not None else None
                    language = item.get("{http://www.w3.org/XML/1998/namespace}lang") or feed_language
                    add(rec, url, _text(item, "id") or _text(item, "guid"), _text(item, "title"),
                        _text(item, "published") or _text(item, "pubDate") or _text(item, "date"),
                        _text(item, "updated"), language=language)
            elif v is not None and kind == "sitemap":
                if _local(v.tag) == "sitemapindex":
                    children = [x.text for x in v.iter() if _local(x.tag) == "loc"]
                    child = next((u for u in children if u and "product" in u.lower()), None)
                    if not child:
                        raise ValueError("No product sitemap in index")
                    v, rec = get(child, True)
                if v is not None:
                    for item in (x for x in v if _local(x.tag) == "url"):
                        url = _text(item, "loc")
                        add(rec, url, url, updated=_text(item, "lastmod"), semantics="no_publication_field",
                            metadata={"first_product_sitemap_only": True, "lastmod_not_publication": True})
            elif v is not None and kind == "greenhouse":
                for x in v.get("jobs", []):
                    add(rec, x["absolute_url"], x["id"], x.get("title"), x.get("first_published"), x.get("updated_at"))
            elif v is not None and kind == "lever":
                for x in v:
                    add(rec, x["hostedUrl"], x["id"], x.get("text"), _epoch(x.get("createdAt"), 1000),
                        semantics="posting_created_not_verified_first_publication")
            elif v is not None and kind == "sec":
                filings = v.get("filings", {}).get("recent", {})
                for i, form in enumerate(filings.get("form", [])):
                    if form not in {"10-K", "10-Q", "8-K", "20-F", "6-K"} or not filings["primaryDocument"][i]:
                        continue
                    acc = filings["accessionNumber"][i]
                    url = f"https://www.sec.gov/Archives/edgar/data/{int(v['cik'])}/{acc.replace('-', '')}/{filings['primaryDocument'][i]}"
                    add(rec, url, acc, form, filings["filingDate"][i], semantics="filing_date",
                        metadata={"derived_from_official_fields": True, "form": form})
            elif v is not None and kind == "fr":
                for x in v.get("results", []):
                    add(rec, x["html_url"], x["document_number"], x.get("title"), x.get("publication_date"),
                        metadata={"agencies": [a.get("name") for a in x.get("agencies", [])]})
            elif v is not None and kind == "github":
                for x in v:
                    if not x.get("draft"):
                        add(rec, x["html_url"], x["id"], x.get("name"), x.get("published_at"),
                            metadata={"tag": x.get("tag_name"), "prerelease": x.get("prerelease"), "release_page_not_manual": True})
            elif v is not None and kind == "bluesky":
                for x in v.get("feed", []):
                    if x.get("reason"):
                        continue
                    post = x["post"]
                    if post["author"].get("handle", "").lower() != source["actor"].lower():
                        continue
                    uri = post["uri"]
                    did, collection, key = uri[5:].split("/")
                    if not uri.startswith("at://") or collection != "app.bsky.feed.post":
                        continue
                    add(rec, f"https://bsky.app/profile/{did}/post/{key}", uri, post["record"].get("text", "")[:160],
                        post["record"].get("createdAt"), semantics="author_claimed_creation_time",
                        metadata={"indexed_at": post.get("indexedAt"), "cid": post.get("cid")},
                        language=(post["record"].get("langs") or [None])[0])
            elif v is not None and kind == "stack":
                for x in v.get("items", []):
                    add(rec, x["link"], x["question_id"], x.get("title"), _epoch(x.get("creation_date")),
                        metadata={"question_not_answer": True})
            elif v is not None and kind == "hn":
                for ident in v[:5]:
                    x, ir = get(f"https://hacker-news.firebaseio.com/v0/item/{ident}.json")
                    if x and not x.get("deleted") and not x.get("dead"):
                        add(ir, f"https://news.ycombinator.com/item?id={x['id']}", x["id"], x.get("title"), _epoch(x.get("time")),
                            metadata={"outgoing_url": x.get("url"), "discussion_page": True})
            elif kind not in {"feed", "sitemap", "greenhouse", "lever", "sec", "fr", "github", "bluesky", "stack", "hn"}:
                raise ValueError(f"Unsupported source adapter: {kind}")
        except Exception as exc:
            adapter_error = f"{type(exc).__name__}: {exc}"
        failures = [r["error"] for r in requests if r["status"] != "ok"]
        if adapter_error:
            failures.append(adapter_error)
        receipt = dict(source_id=source["source_id"], status=("partial" if candidates else "error") if failures else "ok",
                       error="; ".join(failures) if failures else None, candidate_count=len(candidates),
                       received_at=_now().isoformat(), requests=requests, exclusions=rejected)
        first = requests[0] if requests else {}
        receipt.update({key: first.get(key) for key in ("raw_path", "sha256", "http_status")})
        return candidates, receipt


def discover(sources: list[dict], receipts_dir: Path, limit_sources: int | None = None) -> dict:
    """Collect registered free metadata endpoints, bounded to one page per source.

    Each call uses new immutable receipt files. Never silently refresh a source
    registry or omit a failed source. `limit_sources` is a development request cap.
    """
    if limit_sources is not None and limit_sources < 0:
        raise ValueError("limit_sources must be nonnegative")
    chosen = [dict(s) for s in (sources if limit_sources is None else sources[:limit_sources])]
    ids = [s["source_id"] for s in chosen]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate source IDs")
    collector = _Collector(receipts_dir)
    snapshot = Path(receipts_dir) / f"registry-{uuid.uuid4().hex}.json"
    with snapshot.open("x") as f:
        json.dump(chosen, f, indent=2)
    with ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(collector.run_source, chosen))
    return {"candidates": [c for candidates, _ in results for c in candidates],
            "receipts": [r for _, r in results], "sources": chosen,
            "registry_path": str(snapshot.resolve()), "parser_version": PARSER_VERSION}


def identity_keys(candidate):
    """Keys the persistent seen registry must retain for every selected document."""
    aliases = [candidate["url"], *(candidate.get("metadata", {}).get("aliases") or [])]
    keys = {candidate_id(url) for url in aliases}
    keys.add(candidate["id"])
    keys.add("doc:" + str(candidate["organization"]) + ":" + str(candidate.get("document_id") or canonical_url(candidate["url"])))
    return keys


def select_candidates(candidates, seen_ids: set, per_category: int, seed: str, organization_cap: int = 5,
                      organization_used: dict | None = None, hostname_cap: int | None = None,
                      hostname_used: dict | None = None):
    """Stable organization round robin with one global per-organization cap.

    `seed` must contain the committed epoch/date/batch identity. Existing aliases
    may be passed as hashed canonical URLs in seen_ids. Returns explicit shortfalls;
    never borrow another category's quota or condition on reader outcomes.
    """
    if per_category < 0 or organization_cap < 1:
        raise ValueError("Invalid quota or organization cap")
    if hostname_cap is not None and (type(hostname_cap) is not int or hostname_cap < 1):
        raise ValueError("Invalid hostname cap")
    prior_host_counts=Counter(hostname_used or {})
    if any(type(n) is not int or n < 0 for n in prior_host_counts.values()):
        raise ValueError("Invalid prior hostname counts")
    host_counts=Counter()
    rank = {c: i for i, c in enumerate(CATEGORIES)}
    excluded, eligible, used_keys = [], [], set()
    prior_organization_counts = Counter(organization_used or {})
    if any(not isinstance(n, int) or n < 0 for n in prior_organization_counts.values()):
        raise ValueError("Invalid prior organization counts")
    # Union all explicit aliases before selection, including chains through rows
    # that will themselves be excluded. Otherwise A~B~C can select both A and C.
    parents = {}
    def root(key):
        parents.setdefault(key, key)
        while parents[key] != key:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key
    row_keys = {}
    for index, candidate in enumerate(candidates):
        try:
            keys = identity_keys(candidate)
            anchor = min(keys)
            for key in keys:
                parents[root(key)] = root(anchor)
            row_keys[index] = keys
        except (ValueError, TypeError):
            row_keys[index] = set()
    seen_groups = {root(key) for key in seen_ids if key in parents}
    # UTC batch date is taken from discovery receipts, not wall clock at replay.
    as_of = max((str(c.get("metadata", {}).get("discovery_observed_at") or c.get("discovered_at", "")) for c in candidates), default="")
    cutoff_time, _ = _date(as_of)
    def hashed(*parts):
        return hashlib.sha256(json.dumps([seed, *parts], separators=(",", ":")).encode()).hexdigest()
    ordered = sorted(enumerate(candidates), key=lambda pair: (rank.get(pair[1]["category"], 999), pair[1]["source_id"], pair[1]["id"]))
    for index, c in ordered:
        reason = None
        keys = row_keys[index]
        group = root(min(keys)) if keys else None
        if not keys:
            reason = "invalid_public_url"
        elif c["category"] not in rank:
            reason = "unregistered_category"
        elif str(c.get("language", "unknown")).lower().split("-")[0] not in {"en", "unknown", "none", ""}:
            reason = "non_english_metadata"
        elif keys & seen_ids or group in seen_groups:
            reason = "already_seen"
        elif group in used_keys:
            reason = "duplicate_or_alias"
        if reason is None:
            used_keys.add(group)
            eligible.append(c)
        else:
            excluded.append({"id": c["id"], "reason": reason})
    counts, organization_counts = Counter(), Counter()
    selected = []
    for category in CATEGORIES:
        buckets = defaultdict(list)
        for c in eligible:
            if c["category"] == category:
                buckets[c["organization"]].append(c)
        def url_order(c):
            pub, _ = _date(c.get("published_at"))
            recent = bool(pub and cutoff_time and cutoff_time - timedelta(days=7) <= pub <= cutoff_time)
            return (0 if recent else 1, hashed(c["id"]))
        for bucket in buckets.values():
            bucket.sort(key=url_order)
        organizations = sorted(buckets, key=lambda org: hashed(category, org))
        while counts[category] < per_category:
            progressed = False
            for org in organizations:
                if counts[category] >= per_category:
                    break
                if prior_organization_counts[org] + organization_counts[org] < organization_cap and buckets[org]:
                    while buckets[org]:
                        item=buckets[org].pop(0)
                        host=parse.urlsplit(item['url']).hostname
                        if hostname_cap is None or prior_host_counts[host]+host_counts[host]<hostname_cap:
                            break
                    else:
                        continue
                    selected.append(item)
                    host_counts[host]+=1
                    counts[category] += 1
                    organization_counts[org] += 1
                    progressed = True
            if not progressed:
                break
    selected_ids = {c["id"] for c in selected}
    return {"selected": selected, "shortfalls": {c: per_category - counts[c] for c in CATEGORIES},
            "counts": {c: counts[c] for c in CATEGORIES}, "organization_counts": dict(organization_counts),
            "hostname_counts": dict(host_counts), "hostname_cap": hostname_cap,
            "organization_usage_after": dict(prior_organization_counts + organization_counts),
            "excluded": excluded, "overflow": [c["id"] for c in eligible if c["id"] not in selected_ids],
            "seed": seed, "category_order": list(CATEGORIES), "as_of": as_of,
            "unknown_language_selected": sum(c.get("language", "unknown") == "unknown" for c in selected)}
