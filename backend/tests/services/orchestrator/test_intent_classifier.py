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
        # Frase sin ninguna señal heuristica — debe caer a UNKNOWN o GENERAL_QUESTION
        result = classify_intent("xyz qwerty foo bar baz")
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


# ─── Nuevos intents (spec Fase 1b refinada) ──────────────────────────────────


class TestGreeting:
    def test_hola_simple(self):
        assert classify_intent("Hola").kind == IntentKind.GREETING

    def test_buenos_dias(self):
        assert classify_intent("Buenos días").kind == IntentKind.GREETING

    def test_buenas_tardes(self):
        assert classify_intent("Buenas tardes").kind == IntentKind.GREETING

    def test_negativo_no_confunde_mensaje_clinico(self):
        # "tengo un dolor" no debe clasificarse como GREETING
        assert classify_intent("tengo un dolor").kind != IntentKind.GREETING


class TestAssistantCapabilities:
    def test_capacidades_del_bot(self):
        result = classify_intent("Qué capacidades tienes ?")
        assert result.kind == IntentKind.ASSISTANT_CAPABILITIES

    def test_que_puedes_hacer(self):
        result = classify_intent("qué puedes hacer")
        assert result.kind == IntentKind.ASSISTANT_CAPABILITIES

    def test_en_que_me_ayudas(self):
        result = classify_intent("en qué me ayudas")
        assert result.kind == IntentKind.ASSISTANT_CAPABILITIES

    def test_negativo_pregunta_clinica_no_matchea(self):
        # "qué tengo pendiente" no debe caer en capabilities
        assert classify_intent("qué tengo pendiente").kind != IntentKind.ASSISTANT_CAPABILITIES


class TestFamilyInfo:
    def test_cuantos_familiares(self):
        result = classify_intent("Cuántos familiares están asociados a mi?")
        assert result.kind == IntentKind.FAMILY_INFO

    def test_publicaciones_del_feed(self):
        result = classify_intent("cuántas publicaciones de mi familia hay")
        assert result.kind == IntentKind.FAMILY_INFO

    def test_acceso_admin_al_perfil(self):
        result = classify_intent("ella tiene acceso como admin a mi perfil")
        assert result.kind == IntentKind.FAMILY_INFO

    def test_grupo_familiar(self):
        assert classify_intent("mi grupo familiar").kind == IntentKind.FAMILY_INFO

    def test_negativo_mi_medicamento_no_es_familia(self):
        assert classify_intent("mi medicamento").kind != IntentKind.FAMILY_INFO


class TestDocumentInfo:
    def test_leer_documento(self):
        assert classify_intent("leer documento").kind == IntentKind.DOCUMENT_INFO

    def test_de_que_trata_el_documento(self):
        assert classify_intent("de qué trata el documento").kind == IntentKind.DOCUMENT_INFO

    def test_ultimo_documento(self):
        assert classify_intent("mi último documento").kind == IntentKind.DOCUMENT_INFO

    def test_negativo_cita_no_es_document_info(self):
        assert classify_intent("próxima cita").kind != IntentKind.DOCUMENT_INFO


class TestHistorySummary:
    def test_mi_historial(self):
        assert classify_intent("mi historial").kind == IntentKind.HISTORY_SUMMARY

    def test_cuantas_atenciones(self):
        assert classify_intent("cuántas atenciones tengo").kind == IntentKind.HISTORY_SUMMARY

    def test_que_tengo_registrado(self):
        assert classify_intent("qué tengo registrado").kind == IntentKind.HISTORY_SUMMARY

    def test_negativo_medicamentos_no_es_historial(self):
        assert classify_intent("mis medicamentos").kind != IntentKind.HISTORY_SUMMARY


class TestExamInfo:
    def test_examenes_que_debo_realizarme(self):
        result = classify_intent("Cuáles son mis exámenes que debo realizarme ?")
        assert result.kind == IntentKind.EXAM_INFO

    def test_que_examenes_tengo(self):
        assert classify_intent("qué exámenes tengo").kind == IntentKind.EXAM_INFO

    def test_orden_medica(self):
        assert classify_intent("necesito una orden médica").kind == IntentKind.EXAM_INFO

    def test_negativo_cuantos_familiares_no_es_exam(self):
        assert classify_intent("cuántos familiares tengo").kind != IntentKind.EXAM_INFO


class TestFollowUpAction:
    def test_sin_contexto_cae_en_unknown(self):
        # Sin previous_intent no debe activar FOLLOW_UP_ACTION
        result = classify_intent("Si hazlo")
        assert result.kind != IntentKind.FOLLOW_UP_ACTION
        assert result.kind in {IntentKind.UNKNOWN, IntentKind.GENERAL_QUESTION}

    def test_con_contexto_activa_follow_up(self):
        result = classify_intent("Si hazlo", previous_intent=IntentKind.APPOINTMENT_ACTION)
        assert result.kind == IntentKind.FOLLOW_UP_ACTION

    def test_con_contexto_correcto(self):
        result = classify_intent("correcto", previous_intent=IntentKind.GET_PENDING)
        assert result.kind == IntentKind.FOLLOW_UP_ACTION

    def test_con_contexto_si_toda_la_informacion_es_correcta(self):
        result = classify_intent(
            "Si toda la información es correcta",
            previous_intent=IntentKind.UPLOAD_INFO,
        )
        assert result.kind == IntentKind.FOLLOW_UP_ACTION

    def test_previous_unknown_no_cuenta_como_contexto(self):
        # previous_intent = UNKNOWN no debe habilitar FOLLOW_UP_ACTION
        result = classify_intent("si hazlo", previous_intent=IntentKind.UNKNOWN)
        assert result.kind != IntentKind.FOLLOW_UP_ACTION


# ─── Expansión MEDICATION_INFO ───────────────────────────────────────────────


class TestMedicationInfoExpanded:
    def test_para_que_sirve(self):
        assert classify_intent("para qué sirve").kind == IntentKind.MEDICATION_INFO

    def test_que_hace_este_medicamento(self):
        result = classify_intent("qué hace este medicamento")
        assert result.kind == IntentKind.MEDICATION_INFO


# ─── Patrones expandidos en intents existentes ───────────────────────────────


class TestExpandedPatterns:
    def test_me_duele_es_get_status(self):
        result = classify_intent("me duele la cabeza")
        assert result.kind == IntentKind.GET_STATUS

    def test_no_me_siento_bien_es_get_status(self):
        result = classify_intent("no me siento bien")
        assert result.kind == IntentKind.GET_STATUS

    def test_que_tiene_mi_hijo_es_get_status(self):
        result = classify_intent("qué tiene mi hijo")
        assert result.kind == IntentKind.GET_STATUS
