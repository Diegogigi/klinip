from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app import models
from app.main import (
    _attach_medication_adherence,
    _build_medication_event_defaults,
    _medication_intake_to_response_payload,
    _medication_schedule_anchor_at,
    _normalize_medication_intake_payloads,
    _safe_zoneinfo,
)
from app.schemas import MedicationIntakeOut


def _make_medication() -> models.Medication:
    return models.Medication(
        user_id=1,
        name="Paracetamol",
        frequency="Cada 12 horas",
        schedule_time="08:00",
        start_at=datetime(2026, 6, 5, 8, 0, 0),
    )


def test_taken_event_moves_future_scheduled_time_back_to_due_slot():
    med = _make_medication()

    scheduled_at, taken_at, normalized_status = _build_medication_event_defaults(
        med,
        "taken",
        datetime(2026, 6, 5, 20, 0, 0),
        datetime(2026, 6, 5, 8, 10, 0),
    )

    assert scheduled_at == datetime(2026, 6, 5, 8, 0, 0)
    assert taken_at == datetime(2026, 6, 5, 8, 10, 0)
    assert normalized_status == "taken"


def test_taken_event_still_marks_late_after_correcting_future_schedule():
    med = _make_medication()

    scheduled_at, taken_at, normalized_status = _build_medication_event_defaults(
        med,
        "taken",
        datetime(2026, 6, 5, 20, 0, 0),
        datetime(2026, 6, 5, 10, 45, 0),
    )

    assert scheduled_at == datetime(2026, 6, 5, 8, 0, 0)
    assert taken_at == datetime(2026, 6, 5, 10, 45, 0)
    assert normalized_status == "late"


@pytest.mark.parametrize(
    ("taken_at", "expected_status"),
    [
        (datetime(2026, 6, 5, 7, 50, 0), "taken"),
        (datetime(2026, 6, 5, 8, 0, 0), "taken"),
        (datetime(2026, 6, 5, 9, 30, 0), "taken"),
        (datetime(2026, 6, 5, 9, 31, 0), "late"),
        (datetime(2026, 6, 5, 12, 0, 0), "late"),
    ],
)
def test_taken_event_uses_explicit_ninety_minute_late_boundary(taken_at, expected_status):
    med = _make_medication()

    scheduled_at, actual_taken_at, normalized_status = _build_medication_event_defaults(
        med,
        "taken",
        datetime(2026, 6, 5, 8, 0, 0),
        taken_at,
    )

    assert scheduled_at == datetime(2026, 6, 5, 8, 0, 0)
    assert actual_taken_at == taken_at
    assert normalized_status == expected_status


def test_taken_event_keeps_explicit_slot_when_taken_within_early_margin():
    med = _make_medication()

    scheduled_at, taken_at, normalized_status = _build_medication_event_defaults(
        med,
        "taken",
        datetime(2026, 6, 5, 20, 0, 0),
        datetime(2026, 6, 5, 19, 50, 0),
    )

    assert scheduled_at == datetime(2026, 6, 5, 20, 0, 0)
    assert taken_at == datetime(2026, 6, 5, 19, 50, 0)
    assert normalized_status == "taken"


def test_taken_event_reassigns_future_slot_across_midnight_to_last_due_dose():
    med = models.Medication(
        user_id=1,
        name="Paracetamol",
        frequency="Cada 12 horas",
        schedule_time="20:00",
        start_at=datetime(2026, 6, 5, 20, 0, 0),
    )

    scheduled_at, taken_at, normalized_status = _build_medication_event_defaults(
        med,
        "taken",
        datetime(2026, 6, 6, 8, 0, 0),
        datetime(2026, 6, 6, 0, 30, 0),
    )

    assert scheduled_at == datetime(2026, 6, 5, 20, 0, 0)
    assert taken_at == datetime(2026, 6, 6, 0, 30, 0)
    assert normalized_status == "late"


def test_taken_event_normalizes_aware_timestamps_before_selecting_due_slot():
    med = _make_medication()
    local_tz = _safe_zoneinfo("America/Santiago")
    scheduled_local = datetime(2026, 6, 5, 20, 0, 0, tzinfo=local_tz)
    taken_local = datetime(2026, 6, 5, 8, 10, 0, tzinfo=local_tz)

    scheduled_at, taken_at, normalized_status = _build_medication_event_defaults(
        med,
        "taken",
        scheduled_local.astimezone(timezone.utc),
        taken_local.astimezone(timezone.utc),
    )

    assert scheduled_at == datetime(2026, 6, 5, 8, 0, 0)
    assert taken_at == datetime(2026, 6, 5, 8, 10, 0)
    assert normalized_status == "taken"


def test_non_taken_event_does_not_consume_a_future_slot():
    med = _make_medication()

    scheduled_at, taken_at, normalized_status = _build_medication_event_defaults(
        med,
        "skipped",
        datetime(2026, 6, 5, 20, 0, 0),
        None,
    )

    assert scheduled_at == datetime(2026, 6, 5, 20, 0, 0)
    assert taken_at is None
    assert normalized_status == "skipped"


def test_taken_event_snaps_misaligned_schedule_to_real_8_hour_slot():
    med = models.Medication(
        user_id=1,
        name="Paracetamol",
        frequency="Cada 8 horas",
        schedule_time="00:01",
        start_at=datetime(2026, 6, 21, 0, 1, 0),
    )
    med.schedule_anchor_at = datetime(2026, 6, 20, 12, 44, 0)

    scheduled_at, taken_at, normalized_status = _build_medication_event_defaults(
        med,
        "taken",
        datetime(2026, 6, 20, 12, 49, 0),
        datetime(2026, 6, 20, 12, 49, 0),
    )

    assert scheduled_at == datetime(2026, 6, 20, 12, 44, 0)
    assert taken_at == datetime(2026, 6, 20, 12, 49, 0)
    assert normalized_status == "taken"


