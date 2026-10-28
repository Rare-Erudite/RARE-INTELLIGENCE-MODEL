"""The orchestrator: a bounded plan/act/observe loop.

One task = one loop. Each iteration:

1. build the prompt (system contract + goal + recent history + tool schemas);
2. call the model, with a per-call timeout and retry on retryable errors;
3. parse the reply into an :class:`Action` (bounded repair, see protocol.py);
4. if ``finish`` -> record result and stop;
5. otherwise dispatch the tool, record the observation, continue.

Everything is bounded: ``max_steps``, ``max_model_calls``, ``max_tool_calls``,
``task_timeout_s``. A run that hits a bound ends with an explicit status
(``failed`` / ``timed_out``) and a recorded reason - it never hangs and never
reports success it did not achieve.

Context management
------------------
The full step history is kept in :class:`TaskState` for audit, but only the
last ``history_window`` steps are replayed into the prompt. That keeps a 4096
token context usable on a 0.6B model without pretending we have long context.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

from .config import EngineConfig
from .errors import (
    BudgetExhaustedError,
    ModelError,
    ProtocolError,
    RareError,
    TaskNotResumableError,
    TaskTimeoutError,
)
from .logging import bind_run, bind_step, bind_task, get_logger, new_run_id
from .models.base import GenerationRequest, Message, ModelAdapter
from .protocol import Action, parse_action
from .state import StepRecord, TaskState, TaskStatus, TaskStore, new_step_id
from .tools import ToolRegistry

log = get_logger("orchestrator")

SYSTEM_PROMPT = """You are the RARE Intelligence Engine, an autonomous engineering agent.

You work in a loop. On every turn you reply with EXACTLY ONE JSON object and
nothing else. No prose before or after. No markdown fences.

Schema:
{"thought": "<one short sentence of reasoning>", "action": "<tool name or finish>", "action_input": {<arguments>}}

Rules:
- Use only the tools listed below. Never invent a tool name.
- One action per turn. Wait for the observation before deciding the next one.
- Do not repeat an action that already failed with the same arguments.
- When the goal is achieved, call "finish" with the final answer:
  {"thought": "...", "action": "finish", "action_input": {"result": "<answer>"}}
- If the goal cannot be achieved, call "finish" and say so plainly in "result".
- Never claim you did something you did not do.

