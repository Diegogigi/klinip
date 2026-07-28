from __future__ import annotations

from .errors import DeviceError


DEVICE_SCOPES = (
    "device:read_config",
    "profile:read_basic",
    "device:refresh",
    "device:heartbeat",
    "messages:read",
    "messages:ack",
)
DEVICE_SCOPE_SET = frozenset(DEVICE_SCOPES)


def normalize_scopes(values: list[str] | tuple[str, ...]) -> list[str]:
    requested = {str(value or "").strip().lower() for value in values}
    if "" in requested or not requested or not requested.issubset(DEVICE_SCOPE_SET):
        raise DeviceError("invalid_scope", 422)
    return [scope for scope in DEVICE_SCOPES if scope in requested]
