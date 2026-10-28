"""Shared fixtures.

Every test that needs a model uses the deterministic echo adapter or a
scripted fake. Only tests marked ``requires_model`` touch real weights, so the
default suite runs in seconds on any machine with no downloads.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from rare_engine.config import EngineConfig, ModelConfig, OrchestratorConfig, ToolConfig  # noqa: E402
from rare_engine.models.base import (  # noqa: E402
    GenerationRequest,
    GenerationResponse,
    HealthStatus,
    ModelAdapter,
    Usage,
)  # noqa: E402


class ScriptedAdapter(ModelAdapter):
    """Replays a fixed list of replies; records every request it received."""

    backend = "scripted"

    def __init__(self, replies: list[str], model_id: str = "scripted") -> None:
        super().__init__(model_id=model_id, context_window=8192)
        self.replies = list(replies)
        self.requests: list[GenerationRequest] = []
        self.calls = 0

    async def generate(self, request: GenerationRequest) -> GenerationResponse:
        self.requests.append(request)
        self.calls += 1
        if not self.replies:
            raise AssertionError("ScriptedAdapter ran out of scripted replies")
        text = self.replies.pop(0)
        return GenerationResponse(
            text=text,
            model_id=self.model_id,
            usage=Usage.from_counts(100, 20),
            finish_reason="stop",
            latency_ms=1.0,
            backend=self.backend,
        )

    async def health(self) -> HealthStatus:
        return HealthStatus(
            ok=True, model_id=self.model_id, backend=self.backend,
            detail="scripted", loaded=True,
        )


@pytest.fixture
def config(tmp_path: Path) -> EngineConfig:
    """A config with the echo model, isolated state dir and sandbox."""
    return EngineConfig(
        env="test",
        state_dir=str(tmp_path / "state"),
        log_level="CRITICAL",
        log_format="text",
        default_model="echo",
        models={
            "echo": ModelConfig(id="echo", adapter="echo", model_ref="echo"),
        },
        orchestrator=OrchestratorConfig(
            task_timeout_s=30, model_timeout_s=10, max_steps=6, max_retries=1,
            retry_backoff_s=0.0, max_model_calls=10, max_tool_calls=10,
        ),
        tools=ToolConfig(sandbox_root=str(tmp_path / "sandbox"), enable_shell=False),
    )


@pytest.fixture
def sandbox(tmp_path: Path) -> Path:
    path = tmp_path / "sandbox"
    path.mkdir(parents=True, exist_ok=True)
    return path


@pytest.fixture
def scripted() -> type[ScriptedAdapter]:
    return ScriptedAdapter
