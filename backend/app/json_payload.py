from __future__ import annotations

import math
from collections.abc import Mapping
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from uuid import UUID


class JsonPayloadError(ValueError):
    """Raised when a payload cannot be converted without losing its structure."""


def normalize_json_payload(value):
    return _normalize_json_payload(value, path="$", active_ids=set())


def _normalize_json_payload(value, *, path: str, active_ids: set[int]):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise JsonPayloadError(f"non_finite_number:{path}")
        return value
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise JsonPayloadError(f"non_finite_decimal:{path}")
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Enum):
        return _normalize_json_payload(value.value, path=path, active_ids=active_ids)

    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return _normalize_container(
            value,
            lambda: model_dump(mode="json"),
            path=path,
            active_ids=active_ids,
        )
    if isinstance(value, Mapping):
        return _normalize_container(
            value,
            lambda: _normalize_mapping(value, path=path, active_ids=active_ids),
            path=path,
            active_ids=active_ids,
        )
    if isinstance(value, (list, tuple)):
        return _normalize_container(
            value,
            lambda: [
                _normalize_json_payload(item, path=f"{path}[{index}]", active_ids=active_ids)
                for index, item in enumerate(value)
            ],
            path=path,
            active_ids=active_ids,
        )

    raise JsonPayloadError(f"unsupported_type:{value.__class__.__name__}:{path}")


def _normalize_container(value, factory, *, path: str, active_ids: set[int]):
    value_id = id(value)
    if value_id in active_ids:
        raise JsonPayloadError(f"cyclic_reference:{path}")
    active_ids.add(value_id)
    try:
        return factory()
    finally:
        active_ids.remove(value_id)


def _normalize_json_key(value, *, path: str) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, UUID)):
        return str(value)
    if isinstance(value, Enum):
        return str(value.value)
    raise JsonPayloadError(f"unsupported_key_type:{value.__class__.__name__}:{path}")


def _normalize_mapping(value: Mapping, *, path: str, active_ids: set[int]) -> dict:
    normalized = {}
    for key, item in value.items():
        normalized_key = _normalize_json_key(key, path=path)
        normalized[normalized_key] = _normalize_json_payload(
            item,
            path=f"{path}.{normalized_key}",
            active_ids=active_ids,
        )
    return normalized
