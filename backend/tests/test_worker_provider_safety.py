from datetime import datetime

from app import main, models


def test_medication_reminder_email_reports_provider_success(monkeypatch):
    monkeypatch.setattr(main, "_send_templated_email", lambda **_kwargs: None)

    assert main._send_medication_reminder_email_safe("user@example.com", "User", {}) is True


def test_medication_reminder_email_reports_provider_failure(monkeypatch):
    def fail(**_kwargs):
        raise RuntimeError("provider secret")

    monkeypatch.setattr(main, "_send_templated_email", fail)

    assert main._send_medication_reminder_email_safe("user@example.com", "User", {}) is False


def test_refill_email_reports_provider_failure(monkeypatch):
    def fail(**_kwargs):
        raise RuntimeError("provider secret")

    monkeypatch.setattr(main, "_send_templated_email", fail)

    assert main._send_medication_refill_email_safe("user@example.com", "User", {}) is False


def test_note_reminder_is_not_marked_sent_when_push_fails(db_session, monkeypatch):
    user = models.User(email="note@example.com", password_hash="hash", name="User")
    db_session.add(user)
    db_session.commit()
    profile = models.HealthProfile(
        owner_user_id=user.id,
        full_name="Profile",
        created_by_user_id=user.id,
    )
    db_session.add(profile)
    db_session.commit()
    note = models.ProfileNote(
        profile_id=profile.id,
        created_by_user_id=user.id,
        note="Reminder",
        reminder_at=datetime.utcnow(),
        reminder_sent=False,
    )
    db_session.add(note)
    db_session.commit()
    monkeypatch.setattr(main, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(main, "_send_push_to_user", lambda *_args, **_kwargs: False)

    metrics = main._job_send_note_reminders()

    assert metrics["sent"] == 0
    assert note.reminder_sent is False
