"""Task state and persistence tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from rare_engine.errors import SchemaVersionError, StateError, TaskNotFoundError
from rare_engine.state import (
    SCHEMA_VERSION,
    StepRecord,
    TaskState,
    TaskStatus,
    TaskStore,
)


def _state(goal: str = "do a thing") -> TaskState:
    return TaskState(goal=goal, model_id="echo")


def test_blank_goal_rejected():
    with pytest.raises(ValidationError):
        TaskState(goal="   ")


def test_goal_is_stripped():
    assert TaskState(goal="  hello  ").goal == "hello"


def test_task_ids_are_unique():
    assert _state().task_id != _state().task_id


def test_status_terminal_flags():
    assert TaskStatus.SUCCEEDED.terminal
    assert TaskStatus.FAILED.terminal
    assert TaskStatus.TIMED_OUT.terminal
    assert not TaskStatus.RUNNING.terminal
    assert not TaskStatus.PENDING.terminal


def test_roundtrip_persists_every_field(tmp_path: Path):
    store = TaskStore(tmp_path / "s").init()
    state = _state("roundtrip")
    state.mark_running()
    state.add_step(
        StepRecord(
            step_id="step_001", index=1, thought="t", action="read_file",
            action_input={"path": "a.txt"}, observation="contents",
            prompt_tokens=10, completion_tokens=5,
        )
    )
    state.mark_succeeded("all good")
    store.save(state)

    loaded = store.load(state.task_id)
    assert loaded.goal == "roundtrip"
    assert loaded.status == TaskStatus.SUCCEEDED
    assert loaded.result == "all good"
    assert len(loaded.steps) == 1
    assert loaded.steps[0].action_input == {"path": "a.txt"}
    assert loaded.prompt_tokens == 10


def test_save_is_atomic_leaves_no_temp_files(tmp_path: Path):
    store = TaskStore(tmp_path / "s").init()
    state = _state()
    store.save(state)
    store.save(state)  # save twice to prove overwrite works
    leftovers = [p.name for p in store.tasks_dir.iterdir() if p.name.startswith(".tmp-")]
    assert leftovers == []


def test_load_missing_task_raises(tmp_path: Path):
    store = TaskStore(tmp_path / "s").init()
    with pytest.raises(TaskNotFoundError):
        store.load("task_doesnotexist")


def test_newer_schema_is_refused(tmp_path: Path):
    store = TaskStore(tmp_path / "s").init()
    state = _state()
    store.save(state)
    path = store.tasks_dir / f"{state.task_id}.json"
    raw = json.loads(path.read_text())
    raw["schema_version"] = SCHEMA_VERSION + 1
    path.write_text(json.dumps(raw))
    with pytest.raises(SchemaVersionError):
        store.load(state.task_id)


def test_corrupt_file_raises_state_error(tmp_path: Path):
    store = TaskStore(tmp_path / "s").init()
    state = _state()
    store.save(state)
    (store.tasks_dir / f"{state.task_id}.json").write_text("{not json")
    with pytest.raises(StateError):
        store.load(state.task_id)


def test_path_traversal_in_task_id_rejected(tmp_path: Path):
    store = TaskStore(tmp_path / "s").init()
    with pytest.raises(StateError):
        store.load("../../etc/passwd")


def test_index_updated_and_ordered(tmp_path: Path):
    store = TaskStore(tmp_path / "s").init()
    first = _state("first")
    store.save(first)
    second = _state("second")
    store.save(second)

    items = store.list()
    assert [i["goal"] for i in items] == ["second", "first"]
    assert items[0]["task_id"] == second.task_id


def test_list_limit(tmp_path: Path):
    store = TaskStore(tmp_path / "s").init()
    for i in range(5):
        store.save(_state(f"goal {i}"))
    assert len(store.list(limit=2)) == 2


def test_index_rebuilds_from_task_files(tmp_path: Path):
    store = TaskStore(tmp_path / "s").init()
    store.save(_state("a"))
    store.save(_state("b"))
    store.index_path.write_text("corrupt!")
    items = store.list()
    assert len(items) == 2


def test_delete_removes_file_and_index_entry(tmp_path: Path):
    store = TaskStore(tmp_path / "s").init()
    state = _state("to delete")
    store.save(state)
    assert store.exists(state.task_id)
    store.delete(state.task_id)
    assert not store.exists(state.task_id)
    assert store.list() == []


def test_token_accounting_accumulates(tmp_path: Path):
    state = _state()
    state.add_step(StepRecord(step_id="s1", index=1, action="a", prompt_tokens=7, completion_tokens=3))
    state.add_step(StepRecord(step_id="s2", index=2, action="finish", prompt_tokens=5, completion_tokens=2))
    assert state.prompt_tokens == 12
    assert state.completion_tokens == 5
    assert state.total_tokens == 17
    # 'finish' is not a tool call; 'a' is
    assert state.tool_calls == 1
    assert state.model_calls == 2


def test_mark_failed_records_code():
    state = _state()
    state.mark_failed("boom", code="budget_exhausted")
    assert state.status == TaskStatus.FAILED
    assert state.last_error_code == "budget_exhausted"
    assert state.finished_at is not None


def test_summary_shape(tmp_path: Path):
    state = _state("summarise me")
    s = state.summary()
    for key in ("task_id", "goal", "status", "steps", "tokens", "duration_s"):
        assert key in s
    assert s["status"] == "pending"
