"""Tests for tokenisation, BM25 math and chunking.

These are pure-function tests: no filesystem, no model, no network. If the
ranking math is wrong, it is wrong here first.
"""

from __future__ import annotations

import math

import pytest

from rare_engine.memory.bm25 import BM25Params, idf, rank, search_scores
from rare_engine.memory.chunking import chunk_text
from rare_engine.memory.tokenizer import (
    query_terms,
    singularize,
    term_frequencies,
    tokenize,
)


class TestTokenizer:
    def test_lowercases_and_splits(self) -> None:
        assert tokenize("Hello World") == ["hello", "world"]

    def test_drops_stopwords(self) -> None:
        assert "the" not in tokenize("the cat sat on the mat")

    def test_keeps_stopwords_when_asked(self) -> None:
        assert "the" in tokenize("the cat", keep_stopwords=True)

    def test_strips_punctuation(self) -> None:
        assert tokenize("port=8080, host:localhost!") == ["port", "8080", "host", "localhost"]

    def test_empty_input(self) -> None:
        assert tokenize("") == []
        assert tokenize("   ") == []

    @pytest.mark.parametrize(
        ("word", "expected"),
        [
            ("cats", "cat"),
            ("policies", "policy"),
            ("boxes", "box"),
            ("dishes", "dish"),
            ("classes", "class"),
            # Protected endings: these must NOT be mangled.
            ("analysis", "analysis"),
            ("status", "status"),
            ("class", "class"),
            ("bus", "bus"),
            ("is", "is"),
        ],
    )
    def test_singularize(self, word: str, expected: str) -> None:
        assert singularize(word) == expected

    def test_term_frequencies(self) -> None:
        assert term_frequencies(["a", "a", "b"]) == {"a": 2, "b": 1}

    def test_query_terms_dedupes_preserving_order(self) -> None:
        assert query_terms("cat cat dog") == ["cat", "dog"]


class TestIDF:
    def test_positive_for_common_term(self) -> None:
        # A term in 9 of 10 docs must still have positive weight; the classic
        # (non +1) BM25 form would go negative here and invert the ranking.
        assert idf(10, 9) > 0

    def test_rarer_term_weighs_more(self) -> None:
        assert idf(100, 1) > idf(100, 50)

    def test_degenerate_inputs(self) -> None:
        assert idf(0, 0) == 0.0
        assert idf(10, 0) == 0.0

    def test_matches_formula(self) -> None:
        expected = math.log(1 + (10 - 2 + 0.5) / (2 + 0.5))
        assert idf(10, 2) == pytest.approx(expected)


class TestBM25Scoring:
    def _corpus(self):
        # Two chunks: one about cats, one about databases.
        postings = {
            "cat": {"c1": 2},
            "database": {"c2": 3},
            "query": {"c1": 1, "c2": 1},
        }
        doc_freq = {term: len(post) for term, post in postings.items()}
        lengths = {"c1": 10, "c2": 10}
        return postings, doc_freq, lengths

    def test_ranks_matching_chunk_first(self) -> None:
        postings, doc_freq, lengths = self._corpus()
        scores = search_scores(
            ["cat"], postings, doc_freq, lengths, total_len=20, n_docs=2
        )
        assert set(scores) == {"c1"}
        assert scores["c1"] > 0

    def test_no_match_returns_empty_not_zero(self) -> None:
        postings, doc_freq, lengths = self._corpus()
        scores = search_scores(
            ["zebra"], postings, doc_freq, lengths, total_len=20, n_docs=2
        )
        # Absent, not present-with-0: a caller must not confuse the two.
        assert scores == {}

    def test_higher_term_frequency_scores_higher(self) -> None:
        postings = {"cat": {"low": 1, "high": 5}}
        doc_freq = {"cat": 2}
        lengths = {"low": 10, "high": 10}
        scores = search_scores(
            ["cat"], postings, doc_freq, lengths, total_len=20, n_docs=2
        )
        assert scores["high"] > scores["low"]

    def test_length_normalisation_favours_shorter_doc(self) -> None:
        postings = {"cat": {"short": 1, "long": 1}}
        doc_freq = {"cat": 2}
        lengths = {"short": 5, "long": 100}
        scores = search_scores(
            ["cat"], postings, doc_freq, lengths, total_len=105, n_docs=2
        )
        assert scores["short"] > scores["long"]

    def test_empty_query_scores_nothing(self) -> None:
        postings, doc_freq, lengths = self._corpus()
        assert search_scores([], postings, doc_freq, lengths, 20, 2) == {}

    def test_zero_corpus_is_safe(self) -> None:
        assert search_scores(["cat"], {}, {}, {}, 0, 0) == {}

    def test_b_parameter_zero_disables_length_norm(self) -> None:
        postings = {"cat": {"short": 1, "long": 1}}
        doc_freq = {"cat": 2}
        lengths = {"short": 5, "long": 100}
        scores = search_scores(
            ["cat"], postings, doc_freq, lengths, 105, 2,
            params=BM25Params(k1=1.5, b=0.0),
        )
        assert scores["short"] == pytest.approx(scores["long"])

    def test_rank_orders_and_truncates(self) -> None:
        ranked = rank({"a": 1.0, "b": 3.0, "c": 2.0}, top_k=2)
        assert [k for k, _ in ranked] == ["b", "c"]

    def test_rank_is_deterministic_on_ties(self) -> None:
        first = rank({"b": 1.0, "a": 1.0}, top_k=2)
        second = rank({"a": 1.0, "b": 1.0}, top_k=2)
        assert first == second == [("a", 1.0), ("b", 1.0)]


class TestChunking:
    def test_empty_input_yields_no_chunks(self) -> None:
        assert chunk_text("") == []
        assert chunk_text("   \n  ") == []

    def test_short_text_is_one_chunk(self) -> None:
        spans = chunk_text("hello world", size=100, overlap=10)
        assert len(spans) == 1
        assert spans[0].text == "hello world"
        assert spans[0].start == 0
        assert spans[0].end == 11

    def test_long_text_splits(self) -> None:
        text = "word " * 500
        spans = chunk_text(text, size=200, overlap=20)
        assert len(spans) > 1

    def test_chunks_cover_entire_source(self) -> None:
        text = "".join(f"Sentence number {i}. " for i in range(200))
        spans = chunk_text(text, size=300, overlap=50)
        # Every character must be inside at least one chunk.
        covered = set()
        for span in spans:
            covered.update(range(span.start, span.end))
        assert covered == set(range(len(text)))

    def test_offsets_match_text(self) -> None:
        text = "".join(f"Line {i} of the document.\n" for i in range(100))
        for span in chunk_text(text, size=250, overlap=40):
            assert text[span.start : span.end] == span.text

    def test_spans_are_strictly_increasing(self) -> None:
        text = "x" * 5000
        spans = chunk_text(text, size=200, overlap=50)
        starts = [s.start for s in spans]
        assert starts == sorted(starts)
        assert len(set(starts)) == len(starts)

    def test_terminates_with_huge_overlap(self) -> None:
        # Overlap is clamped to size//2; without that clamp this would loop.
        spans = chunk_text("y" * 2000, size=100, overlap=10_000)
        assert len(spans) < 100

    def test_respects_size_bound(self) -> None:
        text = "z" * 3000
        for span in chunk_text(text, size=200, overlap=20):
            assert span.length <= 200

    def test_prefers_paragraph_breaks(self) -> None:
        text = "A" * 100 + "\n\n" + "B" * 100
        spans = chunk_text(text, size=150, overlap=0)
        # The first cut should land on the paragraph break, not mid-'A'.
        assert spans[0].text.endswith("\n\n")
