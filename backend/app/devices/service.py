from __future__ import annotations

from datetime import datetime, timedelta
import re
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..json_payload import normalize_json_payload
from .audit import add_device_audit
from .errors import DeviceError
from .permissions import can_manage_profile_devices, require_managed_profile
from .schemas import DeviceClaimIn, DeviceHeartbeatIn, DevicePairingCreate
from .scopes import normalize_scopes
from .security import (
    DEVICE_PROTOCOL_VERSION,
    DEVICE_REFRESH_DAYS,
    DevicePrincipal,
    create_device_access_token,
    generate_pairing_code,
    generate_refresh_token,
    hash_pairing_code,
    hash_refresh_token,
    normalize_pairing_code,
)


ALLOWED_CAPABILITIES = frozenset(
    {
        "voice",
        "living_presence",
        "local_asr",
        "place_profile_local",
        "family_connector_foundation",
    }
)
SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9._-]{1,40}$")
PAIRING_MAX_ATTEMPTS = 5


def _now() -> datetime:
    return datetime.utcnow()


def normalize_capabilities(values: list[str]) -> list[str]:
    normalized = []
    for value in values:
        item = str(value or "").strip().lower()
        if not item or item not in ALLOWED_CAPABILITIES:
            raise DeviceError("invalid_capability", 422)
        if item not in normalized:
            normalized.append(item)
    return sorted(normalized)


def _validate_device_identifier(value: str) -> str:
    normalized = str(value or "").strip()
    if not SAFE_IDENTIFIER.fullmatch(normalized):
        raise DeviceError("invalid_device_metadata", 422)
    return normalized


def _pairing_state(db: Session, pairing: models.DevicePairing) -> str:
    if pairing.pairing_status == "pending" and pairing.expires_at <= _now():
        pairing.pairing_status = "expired"
        db.add(pairing)
        add_device_audit(
            db,
            "device_pairing_expired",
            user_id=pairing.requested_by_user_id,
            profile_id=pairing.health_profile_id,
        )
        db.commit()
    return pairing.pairing_status


def create_pairing(
    db: Session,
    user: models.User,
    payload: DevicePairingCreate,
) -> tuple[models.DevicePairing, models.HealthProfile, str]:
    if payload.protocol_version != DEVICE_PROTOCOL_VERSION:
        raise DeviceError("protocol_not_supported", 422)
    profile = require_managed_profile(db, user, payload.health_profile_id)
    scopes = normalize_scopes(payload.requested_scopes)
    expires_at = _now() + timedelta(seconds=payload.expires_in_seconds)

    for _ in range(5):
        raw_code = generate_pairing_code()
        pairing = models.DevicePairing(
            public_id=str(uuid.uuid4()),
            code_hash=hash_pairing_code(raw_code),
            requested_by_user_id=user.id,
            health_profile_id=profile.id,
            requested_label=payload.label,
            requested_scopes=scopes,
            expires_at=expires_at,
            max_attempts=PAIRING_MAX_ATTEMPTS,
            attempts=0,
            pairing_status="pending",
            protocol_version=DEVICE_PROTOCOL_VERSION,
            created_at=_now(),
        )
        try:
            db.add(pairing)
            db.flush()
            add_device_audit(
                db,
                "device_pairing_created",
                user_id=user.id,
                profile_id=profile.id,
            )
            db.commit()
            db.refresh(pairing)
            return pairing, profile, raw_code
        except IntegrityError:
            db.rollback()
    raise DeviceError("pairing_creation_failed", 503)


def get_pairing_for_user(
    db: Session,
    user: models.User,
    pairing_id: str,
) -> tuple[models.DevicePairing, models.HealthProfile]:
    pairing = (
        db.query(models.DevicePairing)
        .filter(models.DevicePairing.public_id == pairing_id)
        .first()
    )
    if not pairing:
        raise DeviceError("pairing_not_found", 404)
    profile = require_managed_profile(db, user, pairing.health_profile_id)
    _pairing_state(db, pairing)
    return pairing, profile


def cancel_pairing(
    db: Session,
    user: models.User,
    pairing_id: str,
) -> models.DevicePairing:
    pairing, _profile = get_pairing_for_user(db, user, pairing_id)
    if pairing.pairing_status == "claimed":
        raise DeviceError("pairing_already_claimed", 409)
    if pairing.pairing_status == "expired":
        raise DeviceError("pairing_expired", 410)
    if pairing.pairing_status == "locked":
        raise DeviceError("pairing_locked", 423)
    if pairing.pairing_status != "cancelled":
        pairing.pairing_status = "cancelled"
        pairing.cancelled_at = _now()
        db.add(pairing)
        add_device_audit(
            db,
            "device_pairing_cancelled",
            user_id=user.id,
            profile_id=pairing.health_profile_id,
        )
        db.commit()
    return pairing


