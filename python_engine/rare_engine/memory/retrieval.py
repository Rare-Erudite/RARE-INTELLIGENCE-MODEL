"""The retrieval facade used by the CLI, the tools and the eval harness.

Two distinct capabilities are deliberately kept apart, because conflating them
is the most common way an "agent memory" feature becomes useless:

* **Corpus retrieval** (``index_path`` / ``search``) - ingest external
documents, rank chunks against a query. This is document intelligence.
* **Durable notes** (``remember`` / ``recall``) - facts the engine chose to keep
  across runs, written under a reserved source prefix so they can be listed and
  audited separately from ingested corpus files.

Both live in the same index because both are text that must be found later, and
two indexes would mean two chances to drift.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from .index import Document, PersistentIndex, SearchHit

# Documents written through ``remember`` are tagged with this source prefix so
# they can be listed and pruned without touching ingested files.
NOTE_PREFIX = "note://"

# Extensions worth indexing. Binary formats are skipped rather than ingested as
# mojibake - silently indexing garbage is worse than not indexing.
TEXT_SUFFIXES = frozenset(
    {".txt", ".md", ".markdown", ".rst", ".py", ".js", ".ts", ".tsx", ".jsx",
     ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".csv", ".log",
     ".html", ".htm", ".css", ".sql", ".sh", ".go", ".rs", ".java", ".c",
     ".h", ".cpp", ".rb", ".php"}
)

MAX_FILE_BYTES = 2_000_000


class Retriever:
    """Ingest + search + note-keeping over one persistent index."""

    def __init__(
        self,
        root: str | Path,
        chunk_chars: int = 1200,
        chunk_overlap: int = 150,
    ) -> None:
        self.index = PersistentIndex(
            root, chunk_chars=chunk_chars, chunk_overlap=chunk_overlap
        )

    # --- corpus ingestion ----------------------------------------------------

    def index_path(self, path: str | Path, recursive: bool = True) -> dict[str, Any]:
        """Index a file or a directory tree of text files.

        Returns a report with what was ingested and what was skipped *and why*,
        so an unexpectedly small corpus is explainable instead of mysterious.
        """
        target = Path(path)
        report: dict[str, Any] = {
            "indexed": [],
            "skipped": [],
            "bytes": 0,
        }
        if not target.exists():
            raise FileNotFoundError(f"no such path: {target}")

        files: list[Path]
        if target.is_file():
            files = [target]
        else:
            pattern = "**/*" if recursive else "*"
            files = sorted(p for p in target.glob(pattern) if p.is_file())

        for file in files:
            reason = self._skip_reason(file)
            if reason:
                report["skipped"].append({"path": str(file), "reason": reason})
                continue
            try:
                text = file.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                report["skipped"].append({"path": str(file), "reason": f"read error: {exc}"})
                continue
            if not text.strip():
                report["skipped"].append({"path": str(file), "reason": "empty"})
                continue
            self.index.add_document(text, source=str(file), title=file.name)
            report["indexed"].append(str(file))
            report["bytes"] += len(text.encode("utf-8"))

        self.index.save()
        report["count"] = len(report["indexed"])
        report["stats"] = self.index.stats()
        return report

    @staticmethod
    def _skip_reason(file: Path) -> str | None:
        if file.suffix.lower() not in TEXT_SUFFIXES:
            return f"unsupported extension {file.suffix or '(none)'}"
        try:
            if file.stat().st_size > MAX_FILE_BYTES:
                return f"too large ({file.stat().st_size} bytes > {MAX_FILE_BYTES})"
        except OSError as exc:
            return f"stat error: {exc}"
        return None

    # --- durable notes -------------------------------------------------------

    def remember(self, text: str, key: str | None = None) -> str:
        """Persist a durable note. Returns its doc id.

        A ``key`` makes the note addressable and replaceable, so remembering the
        same fact twice updates it instead of accumulating duplicates.
        """
        if not text or not text.strip():
            raise ValueError("cannot remember empty text")
        source = f"{NOTE_PREFIX}{key}" if key else f"{NOTE_PREFIX}{time.time_ns()}"
        doc_id = self.index.add_document(
            text.strip(), source=source, title=key or "note", meta={"kind": "note"}
        )
        self.index.save()
        return doc_id

    def recall(self, query: str, top_k: int = 5) -> list[SearchHit]:
        """Search across both corpus documents and durable notes."""
        return self.index.search(query, top_k=top_k)

    def notes(self) -> list[Document]:
        """Every durable note, newest source first."""
        docs = [self.index.document(doc_id) for doc_id in self.index.document_ids()]
        live = [d for d in docs if d is not None and d.source.startswith(NOTE_PREFIX)]
        return sorted(live, key=lambda d: d.source, reverse=True)

    # --- query ---------------------------------------------------------------

    def search(self, query: str, top_k: int = 5) -> list[SearchHit]:
        return self.index.search(query, top_k=top_k)

    def stats(self) -> dict[str, Any]:
        return self.index.stats()

    def clear(self) -> None:
        self.index.clear()


def format_hits(hits: list[SearchHit], max_chars: int = 400) -> str:
    """Render hits as the compact text block the model actually receives.

    The format is stable and citable: ``[n] source (score)`` then the text.
    Keeping the source next to each passage is what lets a model attribute a
    claim instead of paraphrasing everything into one undifferentiated blob.
    """
    if not hits:
        return "NO RESULTS"

    blocks: list[str] = []
    for position, hit in enumerate(hits, start=1):
        body = hit.text.strip()
        if len(body) > max_chars:
            body = body[:max_chars].rstrip() + "..."
        blocks.append(
            f"[{position}] {hit.source} (score {hit.score:.2f})\n{body}"
        )
    return "\n\n".join(blocks)
