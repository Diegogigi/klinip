from __future__ import annotations

from datetime import datetime

from app import models
from app.main import _build_medication_event_defaults


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
