# INTEGRATION_CONTRACT

**Status: NOT APPLIED.** This document describes a *future* integration. No code
in this repository touches `Rare-Erudite/COMPLETED`, its branches, or its
deployment. Applying any part of this requires explicit authorization.

**Last updated:** 2026-10-28

---

## 1. Scope and hard boundaries

| Item | Value |
|---|---|
| Target application | `Rare-Erudite/COMPLETED` |
| Target branch | `New-Fixes-by-Erudite` |
| Stack | Vercel (frontend/serverless) + Supabase (Postgres, auth, storage) |
| This repository | `RARE-INTELLIGENCE-ENGINE` (independent) |
| Current coupling | **none** |

**Rules:**

1. This engine never writes to the target repository, its branches, or its
   database.
2. Integration happens by the target application *calling* this engine, not by
   merging code into it.
3. No shared secrets. The engine gets its own credentials.
4. The target's `New-Fixes-by-Erudite` branch is not modified by this project.

## 2. Integration shape

The engine runs as a separate service. The application calls it over HTTP; the
engine never reaches into Supabase directly.

```
┌─────────────────────────┐        HTTPS         ┌──────────────────────────┐
│ Rare-Erudite/COMPLETED  │ ───────────────────▶ │ RARE Intelligence Engine │
│ (Vercel + Supabase)     │ ◀─────────────────── │ (separate service)       │
└─────────────────────────┘   task id + result    └──────────────────────────┘
                                                             │
                                                             ▼
                                                    own task store
```

### Why a service and not a library

The engine holds long-running state and needs a persistent task store. Embedding
it in Vercel serverless functions would fight the execution-time limit and give
the engine no durable home. A separate service keeps both sides simple.

## 3. Proposed API surface (not implemented)

These endpoints do **not** exist yet. They are the contract to build against.

### `POST /v1/tasks`

```json
{
  "goal": "string, required",
  "model_id": "string, optional",
  "metadata": {"any": "json, optional"},
  "budget": {"max_steps": 24, "task_timeout_s": 900}
}
```

Response `202`:

```json
{"task_id": "task_ab12cd34ef56", "status": "running"}
```

### `GET /v1/tasks/{task_id}`

```json
{
  "task_id": "task_ab12cd34ef56",
  "status": "succeeded|failed|running|cancelled|timed_out",
  "result": "string|null",
  "steps": 4,
  "total_tokens": 1830,
  "duration_s": 12.4,
  "error": "string|null",
  "error_code": "string|null"
}
```

### `POST /v1/tasks/{task_id}/resume`

Continues a task from its last completed step. Returns `409` with
`error_code: "task_not_resumable"` when the state is unsafe to continue — the
same refusal semantics as the CLI.

### `GET /v1/tasks/{task_id}/steps`

Full step trace for audit: thought, action, input, observation, ok/error,
latency, tokens.

## 4. Auth

- The engine requires a bearer token on every request.
- Tokens are per-tenant, stored in the engine's own secret store, never in the
  target repository.
- The target application holds the token in Vercel environment variables.
- No Supabase service-role key is ever given to the engine.

## 5. Data contract

| Concern | Decision |
|---|---|
| Task state | Owned by the engine, in its own store |
| Result handoff | JSON over HTTP; the application persists what it needs |
| PII | The engine stores whatever the goal contains — the caller must not send PII it would not store |
| Retention | Engine-side retention is a deployment setting; default is manual deletion |
| Secrets | Never in task metadata; `.env` is git-ignored |

## 6. Supabase touchpoints (application side only)

If the application wants to persist task results, it does so in its own tables.
A suggested shape, **not created by this project**:

```sql
-- illustrative only; not applied
create table rare_tasks (
  id uuid primary key default gen_random_uuid(),
  engine_task_id text not null unique,
  goal text not null,
  status text not null,
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Row-level security must be enabled and scoped to the owning user. This project
does not create, migrate or modify any Supabase schema.

## 7. Deployment

| Side | Where | Notes |
|---|---|---|
| Engine | Any container host with ≥8 GiB RAM for a 4B model, or a remote model endpoint | Not Vercel serverless |
| Application | Vercel, branch `New-Fixes-by-Erudite` | Unchanged by this project |

The engine needs a persistent volume for its task store. Serverless is not
suitable.

## 8. Rollout plan (when authorized)

1. Deploy the engine to a staging host with its own credentials.
2. Add a feature flag in the application, default **off**.
3. Wire one read-only use case behind the flag.
4. Verify with the eval suite plus a manual end-to-end check.
5. Only then consider write-capable tools.

## 9. What is explicitly out of scope

- Merging engine code into `Rare-Erudite/COMPLETED`.
- Modifying the `New-Fixes-by-Erudite` branch.
- Sharing a database or credentials.
- Deploying the engine to the application's Vercel project.
- Any change to the application's production data.

## 10. Authorization

Nothing in this document is in effect. To proceed, the owner must explicitly
authorize integration and name the environment (staging first). Until then this
file is a design document only.
