from __future__ import annotations

from datetime import datetime, timedelta
import hashlib
import hmac
import json
import re
import unicodedata
import uuid

from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import auth, models
from ..devices.errors import DeviceError
from ..devices.security import DevicePrincipal
from ..json_payload import normalize_json_payload
from .audit import add_message_audit
from .constants import (
    ACK_SCOPE_EVENTS,
    EVENT_TYPES,
    MAX_BODY_LENGTH,
    MESSAGE_TYPE,
    PRIORITY,
    PROTOCOL_VERSION,
    READ_SCOPE_EVENTS,
    TERMINAL_STATES,
)
from .cursor import decode_cursor, encode_cursor
from .permissions import is_profile_message_admin, require_message_profile
from .schemas import DeviceMessageCreateIn, DeviceMessageEventIn
from .state_machine import InvalidTransition, next_state


SAFE_EVENT_ID = re.compile(r"^[a-z0-9._:-]{1,64}$")
SAFE_ERROR_CODE = re.compile(r"^[a-z0-9._:-]{1,80}$")


def _now() -> datetime:
    return datetime.utcnow()


def _derived_secret(domain: str) -> bytes:
    return hmac.new(
        auth.SECRET_KEY.encode(), domain.encode("ascii"), hashlib.sha256
    ).digest()


def _normalize_body(value: str) -> str:
    normalized = unicodedata.normalize("NFC", str(value or ""))
    if any(unicodedata.category(char) in {"Cc", "Cf"} for char in normalized):
        raise DeviceError("invalid_message_body", 422)
    normalized = " ".join(normalized.split()).strip()
    if not normalized or len(normalized) > MAX_BODY_LENGTH:
        raise DeviceError("invalid_message_body", 422)
    return normalized


