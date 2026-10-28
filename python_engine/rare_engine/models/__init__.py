"""Model layer: unified interface + adapters + factory.

The factory is the only place that knows about concrete backends. Everything
else depends on :class:`ModelAdapter`.
"""

from __future__ import annotations

from typing import Any

from ..config import EngineConfig, ModelConfig, resolve_model_path
from ..errors import ConfigError
from .base import (
    GenerationRequest,
    GenerationResponse,
    HealthStatus,
    Message,
    ModelAdapter,
    Usage,
)
from .echo_adapter import EchoAdapter
from .llamacpp_adapter import LlamaCppAdapter
from .openai_adapter import OpenAICompatAdapter

__all__ = [
    "GenerationRequest",
    "GenerationResponse",
    "HealthStatus",
    "Message",
    "ModelAdapter",
    "Usage",
    "EchoAdapter",
    "LlamaCppAdapter",
    "OpenAICompatAdapter",
    "build_adapter",
    "build_default_adapter",
]


def build_adapter(model: ModelConfig, config: EngineConfig) -> ModelAdapter:
    """Instantiate the adapter described by ``model``."""
    timeout = float(config.orchestrator.model_timeout_s)

    if model.adapter == "llamacpp":
        return LlamaCppAdapter(
            model_id=model.id,
            model_path=resolve_model_path(model),
            context_window=model.context_window,
            max_tokens=model.max_tokens,
            temperature=model.temperature,
            top_p=model.top_p,
            n_threads=model.n_threads,
            n_gpu_layers=model.n_gpu_layers,
            stop=model.stop,
            timeout_s=timeout,
            enable_thinking=model.enable_thinking,
            chat_format=model.chat_format,
        )

    if model.adapter == "openai_compat":
        extra: dict[str, Any] = model.extra or {}
        base_url = extra.get("base_url", "")
        if not base_url:
            raise ConfigError(
                f"model '{model.id}' uses openai_compat but has no extra.base_url"
            )
        return OpenAICompatAdapter(
            model_id=model.id,
            model_ref=model.model_ref,
            base_url=base_url,
            api_key_env=extra.get("api_key_env", "RARE_OPENAI_API_KEY"),
            context_window=model.context_window,
            max_tokens=model.max_tokens,
            temperature=model.temperature,
            top_p=model.top_p,
            timeout_s=timeout,
        )

    if model.adapter == "echo":
        return EchoAdapter(
            model_id=model.id,
            context_window=model.context_window,
            latency_s=float((model.extra or {}).get("latency_s", 0.0)),
        )

    raise ConfigError(f"unknown adapter '{model.adapter}' for model '{model.id}'")


def build_default_adapter(config: EngineConfig, model_id: str | None = None) -> ModelAdapter:
    return build_adapter(config.model(model_id), config)
