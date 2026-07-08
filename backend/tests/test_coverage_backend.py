from __future__ import annotations

import asyncio
from io import BytesIO
import json
from datetime import datetime

import pytest
from fastapi import BackgroundTasks, HTTPException, UploadFile

from app import main, models, schemas


def _seed_profile(db_session):
    user = models.User(email="coverage@example.com", password_hash="hash", name="Coverage User")
    db_session.add(user)
    db_session.flush()

    profile = models.HealthProfile(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        full_name="Paciente Cobertura",
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


def _seed_family_collaborator(db_session, profile, *, role="viewer", permissions=None):
    collaborator = models.User(
        email=f"family-{role}-{len(permissions or [])}@example.com",
        password_hash="hash",
        name="Family Collaborator",
    )
    db_session.add(collaborator)
    db_session.flush()
    link = models.ProfileRelationship(
        profile_id=profile.id,
        user_id=collaborator.id,
        relationship_type="cuidador",
        role=role,
        status="accepted",
        permissions_json=json.dumps(permissions or []),
    )
    collaborator.active_health_profile_id = profile.id
    db_session.add_all([link, collaborator])
    db_session.commit()
    db_session.refresh(collaborator)
    db_session.refresh(link)
    return collaborator, link


def test_coverage_preferences_can_be_saved_per_profile(db_session):
    user, profile = _seed_profile(db_session)
    default_response = asyncio.run(
        main.get_coverage_preferences(db=db_session, current_user=user)
    )
    assert default_response.profile_id == profile.id
    assert default_response.enabled is False

    update_response = asyncio.run(
        main.update_coverage_preferences(
            schemas.CoveragePreferenceUpdate(
                enabled=True,
                payer_type="isapre",
                provider_name="Colmena",
                plan_name="Plan familiar",
            ),
            db=db_session,
            current_user=user,
        )
    )
    assert update_response.enabled is True
    assert update_response.payer_type == "isapre"
    assert update_response.provider_name == "Colmena"

    saved = db_session.query(models.CoveragePreference).filter_by(profile_id=profile.id).one()
    assert saved.owner_user_id == user.id
    assert saved.configured_by_user_id == user.id


def test_coverage_document_endpoint_classifies_existing_document(db_session):
    user, profile = _seed_profile(db_session)
    doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        doc_type=models.DocumentType.otro,
        filename="bono-fonasa.pdf",
        file_path="",
        notes="[KLINIP_COVERAGE_INTENT] Cobertura / seguro",
        ocr_text="Bono Fonasa fecha de atencion 12/06/2026 total $12.000 copago $3.000 bonificacion $9.000 aprobado",
        ocr_status="done",
    )
    db_session.add(doc)
    db_session.commit()

    payload = asyncio.run(main.get_coverage_documents(db=db_session, current_user=user))
    assert len(payload) == 1
    assert payload[0].document.id == doc.id
    assert payload[0].coverage.category == "bono"
    assert payload[0].coverage.payer_type == "fonasa"
    assert payload[0].coverage.amount_total == 12000
    assert payload[0].coverage.amount_patient == 3000
    assert payload[0].coverage.status == "aprobado"
    assert payload[0].coverage.service_at.date().isoformat() == "2026-06-12"


def test_coverage_license_extracts_start_and_end_dates(db_session):
    user, profile = _seed_profile(db_session)
    doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        doc_type=models.DocumentType.otro,
        filename="licencia-medica.jpg",
        file_path="",
        notes="[KLINIP_COVERAGE_INTENT] Cobertura / seguro",
        ocr_text=(
            "Licencia medica COMPIN fecha de emision 01/07/2026 "
            "reposo laboral desde 03/07/2026 hasta 17/07/2026 pendiente"
        ),
        ocr_status="done",
    )
    db_session.add(doc)
    db_session.commit()

    payload = asyncio.run(main.get_coverage_documents(db=db_session, current_user=user))
    assert len(payload) == 1
    assert payload[0].coverage.category == "licencia"
    assert payload[0].coverage.status == "pendiente"
    assert payload[0].coverage.issued_at.date().isoformat() == "2026-07-01"
    assert payload[0].coverage.period_start_at.date().isoformat() == "2026-07-03"
    assert payload[0].coverage.period_end_at.date().isoformat() == "2026-07-17"


