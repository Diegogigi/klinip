import asyncio
from datetime import datetime

import pytest
from fastapi import BackgroundTasks, HTTPException

from app import main, models


def _make_user(email: str, name: str, *, plan_type: str = "familiar") -> models.User:
    return models.User(
        email=email,
        password_hash="hash",
        name=name,
        plan_type=plan_type,
    )


def _make_profile(owner_user_id: int, full_name: str, created_by_user_id: int) -> models.HealthProfile:
    return models.HealthProfile(
        owner_user_id=owner_user_id,
        full_name=full_name,
        created_by_user_id=created_by_user_id,
        is_primary_profile=False,
        is_archived=False,
    )


def test_pending_profile_invitation_can_still_be_revoked(db_session):
    owner = _make_user("owner@example.com", "Owner")
    db_session.add(owner)
    db_session.commit()

    profile = _make_profile(owner.id, "Perfil familiar", owner.id)
    db_session.add(profile)
    db_session.commit()

    owner_link = models.ProfileRelationship(
        profile_id=profile.id,
        user_id=owner.id,
        relationship_type="self",
        role="admin",
        status="accepted",
        accepted_at=datetime.utcnow(),
    )
    invitation = models.ProfileInvitation(
        profile_id=profile.id,
        inviter_user_id=owner.id,
        invitee_email="pending@example.com",
        role="viewer",
        relationship_type="familiar",
        status="pending",
        token="pending-token",
        invited_at=datetime.utcnow(),
    )
    db_session.add_all([owner_link, invitation])
    db_session.commit()

    result = asyncio.run(
        main.revoke_profile_invitation(
            profile.id,
            invitation.id,
            BackgroundTasks(),
            db_session,
            owner,
        )
    )

    db_session.refresh(invitation)
    assert result == {"ok": True}
    assert invitation.status == "revoked"


def test_accepted_profile_invitation_cannot_revoke_own_active_access(db_session):
    owner = _make_user("mother@example.com", "Mother")
    admin_guest = _make_user("diego@example.com", "Diego")
    db_session.add_all([owner, admin_guest])
    db_session.commit()

    profile = _make_profile(owner.id, "Lastenia Lagos Martinez", owner.id)
    db_session.add(profile)
    db_session.commit()

    db_session.add_all(
        [
            models.ProfileRelationship(
                profile_id=profile.id,
                user_id=owner.id,
                relationship_type="self",
                role="admin",
                status="accepted",
                accepted_at=datetime.utcnow(),
            ),
            models.ProfileRelationship(
                profile_id=profile.id,
                user_id=admin_guest.id,
                relationship_type="hijo",
                role="admin",
                status="accepted",
                invited_at=datetime.utcnow(),
                accepted_at=datetime.utcnow(),
            ),
        ]
    )
    invitation = models.ProfileInvitation(
        profile_id=profile.id,
        inviter_user_id=owner.id,
        invitee_email=admin_guest.email,
        role="admin",
        relationship_type="hijo",
        status="accepted",
        token="accepted-token",
        invited_at=datetime.utcnow(),
        accepted_by_user_id=admin_guest.id,
        accepted_at=datetime.utcnow(),
    )
    db_session.add(invitation)
    db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            main.revoke_profile_invitation(
                profile.id,
                invitation.id,
                BackgroundTasks(),
                db_session,
                admin_guest,
            )
        )

    db_session.expire_all()
    active_link = (
        db_session.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.profile_id == profile.id,
            models.ProfileRelationship.user_id == admin_guest.id,
        )
        .first()
    )
    invitation_row = (
        db_session.query(models.ProfileInvitation)
        .filter(models.ProfileInvitation.id == invitation.id)
        .first()
    )

    assert exc_info.value.status_code == 400
    assert "No puedes revocar tu propio acceso" in exc_info.value.detail
    assert active_link is not None
    assert invitation_row is not None
    assert invitation_row.status == "accepted"
