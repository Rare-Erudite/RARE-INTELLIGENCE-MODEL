# TEST REPORT

**Date:** 2026-10-29
**Commit under test:** `24c6ac6` (retrieval eval suite) — supersedes `2cacf2a`
**Python:** 3.11.15 · **pytest:** 9.2.0 · **llama-cpp-python:** 0.3.36
**Model:** Qwen3-0.6B-Instruct Q4_K_M GGUF, 396,705,472 bytes

All output below is copied from real runs on this machine. Nothing is
estimated, and no test was skipped to make the numbers look better.

---

## Integration run — 2026-10-29 (branch `engine-integration-v0.3.1`)

Run inside `python_engine/` after the engine was copied into the TypeScript
repository. The TypeScript numbers were taken in the repo root.

### Python engine

```
$ cd python_engine && python -m pytest -p no:warnings
219 passed, 4 skipped in 1.96s
```

The 4 skips: 3 are `requires_model` (no GGUF weight file in this checkout —
the weights are deliberately excluded from Git), 1 is
`test_resume_completed_task_is_409`, which skips when the echo adapter does
not reach a terminal success state.

### Python HTTP service

```
$ python -m pytest tests/test_service.py -p no:warnings
15 passed, 1 skipped in 0.71s
```

Covers: unauthenticated `/health`; 401 on missing and wrong token; 503 when
`RARE_SERVICE_TOKEN` is unset (fail-closed); the anonymous opt-in override;
task run / get / list; 404 for unknown task; 409 for resuming a finished task;
remember→search round trip; empty result for a non-matching query; `top_k`
bounding; and a wire-shape assertion that the JSON stays snake_case.

### TypeScript app

```
$ npx tsc --noEmit
(no output, exit 0)

$ npx vite build
✓ 1674 modules transformed.
✓ built in 806ms

$ npm test
"totalTests": 30
"passedCount": 30
"failedCount": 0
```

**Baseline before any change was 28 passed / 0 failed.** The 2 new tests are
the "Python Engine Contract" suite: snake_case→camelCase mapping, base-URL
normalisation, bearer header presence, request-body field names, and
structured error-code surfacing on 409.

### Bugs found and fixed during integration

1. `service.py` passed an `EngineConfig` to `ToolRegistry`, whose first
   parameter is a sandbox path — `TypeError: expected str, bytes or
   os.PathLike object, not EngineConfig`. Fixed by using
   `build_registry(cfg, retriever=...)`, which wires sandbox path, allowlist
   and shell policy from config.
2. `python_engine/models` was a **symlink** to `/workspace/models`, i.e. to
   396 MB of GGUF weights. Committing it would have either failed or shipped
   weights. Replaced with an empty directory plus `.gitkeep`.

### Not run this session

- The 3 `requires_model` tests (no weights in this checkout).
- Any real-model quality measurement. Only the echo adapter has run here;
  echo output is **not** evidence of model intelligence and is excluded from
  all quality claims.

---

## 0. Current totals (2026-10-29)

```
$ python3 -m pytest -m "not requires_model" -p no:warnings
204 passed, 3 deselected in 1.38s

$ python3 -m ruff check .
All checks passed!
```

---

## 0a. Backup restore verification (2026-10-29)

This is the most important test in this report, because it is the one that
proved the repository was not actually restorable.

```
$ git bundle verify /workspace/backups/rare-engine-14c1729-20261028T231814Z/rare-engine.bundle
The bundle contains these 3 refs:
14c17295976d6425658eff32e640cfc6abc4f9ad refs/heads/main
81fd40664ebf338d209d3ba22dd584bd355dab12 refs/remotes/origin/main
14c17295976d6425658eff32e640cfc6abc4f9ad HEAD
The bundle records a complete history.
The bundle uses this hash algorithm: sha1
... is okay

$ git clone <bundle> /tmp/restore-verify2/repo
$ cd /tmp/restore-verify2/repo && git rev-parse HEAD
14c17295976d6425658eff32e640cfc6abc4f9ad
$ git rev-list --count HEAD
7
$ git ls-files | wc -l
59
$ python3 -m pytest -m "not requires_model" -p no:warnings
187 passed, 3 deselected in 0.79s
```

**The first attempt at this failed**, and that failure is the finding:

```
$ cd /tmp/restore-verify/repo && python3 -m pytest -m "not requires_model"
ImportError while loading conftest '/tmp/restore-verify/repo/tests/conftest.py'.
tests/conftest.py:20: in <module>
    from rare_engine.models.base import (  # noqa: E402
E   ModuleNotFoundError: No module named 'rare_engine.models'
```