def test_coverage_document_info_can_be_corrected_manually(db_session):
    user, profile = _seed_profile(db_session)
    doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        doc_type=models.DocumentType.otro,
        filename="cuenta-clinica.pdf",
        file_path="",
        notes="[KLINIP_COVERAGE_INTENT] Cobertura / seguro",
        ocr_text="Cuenta clinica copago $45.000 pendiente",
        ocr_status="done",
    )
    db_session.add(doc)
    db_session.commit()

    payload = asyncio.run(
        main.update_coverage_document_info(
            doc.id,
            schemas.CoverageDocumentInfoUpdate(
                category="reembolso",
                payer_type="seguro complementario",
                provider_name="Seguro empresa",
                amount_reimbursed=25000,
                status="pendiente",
                period_start_at=datetime(2026, 7, 3),
                period_end_at=datetime(2026, 7, 17),
            ),
            db=db_session,
            current_user=user,
        )
    )

    assert payload.coverage.category == "reembolso"
    assert payload.coverage.payer_type == "seguro_complementario"
    assert payload.coverage.provider_name == "Seguro empresa"
    assert payload.coverage.amount_reimbursed == 25000
    assert payload.coverage.period_start_at.date().isoformat() == "2026-07-03"
    assert payload.coverage.period_end_at.date().isoformat() == "2026-07-17"
    assert payload.coverage.metadata_json["manual_override"] is True


def test_family_coverage_requires_module_permission(db_session):
    owner, profile = _seed_profile(db_session)
    doc = models.Document(
        user_id=owner.id,
        profile_id=profile.id,
        doc_type=models.DocumentType.otro,
        filename="bono-familiar.pdf",
        file_path="",
        notes="[KLINIP_COVERAGE_INTENT] Cobertura / seguro",
        ocr_text="Bono Fonasa total $20.000 copago $5.000 bonificacion $15.000 aprobado",
        ocr_status="done",
    )
    db_session.add(doc)
    db_session.commit()

    collaborator, link = _seed_family_collaborator(
        db_session,
        profile,
        role="viewer",
        permissions=["view_profile", "view_documents"],
    )
    with pytest.raises(HTTPException) as denied:
        asyncio.run(
            main.get_coverage_documents(
                profile_id=profile.id,
                db=db_session,
                current_user=collaborator,
            )
        )
    assert denied.value.status_code == 403

    link.permissions_json = json.dumps(["view_profile", "view_documents", "view_coverage"])
    db_session.add(link)
    db_session.commit()
    payload = asyncio.run(
        main.get_coverage_documents(
            profile_id=profile.id,
            db=db_session,
            current_user=collaborator,
        )
    )
    assert len(payload) == 1
    assert payload[0].document.id == doc.id


def test_family_coverage_edit_requires_edit_permission(db_session):
    owner, profile = _seed_profile(db_session)
    doc = models.Document(
        user_id=owner.id,
        profile_id=profile.id,
        doc_type=models.DocumentType.otro,
        filename="reembolso-familiar.pdf",
        file_path="",
        notes="[KLINIP_COVERAGE_INTENT] Cobertura / seguro",
        ocr_text="Reembolso seguro complementario total $60.000 pendiente",
        ocr_status="done",
    )
    db_session.add(doc)
    db_session.commit()

    collaborator, link = _seed_family_collaborator(
        db_session,
        profile,
        role="caregiver",
        permissions=["view_profile", "view_coverage"],
    )
    update_payload = schemas.CoverageDocumentInfoUpdate(
        category="reembolso",
        payer_type="seguro complementario",
        amount_reimbursed=30000,
    )
    with pytest.raises(HTTPException) as denied:
        asyncio.run(
            main.update_coverage_document_info(
                doc.id,
                update_payload,
                db=db_session,
                current_user=collaborator,
            )
        )
    assert denied.value.status_code == 403

    link.permissions_json = json.dumps(["view_profile", "view_coverage", "edit_coverage"])
    db_session.add(link)
    db_session.commit()
    payload = asyncio.run(
        main.update_coverage_document_info(
            doc.id,
            update_payload,
            db=db_session,
            current_user=collaborator,
        )
    )
    assert payload.coverage.category == "reembolso"
    assert payload.coverage.amount_reimbursed == 30000


