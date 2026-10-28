"""Integration tests against the REAL local GGUF.

Marked ``requires_model`` and skipped automatically when the weights are
absent, so CI without a 400 MB download still passes. These are the tests that
prove the engine works with an actual language model rather than a scripted
stub - they are the ones that matter for the "real working code" claim.

They are also marked ``slow``: on a 1-CPU container a single 64-token
generation takes minutes. Run with::

    pytest -m requires_model -v
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from rare_engine.config import load_config, resolve_model_path
from rare_engine.errors import ConfigError
from rare_engine.models import build_default_adapter
from rare_engine.models.base import GenerationRequest, Message
from rare_engine.protocol import parse_action

pytestmark = [pytest.mark.requires_model, pytest.mark.slow]

REPO_ROOT = Path(__file__).resolve().parent.parent


def _weights_present() -> bool:
    try:
        cfg = load_config()
        model = cfg.model()
        return model.adapter == "llamacpp" and resolve_model_path(model).exists()
    except (ConfigError, OSError, ValueError):
        return False


requires_weights = pytest.mark.skipif(
    not _weights_present(), reason="GGUF weights not present (run scripts/fetch_model.py)"
)


@pytest.fixture(scope="module")
def adapter():
    cfg = load_config()
    a = build_default_adapter(cfg)
    # This host is capped at 1 CPU (see TEST_REPORT.md), where the measured
    # throughput is ~0.08 tok/s. The default 180 s model timeout is correct for
    # production but too tight to prove generation here, so the integration
    # test raises it explicitly rather than weakening the shipped default.
    a.timeout_s = float(os.environ.get("RARE_TEST_MODEL_TIMEOUT_S", "900"))
    yield a


@requires_weights
@pytest.mark.asyncio
async def test_health_reports_loaded(adapter):
    health = await adapter.health()
    assert health.ok is True
    assert health.loaded is True
    assert health.backend == "llamacpp"
    assert health.context_window > 0


@requires_weights
@pytest.mark.asyncio
async def test_real_generation_returns_text_and_usage(adapter):
    response = await adapter.generate(
        GenerationRequest(
            messages=[Message.user("Reply with the single word: ready")],
            max_tokens=4,
            temperature=0.0,
        )
    )
    assert response.text.strip() != ""
    assert response.usage.completion_tokens > 0
    assert response.usage.prompt_tokens > 0
    assert response.latency_ms > 0
    assert response.backend == "llamacpp"


@requires_weights
@pytest.mark.asyncio
async def test_real_model_can_emit_a_parseable_action(adapter):
    """The end-to-end contract: a real model reply must parse into an Action."""
    system = (
        "You are a tool-using agent. Reply with EXACTLY one JSON object and nothing else:\n"
        '{"thought": "...", "action": "finish", "action_input": {"result": "..."}}\n'
        "No prose, no markdown."
    )
    response = await adapter.generate(
        GenerationRequest(
            messages=[
                Message.system(system),
                Message.user('Finish the task with result "ok".'),
            ],
            max_tokens=48,
            temperature=0.0,
        )
    )
    parsed = parse_action(response.text)
    assert parsed.action.action == "finish"
    assert parsed.action.action_input.get("result")
