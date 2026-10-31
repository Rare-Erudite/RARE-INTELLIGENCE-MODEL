"""The action protocol: how the model tells the engine what to do.

The model must emit exactly one JSON object per turn::

    {"thought": "...", "action": "read_file", "action_input": {"path": "a.txt"}}

or, to end the task::

    {"thought": "...", "action": "finish", "action_input": {"result": "..."}}

Why a strict protocol
---------------------
Small models drift. They wrap JSON in prose, add markdown fences, emit
``<tool_call>`` XML, or (for Qwen3) prepend a `` thinking`` block. A parser that
only accepts perfect JSON would fail constantly; a parser that accepts anything
would let malformed actions through. So we do a *bounded* repair:

1. strip `` thinking...</think>`` blocks (Qwen3 reasoning traces);
2. strip markdown code fences;
3. try ``json.loads`` on the whole string;
4. otherwise scan for the first balanced ``{...}`` object and parse that;
5. validate the result against :class:`Action`.

If all of that fails, :class:`ProtocolError` is raised with the raw text
attached, and the orchestrator feeds the error back to the model as an
observation so it can correct itself. Repair is never silent: the number of
repairs is recorded on the step.
"""

from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from .errors import ProtocolError

_THINK_RE = re.compile(r"<think\b[^>]*>.*?</think>", re.DOTALL | re.IGNORECASE)
_THINK_OPEN_RE = re.compile(r"<think\b[^>]*>.*\Z", re.DOTALL | re.IGNORECASE)
_FENCE_RE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.DOTALL)

FINISH = "finish"


class Action(BaseModel):
    """One validated engine action."""

    thought: str = ""
    action: str
    action_input: dict[str, Any] = Field(default_factory=dict)

    @property
    def is_finish(self) -> bool:
        return self.action == FINISH


class ParseResult(BaseModel):
    action: Action
    repaired: bool = False
    raw: str = ""


def strip_reasoning(text: str) -> str:
    """Remove Qwen3-style reasoning blocks, including an unterminated one."""
    text = _THINK_RE.sub("", text)
    text = _THINK_OPEN_RE.sub("", text)
    return text.strip()


def strip_fences(text: str) -> str:
    match = _FENCE_RE.search(text)
    if match:
        return match.group(1).strip()
    return text.strip()


def extract_json_object(text: str) -> str | None:
    """Return the first balanced ``{...}`` substring, respecting strings/escapes."""
    start = text.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escaped = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
        start = text.find("{", start + 1)
    return None


def parse_action(raw: str) -> ParseResult:
    """Parse model output into an :class:`Action`, repairing within bounds."""
    if raw is None or not raw.strip():
        raise ProtocolError("model returned an empty response")

    original = raw
    cleaned = strip_reasoning(raw)
    if not cleaned:
        raise ProtocolError(
            "response contained only a reasoning block and no action", raw=original[:2000]
        )

    repaired = cleaned != raw.strip()
    candidates: list[str] = [cleaned]

    unfenced = strip_fences(cleaned)
    if unfenced != cleaned:
        candidates.append(unfenced)
        repaired = True

    payload: dict[str, Any] | None = None
    for candidate in candidates:
        try:
            loaded = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(loaded, dict):
            payload = loaded
            break

    if payload is None:
        embedded = extract_json_object(unfenced)
        if embedded:
            try:
                loaded = json.loads(embedded)
                if isinstance(loaded, dict):
                    payload = loaded
                    repaired = True
            except json.JSONDecodeError:
                payload = None

    if payload is None:
        raise ProtocolError(
            "no JSON object found in model output",
            raw=original[:2000],
            hint='reply with exactly {"thought": "...", "action": "...", "action_input": {...}}',
        )

    # Tolerate the common small-model variants before strict validation.
    if "action" not in payload:
        for alias in ("tool", "name", "command"):
            if alias in payload and isinstance(payload[alias], str):
                payload["action"] = payload.pop(alias)
                repaired = True
                break
    if "action_input" not in payload:
        for alias in ("input", "args", "arguments", "parameters"):
            if alias in payload and isinstance(payload[alias], dict):
                payload["action_input"] = payload.pop(alias)
                repaired = True
                break
    if "action_input" in payload and payload["action_input"] is None:
        payload["action_input"] = {}
    if "thought" in payload and not isinstance(payload["thought"], str):
        payload["thought"] = str(payload["thought"])

    try:
        action = Action(**payload)
    except ValidationError as exc:
        raise ProtocolError(
            f"action failed validation: {exc.errors()[0].get('msg', 'invalid')}",
            raw=original[:2000],
            payload=payload,
        ) from exc

    if not action.action.strip():
        raise ProtocolError("action name is empty", raw=original[:2000])

    return ParseResult(action=action, repaired=repaired, raw=original)
