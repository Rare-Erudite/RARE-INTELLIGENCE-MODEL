"""HTTP service exposing the engine to the TypeScript application.

Why this exists
---------------
The TypeScript app (``server.ts``) runs on Vercel. Vercel's serverless
functions cannot host this engine:

* no long-running process - a task can take minutes, and the function is
  killed at the platform timeout;
* no persistent disk - ``.rare/`` task state and the retrieval index would
  vanish between invocations;
* bundle size limits - the engine plus a GGUF weight file is far over the
  limit, and weights cannot be shipped in a function at all.

So the engine runs as its own process (container, VM, or any host that gives
it a disk) and the TypeScript app talks to it over HTTP. This module is that
HTTP surface. It is deliberately thin: it validates input, calls the existing
orchestrator/retriever, and serialises the result. No business logic lives
here that is not already in the engine.

Contract
--------
The wire contract is documented in ``INTEGRATION_CONTRACT.md`` and mirrored by
``src/integration/rare_engine_client.ts``. Both sides are tested against the
same fixtures in ``tests/test_service.py`` and
``src/integration/rare_engine_client.test.ts``.

Authentication
--------------
A shared bearer token (``RARE_SERVICE_TOKEN``). If the variable is unset the
service refuses to start unless ``RARE_SERVICE_ALLOW_ANONYMOUS=1`` is set,
which exists only so local development and CI can run without a secret. That
default is fail-closed on purpose: an unauthenticated engine on a public
network is a remote code execution surface, because the tool registry can
write files and (when enabled) run shell commands.
"""

from __future__ import annotations

import os
import time
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

from . import __version__
from .config import EngineConfig, load_config
from .errors import RareError, TaskNotFoundError, TaskNotResumableError
from .logging import get_logger
from .memory.retrieval import Retriever
from .models import build_default_adapter
from .orchestrator import Orchestrator
from .state import TaskStore
from .tools import ToolRegistry, build_registry

log = get_logger("service")

SERVICE_TOKEN_ENV = "RARE_SERVICE_TOKEN"
ALLOW_ANONYMOUS_ENV = "RARE_SERVICE_ALLOW_ANONYMOUS"


# ---------------------------------------------------------------------------
# Wire models
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    ok: bool
    version: str
    model_id: str
    adapter: str
    model_ready: bool
    detail: str = ""
    uptime_s: float = 0.0


class RunRequest(BaseModel):
    goal: str = Field(..., min_length=1, max_length=8000)
    model_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    # Client-supplied idempotency key. When a caller retries after a crash it
    # resends the same task_id, so the engine overwrites one task record
    # instead of creating a second one. Optional: omitting it keeps the
    # engine-generated id and the original behaviour.
    task_id: str | None = Field(default=None, max_length=128)


class RunResponse(BaseModel):
    task_id: str
    status: str
    result: str | None = None
    steps: int
    duration_s: float
    total_tokens: int
    error: str | None = None
    error_code: str | None = None
    resumed_from_step: int | None = None


class TaskSummary(BaseModel):
    task_id: str
    goal: str
    status: str
    steps: int
    updated_at: str


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)
    namespace: str | None = None


class SearchHitModel(BaseModel):
    doc_id: str
    source: str
    score: float
    text: str


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHitModel]
    total_indexed: int


class RememberRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000)
    key: str | None = None


class RememberResponse(BaseModel):
    doc_id: str


class ErrorBody(BaseModel):
    code: str
    message: str


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def _require_token(authorization: str | None = Header(default=None)) -> None:
    """Fail-closed bearer check.

    ``RARE_SERVICE_ALLOW_ANONYMOUS=1`` is the only way to skip it, and it is
    documented as development-only.
    """
    expected = os.environ.get(SERVICE_TOKEN_ENV, "").strip()
    if not expected:
        if os.environ.get(ALLOW_ANONYMOUS_ENV) == "1":
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "service_not_configured",
                "message": (
                    f"{SERVICE_TOKEN_ENV} is not set. Set it, or set "
                    f"{ALLOW_ANONYMOUS_ENV}=1 for local development only."
                ),
            },
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "unauthorized", "message": "missing bearer token"},
        )

    supplied = authorization.removeprefix("Bearer ").strip()
    # Constant-time comparison: a timing oracle on a shared secret is a real
    # (if slow) attack, and hmac.compare_digest costs nothing here.
    import hmac

    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "unauthorized", "message": "invalid bearer token"},
        )


