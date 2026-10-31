"""Tests for ``Orchestrator.resume`` / ``rare resume``.

The contract under test:

* a task that stopped mid-way continues from the *next* step index;
* steps already recorded are never re-executed, so a tool side effect that
  already happened does not happen twice;
* prior observations are still visible to the model as history;
* a state that cannot be safely continued is refused *before* any model or
  tool call, with a message naming the failed invariant;
* a corrupted file is reported as a state error, not a crash.
"""

from __future__ import annotations

import json

import pytest

from rare_engine.errors import (
    StateError,
    TaskNotFoundError,
    TaskNotResumableError,
)
from rare_engine.orchestrator import Orchestrator
from rare_engine.state import StepRecord, TaskState, TaskStatus, TaskStore, utcnow
from rare_engine.tools import build_registry


def _action(action: str, **kwargs) -> str:
    return json.dumps({"thought": "t", "action": action, "action_input": kwargs})


def _finish(result: str) -> str:
    return _action("finish", result=result)


def _orch(config, adapter, store=None) -> Orchestrator:
    registry = build_registry(config)
    return Orchestrator(config, adapter, registry, store or TaskStore(config.state_path))


# --- happy path --------------------------------------------------------------


async def test_resume_continues_from_next_step(config, scripted):
    """A task stopped after step 1 resumes at step 2 and finishes."""
    store = TaskStore(config.state_path).init()
    orch = _orch(config, scripted([_action("list_files", path="."), _finish("done")]), store)

    # First run: budget of 1 step, so it stops after one tool call.
    config.orchestrator.max_steps = 1
    first = await orch.run("list the sandbox")
    assert first.status == TaskStatus.FAILED
    assert first.error_code == "budget_exhausted"
    assert first.steps == 1

    # Second run: raise the budget and resume.
    config.orchestrator.max_steps = 6
    adapter2 = scripted([_finish("done")])
    orch2 = _orch(config, adapter2, store)
    second = await orch2.resume(first.task_id)

    assert second.status == TaskStatus.SUCCEEDED
    assert second.result == "done"
    assert second.resumed_from_step == 2
    assert second.steps == 2  # step 1 preserved, step 2 appended
    assert adapter2.calls == 1  # only the new step called the model


async def test_resume_preserves_prior_observations(config, scripted):
    """The model sees what it already did, not a blank slate."""
    store = TaskStore(config.state_path).init()
    config.orchestrator.max_steps = 1
    orch = _orch(config, scripted([_action("list_files", path=".")]), store)
    first = await orch.run("inspect")

    config.orchestrator.max_steps = 6
    adapter2 = scripted([_finish("ok")])
    await _orch(config, adapter2, store).resume(first.task_id)

    prompt = adapter2.requests[0].messages[-1].content
    assert "list_files" in prompt, "prior action must appear in the replayed history"
    assert "Step 1" in prompt


async def test_resume_does_not_repeat_side_effects(config, scripted, sandbox):
    """A write that already happened is not performed a second time."""
    store = TaskStore(config.state_path).init()
    config.orchestrator.max_steps = 1
    orch = _orch(
        config,
        scripted([_action("write_file", path="once.txt", content="hello")]),
        store,
    )
    first = await orch.run("write a file")
    target = sandbox / "once.txt"
    assert target.exists()
    mtime_after_first = target.stat().st_mtime_ns

    config.orchestrator.max_steps = 6
    adapter2 = scripted([_finish("done")])
    second = await _orch(config, adapter2, store).resume(first.task_id)

    assert second.status == TaskStatus.SUCCEEDED
    # The file was not rewritten: same mtime, and the model was never asked
    # to write again (only one new model call, for the finish step).
    assert target.stat().st_mtime_ns == mtime_after_first
    assert adapter2.calls == 1
    assert target.read_text() == "hello"


async def test_resume_after_failure_clears_error(config, scripted):
    """Resuming a failed task clears the stale error on success."""
    store = TaskStore(config.state_path).init()
    config.orchestrator.max_steps = 1
    orch = _orch(config, scripted([_action("list_files", path=".")]), store)
    first = await orch.run("x")
    assert first.error is not None

    config.orchestrator.max_steps = 6
    second = await _orch(config, scripted([_finish("recovered")]), store).resume(first.task_id)
    assert second.status == TaskStatus.SUCCEEDED
    assert second.error is None
    assert second.state.last_error is None


