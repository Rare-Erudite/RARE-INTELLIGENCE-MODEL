"""Tests for the HTTP service layer.

These run the real FastAPI stack (via TestClient) against the echo adapter and
a temporary state directory: no weights, no network, no model download. That
is the point - the service contract must be verifiable in CI on a machine that
has never seen a GGUF file.

The TypeScript client (``src/integration/python_engine_client.ts``) is tested
against the same wire shapes in ``engine-test-suite.ts``, so a drift on either
side of the contract fails a test.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from rare_engine.config import EngineConfig, ModelConfig
from rare_engine.memory.retrieval import Retriever
from rare_engine.service import ALLOW_ANONYMOUS_ENV, SERVICE_TOKEN_ENV, create_app
from rare_engine.state import TaskStore

TOKEN = "test-service-token"


@pytest.fixture()
def config(tmp_path: Path) -> EngineConfig:
    """Echo-only config rooted in a temp dir, so nothing touches the repo."""
    return EngineConfig(
        env="test",
        state_dir=str(tmp_path / "state"),
        default_model="echo",
        models={
            "echo": ModelConfig(
                id="echo",
                adapter="echo",
                model_ref="echo",
                context_window=8192,
                max_tokens=256,
            )
        },
    )


@pytest.fixture()
def client(config: EngineConfig, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(SERVICE_TOKEN_ENV, TOKEN)
    monkeypatch.delenv(ALLOW_ANONYMOUS_ENV, raising=False)
    app = create_app(
        config,
        store=TaskStore(config.state_path),
        retriever=Retriever(tmp_path / "memory"),
    )
    with TestClient(app) as c:
        yield c


def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


# --- health ----------------------------------------------------------------


def test_health_is_unauthenticated_and_reports_model(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["model_id"] == "echo"
    assert body["adapter"] == "echo"
    assert body["model_ready"] is True
    assert "version" in body


# --- authentication --------------------------------------------------------


def test_missing_token_is_rejected(client: TestClient) -> None:
    r = client.post("/v1/tasks", json={"goal": "x"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "unauthorized"


def test_wrong_token_is_rejected(client: TestClient) -> None:
    r = client.post("/v1/tasks", json={"goal": "x"}, headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_service_refuses_to_start_without_token(
    config: EngineConfig, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fail-closed: no token and no explicit opt-out means 503, not open access."""
    monkeypatch.delenv(SERVICE_TOKEN_ENV, raising=False)
    monkeypatch.delenv(ALLOW_ANONYMOUS_ENV, raising=False)
    app = create_app(
        config,
        store=TaskStore(config.state_path),
        retriever=Retriever(tmp_path / "memory"),
    )
    with TestClient(app) as c:
        r = c.post("/v1/tasks", json={"goal": "x"})
        assert r.status_code == 503
        assert r.json()["detail"]["code"] == "service_not_configured"


def test_anonymous_opt_in_allows_access(
    config: EngineConfig, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(SERVICE_TOKEN_ENV, raising=False)
    monkeypatch.setenv(ALLOW_ANONYMOUS_ENV, "1")
    app = create_app(
        config,
        store=TaskStore(config.state_path),
        retriever=Retriever(tmp_path / "memory"),
    )
    with TestClient(app) as c:
        r = c.post("/v1/tasks", json={"goal": "say hi"})
        assert r.status_code == 200


# --- tasks -----------------------------------------------------------------


def test_run_task_returns_terminal_state(client: TestClient) -> None:
    r = client.post("/v1/tasks", json={"goal": "say hello"}, headers=auth())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in {"succeeded", "failed"}
    assert body["task_id"].startswith("task_")
    assert isinstance(body["steps"], int)
    assert "total_tokens" in body


def test_run_task_rejects_blank_goal(client: TestClient) -> None:
    r = client.post("/v1/tasks", json={"goal": ""}, headers=auth())
    assert r.status_code == 422


def test_get_task_round_trips(client: TestClient) -> None:
    created = client.post("/v1/tasks", json={"goal": "say hello"}, headers=auth()).json()
    r = client.get(f"/v1/tasks/{created['task_id']}", headers=auth())
    assert r.status_code == 200
    assert r.json()["task_id"] == created["task_id"]


def test_get_unknown_task_is_404(client: TestClient) -> None:
    r = client.get("/v1/tasks/task_doesnotexist", headers=auth())
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "task_not_found"


def test_list_tasks_includes_created(client: TestClient) -> None:
    created = client.post("/v1/tasks", json={"goal": "say hello"}, headers=auth()).json()
    r = client.get("/v1/tasks", headers=auth())
    assert r.status_code == 200
    ids = [t["task_id"] for t in r.json()]
    assert created["task_id"] in ids


def test_resume_unknown_task_is_404(client: TestClient) -> None:
    r = client.post("/v1/tasks/task_nope/resume", headers=auth())
    assert r.status_code == 404


def test_resume_completed_task_is_409(client: TestClient) -> None:
    """A finished task must not be silently re-run - that would repeat side effects."""
    created = client.post("/v1/tasks", json={"goal": "say hello"}, headers=auth()).json()
    if created["status"] != "succeeded":
        pytest.skip("echo adapter did not reach a terminal success state")
    r = client.post(f"/v1/tasks/{created['task_id']}/resume", headers=auth())
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "task_not_resumable"


# --- memory ----------------------------------------------------------------


def test_remember_then_search(client: TestClient) -> None:
    doc_id = client.post(
        "/v1/memory/remember",
        json={"text": "The deployment window is Tuesday at 14:00 UTC."},
        headers=auth(),
    ).json()["doc_id"]
    assert doc_id

    r = client.post(
        "/v1/memory/search",
        json={"query": "deployment window", "top_k": 3},
        headers=auth(),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total_indexed"] >= 1
    assert any("deployment" in h["text"].lower() for h in body["hits"])


def test_search_with_no_match_returns_empty(client: TestClient) -> None:
    client.post("/v1/memory/remember", json={"text": "alpha beta gamma"}, headers=auth())
    r = client.post(
        "/v1/memory/search",
        json={"query": "zzzznonexistentterm", "top_k": 3},
        headers=auth(),
    )
    assert r.status_code == 200
    assert r.json()["hits"] == []


def test_search_top_k_is_bounded(client: TestClient) -> None:
    r = client.post(
        "/v1/memory/search",
        json={"query": "anything", "top_k": 999},
        headers=auth(),
    )
    assert r.status_code == 422


# --- contract shape --------------------------------------------------------


def test_wire_field_names_are_snake_case(client: TestClient) -> None:
    """The TS client maps snake_case -> camelCase; the wire must stay snake_case."""
    body = client.post("/v1/tasks", json={"goal": "say hello"}, headers=auth()).json()
    for key in ("task_id", "total_tokens", "duration_s", "error_code"):
        assert key in body, f"missing wire field {key}"
    assert "taskId" not in body
