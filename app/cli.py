import json
from pathlib import Path
from typing import Optional

import click
import httpx

from app.config import load_config
from app.model_registry import load_registry


def _api_base(host: str, port: int) -> str:
    return f"http://{host}:{port}"


def _print(obj: object) -> None:
    click.echo(json.dumps(obj, indent=2, ensure_ascii=False))


@click.group()
def cli() -> None:
    """Aurora CLI (pull, run, chat, generate)."""


@cli.command()
@click.argument("name")
@click.argument("repo_id")
@click.argument("filename")
@click.option("--subfolder", default=None, help="Optional subfolder in repo")
def pull(name: str, repo_id: str, filename: str, subfolder: Optional[str]) -> None:
    """Queue a model download from Hugging Face."""
    cfg = load_config()
    base = _api_base(cfg.host, cfg.port)
    payload = {"name": name, "repo_id": repo_id, "filename": filename}
    if subfolder:
        payload["subfolder"] = subfolder
    res = httpx.post(f"{base}/api/pull", json=payload, timeout=30.0)
    res.raise_for_status()
    _print(res.json())


@cli.command()
@click.argument("name")
def run(name: str) -> None:
    """Ensure model is ready (will start llama-server)."""
    cfg = load_config()
    base = _api_base(cfg.host, cfg.port)
    # Chat with an empty message to trigger load; avoids a separate endpoint.
    payload = {"model": name, "messages": [{"role": "user", "content": ""}], "stream": False}
    res = httpx.post(f"{base}/api/chat", json=payload, timeout=None)
    res.raise_for_status()
    _print({"status": "ok", "model": name})


@cli.command()
@click.argument("prompt")
@click.option("--model", default=None, help="Model name")
@click.option("--max-tokens", default=256, type=int, help="Max tokens")
@click.option("--temperature", default=0.7, type=float, help="Temperature")
def generate(prompt: str, model: Optional[str], max_tokens: int, temperature: float) -> None:
    """One-shot completion."""
    cfg = load_config()
    base = _api_base(cfg.host, cfg.port)
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"max_tokens": max_tokens, "temperature": temperature},
    }
    res = httpx.post(f"{base}/api/generate", json=payload, timeout=None)
    res.raise_for_status()
    data = res.json()
    click.echo(data.get("response", ""))


@cli.command()
@click.argument("message")
@click.option("--model", default=None, help="Model name")
@click.option("--max-tokens", default=256, type=int, help="Max tokens")
@click.option("--temperature", default=0.7, type=float, help="Temperature")
def chat(message: str, model: Optional[str], max_tokens: int, temperature: float) -> None:
    """Single-turn chat."""
    cfg = load_config()
    base = _api_base(cfg.host, cfg.port)
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": message}],
        "stream": False,
        "options": {"max_tokens": max_tokens, "temperature": temperature},
    }
    res = httpx.post(f"{base}/api/chat", json=payload, timeout=None)
    res.raise_for_status()
    data = res.json()
    click.echo(data.get("message", {}).get("content", ""))


@cli.command()
def models() -> None:
    """List models (config + registry)."""
    cfg = load_config()
    base = _api_base(cfg.host, cfg.port)
    res = httpx.get(f"{base}/api/models", timeout=10.0)
    res.raise_for_status()
    _print(res.json())


@cli.command()
def info() -> None:
    """Show config and registry summary."""
    cfg = load_config()
    registry = load_registry(Path(cfg.registry_path))
    _print({"config": cfg.__dict__, "registry_models": registry.get("models", [])})


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
