"""Protocol parser tests - the highest-risk component with a small model."""

from __future__ import annotations

import pytest

from rare_engine.errors import ProtocolError
from rare_engine.protocol import extract_json_object, parse_action, strip_reasoning


def test_clean_json_parses_without_repair():
    raw = '{"thought": "read it", "action": "read_file", "action_input": {"path": "a.txt"}}'
    result = parse_action(raw)
    assert result.action.action == "read_file"
    assert result.action.action_input == {"path": "a.txt"}
    assert result.repaired is False


def test_markdown_fence_is_stripped():
    raw = '```json\n{"thought": "t", "action": "list_dir", "action_input": {"path": "."}}\n```'
    result = parse_action(raw)
    assert result.action.action == "list_dir"
    assert result.repaired is True


def test_qwen_think_block_is_stripped():
    raw = (
        "<think>\nThe user wants a file read. I should call read_file.\n</think>\n"
        '{"thought": "read", "action": "read_file", "action_input": {"path": "x"}}'
    )
    assert strip_reasoning(raw).startswith("{")
    result = parse_action(raw)
    assert result.action.action == "read_file"
    assert result.repaired is True


def test_unterminated_think_block_yields_protocol_error():
    raw = "<think>\nstill thinking and never closing"
    with pytest.raises(ProtocolError):
        parse_action(raw)


def test_prose_around_json_is_tolerated():
    raw = 'Sure, here is my action: {"thought": "t", "action": "finish", "action_input": {"result": "done"}} Hope that helps.'
    result = parse_action(raw)
    assert result.action.is_finish
    assert result.action.action_input["result"] == "done"
    assert result.repaired is True


def test_braces_inside_strings_do_not_break_extraction():
    raw = '{"thought": "use {curly} braces", "action": "finish", "action_input": {"result": "a {b} c"}}'
    result = parse_action(raw)
    assert result.action.action_input["result"] == "a {b} c"


def test_alias_keys_are_normalised():
    raw = '{"thought": "t", "tool": "read_file", "args": {"path": "a"}}'
    result = parse_action(raw)
    assert result.action.action == "read_file"
    assert result.action.action_input == {"path": "a"}


def test_missing_action_input_defaults_to_empty_dict():
    result = parse_action('{"thought": "t", "action": "finish"}')
    assert result.action.action_input == {}


def test_empty_response_raises():
    with pytest.raises(ProtocolError, match="empty"):
        parse_action("   ")


def test_non_json_prose_raises_with_raw_context():
    with pytest.raises(ProtocolError) as exc:
        parse_action("I will now read the file for you.")
    assert "raw" in exc.value.context


def test_extract_json_object_returns_none_when_absent():
    assert extract_json_object("no braces here") is None


def test_nested_object_is_complete():
    text = 'prefix {"a": {"b": {"c": 1}}} suffix'
    assert extract_json_object(text) == '{"a": {"b": {"c": 1}}}'
