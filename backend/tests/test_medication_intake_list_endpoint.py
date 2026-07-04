"""El historial de tomas debe contar eventos sobre el historial completo.

Regresión: el endpoint limitaba las filas ANTES de deduplicar, por lo que el
contador de eventos del detalle quedaba descuadrado con taken_doses (que sí se
calcula sobre todas las filas).
"""

import asyncio
from datetime import datetime, timedelta

import pytest

from app import main, models


def _make_user() -> models.User:
    return models.User(email="intakes@test.cl", password_hash="hash", name="Test")


def _make_medication(user_id: int) -> models.Medication:
    return models.Medication(
        user_id=user_id,
        name="Amoxicilina",
        dose="500 mg",
        frequency="Cada 24 horas",
        schedule_time="08:00",
        start_at=datetime(2026, 1, 1, 8, 0, 0),
    )


@pytest.fixture()
def _endpoint_env(monkeypatch, db_session):
    user = _make_user()
    db_session.add(user)
    db_session.flush()
    med = _make_medication(user.id)
    db_session.add(med)
    db_session.flush()

    monkeypatch.setattr(main, "ensure_medication_schema", lambda *args, **kwargs: None)
    monkeypatch.setattr(main, "ensure_medication_intake_schema", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        main,
        "_get_active_profile_context",
        lambda db, current_user, require_write=False: (None, None, user.id),
    )
    return user, med, db_session


def test_intake_counts_cover_full_history_beyond_limit(_endpoint_env):
    user, med, db = _endpoint_env
    base = datetime(2026, 1, 1, 8, 0, 0)
    for index in range(75):
        slot = base + timedelta(days=index)
        status = "missed" if index < 5 else "taken"
        db.add(
            models.MedicationIntake(
                user_id=user.id,
                medication_id=med.id,
                scheduled_at=slot,
                taken_at=slot if status == "taken" else None,
                status=status,
                source="manual",
                created_at=slot,
            )
        )
    db.flush()

    result = asyncio.run(
        main.list_medication_intakes(med.id, limit=60, db=db, current_user=user)
    )

    assert result["total_events"] == 75
    assert result["taken_events"] == 70
    assert result["missed_events"] == 5
    assert result["skipped_events"] == 0
    assert len(result["items"]) == 60
    # Los eventos visibles son los más recientes.
    assert result["items"][0]["scheduled_at"] >= result["items"][-1]["scheduled_at"]


def test_intake_counts_deduplicate_same_slot(_endpoint_env):
    user, med, db = _endpoint_env
    slot = datetime(2026, 1, 1, 8, 0, 0)
    for status in ("missed", "taken"):
        db.add(
            models.MedicationIntake(
                user_id=user.id,
                medication_id=med.id,
                scheduled_at=slot,
                taken_at=slot if status == "taken" else None,
                status=status,
                source="manual",
                created_at=slot,
            )
        )
    db.flush()

    result = asyncio.run(
        main.list_medication_intakes(med.id, limit=60, db=db, current_user=user)
    )

    # El mismo horario programado se resuelve como UN evento, priorizando la toma.
    assert result["total_events"] == 1
    assert result["taken_events"] == 1
    assert result["missed_events"] == 0


def test_backfill_registers_unlogged_past_doses(_endpoint_env):
    user, med, db = _endpoint_env
    # Tratamiento diario que empezó hace 9 días: 10 tomas ya transcurridas.
    now = datetime.now().replace(second=0, microsecond=0)
    start = now - timedelta(days=9, minutes=1)
    med.start_at = start
    med.schedule_time = start.strftime("%H:%M")
    db.flush()

    # 3 tomas registradas, 1 omitida explícitamente por la persona.
    for index in range(3):
        slot = start + timedelta(days=index)
        db.add(
            models.MedicationIntake(
                user_id=user.id,
                medication_id=med.id,
                scheduled_at=slot,
                taken_at=slot,
                status="taken",
                source="manual",
                created_at=slot,
            )
        )
    skipped_slot = start + timedelta(days=3)
    db.add(
        models.MedicationIntake(
            user_id=user.id,
            medication_id=med.id,
            scheduled_at=skipped_slot,
            taken_at=None,
            status="skipped",
            source="manual",
            created_at=skipped_slot,
        )
    )
    db.flush()

    result = asyncio.run(
        main.backfill_medication_intakes(med.id, db=db, current_user=user)
    )

    # Se rellenan solo los 6 huecos: no se tocan las 3 tomadas ni la omitida.
    assert result["created"] == 6

    listing = asyncio.run(
        main.list_medication_intakes(med.id, limit=60, db=db, current_user=user)
    )
    assert listing["taken_events"] == 9
    assert listing["skipped_events"] == 1
    assert listing["total_events"] == 10

    # Repetir el backfill no duplica nada.
    repeat = asyncio.run(
        main.backfill_medication_intakes(med.id, db=db, current_user=user)
    )
    assert repeat["created"] == 0


def test_total_planned_doses_covers_full_treatment(_endpoint_env):
    user, med, db = _endpoint_env
    med.start_at = datetime(2026, 4, 13, 23, 47, 0)
    med.schedule_time = "23:47"
    med.duration = "85 días"
    db.flush()

    main._attach_medication_adherence(db, [med], user)

    # 85 días cada 24 horas = 85 dosis en todo el tratamiento, sin importar
    # cuántas correspondan hasta hoy.
    assert med.total_planned_doses == 85


def test_total_planned_doses_none_without_end(_endpoint_env):
    user, med, db = _endpoint_env

    main._attach_medication_adherence(db, [med], user)

    # Sin duración ni fecha de término (tratamiento crónico) no hay total: la
    # UI usa las dosis esperadas hasta hoy.
    assert med.total_planned_doses is None
