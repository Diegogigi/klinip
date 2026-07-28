from __future__ import annotations

from sqlalchemy.orm import Session

from .. import models
from ..json_payload import normalize_json_payload


def add_device_audit(
    db: Session,
    action: str,
    *,
    user_id: int | None = None,
    device: models.Device | None = None,
    profile_id: int | None = None,
    result: str = "success",
    reason: str = "",
) -> None:
    metadata = {
        "actor_type": "human" if user_id is not None else "device",
        "device_id": device.public_id if device else None,
        "profile_id": profile_id,
        "result": result,
        "reason": (reason or "")[:80],
    }
    db.add(
        models.AuditLog(
            user_id=user_id,
            action=action,
            resource_type="device",
            resource_id=device.id if device else None,
            ip_address="",
            user_agent="",
            metadata_json=normalize_json_payload(metadata),
        )
    )
