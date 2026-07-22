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


def _add_current_appointment(db_session, owner, profile, specialty="Neurologia"):
    appointment = models.Appointment(
        user_id=owner.id,
        profile_id=profile.id,
        type=models.AppointmentType.cita,
        specialty=specialty,
        center="Hospital Norte",
        date_time=datetime.now(),
        status=models.AppointmentStatus.agendada,
        notes="Traer examenes",
        checklist=[],
    )
    db_session.add(appointment)
    db_session.commit()
    return appointment


def _configure_due_reminder_job(db_session, monkeypatch, send_email):
    monkeypatch.setattr(main, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(main, "_push_configured", lambda: False)
    monkeypatch.setattr(main, "_prune_old_push_logs", lambda db, now: None)
    monkeypatch.setattr(main, "_is_due", lambda now, trigger_at: True)
    monkeypatch.setattr(
        main,
        "_appointment_offsets_for_user",
        lambda user: [{"label": "En este momento", "delta": timedelta(0), "priority": "high"}],
    )
    monkeypatch.setattr(main, "_send_appointment_reminder_email_safe", send_email)


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
                    permissions_json=json.dumps(["receive_alerts"]),
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

    _add_current_appointment(db_session, owner, profile)

    sent_emails = []

    def fake_send_email(to_email, user_name, payload):
        sent_emails.append(
            (to_email, user_name, payload.get("offset_label"), payload.get("patient_name"))
        )
        return True

    _configure_due_reminder_job(db_session, monkeypatch, fake_send_email)

    metrics = main._job_send_appointment_reminders(user_limit=10)

    assert metrics["appointments"] == 1
    assert metrics["email_sent"] == 1
    assert sent_emails == [(caregiver_email, caregiver_name, "En este momento", "Hijo 3")]


def test_appointment_recipients_require_active_relationship_and_alert_permission(db_session):
    owner = _make_user("owner-permissions@example.com", "Owner")
    allowed = _make_user("allowed-caregiver@example.com", "Allowed", email_reminders_enabled=True)
    denied = _make_user("denied-caregiver@example.com", "Denied", email_reminders_enabled=True)
    revoked = _make_user("revoked-caregiver@example.com", "Revoked", email_reminders_enabled=True)
    viewer = _make_user("viewer-alert@example.com", "Viewer", email_reminders_enabled=True)
    db_session.add_all([owner, allowed, denied, revoked, viewer])
    db_session.commit()

    profile = _make_profile(
        owner.id,
        "Perfil protegido",
        owner.id,
        automation_settings={"auto_email_caregivers": True},
    )
    db_session.add(profile)
    db_session.commit()
    db_session.add_all(
        [
            models.ProfileRelationship(
                profile_id=profile.id,
                user_id=owner.id,
                role="admin",
                status="accepted",
            ),
            models.ProfileRelationship(
                profile_id=profile.id,
                user_id=allowed.id,
                role="caregiver",
                status="accepted",
            ),
            models.ProfileRelationship(
                profile_id=profile.id,
                user_id=denied.id,
                role="caregiver",
                status="accepted",
                permissions_json=json.dumps(["view_appointments"]),
            ),
            models.ProfileRelationship(
                profile_id=profile.id,
                user_id=revoked.id,
                role="caregiver",
                status="revoked",
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

    recipients = main._appointment_notification_recipients(
        db_session,
        profile_id=profile.id,
        fallback_user_id=owner.id,
        for_email=True,
    )

    recipient_ids = [int(item["user_id"]) for item in recipients]
    assert recipient_ids == [owner.id, allowed.id]
    assert recipient_ids.count(allowed.id) == 1


def test_job_sends_once_to_owner_and_authorized_caregiver_when_both_have_email(
    db_session,
    monkeypatch,
):
    owner = _make_user("owner-both@example.com", "Owner", email_reminders_enabled=True)
    caregiver = _make_user("caregiver-both@example.com", "Caregiver", email_reminders_enabled=True)
    db_session.add_all([owner, caregiver])
    db_session.commit()
    profile = _make_profile(owner.id, "Perfil ambos", owner.id)
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
    _add_current_appointment(db_session, owner, profile)
    expected_emails = [owner.email, caregiver.email]
    sent_emails = []

    def fake_send_email(to_email, user_name, payload):
        sent_emails.append(to_email)
        return True

    _configure_due_reminder_job(db_session, monkeypatch, fake_send_email)

    metrics = main._job_send_appointment_reminders(user_limit=10)

    assert metrics["email_sent"] == 2
    assert sorted(sent_emails) == sorted(expected_emails)


def test_job_skips_appointment_when_no_recipient_has_a_channel(db_session, monkeypatch):
    owner = _make_user("owner-no-email@example.com", "Owner")
    caregiver = _make_user("caregiver-no-email@example.com", "Caregiver")
    db_session.add_all([owner, caregiver])
    db_session.commit()
    profile = _make_profile(owner.id, "Perfil sin canal", owner.id)
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
    _add_current_appointment(db_session, owner, profile)

    _configure_due_reminder_job(db_session, monkeypatch, lambda *args: True)

    metrics = main._job_send_appointment_reminders(user_limit=10)

    assert metrics["users"] == 0
    assert metrics["email_sent"] == 0


def test_job_does_not_record_provider_failure_as_sent(db_session, monkeypatch):
    owner = _make_user("owner-provider-error@example.com", "Owner", email_reminders_enabled=True)
    db_session.add(owner)
    db_session.commit()
    profile = _make_profile(owner.id, "Perfil proveedor", owner.id)
    db_session.add(profile)
    db_session.commit()
    appointment = _add_current_appointment(db_session, owner, profile)

    _configure_due_reminder_job(db_session, monkeypatch, lambda *args: False)

    metrics = main._job_send_appointment_reminders(user_limit=10)

    tag = f"appointment-email-{appointment.id}-En este momento-user-{owner.id}"
    assert metrics["email_sent"] == 0
    assert metrics["errors"] == 1
    assert main._notification_already_sent(db_session, tag) is False
