from __future__ import annotations

import json

from sqlalchemy.orm import Session

from .. import models
from .errors import DeviceError


MANAGE_DEVICES_PERMISSION = "manage_devices"


def can_manage_profile_devices(
    db: Session,
    user: models.User,
    profile: models.HealthProfile,
) -> bool:
    if not profile or bool(profile.is_archived):
        return False
    if int(profile.owner_user_id) == int(user.id):
        return True
    link = (
        db.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.profile_id == profile.id,
            models.ProfileRelationship.user_id == user.id,
            models.ProfileRelationship.status == "accepted",
        )
        .first()
    )
    if not link:
        return False
    role = str(link.role or "viewer").strip().lower()
    if role in {"admin", "administrador"}:
        return True
    if role not in {"caregiver", "cuidador"}:
        return False
    try:
        permissions = json.loads(link.permissions_json or "[]")
    except (TypeError, ValueError):
        permissions = []
    return MANAGE_DEVICES_PERMISSION in permissions


def require_managed_profile(
    db: Session,
    user: models.User,
    profile_id: int,
) -> models.HealthProfile:
    profile = (
        db.query(models.HealthProfile)
        .filter(models.HealthProfile.id == profile_id)
        .first()
    )
    if not profile or not can_manage_profile_devices(db, user, profile):
        raise DeviceError("profile_not_authorized", 403)
    return profile