def test_family_coverage_upload_uses_requested_profile(db_session, monkeypatch):
    owner, profile = _seed_profile(db_session)
    collaborator, _link = _seed_family_collaborator(
        db_session,
        profile,
        role="caregiver",
        permissions=["view_profile", "view_documents", "edit_documents", "view_coverage", "edit_coverage"],
    )
    monkeypatch.setattr(main, "_queue_document_post_upload_tasks", lambda *args, **kwargs: None)

    uploaded = asyncio.run(
        main.upload_document(
            BackgroundTasks(),
            doc_type="otro",
            episode_id=None,
            appointment_id=None,
            profile_id=profile.id,
            date=None,
            center="",
            notes="[KLINIP_COVERAGE_INTENT] Cobertura / seguro",
            send_email_backup=False,
            file=UploadFile(filename="licencia-medica.jpg", file=BytesIO(b"\xff\xd8\xff\xe0fake-image")),
            db=db_session,
            current_user=collaborator,
        )
    )

    assert uploaded.profile_id == profile.id
    assert uploaded.user_id == owner.id
    assert uploaded.notes == "[KLINIP_COVERAGE_INTENT] Cobertura / seguro"


def test_ai_context_includes_coverage_sources_and_amounts(db_session):
    user, profile = _seed_profile(db_session)
    link = (
        db_session.query(models.ProfileRelationship)
        .filter_by(profile_id=profile.id, user_id=user.id)
        .one()
    )
    doc = models.Document(
        user_id=user.id,
        profile_id=profile.id,
        doc_type=models.DocumentType.otro,
        filename="bono-fonasa-urgencia.pdf",
        file_path="",
        notes="[KLINIP_COVERAGE_INTENT] Cobertura / seguro",
        ocr_text="Bono Fonasa total $18.000 copago $4.500 bonificacion $13.500 aprobado",
        ocr_status="done",
    )
    db_session.add(doc)
    db_session.commit()

    assert main.detect_chat_intent("cuanto fue mi copago de fonasa") == "cobertura"
    modules = main.select_context_modules("cobertura")
    assert modules["coverage"] is True

    context, _timing = main._build_chat_context_base(
        db_session,
        user,
        profile,
        link,
        user.id,
        message="cuanto fue mi copago de fonasa",
        intent="cobertura",
        modules=modules,
    )

    coverage_context = context["coverage_context"]
    assert coverage_context["documents_total"] == 1
    assert coverage_context["documents"][0]["document_id"] == doc.id
    assert coverage_context["documents"][0]["amount_patient"] == 4500
    assert coverage_context["documents"][0]["category"] == "bono"
    assert coverage_context["totals"]["amount_patient"] == 4500

    serialized = main._serialize_ai_context(
        context,
        {"coverage_documents_limit": 5, "documents_limit": 2, "document_chunks_limit": 3},
    )
    assert serialized["coverage_context"]["documents"][0]["source_label"] == "bono-fonasa-urgencia.pdf"

    refs = main._build_ai_references("cuanto fue mi copago de fonasa", context)
    assert any(ref["kind"] == "coverage-document" for ref in refs)
    assert any("Copago $4.500" in ref["detail"] for ref in refs)

    structured = main._maybe_resolve_structured_ai_query("cuanto fue mi copago de fonasa", context)
    assert structured is not None
    reply, model_name, mode = structured
    assert model_name == "structured-memory"
    assert mode == "structured-coverage"
    assert "bono-fonasa-urgencia.pdf" in reply
    assert "$4.500" in reply
