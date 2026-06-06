from __future__ import annotations

from datetime import datetime, timezone

from app import models
from app.main import _build_medication_event_defaults, _medication_intake_to_response_payload
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
