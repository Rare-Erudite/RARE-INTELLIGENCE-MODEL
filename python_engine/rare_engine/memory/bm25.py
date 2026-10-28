"""BM25 ranking, as pure functions over plain dicts.

Nothing here touches the filesystem or the network, so the ranking behaviour
can be tested exhaustively and deterministically.

Formula (the standard Okapi BM25):

    idf(t)      = ln(1 + (N - df + 0.5) / (df + 0.5))
    score(D, q) = sum over t in q of
                  idf(t) * tf(t,D) * (k1 + 1)
                  / (tf(t,D) + k1 * (1 - b + b * |D| / avgdl))

``k1`` controls term-frequency saturation, ``b`` how strongly document length
is normalised. The defaults (1.5, 0.75) are the values used almost everywhere in
the literature and are not tuned to this corpus - tuning on the evaluation set
would make the evaluation worthless.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class BM25Params:
    k1: float = 1.5
    b: float = 0.75

    def as_dict(self) -> dict[str, float]:
        return {"k1": self.k1, "b": self.b}


DEFAULT_PARAMS = BM25Params()


def idf(n_docs: int, doc_freq: int) -> float:
    """BM25 inverse document frequency, always positive.

    The ``1 +`` form is used deliberately: it cannot go negative for terms that
    appear in more than half the corpus, which the classic form can. A negative
    weight would make a *more* relevant document score lower.
    """
    if n_docs <= 0 or doc_freq <= 0:
        return 0.0
    return math.log(1.0 + (n_docs - doc_freq + 0.5) / (doc_freq + 0.5))


def search_scores(
    terms: list[str],
    postings: dict[str, dict[str, int]],
    doc_freq: dict[str, int],
    lengths: dict[str, int],
    total_len: int,
    n_docs: int,
    params: BM25Params = DEFAULT_PARAMS,
) -> dict[str, float]:
    """Score every document that contains at least one query term.

    Returns ``{chunk_id: score}``. Documents matching no term are absent rather
    than present with score 0, so a caller can never mistake "no match" for
    "weak match".
    """
    if not terms or n_docs <= 0 or total_len <= 0:
        return {}

    avgdl = total_len / n_docs
    if avgdl <= 0:
        return {}

    scores: dict[str, float] = {}
    for term in terms:
        posting = postings.get(term)
        if not posting:
            continue
        weight = idf(n_docs, doc_freq.get(term, 0))
        if weight <= 0:
            continue
        for chunk_id, tf in posting.items():
            dl = lengths.get(chunk_id, 0)
            denom = tf + params.k1 * (1.0 - params.b + params.b * dl / avgdl)
            if denom <= 0:
                continue
            scores[chunk_id] = scores.get(chunk_id, 0.0) + weight * tf * (params.k1 + 1.0) / denom
    return scores


def rank(scores: dict[str, float], top_k: int) -> list[tuple[str, float]]:
    """Top-k by descending score, with the chunk id as a stable tie-break."""
    ordered = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    return ordered[:top_k]