def _record_pairing_failure(
    db: Session,
    pairing: models.DevicePairing,
    reason: str,
) -> None:
    pairing.attempts = int(pairing.attempts or 0) + 1
    if pairing.attempts >= int(pairing.max_attempts or PAIRING_MAX_ATTEMPTS):
        pairing.pairing_status = "locked"
        action = "device_pairing_locked"
    else:
        action = "device_claimed"
    db.add(pairing)
    add_device_audit(
        db,
        action,
        user_id=None,
        profile_id=pairing.health_profile_id,
        result="failed",
        reason=reason,
    )
    db.commit()


def _raise_pairing_state(pairing: models.DevicePairing) -> None:
    errors = {
        "expired": ("pairing_expired", 410),
        "cancelled": ("pairing_cancelled", 409),
        "locked": ("pairing_locked", 423),
        "claimed": ("pairing_already_claimed", 409),
    }
    if pairing.pairing_status in errors:
        code, status_code = errors[pairing.pairing_status]
        raise DeviceError(code, status_code)
    if pairing.pairing_status != "pending":
        raise DeviceError("invalid_pairing_code", 400)


def claim_pairing(
    db: Session,
    payload: DeviceClaimIn,
) -> tuple[
    models.Device,
    models.DeviceGrant,
    models.DeviceCredential,
    str,
    str,
    datetime,
    datetime,
]:
    normalized_code = normalize_pairing_code(payload.pairing_code)
    if not normalized_code:
        raise DeviceError("invalid_pairing_code", 400)
    pairing = (
        db.query(models.DevicePairing)
        .filter(models.DevicePairing.code_hash == hash_pairing_code(normalized_code))
        .with_for_update()
        .first()
    )
    if not pairing:
        raise DeviceError("invalid_pairing_code", 400)
    if pairing.pairing_status == "pending" and pairing.expires_at <= _now():
        pairing.pairing_status = "expired"
        db.add(pairing)
        add_device_audit(
            db,
            "device_pairing_expired",
            profile_id=pairing.health_profile_id,
        )
        db.commit()
        raise DeviceError("pairing_expired", 410)
    _raise_pairing_state(pairing)
    if payload.protocol_version != DEVICE_PROTOCOL_VERSION:
        _record_pairing_failure(db, pairing, "protocol_not_supported")
        raise DeviceError("protocol_not_supported", 422)
    try:
        capabilities = normalize_capabilities(payload.capabilities)
        platform = _validate_device_identifier(payload.platform)
        device_type = _validate_device_identifier(payload.device_type)
    except DeviceError as exc:
        _record_pairing_failure(db, pairing, exc.code)
        raise

    profile = (
        db.query(models.HealthProfile)
        .filter(models.HealthProfile.id == pairing.health_profile_id)
        .first()
    )
    if not profile or bool(profile.is_archived):
        raise DeviceError("profile_not_authorized", 403)
    scopes = normalize_scopes(list(pairing.requested_scopes or []))
    now = _now()
    consumed = (
        db.query(models.DevicePairing)
        .filter(
            models.DevicePairing.id == pairing.id,
            models.DevicePairing.pairing_status == "pending",
            models.DevicePairing.claimed_at.is_(None),
        )
        .update(
            {
                models.DevicePairing.pairing_status: "claimed",
                models.DevicePairing.claimed_at: now,
            },
            synchronize_session=False,
        )
    )
    if consumed != 1:
        db.rollback()
        raise DeviceError("pairing_already_claimed", 409)

    raw_refresh = generate_refresh_token()
    refresh_expires_at = now + timedelta(days=DEVICE_REFRESH_DAYS)
    try:
        device = models.Device(
            public_id=str(uuid.uuid4()),
            label=payload.device_label,
            platform=platform,
            device_type=device_type,
            protocol_version=DEVICE_PROTOCOL_VERSION,
            app_version=payload.app_version,
            status="active",
            token_version=1,
            metadata_json=normalize_json_payload({"capabilities": capabilities}),
            created_at=now,
            updated_at=now,
        )
        db.add(device)
        db.flush()
        grant = models.DeviceGrant(
            device_id=device.id,
            health_profile_id=pairing.health_profile_id,
            granted_by_user_id=pairing.requested_by_user_id,
            scopes_json=scopes,
            protocol_version=DEVICE_PROTOCOL_VERSION,
            granted_at=now,
        )
        db.add(grant)
        credential = models.DeviceCredential(
            device_id=device.id,
            refresh_token_hash=hash_refresh_token(raw_refresh),
            token_family_id=str(uuid.uuid4()),
            issued_at=now,
            expires_at=refresh_expires_at,
            created_from_pairing_id=pairing.id,
        )
        db.add(credential)
        db.flush()
        pairing.claimed_device_id = device.id
        pairing.claimed_at = now
        pairing.pairing_status = "claimed"
        db.add(pairing)
        add_device_audit(
            db,
            "device_claimed",
            device=device,
            profile_id=pairing.health_profile_id,
        )
        access_token, access_expires_at = create_device_access_token(
            device,
            grant,
            credential,
        )
        db.commit()
        return (
            device,
            grant,
            credential,
            access_token,
            raw_refresh,
            access_expires_at,
            refresh_expires_at,
        )
    except DeviceError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise DeviceError("claim_failed", 409) from None


