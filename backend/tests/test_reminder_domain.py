from __future__ import annotations

from datetime import date, datetime, time, timedelta
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.exc import StaleDataError

from app import models


def _public_id() -> str:
    return str(uuid.uuid4())


def _create_identity(db_session, *, suffix: str = "primary"):
    user = models.User(
        email=f"reminders-{suffix}@example.com",
        password_hash="test-only-hash",
        name="Persona de prueba",
    )
    db_session.add(user)
    db_session.flush()
    profile = models.HealthProfile(
        owner_user_id=user.id,
        full_name="Perfil de prueba",
        created_by_user_id=user.id,
        is_primary_profile=True,
        is_archived=False,
    )
    device = models.Device(
        public_id=_public_id(),
        label="Klinip One de prueba",
        platform="android",
        device_type="klinip_one",
        protocol_version=1,
        status="active",
        token_version=1,
        metadata_json={},
    )
    db_session.add_all([profile, device])
    db_session.commit()
    return user, profile, device


def _create_reminder(
    db_session,
    user,
    profile,
    device,
    *,
    idempotency_key_hash: str = "a" * 64,
    request_fingerprint: str = "b" * 64,
):
    reminder = models.Reminder(
        public_id=_public_id(),
        health_profile_id=profile.id,
        created_by_user_id=user.id,
        created_by_device_id=None,
        idempotency_key_hash=idempotency_key_hash,
        request_fingerprint=request_fingerprint,
        origin="web",
        reminder_type="personal_non_clinical",
        content_ciphertext="enc:test-content-envelope",
        content_nonce="n" * 32,
        content_key_version=1,
        content_algorithm_version=1,
        schedule_mode="wall_clock",
        original_local_date=date(2030, 3, 15),
        original_local_time=time(19, 0),
        timezone_iana="America/Santiago",
        recurrence_json={
            "version": 1,
            "frequency": "once",
            "interval": 1,
            "weekdays": [],
        },
        dst_gap_policy="shift_forward_by_gap",
        dst_fold_policy="earlier",
        target_mode="selected_device",
        target_device_id=device.id,
        next_occurrence_at_utc=datetime(2030, 3, 15, 22, 0),
        next_logical_key="2030-03-15T19:00:00[fold=0]",
        state="active",
        version=1,
    )
    db_session.add(reminder)
    db_session.commit()
    return reminder


def _create_occurrence(db_session, reminder, profile):
    occurrence = models.ReminderOccurrence(
        public_id=_public_id(),
        reminder_id=reminder.id,
        health_profile_id=profile.id,
        schedule_version=reminder.version,
        logical_occurrence_key="2030-03-15T19:00:00[fold=0]",
        original_scheduled_for_utc=datetime(2030, 3, 15, 22, 0),
        scheduled_for_utc=datetime(2030, 3, 15, 22, 0),
        original_local_date=date(2030, 3, 15),
        original_local_time=time(19, 0),
        timezone_iana="America/Santiago",
        revision=1,
        snooze_count=0,
        state="scheduled",
    )
    db_session.add(occurrence)
    db_session.commit()
    return occurrence


def _create_delivery(db_session, occurrence, profile, device):
    delivery = models.ReminderDelivery(
        public_id=_public_id(),
        occurrence_id=occurrence.id,
        health_profile_id=profile.id,
        device_id=device.id,
        delivery_revision=1,
        occurrence_version=occurrence.revision,
        state="queued",
        available_at=datetime(2030, 3, 15, 21, 0),
        expires_at=datetime(2030, 3, 16, 22, 0),
        delivery_attempts=0,
    )
    db_session.add(delivery)
    db_session.commit()
    return delivery


