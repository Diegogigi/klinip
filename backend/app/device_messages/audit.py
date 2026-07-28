from __future__ import annotations

from sqlalchemy.orm import Session

from .. import models
from ..json_payload import normalize_json_payload


def add_message_audit(
    db: Session,
    action: str,
    *,
    message: models.DeviceMessage | None = None,
    user_id: int | None = None,
    device: models.Device | None = None,
    event_type: str | None = None,
    result: str = "success",
    reason: str = "",
) -> None:
    db.add(
        models.AuditLog(
            user_id=user_id,
            action=action,
            resource_type="device_message",
            resource_id=message.id if message else None,
            ip_address="",
            user_agent="",
            metadata_json=normalize_json_payload(
                {
                    "actor_type": (
                        "human"
                        if user_id is not None
                        else "device"
                        if device is not None
                        else "system"
                    ),
                    "message_id": message.public_id if message else None,
                    "device_id": device.public_id if device else None,
                    "event_type": event_type,
                    "result": result,
                    "reason": (reason or "")[:80],
                }
            ),
        )
    )
