"""End-to-end example: a real task against the real local model.

Run it with::

    python examples/e2e_local.py

It asks the engine to write a small file into the sandbox and then read it
back, which exercises the whole vertical slice: config -> adapter -> prompt ->
protocol parse -> tool dispatch -> sandbox -> state persistence -> result.

The example prints the full trace and exits non-zero if the task did not
succeed, so it doubles as a smoke test.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rare_engine.config import load_config
from rare_engine.logging import setup_logging
from rare_engine.models import build_default_adapter
from rare_engine.orchestrator import Orchestrator
from rare_engine.state import TaskStore
from rare_engine.tools import build_registry

GOAL = (
    "Create a file named hello.txt in the sandbox containing exactly the text "
    "'RARE engine online'. Then read it back to confirm the contents, and finish "
    "by reporting the exact contents you read."
)


async def main() -> int:
    config = load_config()
    setup_logging(config.log_level, "text", force=True)
    config.ensure_dirs()

    adapter = build_default_adapter(config)
    registry = build_registry(config)
    store = TaskStore(config.state_path).init()
    orch = Orchestrator(config, adapter, registry, store)

    print(f"model   : {config.default_model}")
    print(f"sandbox : {registry.sandbox_root}")
    print(f"tools   : {', '.join(registry.names())}")
    print(f"goal    : {GOAL}\n")

    try:
        result = await orch.run(GOAL)
    finally:
        await adapter.close()

    print("\n--- trace ---")
    for step in (result.state.steps if result.state else []):
        print(f"[{step.index}] {step.action} ok={step.ok}")
        if step.thought:
            print(f"    thought: {step.thought}")
        print(f"    obs: {step.observation[:300]}")

    print("\n--- result ---")
    print(f"status : {result.status.value}")
    print(f"steps  : {result.steps}")
    print(f"time   : {result.duration_s}s")
    print(f"tokens : {result.total_tokens}")
    print(f"output : {result.result or result.error}")

    target = registry.sandbox_root / "hello.txt"
    if target.exists():
        print(f"\nfile on disk: {target} -> {target.read_text()!r}")

    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
