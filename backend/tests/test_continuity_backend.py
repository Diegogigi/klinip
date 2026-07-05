from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from app import main, models


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
