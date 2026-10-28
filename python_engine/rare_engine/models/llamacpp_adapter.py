"""llama.cpp adapter - real local CPU/GPU inference over GGUF weights.

This is the engine's primary local backend. It is genuinely working: it loads
a GGUF file through ``llama-cpp-python`` and generates tokens.

Concurrency model
-----------------
``llama_cpp.Llama`` is a blocking C extension. We therefore:

* load the model lazily, once, under an ``asyncio.Lock``;
* run every ``create_chat_completion`` call in a dedicated single-thread
  executor, so the event loop is never blocked;
* enforce the timeout with ``asyncio.wait_for``.

Honest limitation: a timed-out generation cannot be interrupted inside the C
call. The awaiting coroutine is released and the worker thread finishes the
current token loop in the background. This is documented in
KNOWN_LIMITATIONS.md rather than papered over.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import os
from pathlib import Path
from typing import Any

from ..errors import ModelResponseError, ModelTimeoutError, ModelUnavailableError
from ..logging import get_logger
from .base import (
    GenerationRequest,
    GenerationResponse,
    HealthStatus,
    ModelAdapter,
    Usage,
)

log = get_logger("models.llamacpp")


class LlamaCppAdapter(ModelAdapter):
    backend = "llamacpp"

    def __init__(
        self,
        model_id: str,
        model_path: str | Path,
        context_window: int = 4096,
        max_tokens: int = 512,
        temperature: float = 0.2,
        top_p: float = 0.95,
        n_threads: int = 0,
        n_gpu_layers: int = 0,
        stop: list[str] | None = None,
        timeout_s: float = 180.0,
        verbose: bool = False,
        enable_thinking: bool = False,
        chat_format: str = "chatml",
    ) -> None:
        super().__init__(model_id=model_id, context_window=context_window)
        self.model_path = Path(model_path)
        self.default_max_tokens = max_tokens
        self.default_temperature = temperature
        self.default_top_p = top_p
        self.n_threads = n_threads or min(8, os.cpu_count() or 4)
        self.n_gpu_layers = n_gpu_layers
        self.stop = stop or []
        self.timeout_s = timeout_s
        self.verbose = verbose
        # Qwen3 and similar hybrid-reasoning models emit a  thinking block before
        # the answer. On a small token budget that block consumes the entire
        # completion and the engine never sees an action. Disabled by default;
        # see TEST_REPORT.md for the measured failure this prevents.
        self.enable_thinking = enable_thinking
        # Which template the prefill path may assume. Only "chatml" is
        # supported; anything else falls back to the normal chat path.
        self.chat_format = chat_format

        self._llm: Any = None
        self._load_lock = asyncio.Lock()
        self._executor: concurrent.futures.ThreadPoolExecutor | None = None

    # --- lifecycle -----------------------------------------------------------

    def _ensure_executor(self) -> concurrent.futures.ThreadPoolExecutor:
        if self._executor is None:
            self._executor = concurrent.futures.ThreadPoolExecutor(
                max_workers=1, thread_name_prefix=f"llamacpp-{self.model_id}"
            )
        return self._executor

    async def _ensure_loaded(self) -> Any:
        if self._llm is not None:
            return self._llm
        async with self._load_lock:
            if self._llm is not None:
                return self._llm

            if not self.model_path.exists():
                raise ModelUnavailableError(
                    "GGUF weights not found",
                    model_id=self.model_id,
                    path=str(self.model_path),
                    hint="run: python scripts/fetch_model.py",
                )
            try:
                from llama_cpp import Llama  # imported lazily: optional dependency
            except ImportError as exc:
                raise ModelUnavailableError(
                    "llama-cpp-python is not installed",
                    model_id=self.model_id,
                    hint="pip install llama-cpp-python",
                ) from exc

            log.info(
                "loading_gguf",
                extra={
                    "model_id": self.model_id,
                    "path": str(self.model_path),
                    "n_threads": self.n_threads,
                    "n_ctx": self.context_window,
                },
            )
            loop = asyncio.get_running_loop()
            try:
                self._llm = await loop.run_in_executor(
                    self._ensure_executor(),
                    lambda: Llama(
                        model_path=str(self.model_path),
                        n_ctx=self.context_window,
                        n_threads=self.n_threads,
                        n_gpu_layers=self.n_gpu_layers,
                        verbose=self.verbose,
                        chat_format=None,  # use the GGUF's embedded template
                    ),
                )
            except Exception as exc:  # pragma: no cover - depends on binary
                raise ModelUnavailableError(
                    f"failed to load GGUF: {exc}",
                    model_id=self.model_id,
                    path=str(self.model_path),
                ) from exc
            log.info("gguf_loaded", extra={"model_id": self.model_id})
            return self._llm

    async def close(self) -> None:
        if self._executor is not None:
            self._executor.shutdown(wait=False, cancel_futures=True)
            self._executor = None
        self._llm = None

    # --- inference -----------------------------------------------------------

    def _blocking_generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        llm = self._llm
        return llm.create_chat_completion(**payload)

    def _blocking_complete(self, payload: dict[str, Any]) -> dict[str, Any]:
        llm = self._llm
        return llm.create_completion(**payload)

    @staticmethod
    def _render_chatml(messages: list[dict[str, Any]], prefill: str) -> str:
        """Render ChatML by hand so we can prefill the assistant turn.

        llama-cpp-python 0.3.x exposes no ``chat_template_kwargs``, so the only
        portable way to suppress a Qwen3 `` thinking`` block is to open the
        assistant turn and prefill an empty, already-closed think block. The
        model then continues straight into the answer.
        """
        parts = []
        for message in messages:
            role = message.get("role", "user")
            content = message.get("content", "")
            parts.append(f"<|im_start|>{role}\n{content}<|im_end|>\n")
        parts.append(f"<|im_start|>assistant\n{prefill}")
        return "".join(parts)

    async def generate(self, request: GenerationRequest) -> GenerationResponse:
        await self._ensure_loaded()
        max_tokens, temperature, top_p = self._resolve(
            request, self.default_max_tokens, self.default_temperature, self.default_top_p
        )

        messages = [m.model_dump(exclude_none=True) for m in request.messages]
        stop = list(dict.fromkeys([*self.stop, *request.stop]))

        # Two paths: the normal chat path, and a raw-completion path used only
        # when thinking must be suppressed on a ChatML model.
        use_prefill = not self.enable_thinking and self.chat_format == "chatml"
        if use_prefill:
            payload: dict[str, Any] = {
                "prompt": self._render_chatml(messages, "</think>\n\n"),
                "max_tokens": max_tokens,
                "temperature": temperature,
                "top_p": top_p,
                "stop": list(dict.fromkeys([*stop, "<|im_end|>", "<|im_start|>"])),
            }
            if request.seed is not None:
                payload["seed"] = request.seed
            runner = self._blocking_complete
        else:
            payload = {
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "top_p": top_p,
            }
            if stop:
                payload["stop"] = stop
            if request.seed is not None:
                payload["seed"] = request.seed
            if request.json_mode:
                payload["response_format"] = {"type": "json_object"}
            runner = self._blocking_generate

        start = self._timer()
        loop = asyncio.get_running_loop()
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(self._ensure_executor(), runner, payload),
                timeout=self.timeout_s,
            )
        except TimeoutError as exc:
            raise ModelTimeoutError(
                f"generation exceeded {self.timeout_s}s",
                model_id=self.model_id,
                timeout_s=self.timeout_s,
            ) from exc
        except Exception as exc:
            raise ModelResponseError(
                f"llama.cpp generation failed: {exc}", model_id=self.model_id
            ) from exc

        latency = self._elapsed_ms(start)
        try:
            choice = result["choices"][0]
            if use_prefill:
                text = choice.get("text") or ""
            else:
                text = (choice.get("message") or {}).get("content") or ""
            finish = choice.get("finish_reason") or "stop"
        except (KeyError, IndexError, TypeError) as exc:
            raise ModelResponseError(
                "unexpected llama.cpp response shape",
                model_id=self.model_id,
                keys=list(result) if isinstance(result, dict) else str(type(result)),
            ) from exc

        usage_raw = result.get("usage") or {}
        return GenerationResponse(
            text=text,
            model_id=self.model_id,
            usage=Usage.from_counts(
                usage_raw.get("prompt_tokens"), usage_raw.get("completion_tokens")
            ),
            finish_reason=finish,
            latency_ms=latency,
            backend=self.backend,
            raw={"id": result.get("id"), "model": result.get("model")},
        )

    async def health(self) -> HealthStatus:
        start = self._timer()
        try:
            await self._ensure_loaded()
            return HealthStatus(
                ok=True,
                model_id=self.model_id,
                backend=self.backend,
                detail=f"loaded {self.model_path.name}",
                loaded=True,
                context_window=self.context_window,
                latency_ms=self._elapsed_ms(start),
            )
        except Exception as exc:  # noqa: BLE001 - a health check must never raise
            return HealthStatus(
                ok=False,
                model_id=self.model_id,
                backend=self.backend,
                detail=str(exc),
                loaded=False,
                context_window=self.context_window,
                latency_ms=self._elapsed_ms(start),
            )
