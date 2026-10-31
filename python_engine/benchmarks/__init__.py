"""Reproducible evaluation suite. See benchmarks/tasks.py for the design rules."""

from .runner import SuiteResult, make_config, run_suite, run_task
from .tasks import SUITES, TASKS, EvalTask, Outcome, tasks_for

__all__ = [
    "SUITES",
    "TASKS",
    "EvalTask",
    "Outcome",
    "SuiteResult",
    "make_config",
    "run_suite",
    "run_task",
    "tasks_for",
]
