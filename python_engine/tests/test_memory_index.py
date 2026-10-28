"""Tests for the persistent index, the retriever facade and the tools.

These exercise real files on disk in ``tmp_path``: atomic writes, reload from
disk, idempotent re-ingestion, and the tool surface the model actually sees.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from rare_engine.config import EngineConfig, MemoryConfig, ModelConfig, ToolConfig
from rare_engine.memory import PersistentIndex, Retriever, format_hits
from rare_engine.memory.retrieval import NOTE_PREFIX
from rare_engine.tools import ToolRegistry, build_registry


@pytest.fixture
def index(tmp_path: Path) -> PersistentIndex:
    return PersistentIndex(tmp_path / "mem", chunk_chars=200, chunk_overlap=20).load()


@pytest.fixture
def retriever(tmp_path: Path) -> Retriever:
    return Retriever(tmp_path / "mem", chunk_chars=200, chunk_overlap=20)


class TestPersistentIndex:
    def test_add_and_search(self, index: PersistentIndex) -> None:
        index.add_document(
            "The deployment pipeline runs on Kubernetes and uses Helm charts.",
            source="deploy.md",
        )
        hits = index.search("kubernetes helm")
        assert hits
        assert "Kubernetes" in hits[0].text

    def test_search_returns_empty_for_unknown_term(self, index: PersistentIndex) -> None:
        index.add_document("cats and dogs", source="pets.md")
        assert index.search("quantum chromodynamics") == []

    def test_empty_document_is_rejected(self, index: PersistentIndex) -> None:
        with pytest.raises(ValueError, match="empty document"):
            index.add_document("   ", source="blank.md")

    def test_persists_across_reload(self, tmp_path: Path) -> None:
        first = PersistentIndex(tmp_path / "mem", chunk_chars=200).load()
        first.add_document("The secret token is alpha-seven.", source="secret.md")
        first.save()

        second = PersistentIndex(tmp_path / "mem", chunk_chars=200).load()
        hits = second.search("secret token")
        assert hits
        assert "alpha-seven" in hits[0].text

    def test_reingest_same_source_replaces(self, index: PersistentIndex) -> None:
        index.add_document("version one content", source="doc.md")
        index.add_document("version two content", source="doc.md")
        assert index.stats()["documents"] == 1
        assert index.stats()["chunks"] == 1
        # Assert on the *distinctive* term. "version" is shared by both
        # revisions, so searching for it would legitimately match either.
        assert index.search("two")
        assert index.search("one") == []

    def test_remove_document(self, index: PersistentIndex) -> None:
        doc_id = index.add_document("removable text", source="gone.md")
        assert index.remove_document(doc_id) is True
        assert index.stats()["documents"] == 0
        assert index.search("removable") == []

    def test_remove_missing_returns_false(self, index: PersistentIndex) -> None:
        assert index.remove_document("doc_nonexistent") is False

    def test_stats_are_consistent(self, index: PersistentIndex) -> None:
        index.add_document("alpha beta gamma", source="a.md")
        stats = index.stats()
        assert stats["documents"] == 1
        assert stats["chunks"] >= 1
        assert stats["terms"] > 0
        assert stats["total_tokens"] > 0

    def test_offsets_point_into_source(self, index: PersistentIndex) -> None:
        text = "".join(f"Paragraph {i} about topic {i}.\n\n" for i in range(40))
        index.add_document(text, source="long.md")
        for hit in index.search("paragraph topic", top_k=5):
            assert text[hit.start : hit.end] == hit.text

    def test_save_is_atomic_no_temp_files_left(self, tmp_path: Path) -> None:
        idx = PersistentIndex(tmp_path / "mem").load()
        idx.add_document("content", source="x.md")
        idx.save()
        leftovers = [p.name for p in (tmp_path / "mem").iterdir() if p.name.startswith(".tmp-")]
        assert leftovers == []

    def test_rejects_newer_schema(self, tmp_path: Path) -> None:
        root = tmp_path / "mem"
        root.mkdir(parents=True)
        (root / "memory.json").write_text(
            json.dumps({"schema_version": 99, "documents": [], "chunks": []}),
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="newer than supported"):
            PersistentIndex(root).load()

    def test_corrupt_json_raises(self, tmp_path: Path) -> None:
        root = tmp_path / "mem"
        root.mkdir(parents=True)
        (root / "memory.json").write_text("{not json", encoding="utf-8")
        with pytest.raises(json.JSONDecodeError):
            PersistentIndex(root).load()

    def test_clear_empties_index(self, index: PersistentIndex) -> None:
        index.add_document("something", source="a.md")
        index.clear()
        assert index.stats()["documents"] == 0
        assert index.search("something") == []

    def test_top_k_is_respected(self, index: PersistentIndex) -> None:
        for i in range(10):
            index.add_document(f"common term document number {i}", source=f"d{i}.md")
        assert len(index.search("common term", top_k=3)) == 3

    def test_scores_are_descending(self, index: PersistentIndex) -> None:
        index.add_document("alpha alpha alpha beta", source="a.md")
        index.add_document("alpha beta gamma delta", source="b.md")
        scores = [h.score for h in index.search("alpha")]
        assert scores == sorted(scores, reverse=True)


class TestRetriever:
    def test_index_directory(self, retriever: Retriever, tmp_path: Path) -> None:
        docs = tmp_path / "docs"
        docs.mkdir()
        (docs / "a.md").write_text("The API rate limit is 100 requests per minute.")
        (docs / "b.md").write_text("Deployment uses blue-green strategy.")

        report = retriever.index_path(docs)
        assert report["count"] == 2
        assert retriever.search("rate limit")[0].source.endswith("a.md")

    def test_skips_binary_extensions_with_reason(
        self, retriever: Retriever, tmp_path: Path
    ) -> None:
        docs = tmp_path / "docs"
        docs.mkdir()
        (docs / "good.md").write_text("text content here")
        (docs / "image.png").write_bytes(b"\x89PNG\r\n\x1a\n")

        report = retriever.index_path(docs)
        assert report["count"] == 1
        assert any("unsupported extension" in s["reason"] for s in report["skipped"])

    def test_skips_empty_files(self, retriever: Retriever, tmp_path: Path) -> None:
        docs = tmp_path / "docs"
        docs.mkdir()
        (docs / "empty.md").write_text("   ")
        report = retriever.index_path(docs)
        assert report["count"] == 0
        assert any(s["reason"] == "empty" for s in report["skipped"])

    def test_missing_path_raises(self, retriever: Retriever) -> None:
        with pytest.raises(FileNotFoundError):
            retriever.index_path("/nonexistent/path/xyz")

    def test_remember_and_recall(self, retriever: Retriever) -> None:
        retriever.remember("The staging database password rotates every 30 days.", key="staging")
        hits = retriever.recall("staging database password")
        assert hits
        assert "rotates" in hits[0].text

    def test_remember_with_key_updates_not_duplicates(self, retriever: Retriever) -> None:
        retriever.remember("old value", key="config")
        retriever.remember("new value", key="config")
        notes = retriever.notes()
        assert len(notes) == 1
        assert notes[0].text == "new value"

    def test_remember_rejects_empty(self, retriever: Retriever) -> None:
        with pytest.raises(ValueError, match="empty"):
            retriever.remember("  ")

    def test_notes_are_tagged(self, retriever: Retriever) -> None:
        retriever.remember("a fact", key="fact1")
        notes = retriever.notes()
        assert notes[0].source == f"{NOTE_PREFIX}fact1"

    def test_notes_exclude_corpus_documents(
        self, retriever: Retriever, tmp_path: Path
    ) -> None:
        docs = tmp_path / "docs"
        docs.mkdir()
        (docs / "file.md").write_text("corpus content")
        retriever.index_path(docs)
        retriever.remember("a note", key="n1")
        assert len(retriever.notes()) == 1

    def test_notes_survive_reload(self, tmp_path: Path) -> None:
        first = Retriever(tmp_path / "mem")
        first.remember("durable fact about ports", key="ports")

        second = Retriever(tmp_path / "mem")
        hits = second.recall("durable fact ports")
        assert hits
        assert "ports" in hits[0].text


class TestFormatHits:
    def test_no_hits_message(self) -> None:
        assert format_hits([]) == "NO RESULTS"

    def test_includes_source_and_score(self, retriever: Retriever) -> None:
        retriever.remember("the answer is 42", key="answer")
        rendered = format_hits(retriever.recall("answer"))
        assert "note://answer" in rendered
        assert "score" in rendered

    def test_truncates_long_text(self, retriever: Retriever) -> None:
        retriever.remember("word " * 500, key="long")
        rendered = format_hits(retriever.recall("word"), max_chars=50)
        assert "..." in rendered


class TestRetrievalTools:
    def _config(self, tmp_path: Path, enabled: bool = True) -> EngineConfig:
        return EngineConfig(
            env="test",
            state_dir=str(tmp_path / "state"),
            default_model="echo",
            models={"echo": ModelConfig(id="echo", adapter="echo", model_ref="echo")},
            tools=ToolConfig(sandbox_root=str(tmp_path / "sandbox")),
            memory=MemoryConfig(enabled=enabled, dir=str(tmp_path / "mem")),
        )

    def test_tools_registered_when_memory_enabled(self, tmp_path: Path) -> None:
        registry = build_registry(self._config(tmp_path))
        assert "retrieve" in registry.names()
        assert "remember" in registry.names()

    def test_tools_absent_when_memory_disabled(self, tmp_path: Path) -> None:
        registry = build_registry(self._config(tmp_path, enabled=False))
        assert "retrieve" not in registry.names()
        assert "remember" not in registry.names()

    def test_tools_absent_without_retriever(self, tmp_path: Path) -> None:
        registry = ToolRegistry(sandbox_root=tmp_path / "sb")
        assert "retrieve" not in registry.names()

    async def test_retrieve_tool_returns_passages(self, tmp_path: Path) -> None:
        config = self._config(tmp_path)
        retriever = Retriever(config.memory_path)
        retriever.remember("The build timeout is 900 seconds.", key="build")
        registry = build_registry(config, retriever=retriever)

        result = await registry.call("retrieve", {"query": "build timeout"})
        assert result.ok
        assert "900" in result.output

    async def test_retrieve_tool_no_results(self, tmp_path: Path) -> None:
        config = self._config(tmp_path)
        registry = build_registry(config, retriever=Retriever(config.memory_path))
        result = await registry.call("retrieve", {"query": "nonexistentterm"})
        assert result.ok
        assert result.output == "NO RESULTS"

    async def test_retrieve_rejects_empty_query(self, tmp_path: Path) -> None:
        config = self._config(tmp_path)
        registry = build_registry(config, retriever=Retriever(config.memory_path))
        result = await registry.call("retrieve", {"query": "   "})
        assert not result.ok
        assert result.error_code == "tool_error"

    async def test_retrieve_clamps_top_k(self, tmp_path: Path) -> None:
        config = self._config(tmp_path)
        retriever = Retriever(config.memory_path)
        for i in range(30):
            retriever.remember(f"common token document {i}", key=f"k{i}")
        registry = build_registry(config, retriever=retriever)
        result = await registry.call("retrieve", {"query": "common token", "top_k": 999})
        assert result.ok
        # Clamped to 20, so at most 20 blocks are rendered.
        assert result.output.count("score") <= 20

    async def test_remember_tool_persists(self, tmp_path: Path) -> None:
        config = self._config(tmp_path)
        retriever = Retriever(config.memory_path)
        registry = build_registry(config, retriever=retriever)

        result = await registry.call("remember", {"text": "deploy key is zeta", "key": "dk"})
        assert result.ok
        assert "remembered" in result.output

        # A fresh retriever over the same directory must see it.
        assert Retriever(config.memory_path).recall("deploy key zeta")

    async def test_remember_requires_text(self, tmp_path: Path) -> None:
        config = self._config(tmp_path)
        registry = build_registry(config, retriever=Retriever(config.memory_path))
        result = await registry.call("remember", {})
        assert not result.ok
        assert result.error_code == "bad_arguments"