# --- refusals ----------------------------------------------------------------


async def test_resume_refuses_succeeded_task(config, scripted):
    store = TaskStore(config.state_path).init()
    orch = _orch(config, scripted([_finish("done")]), store)
    done = await orch.run("x")
    assert done.status == TaskStatus.SUCCEEDED

    with pytest.raises(TaskNotResumableError) as exc:
        await _orch(config, scripted([]), store).resume(done.task_id)
    assert "already succeeded" in exc.value.message


async def test_resume_refuses_missing_task(config, scripted):
    store = TaskStore(config.state_path).init()
    with pytest.raises(TaskNotFoundError):
        await _orch(config, scripted([]), store).resume("task_doesnotexist")


async def test_resume_refuses_exhausted_step_budget(config, scripted):
    """At max_steps the task cannot continue without a config change."""
    store = TaskStore(config.state_path).init()
    config.orchestrator.max_steps = 1
    orch = _orch(config, scripted([_action("list_files", path=".")]), store)
    first = await orch.run("x")

    # Budget still 1 -> refuse, and say so precisely.
    with pytest.raises(TaskNotResumableError) as exc:
        await _orch(config, scripted([]), store).resume(first.task_id)
    assert "max_steps" in exc.value.message


async def test_resume_refuses_exhausted_model_budget(config, scripted):
    store = TaskStore(config.state_path).init()
    config.orchestrator.max_steps = 1
    orch = _orch(config, scripted([_action("list_files", path=".")]), store)
    first = await orch.run("x")

    config.orchestrator.max_steps = 6
    config.orchestrator.max_model_calls = 1  # already used by step 1
    with pytest.raises(TaskNotResumableError) as exc:
        await _orch(config, scripted([]), store).resume(first.task_id)
    assert "model call budget" in exc.value.message


async def test_resume_refuses_exhausted_tool_budget(config, scripted):
    store = TaskStore(config.state_path).init()
    config.orchestrator.max_steps = 1
    orch = _orch(config, scripted([_action("list_files", path=".")]), store)
    first = await orch.run("x")

    config.orchestrator.max_steps = 6
    config.orchestrator.max_tool_calls = 1
    with pytest.raises(TaskNotResumableError) as exc:
        await _orch(config, scripted([]), store).resume(first.task_id)
    assert "tool call budget" in exc.value.message


async def test_resume_refuses_unfinished_step(config, scripted):
    """A step with no finished_at means the process died mid-step."""
    store = TaskStore(config.state_path).init()
    state = TaskState(goal="crashed", model_id="echo", status=TaskStatus.RUNNING)
    state.steps.append(StepRecord(step_id="step_001", index=1, action="list_files"))
    # finished_at deliberately left None
    store.save(state)

    with pytest.raises(TaskNotResumableError) as exc:
        await _orch(config, scripted([]), store).resume(state.task_id)
    assert "unfinished step" in exc.value.message


async def test_tool_side_effect_is_checkpointed_before_it_runs(config, scripted, sandbox):
    """A crash after a tool effect must leave an unfinished step that cannot replay."""
    store = TaskStore(config.state_path).init()
    registry = build_registry(config)
    real_call = registry.call
    target = sandbox / "crash-window.txt"

    async def write_then_crash(name, action_input):
        await real_call(name, action_input)
        raise RuntimeError("simulated process interruption after tool call")

    registry.call = write_then_crash
    orch = Orchestrator(
        config,
        scripted([_action("write_file", path="crash-window.txt", content="once")]),
        registry,
        store,
    )
    first = await orch.run("write one file")

    assert first.status == TaskStatus.FAILED
    assert target.read_text() == "once"
    saved = store.load(first.task_id)
    assert saved.steps[-1].finished_at is None

    adapter2 = scripted([])
    with pytest.raises(TaskNotResumableError, match="unfinished step"):
        await _orch(config, adapter2, store).resume(first.task_id)
    assert adapter2.calls == 0
    assert target.read_text() == "once"


