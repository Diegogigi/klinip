import json
from datetime import datetime, timedelta

from fastapi import BackgroundTasks

from app import main, models


def _make_user(
    email: str,
    name: str,
    *,
    email_reminders_enabled: bool = False,
) -> models.User:
    return models.User(
        email=email,
        password_hash="hash",
        name=name,
        email_reminders_enabled=email_reminders_enabled,
    )


def _make_profile(
    owner_user_id: int,
    full_name: str,
    created_by_user_id: int,
    *,
    automation_settings: dict | None = None,
) -> models.HealthProfile:
    return models.HealthProfile(
        owner_user_id=owner_user_id,
        full_name=full_name,
        created_by_user_id=created_by_user_id,
        is_primary_profile=False,
        is_archived=False,
        automation_settings_json=json.dumps(automation_settings or {}, ensure_ascii=False),
    )


def test_workflow_appointment_keeps_profile_and_notifies_family(db_session, monkeypatch):
    owner = _make_user("lastenia@example.com", "Lastenia", email_reminders_enabled=True)
    caregiver = _make_user("caregiver@example.com", "Cuidadora", email_reminders_enabled=True)
    viewer = _make_user("viewer@example.com", "Viewer", email_reminders_enabled=True)
    db_session.add_all([owner, caregiver, viewer])
    db_session.commit()

    profile = _make_profile(
        owner.id,
        "Hijo 1",
        owner.id,
        automation_settings={"auto_email_caregivers": True},
    )
    db_session.add(profile)
    db_session.commit()

    db_session.add_all(
        [
            models.ProfileRelationship(
                profile_id=profile.id,
                user_id=caregiver.id,
                role="caregiver",
                status="accepted",
            ),
            models.ProfileRelationship(
                profile_id=profile.id,
                user_id=viewer.id,
                role="viewer",
                status="accepted",
            ),
        ]
    )
    db_session.commit()

    pushed_user_ids = []
    emailed_recipients = []

    def fake_send_push(db, user_id, payload):
        pushed_user_ids.append(int(user_id))
        return 1

    def fake_send_email(to_email, user_name, payload):
        emailed_recipients.append(
            (to_email, user_name, payload.get("specialty"), payload.get("patient_name"))
        )

    monkeypatch.setattr(main, "_send_push_to_user", fake_send_push)
    monkeypatch.setattr(main, "_send_appointment_confirmation_email_safe", fake_send_email)

    background_tasks = BackgroundTasks()
    appt = main._create_appointment_from_workflow(
        db_session,
        profile=profile,
        target_user_id=owner.id,
        values={
            "type": models.AppointmentType.cita.value,
            "specialty": "Pediatria",
            "center": "Clinica Central",
            "date": "2026-06-10",
            "time": "09:30",
            "status": models.AppointmentStatus.agendada.value,
            "notes": "Control anual",
        },
        current_user=caregiver,
        background_tasks=background_tasks,
    )

    for task in background_tasks.tasks:
        task.func(*task.args, **task.kwargs)

    assert appt.profile_id == profile.id
    assert sorted(pushed_user_ids) == sorted([owner.id, caregiver.id])
    assert sorted(email for email, _, _, _ in emailed_recipients) == sorted(
        [owner.email, caregiver.email, viewer.email]
    )
    assert {patient_name for _, _, _, patient_name in emailed_recipients} == {"Hijo 1"}


def test_load_notification_users_includes_owner_when_family_contact_can_receive_appointment_reminders(
    db_session,
):
    owner = _make_user("owner-no-channel@example.com", "Owner")
    caregiver = _make_user("caregiver-alert@example.com", "Caregiver", email_reminders_enabled=True)
    db_session.add_all([owner, caregiver])
    db_session.commit()

    profile = _make_profile(owner.id, "Hijo 2", owner.id)
    db_session.add(profile)
    db_session.commit()

    db_session.add(
        models.ProfileRelationship(
            profile_id=profile.id,
            user_id=caregiver.id,
            role="caregiver",
            status="accepted",
        )
    )
    db_session.commit()

    users = main._load_notification_users(db_session, kind="appointment", limit=10)

    assert owner.id in {int(user.id) for user in users}


def test_job_send_appointment_reminders_sends_email_to_family_contact_when_owner_has_no_channel(
    db_session,
    monkeypatch,
):
    owner = _make_user("owner-reminder@example.com", "Owner")
    caregiver = _make_user("caregiver-reminder@example.com", "Caregiver", email_reminders_enabled=True)
    db_session.add_all([owner, caregiver])
    db_session.commit()
    caregiver_email = caregiver.email
    caregiver_name = caregiver.name

    profile = _make_profile(owner.id, "Hijo 3", owner.id)
    db_session.add(profile)
    db_session.commit()

    db_session.add(
        models.ProfileRelationship(
            profile_id=profile.id,
            user_id=caregiver.id,
            role="caregiver",
            status="accepted",
        )
    )
    db_session.commit()

    appointment = models.Appointment(
        user_id=owner.id,
        profile_id=profile.id,
        type=models.AppointmentType.cita,
        specialty="Neurologia",
        center="Hospital Norte",
        date_time=datetime.now(),
        status=models.AppointmentStatus.agendada,
        notes="Traer examenes",
        checklist=[],
    )
    db_session.add(appointment)
    db_session.commit()

    sent_emails = []

    def fake_send_email(to_email, user_name, payload):
        sent_emails.append(
            (to_email, user_name, payload.get("offset_label"), payload.get("patient_name"))
        )

    monkeypatch.setattr(main, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(main, "_push_configured", lambda: False)
    monkeypatch.setattr(main, "_prune_old_push_logs", lambda db, now: None)
    monkeypatch.setattr(
        main,
        "_appointment_offsets_for_user",
        lambda user: [{"label": "En este momento", "delta": timedelta(0), "priority": "high"}],
    )
    monkeypatch.setattr(main, "_send_appointment_reminder_email_safe", fake_send_email)

    metrics = main._job_send_appointment_reminders(user_limit=10)

    assert metrics["appointments"] == 1
    assert metrics["email_sent"] == 1
    assert sent_emails == [(caregiver_email, caregiver_name, "En este momento", "Hijo 3")]
