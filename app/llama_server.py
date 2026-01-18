import logging
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass
class LlamaServerConfig:
    binary_path: str = "./llama-server"
    host: str = "127.0.0.1"
    port: int = 11436
    extra_args: List[str] = None


class LlamaServerManager:
    def __init__(self, config: LlamaServerConfig) -> None:
        self._config = config
        self._process: Optional[subprocess.Popen[str]] = None
        self._model_name: Optional[str] = None
        self._model_path: Optional[Path] = None
        self._reader_thread: Optional[threading.Thread] = None

    @property
    def base_url(self) -> str:
        return f"http://{self._config.host}:{self._config.port}"

    def _resolve_binary(self) -> str:
        path = Path(self._config.binary_path)
        if path.exists():
            return str(path)
        found = shutil.which(self._config.binary_path)
        if found:
            return found
        raise FileNotFoundError(f"llama-server binary not found at {self._config.binary_path}")

    def ensure(self, model_path: Path, model_name: str) -> None:
        if self._process and self._process.poll() is None:
            if self._model_name == model_name and self._model_path == model_path:
                return
            self.stop()

        binary = self._resolve_binary()
        args = [
            binary,
            "-m",
            str(model_path),
            "--host",
            self._config.host,
            "--port",
            str(self._config.port),
        ]
        if self._config.extra_args:
            args.extend(self._config.extra_args)
        logger.info("Starting llama-server: %s", " ".join(args))
        self._process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self._model_name = model_name
        self._model_path = model_path
        self._reader_thread = threading.Thread(target=self._read_output, daemon=True)
        self._reader_thread.start()

    def _read_output(self) -> None:
        if not self._process or not self._process.stdout:
            return
        for line in self._process.stdout:
            logger.info("llama-server: %s", line.rstrip())

    def stop(self) -> None:
        if not self._process:
            return
        logger.info("Stopping llama-server")
        self._process.terminate()
        try:
            self._process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._process.kill()
        self._process = None
        self._model_name = None
        self._model_path = None
        self._reader_thread = None

    def health(self) -> bool:
        try:
            res = httpx.get(f"{self.base_url}/health", timeout=1.0)
            return res.status_code == 200
        except httpx.HTTPError:
            return False