async def test_failed_action_checkpoint_prevents_tool_side_effect(config, scripted, sandbox):
    store = TaskStore(config.state_path).init()
    real_save = store.save
    checkpoint_failed = False
    target = sandbox / "must-not-exist.txt"

    def fail_action_checkpoint(state):
        nonlocal checkpoint_failed
        if state.step_count and not checkpoint_failed:
            checkpoint_failed = True
            raise OSError("simulated task-store write failure")
        real_save(state)

    store.save = fail_action_checkpoint
    adapter = scripted([_action("write_file", path="must-not-exist.txt", content="unsafe")])
    result = await _orch(config, adapter, store).run("write one file")

    assert checkpoint_failed
    assert result.status == TaskStatus.FAILED
    assert not target.exists()
    assert store.load(result.task_id).steps[-1].finished_at is None


async def test_resume_refuses_non_contiguous_steps(config, scripted):
    """A gap in step indices means work was lost; refuse rather than skip."""
    store = TaskStore(config.state_path).init()
    state = TaskState(goal="gappy", model_id="echo", status=TaskStatus.FAILED)
    state.steps.append(StepRecord(step_id="step_001", index=1, action="list_files",
                                  finished_at=utcnow()))
    state.steps.append(StepRecord(step_id="step_003", index=3, action="list_files",
                                  finished_at=utcnow()))
    store.save(state)

    with pytest.raises(TaskNotResumableError) as exc:
        await _orch(config, scripted([]), store).resume(state.task_id)
    assert "non-contiguous" in exc.value.message


async def test_refused_resume_has_no_side_effect(config, scripted):
    """A refused resume must not call the model or mutate the task file."""
    store = TaskStore(config.state_path).init()
    orch = _orch(config, scripted([_finish("done")]), store)
    done = await orch.run("x")
    before = (store.tasks_dir / f"{done.task_id}.json").read_text()

    adapter = scripted([])
    with pytest.raises(TaskNotResumableError):
        await _orch(config, adapter, store).resume(done.task_id)

    assert adapter.calls == 0, "refusal must happen before any model call"
    after = (store.tasks_dir / f"{done.task_id}.json").read_text()
    assert before == after, "refusal must not rewrite the task file"


# --- corrupted state ---------------------------------------------------------


async def test_resume_reports_corrupt_json(config, scripted):
    store = TaskStore(config.state_path).init()
    path = store.tasks_dir / "task_corrupt00001.json"
    path.write_text("{not valid json", encoding="utf-8")

    with pytest.raises(StateError) as exc:
        await _orch(config, scripted([]), store).resume("task_corrupt00001")
    assert "corrupt" in exc.value.message.lower()


async def test_resume_reports_invalid_schema(config, scripted):
    store = TaskStore(config.state_path).init()
    path = store.tasks_dir / "task_badschema001.json"
    path.write_text(json.dumps({"schema_version": 1, "goal": ""}), encoding="utf-8")

    with pytest.raises(StateError):
        await _orch(config, scripted([]), store).resume("task_badschema001")


async def test_resume_reports_future_schema(config, scripted):
    from rare_engine.errors import SchemaVersionError

    store = TaskStore(config.state_path).init()
    path = store.tasks_dir / "task_future000001.json"
    path.write_text(
        json.dumps({"schema_version": 99, "goal": "from the future"}), encoding="utf-8"
    )

    with pytest.raises(SchemaVersionError):
        await _orch(config, scripted([]), store).resume("task_future000001")


# --- CLI ---------------------------------------------------------------------


def test_cli_resume_unknown_task_exits_2(config, tmp_path, monkeypatch):
    """`rare resume <missing>` exits 2 with a clear message, not a traceback."""
    from typer.testing import CliRunner

    from rare_engine import cli as cli_mod

    cfg_path = tmp_path / "cfg.yaml"
    cfg_path.write_text(
        f"""
env: test
state_dir: {tmp_path / "state"}
default_model: echo
models:
  echo:
    id: echo
    adapter: echo
    model_ref: echo
tools:
  sandbox_root: {tmp_path / "sandbox"}
""",
        encoding="utf-8",
    )

    runner = CliRunner()
    result = runner.invoke(cli_mod.app, ["resume", "task_missing0001", "-c", str(cfg_path)])
    assert result.exit_code == 2
    assert "no such task" in result.stdout.lower()
