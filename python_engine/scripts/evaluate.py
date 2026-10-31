#!/usr/bin/env python3
"""Run the evaluation suite and print a score table.

    python scripts/evaluate.py --adapter oracle          # harness self-check
    python scripts/evaluate.py --adapter echo            # deterministic baseline
    python scripts/evaluate.py --adapter llamacpp --suite tool_use
    python scripts/evaluate.py --adapter oracle --json   # machine-readable

``oracle`` replays each task's known-good replies. It must score 100%: if it
does not, the *checkers* are broken and no other score means anything.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from benchmarks import SUITES, SuiteResult, run_suite, tasks_for  # noqa: E402
from rare_engine.models.base import (  # noqa: E402
    GenerationRequest,
    GenerationResponse,
    HealthStatus,
    ModelAdapter,
    Usage,
)


class OracleAdapter(ModelAdapter):
    """Replays the task's known-good replies. Not a model - a harness check."""

    backend = "oracle"

    def __init__(self, replies: list[str]) -> None:
        super().__init__(model_id="oracle", context_window=8192)
        self.replies = list(replies)

    async def generate(self, request: GenerationRequest) -> GenerationResponse:
        if not self.replies:
            raise RuntimeError("oracle ran out of scripted replies")
        text = self.replies.pop(0)
        return GenerationResponse(
            text=text,
            model_id=self.model_id,
            usage=Usage.from_counts(10, 10),
            finish_reason="stop",
            latency_ms=0.0,
            backend=self.backend,
        )

    async def health(self) -> HealthStatus:
        return HealthStatus(
            ok=True, model_id=self.model_id, backend=self.backend,
            detail="oracle", loaded=True,
        )


def build_factory(name: str):
    if name == "oracle":
        return lambda task: OracleAdapter(task.oracle_replies)

    if name == "echo":
        from rare_engine.models.echo_adapter import EchoAdapter

        return lambda task: EchoAdapter()

    if name == "llamacpp":
        from rare_engine.config import load_config
        from rare_engine.models import build_default_adapter

        config = load_config()

        def factory(task):
            return build_default_adapter(config)

        return factory

    raise SystemExit(f"unknown adapter: {name}")


def print_table(result: SuiteResult) -> None:
    print(f"\nadapter: {result.adapter}")
    print(f"{'suite':<14} {'passed':>7} {'total':>6}  {'score':>6}")
    print("-" * 38)
    for suite, (passed, total) in result.by_suite().items():
        pct = 100 * passed / total if total else 0
        print(f"{suite:<14} {passed:>7} {total:>6}  {pct:>5.0f}%")
    print("-" * 38)
    pct = 100 * result.passed / result.total if result.total else 0
    print(f"{'TOTAL':<14} {result.passed:>7} {result.total:>6}  {pct:>5.0f}%")

    failures = [s for s in result.scores if not s.passed]
    if failures:
        print("\nfailures:")
        for s in failures:
            print(f"  {s.id:<26} {s.detail[:100]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="RARE evaluation suite")
    parser.add_argument("--adapter", default="oracle", choices=["oracle", "echo", "llamacpp"])
    parser.add_argument("--suite", default="all", choices=["all", *SUITES])
    parser.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    parser.add_argument("--out", type=Path, help="write the JSON result to this path")
    args = parser.parse_args()

    tasks = tasks_for(args.suite)
    factory = build_factory(args.adapter)

    with tempfile.TemporaryDirectory(prefix="rare-eval-") as tmp:
        result = asyncio.run(run_suite(tasks, factory, Path(tmp), args.adapter))

    if args.json:
        print(json.dumps(result.to_dict(), indent=2))
    else:
        print_table(result)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result.to_dict(), indent=2), encoding="utf-8")
        print(f"\nwrote {args.out}")

    return 0 if result.passed == result.total else 1


if __name__ == "__main__":
    raise SystemExit(main())
