"""Structured logging.

Two formats, one API:

* ``json``  - one JSON object per line. This is the production format: every
  record carries ``ts``, ``level``, ``logger``, ``event``, ``run_id``,
  ``task_id`` and ``step_id`` so a run can be reconstructed from logs alone.
* ``text``  - human-readable, for local development.

Correlation IDs live in a :class:`contextvars.ContextVar`, so they propagate
through ``asyncio`` tasks and threads without being threaded through every
function signature.
"""

from __future__ import annotations

import contextlib
import contextvars
import json
import logging
import os
import sys
import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

# --- Correlation context -----------------------------------------------------

_run_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("rare_run_id", default=None)
_task_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("rare_task_id", default=None)
_step_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("rare_step_id", default=None)


def new_run_id() -> str:
    return f"run_{uuid.uuid4().hex[:12]}"


@contextlib.contextmanager
def bind_run(run_id: str | None = None) -> Iterator[str]:
    """Bind a run id for the duration of the block."""
    rid = run_id or new_run_id()
    token = _run_id.set(rid)
    try:
        yield rid
    finally:
        _run_id.reset(token)


@contextlib.contextmanager
def bind_task(task_id: str | None) -> Iterator[str | None]:
    token = _task_id.set(task_id)
    try:
        yield task_id
    finally:
        _task_id.reset(token)


@contextlib.contextmanager
def bind_step(step_id: str | None) -> Iterator[str | None]:
    token = _step_id.set(step_id)
    try:
        yield step_id
    finally:
        _step_id.reset(token)


def current_ids() -> dict[str, str | None]:
    return {
        "run_id": _run_id.get(),
        "task_id": _task_id.get(),
        "step_id": _step_id.get(),
    }


# --- Formatters --------------------------------------------------------------

_RESERVED = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "taskName", "message", "asctime",
}


class JsonFormatter(logging.Formatter):
    """Emit one JSON object per line, including correlation ids and extras."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        payload.update({k: v for k, v in current_ids().items() if v})

        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            if key in payload:
                continue
            try:
                json.dumps(value)
                payload[key] = value
            except (TypeError, ValueError):
                payload[key] = repr(value)

        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False, default=str)


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ids = current_ids()
        prefix = " ".join(f"{k.split('_')[0]}={v}" for k, v in ids.items() if v)
        base = f"{time.strftime('%H:%M:%S', time.localtime(record.created))} " \
               f"{record.levelname:<7} {record.name:<28}"
        if prefix:
            base += f" [{prefix}]"
        line = f"{base} {record.getMessage()}"
        extras = {
            k: v for k, v in record.__dict__.items()
            if k not in _RESERVED and not k.startswith("_")
        }
        if extras:
            line += " " + " ".join(f"{k}={v!r}" for k, v in extras.items())
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


# --- Setup -------------------------------------------------------------------

_CONFIGURED = False


def setup_logging(
    level: str | int = "INFO",
    fmt: str = "json",
    log_file: str | Path | None = None,
    force: bool = False,
) -> None:
    """Configure the root ``rare`` logger. Idempotent unless ``force``."""
    global _CONFIGURED
    if _CONFIGURED and not force:
        return

    root = logging.getLogger("rare")
    root.setLevel(level if isinstance(level, int) else getattr(logging, str(level).upper(), logging.INFO))
    root.handlers.clear()
    root.propagate = False

    formatter: logging.Formatter = JsonFormatter() if fmt == "json" else TextFormatter()

    stream = logging.StreamHandler(sys.stderr)
    stream.setFormatter(formatter)
    root.addHandler(stream)

    if log_file:
        path = Path(log_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(path, encoding="utf-8")
        fh.setFormatter(JsonFormatter())
        root.addHandler(fh)

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """Return a namespaced logger, e.g. ``get_logger("orchestrator")``."""
    if not name.startswith("rare"):
        name = f"rare.{name}"
    return logging.getLogger(name)


def log_event(logger: logging.Logger, event: str, level: int = logging.INFO, **fields: Any) -> None:
    """Log a structured event with arbitrary fields."""
    logger.log(level, event, extra=fields)


def env_log_config() -> tuple[str, str]:
    return (
        os.environ.get("RARE_LOG_LEVEL", "INFO"),
        os.environ.get("RARE_LOG_FORMAT", "json"),
    )
