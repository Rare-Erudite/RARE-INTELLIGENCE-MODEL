# HTTP_CONTRACT — TypeScript app ⇄ Python engine

**Status: IMPLEMENTED on branch `engine-integration-v0.3.1`. NOT merged, NOT deployed.**

This is the wire contract between the TypeScript application (`server.ts`,
`src/`) and the Python engine (`python_engine/`). Both sides are implemented
and tested against each other. `INTEGRATION_CONTRACT.md` covers the separate
question of integrating with `Rare-Erudite/COMPLETED`; this file covers the
engine's own HTTP surface.

---

## 1. Why the engine is a separate service

The TypeScript app is deployed to Vercel. The Python engine **cannot** run
there. This is a hard platform constraint, not a preference:

| Constraint | Vercel serverless | What the engine needs |
|---|---|---|
| Process lifetime | Killed at the function timeout (10s Hobby / 60s Pro / 300s max) | A task can run for minutes (`task_timeout_s: 900`) |
| Filesystem | Read-only except `/tmp`, ephemeral, not shared between invocations | `.rare/` task state + retrieval index must persist |
| Bundle size | 250 MB unzipped limit | One Q4 GGUF weight file is ~379 MB |
| Warm process | No guarantee | A loaded model must stay resident or every call pays load cost |
| Native binaries | Limited | `llama-cpp-python` compiles native code |

**Therefore:** the engine runs as its own process on a host that gives it a
disk and a long-lived process (container, VM, Fly.io, Railway, Render, VPS).
The TypeScript app calls it over HTTP.

The TypeScript app keeps working exactly as it does today if the engine is
unreachable — the client is additive and no existing route was modified.

---

## 2. Transport

- **Base URL** — `RARE_ENGINE_URL` in the TypeScript app's env.
- **Auth** — `Authorization: Bearer <RARE_SERVICE_TOKEN>` on every `/v1/*`
  call. `/health` is unauthenticated so a load balancer can probe it.
- **Content type** — `application/json` both ways.
- **Field naming** — **snake_case on the wire**, camelCase in TypeScript. The
  client maps at the boundary; the wire never changes shape.
- **Timeouts** — client default 30s. Task runs need longer; pass `timeoutMs`.

### Fail-closed authentication

The service refuses to serve `/v1/*` if `RARE_SERVICE_TOKEN` is unset,
returning `503 service_not_configured`. The only override is
`RARE_SERVICE_ALLOW_ANONYMOUS=1`, which is **development and CI only**.

Deliberate: the tool registry can write files and, when `tools.enable_shell`
is true, execute shell commands. An unauthenticated engine on a reachable
network is a remote code execution surface.

---

## 3. Endpoints

### `GET /health` — unauthenticated

```json
{
  "ok": true,
  "version": "0.3.1",
  "model_id": "qwen3-0.6b-instruct-q4km",
  "adapter": "llamacpp",
  "model_ready": true,
  "detail": "",
  "uptime_s": 12.4
}
```

`ok` = process alive. `model_ready` = model actually loaded. Separate on
purpose: a service that is up with no working model is a different failure
from a dead process.

### `POST /v1/tasks` — run a task to completion

Request:
```json
{ "goal": "Summarise the deployment runbook", "model_id": null, "metadata": {} }
```

Response:
```json
{
  "task_id": "task_abc123def456",
  "status": "succeeded",
  "result": "…",
  "steps": 3,
  "duration_s": 4.21,
  "total_tokens": 812,
  "error": null,
  "error_code": null,
  "resumed_from_step": null
}
```

`status` ∈ `pending | running | succeeded | failed | cancelled | timed_out`.

**Synchronous by design in v1.** The caller waits. A job queue with polling is
the right shape for long tasks and is on the roadmap; presenting this as async
when it is not would be worse than the honest limitation.

### `POST /v1/tasks/{task_id}/resume`

Continues an interrupted task from its last persisted step. Completed steps
are **not** replayed, so a `write_file` that already happened does not happen
twice.

- `404 task_not_found` — no such task
- `409 task_not_resumable` — already succeeded, non-contiguous steps, or
  budget exhausted. Refused **before** any model or tool call.

### `GET /v1/tasks` / `GET /v1/tasks/{task_id}`

List (max 200) and fetch one task summary.

### `POST /v1/memory/search`

```json
{ "query": "deployment window", "top_k": 5, "namespace": null }
```
→ `{ "query": "...", "hits": [{ "doc_id", "source", "score", "text" }], "total_indexed": 12 }`

`top_k` bounded 1–20. No match returns `hits: []` — the retriever does not
fabricate a match.

### `POST /v1/memory/remember`

```json
{ "text": "…", "key": "optional-stable-key" }
```
→ `{ "doc_id": "note_…" }`

---

## 4. Error shape

FastAPI's `detail` carries a structured body:

```json
{ "detail": { "code": "task_not_resumable", "message": "task already succeeded" } }
```

The TypeScript client surfaces this as `EngineClientError` with `.code` and
`.status`, so callers branch on a stable code rather than parsing a message.

| HTTP | code | meaning |
|---|---|---|
| 401 | `unauthorized` | missing or wrong bearer token |
| 404 | `task_not_found` | unknown task id |
| 409 | `task_not_resumable` | resume refused by a state invariant |
| 422 | — | request validation (pydantic) |
| 503 | `service_not_configured` | `RARE_SERVICE_TOKEN` unset |

---

## 5. Implementation map

| Side | File |
|---|---|
| Python service | `python_engine/rare_engine/service.py` |
| Python tests | `python_engine/tests/test_service.py` — 15 passed, 1 skipped |
| TS client | `src/integration/python_engine_client.ts` |
| TS contract tests | `src/engine/tests/engine-test-suite.ts` — suite "Python Engine Contract" (2 tests) |

The TS tests stub `fetch` with payloads copied from the service's response
models, so a shape drift on either side fails a test without needing a live
Python process in the Node test run.

---

## 6. Running it

```bash
# Engine
cd python_engine
pip install -e ".[dev]" fastapi uvicorn
export RARE_SERVICE_TOKEN="$(openssl rand -hex 32)"
python -m rare_engine.service          # 127.0.0.1:8099

# TypeScript app
export RARE_ENGINE_URL=http://127.0.0.1:8099
export RARE_SERVICE_TOKEN=<same value>
```

---

## 7. What is NOT done

Stated plainly so nobody assumes otherwise:

- **No route in `server.ts` calls the engine yet.** The client exists and is
  tested; wiring it into the app's routes is a separate, reviewable change.
- **No deployment.** Nothing was deployed to Vercel or anywhere else.
- **No merge.** This lives on `engine-integration-v0.3.1` only.
- **No job queue.** `/v1/tasks` blocks.
- **No streaming.** The model contract has no streaming method.
- **`Rare-Erudite/COMPLETED` was not touched.**
