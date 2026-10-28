"""Typed error hierarchy.

Every failure the engine can produce is a subclass of :class:`RareError`, so
callers can distinguish *engine* failures from programming errors. Each error
carries a stable machine-readable ``code`` used in structured logs and in
``TaskState.last_error``.
"""

from __future__ import annotations

from typing import Any


class RareError(Exception):
    """Base class for all engine errors."""

    code: str = "rare_error"
    retryable: bool = False

    def __init__(self, message: str, **context: Any) -> None:
        super().__init__(message)
        self.message = message
        self.context: dict[str, Any] = context

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "context": self.context,
        }

    def __str__(self) -> str:  # pragma: no cover - trivial
        if not self.context:
            return f"[{self.code}] {self.message}"
        return f"[{self.code}] {self.message} ({self.context})"


# --- Configuration -----------------------------------------------------------


class ConfigError(RareError):
    code = "config_error"


class ModelNotFoundError(ConfigError):
    code = "model_not_found"


# --- Model layer -------------------------------------------------------------


class ModelError(RareError):
    code = "model_error"


class ModelUnavailableError(ModelError):
    """The adapter cannot serve requests (missing weights, missing runtime)."""

    code = "model_unavailable"


class ModelTimeoutError(ModelError):
    code = "model_timeout"
    retryable = True


class ModelResponseError(ModelError):
    """The model returned something structurally unusable."""

    code = "model_response_error"
    retryable = True


# --- State -------------------------------------------------------------------


class StateError(RareError):
    code = "state_error"


class SchemaVersionError(StateError):
    code = "schema_version_error"


class TaskNotFoundError(StateError):
    code = "task_not_found"


# --- Tools -------------------------------------------------------------------


class ToolError(RareError):
    code = "tool_error"


class ToolNotFoundError(ToolError):
    code = "tool_not_found"


class ToolPermissionError(ToolError):
    code = "tool_permission_denied"


class ToolTimeoutError(ToolError):
    code = "tool_timeout"
    retryable = True


class SandboxViolationError(ToolError):
    """A path or command escaped the configured sandbox."""

    code = "sandbox_violation"


# --- Protocol ----------------------------------------------------------------


class ProtocolError(RareError):
    """The model's output did not satisfy the action protocol."""

    code = "protocol_error"
    retryable = True


# --- Orchestration -----------------------------------------------------------


class OrchestrationError(RareError):
    code = "orchestration_error"


class TaskCancelledError(OrchestrationError):
    code = "task_cancelled"


class TaskTimeoutError(OrchestrationError):
    code = "task_timeout"


class StepFailedError(OrchestrationError):
    code = "step_failed"


class BudgetExhaustedError(OrchestrationError):
    code = "budget_exhausted"


class TaskNotResumableError(OrchestrationError):
    """The persisted task cannot be safely continued.

    Raised *before* any model or tool call, so a refused resume never has a
    side effect. The message always states which invariant failed.
    """

    code = "task_not_resumable"
