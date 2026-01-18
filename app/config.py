import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Any, Tuple

import yaml


@dataclass
class AppConfig:
    host: str = "0.0.0.0"
    port: int = 11435
    storage_dir: str = "./models"
    default_model: str = "glm"
    models: Dict[str, str] = field(default_factory=dict)
    registry_filename: str = "models.json"
    llama_server_path: str = "./llama-server"
    llama_server_host: str = "127.0.0.1"
    llama_server_port: int = 11436
    llama_server_args: str = ""
    config_path: str = "config.yaml"

    @property
    def registry_path(self) -> Path:
        return Path(self.storage_dir) / self.registry_filename


def _load_yaml(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        return {}
    return data


def load_config() -> AppConfig:
    config_path = Path(os.getenv("OLLAMA_CLONE_CONFIG", "config.yaml"))
    data = _load_yaml(config_path)
    cfg = AppConfig(
        host=data.get("host", AppConfig.host),
        port=int(data.get("port", AppConfig.port)),
        storage_dir=data.get("storage_dir", AppConfig.storage_dir),
        default_model=data.get("default_model", AppConfig.default_model),
        models=data.get("models", {}) or {},
        llama_server_path=data.get("llama_server_path", AppConfig.llama_server_path),
        llama_server_host=data.get("llama_server_host", AppConfig.llama_server_host),
        llama_server_port=int(data.get("llama_server_port", AppConfig.llama_server_port)),
        llama_server_args=data.get("llama_server_args", AppConfig.llama_server_args),
        config_path=str(config_path),
    )

    env_host = os.getenv("OLLAMA_CLONE_HOST")
    env_port = os.getenv("OLLAMA_CLONE_PORT")
    env_storage = os.getenv("OLLAMA_CLONE_STORAGE_DIR")
    env_default_model = os.getenv("OLLAMA_CLONE_DEFAULT_MODEL")
    env_llama_server_path = os.getenv("OLLAMA_CLONE_LLAMA_SERVER_PATH")
    env_llama_server_host = os.getenv("OLLAMA_CLONE_LLAMA_SERVER_HOST")
    env_llama_server_port = os.getenv("OLLAMA_CLONE_LLAMA_SERVER_PORT")
    env_llama_server_args = os.getenv("OLLAMA_CLONE_LLAMA_SERVER_ARGS")

    if env_host:
        cfg.host = env_host
    if env_port:
        cfg.port = int(env_port)
    if env_storage:
        cfg.storage_dir = env_storage
    if env_default_model:
        cfg.default_model = env_default_model
    if env_llama_server_path:
        cfg.llama_server_path = env_llama_server_path
    if env_llama_server_host:
        cfg.llama_server_host = env_llama_server_host
    if env_llama_server_port:
        cfg.llama_server_port = int(env_llama_server_port)
    if env_llama_server_args:
        cfg.llama_server_args = env_llama_server_args

    return cfg


def save_config(cfg: AppConfig) -> None:
    path = Path(cfg.config_path)
    data = {
        "host": cfg.host,
        "port": cfg.port,
        "storage_dir": cfg.storage_dir,
        "default_model": cfg.default_model,
        "models": cfg.models,
        "llama_server_path": cfg.llama_server_path,
        "llama_server_host": cfg.llama_server_host,
        "llama_server_port": cfg.llama_server_port,
        "llama_server_args": cfg.llama_server_args,
    }
    with path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(data, handle, sort_keys=False)