def _active_grant_for_device(
    db: Session,
    device_id: int,
) -> models.DeviceGrant | None:
    now = _now()
    return (
        db.query(models.DeviceGrant)
        .filter(
            models.DeviceGrant.device_id == device_id,
            models.DeviceGrant.revoked_at.is_(None),
            (
                models.DeviceGrant.expires_at.is_(None)
                | (models.DeviceGrant.expires_at > now)
            ),
        )
        .first()
    )


def rotate_device_refresh_token(
    db: Session,
    raw_token: str,
) -> tuple[str, str, datetime, datetime]:
    token_hash = hash_refresh_token(raw_token)
    credential = (
        db.query(models.DeviceCredential)
        .filter(models.DeviceCredential.refresh_token_hash == token_hash)
        .with_for_update()
        .first()
    )
    if not credential:
        raise DeviceError("credential_revoked", 401)
    device = (
        db.query(models.Device)
        .filter(models.Device.id == credential.device_id)
        .with_for_update()
        .first()
    )
    if not device:
        raise DeviceError("credential_revoked", 401)
    now = _now()
    if credential.rotated_at is not None or credential.replaced_by_id is not None:
        db.query(models.DeviceCredential).filter(
            models.DeviceCredential.token_family_id == credential.token_family_id,
            models.DeviceCredential.revoked_at.is_(None),
        ).update({models.DeviceCredential.revoked_at: now}, synchronize_session=False)
        credential.reuse_detected_at = now
        device.token_version = int(device.token_version) + 1
        device.updated_at = now
        db.add_all([credential, device])
        grant = _active_grant_for_device(db, device.id)
        add_device_audit(
            db,
            "device_refresh_reuse_detected",
            device=device,
            profile_id=grant.health_profile_id if grant else None,
            result="failed",
            reason="refresh_reuse_detected",
        )
        db.commit()
        raise DeviceError("refresh_reuse_detected", 401)
    if credential.revoked_at is not None:
        raise DeviceError("credential_revoked", 401)
    if credential.expires_at <= now:
        credential.revoked_at = now
        db.add(credential)
        db.commit()
        raise DeviceError("credential_expired", 401)
    if device.status == "revoked":
        raise DeviceError("device_revoked", 401)
    if device.status != "active":
        raise DeviceError("device_disabled", 401)
    grant = _active_grant_for_device(db, device.id)
    if not grant:
        raise DeviceError("profile_not_authorized", 403)
    scopes = normalize_scopes(list(grant.scopes_json or []))
    if "device:refresh" not in scopes:
        raise DeviceError("insufficient_device_scope", 403)

    new_raw = generate_refresh_token()
    new_expires_at = now + timedelta(days=DEVICE_REFRESH_DAYS)
    new_credential = models.DeviceCredential(
        device_id=device.id,
        refresh_token_hash=hash_refresh_token(new_raw),
        token_family_id=credential.token_family_id,
        issued_at=now,
        expires_at=new_expires_at,
        created_from_pairing_id=credential.created_from_pairing_id,
    )
    db.add(new_credential)
    db.flush()
    credential.rotated_at = now
    credential.last_used_at = now
    credential.replaced_by_id = new_credential.id
    db.add(credential)
    add_device_audit(
        db,
        "device_token_refreshed",
        device=device,
        profile_id=grant.health_profile_id,
    )
    access_token, access_expires_at = create_device_access_token(
        device,
        grant,
        new_credential,
    )
    db.commit()
    return access_token, new_raw, access_expires_at, new_expires_at