def test_complete_reminder_domain_can_be_persisted(db_session):
    user, profile, device = _create_identity(db_session)
    settings = models.ReminderProfileSettings(
        health_profile_id=profile.id,
        timezone_iana="America/Santiago",
        preferred_device_id=device.id,
        active_hours_enabled=True,
        active_hours_start_local=time(8, 0),
        active_hours_end_local=time(21, 0),
        active_weekdays_json=[1, 2, 3, 4, 5, 6, 7],
        settings_version=1,
    )
    db_session.add(settings)
    db_session.commit()

    reminder = _create_reminder(db_session, user, profile, device)
    occurrence = _create_occurrence(db_session, reminder, profile)
    delivery = _create_delivery(db_session, occurrence, profile, device)
    reminder_event = models.ReminderEvent(
        public_id=_public_id(),
        reminder_id=reminder.id,
        occurrence_id=occurrence.id,
        delivery_id=delivery.id,
        health_profile_id=profile.id,
        actor_kind="device",
        actor_device_id=device.id,
        event_scope="delivery",
        event_type="delivered",
        client_event_id=_public_id(),
        request_fingerprint="c" * 64,
        expected_version=delivery.delivery_revision,
        resulting_state="delivered",
        resulting_version=delivery.delivery_revision,
        metadata_json={},
    )
    db_session.add(reminder_event)
    db_session.commit()

    assert db_session.query(models.ReminderProfileSettings).count() == 1
    assert db_session.query(models.Reminder).count() == 1
    assert db_session.query(models.ReminderOccurrence).count() == 1
    assert db_session.query(models.ReminderDelivery).count() == 1
    assert db_session.query(models.ReminderEvent).count() == 1
    reminder_columns = models.Reminder.__table__.columns
    assert "title" not in reminder_columns
    assert "body" not in reminder_columns
    assert "title_ciphertext" not in reminder_columns
    assert "body_ciphertext" not in reminder_columns
    assert reminder.content_ciphertext.startswith("enc:")


@pytest.mark.parametrize(
    ("field_name", "invalid_value"),
    (
        ("content_ciphertext", ""),
        ("content_nonce", ""),
        ("content_key_version", 0),
        ("content_algorithm_version", 0),
    ),
)
def test_encrypted_content_envelope_rejects_inconsistent_values(
    db_session,
    field_name,
    invalid_value,
):
    user, profile, device = _create_identity(
        db_session,
        suffix=f"invalid-envelope-{field_name}",
    )
    reminder = _create_reminder(db_session, user, profile, device)

    setattr(reminder, field_name, invalid_value)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_canonical_states_are_separate_from_family_message_states():
    assert {state.value for state in models.ReminderState} == {
        "active",
        "awaiting_device",
        "completed",
        "cancelled",
        "expired",
        "failed",
    }
    assert {state.value for state in models.ReminderOccurrenceState} == {
        "scheduled",
        "due",
        "snoozed",
        "completed",
        "dismissed",
        "cancelled",
        "expired",
        "failed",
    }
    assert {state.value for state in models.ReminderDeliveryState} == {
        "queued",
        "delivered",
        "announced",
        "superseded",
        "failed",
        "expired",
        "cancelled",
    }
    assert "heard" not in {state.value for state in models.ReminderDeliveryState}
    assert "acknowledged" not in {state.value for state in models.ReminderDeliveryState}


def test_invalid_state_timezone_and_recurrence_fail_before_persistence():
    with pytest.raises(ValueError, match="Invalid reminder state"):
        models.Reminder(state="pending")
    with pytest.raises(ValueError, match="Invalid timezone_iana"):
        models.ReminderProfileSettings(timezone_iana="Santiago")
    with pytest.raises(ValueError, match="Invalid recurrence"):
        models.Reminder(
            recurrence_json={
                "version": 1,
                "frequency": "weekly",
                "interval": 1,
                "weekdays": [],
            }
        )
    with pytest.raises(ValueError, match="Invalid recurrence"):
        models.Reminder(
            recurrence_json={
                "version": 1,
                "frequency": "daily",
                "interval": 1,
                "weekdays": [1],
            }
        )


