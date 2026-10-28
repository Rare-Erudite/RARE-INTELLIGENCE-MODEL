# MODEL_DEVELOPMENT_PLAN

**Last updated:** 2026-10-28
**Companion to:** MODEL_REGISTRY.md (selection), COMPETITIVE_BENCHMARKS.md (evidence)

This plan answers one question: **how does the engine get from "a 0.6B model
proves the loop works" to "a model that reliably completes multi-step
engineering tasks"?** It is deliberately staged so that each stage is
independently useful and independently verifiable.

---

## Stage 0 — Smoke model (current)

**Model:** Qwen3-0.6B Q4_K_M, local, CPU.
**Purpose:** prove the contract, not the intelligence.

Exit criteria (all met — see TEST_REPORT.md):

- [x] weights load through `LlamaCppAdapter`
- [x] generation returns text with usage accounting
- [x] the action protocol parses real model output
- [x] the orchestrator completes a task end to end on real weights
- [x] thinking-mode suppression works (Qwen3 emits ` thinking` by default)

**What this stage does NOT prove:** that a 0.6B model can choose tools
correctly. It cannot, reliably. Do not read the green test suite as a
capability claim.

---

## Stage 1 — Remote endpoint (next, blocked on credentials)

**Model:** any OpenAI-compatible endpoint (vLLM, TGI, Ollama, hosted API).
**Purpose:** prove the model-agnostic claim and get usable latency.

Why this is stage 1 and not "download a bigger model": the host has 2 GiB RAM
and 4 GB disk. Downloading a 4B model here would fail, and even if it fit, at
0.08 tok/s a single task would take hours. The adapter already exists; it needs
an endpoint, not code.

Exit criteria:

- [ ] `openai_compat` adapter called against a live endpoint (never done)
- [ ] one full task completed through it, recorded in TEST_REPORT.md
- [ ] latency and token accounting compared against the local baseline

**Blocker:** `RARE_OPENAI_BASE_URL` + `RARE_OPENAI_API_KEY`, or a local
vLLM/Ollama server. Smallest action: set the two env vars.

---

## Stage 2 — Evaluation harness (buildable now, no new hardware)

**Purpose:** stop guessing. Every model change must be measured against a
fixed suite before it is adopted.

The suite is defined in `benchmarks/` and is deliberately small enough to run
on a 0.6B model without waiting a day:

| Suite | What it measures | Tasks |
|---|---|---|
| `reasoning` | multi-step arithmetic/logic with a checkable answer | 5 |
| `coding` | write a function that passes provided assertions | 5 |
| `tool_use` | pick the right tool and arguments from a schema | 5 |
| `research` | extract a fact from provided text, cite it | 5 |
| `completion` | finish a 3+ step task without losing the goal | 5 |

Scoring is **pass/fail per task with a programmatic checker**, not an LLM
judge — a judge would add a second unverified model to the loop.

Exit criteria:

- [ ] harness runs offline against the echo adapter (deterministic baseline)
- [ ] baseline recorded for Qwen3-0.6B, with the honest caveat that a 0.6B
      model will score near zero on `tool_use` and `completion`
- [ ] results written to TEST_REPORT.md with the exact command

---

## Stage 3 — Right-sized local model (needs hardware)

**Model:** Qwen3-4B-Instruct-2507 Q4_K_M (first size where agentic tool use is
realistic), or Qwen3-1.7B if only 4 GiB is available.

Exit criteria:

- [ ] ≥8 GiB RAM and ≥8 GB disk available
- [ ] Stage 2 suite re-run; scores recorded side by side with Stage 0
- [ ] adoption decision recorded in DECISIONS.md with the numbers

**Blocker:** hardware. Smallest action: raise the container memory limit, or
run the engine on a machine with 8 GiB+.

---

## Stage 4 — Task-specific adaptation (only if Stage 3 is insufficient)

Options, in order of cost:

1. **Prompt/contract tuning** — cheapest. The action protocol and repair loop
   already absorb a lot of model weakness.
2. **Few-shot exemplars in the system prompt** — cheap, measurable with Stage 2.
3. **LoRA fine-tune on successful traces** — needs a GPU and a corpus of
   verified successful runs. Only worth it once the engine produces enough
   successful traces to learn from, which requires Stage 3 first.

**Explicitly not planned:** training a foundation model. Out of scope.

---

## Non-goals

- Beating frontier models on public benchmarks. The engine's value is the
  loop, the state discipline and the tooling — not raw model quality.
- Running 70B models locally. Not on this class of hardware, ever.
- An LLM-as-judge evaluation layer. Adds an unverified dependency.

---

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-28 | Qwen3-0.6B as smoke model | only size that fits 2 GiB RAM; Apache-2.0 |
| 2026-10-28 | Remote endpoint as production path | local hardware cannot host a capable model |
| 2026-10-28 | Programmatic checkers, no LLM judge | keeps evaluation verifiable |
