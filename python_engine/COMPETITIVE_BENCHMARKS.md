# COMPETITIVE_BENCHMARKS

**Last updated:** 2026-10-28

> **Every number in this file is labelled.** `vendor-published` means the model
> author reported it and this project has not reproduced it. `measured-here`
> means this repository produced it and it is reproducible from a command in
> TEST_REPORT.md. There are currently **no `measured-here` quality scores** —
> the evaluation harness is Stage 2 in MODEL_DEVELOPMENT_PLAN.md and has not
> been run against a capable model yet. Do not cite this file as evidence that
> this engine is competitive; it is a landscape survey.

---

## 1. Why this comparison is constrained

The engine must run on the hardware in MODEL_REGISTRY.md §1: **2 GiB RAM,
4 GB disk, 1 CPU, no GPU**. That eliminates most of the field before quality
is even discussed. The comparison below is therefore split into "what fits
here" and "what we would use if hardware allowed".

---

## 2. Small models that fit (0.6B–1.7B)

| Model | Params | Context | Licence | Notable vendor-published figures |
|---|---|---|---|---|
| Qwen3-0.6B | 0.6B | 32K | Apache-2.0 | Qwen reports it as the smallest of the Qwen3 dense line; no headline benchmark claimed for this size |
| Qwen3-1.7B | 1.7B | 32K | Apache-2.0 | same family; Qwen positions 1.7B as phone-class |
| DeepSeek-R1-Distill-Qwen-1.5B | 1.5B | 32K | MIT (verify) | `vendor-published`: AIME 2024 pass@1 **28.9**, MATH-500 **83.9**, GPQA Diamond **33.8**, LiveCodeBench **16.9**, CodeForces rating **954** |
| Llama-3.2-1B-Instruct | 1.23B | 128K | Llama-3.2-Community | Meta positions it for on-device; no headline reasoning benchmark |

**Reading the DeepSeek row honestly:** those numbers come from the R1 paper's
distillation table and are *math/reasoning* benchmarks. A 1.5B model scoring
83.9 on MATH-500 is a real result, but MATH-500 is a narrow distribution and
the model was distilled specifically on reasoning traces. It says little about
multi-step tool use, which is what this engine needs. The 16.9 LiveCodeBench
and 954 CodeForces rating are the more relevant signals, and they are modest.

---

## 3. Models that do not fit here but define the target

| Model | Params | Context | Licence | `vendor-published` highlights |
|---|---|---|---|---|
| Qwen3-4B-Instruct-2507 | 4B | 128K | Apache-2.0 | MMLU-Pro **69.6**, GPQA **62.0**, AIME25 **47.4**, LiveCodeBench v6 **31.5**, BFCL-v3 **53.0**, TAU1-Retail **48.7** |
| Qwen3-8B | 8B | 128K | Apache-2.0 | — (not surveyed in detail) |
| Qwen3-30B-A3B (MoE) | 30B / 3B active | 128K | Apache-2.0 | MMLU-Pro **69.1**, GPQA **54.8**, BFCL-v3 **58.6** |
| DeepSeek-R1-Distill-Qwen-7B | 7B | 32K | Apache-2.0 | AIME 2024 **55.5**, MATH-500 **92.8**, GPQA **49.1**, LiveCodeBench **37.6** |
| DeepSeek-R1-Distill-Qwen-14B | 14B | 32K | Apache-2.0 | AIME 2024 **69.7**, MATH-500 **93.9**, GPQA **59.1**, LiveCodeBench **53.1** |
| Llama-3.2-3B-Instruct | 3.21B | 128K | Llama-3.2-Community | — |

### The one comparison that matters for this project

**BFCL-v3** (Berkeley Function Calling Leaderboard) and **TAU-bench** measure
tool use, which is the engine's actual requirement. On those:

- Qwen3-4B-Instruct-2507: BFCL-v3 **53.0**, TAU1-Retail **48.7**
- Qwen3-30B-A3B: BFCL-v3 **58.6**

A 4B model at 53 on BFCL is roughly "gets the tool right about half the time".
That is the realistic bar for a small local agent, and it is why the
orchestrator has a bounded repair loop rather than assuming first-try
correctness. It is also why Stage 3 in the development plan starts at 4B and
not at 1.7B.

---

## 4. What this project measures instead

Public benchmarks do not answer "does *this* engine complete *this* task".
The Stage 2 harness (MODEL_DEVELOPMENT_PLAN.md) measures five things with
programmatic checkers:

| Suite | Checker | Why it is checkable |
|---|---|---|
| reasoning | exact answer match | the answer is a number or a short string |
| coding | run the produced function against assertions | pass/fail is mechanical |
| tool_use | compare chosen tool + args to the expected call | structural equality |
| research | required fact present + source string present | substring match on a known fact |
| completion | final state satisfies a predicate | inspect the task store |

No LLM judge. A judge would introduce a second unverified model into the
measurement loop, which defeats the purpose.

---

## 5. Sources

- Qwen3-4B-Instruct-2507 card (MMLU-Pro, GPQA, AIME25, LiveCodeBench, BFCL-v3, TAU): <https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507>
- Qwen3 blog (family, sizes, Apache-2.0): <https://qwenlm.github.io/blog/qwen3>
- DeepSeek-R1 repo (distill benchmark table): <https://github.com/deepseek-ai/deepseek-r1>
- DeepSeek-R1-Distill-Qwen-7B card: <https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B>
- Llama 3.2 licence: <https://dev.meta.ai/llama/llama3_2/license>

**Caveat on all vendor numbers:** they are self-reported, measured with the
vendor's own harness and prompt format. Cross-model comparison is indicative,
not rigorous. Treat them as a shortlist filter, not a verdict.
