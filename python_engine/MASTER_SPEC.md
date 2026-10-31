# MASTER_SPEC

**Version:** 0.2.0 · **Last updated:** 2026-10-28

The authoritative description of what the RARE Intelligence Engine **is**. Where
this file and the code disagree, the code and TEST_REPORT.md win — and this file
is wrong and must be fixed.

---

## 1. What this is

An independent, persistent engineering project: a bounded autonomous agent
runtime that plans, calls tools, observes results and records every step to
durable state so a run can be inspected, audited and resumed.

It is **not** a chatbot, a UI mockup, or a thin wrapper around an API. The value
is in the loop, the state discipline, the tool boundary and the measurement —
not in the model.

## 2. Design principles

1. **Never claim what was not verified.** A task that did not finish is
   `failed`, with a reason. There is no path that reports success it did not
   achieve.
2. **Every step is durable.** State is written atomically after each step, so a
   crash loses at most one step.
3. **Bounds are explicit.** Steps, model calls, tool calls and wall clock are
   all capped. Hitting a cap is a reported outcome, not a hang.
4. **The model is replaceable.** One `ModelAdapter` contract, several
   implementations. No engine logic depends on a specific model.
5. **The tool surface is small and auditable.** Few tools, strict argument
   validation, bounded output, sandboxed paths.
6. **Measurement is programmatic.** No LLM judge in the evaluation loop.
7. **Refuse rather than guess.** When state is ambiguous (a gap in step
   indices, an unfinished step), the engine refuses and says why.

## 3. Architecture

```
                 ┌──────────────┐
   goal ────────▶│ Orchestrator │◀──── config (YAML + RARE_* env)
                 └──────┬───────┘
                        │ 1. build prompt (system contract + goal + history + tools)
                        ▼
                 ┌──────────────┐
                 │ ModelAdapter │  llamacpp | openai_compat | echo
                 └──────┬───────┘
                        │ 2. one JSON action
                        ▼
                 ┌──────────────┐
                 │   protocol   │  parse + bounded repair
                 └──────┬───────┘
                        │ 3. Action(thought, action, action_input)
                        ▼
                 ┌──────────────┐
                 │ ToolRegistry │  sandbox + allowlist + timeouts
                 └──────┬───────┘
                        │ 4. observation
                        ▼
                 ┌──────────────┐
                 │  TaskStore   │  atomic JSON, one file per task
                 └──────────────┘
                        │ 5. repeat until finish or a bound
                        ▼
                    RunResult
```

### Modules

| Module | Responsibility |
|---|---|
| `config.py` | YAML + env loading, validation, derived paths |
| `models/base.py` | `ModelAdapter` ABC, `GenerationRequest/Response`, `Usage` |
| `models/llamacpp_adapter.py` | local GGUF inference |
| `models/openai_adapter.py` | any OpenAI-compatible HTTP endpoint |
| `models/echo_adapter.py` | deterministic adapter for tests/CI |
| `protocol.py` | parse model output into an `Action`; bounded repair |
| `orchestrator.py` | the loop, budgets, retries, `run()` and `resume()` |
| `tools.py` | tool registry, sandbox, allowlist, output bounds |
| `state.py` | `TaskState`, `StepRecord`, atomic `TaskStore` |
| `logging.py` | structured JSON logs with run/task/step binding |
| `errors.py` | typed error hierarchy with stable codes |
| `cli.py` | `run`, `resume`, `status`, `show`, `tools`, `doctor` |
| `benchmarks/` | 25-task eval suite with programmatic checkers |

## 4. The action protocol

The model replies with exactly one JSON object:

```json
{"thought": "...", "action": "<tool name or finish>", "action_input": {...}}
```

`finish` ends the task with `action_input.result`. Anything else is dispatched
to the tool registry. Unparseable output is fed back as an observation so the
model can correct itself, up to the step budget.

## 5. State model

`TaskState` holds the goal, status, model id, run id, timestamps, the full step
list, the result, budget counters and free-form metadata. `StepRecord` holds one
plan/act/observe cycle verbatim: thought, action, input, observation, ok/error,
latency, tokens, timestamps.

Persistence is one JSON file per task plus an index, written atomically
(temp file + `os.replace` + `fsync`). `schema_version` is checked on load; a
newer schema is refused rather than misread.

## 6. Resumption contract

`resume(task_id)` continues from `len(steps) + 1`. It:

- does **not** replay completed steps, so recorded side effects stay single;
- replays prior observations into the prompt as history;
- validates before any model or tool call, refusing on: already succeeded,
  non-contiguous step indices, unfinished step, or exhausted budget;
- leaves the task file untouched when it refuses.

## 7. Evaluation contract

25 tasks across `reasoning`, `coding`, `tool_use`, `research`, `completion`.
Every task is scored by a programmatic checker. Every task carries an
`oracle_replies` script; oracle mode must score 25/25 or the harness is broken.
A deliberately-wrong adapter must score 0/25.

## 8. Boundaries

- **Independent of `Rare-Erudite/COMPLETED`.** No code, branch or deployment
  coupling. Only `INTEGRATION_CONTRACT.md` is prepared, and it is not applied.
- **No secrets in Git.** `.env` is ignored; `.env.example` documents the keys.
- **The sandbox is a boundary for model actions**, not a security sandbox
  against a hostile process.

## 9. Non-goals

Training a foundation model; beating frontier models on public benchmarks;
running 70B models on this hardware; an LLM-as-judge evaluation layer.
