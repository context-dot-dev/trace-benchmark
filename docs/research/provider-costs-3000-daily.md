# Scraping provider pricing

Checked **September 30, 2026** against official sources for all four active benchmark providers. Generated from `src/pricing-data.js` by `npm run build`; the report and downloadable `pricing.json` use this same catalog.

## Comparison basis

[NEEDLE](https://github.com/keenableai/needle/blob/main/dashboard/index.html) maintains a dated price and plan per engine and describes its price table as the biggest self-serve tier, excluding enterprise quotes. Trace applies that convention to scraping. Monthly billing is the default; annual rates use exact yearly fees divided by twelve. A selected plan changes price projections, not the recorded quality or latency.

The unit rate assumes the full included allowance is consumed at one base credit per page. It is not the marginal overage rate or the blended rate for an underused subscription. Published rates are rounded to three decimals; full-precision values are in the JSON. Free tiers are limited allowances, never an unlimited zero-dollar tariff.

## Budget at 3,000 base pages/day

At most 93,000 pages in a month; 1,095,000 in a 365-day year. These are separate lowest-spend scenarios, not the largest-tier default in the comparison. Every page is assumed billable, with no opening balance, shared API usage or promotional credits. Actual failure charges and special URL charges can differ.

| Provider | Covering plan | Monthly bill at 93k | Annual bill for 365 days |
|---|---|---:|---:|
| Context | Pro | $99.00 | $990.00 |
| Firecrawl | Standard | $99.00 | $990.00 |
| Exa | Pay as you go | $93.00 | $1095.00 |
| Keenable | Live fetch — quote needed | Unverified | Unverified |

Context Pro and Firecrawl Standard each cost $990/year on annual billing ($1,188/year paid monthly). Exa text-only adds $1,095/year gross. Their combined annual-commitment scenario is $3,075/year; monthly subscriptions make it $3,471/year. **The four-provider total remains unknown because Keenable live fetch is unpriced.** Neither total includes discovery, judging, hosting, tax or special formats. A 93k-month rate is not multiplied by twelve to price Exa’s 365-day year.

## All published plans

### Context

Markdown scrape · maxAgeMs=0 · 1 base credit/page. [Official pricing](https://www.context.dev/pricing). [Billing rules](https://docs.context.dev/api-reference/web-scraping/scrape).

| Plan | Monthly fee | Annual upfront | Credits/month | Monthly / 1k pages | Annual / 1k pages | Extra / 1k credits |
|---|---:|---:|---:|---:|---:|---:|
| Free | $0.00 | — | 1,000 | Limited free tier | Limited free tier | — |
| Developer | $19.00 | $190.00 | 7,500 | $2.533 | $2.111 | $2.20 |
| Pro | $99.00 | $990.00 | 125,000 | $0.792 | $0.660 | $1.80 |
| Growth | $299.00 | $2990.00 | 500,000 | $0.598 | $0.498 | $1.40 |
| Scale | $499.00 | $4990.00 | 1,000,000 | $0.499 | $0.416 | $1.00 |
| Enterprise | Quote | — | — | Unverified | Unverified | — |

Current new-subscription prices. Annual billing saves two months on the base subscription. Overage is purchased in 1,000-credit blocks; auto top-up must be enabled. Most failures are unbilled, but 404 responses are billed. Browser actions and extra output formats cost more. Existing accounts may retain older rates and limits.

### Firecrawl

Markdown scrape · maxAge=0 · parsers=[] · 1 base credit/page. [Official pricing](https://www.firecrawl.dev/pricing.md). [Billing rules](https://docs.firecrawl.dev/billing).

| Plan | Monthly fee | Annual upfront | Credits/month | Monthly / 1k pages | Annual / 1k pages | Extra / 1k credits |
|---|---:|---:|---:|---:|---:|---:|
| Free | $0.00 | — | 1,000 | Limited free tier | Limited free tier | — |
| Hobby | $19.00 | $190.00 | 5,000 | $3.800 | $3.167 | $5.00 |
| Standard | $99.00 | $990.00 | 100,000 | $0.990 | $0.825 | $2.50 |
| Growth | $399.00 | $3990.00 | 500,000 | $0.798 | $0.665 | $2.00 |
| Scale | $749.00 | $7190.00 | 1,000,000 | $0.749 | $0.599 | $1.00 |
| Enterprise | Quote | — | — | Unverified | Unverified | — |

Annual commitments use the exact published totals, not rounded monthly labels. Allowances renew monthly; Scale has one month of rollover. Extra credits come in $5 blocks and require pay-as-you-go to be enabled. Returned 403/404 pages still cost a credit; a scrape with no result is uncharged. Enhanced proxy escalation has no surcharge. PDF parsing is disabled in this benchmark. X/Twitter URLs have separate billing. Extra formats and PDF parsing can cost more. Concurrency is concurrent browsers; request rate limits also apply.

### Exa

/contents · text only · maxAgeHours=0. [Official pricing](https://exa.ai/docs/admin/pricing).

| Plan | Monthly fee | Annual upfront | Credits/month | Monthly / 1k pages | Annual / 1k pages | Extra / 1k credits |
|---|---:|---:|---:|---:|---:|---:|
| Pay as you go | None | — | — | $1.000 | $1.000 | Same rate |
| Enterprise | Quote | — | — | Unverified | Unverified | — |

Text content is $1 per 1,000 pages, with no subscription minimum. Each additional content type is billed separately. Published $10 monthly free credits and the onboarding bonus depend on account eligibility and shared usage; they are not deducted from this gross comparison. Enterprise discounts are custom. These are Contents prices, not Search prices.

### Keenable

/fetch · live=true · fetch.live SKU. [Official pricing](https://docs.keenable.ai/credits).

| Plan | Monthly fee | Annual upfront | Credits/month | Monthly / 1k pages | Annual / 1k pages | Extra / 1k credits |
|---|---:|---:|---:|---:|---:|---:|
| Live fetch | Quote | — | — | Unverified | Unverified | — |

The docs advertise a shared monthly allowance of 100,000 requests, but live fetch has a distinct SKU and organization-specific credit pricing. A public USD tariff for this mode is not established. Search-tier prices and the ordinary-fetch allowance cannot establish its live-fetch cost. This collector has no verified HTTP billing receipt; an account-specific live-fetch tariff is needed.

## Reported costs and unknowns

Provider-returned USD and credit receipts remain separate from modeled prices. Credits are not converted into an invented invoice. Reported cost per 1,000 useful pages requires USD receipts on every selected page, no unresolved judgments and at least one useful page. Missing receipts are unknown, including timeouts that may still have been billed. Partial subtotals disclose coverage. Valid zero-dollar receipts remain zero.

Exa’s eligible free balance resets to $10 monthly and onboarding can add $10 once. These shared account credits are excluded from gross rates. Context grandfathered accounts may have older prices. Firecrawl annual totals are $190/$990/$3,990/$7,190, not twelve times the rounded monthly marketing labels. Firecrawl enhanced proxies have no surcharge; PDF parsing is disabled in this adapter. Returned error documents can be billed. Keenable Search prices do not price its distinct `fetch.live` SKU.