def create_app(
    config: EngineConfig | None = None,
    *,
    adapter: Any | None = None,
    registry: ToolRegistry | None = None,
    store: TaskStore | None = None,
    retriever: Retriever | None = None,
) -> FastAPI:
    """Build the FastAPI app.

    Every collaborator is injectable so tests can run the real HTTP stack
    against the echo adapter and a temporary state directory, with no weights
    and no network.
    """
    cfg = config or load_config()
    started = time.perf_counter()

    _adapter = adapter or build_default_adapter(cfg)
    _retriever = retriever or Retriever(cfg.memory_path)
    # build_registry wires the sandbox path, allowlist and shell policy from
    # config; constructing ToolRegistry directly would need all of them.
    _registry = registry or build_registry(cfg, retriever=_retriever)
    _store = store or TaskStore(cfg.state_path)
    _store.init()

    app = FastAPI(
        title="RARE Intelligence Engine",
        version=__version__,
        description="Autonomous engineering engine. See INTEGRATION_CONTRACT.md.",
    )

    app.state.config = cfg
    app.state.adapter = _adapter
    app.state.registry = _registry
    app.state.store = _store
    app.state.retriever = _retriever

    def _orchestrator() -> Orchestrator:
        return Orchestrator(cfg, _adapter, _registry, _store)

    # --- health ------------------------------------------------------------

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        """Liveness + model readiness.

        Deliberately unauthenticated: a load balancer needs it, and it leaks
        only the model id and a boolean.
        """
        try:
            h = await _adapter.health()
            ready, detail = h.ok, h.detail
        except Exception as exc:  # noqa: BLE001 - health must never raise
            ready, detail = False, f"{type(exc).__name__}: {exc}"

        return HealthResponse(
            ok=True,
            version=__version__,
            model_id=getattr(_adapter, "model_id", "unknown"),
            adapter=getattr(_adapter, "backend", "unknown"),
            model_ready=ready,
            detail=detail,
            uptime_s=round(time.perf_counter() - started, 2),
        )

    # --- tasks -------------------------------------------------------------

    @app.post("/v1/tasks", response_model=RunResponse, dependencies=[Depends(_require_token)])
    async def run_task(req: RunRequest) -> RunResponse:
        """Run one task to a terminal state.

        Synchronous by design for v1: the caller waits. A job queue with
        polling is the correct shape for long tasks and is listed in
        ROADMAP.md; pretending this endpoint is async would be worse.
        """
        try:
            result = await _orchestrator().run(
                goal=req.goal,
                model_id=req.model_id,
                task_id=req.task_id,
                metadata=req.metadata,
            )
        except RareError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": type(exc).__name__, "message": str(exc)},
            ) from exc

        return RunResponse(**result.to_dict())

    @app.post(
        "/v1/tasks/{task_id}/resume",
        response_model=RunResponse,
        dependencies=[Depends(_require_token)],
    )
    async def resume_task(task_id: str) -> RunResponse:
        try:
            result = await _orchestrator().resume(task_id)
        except TaskNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "task_not_found", "message": str(exc)},
            ) from exc
        except TaskNotResumableError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "task_not_resumable", "message": str(exc)},
            ) from exc
        except RareError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": type(exc).__name__, "message": str(exc)},
            ) from exc

        return RunResponse(**result.to_dict())

    @app.get(
        "/v1/tasks",
        response_model=list[TaskSummary],
        dependencies=[Depends(_require_token)],
    )
    async def list_tasks(limit: int = 50) -> list[TaskSummary]:
        limit = max(1, min(limit, 200))
        out: list[TaskSummary] = []
        for row in _store.list(limit=limit):
            out.append(
                TaskSummary(
                    task_id=row["task_id"],
                    goal=row.get("goal", ""),
                    status=row.get("status", "unknown"),
                    steps=int(row.get("steps", 0)),
                    updated_at=str(row.get("updated_at", "")),
                )
            )
        return out

    @app.get(
        "/v1/tasks/{task_id}",
        response_model=RunResponse,
        dependencies=[Depends(_require_token)],
    )
    async def get_task(task_id: str) -> RunResponse:
        try:
            state = _store.load(task_id)
        except TaskNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "task_not_found", "message": str(exc)},
            ) from exc

        return RunResponse(
            task_id=state.task_id,
            status=state.status.value,
            result=state.result,
            steps=state.step_count,
            duration_s=state.duration_s,
            total_tokens=state.total_tokens,
            error=state.last_error,
            error_code=state.last_error_code,
        )

    # --- memory ------------------------------------------------------------

    @app.post(
        "/v1/memory/search",
        response_model=SearchResponse,
        dependencies=[Depends(_require_token)],
    )
    async def search(req: SearchRequest) -> SearchResponse:
        hits = _retriever.search(req.query, top_k=req.top_k)
        stats = _retriever.stats()
        return SearchResponse(
            query=req.query,
            hits=[
                SearchHitModel(
                    doc_id=h.doc_id,
                    source=h.source,
                    score=round(float(h.score), 6),
                    text=h.text,
                )
                for h in hits
            ],
            total_indexed=int(stats.get("documents", 0)),
        )

    @app.post(
        "/v1/memory/remember",
        response_model=RememberResponse,
        dependencies=[Depends(_require_token)],
    )
    async def remember(req: RememberRequest) -> RememberResponse:
        doc_id = _retriever.remember(req.text, key=req.key)
        return RememberResponse(doc_id=doc_id)

    # --- lifecycle ---------------------------------------------------------

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        try:
            await _adapter.close()
        except Exception as exc:  # noqa: BLE001 - shutdown must not raise
            log.warning("adapter close failed", extra={"error": str(exc)})

    return app


def main() -> None:  # pragma: no cover - process entry point
    """``python -m rare_engine.service`` / ``rare serve``."""
    import uvicorn

    host = os.environ.get("RARE_SERVICE_HOST", "127.0.0.1")
    port = int(os.environ.get("RARE_SERVICE_PORT", "8099"))
    app = create_app()
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":  # pragma: no cover
    main()
