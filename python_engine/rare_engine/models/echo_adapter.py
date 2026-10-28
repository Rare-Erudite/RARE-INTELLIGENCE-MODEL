"""Deterministic adapter for tests and offline CI.

This is **not** a language model and never pretends to be one. It exists so
the orchestrator, state machine, tool loop and error paths can be tested
deterministically without downloading weights or calling a network.

It is explicitly excluded from any benchmark claim: MODEL_REGISTRY.md marks it
``benchmark_eligible: false``.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re

from .base import (
    GenerationRequest,
    GenerationResponse,
    HealthStatus,
    ModelAdapter,
    Usage,
)


class EchoAdapter(ModelAdapter):
    backend = "echo"

    def __init__(
        self,
        model_id: str = "echo",
        context_window: int = 8192,
        latency_s: float = 0.0,
        scripted: list[str] | None = None,
    ) -> None:
        super().__init__(model_id=model_id, context_window=context_window)
        self.latency_s = latency_s
        self.scripted = list(scripted or [])
        self.calls: list[GenerationRequest] = []

    async def generate(self, request: GenerationRequest) -> GenerationResponse:
        self.calls.append(request)
        if self.latency_s:
            await asyncio.sleep(self.latency_s)

        if self.scripted:
            text = self.scripted.pop(0)
        else:
            text = self._synthesize(request)

        prompt_chars = sum(len(m.content) for m in request.messages)
        return GenerationResponse(
            text=text,
            model_id=self.model_id,
            usage=Usage.from_counts(prompt_chars // 4, len(text) // 4),
            finish_reason="stop",
            latency_ms=0.0,
            backend=self.backend,
        )

    def _synthesize(self, request: GenerationRequest) -> str:
        """Produce a deterministic, structurally valid answer.

        If the last user message asks for JSON, emit a JSON object so the
        orchestrator's parser is exercised for real.
        """
        last_user = next(
            (m.content for m in reversed(request.messages) if m.role == "user"), ""
        )
        digest = hashlib.sha256(last_user.encode()).hexdigest()[:8]

        if request.json_mode or re.search(r"\bjson\b", last_user, re.I):
            return json.dumps(
                {
                    "summary": f"deterministic-echo-{digest}",
                    "confidence": 0.0,
                    "note": "echo adapter: no language understanding",
                }
            )
        return f"[echo:{digest}] {last_user[:200]}"

    async def health(self) -> HealthStatus:
        return HealthStatus(
            ok=True, model_id=self.model_id, backend=self.backend,
            detail="deterministic test adapter", loaded=True,
            context_window=self.context_window, latency_ms=0.0,
        )

    def reset(self) -> None:
        self.calls.clear()
