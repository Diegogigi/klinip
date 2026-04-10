from __future__ import annotations

import os
from pathlib import Path


_ENV_LOADED = False


def _parse_env_line(raw_line: str) -> tuple[str, str] | None:
    line = raw_line.strip()
    if not line or line.startswith("#"):
        return None
    if line.startswith("export "):
        line = line[7:].strip()

    key, separator, value = line.partition("=")
    if not separator:
        return None

    key = key.strip()
    value = value.strip()
    if not key:
        return None

    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]

    return key, value


def load_project_env() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return

    env_candidates = [
        Path(__file__).resolve().parents[1] / ".env",
        Path(__file__).resolve().parents[2] / ".env",
    ]

    for env_path in env_candidates:
        if not env_path.exists():
            continue

        with env_path.open("r", encoding="utf-8") as env_file:
            for raw_line in env_file:
                parsed = _parse_env_line(raw_line)
                if not parsed:
                    continue
                key, value = parsed
                os.environ.setdefault(key, value)

    _ENV_LOADED = True
