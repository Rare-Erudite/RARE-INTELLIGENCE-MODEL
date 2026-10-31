"""Tool layer: a small, auditable capability surface for the model.

Why so few tools
----------------
A 0.6B model cannot reliably choose among twenty tools. The v1 surface is
deliberately tiny - read, write, list, finish - plus an opt-in shell tool. Each
tool has a JSON schema the model sees, a strict argument validator, and a
bounded output size.

Sandbox
-------
Every filesystem tool resolves its path and then checks it is inside
``tools.sandbox_root``. The check is done on the *resolved* path (symlinks
followed), so ``../../etc/passwd`` and a symlink pointing outside both fail.
This is a real boundary for the model's own actions, not a security sandbox
against a hostile process - that distinction is stated in KNOWN_LIMITATIONS.md.
"""

from __future__ import annotations

import asyncio
import shlex
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import (
    SandboxViolationError,
    ToolError,
    ToolPermissionError,
    ToolTimeoutError,
)
from .logging import get_logger
from .memory import Retriever, format_hits

log = get_logger("tools")


@dataclass
class ToolResult:
    ok: bool
    output: str
    error: str | None = None
    error_code: str | None = None
    truncated: bool = False

    def to_observation(self) -> str:
        if self.ok:
            return self.output
        return f"ERROR[{self.error_code or 'tool_error'}]: {self.error}"


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Awaitable[str]]
    requires_shell: bool = False
    tags: list[str] = field(default_factory=list)

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
        }


