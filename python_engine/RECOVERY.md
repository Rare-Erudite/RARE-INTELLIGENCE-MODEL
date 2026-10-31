# RECOVERY

**Last updated:** 2026-10-29 · **Version:** 0.3.1

How to get back to a known-good state, and how to continue a task that stopped.
Written so a future session can recover from the repository alone.

---

## 0. Remote state — read this first

The GitHub remote is **not** a backup of this work. It holds an unrelated
TypeScript implementation and nothing here has been pushed.

| | |
|---|---|
| Remote | `https://github.com/Rare-Erudite/RARE-INTELLIGENCE-MODEL` |
| Remote HEAD | `81fd40664ebf338d209d3ba22dd584bd355dab12` (unrelated history) |
| Local HEAD | `24c6ac6` |
| Merge base | none |

**The local repository is the only copy of this work.** If the sandbox is
destroyed before a push happens, this history is lost. That is the single
highest-risk fact in this project.

**A verified portable backup now exists** at
`/workspace/backups/rare-engine-14c1729-20261028T231814Z` — a `git bundle --all`
(full history) plus a plain working-tree tarball. It was restore-verified by
cloning into a clean directory and running the suite there (187 passed).

That backup predates the retrieval-eval commit, so re-bundle before treating it
as the latest snapshot:

```
cd RARE-INTELLIGENCE-ENGINE
git bundle create /workspace/backups/rare-engine-$(git rev-parse --short HEAD).bundle --all
```

**Restore procedure (verified):**

```
git clone <bundle> /tmp/restored
cd /tmp/restored
git rev-parse HEAD          # must match the bundle's HEAD
python3 -m pytest -m "not requires_model"
```

**Lesson from the first restore attempt:** it failed with
`ModuleNotFoundError: No module named 'rare_engine.models'` because `.gitignore`
had unanchored `models` patterns. Never trust a backup you have not restored —
a working tree that passes tests proves nothing about what was committed.

To push once a PAT with `repo` scope is available (never force-push):

```bash
git remote add origin https://github.com/Rare-Erudite/RARE-INTELLIGENCE-MODEL.git
git push -u origin main:engine-v0.3.0
```

---

## 1. Known-good checkpoints

| Commit | State | Verified by |
|---|---|---|
| `2cacf2a` | **current** — retrieval + durable memory | 187 fast tests, ruff clean |
| `4a62ad3` | v0.2.0 docs | 111 fast tests, ruff clean |
| `9fc6971` | resume + eval harness | 111 fast tests, ruff clean, oracle 25/25 |
| `dfd2d48` | resume shipped | 93 fast tests, ruff clean |
| `240f400` | vertical slice | 77 fast tests, 3 real-model tests |

Roll back to any of these with:

```bash
git checkout 2cacf2a -- .     # restore files, keep history
# or, to move the branch:
git reset --hard 2cacf2a
```

`git reset --hard` discards uncommitted work. Prefer `git stash` first if there
is anything worth keeping.

---

## 2. Verify the current state in 30 seconds

```bash
cd RARE-INTELLIGENCE-ENGINE
python3 -m pytest -m "not requires_model" -p no:warnings   # expect 111 passed
python3 -m ruff check .                                    # expect All checks passed
python3 scripts/evaluate.py --adapter oracle               # expect 25/25
```

If all three pass, the repository is healthy and matches STATUS.md.

If the eval harness is not 25/25, the **checkers** are broken — do not trust any
other score until it is fixed.

---

## 3. Recovering an interrupted task

A task that stopped (crash, budget, timeout) is resumable if its state is sound.

```bash
rare status                      # find the task id
rare show <task_id>              # inspect the last recorded step
rare resume <task_id>            # continue from the next step
```

`rare resume` validates before doing anything. It refuses, with a specific
message, when:

| Refusal | Meaning | Fix |
|---|---|---|
| `already succeeded` | nothing to do | — |
| `non-contiguous step indices` | state file was edited or a write was lost | inspect the file; do not guess |
| `unfinished step(s)` | the process died mid-step; the side effect is unknown | inspect the sandbox for the partial effect, then decide manually |
| `already used N of M steps` | step budget spent | raise `orchestrator.max_steps` in config |
| `exhausted the model call budget` | model budget spent | raise `max_model_calls` |
| `exhausted the tool call budget` | tool budget spent | raise `max_tool_calls` |

A refused resume makes **no** model call and does **not** rewrite the task file
(asserted in `tests/test_resume.py`).

### If the state file is corrupt

`rare resume` raises `StateError` naming the file. The task file is plain JSON
at `.rare/tasks/<task_id>.json`. Options, in order of preference:

1. Restore the file from a backup or from Git if it was committed.
2. Re-run the task from scratch — the goal is in the file's `goal` field.
3. Hand-repair only if you can keep step indices contiguous and every step has
   a `finished_at`; otherwise resume will (correctly) refuse.

The index (`.rare/index.json`) is disposable: if it is corrupt, the store
rebuilds it from the task files automatically.

---

## 4. Recovering the model

```bash
rare doctor                      # checks config, weights, sandbox, tools, health
```

If weights are missing:

```bash
python scripts/fetch_model.py    # downloads Qwen3-0.6B Q4_K_M, verifies size
```

The fetch script deletes its partial file on any failure, so a failed download
never leaves a corrupt GGUF behind.

---

## 5. GitHub blocker (precise)

**Status: blocked. No remote is configured and none can be created from here.**

Evidence gathered on 2026-10-28:

| Check | Result |
|---|---|
| `which gh` | not found — GitHub CLI is not installed |
| `env \| grep -i github` | no `GITHUB_TOKEN`, no `GH_TOKEN` |
| `discover_mcp_tools(filter="github")` | 0 tools; catalog has no OAuth-capable GitHub toolkit |
| `get_credential_profiles(github)` | refused — only the agent owner can view credentials |
| `curl https://api.github.com` | HTTP 200, but unauthenticated |

**Smallest action to unblock (one of):**

1. Provide an empty repository URL plus push credentials (a PAT with `repo`
   scope is enough), then:
   ```bash
   git remote add origin <url>
   git push -u origin main
   ```
2. Enable the GitHub integration for this agent, then the same two commands.

Nothing else is blocked by this. CI is already written and will run on the
first push.

---

## 6. What to do if the tests fail after a change

1. `git stash` the change, re-run the suite. If it passes, the change is the
   cause — do not "fix" the tests to match it.
2. If a *real-model* test fails but the fast suite passes, suspect the model or
   the host, not the engine: check `rare doctor` and the token rate.
3. If the eval harness drops below 25/25 in oracle mode, a checker regressed.
   Fix the checker before touching any model code.
4. Never mark a task complete in STATUS.md or TASK_STATE.json on the strength of
   a run you did not see pass.
