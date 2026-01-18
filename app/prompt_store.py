import json
from pathlib import Path
from typing import Any, Dict, List


def load_prompts(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        return []
    return data


def save_prompts(path: Path, prompts: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(prompts, handle, indent=2, ensure_ascii=False)


def upsert_prompt(path: Path, name: str, content: str) -> List[Dict[str, Any]]:
    prompts = load_prompts(path)
    prompts = [p for p in prompts if p.get("name") != name]
    prompts.append({"name": name, "content": content})
    save_prompts(path, prompts)
    return prompts


def delete_prompt(path: Path, name: str) -> List[Dict[str, Any]]:
    prompts = load_prompts(path)
    prompts = [p for p in prompts if p.get("name") != name]
    save_prompts(path, prompts)
    return prompts
