# Additional provider costs at 3,000 URLs/day

Historical expansion research, not the live benchmark pricing catalog. These optional providers are not in the active panel; their September 17 prices have not been reverified. For all active providers, use [the current pricing report](provider-costs-3000-daily.md).

Checked **2026-09-17** against official public pricing and documentation. USD, excluding taxes, negotiated discounts, one-time trials, and our infrastructure. No provider purchase or paid scrape was performed for this research.

**Workload:** 3,000 URL attempts per day **per provider** × 365 = **1,095,000/year**. Mean month: 91,250; a 31-day month: 93,000. The calculations assume one submitted request per URL and all requests billable. Additional client retries increase consumption; provider-internal retries follow the provider’s rules. Successful billing does not establish usable content.

| Provider/configuration | Estimated annual charge | What the number covers |
|---|---:|---|
| Bright Data Web Unlocker, standard PAYG | **$1,642.50** | Standard-domain rate; premium domains can cost more |
| Zyte HTTP, homogeneous tiers 1–5 | **$142.35–$1,200** | Appropriate PAYG/commitment selected for each tier |
| Zyte browser, homogeneous tiers 1–5 | **$1,105.95–$8,409.60** | Appropriate commitment; excludes additional features |
| ScrapingBee classic, no JS | **$588** | Twelve $49 monthly plans |
| ScrapingBee classic JS **or** premium no JS | **$1,188** | Twelve $99 monthly plans |
| ScrapingBee premium JS | **$2,988** | Twelve $249 monthly plans |
| ScrapingBee stealth JS | **$7,188** | Twelve $599 monthly plans |
| Keenable indexed fetch | **Potentially $0 incremental** | Conditional on one-credit billing and unused shared free allowance |
| Keenable live fetch | **Not publicly established here** | Separate SKU; do not substitute Search API pricing |

These are configuration scenarios, **not measured equivalent-quality services**. A cheap HTTP configuration and a premium rendered configuration must remain separate benchmark arms. Sources and qualifications follow.

## Bright Data Web Unlocker