def _hash_idempotency(user_id: int, profile_id: int, key: str) -> str:
    return hmac.new(
        _derived_secret("klinip-device-message-idempotency-v1"),
        f"{user_id}:{profile_id}:{key}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _request_fingerprint(payload: dict) -> str:
    canonical = json.dumps(
        payload, separators=(",", ":"), sort_keys=True, ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _eligible_devices(
    db: Session,
    profile_id: int,
    target_ids: list[str] | None,
) -> list[models.Device]:
    now = _now()
    query = (
        db.query(models.Device, models.DeviceGrant)
        .join(models.DeviceGrant, models.DeviceGrant.device_id == models.Device.id)
        .filter(
            models.DeviceGrant.health_profile_id == profile_id,
            models.DeviceGrant.revoked_at.is_(None),
            or_(
                models.DeviceGrant.expires_at.is_(None),
                models.DeviceGrant.expires_at > now,
            ),
            models.Device.status == "active",
            models.Device.protocol_version == PROTOCOL_VERSION,
            models.DeviceGrant.protocol_version == PROTOCOL_VERSION,
        )
    )
    rows = query.all()
    eligible = {
        device.public_id: device
        for device, grant in rows
        if "messages:read" in set(grant.scopes_json or [])
    }
    if target_ids is not None:
        if set(target_ids) != set(eligible).intersection(target_ids):
            raise DeviceError("target_device_not_eligible", 404)
        return [eligible[target] for target in target_ids]
    return sorted(eligible.values(), key=lambda device: device.public_id)


def _recipient_rows(db: Session, message_id: int):
    return (
        db.query(models.DeviceMessageRecipient, models.Device)
        .join(
            models.Device, models.Device.id == models.DeviceMessageRecipient.device_id
        )
        .filter(models.DeviceMessageRecipient.message_id == message_id)
        .order_by(
            models.DeviceMessageRecipient.created_at,
            models.DeviceMessageRecipient.public_id,
        )
        .all()
    )


def _overall_state(
    recipients: list[tuple[models.DeviceMessageRecipient, models.Device]],
) -> str:
    states = {recipient.current_state for recipient, _device in recipients}
    return next(iter(states)) if len(states) == 1 else "mixed"


def serialize_created(db: Session, message: models.DeviceMessage, reused: bool) -> dict:
    recipients = _recipient_rows(db, message.id)
    return {
        "message_id": message.public_id,
        "recipient_count": len(recipients),
        "created_at": message.created_at,
        "expires_at": message.expires_at,
        "status": _overall_state(recipients),
        "recipients": [
            {
                "recipient_id": recipient.public_id,
                "device_id": device.public_id,
                "device_label": device.label,
                "current_state": recipient.current_state,
                "current_state_at": recipient.current_state_at,
            }
            for recipient, device in recipients
        ],
        "reused_idempotency_result": reused,
    }


def create_message(
    db: Session,
    user: models.User,
    profile_id: int,
    payload: DeviceMessageCreateIn,
    idempotency_key: str,
) -> tuple[models.DeviceMessage, bool]:
    if payload.protocol_version != PROTOCOL_VERSION:
        raise DeviceError("protocol_not_supported", 422)
    key = str(idempotency_key or "").strip()
    if not key or len(key) > 200:
        raise DeviceError("idempotency_key_required", 400)
    profile = require_message_profile(db, user, profile_id)
    body = _normalize_body(payload.body)
    targets = sorted(payload.target_device_ids) if payload.target_device_ids else None
    fingerprint = _request_fingerprint(
        {
            "body": body,
            "requires_acknowledgement": payload.requires_acknowledgement,
            "expires_in_seconds": payload.expires_in_seconds,
            "target_device_ids": targets,
            "protocol_version": payload.protocol_version,
        }
    )
    key_hash = _hash_idempotency(user.id, profile.id, key)
    existing = (
        db.query(models.DeviceMessage)
        .filter(
            models.DeviceMessage.sender_user_id == user.id,
            models.DeviceMessage.health_profile_id == profile.id,
            models.DeviceMessage.idempotency_key_hash == key_hash,
        )
        .first()
    )
    if existing:
        if not hmac.compare_digest(existing.request_fingerprint, fingerprint):
            raise DeviceError("idempotency_conflict", 409)
        add_message_audit(
            db, "device_message_idempotency_reused", message=existing, user_id=user.id
        )
        db.commit()
        return existing, True

    devices = _eligible_devices(db, profile.id, payload.target_device_ids)
    if not devices:
        raise DeviceError("no_eligible_devices", 422)
    now = _now()
    message = models.DeviceMessage(
        public_id=str(uuid.uuid4()),
        health_profile_id=profile.id,
        sender_user_id=user.id,
        message_type=MESSAGE_TYPE,
        body=body,
        priority=PRIORITY,
        requires_acknowledgement=payload.requires_acknowledgement,
        created_at=now,
        available_at=now,
        expires_at=now + timedelta(seconds=payload.expires_in_seconds),
        idempotency_key_hash=key_hash,
        request_fingerprint=fingerprint,
        protocol_version=PROTOCOL_VERSION,
        metadata_json={},
        updated_at=now,
    )
    try:
        db.add(message)
        db.flush()
        for device in devices:
            db.add(
                models.DeviceMessageRecipient(
                    public_id=str(uuid.uuid4()),
                    message_id=message.id,
                    device_id=device.id,
                    created_at=now,
                    current_state="queued",
                    current_state_at=now,
                    delivery_attempts=0,
                    version=1,
                )
            )
        add_message_audit(
            db, "device_message_created", message=message, user_id=user.id
        )
        db.commit()
        db.refresh(message)
        return message, False
    except IntegrityError:
        db.rollback()
        existing = (
            db.query(models.DeviceMessage)
            .filter(
                models.DeviceMessage.sender_user_id == user.id,
                models.DeviceMessage.health_profile_id == profile.id,
                models.DeviceMessage.idempotency_key_hash == key_hash,
            )
            .first()
        )
        if existing and hmac.compare_digest(existing.request_fingerprint, fingerprint):
            return existing, True
        if existing:
            raise DeviceError("idempotency_conflict", 409) from None
        raise DeviceError("message_creation_failed", 503) from None


def _expire_message(db: Session, message: models.DeviceMessage, now: datetime) -> bool:
    if message.revoked_at is not None or message.expires_at > now:
        return False
    updated = (
        db.query(models.DeviceMessageRecipient)
        .filter(
            models.DeviceMessageRecipient.message_id == message.id,
            models.DeviceMessageRecipient.current_state.notin_(TERMINAL_STATES),
        )
        .update(
            {
                models.DeviceMessageRecipient.current_state: "expired",
                models.DeviceMessageRecipient.current_state_at: now,
                models.DeviceMessageRecipient.version: models.DeviceMessageRecipient.version
                + 1,
            },
            synchronize_session="fetch",
        )
    )
    if updated:
        message.updated_at = now
        db.add(message)
        add_message_audit(db, "device_message_expired", message=message)
    return bool(updated)


def get_inbox(
    db: Session,
    principal: DevicePrincipal,
    *,
    cursor: str | None,
    limit: int,
    protocol_version: int,
    include_terminal: bool,
) -> dict:
    if protocol_version != PROTOCOL_VERSION:
        raise DeviceError("protocol_not_supported", 422)
    now = _now()
    query = (
        db.query(models.DeviceMessageRecipient, models.DeviceMessage, models.User)
        .join(
            models.DeviceMessage,
            models.DeviceMessage.id == models.DeviceMessageRecipient.message_id,
        )
        .join(models.User, models.User.id == models.DeviceMessage.sender_user_id)
        .filter(
            models.DeviceMessageRecipient.device_id == principal.device.id,
            models.DeviceMessage.health_profile_id == principal.profile.id,
            models.DeviceMessage.available_at <= now,
            models.DeviceMessage.expires_at > now,
            models.DeviceMessage.revoked_at.is_(None),
        )
    )
    if not include_terminal:
        query = query.filter(
            models.DeviceMessageRecipient.current_state.notin_(
                ["acknowledged", "expired", "revoked"]
            )
        )
    if cursor:
        cursor_time, cursor_id = decode_cursor(principal.device.public_id, cursor)
        query = query.filter(
            or_(
                models.DeviceMessageRecipient.created_at > cursor_time,
                and_(
                    models.DeviceMessageRecipient.created_at == cursor_time,
                    models.DeviceMessageRecipient.public_id > cursor_id,
                ),
            )
        )
    rows = (
        query.order_by(
            models.DeviceMessageRecipient.created_at,
            models.DeviceMessageRecipient.public_id,
        )
        .limit(limit + 1)
        .all()
    )
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = None
    if page:
        last_recipient = page[-1][0]
        next_cursor = encode_cursor(
            principal.device.public_id,
            last_recipient.created_at,
            last_recipient.public_id,
        )
    return {
        "items": [
            {
                "message_id": message.public_id,
                "body": message.body,
                "message_type": message.message_type,
                "priority": message.priority,
                "requires_acknowledgement": message.requires_acknowledgement,
                "created_at": message.created_at,
                "available_at": message.available_at,
                "expires_at": message.expires_at,
                "current_state": recipient.current_state,
                "sender_display_name": sender.name or "Familiar",
                "profile_id": message.health_profile_id,
                "protocol_version": message.protocol_version,
            }
            for recipient, message, sender in page
        ],
        "next_cursor": next_cursor,
        "has_more": has_more,
        "server_time": now,
        "polling_hint_seconds": 30,
    }


def _event_payload(payload: DeviceMessageEventIn) -> tuple[dict, str]:
    if payload.event_type not in EVENT_TYPES:
        raise DeviceError("invalid_event_type", 422)
    if not SAFE_EVENT_ID.fullmatch(payload.client_event_id):
        raise DeviceError("invalid_client_event_id", 422)
    if payload.event_type == "failed":
        if not payload.error_code or not SAFE_ERROR_CODE.fullmatch(payload.error_code):
            raise DeviceError("error_code_required", 422)
    elif payload.error_code is not None:
        raise DeviceError("error_code_not_allowed", 422)
    if len(payload.metadata) > 8:
        raise DeviceError("invalid_event_metadata", 422)
    for key, value in payload.metadata.items():
        if (
            not isinstance(key, str)
            or len(key) > 40
            or not isinstance(value, (str, int, float, bool, type(None)))
        ):
            raise DeviceError("invalid_event_metadata", 422)
        if isinstance(value, str) and len(value) > 120:
            raise DeviceError("invalid_event_metadata", 422)
    safe = {
        "event_type": payload.event_type,
        "client_timestamp": payload.client_timestamp.isoformat()
        if payload.client_timestamp
        else None,
        "protocol_version": payload.protocol_version,
        "error_code": payload.error_code,
        "metadata": payload.metadata,
    }
    return safe, _request_fingerprint(safe)


def record_event(
    db: Session,
    principal: DevicePrincipal,
    message_public_id: str,
    payload: DeviceMessageEventIn,
) -> dict:
    if payload.protocol_version != PROTOCOL_VERSION:
        raise DeviceError("protocol_not_supported", 422)
    if (
        payload.event_type in READ_SCOPE_EVENTS
        and "messages:read" not in principal.scopes
    ):
        raise DeviceError("insufficient_device_scope", 403)
    if (
        payload.event_type in ACK_SCOPE_EVENTS
        and "messages:ack" not in principal.scopes
    ):
        raise DeviceError("insufficient_device_scope", 403)
    _safe_payload, fingerprint = _event_payload(payload)
    row = (
        db.query(models.DeviceMessageRecipient, models.DeviceMessage)
        .join(
            models.DeviceMessage,
            models.DeviceMessage.id == models.DeviceMessageRecipient.message_id,
        )
        .filter(
            models.DeviceMessage.public_id == message_public_id,
            models.DeviceMessageRecipient.device_id == principal.device.id,
            models.DeviceMessage.health_profile_id == principal.profile.id,
        )
        .with_for_update()
        .first()
    )
    if not row:
        raise DeviceError("message_not_found", 404)
    recipient, message = row
    duplicate = (
        db.query(models.DeviceMessageEvent)
        .filter(
            models.DeviceMessageEvent.recipient_id == recipient.id,
            models.DeviceMessageEvent.client_event_id == payload.client_event_id,
        )
        .first()
    )
    if duplicate:
        if not hmac.compare_digest(duplicate.request_fingerprint, fingerprint):
            raise DeviceError("client_event_id_conflict", 409)
        add_message_audit(
            db,
            "device_message_event_duplicate",
            message=message,
            device=principal.device,
            event_type=payload.event_type,
        )
        db.commit()
        return {
            "accepted": True,
            "duplicate": True,
            "current_state": duplicate.resulting_state,
            "server_timestamp": duplicate.server_timestamp,
            "message_id": message.public_id,
        }
    now = _now()
    if message.revoked_at is not None or recipient.current_state == "revoked":
        add_message_audit(
            db,
            "device_message_event_rejected",
            message=message,
            device=principal.device,
            event_type=payload.event_type,
            result="rejected",
            reason="message_revoked",
        )
        db.commit()
        raise DeviceError("message_revoked", 409)
    if message.expires_at <= now:
        _expire_message(db, message, now)
        add_message_audit(
            db,
            "device_message_event_rejected",
            message=message,
            device=principal.device,
            event_type=payload.event_type,
            result="rejected",
            reason="message_expired",
        )
        db.commit()
        raise DeviceError("message_expired", 410)
    try:
        resulting_state = next_state(recipient.current_state, payload.event_type)
    except InvalidTransition as exc:
        add_message_audit(
            db,
            "device_message_event_rejected",
            message=message,
            device=principal.device,
            event_type=payload.event_type,
            result="rejected",
            reason=str(exc),
        )
        db.commit()
        raise DeviceError(str(exc), 409) from None
    event = models.DeviceMessageEvent(
        public_id=str(uuid.uuid4()),
        message_id=message.id,
        recipient_id=recipient.id,
        device_id=principal.device.id,
        event_type=payload.event_type,
        client_event_id=payload.client_event_id,
        request_fingerprint=fingerprint,
        resulting_state=resulting_state,
        server_timestamp=now,
        client_timestamp=payload.client_timestamp,
        protocol_version=PROTOCOL_VERSION,
        error_code=payload.error_code,
        metadata_json=normalize_json_payload(payload.metadata),
        created_at=now,
    )
    try:
        db.add(event)
        db.flush()
        if resulting_state != recipient.current_state:
            recipient.current_state = resulting_state
            recipient.current_state_at = now
            recipient.version = int(recipient.version or 0) + 1
        if payload.event_type == "delivered":
            recipient.delivery_attempts = int(recipient.delivery_attempts or 0) + 1
        recipient.last_event_public_id = event.public_id
        message.updated_at = now
        db.add(recipient)
        db.add(message)
        add_message_audit(
            db,
            "device_message_event_received",
            message=message,
            device=principal.device,
            event_type=payload.event_type,
        )
        db.commit()
        return {
            "accepted": True,
            "duplicate": False,
            "current_state": resulting_state,
            "server_timestamp": now,
            "message_id": message.public_id,
        }
    except IntegrityError:
        db.rollback()
        duplicate = (
            db.query(models.DeviceMessageEvent)
            .filter(
                models.DeviceMessageEvent.recipient_id == recipient.id,
                models.DeviceMessageEvent.client_event_id == payload.client_event_id,
            )
            .first()
        )
        if duplicate and hmac.compare_digest(
            duplicate.request_fingerprint, fingerprint
        ):
            return {
                "accepted": True,
                "duplicate": True,
                "current_state": duplicate.resulting_state,
                "server_timestamp": duplicate.server_timestamp,
                "message_id": message.public_id,
            }
        if duplicate:
            raise DeviceError("client_event_id_conflict", 409) from None
        raise DeviceError("message_event_failed", 503) from None


def _get_message_for_user(
    db: Session,
    user: models.User,
    profile_id: int,
    message_public_id: str,
) -> tuple[models.HealthProfile, models.DeviceMessage]:
    profile = require_message_profile(db, user, profile_id)
    message = (
        db.query(models.DeviceMessage)
        .filter(
            models.DeviceMessage.public_id == message_public_id,
            models.DeviceMessage.health_profile_id == profile.id,
        )
        .first()
    )
    if not message:
        raise DeviceError("message_not_found", 404)
    if _expire_message(db, message, _now()):
        db.commit()
    return profile, message


def serialize_detail(db: Session, message: models.DeviceMessage) -> dict:
    recipients = _recipient_rows(db, message.id)
    events = (
        db.query(models.DeviceMessageEvent, models.Device)
        .join(models.Device, models.Device.id == models.DeviceMessageEvent.device_id)
        .filter(models.DeviceMessageEvent.message_id == message.id)
        .order_by(
            models.DeviceMessageEvent.server_timestamp,
            models.DeviceMessageEvent.public_id,
        )
        .all()
    )
    return {
        "message_id": message.public_id,
        "body": message.body,
        "message_type": message.message_type,
        "priority": message.priority,
        "requires_acknowledgement": message.requires_acknowledgement,
        "sender": {"display_name": message.sender.name or "Familiar"},
        "created_at": message.created_at,
        "available_at": message.available_at,
        "expires_at": message.expires_at,
        "revoked_at": message.revoked_at,
        "status": _overall_state(recipients),
        "recipient_count": len(recipients),
        "acknowledged_count": sum(
            r.current_state == "acknowledged" for r, _ in recipients
        ),
        "terminal_count": sum(
            r.current_state in TERMINAL_STATES for r, _ in recipients
        ),
        "recipients": [
            {
                "recipient_id": recipient.public_id,
                "device_id": device.public_id,
                "device_label": device.label,
                "current_state": recipient.current_state,
                "current_state_at": recipient.current_state_at,
                "version": recipient.version,
                "delivery_attempts": recipient.delivery_attempts,
            }
            for recipient, device in recipients
        ],
        "events": [
            {
                "event_id": event.public_id,
                "device_id": device.public_id,
                "event_type": event.event_type,
                "server_timestamp": event.server_timestamp,
                "client_timestamp": event.client_timestamp,
                "error_code": event.error_code,
            }
            for event, device in events
        ],
    }


def get_message_detail(
    db: Session, user: models.User, profile_id: int, message_id: str
) -> dict:
    _profile, message = _get_message_for_user(db, user, profile_id, message_id)
    return serialize_detail(db, message)


def list_messages(
    db: Session,
    user: models.User,
    profile_id: int,
    *,
    state: str | None,
    device_id: str | None,
    message_id: str | None,
    created_from: datetime | None,
    created_to: datetime | None,
    limit: int,
    offset: int,
) -> dict:
    profile = require_message_profile(db, user, profile_id)
    now = _now()
    expired_messages = (
        db.query(models.DeviceMessage)
        .filter(
            models.DeviceMessage.health_profile_id == profile.id,
            models.DeviceMessage.revoked_at.is_(None),
            models.DeviceMessage.expires_at <= now,
        )
        .all()
    )
    expiration_changed = False
    for expired_message in expired_messages:
        expiration_changed = (
            _expire_message(db, expired_message, now) or expiration_changed
        )
    if expiration_changed:
        db.commit()
    query = db.query(models.DeviceMessage).filter(
        models.DeviceMessage.health_profile_id == profile.id
    )
    if message_id:
        query = query.filter(models.DeviceMessage.public_id == message_id)
    if created_from:
        query = query.filter(models.DeviceMessage.created_at >= created_from)
    if created_to:
        query = query.filter(models.DeviceMessage.created_at <= created_to)
    if state or device_id:
        query = query.join(
            models.DeviceMessageRecipient,
            models.DeviceMessageRecipient.message_id == models.DeviceMessage.id,
        ).join(
            models.Device, models.Device.id == models.DeviceMessageRecipient.device_id
        )
        if state:
            query = query.filter(models.DeviceMessageRecipient.current_state == state)
        if device_id:
            query = query.filter(models.Device.public_id == device_id)
    total = query.with_entities(models.DeviceMessage.id).distinct().count()
    page_rows = (
        query.with_entities(
            models.DeviceMessage.id,
            models.DeviceMessage.created_at,
        )
        .distinct()
        .order_by(
            models.DeviceMessage.created_at.desc(),
            models.DeviceMessage.id.desc(),
        )
        .offset(offset)
        .limit(limit)
        .all()
    )
    page_ids = [row.id for row in page_rows]
    messages_by_id = {
        message.id: message
        for message in db.query(models.DeviceMessage)
        .filter(models.DeviceMessage.id.in_(page_ids))
        .all()
    }
    messages = [messages_by_id[message_id] for message_id in page_ids]
    return {
        "items": [serialize_detail(db, message) for message in messages],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def revoke_message(
    db: Session,
    user: models.User,
    profile_id: int,
    message_id: str,
) -> dict:
    profile, message = _get_message_for_user(db, user, profile_id, message_id)
    if int(message.sender_user_id) != int(user.id) and not is_profile_message_admin(
        db, user, profile
    ):
        raise DeviceError("message_not_authorized", 403)
    if message.revoked_at is None:
        now = _now()
        message.revoked_at = now
        message.revoked_by_user_id = user.id
        message.revocation_reason_code = "sender_revoked"
        message.updated_at = now
        recipients = (
            db.query(models.DeviceMessageRecipient)
            .filter(models.DeviceMessageRecipient.message_id == message.id)
            .all()
        )
        for recipient in recipients:
            if recipient.current_state not in TERMINAL_STATES:
                recipient.current_state = "revoked"
                recipient.current_state_at = now
                recipient.revoked_at = now
                recipient.version = int(recipient.version or 0) + 1
                db.add(recipient)
        db.add(message)
        add_message_audit(
            db, "device_message_revoked", message=message, user_id=user.id
        )
        db.commit()
    return serialize_detail(db, message)
