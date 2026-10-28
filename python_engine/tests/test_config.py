"""Config loading tests: precedence, validation, env overrides."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from rare_engine.config import load_config
from rare_engine.errors import ConfigError, ModelNotFoundError


def _write(tmp_path: Path, data: dict) -> Path:
    path = tmp_path / "engine.yaml"
    path.write_text(yaml.safe_dump(data))
    return path


def _minimal() -> dict:
    return {
        "default_model": "m1",
        "models": {"m1": {"id": "m1", "adapter": "echo", "model_ref": "echo"}},
    }


def test_loads_minimal_config(tmp_path: Path):
    cfg = load_config(_write(tmp_path, _minimal()))
    assert cfg.default_model == "m1"
    assert cfg.model().adapter == "echo"


def test_missing_explicit_path_raises(tmp_path: Path):
    with pytest.raises(ConfigError, match="not found"):
        load_config(tmp_path / "nope.yaml")


def test_default_model_must_exist(tmp_path: Path):
    data = _minimal()
    data["default_model"] = "ghost"
    with pytest.raises(ConfigError):
        load_config(_write(tmp_path, data))


def test_unknown_model_lookup_raises(tmp_path: Path):
    cfg = load_config(_write(tmp_path, _minimal()))
    with pytest.raises(ModelNotFoundError):
        cfg.model("ghost")


def test_invalid_temperature_rejected(tmp_path: Path):
    data = _minimal()
    data["models"]["m1"]["temperature"] = 5.0
    with pytest.raises(ConfigError):
        load_config(_write(tmp_path, data))


def test_zero_context_window_rejected(tmp_path: Path):
    data = _minimal()
    data["models"]["m1"]["context_window"] = 0
    with pytest.raises(ConfigError):
        load_config(_write(tmp_path, data))


def test_env_override_wins(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("RARE_LOG_LEVEL", "DEBUG")
    monkeypatch.setenv("RARE_MAX_STEPS", "3")
    cfg = load_config(_write(tmp_path, _minimal()))
    assert cfg.log_level == "DEBUG"
    assert cfg.orchestrator.max_steps == 3


def test_env_bool_coercion(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("RARE_ENABLE_SHELL", "true")
    cfg = load_config(_write(tmp_path, _minimal()))
    assert cfg.tools.enable_shell is True


def test_env_allowlist_parsing(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("RARE_TOOL_ALLOWLIST", "read_file, write_file")
    cfg = load_config(_write(tmp_path, _minimal()))
    assert cfg.tools.allowlist == ["read_file", "write_file"]


def test_explicit_overrides_beat_env(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("RARE_LOG_LEVEL", "DEBUG")
    cfg = load_config(_write(tmp_path, _minimal()), overrides={"log_level": "WARNING"})
    assert cfg.log_level == "WARNING"


def test_derived_paths_are_absolute(tmp_path: Path):
    cfg = load_config(_write(tmp_path, _minimal()))
    assert cfg.state_path.is_absolute()
    assert cfg.sandbox_path.is_absolute()
    assert cfg.task_db_path.name == "tasks.db"


def test_ensure_dirs_creates_state_and_sandbox(tmp_path: Path):
    data = _minimal()
    data["state_dir"] = str(tmp_path / "st")
    data["tools"] = {"sandbox_root": str(tmp_path / "sb")}
    cfg = load_config(_write(tmp_path, data))
    cfg.ensure_dirs()
    assert (tmp_path / "st").is_dir()
    assert (tmp_path / "sb").is_dir()
    assert (tmp_path / "st" / "logs").is_dir()


def test_repo_default_config_is_valid():
    """The shipped config/engine.yaml must always load."""
    cfg = load_config()
    assert cfg.default_model in cfg.models
    assert cfg.models[cfg.default_model].adapter == "llamacpp"


def test_remote_model_promoted_from_env(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("RARE_OPENAI_BASE_URL", "http://localhost:1234/v1")
    monkeypatch.setenv("RARE_OPENAI_MODEL", "local-model")
    cfg = load_config(_write(tmp_path, _minimal()))
    assert "remote-openai-compat" in cfg.models
    assert cfg.models["remote-openai-compat"].model_ref == "local-model"
