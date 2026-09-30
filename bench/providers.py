"""Single-attempt live page readers. Returned raw payloads are private evidence."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
import ipaddress
import math
import os
import time
from urllib.parse import urlsplit

import httpx
from .freshness import audit

ENDPOINTS = {
    "context": "https://api.context.dev/v1/web/scrape/markdown",
    "firecrawl": "https://api.firecrawl.dev/v2/scrape",
    "hetzner": "http://127.0.0.1:18089/scrape",
    "exa": "https://api.exa.ai/contents",
    "keenable": "https://api.keenable.ai/v1/fetch",
}
KEYS = {p: p.upper() + "_API_KEY" for p in ("context", "exa", "keenable", "firecrawl")}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def _redact(value, secrets):
    if isinstance(value, str):
        for secret in secrets:
            value = value.replace(secret, "[REDACTED]")
        return value
    if isinstance(value, list):
        return [_redact(v, secrets) for v in value]
    if isinstance(value, dict):
        return {_redact(k, secrets): _redact(v, secrets) for k, v in value.items()}
    return value


def _public_url(url):
    try:
        p = urlsplit(url)
        if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
            return False
        host = p.hostname.lower()
        if host == "localhost" or host.endswith((".localhost", ".local")):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return True
    except (ValueError, TypeError):
        return False


@asynccontextmanager
async def reader_client(config, timeout):
    if config.get('client') is not None:
        yield config['client']
    else:
        async with httpx.AsyncClient(timeout=timeout, transport=config.get('transport'),
                                     follow_redirects=False, trust_env=False) as client:
            yield client


async def fetch_reader(provider: str, url: str, config: dict | None = None) -> dict:
    """Fetch exactly once; no retries, alternate keys, search, or cached fallbacks.

    Keys come from environment. Config: endpoints mapping, timeout_s (<=30),
    max_chars (Keenable explicit cap, default250000), max_response_bytes,
    and optional caller-owned httpx client or test transport. Caller paces requests.
    """
    config = config or {}
    started = time.monotonic()
    receipt = dict(provider=provider, url=url, started_at=_now(), finished_at=None,
                   elapsed_ms=None, api_status=None, origin_status=None, final_url=None,
                   text="", text_sha256=None, outcome="harness_error", error_code=None,
                   error_message=None, credits=None, cost_usd=None, cache={}, request_config={}, raw={})
    secrets = [os.environ[k] for k in (*KEYS.values(), "TYPESAFE_API_KEY") if os.environ.get(k)]

    def fail(code, message, outcome="harness_error"):
        receipt.update(outcome=outcome, error_code=code, error_message=str(message))

    try:
        if provider not in ENDPOINTS:
            fail("UNSUPPORTED_PROVIDER", "No page-reader adapter is registered")
        elif not _public_url(url):
            fail("INVALID_TARGET", "A public HTTP(S) URL without userinfo is required")
        elif provider in KEYS and not os.environ.get(KEYS[provider]):
            fail("MISSING_CREDENTIAL", f"Set {KEYS[provider]}; no keyless fallback is used")
        else:
            timeout = float(config.get("timeout_s", 30))
            cap = int(config.get("max_response_bytes", 32 * 1024 * 1024))
            max_chars = int(config.get("max_chars", 250000))
            if not 0 < timeout <= 30 or cap <= 0 or max_chars <= 0:
                raise ValueError("Invalid deadline or response limit")
            endpoint = config.get("endpoints", {}).get(provider, ENDPOINTS[provider])
            headers, params, body = {}, None, None
            method = "GET"
            if provider == "context":
                headers = {"Authorization": "Bearer " + os.environ[KEYS[provider]]}
                params = {"url": url, "maxAgeMs": 0, "timeoutOpts[milliseconds]": 27000,
                          "timeoutOpts[behavior]": "fail"}
            elif provider == "firecrawl":
                method = "POST"
                headers = {"Authorization": "Bearer " + os.environ[KEYS[provider]]}
                body = {"url":url,"formats":["markdown"],"onlyMainContent":True,"maxAge":0,
                        "storeInCache":False,"timeout":27000,"parsers":[]}
            elif provider == "hetzner":
                method, body = "POST", {"url": url}
            elif provider == "exa":
                method = "POST"
                headers = {"x-api-key": os.environ[KEYS[provider]]}
                body = {"urls": [url], "text": {"maxCharacters": max_chars, "verbosity": "full"},
                        "maxAgeHours": 0, "livecrawlTimeout": 27000}
            else:
                headers = {"X-API-Key": os.environ[KEYS[provider]]}
                params = {"url": url, "live": "true", "max_chars": max_chars}
            receipt["request_config"] = {"endpoint": endpoint, "method": method, "params": params,
                                         "json": body, "outer_timeout_s": timeout,
                                         "max_response_bytes": cap, "visible_text_max_chars": max_chars, "attempt": 1}
            async with asyncio.timeout(timeout):
                async with reader_client(config, timeout) as client:
                    async with client.stream(method, endpoint, headers=headers, params=params, json=body, timeout=timeout, follow_redirects=False) as response:
                        receipt["api_status"] = response.status_code
                        chunks, size = [], 0
                        async for chunk in response.aiter_bytes():
                            size += len(chunk)
                            if size > cap:
                                raise ValueError("API response exceeded configured byte cap")
                            chunks.append(chunk)
                        payload = b"".join(chunks)
                        receipt["raw"] = {"headers": {k: v for k, v in response.headers.items()
                            if k.lower() in ("content-type", "x-request-id", "request-id", "retry-after")}}
                        try:
                            import json
                            data = json.loads(payload)
                        except (ValueError, UnicodeError):
                            data = {"non_json_body": payload.decode("utf-8", errors="replace")}
                        receipt["raw"]["response"] = data
            if not 200 <= receipt["api_status"] < 300:
                data_dict = data if isinstance(data, dict) else {}
                code = data_dict.get("error_code") or data_dict.get("tag") or f"HTTP_{receipt['api_status']}"
                message = data_dict.get("message") or data_dict.get("error") or data_dict.get("detail") or code
                outcome = "harness_error" if provider == "hetzner" or receipt["api_status"] in (401, 402) else "provider_error"
                if data_dict.get("infrastructure_error"):
                    outcome = "harness_error"
                receipt["credits"] = _number((data_dict.get("key_metadata") or {}).get("credits_consumed"))
                fail(code, message, outcome)
            elif not isinstance(data, dict) or "non_json_body" in data:
                fail("INVALID_RESPONSE_SCHEMA", "Successful API response was not a JSON object")
            else:
                receipt["outcome"] = "returned"
                if provider == "context":
                    receipt["text"] = data.get("markdown")
                    receipt["final_url"] = data.get("url")
                    receipt["credits"] = _number((data.get("key_metadata") or {}).get("credits_consumed"))
                    receipt["cache"] = data.get("cache_metadata") or {}
                    if data.get("success") is False:
                        fail(data.get("error_code", "CONTEXT_ERROR"), data.get("message", "Provider reported failure"), "provider_error")
                elif provider == "firecrawl":
                    page = data.get("data") or {}
                    meta = page.get("metadata") or {}
                    receipt["text"] = page.get("markdown", "")
                    receipt["origin_status"] = _number(meta.get("statusCode"))
                    receipt["final_url"] = meta.get("url") or meta.get("sourceURL")
                    receipt["credits"] = _number(meta.get("creditsUsed"))
                    receipt["cache"] = {"requested_max_age":0,"source":meta.get("source")}
                    if data.get("success") is not True or (receipt["origin_status"] or 200)>=400:
                        fail("FIRECRAWL_ERROR", "Provider reported scrape failure", "provider_error")
                elif provider == "hetzner":
                    receipt["text"] = data.get("agent_visible_text")
                    receipt["origin_status"] = data.get("target_status")
                    receipt["final_url"] = data.get("final_url")
                    if data.get("error") or data.get("ok") is False:
                        fail(data.get("error") or "TARGET_ERROR", "Datacenter reader reported an origin or conversion failure",
                             "harness_error" if data.get("infrastructure_error") else "provider_error")
                elif provider == "exa":
                    receipt["cost_usd"] = _number((data.get("costDollars") or {}).get("total"))
                    statuses = data.get("statuses") or []
                    results = data.get("results") or []
                    receipt["cache"] = {"requested_max_age_hours": 0, "statuses": statuses}
                    if len(results) == 1 and isinstance(results[0], dict):
                        receipt["text"] = results[0].get("text")
                        receipt["final_url"] = results[0].get("url")
                    elif not results:
                        receipt["text"] = ""
                        fail("NO_CONTENT_RESULT", "Exa returned no page content", "provider_error")
                    else:
                        fail("INVALID_RESPONSE_SCHEMA", "Expected one Exa result for one requested URL")
                    if statuses and isinstance(statuses[0], dict) and statuses[0].get("status") not in (None, "success"):
                        error = statuses[0].get("error") or {}
                        if isinstance(error, dict):
                            receipt["origin_status"] = error.get("httpStatusCode")
                        fail("EXA_CONTENT_ERROR", str(error or statuses[0]), "provider_error")
                else:
                    receipt["text"] = data.get("content")
                    receipt["final_url"] = data.get("url")
                    receipt["cache"] = {"requested_live": True, "status": "unreported", "max_chars": max_chars}
                if not isinstance(receipt["text"], str):
                    receipt["text"] = ""
                    fail("INVALID_RESPONSE_SCHEMA", "Expected a string page-content field")
    except (TimeoutError, httpx.TimeoutException):
        fail("CLIENT_DEADLINE", "Reader exceeded the client deadline; completion and billing may be unknown", "provider_error")
    except httpx.RequestError as exc:
        fail("TRANSPORT_ERROR", type(exc).__name__, "harness_error" if provider == "hetzner" else "provider_error")
    except (ValueError, TypeError, AttributeError, KeyError) as exc:
        fail("HARNESS_VALIDATION_ERROR", str(exc))
    if isinstance(receipt["text"], str):
        limit = receipt["request_config"].get("visible_text_max_chars", 250000)
        receipt["truncation"] = {"received_text_chars": len(receipt["text"]),
                                 "local_applied": len(receipt["text"]) > limit,
                                 "at_provider_cap": provider in ("exa", "keenable") and len(receipt["text"]) >= limit}
        receipt["text"] = receipt["text"][:limit]
    receipt = _redact(receipt, secrets)
    receipt["freshness"] = audit(provider,receipt["request_config"],receipt["cache"])
    receipt["finished_at"] = _now()
    receipt["elapsed_ms"] = round((time.monotonic() - started) * 1000)
    receipt["text_sha256"] = hashlib.sha256(receipt["text"].encode()).hexdigest()
    return receipt