[Official pricing](https://brightdata.com/pricing/web-unlocker) lists PAYG **$1.50/1,000**, a **5,000-request monthly free tier**, and Scale **$499/month including 383,000 requests**, then $1.30/1,000. PAYG costs `1,095 × $1.50 = $1,642.50/year`; Scale costs $5,988/year and is excessive at this volume. If the free tier offsets paid PAYG usage every month, cost would be $1,552.50; that combination was not verified, so it is excluded from the headline.

[Feature documentation](https://docs.brightdata.com/products/web-unlocker/features) distinguishes two material exceptions: premium domains have higher rates, and custom headers/cookies or manual expected-element settings make **all requests billable**, including failures. Standard use is success-billed. The premium-domain price was not publicly resolved here; a mixed-domain invoice cannot be bounded by $1.50/1,000 alone.

The [API introduction](https://docs.brightdata.com/products/web-unlocker/introduction) documents forced rendering with `render: true` and Markdown output. No separate numeric rendering surcharge was found on the reviewed tariff. That is not evidence of equivalent interactive-browser capability: scripted browser control is a separate product. Save configuration and actual billing metadata. Recheck premium-domain assignments before the annual purchase decision.

## Zyte API

[Official pricing](https://www.zyte.com/pricing/) uses automatically assigned website tiers and different HTTP/browser rates. PAYG rates per 1,000 are HTTP **$0.13/$0.23/$0.44/$0.70/$1.27** and browser **$1.01/$2.01/$4.02/$8.04/$16.08** for tiers 1–5. Published commitment tables discount these rates.

The following chooses a suitable plan **as if every URL had the same tier and mode**. It does not estimate our actual domain mixture.

| Tier | HTTP annual / plan minimum | Browser annual / plan minimum |
|---|---:|---:|
| 1 | $142.35 / PAYG | $1,105.95 / PAYG |
| 2 | $251.85 / PAYG | $1,642.50 / $100 monthly |
| 3 | $481.80 / PAYG | $2,628 / $200 monthly |
| 4 | $766.50 / PAYG | ≈$4,578 / $350 monthly |
| 5 | $1,200 / $100 monthly | $8,409.60 / $500 monthly |

The [billing documentation](https://docs.zyte.com/zyte-api/pricing.html) gives monthly commitments of $100/$200/$350/$500, discounts of 25%/40%/48%/52%, and corresponding spending ceilings of $200/$400/$700/$2,500. PAYG’s ceiling is $100/month. Therefore the expensive PAYG projections are not executable unchanged. Compute each month as `max(commitment, billable usage at that plan's rates)`, then sum twelve months; the commitment is not added again to usage. Tier-4 browser uses `$8.04 × 0.52 × 1,095 ≈ $4,578`. Other examples use rounded published rate tables; invoice precision can differ.

The same billing documentation prices additional browser actions/network capture, some geolocation/device features, screenshots ($0.002 each before discount), and automatic extraction ($0.0004–$0.0016 per data type before discount). These extras are excluded above. Obtain domain-tier and feature receipts before a firm forecast.

[Error documentation](https://docs.zyte.com/zyte-api/usage/errors.html) explains why API success is not page quality: an API 200 can carry a target 404 or partially failed browser actions. Failed API responses are not charged, but an unusable target response can still be a billable success. Keep those outcomes in the benchmark denominator.

## ScrapingBee

[Monthly plans](https://www.scrapingbee.com/pricing/) include Hobby $19/75,000 credits, Freelance $49/250,000, Startup $99/1,000,000, Business $249/3,000,000, and Business+ $599/8,000,000. Hobby cannot support even February’s 84,000 requests at one credit each. Annual estimates below mean twelve monthly payments, with no assumed annual discount or overage purchase.

The [credit schedule](https://help.scrapingbee.com/en/article/credit-system-explained-1h2ackp/) produces:

| Mode | Credits/URL | Peak monthly credits | Smallest listed sufficient plan | Annual cost |
|---|---:|---:|---|---:|
| Classic, no JS | 1 | 93,000 | Freelance | $588 |
| Classic, JS | 5 | 465,000 | Startup | $1,188 |
| Premium, no JS | 10 | 930,000 | Startup | $1,188 |
| Premium, JS | 25 | 2,325,000 | Business | $2,988 |
| Stealth, JS | 75 | 6,975,000 | Business+ | $7,188 |

[API documentation](https://www.scrapingbee.com/documentation/) makes JS rendering the default. Auto mode escalates configurations and bills the winning mode, or zero if all fail; `max_cost` constrains escalation. Freeze auto-mode configuration and record `Spb-cost`/`Spb-auto-cost`, rather than assuming every request takes the cheapest route. AI extraction adds credits and is excluded.

The documented billing table charges 200, **404, 410, and 413**; listed 400/401/403/429/500 errors are not billed under default handling. `transparent_status_code=true` changes the rule to charging target statuses below 500 and disables retries. Consequently the marketing phrase “successful requests” must not be translated into “only useful pages cost money.” Unused monthly credits still contribute to the plan’s effective cost.

## Keenable: indexed and live fetching must be distinguished

[Keenable’s pricing page](https://keenable.ai/pricing) advertises **Search API** PAYG at $4/1,000, with an enterprise offer from $1/1,000. Neither establishes a live page-fetch tariff.

The [credits documentation](https://docs.keenable.ai/credits) gives a recurring **100,000-credit monthly organization allowance**, with baseline search/fetch consuming one credit, but distinguishes `fetch` and `fetch.live` SKUs and says pricing is organization-specific. A dedicated ordinary-fetch workload at one credit/request fits even the 93,000-request peak month, making **zero incremental spend conditional**, not a live-reader price guarantee. Searches and other calls share the allowance; do not allocate the same free credits twice.

For live comparison, use `live=true` and verify the actual account’s SKU charge in `_meta["keenable/usage"]` (`sku`, `amount`, `credits`, `paid`). No live fetch was performed to probe billing. A public numeric `fetch.live` USD tariff was not established. Get the account-specific rate before adding an annual total. Default indexed content is a different freshness condition; its apparent zero cost cannot justify comparing cached results with other providers’ live reads.

## Evaluation and storage are separate operating costs

[TypeSafe’s current model documentation](https://docs.typesafe.ai/models) lists **Jev 1.13 at $42/billion input tokens = $0.042/million; output tokens are free**. Use measured `usage.input_tokens`, including instructions/questions, for the ledger.

Using the coordinating agent’s pilot measurements (812 judged calls averaging 3,116 input tokens), not an independent recalculation of raw receipts here:

| Evaluation scenario | Input tokens/day | Jev cost/day | Jev cost/year |
|---|---:|---:|---:|
| Current response-mix extrapolation to 12,000 reader observations/day | ~32 million | ~$1.344 | **~$490.56** |
| Every one of 12,000 observations judged at that mean | 37.392 million | $1.570464 | **$573.22** |

This does not pay for reference creation, a stronger adjudication model, human review, or extra repeated/chunked judgments. The [parallel-question cookbook](https://docs.typesafe.ai/cookbooks/parallel_questions) demonstrates that questions sharing a page can share its input state in one request; separate calls resend and rebill that state. Preserve per-reader blinding when batching.

**Storage scenario:** the observed **188MB for 952 observations**, including the current database and already-gzipped blobs, scales linearly to `188/952 × 12,000 ≈ 2,370MB/day`, or **about 865GB retained after a year**. This is a crude snapshot extrapolation, not measured steady-state marginal growth: page length, provider output mix, database growth, retention, and backups can change it. Do not apply compression savings a second time. No storage-provider price is claimed here.

## What to budget and record next

1. Keep each provider’s HTTP/JS/premium/automatic settings explicit. A configuration change changes both the experiment and the tariff.
2. Record actual charged credits/SKU, response status, retry count, rendering mode, output size, and usable-evidence outcome per URL. Report cost per attempted URL and per successful evidence recovery separately.
3. Treat **Bright Data premium-domain pricing** and **Keenable live-fetch pricing** as unresolved line items. Zyte needs the observed tier/feature mixture. Do not present the lowest rate as a confirmed all-domain budget.
4. Add reader charges, Jev inference, infrastructure, retention, and adjudication only after making their volumes consistent. The reader scenarios are **3,000/day per provider**; the Jev/storage scenarios use **12,000 total observations/day** (four reader arms).
