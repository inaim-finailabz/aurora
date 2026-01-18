import json
from pathlib import Path
from typing import Dict, Any


def load_registry(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"models": []}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        return {"models": []}
    data.setdefault("models", [])
    return data


def save_registry(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
