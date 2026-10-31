# STATUS

**Last verified:** 2026-10-29
**Version:** 0.4.0
**Branch:** `engine-integration-v0.3.1` on `Rare-Erudite/RARE-INTELLIGENCE-MODEL`
**Checkpoint:** local engine HEAD `1095d27` (the user's `0f2d525` is its parent), now integrated under `python_engine/`.

This file is the single source of truth for "what actually works". Every claim
below is backed by a command in [TEST_REPORT.md](TEST_REPORT.md). If a claim is
not in TEST_REPORT.md, treat it as unverified.

---

## Integration state (2026-10-29)

| Fact | Value |
|---|---|
| Remote | `https://github.com/Rare-Erudite/RARE-INTELLIGENCE-MODEL` |
| Branch | `engine-integration-v0.3.1`, cut from `main` @ `81fd4066` |
| Layout | Python engine under `python_engine/`; TypeScript app untouched at root |
| GitHub auth | **RESOLVED** — token verified as `Rare-Erudite`, admin+push |
| Python tests | **219 passed, 4 skipped** |
| TypeScript tests | **30 passed, 0 failed** (28 baseline + 2 new contract tests) |
| TS lint / build | `tsc --noEmit` clean; `vite build` success |
| Merged? | **No.** PR open, not merged. |
| Deployed? | **No.** Nothing deployed anywhere. |

The remote `main` holds an unrelated TypeScript implementation, so the engine
was **not** pushed as `main`. It was added as a subdirectory on a branch cut
from `main`, preserving every TypeScript file.

---

## Backup (verified 2026-10-29)

| Fact | Value |
|---|---|
| Location | `/workspace/backups/rare-engine-0f2d525-20261028T232346Z` (current) |
| Contents | `rare-engine.bundle` (full history), `rare-engine-worktree.tar.gz`, `HEAD_SHA.txt` |
| Bundle HEAD | `0f2d525c50afd1f02bf8eda817aa406e568b73e2` |
| Commits in bundle | 10 |
| Restore test | `git clone <bundle> /tmp/restore-final` |
| Restore result | HEAD matched, 10 commits, 61 tracked files, **204 passed / 3 deselected** |

An earlier bundle at `14c1729` was also restore-verified (7 commits, 187 passed)
and is kept as a second known-good point.

Excluded from the backup: `.env` and real secrets, `.rare/` runtime state and
index stores, `models/` and `*.gguf` weights, `__pycache__` / `.pytest_cache` /
`.ruff_cache` / venvs.

**The restore test found a real bug.** The first restore attempt failed at
import with `ModuleNotFoundError: No module named 'rare_engine.models'`.
`.gitignore` contained unanchored `models` and `models/` patterns, which match
any directory named `models` at any depth — so the entire model layer (base,
echo, llamacpp, openai adapters) had been silently excluded from all six
commits. The working tree passed 187 tests because the files existed on disk.
Fixed in `14c1729` by anchoring both patterns to the repo root.

**Note:** the current bundle is at the tip of `main` and includes the
retrieval-eval work. Re-bundle after any further code change.

---

## Retrieval evaluation (measured 2026-10-29)

`python3 benchmarks/retrieval_eval.py --k 3`

**This measures the BM25 retriever only.** No model adapter is constructed, no
generation happens, no oracle replies are used. It is not evidence of model
intelligence and must not be cited as such.

| Metric | Value |
|---|---|
| Corpus | 14 documents |
| Cases | 17 across 8 categories |
| Cases passed | 15 / 17 |
| precision@3 | 0.385 |
| recall@3 | 1.000 |
| MRR | 1.000 |
| Negative-control accuracy | 0.500 |

| Category | Cases | Passed | P@3 | R@3 | MRR |
|---|---|---|---|---|---|
| direct | 3 | 3 | 0.333 | 1.000 | 1.000 |
| paraphrase | 3 | 3 | 0.333 | 1.000 | 1.000 |
| synonym | 2 | 2 | 0.333 | 1.000 | 1.000 |
| multi_hop | 1 | 1 | 0.667 | 1.000 | 1.000 |
| distractor | 1 | 1 | 0.333 | 1.000 | 1.000 |
| contradiction | 1 | 1 | 0.667 | 1.000 | 1.000 |
| isolation | 2 | 2 | 0.333 | 1.000 | 1.000 |
| negative | 4 | 2 | — | — | — |

**Remaining failures, recorded not tuned away:**

- `neg_vacation` — "how many vacation days do employees get" returns the tenant
  rotation docs, because `days` appears in them.
- `neg_billing_db` — "which database engine does the billing service use"
  returns `doc_schema`, `doc_incident`, `doc_auth`, because `database` and
  `service` both appear elsewhere in the corpus.

Both are the honest limit of lexical retrieval without a query-term-coverage
threshold. Adding one would also suppress legitimate partial matches, so it is
recorded as a limitation rather than tuned into the corpus.

**Precision@3 of 0.385 is not a failure rate.** Most cases have exactly one
relevant document, so a perfect retriever scores 1/3 on them. It is a
ranking-quality signal.

**A prediction that was wrong:** three paraphrase cases were annotated as
"expected to fail" (no stemming). All three passed — `access token`,
`release`/`deployment` and `infrastructure`/`quarter` carried the match. The
notes were corrected to say so rather than left as a false prediction.

---

## Namespace isolation (implemented 2026-10-29)

Documents carry a `namespace` (default `default`). `search(query, top_k,
namespace=...)` restricts **both the candidate set and the BM25 statistics** to
that namespace. `namespace=None` keeps the previous whole-index behaviour, so
every existing caller is unaffected.

Scoping the statistics rather than filtering results afterwards is the point: a
small namespace inside a large one would otherwise have its scores depressed by
unrelated documents' average length, and `top_k` would be applied to the wrong
candidate set. A test asserts the score is identical to searching that
namespace in isolation.

---

## Remote / GitHub state (verified 2026-10-29)

| Fact | Value |
|---|---|
| Target repo | `https://github.com/Rare-Erudite/RARE-INTELLIGENCE-MODEL` |
| Visibility | public |
| Default branch | `main` |
| Remote HEAD | `81fd40664ebf338d209d3ba22dd584bd355dab12` |
| Remote content | **unrelated TypeScript implementation** (server.ts, src/, vite) |
| Local HEAD | `0f2d525` |
| Merge base | **none** — unrelated histories |
| Push status | **BLOCKED** — no credentials |

**Blocker:** the sandbox has no GitHub credentials. Verified: no `GITHUB_TOKEN`
or `GH_TOKEN` in the environment, `gh` CLI not installed, no credential helper,
`api.github.com/user` returns 401 anonymously, and `git push --dry-run` fails
with `fatal: could not read Username for 'https://github.com'`. No GitHub MCP
toolkit is connectable on this platform (`discover_mcp_tools` returned none).

**Smallest unblock:** supply a PAT with `repo` scope for that URL (or enable a
GitHub integration). Then, because the histories are unrelated and the remote
already holds different work, push to a **new branch** — never force-push:

```
git remote add origin https://github.com/Rare-Erudite/RARE-INTELLIGENCE-MODEL.git
git push -u origin main:engine-v0.3.1
```

**Repo name note:** the user supplied `RARE-INTELLIGENCE-MODEL`; the original
plan named it `RARE-INTELLIGENCE-ENGINE`. The supplied name is authoritative and
is what is recorded here. The local directory keeps its original name.

**CI:** `.github/workflows/ci.yml` exists and is lint-verified, but has **never
executed** because nothing has ever been pushed.

---

## What is built and tested

| Component | File | State |
|---|---|---|
| Config (YAML + `RARE_*` env, pydantic) | `rare_engine/config.py` | ✅ tested |
| Model contract | `rare_engine/models/base.py` | ✅ tested |
| llama.cpp adapter (real GGUF) | `rare_engine/models/llamacpp_adapter.py` | ✅ tested against real weights |
| OpenAI-compatible adapter | `rare_engine/models/openai_adapter.py` | ⚠️ unit-tested only, never called against a live endpoint |
| Echo adapter (tests/CI) | `rare_engine/models/echo_adapter.py` | ✅ tested |
| Action protocol + bounded repair | `rare_engine/protocol.py` | ✅ tested |
| Orchestrator loop | `rare_engine/orchestrator.py` | ✅ tested |
| Task resumption | `rare_engine/orchestrator.py` (`resume`) | ✅ tested (16 cases) |
| Tool registry + sandbox | `rare_engine/tools.py` | ✅ tested |
| **Retrieval + durable memory (BM25)** | `rare_engine/memory/` | ✅ **tested (76 cases)** |
| **`retrieve` / `remember` tools** | `rare_engine/tools.py` | ✅ **tested** |
| Typed task state + atomic JSON store | `rare_engine/state.py` | ✅ tested |
| Structured JSON logging | `rare_engine/logging.py` | ✅ tested |
| CLI (`run`/`resume`/`index`/`search`/`remember`/`memory`/`status`/`show`/`tools`/`doctor`) | `rare_engine/cli.py` | ✅ exercised manually |
| Evaluation harness (25 tasks) | `benchmarks/`, `scripts/evaluate.py` | ✅ tested (18 cases) |
| End-to-end example | `examples/e2e_local.py` | ✅ present, runs |
| Model fetch script | `scripts/fetch_model.py` | ✅ present |
| CI workflow | `.github/workflows/ci.yml` | ✅ present, **never executed** (no push) |

**Test totals:** 187 fast tests + 3 real-model tests. See TEST_REPORT.md.

## Verified behaviour

- A task runs the full loop: prompt → model → JSON action → tool → observation
  → next step → `finish`, with every step persisted.
- **A task can be resumed** from its last completed step. Completed steps are
  not replayed, so a tool side effect that already happened does not happen
  twice (asserted by comparing file mtime and model call count).
- **Resume refuses unsafe continuations before any model or tool call**, naming
  the failed invariant: already-succeeded, non-contiguous step indices,
  unfinished step (process died mid-step), or exhausted step/model/tool budget.
  A refused resume provably does not rewrite the task file.
- Budgets are enforced and reported honestly: hitting `max_steps` yields
  `status=failed, error_code=budget_exhausted`, never a fake success.
- The sandbox blocks `../` traversal, absolute paths outside the root, and
  symlink escapes (all three have dedicated tests).
- Protocol repair recovers from markdown fences, prose-wrapped JSON, and
  Qwen3 ` thinking` blocks.
- The real Qwen3-0.6B GGUF loads and generates through the adapter.
- **The evaluation harness is self-verifying**: oracle mode scores 25/25 and a
  deliberately-wrong adapter scores 0/25, so the checkers are proven to both
  pass correct work and reject wrong work.

## Measured baselines (evaluation suite)

| Adapter | Score | Meaning |
|---|---|---|
| `oracle` | **25/25 (100%)** | harness self-check — proves the checkers work |
| `echo` | **6/25 (24%)** | deterministic non-model floor |
| `llamacpp` (Qwen3-0.6B) | **not run** | would take hours at 0.08 tok/s; see limitation 1 |

The echo score is not a model result. It is the floor: a component that does no
reasoning still scores 24%, which is why the suite must never be read as a
percentage of "intelligence".

## Known limitations (honest)

1. **This host is capped at 1 CPU and 2 GiB RAM** (`cpu.max = 100000 100000`,
   `memory.max = 2147483648`) with a 4 GB disk and no GPU. Measured throughput
   is ~0.08 tok/s, so a 40-token reply takes ~470 s. The engine is correct
   here; it is simply slow, and 4B+ models cannot fit at all.
2. **A timed-out generation cannot be interrupted** inside the llama.cpp C
   call. The coroutine is released; the worker thread finishes its token loop
   in the background. Documented, not hidden.
3. **The OpenAI-compatible adapter has never been called against a live
   endpoint.** It is unit-tested for request/response shaping only. This is the
   largest untested claim in the project.
4. **The `research` eval suite is gameable.** Echo scores 5/5 on it because the
   answer is present in the prompt, so it measures extraction, not retrieval.
   A retrieval suite is required before research scores mean anything.
5. **No streaming.** `generate` is request/response only.
6. **Single writer per task.** JSON files, not SQLite. Fine for one process;
   concurrent writers would need the SQLite upgrade in ROADMAP.md.
7. **The sandbox is a boundary for the model's own actions**, not a security
   sandbox against a hostile process. The shell tool is off by default.
8. **CI has never run.** The workflow is written and lint-verified locally, but
   with no remote it has never executed on GitHub.

## Not started

- GitHub remote / first CI run. The repo is local with **zero remotes**.
- Multi-agent / sub-task decomposition.
- Long-term memory across tasks.
- Retrieval, embeddings, vector store.
- Web/browser tool.
- Document intelligence (PDF/DOCX/XLSX ingestion).
- Model and tool routing.
- Universal software building / TDD repair loop.
- Multimodal processing.
- Self-diagnostics and isolated repair.

## Next milestone

**M1 — remote + first CI run.** Blocked on the user (see below), not on code.

**M2 — live endpoint.** Proves the model-agnostic claim and gives usable
latency. Blocked on credentials.

**M3 — retrieval + memory.** The next buildable increment that does not need
new hardware: a local embedding index over the sandbox, plus a `search` tool,
plus a retrieval eval suite that echo cannot game.

## Blocked on the user

| Blocker | Smallest action |
|---|---|
| No GitHub remote | Provide a git remote URL + push credentials, or enable the GitHub integration for this agent. Then `git remote add origin <url> && git push -u origin main`. |
| Slow local inference / no capable model | Set `RARE_OPENAI_BASE_URL` + `RARE_OPENAI_API_KEY` to a vLLM/Ollama/hosted endpoint. |
| 4B+ models cannot fit | Raise the container memory limit above 8 GiB, or run on a machine with 8 GiB+ RAM. |
