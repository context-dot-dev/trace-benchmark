# What TRACE should borrow from established agent benchmarks

Primary sources checked September 17, 2026. Discovery used four Keenable MCP `search_web_pages` calls with `mode=realtime`, three results each; all four receipts reported `paid:false`. Primary papers, repositories and dataset metadata were then inspected directly. No benchmark model evaluations were run. Recommendations below are proposed TRACE experiments, not findings of a Context advantage.

**Recommendation: use WebWalkerQA as the first external downstream test; borrow FRAMES' no-retrieval/reference-document controls and WebArena's verifiable task validators. Reserve BrowseComp for a later end-to-end generalization check.** None of these datasets, used unchanged, independently measures scraper quality. TRACE can supply that missing component measurement and demonstrate whether it predicts task success.

## The four useful comparisons

| Benchmark | Verified release / split | Gold and official measurement | Fit for TRACE |
|---|---|---|---|
| WebWalkerQA | 680 `main` questions; 13,579 `silver` rows currently hosted | Answers, root URLs, source URLs, reference paths; QA accuracy and actions on successful runs | Strongest practical external bridge from page reading to QA |
| BrowseComp | 1,266 rows in the public test CSV | Short answers, semantic equivalence grading; browsing-agent accuracy | Strong external downstream test, weak isolation of a page reader |
| WebArena / BrowserGym | WebArena: 812 tasks from 241 templates; BrowserGym is a harness, not another fixed-size dataset | Reference answers or programmatic environment-state success | Strong reproducibility/validator design; poor live-network access stress test |
| FRAMES | 824 rows, `test` split only | Answers plus Wikipedia source articles; answer accuracy with retrieval controls | Useful reasoning/control cohort; poor anti-bot/access coverage |

Counts in this table are tied to the sources below. Do not confuse public availability with an untouched holdout.

## 1. WebWalkerQA: reuse the question/source structure

