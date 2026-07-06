from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from app import main, models, schemas


def _seed_profile(db_session):
    user = models.User(email="continuity@example.com", password_hash="hash", name="Continuity User")
    db_session.add(user)
    db_session.flush()

    profile = models.HealthProfile(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        full_name="Paciente Continuidad",
        is_primary_profile=True,
    )
    db_session.add(profile)
    db_session.flush()

    link = models.ProfileRelationship(
        profile_id=profile.id,
        user_id=user.id,
        relationship_type="titular",
        role="admin",
        status="accepted",
    )
    user.active_health_profile_id = profile.id
    db_session.add_all([link, user])
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(profile)
    return user, profile


def test_continuity_panel_prioritizes_overdue_tasks_and_preparation(db_session):
    user, profile = _seed_profile(db_session)
    now = datetime.now()
    episode = models.ClinicalEpisode(
        profile_id=profile.id,
        owner_user_id=user.id,
        title="Control cardiología",
        episode_type="clinical_follow_up",
    )
    db_session.add(episode)
    db_session.flush()

    overdue_task = models.ClinicalTask(
        episode_id=episode.id,
        profile_id=profile.id,
        owner_user_id=user.id,
        task_type="appointment_follow_up",
        title="Llevar presión registrada",
        description="Preparar datos antes del control.",
        status="pending",
        due_at=now - timedelta(days=1),
        source_module="continuity",
        source_record_type="appointment",
    )
    future_task = models.ClinicalTask(
        episode_id=episode.id,
        profile_id=profile.id,
        owner_user_id=user.id,
        task_type="lab_result_follow_up",
        title="Subir resultado del examen",
        status="pending",
        due_at=now + timedelta(days=3),
        source_module="documents",
        source_record_type="document",
    )
    appointment = models.Appointment(
        user_id=user.id,
        profile_id=profile.id,
        episode_id=episode.id,
        type=models.AppointmentType.examen,
        specialty="Laboratorio",
        center="Centro Clínico",
        date_time=now + timedelta(days=2),
        status=models.AppointmentStatus.agendada,
    )
    document = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        episode_id=episode.id,
        doc_type=models.DocumentType.resultado,
        filename="hemograma.pdf",
        file_path="",
        date=now - timedelta(days=5),
    )
    medication = models.Medication(
        user_id=user.id,
        profile_id=profile.id,
        episode_id=episode.id,
        name="Losartán",
        dose="50 mg",
        completed=False,
    )
    db_session.add_all([overdue_task, future_task, appointment, document, medication])
    db_session.commit()

    payload = asyncio.run(
        main.get_continuity_panel(
            profile.id,
            db=db_session,
            current_user=user,
        )
    )

    assert payload["counts"]["pending_tasks"] == 2
    assert payload["counts"]["overdue_tasks"] == 1
    assert payload["next_step"]["title"] == "Llevar presión registrada"
    assert payload["next_step"]["priority"] == "overdue"
    assert payload["upcoming_preparation"]["appointment_id"] == appointment.id
    assert payload["upcoming_preparation"]["appointment_type"] == "examen"
    assert payload["upcoming_preparation"]["active_medications_count"] == 1
    assert "hemograma.pdf" in payload["upcoming_preparation"]["documents_to_bring"]


def test_update_continuity_task_marks_task_done_and_hides_from_panel(db_session):
    user, profile = _seed_profile(db_session)
    episode = models.ClinicalEpisode(
        profile_id=profile.id,
        owner_user_id=user.id,
        title="Seguimiento",
        episode_type="clinical_follow_up",
    )
    db_session.add(episode)
    db_session.flush()

    task = models.ClinicalTask(
        episode_id=episode.id,
        profile_id=profile.id,
        owner_user_id=user.id,
        task_type="appointment_follow_up",
        title="Confirmar hora médica",
        description="Llamar al centro antes de la cita.",
        status="pending",
        due_at=datetime.now() - timedelta(days=1),
        source_module="continuity",
        source_record_type="appointment",
    )
    db_session.add(task)
    db_session.commit()

    updated = asyncio.run(
        main.update_continuity_task(
            profile.id,
            task.id,
            schemas.ContinuityTaskUpdate(status="done", note="Hecho desde Mi Salud"),
            db=db_session,
            current_user=user,
        )
    )
    panel = asyncio.run(main.get_continuity_panel(profile.id, db=db_session, current_user=user))

    assert updated.status == "done"
    assert updated.completed_at is not None
    assert updated.metadata_json["last_update_note"] == "Hecho desde Mi Salud"
    assert panel["counts"]["pending_tasks"] == 0
    assert panel["next_step"] is None


def test_update_continuity_task_snoozes_task_with_new_due_date(db_session):
    user, profile = _seed_profile(db_session)
    episode = models.ClinicalEpisode(
        profile_id=profile.id,
        owner_user_id=user.id,
        title="Seguimiento",
        episode_type="clinical_follow_up",
    )
    db_session.add(episode)
    db_session.flush()

    task = models.ClinicalTask(
        episode_id=episode.id,
        profile_id=profile.id,
        owner_user_id=user.id,
        task_type="document_review",
        title="Revisar resultado",
        status="done",
        completed_at=datetime.now(),
        due_at=datetime.now() - timedelta(days=1),
        source_module="documents",
        source_record_type="document",
    )
    db_session.add(task)
    db_session.commit()

    new_due_at = datetime.now() + timedelta(days=7)
    updated = asyncio.run(
        main.update_continuity_task(
            profile.id,
            task.id,
            schemas.ContinuityTaskUpdate(
                status="pending",
                due_at=new_due_at,
                note="Pospuesto desde Mi Salud",
            ),
            db=db_session,
            current_user=user,
        )
    )
    panel = asyncio.run(main.get_continuity_panel(profile.id, db=db_session, current_user=user))

    assert updated.status == "pending"
    assert updated.completed_at is None
    assert updated.due_at == new_due_at
    assert updated.metadata_json["last_update_note"] == "Pospuesto desde Mi Salud"
    assert panel["counts"]["pending_tasks"] == 1
    assert panel["requires_action"][0]["title"] == "Revisar resultado"