Cause: `.gitignore` had unanchored `models` and `models/` patterns. A bare
`models` pattern matches **any** directory named `models` at any depth, so
`rare_engine/models/` — the entire model layer — was excluded from all six
commits. `git check-ignore -v rare_engine/models/base.py` confirmed it:

```
.gitignore:11:models/   rare_engine/models/base.py
```

Fixed in `14c1729` by anchoring both patterns to `/models` and `/models/`.
After the fix, 5 adapter files are tracked and the clean clone passes 187/187.

---

## 0b. Retrieval evaluation (2026-10-29)

```
$ python3 benchmarks/retrieval_eval.py --k 3
========================================================================
RARE RETRIEVAL EVALUATION (BM25)
========================================================================
Measures the RETRIEVER only. No model, no adapter, no generation.
Corpus: 14 documents | Cases: 17 | k=3

category          cases  passed     P@k     R@k     MRR
------------------------------------------------------------------------
contradiction         1       1   0.667   1.000   1.000
direct                3       3   0.333   1.000   1.000
distractor            1       1   0.333   1.000   1.000
isolation             2       2   0.333   1.000   1.000
multi_hop             1       1   0.667   1.000   1.000
negative              4       2       -       -       -
paraphrase            3       3   0.333   1.000   1.000
synonym               2       2   0.333   1.000   1.000
------------------------------------------------------------------------
OVERALL              17      15   0.385   1.000   1.000

Negative-control accuracy: 0.500

FAILURES (2) - recorded, not tuned away:
------------------------------------------------------------------------
  [negative] neg_vacation
    query:     how many vacation days do employees get
    expected:  (nothing)
    retrieved: doc_tenant_a, doc_tenant_b
    note:      'days' appears in tenant docs - adversarial
  [negative] neg_billing_db
    query:     which database engine does the billing service use
    expected:  (nothing)
    retrieved: doc_schema, doc_incident, doc_auth
    note:      'database' and 'service' both appear elsewhere - adversarial
```

**This measures the retriever, not a model.** No adapter is constructed and no
generation occurs. It is not evidence of model intelligence.

**Two failures are real and left in place.** Both are lexical retrieval
returning a passage for an unanswerable question because a single common term
matched. A query-term-coverage threshold would fix them but would also suppress
legitimate partial matches, so the limitation is recorded rather than tuned
into the corpus.

**Three predictions were wrong.** `para_token_expiry`, `para_rollback` and
`para_budget` were annotated "expected to fail" on the assumption that no
stemming would break them. All three passed. The annotations were corrected to
record what actually happened instead of leaving a false prediction in the
suite.

**A display bug was found and fixed** while reading this output: negative-control
expectations printed as `(, n, o, t, h, i, n, g, )` because a string was joined
as an iterable. Now a list.

---

## 0c. Namespace isolation (2026-10-29)

17 new tests in `tests/test_retrieval_eval.py`, all passing. The load-bearing
one:

```
test_scoping_changes_statistics_not_just_results
```

It builds the same document in two indexes — one alone, one alongside 20 large
filler documents in a different namespace — and asserts the BM25 score is
identical. If filtering happened after scoring, the small namespace's score
would be depressed by the filler's average document length and this would fail.

---

**187 fast tests, 0 failed.** Up from 111 — this session added 76 tests for the
retrieval and memory layer. The 3 real-model tests were not re-run this session;
their last verified result (3 passed, 939s) stands from v0.2.0.

### New this session: `tests/test_memory_core.py` (44) + `tests/test_memory_index.py` (32)

| Area | Tests | Covers |
|---|---:|---|
| Tokenizer | 15 | case folding, stopwords, punctuation, plural reduction incl. protected `-sis`/`-us` |
| IDF | 4 | positivity for common terms, rarity ordering, formula match |
| BM25 scoring | 9 | ranking, no-match-is-absent, tf saturation, length normalisation, `b=0`, deterministic ties |
| Chunking | 9 | full coverage of source, offset fidelity, monotonic starts, huge-overlap termination, size bound, paragraph preference |
| Persistent index | 15 | add/search, reload from disk, idempotent re-ingest, removal, atomic write (no temp leftovers), newer-schema rejection, corrupt JSON |
| Retriever facade | 9 | directory ingest, skip reasons, notes vs corpus separation, keyed note update, durability across reload |
| `format_hits` | 3 | empty case, source+score rendering, truncation |
| Retrieval tools | 8 | conditional registration, passage output, no-results, empty query, `top_k` clamp, persistence |

### Two real bugs the tests caught

1. **`singularize()` mangled `analysis` → `analysi`.** A term that never matches
   anything. `-sis` and `-us` endings are now protected alongside `-ss`.
