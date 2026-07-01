import asyncio
from datetime import datetime

from app import main, models


def _make_user(email: str, name: str) -> models.User:
    return models.User(email=email, password_hash="hash", name=name)


def _make_profile(owner_user_id: int, full_name: str, created_by_user_id: int, *, is_primary: bool) -> models.HealthProfile:
    return models.HealthProfile(
        owner_user_id=owner_user_id,
        full_name=full_name,
        created_by_user_id=created_by_user_id,
        is_primary_profile=is_primary,
        is_archived=False,
    )


def _link_profile(db_session, profile_id: int, user_id: int, *, relationship_type: str = "self", role: str = "admin"):
    db_session.add(
        models.ProfileRelationship(
            profile_id=profile_id,
            user_id=user_id,
            relationship_type=relationship_type,
            role=role,
            status="accepted",
            accepted_at=datetime.utcnow(),
        )
    )


def test_list_appointments_filters_secondary_profile_scope(db_session):
    owner = _make_user("owner-calendar@example.com", "Owner Calendar")
    db_session.add(owner)
    db_session.commit()

    primary = _make_profile(owner.id, "Titular", owner.id, is_primary=True)
    secondary = _make_profile(owner.id, "Mama", owner.id, is_primary=False)
    db_session.add_all([primary, secondary])
    db_session.commit()

    _link_profile(db_session, primary.id, owner.id)
    _link_profile(db_session, secondary.id, owner.id, relationship_type="mama")
    db_session.add_all(
        [
            models.Appointment(
                user_id=owner.id,
                profile_id=primary.id,
                type=models.AppointmentType.cita,
                specialty="Cardiologia",
                center="Centro 1",
                status=models.AppointmentStatus.agendada,
            ),
            models.Appointment(
                user_id=owner.id,
                profile_id=secondary.id,
                type=models.AppointmentType.examen,
                specialty="Perfil mama",
                center="Centro 2",
                status=models.AppointmentStatus.pendiente,
            ),
            models.Appointment(
                user_id=owner.id,
                profile_id=None,
                type=models.AppointmentType.tramite,
                specialty="Legacy",
                center="Centro 3",
                status=models.AppointmentStatus.pendiente,
            ),
        ]
    )
    db_session.commit()

    primary_items = asyncio.run(main.list_appointments(primary.id, db_session, owner))
    secondary_items = asyncio.run(main.list_appointments(secondary.id, db_session, owner))

    assert {item.specialty for item in primary_items} == {"Cardiologia", "Legacy"}
    assert [item.specialty for item in secondary_items] == ["Perfil mama"]


def test_update_and_delete_appointments_respect_active_profile_scope(db_session):
    owner = _make_user("owner-calendar-scope@example.com", "Owner Calendar Scope")
    db_session.add(owner)
    db_session.commit()

    primary = _make_profile(owner.id, "Titular", owner.id, is_primary=True)
    secondary = _make_profile(owner.id, "Mama", owner.id, is_primary=False)
    db_session.add_all([primary, secondary])
    db_session.commit()

    _link_profile(db_session, primary.id, owner.id)
    _link_profile(db_session, secondary.id, owner.id, relationship_type="mama")
    owner.active_health_profile_id = secondary.id
    db_session.add(owner)

    primary_appt = models.Appointment(
        user_id=owner.id,
        profile_id=primary.id,
        type=models.AppointmentType.cita,
        specialty="Titular",
        center="Centro 1",
        status=models.AppointmentStatus.agendada,
    )
    secondary_appt = models.Appointment(
        user_id=owner.id,
        profile_id=secondary.id,
        type=models.AppointmentType.examen,
        specialty="Mama",
        center="Centro 2",
        status=models.AppointmentStatus.pendiente,
    )
    db_session.add_all([primary_appt, secondary_appt])
    db_session.commit()

    payload = models.AppointmentStatus
    updated = asyncio.run(
        main.update_appointment(
            secondary_appt.id,
            main.schemas.AppointmentUpdate(
                type=models.AppointmentType.examen,
                specialty="Mama actualizada",
                center="Centro 2",
                status=payload.agendada,
            ),
            db_session,
            owner,
        )
    )

    assert updated.specialty == "Mama actualizada"

    not_found_update = False
    try:
        asyncio.run(
            main.update_appointment(
                primary_appt.id,
                main.schemas.AppointmentUpdate(
                    type=models.AppointmentType.cita,
                    specialty="No debe editarse",
                    center="Centro 1",
                    status=payload.agendada,
                ),
                db_session,
                owner,
            )
        )
    except main.HTTPException as exc:
        not_found_update = exc.status_code == 404

    assert not_found_update is True

    asyncio.run(main.delete_appointment(secondary_appt.id, db_session, owner))
    remaining_ids = {item.id for item in db_session.query(models.Appointment).all()}
    assert primary_appt.id in remaining_ids
    assert secondary_appt.id not in remaining_ids
