# CAPABILITIES

**Last updated:** 2026-10-28 · **Version:** 0.2.0

This file states what the engine **can do today**, with the evidence for each
claim. Anything not listed here is not a capability yet, regardless of what the
roadmap plans.

> **Reading rule:** "works" means a test in TEST_REPORT.md exercises it. Where a
> capability is limited, the limit is stated in the same row rather than in a
> footnote.

---

## 1. Task execution

| Capability | Status | Evidence / limit |
|---|---|---|
| Run a goal through a bounded plan/act/observe loop | ✅ | `tests/test_orchestrator.py` |
| Enforce step, model-call, tool-call and wall-clock budgets | ✅ | budget tests; failure is reported, never faked |
| Persist every step to disk atomically | ✅ | `tests/test_state.py` |
| Recover from malformed model output (fences, prose, ` thinking`) | ✅ | `tests/test_protocol.py` |
| Feed protocol errors back to the model for self-correction | ✅ | orchestrator repair path |
| **Resume an interrupted task from its last completed step** | ✅ | `tests/test_resume.py` (16) |
| **Refuse an unsafe resume before any side effect** | ✅ | refusal tests assert zero model calls and an unchanged file |
| **Avoid repeating completed side effects on resume** | ✅ | mtime + call-count assertion |

**Limit:** a task that hits `max_steps` fails with `budget_exhausted`. It does
not silently continue. Raising the budget and running `rare resume` is the
supported path.

## 2. Models

| Capability | Status | Evidence / limit |
|---|---|---|
| Load and run a real GGUF on CPU | ✅ | 3 real-model tests, Qwen3-0.6B |
| Suppress Qwen3 thinking mode | ✅ | ChatML prefill; `chat_template_kwargs` unsupported in 0.3.36 |
| Swap models behind one contract | ✅ | `ModelAdapter` ABC, 3 implementations |
| Call an OpenAI-compatible endpoint | ⚠️ | unit-tested only — **never called live** |
| Deterministic offline adapter for CI | ✅ | `EchoAdapter` |

**Limit:** on this host (1 CPU, 2 GiB RAM) only 0.6B–1.7B models fit, at
~0.08 tok/s. See MODEL_REGISTRY.md.

## 3. Tools

| Capability | Status | Evidence / limit |
|---|---|---|
| `read_file`, `write_file`, `list_dir` | ✅ | `tests/test_tools.py` |
| Block `../` traversal | ✅ | dedicated test |
| Block absolute paths outside the sandbox | ✅ | dedicated test |
| Block symlink escapes | ✅ | dedicated test |
| Tool allowlist | ✅ | dedicated test |
| Shell tool, off by default | ✅ | gated test |
| Bounded tool output (truncation) | ✅ | dedicated test |
| Web / browser tool | ⬜ | not implemented |
| Search / retrieval tool | ⬜ | not implemented |

**Limit:** the sandbox is a boundary for the model's own actions, not a
security sandbox against a hostile process.

## 4. Measurement

| Capability | Status | Evidence / limit |
|---|---|---|
| 25-task eval suite, 5 categories | ✅ | `benchmarks/tasks.py` |
| Programmatic scoring, no LLM judge | ✅ | checkers in `benchmarks/tasks.py` |
| Harness self-check (oracle 25/25) | ✅ | `tests/test_evals.py` |
| Prove checkers can fail (wrong adapter 0/25) | ✅ | `tests/test_evals.py` |
| Score a real model | 🔒 | needs hardware or a live endpoint |
| Retrieval suite that cannot be gamed | ⬜ | current `research` suite is gameable |

## 5. Operations

| Capability | Status | Evidence / limit |
|---|---|---|
| CLI: `run`, `resume`, `status`, `show`, `tools`, `doctor` | ✅ | exercised manually |
| Structured JSON logs with run/task/step binding | ✅ | `tests/` + manual |
| CI workflow (lint + fast tests + state validation) | ⚠️ | written, **never executed** |
| Push to a remote | 🔒 | no credentials |

## 6. Not capabilities (do not claim these)

- Multi-agent coordination
- Long-term memory across tasks
- Retrieval / embeddings / vector search
- Web research
- Document intelligence (PDF/DOCX/XLSX)
- Model or tool routing
- Autonomous software building / TDD repair
- Multimodal input
- Self-diagnostics and isolated repair
- Streaming responses
- Concurrent writers (single writer per task)
- Integration with `Rare-Erudite/COMPLETED`
