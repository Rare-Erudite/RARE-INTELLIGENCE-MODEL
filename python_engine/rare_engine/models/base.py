"""Unified model interface.

Every inference backend implements :class:`ModelAdapter`. The rest of the
engine never imports a backend SDK directly - it only sees these types. That
is what makes the engine model-agnostic: swapping Qwen3-0.6B for a remote
endpoint is a config change, not a code change.

Design notes
------------
* The interface is **async**. Blocking backends (llama.cpp) run in a worker
  thread so the orchestrator's event loop stays responsive and timeouts work.
* ``generate`` is the only required method. Streaming is deliberately not in
  the v1 contract - it is listed in ROADMAP.md as a later addition, and
  pretending to support it would be worse than not supporting it.
* Every response carries real token accounting when the backend reports it,
  and zeros when it does not. We never invent token counts.
"""

from __future__ import annotations

import abc
import time
from typing import Any, Literal

from pydantic import BaseModel, Field

Role = Literal["system", "user", "assistant", "tool"]


class Message(BaseModel):
    role: Role
    content: str
    name: str | None = None

    @classmethod
    def system(cls, content: str) -> Message:
        return cls(role="system", content=content)

    @classmethod
    def user(cls, content: str) -> Message:
        return cls(role="user", content=content)

    @classmethod
    def assistant(cls, content: str) -> Message:
        return cls(role="assistant", content=content)


class GenerationRequest(BaseModel):
    messages: list[Message]
    max_tokens: int | None = None
    temperature: float | None = None
    top_p: float | None = None
    stop: list[str] = Field(default_factory=list)
    json_mode: bool = False
    seed: int | None = None

    def with_system(self, system: str) -> GenerationRequest:
        """Return a copy with a system message prepended (replacing any existing)."""
        rest = [m for m in self.messages if m.role != "system"]
        return self.model_copy(update={"messages": [Message.system(system), *rest]})


class Usage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0

    @classmethod
    def from_counts(cls, prompt: int | None, completion: int | None) -> Usage:
        p = int(prompt or 0)
        c = int(completion or 0)
        return cls(prompt_tokens=p, completion_tokens=c, total_tokens=p + c)


class GenerationResponse(BaseModel):
    text: str
    model_id: str
    usage: Usage = Field(default_factory=Usage)
    finish_reason: str = "stop"
    latency_ms: float = 0.0
    backend: str = ""
    raw: dict[str, Any] | None = None

    @property
    def empty(self) -> bool:
        return not self.text.strip()


class HealthStatus(BaseModel):
    ok: bool
    model_id: str
    backend: str
    detail: str = ""
    loaded: bool = False
    context_window: int = 0
    latency_ms: float | None = None


class ModelAdapter(abc.ABC):
    """Contract every inference backend must satisfy."""

    backend: str = "unknown"

    def __init__(self, model_id: str, context_window: int = 4096) -> None:
        self.model_id = model_id
        self.context_window = context_window

    @abc.abstractmethod
    async def generate(self, request: GenerationRequest) -> GenerationResponse:
        """Run one completion. Must raise a :class:`ModelError` subclass on failure."""

    @abc.abstractmethod
    async def health(self) -> HealthStatus:
        """Cheap readiness probe. Must not raise."""

    async def close(self) -> None:
        """Release resources. Default is a no-op."""
        return None

    async def __aenter__(self) -> ModelAdapter:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    # --- helpers shared by adapters -----------------------------------------

    @staticmethod
    def _timer() -> float:
        return time.perf_counter()

    @staticmethod
    def _elapsed_ms(start: float) -> float:
        return round((time.perf_counter() - start) * 1000, 2)

    def _resolve(
        self,
        request: GenerationRequest,
        default_max: int,
        default_temp: float,
        default_top_p: float,
    ) -> tuple[int, float, float]:
        return (
            request.max_tokens if request.max_tokens is not None else default_max,
            request.temperature if request.temperature is not None else default_temp,
            request.top_p if request.top_p is not None else default_top_p,
        )
