# ROADMAP

**Last updated:** 2026-10-28 · **Version:** 0.2.0

Status legend: ✅ done and tested · 🟡 in progress · ⬜ not started · 🔒 blocked on the user

---

## Phase 0 — Foundation ✅

| Item | Status |
|---|---|
| Config (YAML + env, pydantic) | ✅ |
| Model contract + llama.cpp adapter | ✅ |
| OpenAI-compatible adapter | ✅ (unit-tested; no live endpoint) |
| Action protocol + bounded repair | ✅ |
| Orchestrator loop with budgets | ✅ |
| Tool registry + sandbox | ✅ |
| Typed task state + atomic JSON store | ✅ |
| Structured JSON logging | ✅ |
| CLI | ✅ |
| End-to-end example | ✅ |
| CI workflow written | ✅ (never executed) |

## Phase 1 — Durability ✅

| Item | Status |
|---|---|
| `rare resume <task_id>` | ✅ 16 tests |
| Pre-flight state validation (refuse unsafe continuation) | ✅ |
| No duplicate side effects on resume | ✅ asserted |
| Corrupted / future-schema state handling | ✅ |

## Phase 2 — Measurement ✅

| Item | Status |
|---|---|
| 25-task eval suite across 5 suites | ✅ |
| Programmatic checkers (no LLM judge) | ✅ |
| Harness self-check (oracle 25/25) | ✅ |
| Negative check (wrong adapter 0/25) | ✅ |
| Deterministic baseline recorded | ✅ (echo 6/25) |
| Eval run against a capable model | 🔒 needs hardware or endpoint |

## Phase 3 — Remote + CI 🔒

| Item | Status |
|---|---|
| Create `RARE-INTELLIGENCE-ENGINE` on GitHub | 🔒 no credentials |
| Push `main` | 🔒 |
| First CI run | 🔒 |
| Branch protection on `main` | 🔒 |

**Blocker:** no `gh` CLI, no token, no OAuth-capable GitHub MCP toolkit.
Smallest action: provide a remote URL + push credentials, or enable the GitHub
integration for this agent.

## Phase 4 — Retrieval and memory ⬜ (next buildable)

| Item | Status |
|---|---|
| Local embedding index over the sandbox | ⬜ |
| `search` tool wired into the registry | ⬜ |
| Durable memory across tasks | ⬜ |
| Retrieval eval suite that echo cannot game | ⬜ |

This is the next increment that needs **no new hardware and no credentials**.
It also fixes the known weakness that the current `research` suite is gameable.

## Phase 5 — Research and document intelligence ⬜

| Item | Status |
|---|---|
| Web fetch tool (allowlisted domains, bounded output) | ⬜ |
| PDF / DOCX / XLSX ingestion | ⬜ |
| Citation tracking in task state | ⬜ |
| Document Q&A eval suite | ⬜ |

## Phase 6 — Software building ⬜

| Item | Status |
|---|---|
| Repo-aware file tools (tree, grep, patch) | ⬜ |
| Test-driven repair loop (run tests → read failure → patch → re-run) | ⬜ |
| Build sandbox with resource limits | ⬜ |
| Coding eval suite with real test execution | ⬜ |

## Phase 7 — Routing and multi-agent ⬜

| Item | Status |
|---|---|
| Model routing (cheap model for easy steps, strong for hard) | ⬜ |
| Tool routing / capability selection | ⬜ |
| Sub-task decomposition | ⬜ |
| Multi-agent coordination with shared state | ⬜ |

## Phase 8 — Multimodal ⬜

| Item | Status |
|---|---|
| Image input to the model contract | ⬜ |
| OCR / document image pipeline | ⬜ |
| Audio transcription | ⬜ |

## Phase 9 — Self-diagnostics and repair ⬜

| Item | Status |
|---|---|
| Failure classification (tool / build / protocol / recovery) | ⬜ |
| Isolated repair attempts with rollback | ⬜ |
| Regression tests generated from failures | ⬜ |
| Checkpoint + rollback of task state | ⬜ |

**Rule for this phase:** a repair may never bypass permission checks or promote
an unverified change. Every repair must be followed by a regression test.

---

## Explicit non-goals

- Integrating with `Rare-Erudite/COMPLETED` without explicit authorization.
  Only `INTEGRATION_CONTRACT.md` is prepared.
- Training a foundation model.
- Running 70B models on this class of hardware.

## Sequencing rationale

Phases 3 and 4 are independent: 3 is blocked on credentials, 4 is not. Work
continues on 4 while 3 waits. Phases 5–9 each depend on 4 (retrieval) or on a
capable model, so they are ordered after it rather than attempted as stubs.
