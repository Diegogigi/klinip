from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
import secrets
import uuid

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from sqlalchemy.orm import Session

from .. import auth, models
from .scopes import DEVICE_SCOPE_SET, normalize_scopes


DEVICE_PROTOCOL_VERSION = 1
DEVICE_ACCESS_MINUTES = max(
    10,
    min(15, int(os.getenv("DEVICE_ACCESS_TOKEN_EXPIRE_MINUTES", "15") or "15")),
)
DEVICE_REFRESH_DAYS = max(
    1,
    min(30, int(os.getenv("DEVICE_REFRESH_TOKEN_EXPIRE_DAYS", "30") or "30")),
)
PAIRING_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

device_bearer = HTTPBearer(auto_error=False, scheme_name="DeviceBearer")


@dataclass(frozen=True)
class DevicePrincipal:
    device: models.Device
    grant: models.DeviceGrant
    credential: models.DeviceCredential
    profile: models.HealthProfile
    scopes: frozenset[str]
    claims: dict


def _derived_secret(domain: str) -> str:
    return hmac.new(
        auth.SECRET_KEY.encode("utf-8"),
        domain.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()


def normalize_pairing_code(value: str) -> str:
    normalized = "".join(ch for ch in str(value or "").upper() if ch.isalnum())
    if len(normalized) != 8 or any(ch not in PAIRING_ALPHABET for ch in normalized):
        return ""
    return normalized


def generate_pairing_code() -> str:
    compact = "".join(secrets.choice(PAIRING_ALPHABET) for _ in range(8))
    return f"{compact[:4]}-{compact[4:]}"


def hash_pairing_code(value: str) -> str:
    normalized = normalize_pairing_code(value)
    return hmac.new(
        _derived_secret("klinip-device-pairing-v1").encode("ascii"),
        normalized.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(64)


def hash_refresh_token(value: str) -> str:
    return hmac.new(
        _derived_secret("klinip-device-refresh-v1").encode("ascii"),
        str(value or "").encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def create_device_access_token(
    device: models.Device,
    grant: models.DeviceGrant,
    credential: models.DeviceCredential,
) -> tuple[str, datetime]:
    now_utc = datetime.now(timezone.utc)
    expires_at_utc = now_utc + timedelta(minutes=DEVICE_ACCESS_MINUTES)
    expires_at = expires_at_utc.replace(tzinfo=None)
    scopes = normalize_scopes(list(grant.scopes_json or []))
    payload = {
        "sub": device.public_id,
        "type": "device_access",
        "token_type": "device_access",
        "device_id": device.public_id,
        "profile_id": int(grant.health_profile_id),
        "scopes": scopes,
        "token_version": int(device.token_version),
        "protocol_version": int(device.protocol_version),
        "credential_id": int(credential.id),
        "iat": int(now_utc.timestamp()),
        "exp": int(expires_at_utc.timestamp()),
        "jti": str(uuid.uuid4()),
    }
    token = jwt.encode(
        payload,
        _derived_secret("klinip-device-access-v1"),
        algorithm=auth.ALGORITHM,
    )
    return token, expires_at


def decode_device_access_token(token: str) -> dict:
    credentials_error = HTTPException(status_code=401, detail="invalid_device_token")
    try:
        payload = jwt.decode(
            token,
            _derived_secret("klinip-device-access-v1"),
            algorithms=[auth.ALGORITHM],
        )
        if payload.get("type") != "device_access":
            raise credentials_error
        if payload.get("token_type") != "device_access":
            raise credentials_error
        if payload.get("sub") != payload.get("device_id"):
            raise credentials_error
        scopes = payload.get("scopes")
        if not isinstance(scopes, list) or not set(scopes).issubset(DEVICE_SCOPE_SET):
            raise credentials_error
        for key in (
            "device_id",
            "profile_id",
            "token_version",
            "protocol_version",
            "credential_id",
            "iat",
            "exp",
            "jti",
        ):
            if payload.get(key) is None:
                raise credentials_error
        return payload
    except HTTPException:
        raise
    except Exception:
        raise credentials_error from None


def get_current_device(
    credentials: HTTPAuthorizationCredentials | None = Depends(device_bearer),
    db: Session = Depends(auth.get_db),
) -> DevicePrincipal:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="device_authentication_required")
    payload = decode_device_access_token(credentials.credentials)
    try:
        profile_id = int(payload["profile_id"])
        token_version = int(payload["token_version"])
        protocol_version = int(payload["protocol_version"])
        credential_id = int(payload["credential_id"])
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="invalid_device_token") from None

    device = (
        db.query(models.Device)
        .filter(models.Device.public_id == payload["device_id"])
        .first()
    )
    if not device:
        raise HTTPException(status_code=401, detail="invalid_device_token")
    if device.status == "revoked":
        raise HTTPException(status_code=401, detail="device_revoked")
    if device.status != "active":
        raise HTTPException(status_code=401, detail="device_disabled")
    if int(device.token_version) != token_version:
        raise HTTPException(status_code=401, detail="invalid_device_token")
    if int(device.protocol_version) != protocol_version:
        raise HTTPException(status_code=401, detail="protocol_not_supported")

    now = datetime.utcnow()
    credential = (
        db.query(models.DeviceCredential)
        .filter(
            models.DeviceCredential.id == credential_id,
            models.DeviceCredential.device_id == device.id,
        )
        .first()
    )
    if not credential or credential.revoked_at is not None:
        raise HTTPException(status_code=401, detail="credential_revoked")
    if credential.expires_at <= now:
        raise HTTPException(status_code=401, detail="credential_expired")

    grant = (
        db.query(models.DeviceGrant)
        .filter(
            models.DeviceGrant.device_id == device.id,
            models.DeviceGrant.health_profile_id == profile_id,
            models.DeviceGrant.revoked_at.is_(None),
        )
        .first()
    )
    if not grant or (grant.expires_at is not None and grant.expires_at <= now):
        raise HTTPException(status_code=403, detail="profile_not_authorized")
    grant_scopes = frozenset(normalize_scopes(list(grant.scopes_json or [])))
    token_scopes = frozenset(str(scope) for scope in payload["scopes"])
    if not token_scopes.issubset(grant_scopes):
        raise HTTPException(status_code=403, detail="insufficient_device_scope")

    profile = (
        db.query(models.HealthProfile)
        .filter(models.HealthProfile.id == profile_id)
        .first()
    )
    if not profile or bool(profile.is_archived):
        raise HTTPException(status_code=403, detail="profile_not_authorized")
    return DevicePrincipal(
        device=device,
        grant=grant,
        credential=credential,
        profile=profile,
        scopes=token_scopes,
        claims=payload,
    )


def require_device_scopes(*required_scopes: str):
    required = frozenset(required_scopes)
    if not required.issubset(DEVICE_SCOPE_SET):
        raise ValueError("unknown device scope dependency")

    def dependency(
        principal: DevicePrincipal = Depends(get_current_device),
    ) -> DevicePrincipal:
        if not required.issubset(principal.scopes):
            raise HTTPException(status_code=403, detail="insufficient_device_scope")
        return principal

    return dependency
