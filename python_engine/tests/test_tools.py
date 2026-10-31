"""Tool layer tests - sandbox enforcement is the point of this file."""

from __future__ import annotations

from pathlib import Path

import pytest

from rare_engine.errors import ToolError
from rare_engine.tools import ToolRegistry


def _reg(sandbox: Path, **kwargs) -> ToolRegistry:
    return ToolRegistry(sandbox_root=sandbox, **kwargs)


@pytest.mark.asyncio
async def test_write_then_read_roundtrip(sandbox: Path):
    reg = _reg(sandbox)
    write = await reg.call("write_file", {"path": "notes/a.txt", "content": "hello"})
    assert write.ok
    assert (sandbox / "notes" / "a.txt").read_text() == "hello"

    read = await reg.call("read_file", {"path": "notes/a.txt"})
    assert read.ok
    assert read.output == "hello"


@pytest.mark.asyncio
async def test_parent_traversal_is_blocked(sandbox: Path):
    reg = _reg(sandbox)
    result = await reg.call("read_file", {"path": "../../../etc/passwd"})
    assert not result.ok
    assert result.error_code == "sandbox_violation"


@pytest.mark.asyncio
async def test_absolute_path_outside_sandbox_blocked(sandbox: Path):
    reg = _reg(sandbox)
    result = await reg.call("read_file", {"path": "/etc/passwd"})
    assert not result.ok
    assert result.error_code == "sandbox_violation"


@pytest.mark.asyncio
async def test_symlink_escape_is_blocked(sandbox: Path, tmp_path: Path):
    outside = tmp_path / "secret.txt"
    outside.write_text("top secret")
    link = sandbox / "link.txt"
    link.symlink_to(outside)

    reg = _reg(sandbox)
    result = await reg.call("read_file", {"path": "link.txt"})
    assert not result.ok
    assert result.error_code == "sandbox_violation"


def test_resolve_raises_on_empty_path(sandbox: Path):
    reg = _reg(sandbox)
    with pytest.raises(ToolError):
        reg.resolve("")


@pytest.mark.asyncio
async def test_unknown_tool_returns_structured_error(sandbox: Path):
    reg = _reg(sandbox)
    result = await reg.call("teleport", {})
    assert not result.ok
    assert result.error_code == "tool_not_found"
    assert "read_file" in result.output or "read_file" in (result.error or "")


@pytest.mark.asyncio
async def test_missing_required_argument(sandbox: Path):
    reg = _reg(sandbox)
    result = await reg.call("read_file", {})
    assert not result.ok
    assert result.error_code == "bad_arguments"


@pytest.mark.asyncio
async def test_read_directory_gives_clear_error(sandbox: Path):
    (sandbox / "d").mkdir()
    reg = _reg(sandbox)
    result = await reg.call("read_file", {"path": "d"})
    assert not result.ok
    assert "directory" in (result.error or "").lower()


@pytest.mark.asyncio
async def test_list_dir_output(sandbox: Path):
    (sandbox / "f.txt").write_text("x")
    (sandbox / "sub").mkdir()
    reg = _reg(sandbox)
    result = await reg.call("list_dir", {"path": "."})
    assert result.ok
    assert "f.txt" in result.output
    assert "sub" in result.output


@pytest.mark.asyncio
async def test_shell_disabled_by_default(sandbox: Path):
    reg = _reg(sandbox)
    result = await reg.call("run_shell", {"command": "echo hi"})
    assert not result.ok
    assert result.error_code == "tool_permission_denied"


def test_shell_tool_hidden_when_disabled(sandbox: Path):
    reg = _reg(sandbox, enable_shell=False)
    assert "run_shell" not in reg.names()


def test_shell_tool_visible_when_enabled(sandbox: Path):
    reg = _reg(sandbox, enable_shell=True)
    assert "run_shell" in reg.names()


@pytest.mark.asyncio
async def test_shell_runs_inside_sandbox(sandbox: Path):
    reg = _reg(sandbox, enable_shell=True)
    result = await reg.call("run_shell", {"command": "echo sandbox-ok"})
    assert result.ok
    assert "sandbox-ok" in result.output
    assert "exit=0" in result.output


@pytest.mark.asyncio
async def test_shell_absolute_path_escape_blocked(sandbox: Path):
    reg = _reg(sandbox, enable_shell=True)
    result = await reg.call("run_shell", {"command": "cat /etc/passwd"})
    assert not result.ok
    assert result.error_code == "sandbox_violation"


@pytest.mark.asyncio
async def test_shell_parent_traversal_blocked(sandbox: Path):
    reg = _reg(sandbox, enable_shell=True)
    result = await reg.call("run_shell", {"command": "cat ../../etc/passwd"})
    assert not result.ok
    assert result.error_code == "sandbox_violation"


def test_allowlist_restricts_visible_tools(sandbox: Path):
    reg = _reg(sandbox, allowlist=["read_file"])
    assert reg.names() == ["read_file"]


@pytest.mark.asyncio
async def test_allowlisted_out_tool_is_denied(sandbox: Path):
    reg = _reg(sandbox, allowlist=["read_file"])
    result = await reg.call("write_file", {"path": "x", "content": "y"})
    assert not result.ok
    assert result.error_code == "tool_permission_denied"


def test_schemas_are_json_schema_shaped(sandbox: Path):
    reg = _reg(sandbox)
    for schema in reg.schemas():
        assert {"name", "description", "parameters"} <= set(schema)
        assert schema["parameters"]["type"] == "object"


@pytest.mark.asyncio
async def test_long_output_is_truncated(sandbox: Path):
    reg = _reg(sandbox, max_output_chars=50)
    await reg.call("write_file", {"path": "big.txt", "content": "x" * 500})
    result = await reg.call("read_file", {"path": "big.txt"})
    assert result.ok
    assert "truncated" in result.output
    assert len(result.output) < 200


@pytest.mark.asyncio
async def test_write_creates_parent_directories(sandbox: Path):
    reg = _reg(sandbox)
    result = await reg.call("write_file", {"path": "a/b/c/d.txt", "content": "deep"})
    assert result.ok
    assert (sandbox / "a/b/c/d.txt").exists()