def _device_grant_for_user(
    db: Session,
    user: models.User,
    device: models.Device,
) -> models.DeviceGrant:
    grants = (
        db.query(models.DeviceGrant)
        .filter(models.DeviceGrant.device_id == device.id)
        .order_by(models.DeviceGrant.granted_at.desc())
        .all()
    )
    for grant in grants:
        profile = (
            db.query(models.HealthProfile)
            .filter(models.HealthProfile.id == grant.health_profile_id)
            .first()
        )
        if profile and can_manage_profile_devices(db, user, profile):
            return grant
    raise DeviceError("profile_not_authorized", 403)


def list_devices_for_user(
    db: Session,
    user: models.User,
) -> list[tuple[models.Device, models.DeviceGrant, models.HealthProfile]]:
    rows = []
    devices = db.query(models.Device).order_by(models.Device.created_at.desc()).all()
    for device in devices:
        try:
            grant = _device_grant_for_user(db, user, device)
        except DeviceError:
            continue
        profile = (
            db.query(models.HealthProfile)
            .filter(models.HealthProfile.id == grant.health_profile_id)
            .first()
        )
        if profile:
            rows.append((device, grant, profile))
    return rows


def get_device_for_user(
    db: Session,
    user: models.User,
    public_id: str,
) -> tuple[models.Device, models.DeviceGrant, models.HealthProfile]:
    device = (
        db.query(models.Device).filter(models.Device.public_id == public_id).first()
    )
    if not device:
        raise DeviceError("device_not_found", 404)
    grant = _device_grant_for_user(db, user, device)
    profile = (
        db.query(models.HealthProfile)
        .filter(models.HealthProfile.id == grant.health_profile_id)
        .first()
    )
    if not profile:
        raise DeviceError("profile_not_authorized", 403)
    return device, grant, profile


def revoke_device(
    db: Session,
    user: models.User,
    public_id: str,
) -> models.Device:
    device, _grant, _profile = get_device_for_user(db, user, public_id)
    if device.status == "revoked":
        return device
    now = _now()
    device.status = "revoked"
    device.revoked_at = now
    device.revoked_by_user_id = user.id
    device.token_version = int(device.token_version) + 1
    device.updated_at = now
    db.query(models.DeviceGrant).filter(
        models.DeviceGrant.device_id == device.id,
        models.DeviceGrant.revoked_at.is_(None),
    ).update(
        {
            models.DeviceGrant.revoked_at: now,
            models.DeviceGrant.revoked_by_user_id: user.id,
            models.DeviceGrant.reason: "device_revoked",
        },
        synchronize_session=False,
    )
    db.query(models.DeviceCredential).filter(
        models.DeviceCredential.device_id == device.id,
        models.DeviceCredential.revoked_at.is_(None),
    ).update({models.DeviceCredential.revoked_at: now}, synchronize_session=False)
    db.add(device)
    add_device_audit(
        db,
        "device_revoked",
        user_id=user.id,
        device=device,
        profile_id=_grant.health_profile_id,
    )
    db.commit()
    return device


def record_config_read(db: Session, principal: DevicePrincipal) -> None:
    add_device_audit(
        db,
        "device_config_read",
        device=principal.device,
        profile_id=principal.grant.health_profile_id,
    )
    db.commit()


def record_heartbeat(
    db: Session,
    principal: DevicePrincipal,
    payload: DeviceHeartbeatIn,
) -> datetime:
    if payload.protocol_version != DEVICE_PROTOCOL_VERSION:
        raise DeviceError("protocol_not_supported", 422)
    capabilities = normalize_capabilities(payload.capabilities)
    now = _now()
    metadata = dict(principal.device.metadata_json or {})
    metadata["capabilities"] = capabilities
    principal.device.metadata_json = normalize_json_payload(metadata)
    principal.device.last_seen_at = now
    principal.device.updated_at = now
    if payload.app_version is not None:
        principal.device.app_version = payload.app_version
    db.add(principal.device)
    add_device_audit(
        db,
        "device_heartbeat",
        device=principal.device,
        profile_id=principal.grant.health_profile_id,
    )
    db.commit()
    return now


def serialize_device(
    device: models.Device,
    grant: models.DeviceGrant,
    profile: models.HealthProfile,
) -> dict:
    capabilities = list((device.metadata_json or {}).get("capabilities") or [])
    return {
        "device_id": device.public_id,
        "label": device.label,
        "platform": device.platform,
        "device_type": device.device_type,
        "protocol_version": device.protocol_version,
        "app_version": device.app_version,
        "status": device.status,
        "profile_id": profile.id,
        "profile_display_name": profile.full_name,
        "scopes": normalize_scopes(list(grant.scopes_json or [])),
        "capabilities": capabilities,
        "created_at": device.created_at,
        "updated_at": device.updated_at,
        "last_seen_at": device.last_seen_at,
        "revoked_at": device.revoked_at,
    }
