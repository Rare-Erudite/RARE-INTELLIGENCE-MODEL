# CHANGELOG

All notable changes to the RARE Intelligence Engine. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are pre-1.0 and the
API may change.

---

## [0.3.1] — 2026-10-29

### Fixed

- **CRITICAL: the repository was not restorable.** `.gitignore` contained
  unanchored `models` and `models/` patterns, which match any directory named
  `models` at any depth. `rare_engine/models/` — the entire model layer (base,
  echo, llamacpp, openai adapters) — was silently excluded from all six
  commits. The working tree passed 187 tests because the files existed on disk;
  a fresh clone failed at import with `ModuleNotFoundError: No module named
  'rare_engine.models'`. Found by restoring the backup bundle into a clean
  directory. Both patterns are now anchored to the repo root.
- 10 ruff errors in `rare_engine/models/*.py` that CI had never seen, because
  those files were excluded from git until the fix above.
- `search()` referenced an undefined `namespace` after the isolation refactor;
  the parameter was missing from the signature. Caught by the existing suite.
- `retrieval_eval.py` printed negative-control expectations as
  `(, n, o, t, h, i, n, g, )` because a string was joined as an iterable.

### Added

- **Portable backup** — `git bundle --all` plus a plain working-tree tarball,
  excluding secrets, `.rare/` state, model weights and caches. Restore-verified
  by cloning into a clean directory and running the suite there.
- **Namespace isolation** in the memory index. Documents carry a `namespace`
  (default `default`); `search(..., namespace=...)` restricts both the
  candidate set and the BM25 statistics to that boundary. `namespace=None`
  preserves the previous whole-index behaviour.
- **Retrieval evaluation suite** (`benchmarks/retrieval_eval.py`) — 17 cases
  over 14 documents across 8 categories: direct, paraphrase, synonym,
  multi-hop, distractor, contradiction, negative control, namespace isolation.
  Reports precision@k, recall@k, MRR and negative-control accuracy. Measures
  the retriever only; no model, no adapter, no generation.
- 17 tests in `tests/test_retrieval_eval.py`, including one asserting that
  namespace scoping changes the BM25 statistics and not merely the result list.

### Measured

- Fast suite: **204 passed, 3 deselected** (was 187).
- Retrieval eval at k=3: P@k 0.385, R@k 1.000, MRR 1.000,
  negative-control accuracy 0.500, 15/17 cases passed.
- Two negative controls fail and are recorded rather than tuned away.

---

## [0.3.0] — 2026-10-29

### Added

- **Retrieval and durable memory** (`rare_engine/memory/`) — a real BM25
  implementation with no downloads and no GPU, chosen because the measured
  envelope is 2 GiB RAM and no embedding runtime is installed.
  - `tokenizer.py` — case folding, plural reduction, stopwords. Deliberately
    conservative: no Porter stemming, so `retrieve` will not match `retrieval`.
  - `bm25.py` — pure ranking functions. Uses the `1 +` IDF form so a term in
    most documents never gets negative weight (which would invert ranking).
  - `chunking.py` — overlapping, offset-tracking spans that prefer paragraph
    then sentence then word breaks, with a guaranteed-progress rule.
  - `index.py` — persistent index. Stores only the corpus; postings are
    **derived** on load so the two cannot drift. Atomic write via temp file +
    `os.replace`. Re-ingesting a `source` replaces it, making `rare index`
    idempotent.
  - `retrieval.py` — facade separating corpus retrieval from durable notes
    (`note://` prefix), plus `format_hits` for citable model-facing output.
- **`retrieve` and `remember` tools** — registered only when a retriever is
  attached, so a memory-less run does not waste prompt slots. `top_k` is
  clamped to 20 so the model cannot flood its own context.
- **CLI:** `rare index <path>`, `rare search <query>`, `rare remember <text>`,
  `rare memory`.
- **`MemoryConfig`** — `enabled`, `dir`, `chunk_chars`, `chunk_overlap`,
  `top_k`, `max_snippet_chars`; env overrides `RARE_MEMORY_ENABLED`,
  `RARE_MEMORY_DIR`, `RARE_MEMORY_TOP_K`.
