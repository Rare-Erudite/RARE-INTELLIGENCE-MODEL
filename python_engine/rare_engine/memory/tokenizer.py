"""Tokenisation and light normalisation for the lexical index.

Why lexical
------------
The engine needs retrieval that genuinely works with no downloads and a
measured 2 GiB memory ceiling (see MODEL_REGISTRY.md). Dense embeddings need a
sentence-transformer checkpoint plus torch - neither is present and neither
fits comfortably in that envelope. So the shipped retriever is BM25, which is
a real, proven ranking function with zero dependencies.

Why so conservative
-------------------
This normaliser only folds case, splits on non-alphanumerics and reduces
plurals. No Porter/Snowball stemming: an aggressive stemmer silently conflates
terms, which turns a ranking bug into an unexplainable mystery.

The cost of being conservative is stated plainly in KNOWN_LIMITATIONS.md:
``retrieve`` will not match ``retrieval``. Dense retrieval is the planned
upgrade, not a capability we pretend to already have.
"""

from __future__ import annotations

import re

_TOKEN_RE = re.compile(r"[a-z0-9]+")

STOPWORDS = frozenset(
    """
    a an the and or but if then than that this these those there here
    of in on at to for from by with without into over under again further
    is are was were be been being am do does did doing have has had having
    i you he she it we they me him her them us my your his its our their
    what which who whom whose when where why how all any both each few more
    most other some such no nor not only own same so too very can will just
    should now as about above after before below between during through
    """.split()
)


def singularize(word: str) -> str:
    """Reduce a simple English plural to its singular.

    Deliberately narrow: only the endings that are unambiguous enough to be
    safe. ``analysis`` must not become ``analysi``, so ``-ss`` and ``-us`` are
    protected.
    """
    if len(word) <= 3:
        return word
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith(("sses", "shes", "ches", "xes", "zes")):
        return word[:-2]
    # Protect Greek/Latin -sis and -us nouns (analysis, basis, status, bus):
    # stripping the 's' would produce a non-word that never matches anything.
    if word.endswith(("ss", "us", "sis")):
        return word
    if word.endswith("s"):
        return word[:-1]
    return word


def tokenize(text: str, *, keep_stopwords: bool = False) -> list[str]:
    """Lowercase, split, reduce plurals, drop stopwords. Order is preserved."""
    if not text:
        return []
    raw = _TOKEN_RE.findall(text.lower())
    out: list[str] = []
    for token in raw:
        if not keep_stopwords and token in STOPWORDS:
            continue
        out.append(singularize(token))
    return out


def term_frequencies(tokens: list[str]) -> dict[str, int]:
    """Count occurrences of each term."""
    counts: dict[str, int] = {}
    for token in tokens:
        counts[token] = counts.get(token, 0) + 1
    return counts


def query_terms(text: str) -> list[str]:
    """Distinct query terms, order preserved (dedupe keeps scored terms unique)."""
    seen: set[str] = set()
    out: list[str] = []
    for token in tokenize(text):
        if token not in seen:
            seen.add(token)
            out.append(token)
    return out