2. **A test assertion was wrong, not the code.** After replacing a document,
   `search("version one")` still matched — because `version` is shared by both
   revisions. The index was correct (1 doc, 1 chunk, verified directly). The
   assertion was tightened to a distinctive term. Recorded because "the test was
   wrong" is a real outcome and hiding it would be dishonest.

---

## 1. Fast suite (no weights, no network)

```
$ python3 -m pytest -m "not requires_model" -p no:warnings
........................................................................ [ 93%]
.....                                                                    [100%]
77 passed, 3 deselected in 0.22s
```

**111 passed, 0 failed, 3 deselected** (re-run after this session's changes;
was 77 before — +16 resume, +18 eval harness). The block above is the original
77-test run kept for the record; the current command and result are:

```
$ python3 -m pytest -m "not requires_model" -p no:warnings
111 passed, 3 deselected in 0.85s
```

| File | Tests | Covers |
|---|---:|---|
| `tests/test_config.py` | 14 | YAML load, env precedence, validation, derived paths, remote-model promotion |
| `tests/test_protocol.py` | 12 | clean JSON, fences, ` thinking` blocks, prose wrapping, brace-in-string, aliases, error paths |
| `tests/test_state.py` | 16 | roundtrip, atomic writes, schema versioning, corruption, traversal, index rebuild, token accounting |
| `tests/test_tools.py` | 19 | read/write/list, `../` escape, absolute escape, symlink escape, allowlist, shell gating, truncation |
| `tests/test_orchestrator.py` | 16 | finish, multi-step, persistence, protocol recovery, tool errors, budgets, timeout, history window |
| `tests/test_resume.py` | **16** | resume from next step, prior observations replayed, no duplicate side effects, refusal on succeeded/non-contiguous/unfinished/exhausted budgets, corrupt + future schema, CLI exit 2 |
| `tests/test_evals.py` | **18** | harness self-check (oracle 25/25), wrong adapter scores 0/25, checker negative cases, unique ids, oracle scripts present |

## 2. Real-model suite (actual GGUF, actual generation)

```
$ python3 -m pytest -m requires_model -p no:warnings -v
collected 80 items / 77 deselected / 3 selected

tests/test_real_model.py ...                                             [100%]

================= 3 passed, 77 deselected in 939.39s (0:15:39) =================
```

**3 passed, 0 failed.** These are the tests that prove the engine works with a
real language model rather than a stub:

1. `test_health_reports_loaded` — the adapter loads the GGUF and reports
   `ok=True, loaded=True, backend=llamacpp`.
2. `test_real_generation_returns_text_and_usage` — a real completion returns
   non-empty text with real `prompt_tokens`/`completion_tokens` from the backend.
3. `test_real_model_can_emit_a_parseable_action` — a real model reply parses
   into a valid `Action` with `action == "finish"`.

## 3. Failures found and fixed during this session

These were real bugs caught by running the tests, not hypotheticals.

| # | Failure | Root cause | Fix |
|---|---|---|---|
| 1 | `ImportError: cannot import name 'ProtocolError'` — 3 test modules failed to collect | `protocol.py` raised `ProtocolError` but the error hierarchy never defined it | Added `ProtocolError(RareError)` with `code="protocol_error"`, `retryable=True` |
| 2 | 13 orchestrator tests failed with `KeyError: '"thought"'` | `SYSTEM_PROMPT.format(tools=...)` treated the JSON braces in the prompt as format fields | Replaced `.format()` with an explicit `.replace("{tools}", ...)` |
| 3 | `test_env_allowlist_parsing` failed | `_coerce` inferred type from the current value; an absent list default arrives as `None`, so `"a, b"` stayed a string | Added an explicit comma-split branch for `None` + comma |
| 4 | `test_real_generation_returns_text_and_usage` timed out at 180 s | 1-CPU host; 16 tokens exceeds the production model timeout | Test raises its own timeout via `RARE_TEST_MODEL_TIMEOUT_S` (default 900 s) and uses `max_tokens=4`. The shipped 180 s default is unchanged. |
| 5 | `test_real_model_can_emit_a_parseable_action` failed: *"response contained only a reasoning block and no action"* | Qwen3 emits a ` thinking` block first; on a 48-token budget the block consumed the entire completion and no JSON was ever produced | Added a no-think prefill path: render ChatML manually and prefill `</think>\n\n` so the model continues straight into the answer. `chat_template_kwargs` is **not** supported by llama-cpp-python 0.3.36 — verified by `TypeError` before choosing the prefill approach. |

Failure 5 is the most valuable finding of the session: it is a real
model-behaviour bug that only appears against real weights, and it would have
made every task fail in production.

## 4. Hardware constraint (measured, not assumed)