- **76 new tests** — 187 fast tests total, 0 failures, ruff clean.

### Fixed

- `singularize()` reduced `analysis` to `analysi`, which would never match the
  original term. `-sis` and `-us` endings are now protected.

### Notes

- One test assertion was wrong, not the code: after replacing a document,
  searching `version one` still matched because `version` is shared by both
  revisions. The index was correct; the assertion was tightened to use a
  distinctive term.
- **No push occurred.** The remote holds an unrelated TypeScript history and no
  credentials are available. See STATUS.md for the exact blocker.

---

## [0.2.0] — 2026-10-28

### Added

- **`rare resume <task_id>`** — continue an interrupted or failed task from its
  last completed step. Completed steps are not replayed, so recorded tool side
  effects stay single. Pre-flight validation refuses unsafe continuations
  (already succeeded, non-contiguous step indices, unfinished step, exhausted
  step/model/tool budget) before any model or tool call. 16 tests.
- **`TaskNotResumableError`** (`code = "task_not_resumable"`).
- **Evaluation harness** — 25 tasks across `reasoning`, `coding`, `tool_use`,
  `research`, `completion`, each scored by a programmatic checker. Every task
  carries an `oracle_replies` script; oracle mode scores 25/25 and a
  deliberately-wrong adapter scores 0/25. 18 tests.
- **`scripts/evaluate.py`** — CLI with `--adapter oracle|echo|llamacpp`,
  `--suite`, `--json`, `--out`.
- **`MODEL_REGISTRY.md`** — hardware envelope, candidate matrix, selection with
  evidence, machine-readable registry entries, sources.
- **`MODEL_DEVELOPMENT_PLAN.md`** — staged plan from smoke model to capable
  model, with exit criteria per stage.
- **`COMPETITIVE_BENCHMARKS.md`** — landscape survey with every number labelled
  `vendor-published` or `measured-here`.
- **`MASTER_SPEC.md`**, **`ROADMAP.md`**, **`CAPABILITIES.md`**,
  **`RECOVERY.md`**, **`DECISIONS.md`** (11 ADRs).

### Changed

- `Orchestrator.run()` and `resume()` now share one `_execute()` path, so
  budgets, error handling and persistence cannot drift between them.
- `RunResult` gained `resumed_from_step`.

### Fixed

- Eval answer checker rejected a correct answer followed by a sentence-ending
  period (`"410."`) — the lookahead was too strict. Caught by the oracle
  self-check, which is exactly what it is for.
- Pre-existing `ruff` BLE001 in `scripts/fetch_model.py` — the broad `except` is
  intentional (any download failure must clean up the partial file), so it is
  annotated rather than narrowed.

### Verified

- 111 fast tests pass, 0 failed, 0.85 s.
- `ruff check .` — all checks passed.
- Oracle eval 25/25; echo baseline 6/25.

---

## [0.1.0] — 2026-10-28

### Added

- Working vertical slice: config, model contract, llama.cpp adapter,
  OpenAI-compatible adapter, echo adapter, action protocol with bounded repair,
  orchestrator loop with budgets, tool registry with sandbox, typed task state
  with atomic JSON store, structured JSON logging, CLI, end-to-end example,
  model fetch script, CI workflow.
- 77 fast tests, 3 real-model tests against Qwen3-0.6B Q4_K_M.

### Fixed

- `ProtocolError` was missing from the error hierarchy (3 test modules failed to
  collect).
- `SYSTEM_PROMPT.format()` crashed on the JSON braces in the prompt
  (`KeyError: '"thought"'`) — 13 tests.
- Env allowlist coercion left a string when the YAML default was absent.
- Real-model test timed out at the production 180 s model timeout on a 1-CPU
  host.
- **Qwen3's `</think>` block consumed the whole completion so no action was
  ever emitted** — every task would have failed in production. Fixed with a
  ChatML prefill of an empty think block, after verifying
  `chat_template_kwargs` is unsupported in llama-cpp-python 0.3.36.
