"""Command-line interface.

    rare run "goal"          run a task
    rare status              list recent tasks
    rare show <task_id>      full step-by-step trace of one task
    rare doctor              check config, model weights, sandbox, tools
    rare tools               list the tools the model would see

The CLI is a thin shell over the library: no logic lives here that the tests
cannot reach through the public API.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .config import load_config, resolve_model_path
from .errors import TaskNotFoundError, TaskNotResumableError
from .logging import setup_logging
from .memory import Retriever, format_hits
from .models import build_default_adapter
from .orchestrator import Orchestrator
from .state import TaskStore
from .tools import build_registry

app = typer.Typer(add_completion=False, help="RARE Intelligence Engine")
console = Console()


def _bootstrap(config_path: Path | None, model: str | None):
    config = load_config(config_path)
    setup_logging(config.log_level, config.log_format, force=True)
    config.ensure_dirs()
    adapter = build_default_adapter(config, model)
    registry = build_registry(config)
    store = TaskStore(config.state_path).init()
    return config, adapter, registry, store


@app.command()
def run(
    goal: str = typer.Argument(..., help="What the engine should accomplish."),
    model: str | None = typer.Option(None, "--model", "-m", help="Model id from config."),
    config_path: Path | None = typer.Option(None, "--config", "-c"),
    json_out: bool = typer.Option(False, "--json", help="Print the result as JSON."),
) -> None:
    """Run one task to completion."""
    config, adapter, registry, store = _bootstrap(config_path, model)
    orch = Orchestrator(config, adapter, registry, store)

    async def _go():
        try:
            return await orch.run(goal, model_id=model)
        finally:
            await adapter.close()

    result = asyncio.run(_go())

    if json_out:
        console.print_json(json.dumps(result.to_dict()))
        raise typer.Exit(0 if result.ok else 1)

    style = "green" if result.ok else "red"
    console.print(
        Panel(
            result.result or result.error or "(no output)",
            title=f"[{style}]{result.status.value}[/{style}] {result.task_id}",
            subtitle=f"{result.steps} steps · {result.duration_s}s · {result.total_tokens} tokens",
        )
    )
    raise typer.Exit(0 if result.ok else 1)


@app.command()
def resume(
    task_id: str = typer.Argument(..., help="Task id to continue."),
    model: str | None = typer.Option(None, "--model", "-m", help="Override the model id."),
    config_path: Path | None = typer.Option(None, "--config", "-c"),
    json_out: bool = typer.Option(False, "--json", help="Print the result as JSON."),
) -> None:
    """Continue an interrupted or failed task from its last completed step."""
    config, adapter, registry, store = _bootstrap(config_path, model)
    orch = Orchestrator(config, adapter, registry, store)

    async def _go():
        try:
            return await orch.resume(task_id)
        finally:
            await adapter.close()

    try:
        result = asyncio.run(_go())
    except TaskNotResumableError as exc:
        console.print(f"[red]cannot resume:[/red] {exc.message}")
        raise typer.Exit(2) from exc
    except TaskNotFoundError as exc:
        console.print(f"[red]no such task:[/red] {task_id}")
        raise typer.Exit(2) from exc

    if json_out:
        console.print_json(json.dumps(result.to_dict()))
        raise typer.Exit(0 if result.ok else 1)

    style = "green" if result.ok else "red"
    console.print(
        Panel(
            result.result or result.error or "(no output)",
            title=f"[{style}]{result.status.value}[/{style}] {result.task_id}",
            subtitle=(
                f"resumed at step {result.resumed_from_step} \u00b7 "
                f"{result.steps} steps \u00b7 {result.duration_s}s \u00b7 "
                f"{result.total_tokens} tokens"
            ),
        )
    )
    raise typer.Exit(0 if result.ok else 1)


@app.command()
def index(
    path: str = typer.Argument(..., help="File or directory to ingest into memory."),
    config_path: Path | None = typer.Option(None, "--config", "-c"),
    no_recursive: bool = typer.Option(False, "--no-recursive", help="Do not descend into subdirectories."),
) -> None:
    """Ingest documents into the persistent retrieval index."""
    config = load_config(config_path)
    if not config.memory.enabled:
        console.print("[red]memory is disabled[/red] (memory.enabled=false)")
        raise typer.Exit(2)
    config.ensure_dirs()

    retriever = Retriever(
        config.memory_path,
        chunk_chars=config.memory.chunk_chars,
        chunk_overlap=config.memory.chunk_overlap,
    )
    try:
        report = retriever.index_path(path, recursive=not no_recursive)
    except FileNotFoundError as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(2) from exc

    stats = report["stats"]
    console.print(
        f"indexed [bold]{report['count']}[/bold] file(s), "
        f"{report['bytes']} bytes \u00b7 "
        f"{stats['documents']} docs / {stats['chunks']} chunks / {stats['terms']} terms"
    )
    if report["skipped"]:
        table = Table(title=f"Skipped ({len(report['skipped'])})")
        table.add_column("path")
        table.add_column("reason")
        for item in report["skipped"][:20]:
            table.add_row(item["path"], item["reason"])
        console.print(table)


@app.command()
def search(
    query: str = typer.Argument(..., help="What to look for."),
    top_k: int = typer.Option(5, "--top-k", "-k"),
    config_path: Path | None = typer.Option(None, "--config", "-c"),
    json_out: bool = typer.Option(False, "--json"),
) -> None:
    """Search the retrieval index."""
    config = load_config(config_path)
    retriever = Retriever(
        config.memory_path,
        chunk_chars=config.memory.chunk_chars,
        chunk_overlap=config.memory.chunk_overlap,
    )
    hits = retriever.search(query, top_k=top_k)

    if json_out:
        console.print_json(json.dumps([h.to_dict() for h in hits]))
        return
    if not hits:
        console.print("[dim]no results[/dim]")
        return
    console.print(format_hits(hits, max_chars=600))


@app.command()
def remember(
    text: str = typer.Argument(..., help="The fact to keep."),
    key: str | None = typer.Option(None, "--key", "-k", help="Stable name; reusing it updates the note."),
    config_path: Path | None = typer.Option(None, "--config", "-c"),
) -> None:
    """Persist a durable note that later runs can recall."""
    config = load_config(config_path)
    config.ensure_dirs()
    retriever = Retriever(config.memory_path)
    doc_id = retriever.remember(text, key=key)
    console.print(f"remembered as [bold]{doc_id}[/bold]")


@app.command()
def memory(
    config_path: Path | None = typer.Option(None, "--config", "-c"),
) -> None:
    """Show retrieval index statistics and stored notes."""
    config = load_config(config_path)
    retriever = Retriever(config.memory_path)
    stats = retriever.stats()
    console.print(
        f"documents={stats['documents']} chunks={stats['chunks']} "
        f"terms={stats['terms']} tokens={stats['total_tokens']}"
    )
    console.print(f"index: {stats['path']}")
    notes = retriever.notes()
    if notes:
        table = Table(title=f"Notes ({len(notes)})")
        table.add_column("key")
        table.add_column("chars")
        for note in notes:
            table.add_row(note.source.replace("note://", ""), str(len(note.text)))
        console.print(table)


@app.command()
def status(
    limit: int = typer.Option(10, "--limit", "-n"),
    config_path: Path | None = typer.Option(None, "--config", "-c"),
) -> None:
    """List recent tasks."""
    config = load_config(config_path)
    store = TaskStore(config.state_path).init()
    items = store.list(limit=limit)
    if not items:
        console.print("[dim]no tasks yet[/dim]")
        return

    table = Table(title="Recent tasks")
    for col in ("task_id", "status", "steps", "tokens", "duration_s", "goal"):
        table.add_column(col)
    for item in items:
        table.add_row(
            item["task_id"],
            item["status"],
            str(item["steps"]),
            str(item["tokens"]),
            str(item["duration_s"]),
            (item["goal"][:60] + "…") if len(item["goal"]) > 60 else item["goal"],
        )
    console.print(table)


@app.command()
def show(
    task_id: str = typer.Argument(...),
    config_path: Path | None = typer.Option(None, "--config", "-c"),
) -> None:
    """Print the full trace of one task."""
    config = load_config(config_path)
    store = TaskStore(config.state_path).init()
    state = store.load(task_id)

    console.print(Panel(state.goal, title=f"{state.task_id} · {state.status.value}"))
    for step in state.steps:
        head = f"[bold]step {step.index}[/bold] · {step.action or '(none)'} · {'ok' if step.ok else 'FAILED'}"
        body = (
            f"[dim]thought:[/dim] {step.thought}\n"
            f"[dim]input:[/dim] {json.dumps(step.action_input, ensure_ascii=False)}\n"
            f"[dim]observation:[/dim] {step.observation[:1200]}"
        )
        if step.error:
            body += f"\n[red]error:[/red] {step.error}"
        console.print(Panel(body, title=head, border_style="green" if step.ok else "red"))

    if state.result:
        console.print(Panel(state.result, title="result", border_style="green"))


@app.command()
def tools(config_path: Path | None = typer.Option(None, "--config", "-c")) -> None:
    """List the tools the model would be offered."""
    config = load_config(config_path)
    registry = build_registry(config)
    table = Table(title="Available tools")
    table.add_column("name")
    table.add_column("description")
    for spec in registry.available():
        table.add_row(spec.name, spec.description)
    console.print(table)


@app.command()
def doctor(config_path: Path | None = typer.Option(None, "--config", "-c")) -> None:
    """Check that this installation can actually run a task."""
    config = load_config(config_path)
    ok = True

    console.print(f"config: env={config.env} default_model={config.default_model}")
    console.print(f"state_dir: {config.state_path}")

    model = config.model()
    console.print(f"model: {model.id} adapter={model.adapter}")
    if model.adapter == "llamacpp":
        path = resolve_model_path(model)
        exists = path.exists()
        ok = ok and exists
        size = f"{path.stat().st_size / 1e6:.1f} MB" if exists else "MISSING"
        console.print(f"  weights: {path} ({size})")
        if not exists:
            console.print("  [red]run: python scripts/fetch_model.py[/red]")

    registry = build_registry(config)
    console.print(f"tools: {', '.join(registry.names())}")
    console.print(f"sandbox: {registry.sandbox_root}")

    async def _health():
        adapter = build_default_adapter(config)
        try:
            return await adapter.health()
        finally:
            await adapter.close()

    health = asyncio.run(_health())
    ok = ok and health.ok
    colour = "green" if health.ok else "red"
    console.print(f"[{colour}]health: {health.ok} - {health.detail}[/{colour}]")
    raise typer.Exit(0 if ok else 1)


if __name__ == "__main__":  # pragma: no cover
    app()
