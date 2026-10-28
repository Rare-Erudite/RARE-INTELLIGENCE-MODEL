"""Split documents into overlapping, offset-tracking chunks.

Why chunk at all
----------------
Retrieval quality depends on chunk size: too large and one chunk dilutes the
signal across unrelated sentences, too small and a single answer is split
across two chunks. The defaults (1200 chars, 150 overlap) are a reasonable
middle for prose and technical documentation, and they are configuration, not
constants.

Why offsets
-----------
Every :class:`ChunkSpan` records ``start``/``end`` into the original text. That
lets a caller quote the exact surrounding passage and lets tests assert that
chunks tile the source without losing or duplicating characters. Chunking bugs
are otherwise invisible - they just quietly degrade ranking.
"""

from __future__ import annotations

from dataclasses import dataclass

# Where a chunk may be cut, best first. Splitting on a paragraph break keeps
# a coherent thought in one chunk; falling back to a sentence or a word keeps
# us from slicing mid-token when a paragraph is longer than the window.
_BREAKS = ("\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ")


@dataclass(frozen=True)
class ChunkSpan:
    """One chunk of a document, with its position in the source text."""

    start: int
    end: int
    text: str

    @property
    def length(self) -> int:
        return self.end - self.start


def _find_break(text: str, start: int, window_end: int, min_end: int) -> int:
    """Best cut position in ``[min_end, window_end)``, or ``window_end``.

    ``min_end`` guards against a degenerate cut that would not advance far
    enough, which would otherwise let overlap produce chunks shorter than the
    overlap itself and loop forever.
    """
    for marker in _BREAKS:
        idx = text.rfind(marker, min_end, window_end)
        if idx != -1:
            # Cut *after* the marker so the delimiter stays with its sentence.
            return idx + len(marker)
    return window_end


def chunk_text(text: str, size: int = 1200, overlap: int = 150) -> list[ChunkSpan]:
    """Split ``text`` into spans of at most ``size`` chars, overlapping by ``overlap``.

    Every character of the source appears in at least one chunk, and the spans
    are strictly increasing, so concatenating them in order reconstructs the
    document plus the intentional overlap. An empty or whitespace-only input
    yields no chunks rather than one empty chunk.
    """
    if not text or not text.strip():
        return []

    size = max(64, int(size))
    overlap = max(0, min(int(overlap), size // 2))

    spans: list[ChunkSpan] = []
    start = 0
    total = len(text)

    while start < total:
        window_end = min(start + size, total)
        if window_end >= total:
            end = total
        else:
            # Require the cut to be past the halfway mark so the next window
            # still advances by a meaningful amount.
            min_end = start + max(1, (window_end - start) // 2)
            end = _find_break(text, start, window_end, min_end)
            if end <= start:
                end = window_end

        spans.append(ChunkSpan(start=start, end=end, text=text[start:end]))

        if end >= total:
            break

        next_start = end - overlap
        # Guarantee progress: never revisit or stall at the same offset.
        if next_start <= start:
            next_start = end
        start = next_start

    return spans
