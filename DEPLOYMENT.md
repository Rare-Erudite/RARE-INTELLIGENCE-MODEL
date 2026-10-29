# DEPLOYMENT — RARE Intelligence Engine + TypeScript App

This document records the deployment architecture and the **measured** constraints
that forced it. Every number here was observed in this environment, not assumed.

---

## 1. The constraint that decides everything

The Python engine **cannot run on Vercel serverless**. Three independent limits,
any one of which is disqualifying:

| Constraint | Vercel serverless limit | What the engine needs |
|---|---|---|
| Execution time | 10s (Hobby) / 60s (Pro) per invocation | Tasks run up to **900s** (`ENGINE_TIMEOUT_MS`) |
| Persistent disk | None — `/tmp` only, ephemeral, not shared between invocations | `.rare/` task state must survive restarts for `rare resume` |
| Bundle size | 250 MB unzipped | The Qwen3-0.6B GGUF alone is **379 MB** |

The third is the hardest: even a stateless, fast engine would not fit. And the
second is structural — `rare resume <task_id>` is a core feature, and it is
meaningless without durable state.

**Therefore: the Python engine is a separate long-running service, and the
TypeScript app calls it over HTTP.** That is what `python_engine/HTTP_CONTRACT.md`
and `src/integration/python_engine_client.ts` implement.

---

## 2. Chosen architecture

```
┌─────────────────────────┐        HTTPS + Bearer        ┌──────────────────────────┐
│  TypeScript app         │  ──────────────────────────► │  Python engine service   │
│  (Vercel or any Node)   │                              │  (long-running process)  │
│                         │  ◄────────────────────────── │                          │
│  /api/v1/engine/tasks   │        202 + job id          │  FastAPI + uvicorn       │
│  durable job queue      │                              │  .rare/ state on disk    │
│  data/jobs/*.json       │                              │  GGUF weights on disk    │
└─────────────────────────┘                              └──────────────────────────┘
```

The TypeScript side never blocks on a task. It enqueues, returns `202`, and the
client polls `/api/v1/engine/jobs/:id`. The worker drains the queue on a timer.

### Why the queue is on the TypeScript side

The engine's `/v1/tasks` is synchronous. Something has to hold the "this was
requested but not finished" state across a process restart, and the app is the
component that owns the user's request. Putting it there also means the app
degrades gracefully: if the engine is down, jobs accumulate on disk and run
when it returns.

---

## 3. Hosting the Python engine — free options, in order of preference

No paid service is required. All three run the engine as a normal container.

### Option A — self-hosted Docker (recommended for development)

```bash
cd python_engine
docker build -t rare-engine .
docker run -d --name rare-engine \
  -p 8000:8000 \
  -e RARE_SERVICE_TOKEN="$(openssl rand -hex 32)" \
  -v "$PWD/.rare:/app/.rare" \
  -v "$PWD/models:/app/models" \
  rare-engine
```

- **Cost:** $0. Runs on the developer's machine.
- **Why it fits:** a real process, a real disk, no time limit.
- **Caveat:** not reachable from Vercel without a tunnel. Fine for local dev and
  for the app running on the same host.

### Option B — Fly.io free allowance

- **Cost:** $0 within the free allowance (shared-cpu-1x, 256 MB).
- **Why it fits:** long-running process, persistent volume for `.rare/`.
- **Caveat:** 256 MB RAM will **not** hold the 0.6B GGUF plus Python. Either
  raise the machine size (paid) or run the engine with the `echo` adapter and
  point `RARE_OPENAI_BASE_URL` at a remote model. This is the honest limit.

### Option C — Render free web service

- **Cost:** $0.
- **Why it fits:** long-running process, HTTPS endpoint.
- **Caveat:** free instances **sleep after inactivity** and have an ephemeral
  filesystem — `.rare/` is lost on redeploy. Acceptable only if task resumption
  across deploys is not required.

### What was NOT chosen and why

- **Vercel Python runtime** — see §1. Disqualified on all three limits.
- **AWS Lambda** — 15-minute hard cap and no persistent disk; the same class of
  problem as Vercel with more setup.
- **Any paid managed inference** — not necessary to establish the architecture,
  and the brief says not to introduce paid services without necessity.

---

## 4. Environment variables

### TypeScript app

| Variable | Required | Purpose |
|---|---|---|
| `ENGINE_FEATURE_ENABLED` | yes, to enable | Must be exactly `true`. Anything else → routes return 404. |
| `RARE_ENGINE_BASE_URL` | yes | e.g. `http://127.0.0.1:8000` |
| `RARE_SERVICE_TOKEN` | yes | Shared bearer secret. Must match the engine's. |
| `ENGINE_TIMEOUT_MS` | no | Default `900000`. |

### Python engine

| Variable | Required | Purpose |
|---|---|---|
| `RARE_SERVICE_TOKEN` | yes | Fail-closed: unset → every `/v1/*` call returns **503**. |
| `RARE_SERVICE_ALLOW_ANONYMOUS` | no | `1` disables auth. **Development only.** |
| `RARE_STATE_DIR` | no | Where `.rare/` lives. Must be a persistent volume. |

---

## 5. Security notes that affect deployment

### 5.1 Loopback callers are trusted as `developer`

`AuthManager.resolveRole()` grants the `developer` role when `req.ip` is
`127.0.0.1`/`::1`, or when `Host`/`Origin` match (same-origin dashboard). This is
deliberate for local use, and it is asserted in
`src/integration/engine_route.test.ts` so the behaviour is visible rather than
assumed.

**Consequence:** if the app is deployed behind a proxy that does not rewrite the
client IP, every request appears to come from loopback and is authenticated as
`developer`. **Put the app behind a proxy that sets a real client IP, or add an
explicit API-key requirement before exposing it publicly.** This is pre-existing
application behaviour, not introduced by the engine integration.

### 5.2 The engine's token is a shared secret

`RARE_SERVICE_TOKEN` is compared with `hmac.compare_digest` (constant time). It
must be at least 32 random bytes and must never be committed. `.env*` is
gitignored; `.env.example` is the only tracked template.

### 5.3 Runtime state is not in version control

`data/rare_intelligence_memory.json` and `data/jobs/` are gitignored. The
committed `data/rare_intelligence_memory.example.json` is a redacted schema
template with empty collections.

---

## 6. Verifying a deployment

```bash
# 1. Engine is up and authenticated
curl -s http://127.0.0.1:8000/health

# 2. Engine rejects an unauthenticated call
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8000/v1/tasks \
  -H 'Content-Type: application/json' -d '{"goal":"x"}'
# expect 401

# 3. App route is gated
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/v1/engine/jobs
# expect 404 when ENGINE_FEATURE_ENABLED is not 'true'

# 4. End-to-end submit
curl -s -X POST http://127.0.0.1:3000/api/v1/engine/tasks \
  -H "Authorization: Bearer $RARE_DEV_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"goal":"say hello","idempotencyKey":"smoke-1"}'
# expect 202 with a job id
```

---

## 7. What is NOT deployed

- No production deployment has been performed.
- No Vercel project was created or configured.
- The pull request is open and unmerged.
- `Rare-Erudite/COMPLETED` was not touched.
