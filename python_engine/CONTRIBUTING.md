# CONTRIBUTING

## Setup

```bash
git clone <repo> && cd RARE-INTELLIGENCE-ENGINE
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pip install llama-cpp-python        # only needed for the real-model suite
python scripts/fetch_model.py       # ~397 MB, only for the real-model suite
```

## The two test suites

```bash
python3 -m pytest -m "not requires_model"   # fast, no weights, no network
python3 -m pytest -m requires_model         # real GGUF, ~16 min on 1 CPU
```

The fast suite must stay under a few seconds. If a new test needs weights or
network, mark it `requires_model` (or add a new marker) so CI stays fast.

## Before you commit

```bash
python3 -m pytest -m "not requires_model" -p no:warnings   # must pass
python3 -m ruff check .                                    # must be clean
python3 scripts/evaluate.py --adapter oracle               # must be 25/25
```

If the oracle run is not 25/25, a **checker** regressed. Fix that before
touching model code — otherwise every score you produce is meaningless.

## Rules

1. **Never claim what you did not verify.** If a feature is not tested, mark it
   untested in STATUS.md and CAPABILITIES.md. Do not describe planned work as
   done.
2. **Never fabricate numbers.** Benchmark and test results must come from a real
   run, with the command recorded in TEST_REPORT.md.
3. **Keep the fast suite fast.** No downloads, no network, no real weights.
4. **One writer per task.** Do not add concurrent writes to the JSON store
   without moving to SQLite first.
5. **New tool? Add a sandbox test.** Every filesystem tool needs an escape test.
6. **New eval task? Add an `oracle_replies` script.** A task without one cannot
   be validated.
7. **Update the state files.** A change that alters behaviour must update
   STATUS.md, TASK_STATE.json and CHANGELOG.md in the same commit.
8. **No secrets.** `.env` is ignored; never commit tokens or keys.

## Commit messages

Conventional-ish, with a body that explains *why*:

```
feat(resume): add rare resume with pre-flight state validation

Resume continues from the next step index without replaying completed
steps, so recorded tool side effects stay single.

- Orchestrator: extract _execute() shared by run() and resume()
- tests: 16 new cases
```

## Adding a model

1. Add an entry to `MODEL_REGISTRY.md` with licence, size, context and whether
   it fits the hardware envelope.
2. Add it to `config/engine.yaml` under `models:`.
3. If it needs a new adapter, implement `ModelAdapter` and add a unit test with
   a fake transport — do not require a live endpoint in the fast suite.
4. Record the measured result in TEST_REPORT.md, or state that it was not run.

## Adding an eval task

1. Add an `EvalTask` to `benchmarks/tasks.py` with a programmatic `check`.
2. Provide `oracle_replies` that make it pass.
3. Run `python3 scripts/evaluate.py --adapter oracle` — it must still be 25/25
   (or 26/26, etc.).
4. Confirm a wrong answer fails: add or extend a negative test in
   `tests/test_evals.py`.

## Code style

- `ruff` is the gate; the config lives in `pyproject.toml`.
- Type hints on public functions.
- Docstrings explain *why*, not *what*.
- Prefer a typed error over a bare `Exception`.
