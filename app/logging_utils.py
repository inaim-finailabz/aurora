import logging
from collections import deque
from typing import Deque, List, Tuple


class InMemoryLogHandler(logging.Handler):
    def __init__(self, max_entries: int = 500) -> None:
        super().__init__()
        self._entries: Deque[Tuple[int, str]] = deque(maxlen=max_entries)
        self._counter = 0

    def emit(self, record: logging.LogRecord) -> None:
        msg = self.format(record)
        self._counter += 1
        self._entries.append((self._counter, msg))

    def tail(self, limit: int = 200) -> List[str]:
        if limit <= 0:
            return []
        return [entry[1] for entry in list(self._entries)[-limit:]]

    def since(self, last_id: int) -> List[Tuple[int, str]]:
        return [entry for entry in self._entries if entry[0] > last_id]