def test_weekly_recurrence_and_iana_timezone_are_normalized():
    reminder = models.Reminder(
        timezone_iana="America/Santiago",
        recurrence_json={
            "version": 1,
            "frequency": "weekly",
            "interval": 2,
            "weekdays": [1, 3, 5],
        },
    )
    assert reminder.timezone_iana == "America/Santiago"
    assert reminder.recurrence_json == {
        "version": 1,
        "frequency": "weekly",
        "interval": 2,
        "weekdays": [1, 3, 5],
    }


def test_creation_idempotency_is_scoped_by_actor_and_profile(db_session):
    user, profile, device = _create_identity(db_session)
    _create_reminder(db_session, user, profile, device)
    duplicate = models.Reminder(
        public_id=_public_id(),
        health_profile_id=profile.id,
        created_by_user_id=user.id,
        idempotency_key_hash="a" * 64,
        request_fingerprint="d" * 64,
        origin="web",
        reminder_type="personal_non_clinical",
        content_ciphertext="enc:other-envelope",
        content_nonce="m" * 32,
        content_key_version=1,
        content_algorithm_version=1,
        schedule_mode="wall_clock",
        original_local_date=date(2030, 3, 16),
        original_local_time=time(10, 0),
        timezone_iana="America/Santiago",
        recurrence_json={
            "version": 1,
            "frequency": "once",
            "interval": 1,
            "weekdays": [],
        },
        dst_gap_policy="shift_forward_by_gap",
        dst_fold_policy="earlier",
        target_mode="selected_device",
        target_device_id=device.id,
        state="active",
        version=1,
    )
    db_session.add(duplicate)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    assert db_session.query(models.Reminder).count() == 1

    second_profile = models.HealthProfile(
        owner_user_id=user.id,
        full_name="Segundo perfil de prueba",
        created_by_user_id=user.id,
        is_primary_profile=False,
        is_archived=False,
    )
    db_session.add(second_profile)
    db_session.commit()
    _create_reminder(
        db_session,
        user,
        second_profile,
        device,
        idempotency_key_hash="a" * 64,
        request_fingerprint="d" * 64,
    )
    assert db_session.query(models.Reminder).count() == 2


def test_all_reminder_entities_are_explicitly_scoped_to_health_profile():
    for model in (
        models.ReminderProfileSettings,
        models.Reminder,
        models.ReminderOccurrence,
        models.ReminderDelivery,
        models.ReminderEvent,
    ):
        profile_column = model.__table__.columns["health_profile_id"]
        assert profile_column.nullable is False
        assert {
            foreign_key.target_fullname for foreign_key in profile_column.foreign_keys
        } == {"health_profiles.id"}


