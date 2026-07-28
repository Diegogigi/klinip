from __future__ import annotations

import collections
import threading
import time

from fastapi import HTTPException, Request


DEVICE_RATE_LIMITS = {
    "create_pairing": {"max": 10, "window": 60},
    "claim": {"max": 12, "window": 60},
    "refresh": {"max": 20, "window": 60},
    "heartbeat": {"max": 120, "window": 60},
}
_store: dict[str, list[float]] = collections.defaultdict(list)
_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_device_rate_limit(
    request: Request,
    endpoint: str,
    *,
    subject: str = "",
) -> None:
    config = DEVICE_RATE_LIMITS[endpoint]
    keys = [f"ip:{_client_ip(request)}:{endpoint}"]
    if subject:
        keys.append(f"subject:{subject[:64]}:{endpoint}")
    now = time.monotonic()
    window = int(config["window"])
    with _lock:
        for key in keys:
            _store[key] = [value for value in _store[key] if now - value < window]
        if any(len(_store[key]) >= int(config["max"]) for key in keys):
            raise HTTPException(
                status_code=429,
                detail="rate_limited",
                headers={"Retry-After": str(window)},
            )
        for key in keys:
            _store[key].append(now)


def reset_device_rate_limits() -> None:
    with _lock:
        _store.clear()
