import logging
from pathlib import Path
from typing import Dict, Optional, Iterator, List

from llama_cpp import Llama

logger = logging.getLogger(__name__)


class ModelRuntime:
    def __init__(self) -> None:
        self._loaded_model_name: Optional[str] = None
        self._llama: Optional[Llama] = None

    def load(self, model_path: Path, model_name: str) -> None:
        if self._llama is not None and self._loaded_model_name == model_name:
            return
        logger.info("Loading model %s from %s", model_name, model_path)
        self._llama = Llama(
            model_path=str(model_path),
            n_ctx=4096,
            n_threads=4,
        )
        self._loaded_model_name = model_name

    def generate(self, prompt: str, options: Dict[str, float]) -> str:
        if not self._llama:
            raise RuntimeError("Model not loaded")
        result = self._llama(
            prompt,
            max_tokens=int(options.get("max_tokens", 512)),
            temperature=float(options.get("temperature", 0.7)),
            top_p=float(options.get("top_p", 0.95)),
            stop=options.get("stop"),
        )
        return result["choices"][0]["text"]

    def stream_generate(self, prompt: str, options: Dict[str, float]) -> Iterator[str]:
        if not self._llama:
            raise RuntimeError("Model not loaded")
        for chunk in self._llama(
            prompt,
            max_tokens=int(options.get("max_tokens", 512)),
            temperature=float(options.get("temperature", 0.7)),
            top_p=float(options.get("top_p", 0.95)),
            stop=options.get("stop"),
            stream=True,
        ):
            yield chunk["choices"][0]["text"]


def format_chat_prompt(messages: List[Dict[str, str]]) -> str:
    parts: List[str] = []
    for message in messages:
        role = message.get("role", "user")
        content = message.get("content", "")
        if role == "system":
            parts.append(f"[SYSTEM]\n{content}\n")
        elif role == "assistant":
            parts.append(f"[ASSISTANT]\n{content}\n")
        else:
            parts.append(f"[USER]\n{content}\n")
    parts.append("[ASSISTANT]\n")
    return "\n".join(parts)