def test_occurrence_delivery_and_event_uniqueness(db_session):
    user, profile, device = _create_identity(db_session)
    reminder = _create_reminder(db_session, user, profile, device)
    occurrence = _create_occurrence(db_session, reminder, profile)
    duplicate_occurrence = models.ReminderOccurrence(
        public_id=_public_id(),
        reminder_id=reminder.id,
        health_profile_id=profile.id,
        schedule_version=occurrence.schedule_version,
        logical_occurrence_key=occurrence.logical_occurrence_key,
        original_scheduled_for_utc=occurrence.original_scheduled_for_utc,
        scheduled_for_utc=occurrence.scheduled_for_utc,
        original_local_date=occurrence.original_local_date,
        original_local_time=occurrence.original_local_time,
        timezone_iana=occurrence.timezone_iana,
        revision=1,
        snooze_count=0,
        state="scheduled",
    )
    db_session.add(duplicate_occurrence)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    delivery = _create_delivery(db_session, occurrence, profile, device)
    duplicate_delivery = models.ReminderDelivery(
        public_id=_public_id(),
        occurrence_id=occurrence.id,
        health_profile_id=profile.id,
        device_id=device.id,
        delivery_revision=delivery.delivery_revision,
        occurrence_version=occurrence.revision,
        state="queued",
        available_at=delivery.available_at,
        expires_at=delivery.expires_at,
        delivery_attempts=0,
    )
    db_session.add(duplicate_delivery)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    second_device = models.Device(
        public_id=_public_id(),
        label="Segundo Klinip One",
        platform="android",
        device_type="klinip_one",
        protocol_version=1,
        status="active",
        token_version=1,
        metadata_json={},
    )
    db_session.add(second_device)
    db_session.commit()
    second_delivery = models.ReminderDelivery(
        public_id=_public_id(),
        occurrence_id=occurrence.id,
        health_profile_id=profile.id,
        device_id=second_device.id,
        delivery_revision=delivery.delivery_revision,
        occurrence_version=occurrence.revision,
        state="queued",
        available_at=delivery.available_at,
        expires_at=delivery.expires_at,
        delivery_attempts=0,
    )
    db_session.add(second_delivery)
    db_session.commit()
    assert db_session.query(models.ReminderDelivery).count() == 2

    client_event_id = _public_id()
    first_event = models.ReminderEvent(
        public_id=_public_id(),
        reminder_id=reminder.id,
        occurrence_id=occurrence.id,
        delivery_id=delivery.id,
        health_profile_id=profile.id,
        actor_kind="device",
        actor_device_id=device.id,
        event_scope="delivery",
        event_type="delivered",
        client_event_id=client_event_id,
        request_fingerprint="e" * 64,
        resulting_state="delivered",
        resulting_version=1,
        metadata_json={},
    )
    db_session.add(first_event)
    db_session.commit()
    duplicate_event = models.ReminderEvent(
        public_id=_public_id(),
        reminder_id=reminder.id,
        occurrence_id=occurrence.id,
        delivery_id=delivery.id,
        health_profile_id=profile.id,
        actor_kind="device",
        actor_device_id=device.id,
        event_scope="delivery",
        event_type="delivered",
        client_event_id=client_event_id,
        request_fingerprint="f" * 64,
        resulting_state="delivered",
        resulting_version=1,
        metadata_json={},
    )
    db_session.add(duplicate_event)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    assert db_session.query(models.ReminderEvent).count() == 1


def test_foreign_keys_reject_wrong_profile_device_and_orphan_event(db_session):
    db_session.execute(text("PRAGMA foreign_keys=ON"))
    user, profile, device = _create_identity(db_session)
    reminder = _create_reminder(db_session, user, profile, device)
    occurrence = _create_occurrence(db_session, reminder, profile)

    wrong_profile_delivery = models.ReminderDelivery(
        public_id=_public_id(),
        occurrence_id=occurrence.id,
        health_profile_id=999999,
        device_id=device.id,
        delivery_revision=1,
        occurrence_version=1,
        state="queued",
        available_at=datetime(2030, 3, 15, 21, 0),
        expires_at=datetime(2030, 3, 16, 21, 0),
        delivery_attempts=0,
    )
    db_session.add(wrong_profile_delivery)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    wrong_device_delivery = models.ReminderDelivery(
        public_id=_public_id(),
        occurrence_id=occurrence.id,
        health_profile_id=profile.id,
        device_id=999999,
        delivery_revision=1,
        occurrence_version=1,
        state="queued",
        available_at=datetime(2030, 3, 15, 21, 0),
        expires_at=datetime(2030, 3, 16, 21, 0),
        delivery_attempts=0,
    )
    db_session.add(wrong_device_delivery)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    orphan_event = models.ReminderEvent(
        public_id=_public_id(),
        reminder_id=reminder.id,
        occurrence_id=None,
        delivery_id=None,
        health_profile_id=profile.id,
        actor_kind="device",
        actor_device_id=device.id,
        event_scope="delivery",
        event_type="delivered",
        client_event_id=_public_id(),
        request_fingerprint="g" * 64,
        resulting_state="delivered",
        resulting_version=1,
        metadata_json={},
    )
    db_session.add(orphan_event)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_delivery_requires_a_concrete_occurrence(db_session):
    _, profile, device = _create_identity(db_session, suffix="delivery-parent")
    delivery = models.ReminderDelivery(
        public_id=_public_id(),
        occurrence_id=None,
        health_profile_id=profile.id,
        device_id=device.id,
        delivery_revision=1,
        occurrence_version=1,
        state="queued",
        available_at=datetime(2030, 3, 15, 21, 0),
        expires_at=datetime(2030, 3, 16, 21, 0),
        delivery_attempts=0,
    )
    db_session.add(delivery)

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_reminder_scoped_event_allows_null_occurrence_and_delivery(db_session):
    user, profile, device = _create_identity(db_session, suffix="reminder-event")
    reminder = _create_reminder(db_session, user, profile, device)
    event = models.ReminderEvent(
        public_id=_public_id(),
        reminder_id=reminder.id,
        occurrence_id=None,
        delivery_id=None,
        health_profile_id=profile.id,
        actor_kind="user",
        actor_user_id=user.id,
        event_scope="reminder",
        event_type="updated",
        client_event_id=_public_id(),
        request_fingerprint="r" * 64,
        expected_version=reminder.version,
        resulting_state="active",
        resulting_version=reminder.version + 1,
        metadata_json={},
    )
    db_session.add(event)
    db_session.commit()

    assert event.occurrence_id is None
    assert event.delivery_id is None


