from __future__ import annotations

import base64
from datetime import datetime
import hashlib
import hmac
import json

from .. import auth
from ..devices.errors import DeviceError


def _secret(domain: str) -> bytes:
    return hmac.new(
        auth.SECRET_KEY.encode(), domain.encode("ascii"), hashlib.sha256
    ).digest()


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _device_binding(device_public_id: str) -> str:
    return hmac.new(
        _secret("klinip-device-message-cursor-binding-v1"),
        device_public_id.encode(),
        hashlib.sha256,
    ).hexdigest()


def encode_cursor(
    device_public_id: str, created_at: datetime, recipient_public_id: str
) -> str:
    payload = json.dumps(
        {
            "v": 1,
            "d": _device_binding(device_public_id),
            "t": created_at.isoformat(timespec="microseconds"),
            "r": recipient_public_id,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    signature = hmac.new(
        _secret("klinip-device-message-cursor-v1"), payload, hashlib.sha256
    ).digest()
    return f"{_b64encode(payload)}.{_b64encode(signature)}"


def decode_cursor(device_public_id: str, value: str) -> tuple[datetime, str]:
    try:
        payload_part, signature_part = value.split(".", 1)
        payload = _b64decode(payload_part)
        signature = _b64decode(signature_part)
        expected = hmac.new(
            _secret("klinip-device-message-cursor-v1"), payload, hashlib.sha256
        ).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        decoded = json.loads(payload)
        if decoded.get("v") != 1 or not hmac.compare_digest(
            str(decoded.get("d", "")), _device_binding(device_public_id)
        ):
            raise ValueError
        created_at = datetime.fromisoformat(decoded["t"])
        recipient_id = str(decoded["r"])
        if not recipient_id or len(recipient_id) > 64:
            raise ValueError
        return created_at, recipient_id
    except (AttributeError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        raise DeviceError("invalid_cursor", 400) from None
