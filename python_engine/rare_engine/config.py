"""Configuration loading and validation.

Precedence (highest wins):

1. Explicit constructor arguments
2. Environment variables (``RARE_*``)
3. YAML file (``config/engine.yaml`` by default)
4. Built-in defaults

Every value is validated by pydantic at load time, so a bad config fails fast
with a precise message instead of surfacing as a confusing runtime error.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

from .errors import ConfigError, ModelNotFoundError

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = REPO_ROOT / "config" / "engine.yaml"


class ModelConfig(BaseModel):
    """Declarative description of one usable model."""

    id: str = Field(..., description="Stable engine-side identifier, e.g. 'qwen3-0.6b-instruct-q4km'")
    adapter: Literal["llamacpp", "openai_compat", "echo"] = "llamacpp"
    model_ref: str = Field(
        default="",
        description="Upstream identifier: HF repo id, GGUF path, or remote model name.",
    )
    display_name: str = ""
    context_window: int = 4096
    max_tokens: int = 512
    temperature: float = 0.2
    top_p: float = 0.95
    n_threads: int = 0
    n_gpu_layers: int = 0
    # Chat template family. "chatml" enables the no-think prefill path.
    chat_format: str = "chatml"
    # Qwen3-style reasoning blocks. Off by default: on a small token budget the
    # think block consumes the whole completion and no action is emitted.
    enable_thinking: bool = False
    stop: list[str] = Field(default_factory=list)
    # Free-form, documented in MODEL_REGISTRY.md
    notes: str = ""
    extra: dict[str, Any] = Field(default_factory=dict)

    @field_validator("context_window", "max_tokens")
    @classmethod
    def _positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("must be > 0")
        return v

    @field_validator("temperature")
    @classmethod
    def _temp_range(cls, v: float) -> float:
        if not 0.0 <= v <= 2.0:
            raise ValueError("temperature must be within [0, 2]")
        return v


class ToolConfig(BaseModel):
    allowlist: list[str] = Field(default_factory=list)
    sandbox_root: str = ".rare/sandbox"
    enable_shell: bool = False
    shell_timeout_s: int = 60
    max_output_chars: int = 20_000


class MemoryConfig(BaseModel):
    """Durable memory and retrieval settings.

    ``enabled`` gates the ``retrieve`` and ``remember`` tools. Turning it off is
    a real option: a run that cannot benefit from a corpus should not pay for
    the tool slots in its prompt.
    """

    enabled: bool = True
    dir: str = ".rare/memory"
    chunk_chars: int = 1200
    chunk_overlap: int = 150
    top_k: int = 4
    max_snippet_chars: int = 400


class OrchestratorConfig(BaseModel):
    task_timeout_s: int = 900
    model_timeout_s: int = 180
    max_steps: int = 24
    max_retries: int = 2
    retry_backoff_s: float = 1.5
    max_model_calls: int = 40
    max_tool_calls: int = 60


class EngineConfig(BaseModel):
    env: str = "development"
    state_dir: str = ".rare"
    log_level: str = "INFO"
    log_format: Literal["json", "text"] = "json"
    default_model: str = "qwen3-0.6b-instruct-q4km"
    models: dict[str, ModelConfig] = Field(default_factory=dict)
    orchestrator: OrchestratorConfig = Field(default_factory=OrchestratorConfig)
    tools: ToolConfig = Field(default_factory=ToolConfig)
    memory: MemoryConfig = Field(default_factory=MemoryConfig)
    integration_enabled: bool = False

    # --- Derived paths -------------------------------------------------------
    @property
    def state_path(self) -> Path:
        p = Path(self.state_dir)
        return p if p.is_absolute() else REPO_ROOT / p

    @property
    def task_db_path(self) -> Path:
        return self.state_path / "tasks.db"

    @property
    def memory_path(self) -> Path:
        """Directory holding the persistent retrieval index."""
        p = Path(self.memory.dir)
        return p if p.is_absolute() else REPO_ROOT / p

    @property
    def log_dir(self) -> Path:
        return self.state_path / "logs"

    @property
    def sandbox_path(self) -> Path:
        p = Path(self.tools.sandbox_root)
        return p if p.is_absolute() else REPO_ROOT / p

    def model(self, model_id: str | None = None) -> ModelConfig:
        key = model_id or self.default_model
        if key not in self.models:
            raise ModelNotFoundError(
                f"model '{key}' is not declared in config",
                available=sorted(self.models),
            )
        return self.models[key]

    @model_validator(mode="after")
    def _default_model_exists(self) -> EngineConfig:
        if self.models and self.default_model not in self.models:
            raise ValueError(
                f"default_model '{self.default_model}' not present in models "
                f"({sorted(self.models)})"
            )
        return self

    def ensure_dirs(self) -> None:
        paths = [self.state_path, self.log_dir, self.sandbox_path]
        if self.memory.enabled:
            paths.append(self.memory_path)
        for path in paths:
            path.mkdir(parents=True, exist_ok=True)


# --- Environment overrides ---------------------------------------------------

_ENV_MAP: dict[str, tuple[str, ...]] = {
    "RARE_ENV": ("env",),
    "RARE_STATE_DIR": ("state_dir",),
    "RARE_LOG_LEVEL": ("log_level",),
    "RARE_LOG_FORMAT": ("log_format",),
    "RARE_DEFAULT_MODEL": ("default_model",),
    "RARE_TASK_TIMEOUT_S": ("orchestrator", "task_timeout_s"),
    "RARE_MODEL_TIMEOUT_S": ("orchestrator", "model_timeout_s"),
    "RARE_MAX_STEPS": ("orchestrator", "max_steps"),
    "RARE_SANDBOX_ROOT": ("tools", "sandbox_root"),
    "RARE_ENABLE_SHELL": ("tools", "enable_shell"),
    "RARE_SHELL_TIMEOUT_S": ("tools", "shell_timeout_s"),
    "RARE_TOOL_ALLOWLIST": ("tools", "allowlist"),
    "RARE_INTEGRATION_ENABLED": ("integration_enabled",),
    "RARE_MEMORY_ENABLED": ("memory", "enabled"),
    "RARE_MEMORY_DIR": ("memory", "dir"),
    "RARE_MEMORY_TOP_K": ("memory", "top_k"),
}

_BOOL_TRUE = {"1", "true", "yes", "on"}


def _coerce(raw: str, current: Any) -> Any:
    if isinstance(current, bool):
        return raw.strip().lower() in _BOOL_TRUE
    if isinstance(current, int):
        return int(raw)
    if isinstance(current, float):
        return float(raw)
    if isinstance(current, list):
        return [x.strip() for x in raw.split(",") if x.strip()]
    # A list-typed field whose YAML default is absent arrives as None, so the
    # type cannot be inferred from `current`. Comma-split those explicitly.
    if current is None and "," in raw:
        return [x.strip() for x in raw.split(",") if x.strip()]
    return raw


def _apply_env(data: dict[str, Any]) -> dict[str, Any]:
    for env_key, path in _ENV_MAP.items():
        raw = os.environ.get(env_key)
        if raw is None or raw == "":
            continue
        node: Any = data
        for part in path[:-1]:
            node = node.setdefault(part, {})
        current = node.get(path[-1])
        node[path[-1]] = _coerce(raw, current)
    return data


def _apply_model_env(data: dict[str, Any]) -> dict[str, Any]:
    """Apply model-specific env overrides to the default model entry."""
    models = data.get("models") or {}
    default = data.get("default_model")
    if not default or default not in models:
        return data
    entry = models[default]

    if os.environ.get("RARE_MODEL_PATH"):
        entry["model_ref"] = os.environ["RARE_MODEL_PATH"]
    if os.environ.get("RARE_N_THREADS"):
        entry["n_threads"] = int(os.environ["RARE_N_THREADS"])
    if os.environ.get("RARE_N_CTX"):
        entry["context_window"] = int(os.environ["RARE_N_CTX"])
    if os.environ.get("RARE_N_GPU_LAYERS"):
        entry["n_gpu_layers"] = int(os.environ["RARE_N_GPU_LAYERS"])

    # Remote endpoint: promote the openai_compat entry if configured.
    base_url = os.environ.get("RARE_OPENAI_BASE_URL")
    if base_url:
        remote_id = "remote-openai-compat"
        models[remote_id] = {
            "id": remote_id,
            "adapter": "openai_compat",
            "model_ref": os.environ.get("RARE_OPENAI_MODEL", "gpt-4o-mini"),
            "display_name": "Remote OpenAI-compatible endpoint",
            "context_window": 32768,
            "max_tokens": 1024,
            "extra": {
                "base_url": base_url,
                "api_key_env": "RARE_OPENAI_API_KEY",
            },
        }
        if os.environ.get("RARE_DEFAULT_MODEL") == remote_id:
            data["default_model"] = remote_id
    return data


def load_config(
    path: str | Path | None = None,
    overrides: dict[str, Any] | None = None,
) -> EngineConfig:
    """Load, merge and validate configuration."""
    cfg_path = Path(path) if path else DEFAULT_CONFIG_PATH
    data: dict[str, Any] = {}

    if cfg_path.exists():
        try:
            loaded = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:  # pragma: no cover - defensive
            raise ConfigError(f"invalid YAML in {cfg_path}: {exc}") from exc
        if not isinstance(loaded, dict):
            raise ConfigError(f"{cfg_path} must contain a YAML mapping at the top level")
        data = loaded
    elif path is not None:
        raise ConfigError(f"config file not found: {cfg_path}")

    data = _apply_env(data)
    data = _apply_model_env(data)

    if overrides:
        for key, value in overrides.items():
            if isinstance(value, dict) and isinstance(data.get(key), dict):
                data[key].update(value)
            else:
                data[key] = value

    try:
        return EngineConfig(**data)
    except Exception as exc:
        raise ConfigError(f"invalid configuration: {exc}") from exc


def resolve_model_path(model: ModelConfig) -> Path:
    """Resolve a GGUF path relative to the repo root."""
    p = Path(model.model_ref)
    return p if p.is_absolute() else REPO_ROOT / p