The paper constructs 680 questions across 1,373 webpages, with 340 single-source and 340 multi-source questions. Each half has 80 easy, 140 medium and 120 hard questions. An agent starts from a supplied root URL and follows links; observations combine markdown and extracted link/button information. Paper experiments cap exploration at 15 actions. The headline metric is answer accuracy, judged against reference answers by GPT-4; action count is averaged over successful executions. Questions were proposed with GPT-4o and reviewed by human annotators. [Paper, sections 3–5](https://arxiv.org/html/2501.07572v3)

The Hugging Face release exposes `question`, `answer`, `root_url` and nested `info`, including `source_website`, `golden_path`, domain, difficulty and language. Its card warns that source URLs and paths can become stale. It describes the supplementary data as approximately 15k and not carefully human verified; the currently returned dataset-size API is exact: **680 main + 13,579 silver = 14,259**. There is no separately advertised clean development/validation/test partition of those 680 main questions. [Dataset/card](https://huggingface.co/datasets/callanwu/WebWalkerQA), [machine-readable split sizes](https://datasets-server.huggingface.co/size?dataset=callanwu%2FWebWalkerQA)

**What TRACE should borrow:** two explicitly named evaluation tracks. In **reference-URL reading**, give both readers the same annotated source URLs; use independently checked evidence to measure fact recovery and the same fixed model to answer the question. This is an adaptation and must not be reported as the original traversal score. In **root-URL traversal**, give each agent only the question/root URL and equal tools/budgets; reference paths remain evaluator-only. Freeze how links are exposed: a separate privileged link extractor could conceal a reader's failure to preserve navigation.

**Limits and leakage:** source drift requires timestamped reference validation. A failed source is not automatically a reader failure; a different correct answer is not automatically wrong. Keep invalid/stale cases in the eligibility ledger. Group all questions sharing websites/documents before splitting; do not train on silver until document overlap with evaluation has been checked. Previously inspected main examples remain development evidence. Success-only action averages can look efficient when hard tasks fail; also publish all-attempt cost and success-at-budget curves.

## 2. BrowseComp: borrow answer verifiability, not scraper attribution

BrowseComp contains 1,266 human-authored difficult browsing questions with short reference answers. Its construction intentionally combines difficult discovery with easy answer verification; annotators screened questions against existing models and simple searches. Grading compares the predicted answer semantically with the reference. The paper acknowledges that another valid answer may exist for an inverted constraint question. These are agent-level problems, not extraction-span tests. [Paper](https://arxiv.org/html/2504.12516v1), [official release](https://openai.com/index/browsecomp/)

The official CSV currently contains 1,266 rows and four columns: `problem`, `answer`, `problem_topic`, `canary`. It supplies no gold URL list or evidence-span column. Its SHA-256 at inspection was `7b24471cd5b3eb2a46830a14802b5c029ea62f488ff75a0f88af7923d1454abf`. Only headers/counts were inspected; question/answer fields were not decrypted. The evaluator loads a test set, optionally samples with seed zero, decrypts question/answer fields and delegates the model/tool configuration to a sampler. It does not itself standardize every agent's search/open budget. [Official CSV](https://openaipublic.blob.core.windows.net/simple-evals/browse_comp_test_set.csv), [pinned evaluator](https://github.com/openai/simple-evals/blob/5e623c2b400af62a1278e23595f95b0853d7fe8a/browsecomp_eval.py)

**What TRACE should borrow:** concise answer contracts and semantic equivalence checks, while separately checking source support. Later, run the same browsing agent/search engine with only the page-reader backend changed. Record URL traces, step limits, timeouts, token budgets and confidence. An accuracy difference then supports a claim about that whole agent configuration under the specified reader intervention. It does not establish that every page was extracted better or that RL training would improve.

**Limits and leakage:** search snippets, alternate sources, memorized answers and different navigation paths can bypass the reader. The public canary/encryption packaging helps discourage accidental ingestion; it is not a secret holdout or protection against deliberate exposure. Live search results and pages drift. A truly repeatable component comparison needs immutable, paired reader observations; live-agent reproduction additionally needs acquisition times and search-result receipts.

## 3. WebArena / BrowserGym: borrow validators and reproducibility

WebArena has 812 instantiated tasks from 241 templates. It includes information seeking, navigation and content/configuration actions. Textual responses use exact match, required-content matching or LLM-based semantic equivalence. Other tasks examine the resulting environment: database records, API results, URLs or located page content. Thus its functional success measure asks whether the requested outcome actually happened. [Paper, section 3](https://arxiv.org/html/2307.13854v4), [evaluator implementation](https://github.com/web-arena-x/webarena/blob/main/evaluation_harness/evaluators.py)

The canonical repository instructs evaluators to host their own sites and reset the environment, rather than score on shared demo sites. It publishes the 812 task configurations; this is not a concealed official train/dev/test trilogy. BrowserGym wraps multiple benchmarks behind an environment interface and supports custom tasks; it has no single dataset size or universal split. The WebArena repository recommends BrowserGym/AgentLab infrastructure for newer experiments. [WebArena repository](https://github.com/web-arena-x/webarena), [BrowserGym repository](https://github.com/ServiceNow/BrowserGym)

**What TRACE should borrow:** an executable validator for every reference fact that permits it. Check typed values, entity/date/unit associations and full required sets; save exactly which fact failed. Use a semantic judge only where format variation demands it. Export replayable fixtures with pinned content, parser and validator versions. A future BrowserGym integration is useful packaging, not an immediate requirement for a URL reader benchmark.

**Limits and leakage:** self-hosted replicas remove the public-web anti-bot, geolocation and changing-origin behavior TRACE is testing. Many tasks require logged-in state or writes, outside a read-only scraper's remit. Do not cite a WebArena score as proof of a datacenter-access advantage. If constructing a training/development split, separate template families and underlying records; random instances from the same template can leak task structure. A versioned local test suite can complement, not replace, live measurements.

## 4. FRAMES: borrow the reference-document control

FRAMES has 824 test questions, gold answers and associated Wikipedia URLs, with questions spanning two to fifteen articles. The hosted release exposes reasoning categories and a single `test` split; there is no official training split. [Dataset](https://huggingface.co/datasets/google/frames-benchmark), [split-size API](https://datasets-server.huggingface.co/size?dataset=google%2Fframes-benchmark)

The paper compares question-only, BM25 document retrieval, supplied reference documents and iterative retrieval. It reports Gemini-Pro-1.5-0514 accuracy of 40.8% question-only, 47.4% with four BM25 documents, 72.9% with reference articles and 66% with iterative retrieval. These are published model-specific numbers, not expected TRACE baselines. Its Gemini autorater was checked against human labels, reporting 0.96 agreement accuracy and Cohen's kappa 0.889. Initial synthetic-generation experiments had over 30% hallucinated question/answer pairs; later human rechecking removed 5.5% of examples whose answers had changed over three months. [Paper, sections 2–3](https://arxiv.org/html/2409.12941v2)

**What TRACE should borrow:** run question-only, independently verified reference-content, Context-content and datacenter-content conditions with one frozen answerer. The reference-content condition diagnoses whether the model can solve the task when evidence is available. Treat it as an empirical reference condition, not a mathematical upper bound: context composition can change reasoning behavior. Measure recovered source/fact coverage alongside final answers, including tabular and temporal slices.

**Limits and leakage:** the published BM25 experiment uses a Wikipedia dump, so it bypasses live scraping. A live-URL variation must be labeled an adaptation. Wikipedia-only coverage is a useful control for parsing and reasoning, but weak evidence about access to hostile or dynamic sites. Extra reasoning does not eliminate pretraining contamination. Keep model versions and date-qualified questions fixed.

## A concrete TRACE validation ladder

These steps are our proposed study design, rather than claims made by the four benchmarks.

1. **Keep acquisition status as a diagnostic.** A substantive-looking page is not proof it contains the requested evidence. Report attempted/returned/blocked/unknown outcomes, target identity and latency independently from utility.
2. **Add question-conditioned evidence scoring.** Preselect tasks without reader outcomes. Before viewing either arm, independently establish one to five necessary facts and evidence spans per task. Report fact recall, all-required-facts recovered, and unsupported/contradictory output separately. Do not label a bag of correct tokens as a correct relation. Use date, entity, unit and table-coordinate checks.
3. **Measure downstream answer accuracy with a frozen answerer.** Use identical question, model, prompt, context budget and decoding settings. The only changing input is each reader's saved output. Retain failures in the denominator. Report paired differences with intervals clustered by shared source/document group; many questions on one source are not independent samples.
4. **Add the controls before interpreting the result.** Question-only quantifies answerability without acquired content. Reference-content performance identifies reasoning/data problems. A reader can improve evidence recovery without helping a weak answerer; answer correctness without evidence can reflect memorization or guessing. Report both rather than choosing the favorable one.
5. **Calibrate the actual graders.** Use provider-blind reviewed positive, negative, partial, wrong-entity, wrong-date and wrong-unit fixtures. Measure false-success rate separately from overall agreement. Version prompts/models/parsers, preserve corrections, and route unknowns to review. Publish reviewed examples and the exact scoring code.
6. **Bridge to existing benchmarks after the component pilot.** A small, predeclared WebWalkerQA development pilot validates the reference-URL procedure; do not optimize on the remaining external evaluation questions. Then report the untouched eligible remainder with a complete exclusion ledger. Add a separately reported FRAMES control cohort. Only after those work is a full browsing-agent run worth the greater search/tool variance and cost.

For external credibility, headline the connection: **“necessary evidence recovered” predicts “the fixed model answered correctly,” with a paired backend intervention and an independently reviewed reference.** This is stronger than either a generic “page looked useful” judgment or a whole-agent leaderboard score alone. A later RL claim additionally requires matched training runs and held-out evaluation; none of the comparisons above substitutes for that experiment.

## Small implementation lesson: fixture-test inherited graders

The BrowseComp evaluator at commit `5e623c2b400af62a1278e23595f95b0853d7fe8a` returns regex `group(0)` at line 82 but compares its result to the bare string `yes` at line 95. This tiny, API-free reproduction was run:

```python
import re
result = re.search(r"correct: (yes|no)", "correct: yes").group(0)
assert result == "correct: yes"
assert (result == "yes") is False
```

That pinned implementation would fail to credit a standard affirmative grader response along this path. This is an implementation-specific defect, **not evidence that the benchmark or published results are invalid**; their executed implementations may differ. TRACE should pin dependencies and require known-correct/known-incorrect grader fixtures before an evaluation. Do not blindly copy a repository's current branch. [Pinned source](https://github.com/openai/simple-evals/blob/5e623c2b400af62a1278e23595f95b0853d7fe8a/browsecomp_eval.py#L81)
