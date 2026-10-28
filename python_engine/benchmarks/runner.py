"""Runs evaluation tasks against a model adapter and scores them."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

from rare_engine.config import EngineConfig, ModelConfig, OrchestratorConfig, ToolConfig
from rare_engine.models.base import GenerationRequest, Message, ModelAdapter
from rare_engine.orchestrator import Orchestrator
from rare_engine.state import TaskStore
from rare_engine.tools import build_registry

from .tasks import EvalTask, Outcome


def make_config(root: Path, name: str) -> EngineConfig:
    """An isolated config: own state dir, own sandbox, echo model."""
    return EngineConfig(
        env="eval",
        state_dir=str(root / name / "state"),
        log_level="CRITICAL",
        log_format="text",
        default_model="echo",
        models={"echo": ModelConfig(id="echo", adapter="echo", model_ref="echo")},
        orchestrator=OrchestratorConfig(
            task_timeout_s=120,
            model_timeout_s=60,
            max_steps=8,
            max_retries=0,
            retry_backoff_s=0.0,
            max_model_calls=12,
            max_tool_calls=12,
        ),
        tools=ToolConfig(sandbox_root=str(root / name / "sandbox"), enable_shell=False),
    )


async def run_task(task: EvalTask, adapter: ModelAdapter, config: EngineConfig) -> Outcome:
    """Execute one eval task and return its raw outcome (unscored)."""
    sandbox = Path(config.tools.sandbox_root)
    sandbox.mkdir(parents=True, exist_ok=True)
    if task.setup:
        task.setup(sandbox)

    if task.kind == "direct":
        request = GenerationRequest(
            messages=[Message.user(task.prompt)], max_tokens=256, temperature=0.0
        )
        try:
            response = await adapter.generate(request)
            return Outcome(text=response.text)
        except Exception as exc:  # noqa: BLE001 - a failed call is a failed task
            return Outcome(error=f"{type(exc).__name__}: {exc}")

    registry = build_registry(config)
    store = TaskStore(config.state_path).init()
    orch = Orchestrator(config, adapter, registry, store)
    result = await orch.run(task.prompt, metadata={"sandbox": str(sandbox)})
    return Outcome(text=result.result or "", state=result.state, error=result.error)


@dataclass
class TaskScore:
    id: str
    suite: str
    passed: bool
    detail: str
    duration_s: float


@dataclass
class SuiteResult:
    adapter: str
    scores: list[TaskScore] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.scores)

    @property
    def passed(self) -> int:
        return sum(1 for s in self.scores if s.passed)

    def by_suite(self) -> dict[str, tuple[int, int]]:
        out: dict[str, tuple[int, int]] = {}
        for s in self.scores:
            p, t = out.get(s.suite, (0, 0))
            out[s.suite] = (p + (1 if s.passed else 0), t + 1)
        return out

    def to_dict(self) -> dict[str, object]:
        return {
            "adapter": self.adapter,
            "passed": self.passed,
            "total": self.total,
            "by_suite": {
                k: {"passed": p, "total": t} for k, (p, t) in self.by_suite().items()
            },
            "tasks": [
                {
                    "id": s.id,
                    "suite": s.suite,
                    "passed": s.passed,
                    "detail": s.detail,
                    "duration_s": s.duration_s,
                }
                for s in self.scores
            ],
        }


async def run_suite(
    tasks: list[EvalTask],
    adapter_factory,
    root: Path,
    adapter_name: str,
) -> SuiteResult:
    """Run every task with a fresh adapter and isolated state."""
    result = SuiteResult(adapter=adapter_name)
    for task in tasks:
        config = make_config(root, task.id)
        adapter = adapter_factory(task)
        started = time.perf_counter()
        try:
            outcome = await run_task(task, adapter, config)
            ok, detail = task.check(outcome)
        except Exception as exc:  # noqa: BLE001 - harness must not die on one task
            ok, detail = False, f"harness error: {type(exc).__name__}: {exc}"
        finally:
            close = getattr(adapter, "close", None)
            if close:
                await close()
        result.scores.append(
            TaskScore(
                id=task.id,
                suite=task.suite,
                passed=ok,
                detail=detail,
                duration_s=round(time.perf_counter() - started, 3),
            )
        )
    return result
