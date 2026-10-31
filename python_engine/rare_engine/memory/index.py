"""A persistent lexical index over a corpus of chunks.

Storage
-------
One atomically-written JSON file holds the authoritative corpus: the chunks,
their offsets and their document metadata. The inverted index (postings,
document frequencies, lengths) is **derived** from those chunks, not stored.

That choice is deliberate. Storing both means two sources of truth that can
drift, and a drifted index produces rankings that no amount of debugging will
explain. Deriving on load costs one tokenisation pass over the corpus and makes
drift structurally impossible. Loading is therefore O(total tokens); that is
acceptable for the corpus sizes this engine targets and is stated in
KNOWN_LIMITATIONS.md.

Adding a document only tokenises the *new* chunks, so steady-state ingestion is
not quadratic; a full rebuild happens on load and on removal.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .bm25 import DEFAULT_PARAMS, BM25Params, rank, search_scores
from .chunking import ChunkSpan, chunk_text
from .tokenizer import query_terms, term_frequencies, tokenize

SCHEMA_VERSION = 1
DEFAULT_INDEX_FILE = "memory.json"

# Documents live in a namespace so one index can serve several isolated
# boundaries (per-user, per-task, per-project) without cross-boundary leakage.
# A search that names a namespace sees only that namespace; a search that names
# none sees everything, which is what the single-tenant CLI wants.
DEFAULT_NAMESPACE = "default"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _checksum(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


class SearchHit:
    """One ranked result."""

    __slots__ = (
        "chunk_id", "doc_id", "score", "text", "start", "end",
        "source", "title", "meta", "namespace",
    )

    def __init__(
        self,
        chunk_id: str,
        doc_id: str,
        score: float,
        text: str,
        start: int,
        end: int,
        source: str,
        title: str,
        meta: dict[str, Any],
        namespace: str = DEFAULT_NAMESPACE,
    ) -> None:
        self.chunk_id = chunk_id
        self.doc_id = doc_id
        self.score = score
        self.text = text
        self.start = start
        self.end = end
        self.source = source
        self.title = title
        self.meta = meta
        self.namespace = namespace

    def to_dict(self) -> dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "doc_id": self.doc_id,
            "score": round(self.score, 6),
            "source": self.source,
            "title": self.title,
            "start": self.start,
            "end": self.end,
            "text": self.text,
            "meta": self.meta,
            "namespace": self.namespace,
        }

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"SearchHit({self.doc_id!r}, score={self.score:.3f}, {self.title!r})"


class Document:
    """A stored document and the ids of the chunks it produced."""

    __slots__ = (
        "doc_id", "source", "title", "text", "checksum",
        "added_at", "meta", "chunk_ids", "namespace",
    )

    def __init__(
        self,
        doc_id: str,
        source: str,
        title: str,
        text: str,
        checksum: str,
        added_at: str,
        meta: dict[str, Any],
        chunk_ids: list[str],
        namespace: str = DEFAULT_NAMESPACE,
    ) -> None:
        self.doc_id = doc_id
        self.source = source
        self.title = title
        self.text = text
        self.checksum = checksum
        self.added_at = added_at
        self.meta = meta
        self.chunk_ids = chunk_ids
        self.namespace = namespace

    def to_dict(self) -> dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "source": self.source,
            "title": self.title,
            "checksum": self.checksum,
            "added_at": self.added_at,
            "meta": self.meta,
            "chunk_ids": self.chunk_ids,
            "namespace": self.namespace,
            "chars": len(self.text),
        }


class PersistentIndex:
    """Corpus + derived inverted index, persisted as one JSON file."""

    def __init__(
        self,
        root: str | Path,
        params: BM25Params = DEFAULT_PARAMS,
        chunk_chars: int = 1200,
        chunk_overlap: int = 150,
        index_file: str = DEFAULT_INDEX_FILE,
    ) -> None:
        self.root = Path(root)
        self.path = self.root / index_file
        self.params = params
        self.chunk_chars = max(64, int(chunk_chars))
        # Overlap must leave the window able to advance.
        self.chunk_overlap = max(0, min(int(chunk_overlap), self.chunk_chars // 2))

        self._documents: dict[str, Document] = {}
        self._chunks: dict[str, dict[str, Any]] = {}
        self._postings: dict[str, dict[str, int]] = {}
        self._lengths: dict[str, int] = {}
        self._total_len = 0
        self._loaded = False

    # --- persistence ---------------------------------------------------------

    def load(self) -> PersistentIndex:
        self.root.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._loaded = True
            return self

        raw = json.loads(self.path.read_text(encoding="utf-8"))
        version = int(raw.get("schema_version", 0))
        if version > SCHEMA_VERSION:
            raise ValueError(
                f"memory index schema v{version} is newer than supported v{SCHEMA_VERSION}"
            )

        self._documents = {}
        for entry in raw.get("documents", []):
            doc = Document(
                doc_id=entry["doc_id"],
                source=entry.get("source", ""),
                title=entry.get("title", ""),
                text=entry.get("text", ""),
                checksum=entry.get("checksum", ""),
                added_at=entry.get("added_at", ""),
                meta=entry.get("meta", {}) or {},
                chunk_ids=entry.get("chunk_ids", []),
                namespace=entry.get("namespace", DEFAULT_NAMESPACE),
            )
            self._documents[doc.doc_id] = doc

        self._chunks = {c["chunk_id"]: c for c in raw.get("chunks", [])}
        self._rebuild()
        self._loaded = True
        return self

    def _ensure_loaded(self) -> None:
        if not self._loaded:
            self.load()

    def save(self) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": SCHEMA_VERSION,
            "params": self.params.as_dict(),
            "chunk_chars": self.chunk_chars,
            "chunk_overlap": self.chunk_overlap,
            "documents": [
                {**doc.to_dict(), "text": doc.text} for doc in self._documents.values()
            ],
            "chunks": list(self._chunks.values()),
        }
        fd, tmp = tempfile.mkstemp(dir=str(self.root), prefix=".tmp-mem-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=1, ensure_ascii=False)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
        return self.path

    # --- index maintenance ---------------------------------------------------

    def _rebuild(self) -> None:
        """Derive postings, lengths and totals from the authoritative chunks."""
        self._postings = {}
        self._lengths = {}
        self._total_len = 0
        for chunk_id, chunk in self._chunks.items():
            tokens = tokenize(chunk["text"])
            self._lengths[chunk_id] = len(tokens)
            self._total_len += len(tokens)
            for term, tf in term_frequencies(tokens).items():
                self._postings.setdefault(term, {})[chunk_id] = tf

    def _index_chunks(self, chunks: list[dict[str, Any]]) -> None:
        """Incrementally add chunks.

        Postings are keyed by chunk id, so a new chunk cannot collide with an
        existing one and document frequency stays exact as ``len(posting)``.
        That is why incremental add is safe while removal must do a full
        rebuild - removal changes a posting's length in the other direction.
        """
        for chunk in chunks:
            chunk_id = chunk["chunk_id"]
            self._chunks[chunk_id] = chunk
            tokens = tokenize(chunk["text"])
            self._lengths[chunk_id] = len(tokens)
            self._total_len += len(tokens)
            for term, tf in term_frequencies(tokens).items():
                self._postings.setdefault(term, {})[chunk_id] = tf

    # --- ingestion -----------------------------------------------------------

    def add_document(
        self,
        text: str,
        source: str,
        title: str = "",
        meta: dict[str, Any] | None = None,
        doc_id: str | None = None,
        replace: bool = True,
        namespace: str = DEFAULT_NAMESPACE,
    ) -> str:
        """Add (or replace) one document. Returns its doc id.

        Re-ingesting the same ``source`` replaces it rather than duplicating,
        which is what makes ``rare index <dir>`` idempotent.
        """
        self._ensure_loaded()
        if not text or not text.strip():
            raise ValueError(f"refusing to index empty document: {source!r}")
        if not isinstance(namespace, str) or not namespace.strip():
            raise ValueError("namespace must be a non-empty string")
        namespace = namespace.strip()

        if doc_id is None:
            doc_id = f"doc_{_checksum(namespace + chr(0) + source + chr(0) + text)}"
        else:
            # Document IDs share one index-wide keyspace, so namespace the
            # caller-provided key to prevent cross-tenant chunk collisions.
            doc_id = f"{doc_id}_{_checksum(namespace)}"

        if replace:
            for existing_id, existing in list(self._documents.items()):
                if existing.source == source and existing.namespace == namespace:
                    self.remove_document(existing_id, save=False)

        spans: list[ChunkSpan] = chunk_text(
            text, size=self.chunk_chars, overlap=self.chunk_overlap
        )
        chunk_ids: list[str] = []
        new_chunks: list[dict[str, Any]] = []
        for position, span in enumerate(spans):
            chunk_id = f"{doc_id}:{position:04d}"
            chunk_ids.append(chunk_id)
            new_chunks.append(
                {
                    "chunk_id": chunk_id,
                    "doc_id": doc_id,
                    "position": position,
                    "start": span.start,
                    "end": span.end,
                    "text": span.text,
                }
            )

        doc = Document(
            doc_id=doc_id,
            source=source,
            title=title or Path(source).name or source,
            text=text,
            checksum=_checksum(text),
            added_at=_now(),
            meta=meta or {},
            chunk_ids=chunk_ids,
            namespace=namespace,
        )
        self._documents[doc_id] = doc
        self._index_chunks(new_chunks)
        return doc_id

    def add_file(
        self,
        path: str | Path,
        source: str | None = None,
        namespace: str = DEFAULT_NAMESPACE,
    ) -> str:
        file_path = Path(path)
        if not file_path.exists():
            raise FileNotFoundError(f"no such file: {file_path}")
        if file_path.is_dir():
            raise IsADirectoryError(f"is a directory: {file_path}")
        text = file_path.read_text(encoding="utf-8", errors="replace")
        return self.add_document(
            text,
            source=source or str(file_path),
            meta={"path": str(file_path)},
            namespace=namespace,
        )

    def remove_document(
        self,
        doc_id: str,
        save: bool = True,
        namespace: str | None = None,
    ) -> bool:
        self._ensure_loaded()
        doc = self._documents.get(doc_id)
        if doc is None or (namespace is not None and doc.namespace != namespace):
            return False
        self._documents.pop(doc_id)
        for chunk_id in doc.chunk_ids:
            self._chunks.pop(chunk_id, None)
        self._rebuild()
        if save:
            self.save()
        return True

    # --- query ---------------------------------------------------------------

    def search(
        self, query: str, top_k: int = 5, namespace: str | None = None
    ) -> list[SearchHit]:
        """Rank chunks against ``query``. Returns ``[]`` when nothing matches.

        ``namespace=None`` searches the whole index (the single-tenant default).
        Passing a namespace restricts both the candidate set and the scoring
        statistics to that boundary, so one tenant's documents can never
        influence another's ranking.
        """
        self._ensure_loaded()
        terms = query_terms(query)
        if not terms or not self._chunks:
            return []

        postings, lengths, total_len, n_docs = self._scoped_stats(namespace)
        if n_docs == 0:
            return []

        scores = search_scores(
            terms=terms,
            postings=postings,
            doc_freq={term: len(post) for term, post in postings.items()},
            lengths=lengths,
            total_len=total_len,
            n_docs=n_docs,
            params=self.params,
        )

        hits: list[SearchHit] = []
        for chunk_id, score in rank(scores, max(1, top_k)):
            chunk = self._chunks[chunk_id]
            doc = self._documents.get(chunk["doc_id"])
            hits.append(
                SearchHit(
                    chunk_id=chunk_id,
                    doc_id=chunk["doc_id"],
                    score=score,
                    text=chunk["text"],
                    start=chunk["start"],
                    end=chunk["end"],
                    source=doc.source if doc else "",
                    title=doc.title if doc else "",
                    meta=doc.meta if doc else {},
                    namespace=doc.namespace if doc else DEFAULT_NAMESPACE,
                )
            )
        return hits

    def _scoped_stats(
        self, namespace: str | None
    ) -> tuple[dict[str, dict[str, int]], dict[str, int], int, int]:
        """Postings/lengths restricted to one namespace.

        Scoping the *statistics*, not just the results, matters: if a query were
        scored against the whole corpus and filtered afterwards, a small
        namespace inside a large one would have its scores depressed by
        unrelated documents' average length, and ``top_k`` would be applied to
        the wrong candidate set. Both are silent quality bugs, so the filter is
        applied before scoring.

        ``namespace=None`` means "no boundary" and returns the global view.
        """
        if namespace is None:
            return (
                self._postings,
                self._lengths,
                self._total_len,
                len(self._chunks),
            )

        allowed = {
            chunk_id
            for chunk_id, chunk in self._chunks.items()
            if (doc := self._documents.get(chunk["doc_id"])) is not None
            and doc.namespace == namespace
        }
        if not allowed:
            return {}, {}, 0, 0

        postings: dict[str, dict[str, int]] = {}
        for term, posting in self._postings.items():
            scoped = {cid: tf for cid, tf in posting.items() if cid in allowed}
            if scoped:
                postings[term] = scoped
        lengths = {cid: self._lengths.get(cid, 0) for cid in allowed}
        return postings, lengths, sum(lengths.values()), len(allowed)

    # --- introspection -------------------------------------------------------

    def stats(self, namespace: str | None = None) -> dict[str, Any]:
        self._ensure_loaded()
        allowed_docs = [
            doc for doc in self._documents.values()
            if namespace is None or doc.namespace == namespace
        ]
        allowed_chunks = {
            chunk_id for doc in allowed_docs for chunk_id in doc.chunk_ids
        }
        total_tokens = sum(self._lengths.get(chunk_id, 0) for chunk_id in allowed_chunks)
        term_count = sum(
            any(chunk_id in allowed_chunks for chunk_id in posting)
            for posting in self._postings.values()
        )
        return {
            "documents": len(allowed_docs),
            "chunks": len(allowed_chunks),
            "terms": term_count,
            "total_tokens": total_tokens,
            "avg_tokens_per_chunk": (
                round(total_tokens / len(allowed_chunks), 1) if allowed_chunks else 0.0
            ),
            "params": self.params.as_dict(),
            "path": str(self.path),
        }

    def document(self, doc_id: str, namespace: str | None = None) -> Document | None:
        self._ensure_loaded()
        doc = self._documents.get(doc_id)
        if doc is not None and namespace is not None and doc.namespace != namespace:
            return None
        return doc

    def document_ids(self, namespace: str | None = None) -> list[str]:
        self._ensure_loaded()
        return [
            doc_id for doc_id, doc in self._documents.items()
            if namespace is None or doc.namespace == namespace
        ]

    def sources(self, namespace: str | None = None) -> list[str]:
        self._ensure_loaded()
        return sorted(
            doc.source for doc in self._documents.values()
            if namespace is None or doc.namespace == namespace
        )

    def clear(self, namespace: str | None = None) -> None:
        self._ensure_loaded()
        if namespace is None:
            self._documents = {}
            self._chunks = {}
        else:
            removed_ids = {
                doc_id for doc_id, doc in self._documents.items()
                if doc.namespace == namespace
            }
            self._documents = {
                doc_id: doc for doc_id, doc in self._documents.items()
                if doc_id not in removed_ids
            }
            self._chunks = {
                chunk_id: chunk for chunk_id, chunk in self._chunks.items()
                if chunk.get("doc_id") not in removed_ids
            }
        self._rebuild()
        self.save()
