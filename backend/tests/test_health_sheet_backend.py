from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from app import main, models, schemas


def _seed_profile(db_session):
    user = models.User(email="health-sheet@example.com", password_hash="hash", name="Health Sheet User")
    db_session.add(user)
    db_session.flush()

    profile = models.HealthProfile(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        full_name="Paciente Ficha",
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


def test_health_sheet_aggregates_structured_sources(db_session):
    user, profile = _seed_profile(db_session)
    now = datetime.now()

    exam_doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        doc_type=models.DocumentType.resultado,
        filename="hemograma-control.pdf",
        file_path="",
        date=now - timedelta(days=7),
        ocr_status="done",
        ocr_text="Hemograma con hemoglobina bajo rango.",
    )
    vaccine_doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        doc_type=models.DocumentType.otro,
        filename="carnet-vacuna-influenza.pdf",
        file_path="",
        date=now - timedelta(days=30),
        ocr_status="done",
        ocr_text="Carnet de vacunacion influenza 2026.",
    )
    db_session.add_all([exam_doc, vaccine_doc])
    db_session.flush()

    db_session.add(
        models.DocumentClinicalEntity(
            document_id=exam_doc.id,
            entity_type="diagnosis",
            entity_name="Anemia en estudio",
            entity_value="Impresión del informe",
            confidence=82,
            source_text="Anemia en estudio",
        )
    )
    db_session.add(
        models.DocumentSummary(
            document_id=exam_doc.id,
            document_type_inferred="resultado",
            summary_plain="Hemograma de control.",
            patient_friendly_explanation="Hay un valor bajo que requiere revisión clínica.",
            abnormal_values_json=[{"name": "Hemoglobina", "value": "10.5", "unit": "g/dL", "flag": "low"}],
        )
    )
    db_session.add(
        models.VoiceSession(
            profile_id=profile.id,
            user_id=user.id,
            version_simple="Consulta resumida.",
            indicaciones=[{"tipo": "control", "texto": "Control médico en dos semanas."}],
        )
    )
    db_session.add(
        models.Medication(
            user_id=user.id,
            profile_id=profile.id,
            name="Hierro",
            dose="1 comprimido",
            frequency="cada día",
            completed=False,
        )
    )
    episode = models.ClinicalEpisode(
        profile_id=profile.id,
        owner_user_id=user.id,
        title="Anemia",
        episode_type="diagnostic_workup",
    )
    db_session.add(episode)
    db_session.flush()
    db_session.add(
        models.ClinicalTask(
            episode_id=episode.id,
            profile_id=profile.id,
            owner_user_id=user.id,
            title="Llevar hemograma al control",
            task_type="appointment_follow_up",
            status="pending",
            due_at=now + timedelta(days=3),
        )
    )
    db_session.commit()

    payload = asyncio.run(
        main.get_health_sheet(
            profile.id,
            db=db_session,
            current_user=user,
        )
    )

    assert payload["profile_id"] == profile.id
    assert payload["counts"]["diagnoses"] == 1
    assert payload["counts"]["vaccines"] == 1
    assert payload["counts"]["exams"] == 1
    assert payload["counts"]["indications"] >= 3
    assert payload["diagnoses"][0]["name"] == "Anemia en estudio"
    assert payload["vaccines"][0]["name"] == "Influenza"
    assert payload["exams"][0]["abnormal_values"][0]["name"] == "Hemoglobina"
    assert any(item["indication_type"] == "control" for item in payload["indications"])
    assert any(item["indication_type"] == "medicamento" for item in payload["indications"])
    assert payload["sources"]


def test_health_sheet_structured_records_are_editable_and_prioritized(db_session):
    user, profile = _seed_profile(db_session)
    now = datetime.now()

    problem = asyncio.run(
        main.create_health_problem(
            profile.id,
            schemas.HealthProblemCreate(
                name="Hipertensión arterial",
                detail="Controlar presión en casa.",
                severity="moderate",
                onset_at=now - timedelta(days=90),
            ),
            db=db_session,
            current_user=user,
        )
    )
    vaccine = asyncio.run(
        main.create_health_vaccine(
            profile.id,
            schemas.HealthVaccineRecordCreate(
                vaccine_name="Influenza",
                dose_label="Campaña 2026",
                administered_at=now - timedelta(days=20),
                provider_name="CESFAM",
            ),
            db=db_session,
            current_user=user,
        )
    )
    exam = asyncio.run(
        main.create_health_exam_result(
            profile.id,
            schemas.HealthExamResultCreate(
                exam_name="Perfil lipídico",
                category="laboratorio",
                summary="Colesterol LDL sobre rango de referencia.",
                performed_at=now - timedelta(days=5),
                values_json=[{"name": "LDL", "value": "150", "unit": "mg/dL", "flag": "high"}],
            ),
            db=db_session,
            current_user=user,
        )
    )

    updated_problem = asyncio.run(
        main.update_health_problem(
            profile.id,
            problem.id,
            schemas.HealthProblemUpdate(status="resolved"),
            db=db_session,
            current_user=user,
        )
    )
    payload = asyncio.run(main.get_health_sheet(profile.id, db=db_session, current_user=user))

    assert updated_problem.status == "resolved"
    assert vaccine.vaccine_name == "Influenza"
    assert exam.values_json[0]["name"] == "LDL"
    assert payload["diagnoses"][0]["name"] == "Hipertensión arterial"
    assert payload["diagnoses"][0]["source"]["source_type"] == "health_problem"
    assert payload["vaccines"][0]["source"]["source_type"] == "vaccine_record"
    assert payload["exams"][0]["source"]["source_type"] == "exam_result"
    assert payload["counts"]["diagnoses"] == 1
    assert payload["counts"]["vaccines"] == 1
    assert payload["counts"]["exams"] == 1


def test_health_sheet_action_creates_clinical_task(db_session):
    user, profile = _seed_profile(db_session)
    due_at = datetime.now() + timedelta(days=2)

    task = asyncio.run(
        main.create_health_sheet_action(
            profile.id,
            schemas.HealthSheetActionCreate(
                title="Agendar control de presión",
                description="Pendiente creado desde indicación de la ficha viva.",
                task_type="control",
                due_at=due_at,
                source_type="health_problem",
                source_id=123,
            ),
            db=db_session,
            current_user=user,
        )
    )
    panel = asyncio.run(main.get_continuity_panel(profile.id, db=db_session, current_user=user))

    assert task.title == "Agendar control de presión"
    assert task.source_module == "health_sheet"
    assert task.source_record_type == "health_problem"
    assert panel["counts"]["pending_tasks"] == 1
    assert panel["requires_action"][0]["title"] == "Agendar control de presión"
