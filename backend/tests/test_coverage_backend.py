from __future__ import annotations

import asyncio

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
        ocr_text="Bono Fonasa total $12.000 copago $3.000 bonificacion $9.000 aprobado",
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