Available tools:
{tools}
"""


@dataclass
class RunResult:
    """What a caller gets back from :meth:`Orchestrator.run`."""

    task_id: str
    status: TaskStatus
    result: str | None
    steps: int
    duration_s: float
    total_tokens: int
    error: str | None = None
    error_code: str | None = None
    state: TaskState | None = None
    resumed_from_step: int | None = None

    @property
    def ok(self) -> bool:
        return self.status == TaskStatus.SUCCEEDED

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "status": self.status.value,
            "result": self.result,
            "steps": self.steps,
            "duration_s": self.duration_s,
            "total_tokens": self.total_tokens,
            "error": self.error,
            "error_code": self.error_code,
            "resumed_from_step": self.resumed_from_step,
        }


class Orchestrator:
    """Runs tasks against a model adapter and a tool registry."""

    def __init__(
        self,
        config: EngineConfig,
        adapter: ModelAdapter,
        registry: ToolRegistry,
        store: TaskStore | None = None,
        history_window: int = 6,
    ) -> None:
        self.config = config
        self.adapter = adapter
        self.registry = registry
        self.store = store or TaskStore(config.state_path)
        self.history_window = history_window

    # --- prompt construction -------------------------------------------------

    def _tool_block(self) -> str:
        lines = []
        for schema in self.registry.schemas():
            params = schema["parameters"].get("properties", {})
            arg_list = ", ".join(
                f"{name}: {spec.get('type', 'any')}" for name, spec in params.items()
            )
            lines.append(f"- {schema['name']}({arg_list}) - {schema['description']}")
        return "\n".join(lines) if lines else "(no tools available)"

    def _system_prompt(self) -> str:
        # str.format would treat the JSON braces in the prompt as fields, so
        # substitute the single placeholder explicitly instead.
        return SYSTEM_PROMPT.replace("{tools}", self._tool_block())

    def _history_block(self, state: TaskState) -> str:
        recent = state.steps[-self.history_window :]
        if not recent:
            return "(no steps yet - this is your first action)"
        chunks = []
        for step in recent:
            chunks.append(
                f"Step {step.index}:\n"
                f"  thought: {step.thought}\n"
                f"  action: {step.action} {step.action_input}\n"
                f"  observation: {step.observation[:800]}"
            )
        return "\n".join(chunks)

    def _build_request(self, state: TaskState, repair_note: str | None = None) -> GenerationRequest:
        user = (
            f"GOAL:\n{state.goal}\n\n"
            f"PROGRESS SO FAR:\n{self._history_block(state)}\n\n"
            f"Steps used: {state.step_count}/{self.config.orchestrator.max_steps}.\n"
        )
        if repair_note:
            user += f"\nYOUR LAST REPLY WAS REJECTED: {repair_note}\nReply again with one valid JSON object.\n"
        user += "\nWhat is your next action? Reply with one JSON object."

        return GenerationRequest(
            messages=[Message.system(self._system_prompt()), Message.user(user)],
            max_tokens=self.config.model(state.model_id).max_tokens
            if state.model_id in self.config.models
            else 512,
            temperature=0.2,
            json_mode=False,  # grammar-constrained JSON hurts small-model tool choice
        )

    # --- model call with retry ----------------------------------------------

    async def _call_model(self, request: GenerationRequest) -> Any:
        orch = self.config.orchestrator
        last_exc: Exception | None = None
        for attempt in range(orch.max_retries + 1):
            try:
                return await asyncio.wait_for(
                    self.adapter.generate(request), timeout=orch.model_timeout_s
                )
            except TimeoutError as exc:
                last_exc = exc
                log.warning("model_timeout", extra={"attempt": attempt + 1})
            except ModelError as exc:
                last_exc = exc
                if not exc.retryable:
                    raise
                log.warning(
                    "model_retry", extra={"attempt": attempt + 1, "code": exc.code}
                )
            if attempt < orch.max_retries:
                await asyncio.sleep(orch.retry_backoff_s * (attempt + 1))
        raise ModelError(f"model failed after {orch.max_retries + 1} attempts: {last_exc}")

    # --- main loop -----------------------------------------------------------

    async def run(
        self,
        goal: str,
        model_id: str | None = None,
        task_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> RunResult:
        """Execute one task to a terminal state. Never raises for task failure."""
        state = TaskState(
            goal=goal,
            model_id=model_id or self.config.default_model,
            metadata=metadata or {},
        )
        if task_id:
            state.task_id = task_id
        state.run_id = new_run_id()
        state.mark_running()
        self.store.save(state)

        return await self._execute(state, start_index=1, resumed_from=None)

    # --- resume --------------------------------------------------------------

    def _validate_resumable(self, state: TaskState) -> int:
        """Check every invariant a safe continuation depends on.

        Returns the next step index. Raises :class:`TaskNotResumableError`
        *before* any model or tool call, so a refused resume has no side
        effect. Each message names the specific invariant that failed.
        """
        orch = self.config.orchestrator

        if state.status == TaskStatus.SUCCEEDED:
            raise TaskNotResumableError(
                f"task {state.task_id} already succeeded; nothing to resume",
                task_id=state.task_id,
            )

        # Step indices must be a contiguous 1..n run. A gap means the file was
        # hand-edited or a write was lost, and continuing would silently skip
        # work - refuse instead of guessing.
        expected = list(range(1, len(state.steps) + 1))
        actual = [s.index for s in state.steps]
        if actual != expected:
            raise TaskNotResumableError(
                f"task {state.task_id} has non-contiguous step indices "
                f"(expected 1..{len(state.steps)}, got {actual}); refusing to guess",
                task_id=state.task_id,
            )

        # A step that never finished means the process died mid-step. Its side
        # effect may or may not have landed, so we cannot claim it completed.
        unfinished = [s.index for s in state.steps if s.finished_at is None]
        if unfinished:
            raise TaskNotResumableError(
                f"task {state.task_id} has unfinished step(s) {unfinished}; "
                "the previous run died mid-step and the side effect is unknown",
                task_id=state.task_id,
            )

        if len(state.steps) >= orch.max_steps:
            raise TaskNotResumableError(
                f"task {state.task_id} already used {len(state.steps)} of "
                f"{orch.max_steps} steps; raise max_steps to continue",
                task_id=state.task_id,
            )
        if state.model_calls >= orch.max_model_calls:
            raise TaskNotResumableError(
                f"task {state.task_id} exhausted the model call budget "
                f"({state.model_calls}/{orch.max_model_calls})",
                task_id=state.task_id,
            )
        if state.tool_calls >= orch.max_tool_calls:
            raise TaskNotResumableError(
                f"task {state.task_id} exhausted the tool call budget "
                f"({state.tool_calls}/{orch.max_tool_calls})",
                task_id=state.task_id,
            )

        return len(state.steps) + 1

    async def resume(self, task_id: str) -> RunResult:
        """Continue a persisted task from its last completed step.

        Completed steps are *not* replayed: the loop starts at the next index,
        so every tool call already recorded keeps its single side effect. The
        prior observations stay in ``state.steps`` and are replayed into the
        prompt as history, so the model sees what it already did.
        """
        state = self.store.load(task_id)  # raises TaskNotFoundError / StateError
        start_index = self._validate_resumable(state)

        previous_status = state.status
        state.run_id = new_run_id()
        state.mark_running()
        state.last_error = None
        state.last_error_code = None
        state.finished_at = None
        self.store.save(state)

        log.info(
            "task_resumed",
            extra={
                "task_id": task_id,
                "from_step": start_index,
                "previous_status": previous_status.value,
                "prior_steps": len(state.steps),
            },
        )
        return await self._execute(state, start_index=start_index, resumed_from=start_index)

    # --- shared execution ----------------------------------------------------

    async def _execute(
        self, state: TaskState, start_index: int, resumed_from: int | None
    ) -> RunResult:
        """Run the loop for an already-prepared state and record the outcome."""
        orch = self.config.orchestrator
        started = time.perf_counter()
        deadline = started + orch.task_timeout_s

        with bind_run(state.run_id or new_run_id()), bind_task(state.task_id):
            log.info(
                "task_started",
                extra={
                    "goal": state.goal[:200],
                    "model_id": state.model_id,
                    "task_id": state.task_id,
                    "start_index": start_index,
                },
            )
            try:
                await self._loop(state, deadline, start_index=start_index)
            except TaskTimeoutError as exc:
                state.mark_timed_out(exc.message)
                log.error("task_timed_out", extra={"error": exc.message})
            except BudgetExhaustedError as exc:
                state.mark_failed(exc.message, code=exc.code)
                log.error("budget_exhausted", extra={"error": exc.message})
            except RareError as exc:
                state.mark_failed(exc.message, code=exc.code)
                log.error("task_failed", extra={"error": exc.message, "code": exc.code})
            except Exception as exc:  # pragma: no cover - defensive
                state.mark_failed(f"{type(exc).__name__}: {exc}", code="internal_error")
                log.exception("task_crashed")
            finally:
                self.store.save(state)

        duration = round(time.perf_counter() - started, 3)
        log.info(
            "task_finished",
            extra={
                "status": state.status.value,
                "steps": state.step_count,
                "duration_s": duration,
                "tokens": state.total_tokens,
            },
        )
        return RunResult(
            task_id=state.task_id,
            status=state.status,
            result=state.result,
            steps=state.step_count,
            duration_s=duration,
            total_tokens=state.total_tokens,
            error=state.last_error,
            error_code=state.last_error_code,
            state=state,
            resumed_from_step=resumed_from,
        )

    async def _loop(self, state: TaskState, deadline: float, start_index: int = 1) -> None:
        orch = self.config.orchestrator
        repair_note: str | None = None

        for index in range(start_index, orch.max_steps + 1):
            if time.perf_counter() > deadline:
                raise TaskTimeoutError(
                    f"task exceeded {orch.task_timeout_s}s", steps=state.step_count
                )
            if state.model_calls >= orch.max_model_calls:
                raise BudgetExhaustedError(
                    f"model call budget exhausted ({orch.max_model_calls})",
                    steps=state.step_count,
                )

            step_id = new_step_id(index)
            step = StepRecord(step_id=step_id, index=index)

            with bind_step(step_id):
                request = self._build_request(state, repair_note)
                repair_note = None

                try:
                    response = await self._call_model(request)
                except ModelError as exc:
                    step.ok = False
                    step.error = exc.message
                    step.error_code = exc.code
                    step.finished_at = _now()
                    state.add_step(step)
                    raise

                step.prompt_tokens = response.usage.prompt_tokens
                step.completion_tokens = response.usage.completion_tokens
                step.latency_ms = response.latency_ms

                try:
                    parsed = parse_action(response.text)
                except ProtocolError as exc:
                    # Feed the failure back; the model gets a chance to correct.
                    step.ok = False
                    step.error = exc.message
                    step.error_code = exc.code
                    step.observation = f"ERROR[protocol]: {exc.message}"
                    step.finished_at = _now()
                    state.add_step(step)
                    self.store.save(state)
                    repair_note = exc.message
                    log.warning("protocol_error", extra={"step": index, "error": exc.message})
                    continue

                action: Action = parsed.action
                step.thought = action.thought
                step.action = action.action
                step.action_input = action.action_input

                if action.is_finish:
                    result = str(action.action_input.get("result", "")).strip()
                    step.observation = "task finished"
                    step.finished_at = _now()
                    state.add_step(step)
                    if not result:
                        state.mark_failed(
                            "model called finish without a result", code="empty_result"
                        )
                    else:
                        state.mark_succeeded(result)
                    self.store.save(state)
                    return

                if state.tool_calls >= orch.max_tool_calls:
                    raise BudgetExhaustedError(
                        f"tool call budget exhausted ({orch.max_tool_calls})",
                        steps=state.step_count,
                    )

                tool_result = await self.registry.call(action.action, action.action_input)
                step.ok = tool_result.ok
                step.observation = tool_result.to_observation()
                if not tool_result.ok:
                    step.error = tool_result.error
                    step.error_code = tool_result.error_code
                step.finished_at = _now()
                state.add_step(step)
                self.store.save(state)

                log.info(
                    "step_completed",
                    extra={
                        "step": index,
                        "action": action.action,
                        "ok": tool_result.ok,
                        "observation_chars": len(step.observation),
                    },
                )

        raise BudgetExhaustedError(
            f"reached max_steps ({orch.max_steps}) without finishing",
            steps=state.step_count,
        )


def _now():
    from .state import utcnow

    return utcnow()