```
$ nproc
64
$ cat /sys/fs/cgroup/cpu.max
100000 100000
```

64 cores are visible, but the cgroup quota is **1 CPU**. Measured effect:

| Measurement | Value |
|---|---|
| GGUF load time | 1.05 s |
| 64-token generation (first probe) | 789.75 s |
| 40-token generation (prefill probe) | 469.4 s |
| Effective throughput | **~0.08 tok/s** |

This is why the real-model suite takes 15m39s. It is a host limit, not an
engine defect — but it means the local model is not usable for interactive
work on this machine. See STATUS.md for the two ways to fix it.

## 5. Manual CLI verification

```
$ RARE_DEFAULT_MODEL=echo python3 -m rare_engine.cli doctor
config: env=development default_model=echo
state_dir: /tmp/clistate
model: echo adapter=echo
tools: list_dir, read_file, write_file
sandbox: /tmp/clisandbox
health: True - deterministic test adapter

$ RARE_DEFAULT_MODEL=echo python3 -m rare_engine.cli run "write a file" --json
{
  "task_id": "task_cede3fbb4aa3",
  "status": "failed",
  "result": null,
  "steps": 24,
  "duration_s": 7.5,
  "total_tokens": 11925,
  "error": "reached max_steps (24) without finishing",
  "error_code": "budget_exhausted"
}
```

The `failed` result is **correct and intentional**: the echo adapter is not a
language model and never calls `finish`, so the run hits its step budget. The
engine reported that honestly instead of inventing a success — which is exactly
the behaviour the budget tests assert.

`rare status` then listed the task with its real step count and token total.

## 6. Lint

```
$ ruff check rare_engine tests
All checks passed!
```

The first run found 41 issues (32 auto-fixed, 9 fixed by hand: a blind
`except Exception` in the index rebuild, a blind `except` in the test helper,
`pytest.raises(Exception)` narrowed to `ToolError`, a `LogRecord` field clash on
`extra={"args": ...}`, and `str, Enum` → `StrEnum`). The CI workflow runs this
same command, so the gate is real rather than aspirational.

## 7. Evaluation suite results (new this session)

```
$ python3 scripts/evaluate.py --adapter oracle
adapter: oracle
suite           passed  total   score
--------------------------------------
reasoning            5      5    100%
coding               5      5    100%
tool_use             5      5    100%
research             5      5    100%
completion           5      5    100%
--------------------------------------
TOTAL               25     25    100%
```

```
$ python3 scripts/evaluate.py --adapter echo
adapter: echo
suite           passed  total   score
--------------------------------------
reasoning            1      5     20%
coding               0      5      0%
tool_use             0      5      0%
research             5      5    100%
completion           0      5      0%
--------------------------------------
TOTAL                6     25     24%
```

**How to read these two numbers.**

- **oracle 25/25** is the harness self-check. It replays each task's known-good
  replies, so 100% proves the *checkers* accept correct work. If this were not
  100%, no other score would mean anything.
- **echo 6/25** is the floor, not a model result. The echo adapter is not a
  language model; it echoes the prompt. It still scores 24%, which is exactly
  why the suite must never be reported as a percentage of intelligence.
- **The `research` 5/5 for echo is a real harness weakness, not a win.** The
  answer appears in the prompt, so echoing passes. It measures extraction, not
  retrieval. Recorded in STATUS.md limitation 4 and in the commit message.
- **`llamacpp` was not run.** At ~0.08 tok/s, 25 tasks would take many hours.
  The real-model suite (section 2) already proves the adapter works; a full
  eval run needs the hardware fix in STATUS.md.

A deliberately-wrong adapter is asserted to score **0/25** in
`tests/test_evals.py::test_wrong_replies_are_scored_as_failures`, so the
checkers are proven to fail as well as pass.

## 8. What is NOT covered

- The OpenAI-compatible adapter has **no live-endpoint test** (no endpoint or
  key was available). Its request/response shaping is unit-tested only.
- No concurrency test: the store assumes one writer per task.
- **No `llamacpp` run of the evaluation suite** — only the 3 real-model tests.
- **The `research` suite is gameable** (see section 7).
- No performance/load testing beyond the single-token-rate measurement above.
- CI has never executed: the workflow exists but there is no remote.

## Reproduce

```bash
pip install -e ".[dev]" && pip install llama-cpp-python
python scripts/fetch_model.py
python -m pytest -m "not requires_model"     # 111 passed, ~0.9 s
python -m pytest -m requires_model           # 3 passed, ~16 min on 1 CPU
python scripts/evaluate.py --adapter oracle  # 25/25, harness self-check
python scripts/evaluate.py --adapter echo    # 6/25, deterministic floor
```
