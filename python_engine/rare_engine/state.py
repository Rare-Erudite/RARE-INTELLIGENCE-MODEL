"""Typed task state and durable persistence.

Design
------
A task is a *value object* (:class:`TaskState`) plus an append-only list of
:class:`StepRecord` entries. The orchestrator mutates the object in memory and
calls :meth:`TaskStore.save` after every step, so a crash loses at most one
step of work.

Persistence is plain JSON on disk - one file per task, plus an index. That is
deliberate:

* it is inspectable with ``cat`` and diffable in Git;
* it needs no server, no migration tool and no native dependency;
* atomic replacement (``os.replace`` on a temp file in the same directory)
  gives crash safety on POSIX without a database.

SQLite is listed in ROADMAP.md as the upgrade path once concurrent writers
exist. Today there is exactly one writer per task, so JSON is the honest
choice rather than premature complexity.

Schema versioning
-----------------
Every file carries ``schema_version``. :meth:`TaskStore.load` refuses to read a
newer schema than it understands instead of silently misinterpreting fields.
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator

from .errors import SchemaVersionError, StateError, TaskNotFoundError
from .logging import get_logger

log = get_logger("state")

SCHEMA_VERSION = 1


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_task_id() -> str:
    return f"task_{uuid.uuid4().hex[:12]}"


def new_step_id(index: int) -> str:
    return f"step_{index:03d}"


class TaskStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"

    @property
    def terminal(self) -> bool:
        return self in {
            TaskStatus.SUCCEEDED,
            TaskStatus.FAILED,
            TaskStatus.CANCELLED,
            TaskStatus.TIMED_OUT,
        }


class StepRecord(BaseModel):
    """One plan/act/observe cycle, recorded verbatim."""

    step_id: str
    index: int
    thought: str = ""
    action: str = ""
    action_input: dict[str, Any] = Field(default_factory=dict)
    observation: str = ""
    ok: bool = True
    error: str | None = None
    error_code: str | None = None
    latency_ms: float = 0.0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    started_at: datetime = Field(default_factory=utcnow)
    finished_at: datetime | None = None

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class TaskState(BaseModel):
    """The complete, serialisable state of one task."""

    schema_version: int = SCHEMA_VERSION
    task_id: str = Field(default_factory=new_task_id)
    goal: str
    status: TaskStatus = TaskStatus.PENDING
    model_id: str = ""
    run_id: str | None = None

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    finished_at: datetime | None = None

    steps: list[StepRecord] = Field(default_factory=list)
    result: str | None = None
    last_error: str | None = None
    last_error_code: str | None = None

    # Budget accounting, incremented as the run proceeds.
    model_calls: int = 0
    tool_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0

    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("goal")
    @classmethod
    def _goal_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("goal must not be blank")
        return v.strip()

    # --- derived -------------------------------------------------------------

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    @property
    def step_count(self) -> int:
        return len(self.steps)

    @property
    def duration_s(self) -> float:
        end = self.finished_at or utcnow()
        return round((end - self.created_at).total_seconds(), 3)

    def touch(self) -> None:
        self.updated_at = utcnow()

    def add_step(self, step: StepRecord) -> None:
        self.steps.append(step)
        self.model_calls += 1
        self.prompt_tokens += step.prompt_tokens
        self.completion_tokens += step.completion_tokens
        if step.action and step.action != "finish":
            self.tool_calls += 1
        self.touch()

    def mark_running(self) -> None:
        self.status = TaskStatus.RUNNING
        self.touch()

    def mark_succeeded(self, result: str) -> None:
        self.status = TaskStatus.SUCCEEDED
        self.result = result
        self.finished_at = utcnow()
        self.touch()

    def mark_failed(self, error: str, code: str = "error") -> None:
        self.status = TaskStatus.FAILED
        self.last_error = error
        self.last_error_code = code
        self.finished_at = utcnow()
        self.touch()

    def mark_timed_out(self, error: str) -> None:
        self.status = TaskStatus.TIMED_OUT
        self.last_error = error
        self.last_error_code = "task_timeout"
        self.finished_at = utcnow()
        self.touch()

    def summary(self) -> dict[str, Any]:
        """Compact view for CLI output and the index file."""
        return {
            "task_id": self.task_id,
            "goal": self.goal,
            "status": self.status.value,
            "model_id": self.model_id,
            "steps": self.step_count,
            "tokens": self.total_tokens,
            "duration_s": self.duration_s,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "last_error": self.last_error,
        }


class TaskStore:
    """Filesystem-backed task repository.

    Layout::

        <root>/
          index.json          # list of task summaries, newest first
          tasks/
            task_ab12cd34ef56.json
    """

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.tasks_dir = self.root / "tasks"
        self.index_path = self.root / "index.json"

    # --- lifecycle -----------------------------------------------------------

    def init(self) -> TaskStore:
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        if not self.index_path.exists():
            self._write_json(self.index_path, {"schema_version": SCHEMA_VERSION, "tasks": []})
        return self

    def _path_for(self, task_id: str) -> Path:
        if not task_id or "/" in task_id or "\\" in task_id or ".." in task_id:
            raise StateError(f"invalid task id: {task_id!r}")
        return self.tasks_dir / f"{task_id}.json"

    # --- atomic IO -----------------------------------------------------------

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        """Write JSON atomically: temp file in the same dir, then os.replace."""
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2, ensure_ascii=False, default=str)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_name, path)
        except BaseException:
            with contextlib_suppress():
                os.unlink(tmp_name)
            raise

    # --- CRUD ----------------------------------------------------------------

    def save(self, state: TaskState) -> Path:
        self.init()
        state.touch()
        path = self._path_for(state.task_id)
        self._write_json(path, state.model_dump(mode="json"))
        self._update_index(state)
        log.debug("task_saved", extra={"task_id": state.task_id, "status": state.status.value})
        return path

    def load(self, task_id: str) -> TaskState:
        path = self._path_for(task_id)
        if not path.exists():
            raise TaskNotFoundError(f"no such task: {task_id}", task_id=task_id)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise StateError(f"corrupt task file {path}: {exc}", task_id=task_id) from exc

        version = int(raw.get("schema_version", 0))
        if version > SCHEMA_VERSION:
            raise SchemaVersionError(
                f"task file schema v{version} is newer than supported v{SCHEMA_VERSION}",
                task_id=task_id,
            )
        try:
            return TaskState(**raw)
        except Exception as exc:
            raise StateError(f"invalid task file {path}: {exc}", task_id=task_id) from exc

    def exists(self, task_id: str) -> bool:
        return self._path_for(task_id).exists()

    def delete(self, task_id: str) -> None:
        path = self._path_for(task_id)
        if path.exists():
            path.unlink()
        self._rewrite_index([t for t in self._read_index() if t.get("task_id") != task_id])

    def list(self, limit: int | None = None) -> list[dict[str, Any]]:
        items = self._read_index()
        return items[:limit] if limit else items

    def iter_states(self) -> Iterator[TaskState]:
        for item in self._read_index():
            tid = item.get("task_id")
            if tid and self.exists(tid):
                yield self.load(tid)

    # --- index ---------------------------------------------------------------

    def _read_index(self) -> list[dict[str, Any]]:
        if not self.index_path.exists():
            return []
        try:
            data = json.loads(self.index_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("index_corrupt_rebuilding")
            return self._rebuild_index()
        return list(data.get("tasks", []))

    def _rewrite_index(self, tasks: list[dict[str, Any]]) -> None:
        self._write_json(
            self.index_path, {"schema_version": SCHEMA_VERSION, "tasks": tasks}
        )

    def _update_index(self, state: TaskState) -> None:
        items = [t for t in self._read_index() if t.get("task_id") != state.task_id]
        items.insert(0, state.summary())
        self._rewrite_index(items)

    def _rebuild_index(self) -> list[dict[str, Any]]:
        """Recover the index from the task files themselves."""
        items: list[dict[str, Any]] = []
        for path in sorted(self.tasks_dir.glob("task_*.json")):
            try:
                state = TaskState(**json.loads(path.read_text(encoding="utf-8")))
                items.append(state.summary())
            except (ValueError, TypeError, OSError) as exc:  # pragma: no cover - defensive
                log.warning(
                    "index_rebuild_skip", extra={"path": str(path), "error": str(exc)}
                )
        items.sort(key=lambda t: t.get("created_at", ""), reverse=True)
        self._rewrite_index(items)
        return items


class contextlib_suppress:
    """Tiny local stand-in so this module has no import cycle with contextlib."""

    def __enter__(self) -> None:
        return None

    def __exit__(self, *exc: object) -> bool:
        return True
