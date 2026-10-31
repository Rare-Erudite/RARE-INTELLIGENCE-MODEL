"""OpenAI-compatible HTTP adapter.

Works against any server exposing ``POST /v1/chat/completions``: OpenAI, vLLM,
LM Studio, Ollama's ``/v1`` shim, Together, Groq, Fireworks, and self-hosted
gateways. Uses ``httpx`` directly so the engine has no vendor SDK dependency.

The API key is read from an environment variable named in config - it is never
stored in the config file or in Git.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from ..errors import ModelResponseError, ModelTimeoutError, ModelUnavailableError
from ..logging import get_logger
from .base import (
    GenerationRequest,
    GenerationResponse,
    HealthStatus,
    ModelAdapter,
    Usage,
)

log = get_logger("models.openai_compat")


class OpenAICompatAdapter(ModelAdapter):
    backend = "openai_compat"

    def __init__(
        self,
        model_id: str,
        model_ref: str,
        base_url: str,
        api_key_env: str = "RARE_OPENAI_API_KEY",
        context_window: int = 32768,
        max_tokens: int = 1024,
        temperature: float = 0.2,
        top_p: float = 0.95,
        timeout_s: float = 120.0,
    ) -> None:
        super().__init__(model_id=model_id, context_window=context_window)
        self.model_ref = model_ref
        self.base_url = base_url.rstrip("/")
        self.api_key_env = api_key_env
        self.default_max_tokens = max_tokens
        self.default_temperature = temperature
        self.default_top_p = top_p
        self.timeout_s = timeout_s
        self._client: httpx.AsyncClient | None = None

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        key = os.environ.get(self.api_key_env, "")
        if key:
            headers["Authorization"] = f"Bearer {key}"
        return headers

    def _client_or_create(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url, timeout=self.timeout_s, headers=self._headers()
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def generate(self, request: GenerationRequest) -> GenerationResponse:
        if not self.base_url:
            raise ModelUnavailableError(
                "no base_url configured", model_id=self.model_id,
                hint="set RARE_OPENAI_BASE_URL",
            )

        max_tokens, temperature, top_p = self._resolve(
            request, self.default_max_tokens, self.default_temperature, self.default_top_p
        )
        payload: dict[str, Any] = {
            "model": self.model_ref,
            "messages": [m.model_dump(exclude_none=True) for m in request.messages],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
        }
        if request.stop:
            payload["stop"] = request.stop
        if request.seed is not None:
            payload["seed"] = request.seed
        if request.json_mode:
            payload["response_format"] = {"type": "json_object"}

        client = self._client_or_create()
        start = self._timer()
        try:
            resp = await client.post("/chat/completions", json=payload)
        except httpx.TimeoutException as exc:
            raise ModelTimeoutError(
                f"request exceeded {self.timeout_s}s", model_id=self.model_id
            ) from exc
        except httpx.HTTPError as exc:
            raise ModelUnavailableError(
                f"transport error: {exc}", model_id=self.model_id, base_url=self.base_url
            ) from exc

        latency = self._elapsed_ms(start)

        if resp.status_code >= 400:
            body = resp.text[:500]
            raise ModelResponseError(
                f"HTTP {resp.status_code} from endpoint",
                model_id=self.model_id, status=resp.status_code, body=body,
            )

        try:
            data = resp.json()
            choice = data["choices"][0]
            text = (choice.get("message") or {}).get("content") or ""
            finish = choice.get("finish_reason") or "stop"
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ModelResponseError(
                "unexpected response shape", model_id=self.model_id,
                body=resp.text[:500],
            ) from exc

        usage_raw = data.get("usage") or {}
        return GenerationResponse(
            text=text,
            model_id=self.model_id,
            usage=Usage.from_counts(
                usage_raw.get("prompt_tokens"), usage_raw.get("completion_tokens")
            ),
            finish_reason=finish,
            latency_ms=latency,
            backend=self.backend,
            raw={"id": data.get("id"), "model": data.get("model")},
        )

    async def health(self) -> HealthStatus:
        start = self._timer()
        if not self.base_url:
            return HealthStatus(
                ok=False, model_id=self.model_id, backend=self.backend,
                detail="no base_url configured",
            )
        try:
            client = self._client_or_create()
            resp = await client.get("/models")
            ok = resp.status_code < 400
            return HealthStatus(
                ok=ok, model_id=self.model_id, backend=self.backend,
                detail=f"HTTP {resp.status_code}", loaded=ok,
                context_window=self.context_window,
                latency_ms=self._elapsed_ms(start),
            )
        except Exception as exc:  # noqa: BLE001 - a health check must never raise
            return HealthStatus(
                ok=False, model_id=self.model_id, backend=self.backend, detail=str(exc),
                latency_ms=self._elapsed_ms(start),
            )
