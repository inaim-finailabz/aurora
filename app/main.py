import asyncio
import json
import logging
import re
import shlex
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from huggingface_hub import hf_hub_download
import httpx
import yaml

from app.config import load_config, save_config
from app.llama_server import LlamaServerConfig, LlamaServerManager
from app.logging_utils import InMemoryLogHandler
from app.model_registry import load_registry, save_registry


config = load_config()
storage_path = Path(config.storage_dir)
storage_path.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("ollama_clone")
logger.setLevel(logging.INFO)
handler = InMemoryLogHandler()
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(handler)
# mirror into uvicorn/root so /api/logs sees everything
for name in ("uvicorn", "uvicorn.error", "uvicorn.access", ""):
    log = logging.getLogger(name)
    log.setLevel(logging.INFO)
    log.addHandler(handler)

app = FastAPI(title="Ollama Clone (GGUF)")
app.state.log_handler = handler
app.state.config = config
app.state.storage_path = storage_path
llama_cfg = LlamaServerConfig(
    binary_path=app.state.config.llama_server_path,
    host=app.state.config.llama_server_host,
    port=app.state.config.llama_server_port,
    extra_args=shlex.split(app.state.config.llama_server_args) if app.state.config.llama_server_args else [],
)
app.state.llama_server = LlamaServerManager(llama_cfg)


@app.on_event("startup")
async def startup() -> None:
    logger.info("Starting Aurora backend with config host=%s port=%s storage_dir=%s", app.state.config.host, app.state.config.port, app.state.config.storage_dir)
    logger.info("Aurora backend starting on %s:%s", app.state.config.host, app.state.config.llama_server_port)


@app.on_event("shutdown")
def shutdown() -> None:
    app.state.llama_server.stop()


def resolve_model_path(model_name: str) -> Path:
    if model_name in app.state.config.models:
        return Path(app.state.config.models[model_name])

    registry = load_registry(app.state.config.registry_path)
    for entry in registry.get("models", []):
        if entry.get("name") == model_name:
            return Path(entry["path"])

    raise FileNotFoundError(f"Model '{model_name}' not found")


def ensure_model_loaded(model_name: str) -> None:
    model_path = resolve_model_path(model_name)
    if not model_path.exists():
        raise FileNotFoundError(f"Model file missing at {model_path}")
    app.state.llama_server.ensure(model_path, model_name)


async def wait_for_llama_server() -> None:
    for _ in range(30):
        if app.state.llama_server.health():
            return
        await asyncio.sleep(0.2)
    raise RuntimeError("llama-server did not become healthy in time")


@app.get("/", response_class=HTMLResponse)
def index() -> Any:
    # Simple landing page to point users to the desktop shell.
    return """
    <!DOCTYPE html>
    <html>
      <head><title>Aurora API • FinAI Labz</title></head>
      <body style="font-family: sans-serif; max-width: 720px; margin: 40px auto;">
        <h1>Aurora API</h1>
        <p>From the brain of FinAI Labz — copyright 2026.</p>
        <p>This server powers the Aurora desktop app. Launch the desktop shell to use chat, model search, and pulls.</p>
        <p>If you are seeing this in a browser, run the desktop UI from the repo root:</p>
        <pre>npm run desktop:dev</pre>
      </body>
    </html>
    """


@app.get("/health")
def health() -> Dict[str, Any]:
    llama_ok = app.state.llama_server.health()
    return {
        "status": "ok",
        "llama": bool(llama_ok),
        "host": app.state.config.host,
        "port": app.state.config.llama_server_port,
        "default_model": app.state.config.default_model,
    }


@app.get("/api/logs")
def get_logs(limit: int = 200) -> Dict[str, Any]:
    return {"lines": app.state.log_handler.tail(limit)}


@app.get("/api/logs/stream")
async def stream_logs(request: Request) -> StreamingResponse:
    async def event_stream() -> Any:
        last_id = 0
        while True:
            if await request.is_disconnected():
                break
            entries = app.state.log_handler.since(last_id)
            for entry_id, msg in entries:
                last_id = entry_id
                yield f"data: {msg}\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/models")
def list_models() -> Dict[str, Any]:
    registry = load_registry(app.state.config.registry_path)
    models = []
    seen = set()
    for name, path in app.state.config.models.items():
        models.append({"name": name, "path": path, "source": "config"})
        seen.add(name)
    for entry in registry.get("models", []):
        name = entry.get("name")
        if not name or name in seen:
            continue
        entry["source"] = "registry"
        models.append(entry)
        seen.add(name)
    return {"models": models}

