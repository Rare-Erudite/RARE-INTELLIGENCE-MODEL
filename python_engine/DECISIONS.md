# DECISIONS

Architecture decision records. Each entry states the decision, the reason, and
what it costs. Newest first.

---

## ADR-011 — Resume validates before acting, and refuses rather than guesses

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** `resume()` runs a pre-flight validation and raises
`TaskNotResumableError` before any model or tool call when the state is unsafe:
already succeeded, non-contiguous step indices, an unfinished step, or an
exhausted budget.

**Why.** A resume that guesses is worse than one that refuses. If step indices
have a gap, work was lost and continuing would silently skip it. If a step has
no `finished_at`, the process died mid-step and the side effect is unknown —
re-running it could duplicate a write. Refusing with a named invariant keeps the
failure legible and leaves the state file untouched.

**Cost.** Some recoverable situations need a manual config change (raising
`max_steps`) or a human decision about a partial side effect. Accepted: those
are exactly the cases where automation should stop.

---

## ADR-010 — Resume continues from the next index; it does not replay

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** `resume()` starts the loop at `len(steps) + 1`. Completed steps
are not re-executed; their observations are replayed into the prompt as history.

**Why.** Replaying would re-run tool calls, and a `write_file` that already
happened would happen again. The test asserts both the file mtime and the model
call count are unchanged, so this is enforced, not assumed.

**Cost.** The model sees a summary of prior steps rather than re-deriving them,
so a very long history is compressed by `history_window`. Accepted: the full
history remains in `TaskState` for audit.

---

## ADR-009 — Evaluation uses programmatic checkers, never an LLM judge

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** Every eval task is scored by code: exact-answer match, subprocess
execution of produced code against assertions, structural comparison of the
chosen tool call, or a predicate over final task state.

**Why.** An LLM judge puts a second unverified model inside the measurement
loop. If the judge is wrong, the score is wrong and there is no way to tell.
Programmatic checkers are reproducible and can themselves be tested.

**Cost.** Some qualities (writing style, explanation quality) cannot be scored
this way and are simply not measured. Accepted: better to measure less and
trust it.

---

## ADR-008 — Every eval task carries an oracle script

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** Each task includes `oracle_replies`, a known-good response
sequence. Oracle mode must score 25/25; a wrong adapter must score 0/25.

**Why.** Without this, a failing score is ambiguous: is the model weak, or is
the checker broken? The oracle run separates the two. It also caught a real bug
immediately — the answer checker rejected `"410."` because a sentence-ending
period failed the lookahead.

**Cost.** Each task needs a hand-written correct answer. Accepted: it is the
only way to trust the harness.

---

## ADR-007 — Qwen3-0.6B is a smoke model, not the intelligence target

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** Ship Qwen3-0.6B Q4_K_M as the default local model, and state
plainly that it is a smoke test.

**Why.** The host has 2 GiB RAM and 4 GB disk. 0.6B is the only size that fits
with headroom. It proves the contract, the adapter and the loop on real weights.
It cannot reliably choose tools, and the docs say so.

**Cost.** Local runs are not useful for real work. Accepted: the production path
is a remote OpenAI-compatible endpoint, which is already implemented.

---

## ADR-006 — JSON files, not SQLite, for task state

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** One JSON file per task plus an index, written atomically.

**Why.** Inspectable with `cat`, diffable in Git, no server, no migration tool,
no native dependency. Atomic replacement gives crash safety on POSIX.

**Cost.** One writer per task; no concurrent access. Accepted for now — SQLite
is the documented upgrade path once concurrency exists.

---

## ADR-005 — Small tool surface

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** `read_file`, `write_file`, `list_dir`, plus an opt-in shell tool.

**Why.** A 0.6B model cannot reliably choose among twenty tools. A small surface
makes tool choice measurable and the sandbox auditable.

**Cost.** Less capable out of the box. Accepted: tools are added as the model
and the eval suite justify them.

---

## ADR-004 — Bounded repair instead of grammar-constrained JSON

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** Parse leniently (strip fences, find the JSON object, handle
` thinking` blocks) and feed failures back, rather than constraining decoding
with a grammar.

**Why.** Grammar-constrained decoding measurably hurts small-model tool choice,
and it makes the failure mode opaque. Lenient parsing plus a repair note keeps
the model in the loop and the error visible.

**Cost.** Some steps are spent on repair. Accepted: bounded by `max_steps`.

---

## ADR-003 — ChatML prefill to disable Qwen3 thinking

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** Render ChatML manually and prefill `</think>\n\n` so the model
continues straight into the answer.

**Why.** Qwen3 emits a `</think>` block first. On a small token budget it
consumed the entire completion and no action was ever produced — every task
would have failed in production. `chat_template_kwargs` is not supported by
llama-cpp-python 0.3.36 (verified by `TypeError`).

**Cost.** Tied to the ChatML template. Accepted: it is guarded by a real-model
test.

---

## ADR-002 — Typed error hierarchy with stable codes

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** Every engine failure is a `RareError` subclass with a stable
`code` used in logs and in `TaskState.last_error_code`.

**Why.** Callers and operators need to distinguish "the model timed out" from
"the sandbox blocked a path" without parsing prose.

**Cost.** More classes to maintain. Accepted: the codes are part of the contract.

---

## ADR-001 — Independent repository, no coupling to the existing app

**Date:** 2026-10-28 · **Status:** accepted

**Decision.** This project lives in its own repository and does not modify,
merge into, or deploy to `Rare-Erudite/COMPLETED`. Only
`INTEGRATION_CONTRACT.md` is prepared.

**Why.** The engine is a runtime, not a feature of the existing application.
Coupling them would make both harder to reason about and would risk the
production app.

**Cost.** Integration is a separate future step requiring explicit
authorization. Accepted deliberately.