class ToolRegistry:
    """Holds the tools available to a run and enforces the allowlist."""

    def __init__(
        self,
        sandbox_root: str | Path,
        allowlist: list[str] | None = None,
        enable_shell: bool = False,
        shell_timeout_s: int = 60,
        max_output_chars: int = 20_000,
        retriever: Retriever | None = None,
        retrieval_top_k: int = 4,
        snippet_chars: int = 400,
    ) -> None:
        self.sandbox_root = Path(sandbox_root).resolve()
        self.allowlist = set(allowlist or [])
        self.enable_shell = enable_shell
        self.shell_timeout_s = shell_timeout_s
        self.max_output_chars = max_output_chars
        self.retriever = retriever
        self.retrieval_top_k = retrieval_top_k
        self.snippet_chars = snippet_chars
        self._tools: dict[str, ToolSpec] = {}
        self._register_builtins()

    # --- registration --------------------------------------------------------

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def _register_builtins(self) -> None:
        self.register(
            ToolSpec(
                name="read_file",
                description="Read a UTF-8 text file from the sandbox. Returns its contents.",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Path relative to the sandbox root."}
                    },
                    "required": ["path"],
                },
                handler=self._read_file,
                tags=["fs"],
            )
        )
        self.register(
            ToolSpec(
                name="write_file",
                description="Create or overwrite a UTF-8 text file in the sandbox.",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Path relative to the sandbox root."},
                        "content": {"type": "string", "description": "Full file contents to write."},
                    },
                    "required": ["path", "content"],
                },
                handler=self._write_file,
                tags=["fs"],
            )
        )
        self.register(
            ToolSpec(
                name="list_dir",
                description="List entries of a directory in the sandbox.",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Directory path; '.' for the sandbox root."}
                    },
                    "required": ["path"],
                },
                handler=self._list_dir,
                tags=["fs"],
            )
        )
        self.register(
            ToolSpec(
                name="run_shell",
                description=(
                    "Run a shell command inside the sandbox root. Disabled unless "
                    "tools.enable_shell is true."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "Command line to execute."}
                    },
                    "required": ["command"],
                },
                handler=self._run_shell,
                requires_shell=True,
                tags=["shell"],
            )
        )
        # Retrieval tools exist only when a retriever is attached, so they are
        # registered conditionally rather than failing at call time.
        if self.retriever is not None:
            self.register(
                ToolSpec(
                    name="retrieve",
                    description=(
                        "Search the indexed document corpus and durable memory for passages "
                        "relevant to a query. Returns ranked passages with their source. "
                        "Use this before answering questions about indexed documents."
                    ),
                    parameters={
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Keywords or a short question to search for.",
                            },
                            "top_k": {
                                "type": "integer",
                                "description": "How many passages to return (default 4).",
                            },
                        },
                        "required": ["query"],
                    },
                    handler=self._retrieve,
                    tags=["memory"],
                )
            )
            self.register(
                ToolSpec(
                    name="remember",
                    description=(
                        "Persist a durable note that survives across runs so a later task "
                        "can recall it. Use a stable key to update rather than duplicate."
                    ),
                    parameters={
                        "type": "object",
                        "properties": {
                            "text": {"type": "string", "description": "The fact to keep."},
                            "key": {
                                "type": "string",
                                "description": "Optional stable name for this note.",
                            },
                        },
                        "required": ["text"],
                    },
                    handler=self._remember,
                    tags=["memory"],
                )
            )

    # --- visibility ----------------------------------------------------------

    def available(self) -> list[ToolSpec]:
        """Tools the model may call, after allowlist and shell gating."""
        out = []
        for spec in self._tools.values():
            if spec.requires_shell and not self.enable_shell:
                continue
            if self.allowlist and spec.name not in self.allowlist:
                continue
            out.append(spec)
        return sorted(out, key=lambda s: s.name)

    def schemas(self) -> list[dict[str, Any]]:
        return [s.schema() for s in self.available()]

    def names(self) -> list[str]:
        return [s.name for s in self.available()]

    # --- sandbox -------------------------------------------------------------

    def resolve(self, raw_path: str) -> Path:
        """Resolve ``raw_path`` inside the sandbox or raise SandboxViolationError."""
        if raw_path is None or str(raw_path).strip() == "":
            raise ToolError("path must not be empty")
        candidate = Path(raw_path)
        target = (self.sandbox_root / candidate).resolve() if not candidate.is_absolute() else candidate.resolve()
        try:
            target.relative_to(self.sandbox_root)
        except ValueError as exc:
            raise SandboxViolationError(
                f"path escapes sandbox: {raw_path}",
                sandbox=str(self.sandbox_root),
                resolved=str(target),
            ) from exc
        return target

    def _clip(self, text: str) -> tuple[str, bool]:
        if len(text) <= self.max_output_chars:
            return text, False
        return text[: self.max_output_chars] + "\n...[truncated]", True

    # --- handlers ------------------------------------------------------------

    async def _read_file(self, path: str) -> str:
        target = self.resolve(path)
        if not target.exists():
            raise ToolError(f"file not found: {path}")
        if target.is_dir():
            raise ToolError(f"is a directory: {path}")
        text = target.read_text(encoding="utf-8", errors="replace")
        clipped, _ = self._clip(text)
        return clipped

    async def _write_file(self, path: str, content: str) -> str:
        target = self.resolve(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"wrote {len(content)} chars to {path}"

    async def _list_dir(self, path: str = ".") -> str:
        target = self.resolve(path)
        if not target.exists():
            raise ToolError(f"directory not found: {path}")
        if not target.is_dir():
            raise ToolError(f"not a directory: {path}")
        entries = []
        for child in sorted(target.iterdir()):
            kind = "dir" if child.is_dir() else "file"
            size = "" if child.is_dir() else f" {child.stat().st_size}B"
            entries.append(f"{kind}\t{child.name}{size}")
        return "\n".join(entries) if entries else "(empty)"

    async def _retrieve(self, query: str, top_k: int | None = None) -> str:
        """Rank corpus chunks for the model and render citable passages."""
        if self.retriever is None:  # pragma: no cover - registration prevents this
            raise ToolError("retrieval is not configured")
        if not query or not query.strip():
            raise ToolError("query must not be empty")
        limit = int(top_k) if top_k is not None else self.retrieval_top_k
        # Clamp: an unbounded top_k would let the model flood its own context.
        limit = max(1, min(limit, 20))
        hits = self.retriever.search(query, top_k=limit)
        return format_hits(hits, max_chars=self.snippet_chars)

    async def _remember(self, text: str, key: str | None = None) -> str:
        """Persist a durable note that later runs can retrieve."""
        if self.retriever is None:  # pragma: no cover - registration prevents this
            raise ToolError("memory is not configured")
        doc_id = self.retriever.remember(text, key=key)
        return f"remembered {len(text)} chars as {doc_id}"

    async def _run_shell(self, command: str) -> str:
        if not self.enable_shell:
            raise ToolPermissionError("shell tool is disabled (tools.enable_shell=false)")
        # Reject obvious escapes before spawning anything.
        for token in shlex.split(command):
            if token.startswith("/") and not token.startswith(str(self.sandbox_root)):
                raise SandboxViolationError(
                    f"absolute path outside sandbox: {token}", sandbox=str(self.sandbox_root)
                )
            if ".." in Path(token).parts:
                raise SandboxViolationError(
                    f"parent traversal in command: {token}", sandbox=str(self.sandbox_root)
                )

        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=str(self.sandbox_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=self.shell_timeout_s)
        except TimeoutError as exc:
            proc.kill()
            await proc.wait()
            raise ToolTimeoutError(
                f"command exceeded {self.shell_timeout_s}s", command=command
            ) from exc

        text = (stdout or b"").decode("utf-8", errors="replace")
        clipped, _ = self._clip(text)
        return f"exit={proc.returncode}\n{clipped}"

    # --- dispatch ------------------------------------------------------------

    async def call(self, name: str, arguments: dict[str, Any]) -> ToolResult:
        spec = self._tools.get(name)
        if spec is None:
            return ToolResult(
                ok=False,
                output="",
                error=f"unknown tool '{name}'. Available: {', '.join(self.names())}",
                error_code="tool_not_found",
            )
        if spec not in self.available():
            return ToolResult(
                ok=False,
                output="",
                error=f"tool '{name}' is not enabled for this run",
                error_code="tool_permission_denied",
            )
        if not isinstance(arguments, dict):
            return ToolResult(
                ok=False, output="", error="arguments must be a JSON object",
                error_code="bad_arguments",
            )

        required = spec.parameters.get("required", [])
        missing = [r for r in required if r not in arguments]
        if missing:
            return ToolResult(
                ok=False, output="",
                error=f"missing required argument(s): {', '.join(missing)}",
                error_code="bad_arguments",
            )

        log.info("tool_call", extra={"tool": name, "tool_args": _redact(arguments)})
        try:
            output = await spec.handler(**arguments)
            return ToolResult(ok=True, output=output)
        except ToolError as exc:
            log.warning("tool_error", extra={"tool": name, "code": exc.code, "error": exc.message})
            return ToolResult(ok=False, output="", error=exc.message, error_code=exc.code)
        except TypeError as exc:
            return ToolResult(
                ok=False, output="", error=f"bad arguments for {name}: {exc}",
                error_code="bad_arguments",
            )
        except Exception as exc:  # pragma: no cover - defensive
            log.exception("tool_crashed", extra={"tool": name})
            return ToolResult(
                ok=False, output="", error=f"{type(exc).__name__}: {exc}",
                error_code="tool_crashed",
            )


def _redact(args: dict[str, Any], limit: int = 200) -> dict[str, Any]:
    """Keep logs readable: truncate long values, never log whole file bodies."""
    out: dict[str, Any] = {}
    for key, value in args.items():
        if isinstance(value, str) and len(value) > limit:
            out[key] = value[:limit] + f"...(+{len(value) - limit})"
        else:
            out[key] = value
    return out


def build_retriever(config: Any) -> Retriever | None:
    """Build the retriever, or ``None`` when memory is disabled."""
    if not getattr(config, "memory", None) or not config.memory.enabled:
        return None
    return Retriever(
        config.memory_path,
        chunk_chars=config.memory.chunk_chars,
        chunk_overlap=config.memory.chunk_overlap,
    )


def build_registry(config: Any, retriever: Retriever | None = None) -> ToolRegistry:
    """Build a registry from an :class:`EngineConfig`.

    A caller may pass an existing retriever (the CLI shares one across the
    process); otherwise it is built from config when memory is enabled.
    """
    if retriever is None:
        retriever = build_retriever(config)
    memory = getattr(config, "memory", None)
    return ToolRegistry(
        sandbox_root=config.sandbox_path,
        allowlist=config.tools.allowlist,
        enable_shell=config.tools.enable_shell,
        shell_timeout_s=config.tools.shell_timeout_s,
        max_output_chars=config.tools.max_output_chars,
        retriever=retriever,
        retrieval_top_k=memory.top_k if memory else 4,
        snippet_chars=memory.max_snippet_chars if memory else 400,
    )
