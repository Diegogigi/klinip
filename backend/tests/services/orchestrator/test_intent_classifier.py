"""Tests del intent_classifier heurístico."""

from __future__ import annotations

import pytest

from app.services.orchestrator import (
    ClinicalPhase,
    ClinicalState,
    IntentKind,
    IntentSource,
    UrgencyLevel,
    classify_intent,
)


def _state(phase=ClinicalPhase.NO_CONTEXT, **kwargs):
    base = dict(
        phase=phase,
        urgency=UrgencyLevel.LOW,
        primary_episode_id=None,
        active_episode_count=0,
        pending_tasks=0,
    )
    base.update(kwargs)
    return ClinicalState(**base)


class TestGetStatus:
    @pytest.mark.parametrize(
        "message",
        [
            "¿cómo estoy?",
            "como estoy hoy",
            "dame un resumen de mi salud",
            "qué tal voy",
            "mi estado general",
        ],
    )
    def test_clasifica_como_get_status(self, message):
        result = classify_intent(message)
        assert result.kind == IntentKind.GET_STATUS
        assert result.confidence >= 0.5


class TestGetPending:
    @pytest.mark.parametrize(
        "message",
        [
            "¿qué me falta?",
            "qué tengo pendiente",
            "cuáles son mis próximos pasos",
            "qué sigue con mi tratamiento",
            "tareas pendientes",
        ],
    )
    def test_clasifica_como_get_pending(self, message):
        result = classify_intent(message)
        assert result.kind == IntentKind.GET_PENDING


class TestGetEpisodeDetail:
    @pytest.mark.parametrize(
        "message",
        [
            "¿qué pasó con mi rodilla?",
            "cómo va mi seguimiento de traumatología",
            "mi proceso de cardiología",
            "cómo va el tratamiento",
        ],
    )
    def test_clasifica_como_episode_detail(self, message):
        result = classify_intent(message)
        assert result.kind == IntentKind.GET_EPISODE_DETAIL


class TestUploadInfo:
    @pytest.mark.parametrize(
        "message",
        [
            "quiero subir un examen",
            "cargar un documento nuevo",
            "registrar un resultado",
            "guardar mi receta",
        ],
    )
    def test_clasifica_como_upload(self, message):
        result = classify_intent(message)
        assert result.kind == IntentKind.UPLOAD_INFO


class TestMedicationInfo:
    @pytest.mark.parametrize(
        "message",
        [
            "qué medicamentos estoy tomando",
            "la dosis de mi remedio",
            "mis pastillas",
            "cómo va mi adherencia",
        ],
    )
    def test_clasifica_como_medication(self, message):
        result = classify_intent(message)
        assert result.kind == IntentKind.MEDICATION_INFO


class TestAppointmentAction:
    @pytest.mark.parametrize(
        "message",
        [
            "cuándo es mi próxima cita",
            "agendar una hora médica",
            "confirmar cita",
            "cancelar hora",
            "reagendar",
        ],
    )
    def test_clasifica_como_appointment(self, message):
        result = classify_intent(message)
        assert result.kind == IntentKind.APPOINTMENT_ACTION


class TestVoiceInputOverride:
    def test_source_voice_retorna_voice_input(self):
        # Aunque el texto parezca otra cosa, si viene de voice → VOICE_INPUT.
        result = classify_intent(
            "el doctor me dijo que tome ibuprofeno",
            source="voice",
        )
        assert result.kind == IntentKind.VOICE_INPUT
        assert result.source == IntentSource.METADATA
        assert result.confidence >= 0.95


class TestUnknownAndGeneral:
    def test_texto_vacio_es_unknown(self):
        result = classify_intent("")
        assert result.kind == IntentKind.UNKNOWN
        assert result.confidence == 0.0

    def test_texto_sin_match_fuerte_cae_a_general(self):
        # Mensaje sin señales claras — score bajo pero no nulo o UNKNOWN
        result = classify_intent("hola, me duele algo raro")
        assert result.kind in {IntentKind.UNKNOWN, IntentKind.GENERAL_QUESTION}
        assert result.confidence < 0.55


class TestStateDisambiguation:
    def test_como_estoy_con_episodio_activo_sube_confidence(self):
        baseline = classify_intent("cómo estoy")
        state = _state(
            phase=ClinicalPhase.TREATMENT,
            primary_episode_id=17,
            active_episode_count=1,
        )
        with_state = classify_intent("cómo estoy", state=state)
        assert with_state.kind == IntentKind.GET_STATUS
        assert with_state.confidence >= baseline.confidence

    def test_pendientes_con_tasks_activas_boostea_get_pending(self):
        state = _state(
            phase=ClinicalPhase.TREATMENT,
            primary_episode_id=17,
            pending_tasks=3,
        )
        result = classify_intent("pendientes", state=state)
        assert result.kind == IntentKind.GET_PENDING

    def test_estado_no_context_no_boostea(self):
        state = _state(phase=ClinicalPhase.NO_CONTEXT)
        result = classify_intent("cómo estoy", state=state)
        # Sin contexto clínico, no hay boost — confidence debe ser la heurística
        assert result.kind in {IntentKind.GET_STATUS, IntentKind.GENERAL_QUESTION}


class TestNormalization:
    def test_acentos_son_equivalentes(self):
        a = classify_intent("cómo estoy")
        b = classify_intent("como estoy")
        assert a.kind == b.kind == IntentKind.GET_STATUS

    def test_mayusculas_son_equivalentes(self):
        a = classify_intent("¿CÓMO ESTOY?")
        b = classify_intent("como estoy")
        assert a.kind == b.kind
