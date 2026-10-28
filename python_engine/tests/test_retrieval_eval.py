"""Tests for the retrieval evaluation suite and namespace isolation.

These are regression guards, not quality claims. They assert that the harness
keeps measuring what it says it measures, and that namespace isolation cannot
silently regress. The actual scores live in TEST_REPORT.md and are produced by
``python benchmarks/retrieval_eval.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmarks.retrieval_eval import CASES, CORPUS, build_index, run, score_case  # noqa: E402
from rare_engine.memory.index import DEFAULT_NAMESPACE, PersistentIndex  # noqa: E402


class TestNamespaceIsolation:
    def test_documents_default_to_default_namespace(self, tmp_path):
        index = PersistentIndex(tmp_path)
        doc_id = index.add_document("some text", source="a.md")
        assert index.document(doc_id).namespace == DEFAULT_NAMESPACE

    def test_namespace_survives_reload(self, tmp_path):
        index = PersistentIndex(tmp_path)
        index.add_document("alpha content", source="a.md", namespace="tenant_a")
        index.save()

        reloaded = PersistentIndex(tmp_path)
        hits = reloaded.search("alpha", namespace="tenant_a")
        assert len(hits) == 1
        assert reloaded.document(hits[0].doc_id).namespace == "tenant_a"

    def test_search_in_one_namespace_cannot_see_another(self, tmp_path):
        index = PersistentIndex(tmp_path)
        index.add_document(
            "tenant A secret rotation is 30 days", source="a.md", namespace="tenant_a"
        )
        index.add_document(
            "tenant B secret rotation is 90 days", source="b.md", namespace="tenant_b"
        )

        hits_a = index.search("secret rotation", namespace="tenant_a")
        assert [h.source for h in hits_a] == ["a.md"]

        hits_b = index.search("secret rotation", namespace="tenant_b")
        assert [h.source for h in hits_b] == ["b.md"]

    def test_unknown_namespace_returns_nothing(self, tmp_path):
        index = PersistentIndex(tmp_path)
        index.add_document("alpha content", source="a.md", namespace="tenant_a")
        assert index.search("alpha", namespace="tenant_zzz") == []

    def test_none_namespace_sees_everything(self, tmp_path):
        index = PersistentIndex(tmp_path)
        index.add_document("alpha content", source="a.md", namespace="tenant_a")
        index.add_document("alpha content", source="b.md", namespace="tenant_b")
        assert len(index.search("alpha", namespace=None)) == 2

    def test_scoping_changes_statistics_not_just_results(self, tmp_path):
        """A tiny namespace must not be scored against the whole corpus.

        If filtering happened after scoring, the small namespace's scores would
        be depressed by the large one's average document length. This asserts
        the score is identical to searching that namespace in isolation.
        """
        isolated = PersistentIndex(tmp_path / "isolated")
        isolated.add_document("alpha beta", source="a.md", namespace="small")
        isolated_score = isolated.search("alpha", namespace="small")[0].score

        mixed = PersistentIndex(tmp_path / "mixed")
        mixed.add_document("alpha beta", source="a.md", namespace="small")
        for i in range(20):
            mixed.add_document(
                "filler " * 200 + f"document {i}", source=f"f{i}.md", namespace="big"
            )
        mixed_score = mixed.search("alpha", namespace="small")[0].score

        assert mixed_score == pytest.approx(isolated_score, rel=1e-9)


class TestScoring:
    def test_negative_control_passes_only_when_nothing_returned(self):
        case = next(c for c in CASES if c.id == "neg_mongolia")
        assert score_case(case, [], 3).passed is True
        assert score_case(case, ["doc_auth"], 3).passed is False

    def test_recall_requires_all_relevant_documents(self):
        case = next(c for c in CASES if c.id == "hop_incident")
        assert len(case.relevant) == 2
        # One of two found: recall 0.5, so the case fails.
        result = score_case(case, ["doc_incident"], 3)
        assert result.recall == 0.5
        assert result.passed is False

    def test_mrr_uses_first_relevant_rank(self):
        case = next(c for c in CASES if c.id == "direct_storage")
        result = score_case(case, ["doc_auth", "doc_storage"], 3)
        assert result.reciprocal_rank == pytest.approx(0.5)

    def test_precision_divides_by_k_not_by_hits(self):
        case = next(c for c in CASES if c.id == "direct_storage")
        result = score_case(case, ["doc_storage"], 3)
        assert result.precision == pytest.approx(1 / 3)


class TestEvalSuite:
    def test_corpus_and_cases_are_well_formed(self):
        doc_ids = {doc_id for doc_id, _, _ in CORPUS}
        assert len(doc_ids) == len(CORPUS), "duplicate doc ids in corpus"
        for case in CASES:
            missing = case.relevant - doc_ids
            assert not missing, f"{case.id} references unknown docs: {missing}"

    def test_every_category_is_represented(self):
        categories = {case.category for case in CASES}
        assert {"direct", "paraphrase", "synonym", "multi_hop",
                "distractor", "contradiction", "negative", "isolation"} <= categories

    def test_isolation_cases_actually_use_a_namespace(self):
        isolation = [c for c in CASES if c.category == "isolation"]
        assert isolation
        assert all(c.namespace for c in isolation)

    def test_run_produces_all_metrics(self):
        report = run(k=3)
        overall = report["overall"]
        for key in ("precision@k", "recall@k", "mrr", "negative_control_accuracy"):
            assert key in overall
            assert 0.0 <= overall[key] <= 1.0

    def test_isolation_cases_pass(self):
        """Isolation is a correctness property, not a quality score.

        Unlike the paraphrase cases, a leak here is a bug, so this is asserted
        rather than merely reported.
        """
        report = run(k=3)
        assert report["by_category"]["isolation"]["passed"] == 2

    def test_negative_controls_are_not_all_passing(self):
        """Guards against a corpus so easy the controls are meaningless.

        If every negative control passed, the controls would not be adversarial
        and the accuracy figure would be uninformative. This asserts the suite
        still contains at least one genuinely hard control.
        """
        report = run(k=3)
        assert report["overall"]["negative_control_accuracy"] < 1.0

    def test_build_index_is_reproducible(self, tmp_path):
        first = build_index(tmp_path / "one")
        second = build_index(tmp_path / "two")
        assert first.stats()["documents"] == second.stats()["documents"]
        assert first.stats()["chunks"] == second.stats()["chunks"]