def test_event_scope_actor_target_and_worker_idempotency_are_frozen(db_session):
    user, profile, device = _create_identity(db_session, suffix="event-contract")
    reminder = _create_reminder(db_session, user, profile, device)
    occurrence = _create_occurrence(db_session, reminder, profile)

    invalid_actor = models.ReminderEvent(
        public_id=_public_id(),
        reminder_id=reminder.id,
        occurrence_id=None,
        delivery_id=None,
        health_profile_id=profile.id,
        actor_kind="device",
        actor_device_id=device.id,
        event_scope="reminder",
        event_type="updated",
        client_event_id=_public_id(),
        request_fingerprint="a" * 64,
        resulting_state="active",
        resulting_version=2,
        metadata_json={},
    )
    db_session.add(invalid_actor)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    system_event = models.ReminderEvent(
        public_id=_public_id(),
        reminder_id=reminder.id,
        occurrence_id=occurrence.id,
        delivery_id=None,
        health_profile_id=profile.id,
        actor_kind="worker",
        event_scope="system",
        event_type="materialized",
        client_event_id=None,
        request_fingerprint="b" * 64,
        resulting_state="scheduled",
        resulting_version=1,
        metadata_json={},
    )
    db_session.add(system_event)
    db_session.commit()

    duplicate_system_event = models.ReminderEvent(
        public_id=_public_id(),
        reminder_id=reminder.id,
        occurrence_id=occurrence.id,
        delivery_id=None,
        health_profile_id=profile.id,
        actor_kind="worker",
        event_scope="system",
        event_type="materialized",
        client_event_id=None,
        request_fingerprint="b" * 64,
        resulting_state="scheduled",
        resulting_version=1,
        metadata_json={},
    )
    db_session.add(duplicate_system_event)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_reminder_optimistic_version_rejects_stale_update(db_session):
    user, profile, device = _create_identity(db_session)
    reminder = _create_reminder(db_session, user, profile, device)
    session_factory = sessionmaker(bind=db_session.get_bind())
    first_session = session_factory()
    second_session = session_factory()
    try:
        first = first_session.get(models.Reminder, reminder.id)
        second = second_session.get(models.Reminder, reminder.id)
        first.next_occurrence_at_utc += timedelta(minutes=5)
        first_session.commit()
        assert first.version == 2

        second.next_occurrence_at_utc += timedelta(minutes=10)
        with pytest.raises(StaleDataError):
            second_session.commit()
        second_session.rollback()
    finally:
        first_session.close()
        second_session.close()
