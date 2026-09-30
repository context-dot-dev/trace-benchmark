# What TRACE should borrow from extraction benchmarks

Verified 17 September 2026. Discovery used eight Keenable MCP `search_web_pages` calls, followed by primary papers, repositories, dataset cards and a direct CSV audit. No reader evaluation was run. Recommendations below are our analysis, not claims made by the benchmark authors.

**Recommendation: keep TRACE's live paired acquisition, but replace its headline claim with independently checkable evidence recovery.** Reuse published annotation and scoring components; none of the four resources below can establish a live-reader advantage or an RL-training advantage unchanged.

## 1. Firecrawl's 1,000-page content dataset: useful starting material, weak success threshold

The official card describes 1,000 human-curated URLs created **2025-10-21**, with approximately 100 words of core text (`truth_text`), approximately 10 words of unwanted content (`lie_text`), and retrieval errors. It releases CSV data under MIT, not a complete-page gold extraction. It explicitly warns about changing or dead pages. [Dataset and card](https://huggingface.co/datasets/firecrawl/scrape-content-dataset-v1)

Our direct audit of pinned revision `aad2b002cd74147236ee6fb4fd7e2bcf28955c3c` found:

| CSV property | Count |
|---|---:|
| Rows / distinct URL strings | 1,000 / 1,000 |
| Nonempty `truth_text` after stripping whitespace | 850 |
| Nonempty `lie_text` | 837 |
| Both annotation fields nonempty | 822 |
| Nonempty `error` | 133 |
| Both `truth_text` and `error` nonempty | 3 |

These are inventory counts, **not 850 verified usable labels**. Some English gold entries are only one or two words; the card's English language tag also does not imply every row is English. The CSV SHA-256 is `47c0b99d51a325c618ef0e14e3f6eb15d420a1eaa196be3dc2e4d4e0b7926889`. Counts use Python `csv.DictReader`, then `bool(value.strip())`. [Pinned CSV](https://huggingface.co/datasets/firecrawl/scrape-content-dataset-v1/resolve/aad2b002cd74147236ee6fb4fd7e2bcf28955c3c/1-0-0.csv)

Firecrawl's current official benchmark index describes its January 13, 2026 run across ten categories. It calls a URL covered when at least **10% of expected content** is recovered; it reports Firecrawl coverage 96%, F1 0.638 and recall 0.639. This page does not supply the complete scrape comparator table or an exact executable F1 definition. We did not locate an official released scorer for this particular result in the bounded audit. Do not invent a tokenization/precision formula or import third-party reimplementations as the official protocol. [Official benchmark index](https://www.firecrawl.dev/benchmarks)

**Reuse:** a public anchor cohort and the distinction between wanted and unwanted text. **Improve:** reverify labels against a timestamped reference; flag missing/contradictory labels before provider runs; measure recovery of required facts. Ten percent of a short snippet can pass while almost all answer-bearing content is absent. A short noise snippet also cannot quantify all boilerplate. Do not call either measure full-document recall or factual precision.

## 2. DevDex: the best reproducibility pattern here, but it grades retrieval

DevDex has **1,179** items: repository discovery 393, issue/PR 400, documentation 386. The MIT public release contains **594**: 198/195/201. Construction uses repository capability descriptions, linked issue–PR pairs and documentation passages; name/lexical leakage filters and a no-tools memorization gate remove trivial cases. Gold permits canonical equivalent documentation representations. Published Recall@10 and MRR@10 score the agent's citations, with equal-weight track aggregation and stratified bootstrap intervals. Comparators include Firecrawl Developer Index, Parallel, Mintlify, Exa, Context7 and native/no-tool controls behind a common Claude Opus agent. [Repository and methodology](https://github.com/firecrawl/benchmark-devdex)

The scorer preserves errored items in denominators, distinguishes unmeasured cells, and supports repeated passes. Public-sample results are not interchangeable with full-set headline results. Its code also documents earlier canonical-URL and result-depth bugs: “deterministic” does not mean immune to grading mistakes. Pin the scorer and audit accepted equivalent URLs. [Scoring implementation](https://github.com/firecrawl/benchmark-devdex/blob/24e60473887d33960bf155a9e73affcd07d288a3/devdex/scorer/suite.py)

**Reuse:** public MCP runner, citation matching, no-tool control, frozen JSONL gold, paired comparison and repeated-run reporting. **Limitation:** citing the right URL does not prove its body was fetched, complete, or sufficient for the answer. TRACE can adapt its docs questions only by adding answer/evidence gold and holding search fixed while substituting the reader. Match the public 594-item sample against itself; do not compare our score directly to their private 1,179-item table.

## 3. ScrapeGraphAI-100k: reusable extraction labels, plus a warning about synthetic gold

The corpus contains **93,695** production extraction events from approximately 9 million opt-in telemetry events, spanning **25,453 schemas and 8,155 root domains**. Released rows contain Markdown, prompts, schemas, outputs and structural metadata. The derivative has **25,244 training**, **2,808 test** and **100 human-evaluation** rows. Code includes training, metrics, annotation, frontier baselines and judge-audit scripts. [Reproducibility repository](https://github.com/ScrapeGraphAI/scrapegraph-100k-paper)

Filtering caps content/schema/response at 50k/10k/10k characters. Content is chunked into approximately 4,096-token windows with 128-token overlap; the ordinary 90/10 split uses seed 42. GPT-5-nano regenerates targets; schema-invalid generations are removed. These are teacher pseudo-labels. The later 100-row human split excludes same-page training overlap and is stratified by complexity and truncation. Annotators corrected **77% of drafts and 31.7% of leaf values**. It is a subset of test, not an additional tuning set. [Current derivative card](https://huggingface.co/datasets/scrapegraphai/scrapegraph-100k-finetuning)

The paper evaluates 2,714 test examples after an 8,192-token filter, comparing a fine-tuned Qwen3-1.7B with Qwen3 baselines including 4B and 30B-A3B. Metrics separate JSON validity, schema compliance, key precision/recall/F1 and type-dependent value matching. It acknowledges teacher-imitation confounding and short-string BLEU weaknesses. Its older v2 text says human gold is future work; the current released card/code supersede that particular availability statement. [Paper v2](https://arxiv.org/html/2602.15189v2)

**Reuse:** `human_eval` for an offline semantic-extraction smoke; annotation instructions require each value to be supported by the exact displayed input, using null for absent values. [Human annotation/scoring code](https://github.com/ScrapeGraphAI/scrapegraph-100k-paper/blob/main/scripts/human_benchmark.py)

**Limitation:** Markdown is already supplied and source domains are masked in the main release; these are not a ready-made live URL access benchmark. The ordinary chunk/row split is not a domain holdout. For TRACE, generate training labels with LLMs but have humans independently verify evaluation leaves; a correct schema is not a correct extraction.

## 4. ReaderLM-v2: separate HTML conversion from live retrieval

ReaderLM-v2 starts from **one million URLs sampled from Common Crawl's top 500 domains**. Jina Reader supplies initial conversions; unsupported languages are filtered. Draft–refine–critique yields **250k SFT pairs, 100k critique examples and 150k preference triplets**. Held-out, human-checked evaluation comprises **500 HTML→Markdown** and **300 HTML→JSON** documents. Markdown grading uses ROUGE-L and string distances; JSON grading uses key-value-tree precision/recall/F1 and structural pass rate. Baselines include GPT-4o-2024-08-06, Gemini 2.0 Flash and Qwen2.5-32B-Instruct. SFT, DPO and iterative tuning ablations are reported. [Paper](https://arxiv.org/html/2503.01151v1)

The 1.5B model weights and inference examples are released under **CC-BY-NC-4.0**. We verified the model release, but did not locate downloadable evaluation/training rows or a complete reproduction scorer in the linked paper/model assets. Do not describe the paper's datasets as immediately reusable downloads. [Model release](https://huggingface.co/jinaai/ReaderLM-v2)

**Reuse:** human comparison to original HTML; separate wanted-text fidelity, structure and instructed extraction; length-stratified reporting; draft-versus-refined training preferences. **Limitation:** the model receives HTML, so this cannot measure bot blocking, origin access or freshness. References derived from the same generation pipeline can favor its output style; top-500-domain sampling is not general-web coverage. Markdown string similarity can punish harmless formatting and miss whether the particular answer-bearing fact survived. Keep frozen-HTML conversion tests separate from live acquisition tests.

## Concrete implications for TRACE

1. Keep the live URL queue and same-page paired dispatch. Publish task IDs, protocol version, selected denominator, acquisition times and failure receipts before declaring a winner.
2. Add a frozen **human-verified evidence panel**: required values with exact reference spans, expected document identity, and timestamped reference capture. LLMs may propose labels; neither Context's own output nor another candidate reader's output should automatically become gold.
3. Report evidence-unit recall separately from unsupported extracted claims and from nuisance text. Use normalized exact matching for IDs/numbers, explicit aliases for strings, and human adjudication for unresolved semantic matches. Never equate schema compliance, citation URL correctness or 10% snippet coverage with answer correctness.
4. Retain distinct denominators for selected URLs, evaluable reference labels, attempted requests and judged outputs. Publish exclusion reasons fixed before inspecting provider outcomes; show end-to-end failures and unknown bounds as well as conditional extraction quality.
5. Calibrate Jev against a blinded, stratified human sample, including short partial outputs, wrong-document responses and hard disagreements. Audit negative judgments too. Keep a probability sample for estimating error rates; disagreement-only review cannot estimate overall judge accuracy.
6. Only then add paired QA: identical question, answering model, search results, context budget and reader deadline; substitute the reader alone. An RL-improvement claim needs matched training runs and an untouched evaluation holdout, not a reader leaderboard.

The credible contribution is a transparent connection from **live access → preserved evidence → answer accuracy**, with downloadable receipts and a falsifiable scorer. Bigger daily throughput does not replace that connection.

## Reproducibility pins

- Firecrawl scrape data: `aad2b002cd74147236ee6fb4fd7e2bcf28955c3c`; CSV hash above.
- DevDex code/data: `24e60473887d33960bf155a9e73affcd07d288a3`.
- ScrapeGraph main dataset: `0f8d168f2a64632a3ec860059919059273314e66`.
- ScrapeGraph derivative: `2b588db57bedf6b5587abd7da74752d035f35a3a`.
- ReaderLM-v2 model: `1d07078459ee1e880a22d67387b5e683d50a6e4b`.

These pins identify assets inspected, not an executed comparison or endorsement of their headline scores.