def test_schedule_anchor_uses_first_tracked_dose_when_medication_was_logged_mid_cycle(db_session):
    med = models.Medication(
        user_id=1,
        name="Paracetamol",
        frequency="Cada 8 horas",
        schedule_time="00:01",
        start_at=datetime(2026, 6, 21, 0, 1, 0),
    )
    db_session.add(med)
    db_session.flush()
    db_session.add(
        models.MedicationIntake(
            user_id=1,
            medication_id=med.id,
            scheduled_at=datetime(2026, 6, 20, 12, 44, 0),
            taken_at=datetime(2026, 6, 20, 12, 44, 0),
            status="taken",
            source="automatic",
        )
    )
    db_session.commit()

    anchor_at = _medication_schedule_anchor_at(db_session, med, user_id=1)

    assert anchor_at == datetime(2026, 6, 20, 12, 44, 0)


def test_normalized_intake_payloads_collapse_duplicate_events_into_same_due_slot(db_session):
    med = models.Medication(
        user_id=1,
        name="Paracetamol",
        frequency="Cada 8 horas",
        schedule_time="00:01",
        start_at=datetime(2026, 6, 21, 0, 1, 0),
    )
    db_session.add(med)
    db_session.flush()
    items = [
        models.MedicationIntake(
            id=1,
            user_id=1,
            medication_id=med.id,
            scheduled_at=datetime(2026, 6, 20, 12, 44, 0),
            taken_at=datetime(2026, 6, 20, 12, 44, 0),
            status="taken",
            source="automatic",
            created_at=datetime(2026, 6, 20, 12, 44, 30),
        ),
        models.MedicationIntake(
            id=2,
            user_id=1,
            medication_id=med.id,
            scheduled_at=datetime(2026, 6, 20, 12, 49, 0),
            taken_at=datetime(2026, 6, 20, 12, 49, 0),
            status="taken",
            source="automatic",
            created_at=datetime(2026, 6, 20, 12, 49, 30),
        ),
    ]
    med.schedule_anchor_at = datetime(2026, 6, 20, 12, 44, 0)

    payloads = _normalize_medication_intake_payloads(med, items)

    assert len(payloads) == 1
    assert payloads[0]["scheduled_at"] == datetime(2026, 6, 20, 12, 44, 0)
    assert payloads[0]["taken_at"] == datetime(2026, 6, 20, 12, 49, 0)


def test_attach_medication_adherence_uses_normalized_slots_for_taken_count(db_session):
    med = models.Medication(
        user_id=1,
        name="Paracetamol",
        frequency="Cada 8 horas",
        schedule_time="00:01",
        start_at=datetime(2026, 6, 21, 0, 1, 0),
    )
    db_session.add(med)
    db_session.flush()
    db_session.add_all(
        [
            models.MedicationIntake(
                user_id=1,
                medication_id=med.id,
                scheduled_at=datetime(2026, 6, 20, 12, 44, 0),
                taken_at=datetime(2026, 6, 20, 12, 44, 0),
                status="taken",
                source="automatic",
                created_at=datetime(2026, 6, 20, 12, 44, 30),
            ),
            models.MedicationIntake(
                user_id=1,
                medication_id=med.id,
                scheduled_at=datetime(2026, 6, 20, 12, 49, 0),
                taken_at=datetime(2026, 6, 20, 12, 49, 0),
                status="taken",
                source="automatic",
                created_at=datetime(2026, 6, 20, 12, 49, 30),
            ),
        ]
    )
    db_session.commit()

    _attach_medication_adherence(
        db_session,
        [med],
        SimpleNamespace(id=1),
        owner_user_id=1,
    )

    assert med.schedule_anchor_at == datetime(2026, 6, 20, 12, 44, 0)
    assert med.taken_doses == 1


def test_missed_intake_keeps_taken_at_empty_in_database(db_session):
    intake = models.MedicationIntake(
        user_id=1,
        medication_id=1,
        scheduled_at=datetime(2026, 6, 5, 15, 30, 0),
        taken_at=None,
        status="missed",
        source="scheduler",
    )

    db_session.add(intake)
    db_session.commit()
    db_session.refresh(intake)

    assert intake.taken_at is None


def test_missed_intake_response_hides_taken_at_even_if_row_has_one():
    intake = models.MedicationIntake(
        id=9,
        user_id=1,
        medication_id=7,
        scheduled_at=datetime(2026, 6, 5, 15, 30, 0),
        taken_at=datetime(2026, 6, 6, 1, 28, 0, tzinfo=timezone.utc),
        status="missed",
        source="scheduler",
        notes="Evento generado automaticamente por falta de registro.",
        created_at=datetime(2026, 6, 6, 1, 28, 0, tzinfo=timezone.utc),
    )

    payload = _medication_intake_to_response_payload(intake)

    assert payload["taken_at"] is None
    assert payload["status"] == "missed"


def test_intake_serializer_preserves_timezone_offset_for_aware_datetimes():
    serialized = MedicationIntakeOut(
        id=1,
        medication_id=2,
        user_id=3,
        scheduled_at=datetime(2026, 6, 5, 15, 30, 0),
        taken_at=datetime(2026, 6, 6, 1, 28, 0, tzinfo=timezone.utc),
        status="taken",
        source="manual",
        notes="",
        created_at=datetime(2026, 6, 6, 1, 28, 0, tzinfo=timezone.utc),
    ).model_dump()

    assert serialized["scheduled_at"] == "2026-06-05T15:30:00"
    assert serialized["taken_at"] == "2026-06-06T01:28:00+00:00"
    assert serialized["created_at"] == "2026-06-06T01:28:00+00:00"
