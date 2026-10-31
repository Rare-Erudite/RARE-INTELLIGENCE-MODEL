"""Tests for the evaluation harness itself.

The harness is only trustworthy if it can be shown to *work*. These tests run
the suite in oracle mode (replaying known-good replies) and require 100%: any
failure means a checker is broken, not that a model is weak.

They also assert the negative direction - a deliberately wrong reply must be
scored as a failure - so a checker that always returns True cannot pass.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from benchmarks import SUITES, TASKS, Outcome, run_suite, tasks_for  # noqa: E402
from benchmarks.tasks import _answer_is, _code_passes  # noqa: E402
from scripts.evaluate import OracleAdapter  # noqa: E402


def test_every_suite_has_tasks():
    for suite in SUITES:
        assert tasks_for(suite), f"suite {suite} is empty"


def test_task_ids_are_unique():
    ids = [t.id for t in TASKS]
    assert len(ids) == len(set(ids)), "duplicate eval task ids"


def test_every_task_has_an_oracle_script():
    for task in TASKS:
        assert task.oracle_replies, f"{task.id} has no oracle_replies"


def test_agentic_tasks_end_with_finish():
    for task in TASKS:
        if task.kind == "agentic":
            assert "finish" in task.oracle_replies[-1], (
                f"{task.id} oracle must end with a finish action"
            )


async def test_oracle_scores_100_percent(tmp_path):
    """The harness self-check: known-good replies must all pass."""
    result = await run_suite(TASKS, lambda t: OracleAdapter(t.oracle_replies), tmp_path, "oracle")
    failures = [(s.id, s.detail) for s in result.scores if not s.passed]
    assert not failures, f"oracle mode failed {len(failures)} task(s): {failures}"
    assert result.passed == result.total == len(TASKS)


async def test_oracle_scores_100_percent_per_suite(tmp_path):
    for suite in SUITES:
        tasks = tasks_for(suite)
        result = await run_suite(
            tasks, lambda t: OracleAdapter(t.oracle_replies), tmp_path / suite, "oracle"
        )
        assert result.passed == result.total, f"suite {suite} failed in oracle mode"


# --- negative direction: checkers must be able to fail -----------------------


def test_answer_checker_rejects_wrong_answer():
    ok, detail = _answer_is("410")(Outcome(text="411"))
    assert not ok
    assert "expected" in detail


def test_answer_checker_accepts_embedded_answer():
    ok, _ = _answer_is("410")(Outcome(text="The answer is 410."))
    assert ok


def test_answer_checker_does_not_match_substring():
    """'41' must not match inside '410'."""
    ok, _ = _answer_is("41")(Outcome(text="410"))
    assert not ok


def test_code_checker_rejects_broken_code():
    ok, detail = _code_passes("assert add(2, 3) == 5")(
        Outcome(text="```python\ndef add(a, b):\n    return a - b\n```")
    )
    assert not ok
    assert "AssertionError" in detail or "assert" in detail.lower()


def test_code_checker_rejects_empty():
    ok, _ = _code_passes("assert True")(Outcome(text=""))
    assert not ok


def test_code_checker_reports_error_outcome():
    ok, detail = _code_passes("assert True")(Outcome(error="model exploded"))
    assert not ok
    assert "model exploded" in detail


async def test_wrong_replies_are_scored_as_failures(tmp_path):
    """A model that always says 'nope' must score zero, not pass by accident."""
    class AlwaysWrong(OracleAdapter):
        def __init__(self) -> None:
            super().__init__([])

        async def generate(self, request):
            from rare_engine.models.base import GenerationResponse, Usage

            return GenerationResponse(
                text="nope",
                model_id="wrong",
                usage=Usage.from_counts(1, 1),
                finish_reason="stop",
                latency_ms=0.0,
                backend="wrong",
            )

    result = await run_suite(TASKS, lambda t: AlwaysWrong(), tmp_path, "wrong")
    assert result.passed == 0, f"a wrong model scored {result.passed}/{result.total}"


@pytest.mark.parametrize("suite", SUITES)
def test_suite_names_are_stable(suite):
    assert suite in SUITES