@app.delete("/api/models/{name}")
def delete_model(name: str) -> Dict[str, Any]:
    if name in app.state.config.models:
        raise HTTPException(status_code=400, detail="Model is defined in config.yaml; remove it there.")

    registry = load_registry(app.state.config.registry_path)
    models = registry.get("models", [])
    entry = next((m for m in models if m.get("name") == name), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Model not found")

    path = entry.get("path")
    storage_root = Path(app.state.config.storage_dir).resolve()
    if path:
        try:
            target = Path(path).resolve()
            if target.is_file():
                if storage_root in target.parents or target.parent == storage_root:
                    target.unlink(missing_ok=True)
                else:
                    logger.warning("Refusing to delete file outside storage_dir: %s", target)
            elif target.is_dir():
                if storage_root in target.parents and target != storage_root:
                    shutil.rmtree(target, ignore_errors=False)
                else:
                    logger.warning("Refusing to delete folder outside storage_dir: %s", target)
        except Exception as exc:
            logger.warning("Failed to remove files for model %s: %s", name, exc)

    registry["models"] = [m for m in models if m.get("name") != name]
    save_registry(app.state.config.registry_path, registry)
    return {"status": "removed", "name": name}


@app.get("/api/popular-models")
def list_popular_models() -> List[Dict[str, Any]]:
    popular_models_path = Path(__file__).parent.parent / "popular-models.yaml"
    if not popular_models_path.exists():
        logger.warning("popular-models.yaml not found at %s", popular_models_path)
        return []

    try:
        with open(popular_models_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
            return data.get("models", [])
    except Exception as e:
        logger.error("Failed to load popular-models.yaml: %s", e)
        return []


@app.get("/api/settings")
def get_settings() -> Dict[str, Any]:
    cfg = app.state.config
    return {
        "host": cfg.host,
        "storage_dir": cfg.storage_dir,
        "llama_server_path": cfg.llama_server_path,
        "llama_server_host": cfg.llama_server_host,
        "llama_server_port": cfg.llama_server_port,
        "llama_server_args": cfg.llama_server_args,
        "default_model": cfg.default_model,
    }


@app.post("/api/settings")
def update_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    cfg = app.state.config
    host = payload.get("host")
    storage_dir = payload.get("storage_dir")
    llama_server_path = payload.get("llama_server_path")
    llama_server_args = payload.get("llama_server_args")
    llama_server_host = payload.get("llama_server_host")
    llama_server_port = payload.get("llama_server_port")
    default_model = payload.get("default_model")

    if host:
        cfg.host = host
    if storage_dir:
        cfg.storage_dir = storage_dir
        app.state.storage_path = Path(cfg.storage_dir)
        app.state.storage_path.mkdir(parents=True, exist_ok=True)
    if llama_server_path:
        cfg.llama_server_path = llama_server_path
    if llama_server_args is not None:
        cfg.llama_server_args = str(llama_server_args)
    if llama_server_host:
        cfg.llama_server_host = llama_server_host
    if llama_server_port:
        cfg.llama_server_port = int(llama_server_port)
        app.state.llama_server.stop()
        app.state.llama_server = LlamaServerManager(
            LlamaServerConfig(
                binary_path=cfg.llama_server_path,
                host=cfg.llama_server_host,
                port=cfg.llama_server_port,
                extra_args=shlex.split(cfg.llama_server_args) if cfg.llama_server_args else [],
            )
        )
    if default_model:
        cfg.default_model = str(default_model)

    save_config(cfg)
    return {"status": "ok"}


@app.post("/api/pull")
def pull_model(payload: Dict[str, Any], background: BackgroundTasks) -> Dict[str, Any]:
    name = payload.get("name")
    repo_id = payload.get("repo_id")
    filename = payload.get("filename")
    revision = payload.get("revision")
    subfolder = payload.get("subfolder")
    if not name or not repo_id or not filename:
        raise HTTPException(status_code=400, detail="name, repo_id, and filename are required")

    def _download() -> None:
        logger.info("Downloading %s from %s", filename, repo_id)
        local_dir = app.state.storage_path / name
        local_dir.mkdir(parents=True, exist_ok=True)

        split_match = re.match(r"^(?P<prefix>.+)-00001-of-(?P<total>\d+)\.gguf$", filename)
        if split_match:
            prefix = split_match.group("prefix")
            total = int(split_match.group("total"))
            for idx in range(1, total + 1):
                part = f"{prefix}-{idx:05d}-of-{total:05d}.gguf"
                hf_hub_download(
                    repo_id=repo_id,
                    filename=part,
                    revision=revision,
                    subfolder=subfolder,
                    local_dir=local_dir,
                    local_dir_use_symlinks=False,
                )
            path = str(local_dir / filename)
        else:
            path = hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                revision=revision,
                subfolder=subfolder,
                local_dir=local_dir,
                local_dir_use_symlinks=False,
            )
        registry = load_registry(app.state.config.registry_path)
        registry.setdefault("models", [])
        registry["models"] = [m for m in registry["models"] if m.get("name") != name]
        registry["models"].append(
            {
                "name": name,
                "repo_id": repo_id,
                "filename": filename,
                "path": path,
            }
        )
        save_registry(app.state.config.registry_path, registry)
        logger.info("Model %s saved at %s", name, path)

    background.add_task(_download)
    return {"status": "queued", "name": name}


@app.post("/api/generate")
async def generate(payload: Dict[str, Any]) -> Any:
    model_name = payload.get("model") or app.state.config.default_model
    prompt = payload.get("prompt")
    stream = bool(payload.get("stream", False))
    options = payload.get("options", {}) or {}
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    try:
        ensure_model_loaded(model_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    logger.info("generate request model=%s stream=%s", model_name, stream)

    await wait_for_llama_server()
    request_payload = {
        "prompt": prompt,
        "n_predict": int(options.get("max_tokens", 512)),
        "temperature": float(options.get("temperature", 0.7)),
        "top_p": float(options.get("top_p", 0.95)),
        "stream": stream,
        "echo": False,
    }

    if stream:
        async def stream_response() -> Any:
            url = f"{app.state.llama_server.base_url}/completion"
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("POST", url, json=request_payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        raw = line.replace("data:", "", 1).strip()
                        if not raw:
                            continue
                        chunk = json.loads(raw)
                        text = chunk.get("content", "")
                        done = bool(chunk.get("stop", False) or chunk.get("stopped", False))
                        data = {"model": model_name, "response": text, "done": done}
                        yield f"data: {json.dumps(data)}\n\n"
                    yield f"data: {json.dumps({'model': model_name, 'done': True})}\n\n"

        return StreamingResponse(stream_response(), media_type="text/event-stream")

    url = f"{app.state.llama_server.base_url}/completion"
    async with httpx.AsyncClient(timeout=None) as client:
        res = await client.post(url, json=request_payload)
        res.raise_for_status()
        data = res.json()
    return JSONResponse({"model": model_name, "response": data.get("content", ""), "done": True})


@app.post("/api/chat")
async def chat(payload: Dict[str, Any]) -> Any:
    model_name = payload.get("model") or app.state.config.default_model
    messages = payload.get("messages", [])
    stream = bool(payload.get("stream", False))
    options = payload.get("options", {}) or {}
    attachments = payload.get("attachments", []) or []
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=400, detail="messages array is required")
    try:
        ensure_model_loaded(model_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    logger.info("chat request model=%s stream=%s", model_name, stream)

    await wait_for_llama_server()
    if attachments and isinstance(messages[-1].get("content"), str) and messages[-1].get("role", "user") == "user":
        content_parts: List[Any] = [{"type": "text", "text": messages[-1]["content"]}]
        for att in attachments:
            url = att.get("data_url") or att.get("url")
            if not url:
                continue
            content_parts.append({"type": "image_url", "image_url": {"url": url}})
        messages[-1] = {**messages[-1], "content": content_parts}

    request_payload = {
        "messages": messages,
        "temperature": float(options.get("temperature", 0.7)),
        "top_p": float(options.get("top_p", 0.95)),
        "max_tokens": int(options.get("max_tokens", 512)),
        "stream": stream,
    }

    if stream:
        async def stream_response() -> Any:
            url = f"{app.state.llama_server.base_url}/v1/chat/completions"
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("POST", url, json=request_payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        raw = line.replace("data:", "", 1).strip()
                        if raw == "[DONE]":
                            break
                        if not raw:
                            continue
                        chunk = json.loads(raw)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        text = delta.get("content", "")
                        data = {
                            "model": model_name,
                            "message": {"role": "assistant", "content": text},
                            "done": False,
                        }
                        yield f"data: {json.dumps(data)}\n\n"
                    yield f"data: {json.dumps({'model': model_name, 'done': True})}\n\n"

        return StreamingResponse(stream_response(), media_type="text/event-stream")

    url = f"{app.state.llama_server.base_url}/v1/chat/completions"
    async with httpx.AsyncClient(timeout=None) as client:
        res = await client.post(url, json=request_payload)
        res.raise_for_status()
        data = res.json()
    message = data.get("choices", [{}])[0].get("message", {})
    return JSONResponse({"model": model_name, "message": message, "done": True})
