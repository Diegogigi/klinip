from __future__ import annotations

from datetime import datetime

from fastapi import BackgroundTasks
from sqlalchemy.orm import sessionmaker

from app import main, models


def _seed_profile_context(db_session):
    user = models.User(
        email="ocr@example.com",
        password_hash="hash",
        name="OCR User",
    )
    db_session.add(user)
    db_session.flush()

    profile = models.HealthProfile(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        full_name="Paciente OCR",
        is_primary_profile=True,
    )
    db_session.add(profile)
    db_session.flush()

    user.active_health_profile_id = profile.id
    db_session.add(user)

    episode = models.ClinicalEpisode(
        profile_id=profile.id,
        owner_user_id=user.id,
        title="Proceso OCR",
        episode_type="general",
        source="test",
        started_at=datetime(2026, 1, 10, 9, 0),
        last_activity_at=datetime(2026, 1, 10, 9, 0),
        summary="Seguimiento de prueba",
        care_summary="Seguimiento de prueba",
    )
    db_session.add(episode)
    db_session.flush()
    db_session.commit()
    return user, profile, episode


def test_recipe_ocr_creates_multiple_medications_and_keeps_links(db_session):
    user, profile, episode = _seed_profile_context(db_session)
    doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        episode_id=episode.id,
        doc_type=models.DocumentType.receta,
        filename="receta.jpg",
        file_data=b"fake-image",
        ocr_text=(
            "Paracetamol 500 mg cada 8 horas por 5 dias\n"
            "Ibuprofeno 400 mg cada 12 horas por 3 dias"
        ),
        ocr_status="done",
    )
    db_session.add(doc)
    db_session.commit()

    detected = main._apply_document_ocr_automations(db_session, doc)
    db_session.commit()
    db_session.refresh(doc)

    meds = (
        db_session.query(models.Medication)
        .filter(models.Medication.document_id == doc.id)
        .order_by(models.Medication.name.asc())
        .all()
    )

    assert len(meds) == 2
    assert len(detected) == 2
    assert all(item.profile_id == profile.id for item in meds)
    assert all(item.episode_id == episode.id for item in meds)
    assert db_session.query(models.Document).filter(models.Document.id == doc.id).first() is not None


def test_order_ocr_creates_appointment_with_profile_and_episode(db_session):
    user, profile, episode = _seed_profile_context(db_session)
    doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        episode_id=episode.id,
        doc_type=models.DocumentType.orden,
        filename="orden.pdf",
        file_data=b"fake-pdf",
        ocr_text=(
            "Fecha y Hora Citacion: 12/09/2026 14:30\n"
            "Tipo de Atencion: Resonancia rodilla"
        ),
        ocr_status="done",
    )
    db_session.add(doc)
    db_session.commit()

    main._apply_document_ocr_automations(db_session, doc)
    db_session.commit()
    db_session.refresh(doc)

    appointment = (
        db_session.query(models.Appointment)
        .filter(models.Appointment.id == doc.appointment_id)
        .first()
    )

    assert appointment is not None
    assert appointment.profile_id == profile.id
    assert appointment.episode_id == episode.id
    assert appointment.type == models.AppointmentType.examen


def test_other_document_with_medication_text_is_preserved_and_reclassified(db_session):
    user, profile, episode = _seed_profile_context(db_session)
    doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        episode_id=episode.id,
        doc_type=models.DocumentType.otro,
        filename="caja-medicamento.jpg",
        file_data=b"fake-image",
        ocr_text=(
            "PARACETAMOL\n"
            "500 mg\n"
            "1 comprimido al dia x 7 dias"
        ),
        ocr_status="done",
    )
    db_session.add(doc)
    db_session.commit()

    detected = main._apply_document_ocr_automations(db_session, doc)
    db_session.commit()
    db_session.refresh(doc)

    meds = (
        db_session.query(models.Medication)
        .filter(models.Medication.document_id == doc.id)
        .all()
    )

    assert doc.doc_type == models.DocumentType.receta
    assert len(detected) == 1
    assert len(meds) == 1
    assert meds[0].profile_id == profile.id
    assert meds[0].episode_id == episode.id
    assert db_session.query(models.Document).filter(models.Document.id == doc.id).first() is not None


def test_other_document_with_lab_result_text_is_reclassified_to_resultado(db_session):
    user, profile, episode = _seed_profile_context(db_session)
    doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        episode_id=episode.id,
        doc_type=models.DocumentType.otro,
        filename="hemograma.pdf",
        file_data=b"fake-pdf",
        ocr_text=(
            "Resultado laboratorio clinico\n"
            "Hemoglobina: 12.5 g/dL\n"
            "Leucocitos: 7800\n"
        ),
        ocr_status="done",
    )
    db_session.add(doc)
    db_session.commit()

    main._apply_document_ocr_automations(db_session, doc)
    db_session.commit()
    db_session.refresh(doc)

    assert doc.doc_type == models.DocumentType.resultado


def test_upload_document_type_normalizer_accepts_auto_aliases():
    assert main._normalize_uploaded_document_type("auto") == models.DocumentType.otro
    assert main._normalize_uploaded_document_type("Autodetectar con IA") == models.DocumentType.otro
    assert main._normalize_uploaded_document_type("examen") == models.DocumentType.resultado


def test_queue_document_post_upload_tasks_prioritizes_ocr(db_session):
    user, profile, episode = _seed_profile_context(db_session)
    doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        episode_id=episode.id,
        doc_type=models.DocumentType.receta,
        filename="receta.jpg",
        file_data=b"fake-image",
        ocr_status="pending",
    )
    db_session.add(doc)
    db_session.commit()

    tasks = BackgroundTasks()
    main._queue_document_post_upload_tasks(
        tasks,
        doc=doc,
        current_user=user,
        send_email_backup=True,
        file_content=b"fake-image",
        original_filename="receta.jpg",
    )

    task_names = [task.func.__name__ for task in tasks.tasks]

    assert task_names[0] == "_run_document_ocr"
    assert "_send_medical_order_uploaded_email_safe" in task_names[1:]
    assert "_send_document_backup_email_safe" in task_names[1:]


def test_run_document_ocr_persists_done_status_when_automations_fail(db_session, monkeypatch):
    user, profile, episode = _seed_profile_context(db_session)
    doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        episode_id=episode.id,
        doc_type=models.DocumentType.receta,
        filename="receta.jpg",
        file_data=b"fake-image",
        ocr_status="pending",
    )
    db_session.add(doc)
    db_session.commit()

    test_session_local = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=db_session.get_bind(),
    )
    monkeypatch.setattr(main, "SessionLocal", test_session_local)
    monkeypatch.setattr(main, "_extract_ocr_text", lambda *_args, **_kwargs: "Paracetamol 500 mg")

    def _raise_automation_error(_db, _doc):
        raise RuntimeError("automation exploded")

    monkeypatch.setattr(main, "_apply_document_ocr_automations", _raise_automation_error)

    main._run_document_ocr(doc.id)

    db_session.expire_all()
    refreshed = db_session.query(models.Document).filter(models.Document.id == doc.id).first()

    assert refreshed is not None
    assert refreshed.ocr_status == "done"
    assert refreshed.ocr_text == "Paracetamol 500 mg"
