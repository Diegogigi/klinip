"""Tests del intent_shadow_logger — persistencia y pipeline completo."""

from __future__ import annotations

import pytest

from app import models
from app.services.orchestrator import (
    ClinicalPhase,
    ClinicalState,
    Intent,
    IntentKind,
    IntentSource,
    UrgencyLevel,
    estimate_would_change_response,
    log_intent_shadow,
    run_intent_shadow_pipeline,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _make_user(db, email="shadow@test.cl"):
    user = models.User(email=email, password_hash="x", name="Shadow")
    db.add(user)
    db.flush()
    return user


def _make_profile(db, user):
    profile = models.HealthProfile(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        full_name="Shadow Profile",
    )
    db.add(profile)
    db.flush()
    return profile


def _state(
    *,
    phase=ClinicalPhase.NO_CONTEXT,
    urgency=UrgencyLevel.LOW,
    primary_episode_id=None,
    pending_tasks=0,
    active_episode_count=0,
    upcoming_appointment_hours=None,
):
    return ClinicalState(
        phase=phase,
        urgency=urgency,
        primary_episode_id=primary_episode_id,
        active_episode_count=active_episode_count,
        pending_tasks=pending_tasks,
        upcoming_appointment_hours=upcoming_appointment_hours,
    )


def _intent(kind, *, confidence=0.8, source=IntentSource.HEURISTIC):
    return Intent(kind=kind, confidence=confidence, source=source)


# ─── would_change_response ────────────────────────────────────────────────────


class TestWouldChangeResponse:
    def test_get_status_con_contexto_cambia(self):
        state = _state(phase=ClinicalPhase.TREATMENT, primary_episode_id=1)
        assert estimate_would_change_response(_intent(IntentKind.GET_STATUS), state) is True

    def test_get_status_sin_contexto_no_cambia(self):
        state = _state(phase=ClinicalPhase.NO_CONTEXT)
        assert estimate_would_change_response(_intent(IntentKind.GET_STATUS), state) is False

    def test_get_pending_con_tareas_cambia(self):
        state = _state(pending_tasks=2)
        assert estimate_would_change_response(_intent(IntentKind.GET_PENDING), state) is True

    def test_get_pending_sin_tareas_no_cambia(self):
        state = _state(pending_tasks=0)
        assert estimate_would_change_response(_intent(IntentKind.GET_PENDING), state) is False

    def test_episode_detail_con_primary_cambia(self):
        state = _state(primary_episode_id=5)
        assert estimate_would_change_response(
            _intent(IntentKind.GET_EPISODE_DETAIL), state
        ) is True

    def test_medication_info_con_urgencia_alta_cambia(self):
        state = _state(urgency=UrgencyLevel.HIGH)
        assert estimate_would_change_response(
            _intent(IntentKind.MEDICATION_INFO), state
        ) is True

    def test_medication_info_urgencia_baja_no_cambia(self):
        state = _state(urgency=UrgencyLevel.LOW)
        assert estimate_would_change_response(
            _intent(IntentKind.MEDICATION_INFO), state
        ) is False

    def test_appointment_con_cita_cercana_cambia(self):
        state = _state(upcoming_appointment_hours=12.0)
        assert estimate_would_change_response(
            _intent(IntentKind.APPOINTMENT_ACTION), state
        ) is True

    def test_voice_input_siempre_cambia(self):
        assert estimate_would_change_response(
            _intent(IntentKind.VOICE_INPUT), _state()
        ) is True

    def test_unknown_no_cambia(self):
        assert estimate_would_change_response(
            _intent(IntentKind.UNKNOWN), _state()
        ) is False


# ─── log_intent_shadow ────────────────────────────────────────────────────────


class TestLogIntentShadow:
    def test_persiste_fila_basica(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        db_session.commit()

        intent = Intent(
            kind=IntentKind.GET_STATUS,
            confidence=0.75,
            source=IntentSource.HEURISTIC,
            matched_patterns=["pattern1"],
            raw_scores={"get_status": 0.75},
        )
        state = _state(phase=ClinicalPhase.TREATMENT, primary_episode_id=42)

        row = log_intent_shadow(
            db_session,
            user_id=user.id,
            profile_id=profile.id,
            conversation_id="conv-1",
            source="chat",
            message="¿cómo estoy?",
            intent=intent,
            state=state,
            latency_ms=15,
        )

        assert row is not None
        assert row.id is not None
        assert row.user_id == user.id
        assert row.profile_id == profile.id
        assert row.intent_predicted == "get_status"
        assert row.intent_source == "heuristic"
        assert row.clinical_phase == "treatment"
        assert row.primary_episode_id == 42
        assert row.would_change_response is True  # status + contexto
        assert row.latency_ms == 15
        assert row.message_preview == "¿cómo estoy?"

    def test_trunca_message_preview(self, db_session):
        user = _make_user(db_session)
        db_session.commit()

        long_message = "x" * 500
        row = log_intent_shadow(
            db_session,
            user_id=user.id,
            profile_id=None,
            conversation_id="",
            source="chat",
            message=long_message,
            intent=_intent(IntentKind.UNKNOWN, confidence=0.0),
            state=_state(),
            latency_ms=1,
        )
        assert row is not None
        assert len(row.message_preview) == 200

    def test_llm_fallback_flag(self, db_session):
        user = _make_user(db_session)
        db_session.commit()

        intent = Intent(
            kind=IntentKind.GENERAL_QUESTION,
            confidence=0.4,
            source=IntentSource.LLM,
        )
        row = log_intent_shadow(
            db_session,
            user_id=user.id,
            profile_id=None,
            conversation_id="c",
            source="chat",
            message="hola",
            intent=intent,
            state=_state(),
            latency_ms=10,
        )
        assert row is not None
        assert row.used_llm_fallback is True
        assert row.intent_source == "llm"

    def test_metadata_json_incluye_patrones_y_scores(self, db_session):
        user = _make_user(db_session)
        db_session.commit()

        intent = Intent(
            kind=IntentKind.GET_PENDING,
            confidence=0.8,
            source=IntentSource.HEURISTIC,
            matched_patterns=[r"\bpendientes?\b"],
            raw_scores={"get_pending": 0.8, "get_status": 0.1},
        )
        state = _state(pending_tasks=3, active_episode_count=2)

        row = log_intent_shadow(
            db_session,
            user_id=user.id,
            profile_id=None,
            conversation_id="c",
            source="chat",
            message="qué tengo pendiente",
            intent=intent,
            state=state,
            latency_ms=5,
            extra_metadata={"extra_key": "extra_val"},
        )
        assert row is not None
        meta = row.metadata_json
        assert meta["matched_patterns"] == [r"\bpendientes?\b"]
        assert meta["raw_scores"]["get_pending"] == 0.8
        assert meta["pending_tasks"] == 3
        assert meta["active_episode_count"] == 2
        assert meta["extra_key"] == "extra_val"

    def test_fail_safe_no_levanta_excepcion(self, db_session):
        # Forzar fallo con intent inválido (kind no es enum) → debe retornar None.
        class FakeIntent:
            kind = None
            source = None
            confidence = "not a number"
            matched_patterns = None
            raw_scores = None

        result = log_intent_shadow(
            db_session,
            user_id=1,
            profile_id=None,
            conversation_id="c",
            source="chat",
            message="m",
            intent=FakeIntent(),  # type: ignore[arg-type]
            state=_state(),
            latency_ms=1,
        )
        assert result is None


# ─── run_intent_shadow_pipeline ───────────────────────────────────────────────


class TestRunShadowPipeline:
    def test_pipeline_sin_profile_usa_no_context(self, db_session):
        user = _make_user(db_session)
        db_session.commit()

        row = run_intent_shadow_pipeline(
            db_session,
            user_id=user.id,
            profile_id=None,
            conversation_id="c-1",
            source="chat",
            message="cómo estoy",
        )
        assert row is not None
        assert row.clinical_phase == "no_context"
        assert row.intent_predicted in {"get_status", "general_question", "unknown"}

    def test_pipeline_con_profile_computa_state_real(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        db_session.commit()

        row = run_intent_shadow_pipeline(
            db_session,
            user_id=user.id,
            profile_id=profile.id,
            conversation_id="c-2",
            source="chat",
            message="qué medicamentos estoy tomando",
        )
        assert row is not None
        assert row.user_id == user.id
        assert row.profile_id == profile.id
        assert row.intent_predicted == "medication_info"
        assert row.latency_ms >= 0

    def test_pipeline_source_voice_retorna_voice_input(self, db_session):
        user = _make_user(db_session)
        db_session.commit()

        row = run_intent_shadow_pipeline(
            db_session,
            user_id=user.id,
            profile_id=None,
            conversation_id="c-3",
            source="voice",
            message="transcripción cualquiera",
        )
        assert row is not None
        assert row.intent_predicted == "voice_input"
        assert row.intent_source == "metadata"
        assert row.would_change_response is True
