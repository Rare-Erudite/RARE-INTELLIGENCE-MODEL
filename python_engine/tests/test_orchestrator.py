"""Orchestrator tests - the loop, budgets, repair and failure paths.

These use ScriptedAdapter, so they are deterministic and need no weights.
"""

from __future__ import annotations

import json

import pytest
from conftest import ScriptedAdapter

from rare_engine.config import EngineConfig
from rare_engine.errors import ModelError
from rare_engine.models.base import (
    GenerationRequest,
    GenerationResponse,
    HealthStatus,
    ModelAdapter,
)
from rare_engine.orchestrator import Orchestrator
from rare_engine.state import TaskStatus, TaskStore
from rare_engine.tools import ToolRegistry


def _orch(config: EngineConfig, adapter: ModelAdapter) -> Orchestrator:
    registry = ToolRegistry(sandbox_root=config.sandbox_path)
    store = TaskStore(config.state_path).init()
    return Orchestrator(config, adapter, registry, store)


def _action(action: str, **kwargs) -> str:
    return json.dumps({"thought": "t", "action": action, "action_input": kwargs})


@pytest.mark.asyncio
async def test_single_finish_succeeds(config: EngineConfig):
    adapter = ScriptedAdapter([_action("finish", result="done!")])
    result = await _orch(config, adapter).run("say done")

    assert result.ok
    assert result.status == TaskStatus.SUCCEEDED
    assert result.result == "done!"
    assert result.steps == 1
    assert adapter.calls == 1


@pytest.mark.asyncio
async def test_write_then_finish_end_to_end(config: EngineConfig):
    adapter = ScriptedAdapter(
        [
            _action("write_file", path="out.txt", content="RARE online"),
            _action("read_file", path="out.txt"),
            _action("finish", result="RARE online"),
        ]
    )
    result = await _orch(config, adapter).run("write and read a file")

    assert result.ok
    assert result.steps == 3
    assert (config.sandbox_path / "out.txt").read_text() == "RARE online"
    # The read observation must have been fed back into the next prompt.
    third_prompt = adapter.requests[2].messages[-1].content
    assert "RARE online" in third_prompt


@pytest.mark.asyncio
async def test_state_is_persisted_and_reloadable(config: EngineConfig):
    adapter = ScriptedAdapter([_action("finish", result="persisted")])
    orch = _orch(config, adapter)
    result = await orch.run("persist me")

    reloaded = orch.store.load(result.task_id)
    assert reloaded.status == TaskStatus.SUCCEEDED
    assert reloaded.result == "persisted"
    assert reloaded.step_count == 1
    assert reloaded.run_id is not None


@pytest.mark.asyncio
async def test_protocol_error_is_fed_back_and_recovered(config: EngineConfig):
    adapter = ScriptedAdapter(
        [
            "I think I should read the file.",          # unparseable
            _action("finish", result="recovered"),      # corrected
        ]
    )
    result = await _orch(config, adapter).run("recover from bad output")

    assert result.ok
    assert result.result == "recovered"
    assert result.steps == 2
    assert result.state.steps[0].ok is False
    assert result.state.steps[0].error_code == "protocol_error"
    # The retry prompt must tell the model its reply was rejected.
    assert "REJECTED" in adapter.requests[1].messages[-1].content


@pytest.mark.asyncio
async def test_tool_error_is_observed_not_fatal(config: EngineConfig):
    adapter = ScriptedAdapter(
        [
            _action("read_file", path="missing.txt"),
            _action("finish", result="gave up gracefully"),
        ]
    )
    result = await _orch(config, adapter).run("read a missing file")

    assert result.ok
    assert result.state.steps[0].ok is False
    assert "ERROR" in result.state.steps[0].observation


@pytest.mark.asyncio
async def test_unknown_tool_is_observed(config: EngineConfig):
    adapter = ScriptedAdapter(
        [_action("teleport", x=1), _action("finish", result="ok")]
    )
    result = await _orch(config, adapter).run("use a fake tool")
    assert result.state.steps[0].error_code == "tool_not_found"


@pytest.mark.asyncio
async def test_max_steps_exhaustion_fails_cleanly(config: EngineConfig):
    # Always list_dir, never finish -> must hit max_steps (6 in fixture).
    adapter = ScriptedAdapter([_action("list_dir", path=".") for _ in range(10)])
    result = await _orch(config, adapter).run("loop forever")

    assert not result.ok
    assert result.status == TaskStatus.FAILED
    assert result.error_code == "budget_exhausted"
    assert result.steps == config.orchestrator.max_steps


@pytest.mark.asyncio
async def test_finish_without_result_fails(config: EngineConfig):
    adapter = ScriptedAdapter([_action("finish")])
    result = await _orch(config, adapter).run("finish empty")
    assert not result.ok
    assert result.error_code == "empty_result"


@pytest.mark.asyncio
async def test_model_failure_marks_task_failed(config: EngineConfig):
    class Boom(ModelAdapter):
        backend = "boom"

        def __init__(self):
            super().__init__("boom")

        async def generate(self, request: GenerationRequest) -> GenerationResponse:
            raise ModelError("backend exploded")

        async def health(self) -> HealthStatus:
            return HealthStatus(ok=False, model_id="boom", backend="boom")

    result = await _orch(config, Boom()).run("explode")
    assert not result.ok
    assert result.status == TaskStatus.FAILED
    assert "exploded" in (result.error or "")


@pytest.mark.asyncio
async def test_task_timeout_is_enforced(config: EngineConfig):
    config.orchestrator.task_timeout_s = 0  # already expired on entry
    adapter = ScriptedAdapter([_action("finish", result="never")])
    result = await _orch(config, adapter).run("time out")
    assert result.status == TaskStatus.TIMED_OUT
    assert result.error_code == "task_timeout"


@pytest.mark.asyncio
async def test_token_accounting_recorded(config: EngineConfig):
    adapter = ScriptedAdapter([_action("finish", result="x")])
    result = await _orch(config, adapter).run("count tokens")
    # ScriptedAdapter reports 100 prompt + 20 completion per call.
    assert result.total_tokens == 120
    assert result.state.prompt_tokens == 100


@pytest.mark.asyncio
async def test_history_window_bounds_prompt_size(config: EngineConfig):
    config.orchestrator.max_steps = 8
    adapter = ScriptedAdapter(
        [_action("list_dir", path=".") for _ in range(7)] + [_action("finish", result="ok")]
    )
    orch = _orch(config, adapter)
    orch.history_window = 2
    await orch.run("long run")

    last_prompt = adapter.requests[-1].messages[-1].content
    # Only the last 2 steps should be replayed, not all 7.
    assert "Step 1:" not in last_prompt
    assert "Step 7:" in last_prompt


@pytest.mark.asyncio
async def test_system_prompt_lists_real_tools(config: EngineConfig):
    adapter = ScriptedAdapter([_action("finish", result="ok")])
    await _orch(config, adapter).run("inspect prompt")
    system = adapter.requests[0].messages[0].content
    assert "read_file" in system
    assert "write_file" in system
    assert "finish" in system
    # Shell is disabled in the fixture, so it must not be advertised.
    assert "run_shell" not in system


@pytest.mark.asyncio
async def test_run_result_serialises(config: EngineConfig):
    adapter = ScriptedAdapter([_action("finish", result="ok")])
    result = await _orch(config, adapter).run("serialise")
    payload = result.to_dict()
    assert payload["status"] == "succeeded"
    assert json.dumps(payload)  # must be JSON-serialisable
