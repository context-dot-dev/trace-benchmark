# Reader adapters

`await bench.providers.fetch_reader(provider, url, config)` makes one request and returns a private observation receipt. Supported names: `context`, `hetzner`, `exa`, `keenable`. Root orchestration loads environment credentials and handles dispatch budgets, provider pacing, host limits, persistence and identity/content scoring. The adapter never searches, retries, rotates accounts or switches to a keyless endpoint.

## Live request contracts

| Reader | Request | Freshness and extraction settings |
|---|---|---|
| Context | GET `https://api.context.dev/v1/web/scrape/markdown`; Bearer `CONTEXT_API_KEY` | `maxAgeMs=0`, `timeoutOpts[milliseconds]=27000`, `timeoutOpts[behavior]=fail`; natural returned markdown |
| Hetzner | POST `http://127.0.0.1:18089/scrape`, JSON `url` | Existing requests/converter v3 service; no proxy or JavaScript; preserves its `(5,10)` request deadlines, 30-second wall limit and 10MiB target-body cap |
| Exa | POST `https://api.exa.ai/contents`; `x-api-key: EXA_API_KEY` | One `urls` entry; `maxAgeHours=0`, `livecrawlTimeout=27000`, `text: {maxCharacters:250000, verbosity:"full"}`; no deprecated `livecrawl`, summaries, highlights or subpages |
| Keenable | GET `https://api.keenable.ai/v1/fetch`; `X-API-Key: KEENABLE_API_KEY` | `url`, `live=true`, `max_chars=250000`; no extraction prompt. Default indexed fetch is deliberately not used. |

Exa and Keenable are actual URL-content endpoints. Their output is never replaced with search snippets. Official documentation checked September 17, 2026: [Exa Contents](https://exa.ai/docs/reference/get-contents), [Exa coding reference including text verbosity](https://exa.ai/docs/reference/contents-api-guide-for-coding-agents), [Exa per-URL errors](https://exa.ai/docs/reference/contents-best-practices), [Keenable Fetch](https://docs.keenable.ai/api-reference/fetch).

All four requests have a true 30-second outer asyncio deadline, including streaming the response. HTTPX stage timeouts alone would not bound the whole operation. HTTP redirects at the API endpoint are not automatically followed. Ambient environment proxies are disabled. There is a 32MiB decompressed API-response safety cap. This is separate from the datacenter target-body cap.

Every reader's *visible text* has the same 250,000-character maximum. Full returned API payloads remain under private `raw.response`, before the local text cap; Exa/Keenable additionally receive the explicit native cap. `truncation` records received character count, local truncation and whether a native cap may have been reached. At-cap output is not proof of truncation. These modes may still differ in extraction and internal limits; the experiment compares whole reader services, not IP reputation alone.

## Receipt semantics

`outcome="returned"` means a valid content field was returned. It does **not** establish useful content, right-document identity, factual accuracy, completeness or freshness. A valid empty content string remains returned and must be judged as empty downstream. `final_url` is the provider-reported URL; it is not independently verified redirect history.

`provider_error` retains reader failures: origin denial, provider deadline, provider server/rate failure or Exa per-URL error inside an HTTP200 envelope. The datacenter's API200/origin403 becomes a reader failure, not success. A deadline may leave remote completion and billing unknown.

`harness_error` makes quality unknown: missing credentials, HTTP401/402 account problems, malformed response schemas, invalid targets, response-cap overflow, datacenter endpoint failures or tunnel transport failure. No such observation should become a scraper loss. Public-provider network failures remain operational reader failures; local endpoint connectivity errors remain harness failures. Raw status/code must remain available for audit and finer account/rate-limit distinctions.

`api_status` is distinct from `origin_status`. Datacenter exposes origin status; Exa sometimes exposes one in its per-URL error. Successful Exa, Context and Keenable responses do not supply a verified origin status, so it remains null. Missing cost fields remain null. Context `key_metadata.credits_consumed` and Exa `costDollars.total` are read as reported, with no invented dollar conversion. Cache metadata/statuses are preserved; Keenable live mode is recorded as requested, while observed cache status remains unreported.

The complete raw payload is **private evidence**. Public exports must explicitly allowlist summary fields rather than publish this receipt. Keys come only from the environment, are never copied into request metadata, and any accidental credential echo in a response is redacted. Returned text hashes refer to the final redacted, capped visible text.

Target validation rejects non-HTTP(S), credentials in URLs, localhost/local names and literal nonpublic IPs. It does not resolve DNS or observe third-party API origin redirects. Root discovery validation and the datacenter endpoint's existing redirect/IP guards remain required. The adapter does not claim to prevent DNS rebinding on behalf of external services.

Configuration keys: `endpoints` maps provider to full API endpoint; `timeout_s` can shorten but not exceed 30 seconds; `max_chars` changes the common visible/native cap; `max_response_bytes` changes the API safety cap; `transport` accepts an HTTPX async transport for tests. Credentials must not be passed through config. External task cancellation propagates so the scheduler can preserve an interrupted, billing-unknown attempt.

## Verification and current status

Run the adapter checks from the project environment:

```sh
.venv/bin/python -m unittest discover -s tests -p test_providers.py -v
```

These mocked tests exercise freshness parameters, Exa HTTP 200/per-URL errors, account versus service failures, origin versus endpoint failures, malformed schemas, true elapsed deadlines, response overflow, credential redaction, content hashing, private-target rejection and preservation of the raw payload before visible-text truncation. Passing them establishes adapter behavior, not live reader quality.

Bounded live integration checks have exercised all four readers. An earlier Keenable credential returned HTTP 402; those historical receipts remain account errors. The user-authorized replacement credential is now installed and live Keenable search and fetch have been verified. No keyless fallback is used. This is an operational change, not grounds to relabel earlier observations or claim benchmark superiority.

The initial 80-page independent cohort is currently being collected against all four readers. Its final measurements and runtime verification belong in the run artifacts/report, not a hardcoded documentation table. Full responses and keys remain private. The dashboard exports only allowlisted summaries and short previews.

## Orchestration and scoring

The runner persists dispatch before making a request, reserves daily budget, and does not automatically retry dispatched attempts. Account circuits prevent repeated account failures. Requests to all readers for a task are paired; tasks for one hostname are serialized. Exact settings and daily cohort arithmetic are in [the implemented methodology](../site/plan.md).

Returned text is judged separately for substantive content and requested-document identity by provider-hidden Jev `jev-1.13.0`. Its maximum input excerpt is 12,000 characters, split across beginning/middle/end for longer documents. A positive triage result does not establish complete extraction, correct facts, full-paper retrieval, QA accuracy or a better trained model. Unknown outcomes remain in denominators, with visible bounds.
