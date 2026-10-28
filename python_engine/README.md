# RARE Intelligence Engine

A persistent, model-agnostic autonomous engineering engine.

The engine runs a bounded **plan → act → observe** loop against a language
model, gives the model a small audited tool surface, and persists every step so
a run can be inspected, resumed and audited afterwards.

```
goal ──▶ orchestrator ──▶ model adapter ──▶ one JSON action
              │                                  │
              │◀──── observation ────── tool registry (sandboxed)
              │
              └──▶ TaskStore (JSON, atomic, per-step)
```

## Status

**v0.2.0 — vertical slice + task resumption + evaluation harness, all tested.**
See [STATUS.md](STATUS.md) for the precise, evidence-backed state and
[TEST_REPORT.md](TEST_REPORT.md) for the test results. Nothing in this README
claims more than those two files prove.

| | |
|---|---|
| Fast tests | **111 passed** (0.85 s) |
| Real-model tests | **3 passed** (Qwen3-0.6B, ~16 min on 1 CPU) |
| Lint | `ruff check .` clean |
| Eval harness self-check | **25/25** (oracle) |
| GitHub remote | **none — blocked, see RECOVERY.md §5** |

## Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pip install llama-cpp-python        # only for the local GGUF backend
```

## Get the model

The default model is Qwen3-0.6B-Instruct, Q4_K_M GGUF (~397 MB, Apache-2.0).

```bash
python scripts/fetch_model.py
```

## Use

```bash
rare doctor                                  # can this install run a task?
rare tools                                   # what the model will be offered
rare run "create hello.txt containing 'hi' and read it back"
rare status                                  # recent tasks
rare show task_ab12cd34ef56                  # full step-by-step trace
rare resume task_ab12cd34ef56                # continue an interrupted task
```

### Evaluation

```bash
python scripts/evaluate.py --adapter oracle   # harness self-check: must be 25/25
python scripts/evaluate.py --adapter echo     # deterministic floor: 6/25
python scripts/evaluate.py --adapter llamacpp --suite tool_use
```

25 tasks across `reasoning`, `coding`, `tool_use`, `research`, `completion`,
every one scored by a programmatic checker. No LLM judge.

As a library:

```python
import asyncio
from rare_engine.config import load_config
from rare_engine.models import build_default_adapter
from rare_engine.orchestrator import Orchestrator
from rare_engine.state import TaskStore
from rare_engine.tools import build_registry

async def main():
    cfg = load_config()
    adapter = build_default_adapter(cfg)
    orch = Orchestrator(cfg, adapter, build_registry(cfg), TaskStore(cfg.state_path))
    result = await orch.run("write a haiku to poem.txt, then read it back")
    print(result.status, result.result)

asyncio.run(main())
```

## Layout

| Path | Purpose |
|---|---|
| `rare_engine/config.py` | YAML + `RARE_*` env config, pydantic-validated |
| `rare_engine/models/` | `ModelAdapter` contract + llama.cpp, OpenAI-compatible, echo |
| `rare_engine/protocol.py` | Action JSON parsing with bounded repair |
| `rare_engine/orchestrator.py` | The bounded loop, budgets, retries, timeouts |
| `rare_engine/tools.py` | Tool registry + sandbox enforcement |
| `rare_engine/state.py` | Typed task state, atomic JSON persistence |
| `rare_engine/logging.py` | Structured JSON logs with run/task/step correlation |
| `rare_engine/cli.py` | `rare` command |
| `benchmarks/` | 25-task evaluation suite with programmatic checkers |
| `scripts/evaluate.py` | Evaluation CLI |
| `examples/e2e_local.py` | End-to-end example against the real model |
| `tests/` | 114 tests (111 fast + 3 real-model) |

## Documentation map

| File | Read it for |
|---|---|
| [STATUS.md](STATUS.md) | what actually works right now |
| [TEST_REPORT.md](TEST_REPORT.md) | the evidence, with commands |
| [MASTER_SPEC.md](MASTER_SPEC.md) | what the engine is and how it is built |
| [ROADMAP.md](ROADMAP.md) | what comes next, and what is blocked |
| [CAPABILITIES.md](CAPABILITIES.md) | what it can and cannot do |
| [MODEL_REGISTRY.md](MODEL_REGISTRY.md) | model selection with hardware math |
| [MODEL_DEVELOPMENT_PLAN.md](MODEL_DEVELOPMENT_PLAN.md) | how the model strategy evolves |
| [COMPETITIVE_BENCHMARKS.md](COMPETITIVE_BENCHMARKS.md) | landscape, every number labelled |
| [DECISIONS.md](DECISIONS.md) | why things are the way they are |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | every real limitation |
| [RECOVERY.md](RECOVERY.md) | how to get back to a known-good state |
| [SECURITY.md](SECURITY.md) | threat model and sandbox semantics |
| [INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md) | future integration (not applied) |
| [TASK_STATE.json](TASK_STATE.json) | machine-readable checkpoint |

## Design commitments

- **No fabricated results.** Token counts come from the backend or are zero.
  A run that hits a budget ends `failed`/`timed_out` with a recorded reason.
- **Bounded everything.** Steps, model calls, tool calls, wall clock, output
  size. The loop cannot hang.
- **Model-agnostic.** Swapping the local GGUF for a remote endpoint is a config
  change (`RARE_OPENAI_BASE_URL`), not a code change.
- **Auditable.** Every step is persisted with its thought, action, arguments,
  observation, latency and token usage.
- **Resumable.** A task that stopped continues from its last completed step,
  without repeating side effects that already happened.
- **Measured.** A 25-task suite with programmatic checkers, self-verified by an
  oracle run that must score 100%.

## License

Apache-2.0.
