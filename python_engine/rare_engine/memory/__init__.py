"""Durable memory and retrieval.

Layers
------
``tokenizer``  text -> normalised terms (no downloads, no GPU)
``bm25``       the ranking math, pure functions, no I/O
``chunking``   documents -> overlapping, offset-tracking spans
``index``      a persistent, atomically-written lexical index
``retrieval``  the facade: ingest files/text, search, remember/recall

The split exists so the ranking math can be tested without any filesystem,
and the storage can be tested without any ranking surprises.
"""

from .chunking import ChunkSpan, chunk_text
from .index import Document, PersistentIndex, SearchHit
from .retrieval import Retriever, format_hits

__all__ = [
    "ChunkSpan",
    "Document",
    "PersistentIndex",
    "Retriever",
    "SearchHit",
    "chunk_text",
    "format_hits",
]
