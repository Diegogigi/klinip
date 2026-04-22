"""Intent classifier — heurístico con fallback opcional a LLM.

Diseño:
- Primera pasada: matching de patrones normalizados (sin acentos, lowercase).
- Cada intent tiene una lista de patrones con peso.
- Se calcula un score por intent y se selecciona el top.
- Si el top está por encima del umbral → intent claro.
- Si no → UNKNOWN (o LLM si está explícitamente habilitado).

El clinical state se usa como *desambiguador* — para mensajes genéricos
("¿cómo estoy?") el estado puede subir la confidence de GET_STATUS.
"""

from __future__ import annotations

import os
import re
import unicodedata
from typing import Optional

from .contracts import (
    ClinicalPhase,
    ClinicalState,
    Intent,
    IntentKind,
    IntentSource,
)


HEURISTIC_CONFIDENCE_THRESHOLD = 0.55
LLM_FALLBACK_MAX_CHARS = 400


def classify_intent(
    message: str,
    *,
    source: str = "chat",
    state: Optional[ClinicalState] = None,
    previous_intent: Optional[IntentKind] = None,
    enable_llm_fallback: bool = False,
) -> Intent:
    """Clasifica un mensaje del usuario en un IntentKind.

    Args:
        message: texto del usuario.
        source: "chat" | "voice" | "quick_action". Si es "voice",
            retorna VOICE_INPUT directo (el orquestador especializado
            inferirá el intent del contenido más adelante).
        state: ClinicalState opcional — si se pasa, se usa como
            desambiguador en mensajes ambiguos.
        previous_intent: último intent válido (no UNKNOWN/None) de la
            conversación. Necesario para habilitar FOLLOW_UP_ACTION —
            sin contexto, frases como "sí hazlo" caen a UNKNOWN.
        enable_llm_fallback: si True y la confidence heurística queda
            por debajo del umbral, consulta al LLM. Default: False
            (shadow mode debe ser barato y determinista).
    """
    if source == "voice":
        return Intent(
            kind=IntentKind.VOICE_INPUT,
            confidence=0.99,
            source=IntentSource.METADATA,
            matched_patterns=["source:voice"],
        )

    normalized = _normalize(message)
    if not normalized:
        return Intent(
            kind=IntentKind.UNKNOWN,
            confidence=0.0,
            source=IntentSource.HEURISTIC,
        )

    scores, matches = _score_intents(normalized)

    # FOLLOW_UP_ACTION solo es válido si hay contexto conversacional previo.
    if not _has_valid_followup_context(previous_intent):
        scores[IntentKind.FOLLOW_UP_ACTION] = 0.0

    kind, confidence = _pick_top(scores)

    if state is not None:
        kind, confidence = _apply_state_disambiguation(kind, confidence, scores, state)

    if confidence < HEURISTIC_CONFIDENCE_THRESHOLD:
        if enable_llm_fallback and _llm_fallback_available():
            llm_result = _llm_classify(message)
            if llm_result is not None:
                return llm_result
        if confidence < 0.25:
            kind = IntentKind.UNKNOWN
        else:
            kind = IntentKind.GENERAL_QUESTION

    return Intent(
        kind=kind,
        confidence=round(confidence, 3),
        source=IntentSource.HEURISTIC,
        matched_patterns=matches.get(kind, []),
        raw_scores={k.value: round(v, 3) for k, v in scores.items()},
    )


def _has_valid_followup_context(previous_intent: Optional[IntentKind]) -> bool:
    if previous_intent is None:
        return False
    return previous_intent != IntentKind.UNKNOWN


# ─── Normalización ───────────────────────────────────────────────────────────


def _normalize(text: str) -> str:
    raw = unicodedata.normalize("NFKD", str(text or ""))
    ascii_text = "".join(c for c in raw if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", ascii_text.lower()).strip()


# ─── Patrones ────────────────────────────────────────────────────────────────


# Cada entrada: (regex, weight). Los pesos altos indican señales específicas.
INTENT_PATTERNS: dict[IntentKind, list[tuple[str, float]]] = {
    IntentKind.GET_STATUS: [
        (r"\bcomo estoy\b", 1.0),
        (r"\bcomo voy\b", 0.9),
        (r"\bcomo va mi salud\b", 1.0),
        (r"\bmi estado\b", 0.8),
        (r"\bestado general\b", 0.9),
        (r"\bresumen (de mi salud|general|clinico)\b", 0.95),
        (r"\bque tal (estoy|voy)\b", 0.9),
        (r"\b(me duele|tengo dolor|me siento mal)\b", 0.85),
        (r"\bno me siento bien\b", 0.9),
        (r"\bcuentame (de )?mi salud\b", 0.9),
        (r"\bdime (de )?mi (salud|estado)\b", 0.9),
        (r"\bque tiene mi (hijo|hija|mama|papa|esposo|esposa|pareja)\b", 0.9),
        (r"^\s*que tengo\s*[?.!]?\s*$", 0.85),
        (r"\bque me pasa\b", 0.85),
    ],
    IntentKind.GET_PENDING: [
        (r"\bque me falta\b", 1.0),
        (r"\bque tengo pendiente\b", 1.0),
        (r"\bpendientes?\b", 0.7),
        (r"\bque sigue\b", 0.85),
        (r"\bproximos? pasos?\b", 0.9),
        (r"\bque (tengo|hay) que hacer\b", 0.9),
        (r"\btareas? pendientes?\b", 0.95),
        (r"\bcuales son mis (pendientes|tareas)\b", 0.9),
    ],
    IntentKind.GET_EPISODE_DETAIL: [
        (r"\bque paso con\b", 1.0),
        (r"\bcomo va (mi|el) (proceso|seguimiento|tratamiento)\b", 0.95),
        (r"\bmi (rodilla|espalda|corazon|cabeza|estomago|diabetes|presion|higado|rinon|tiroides)\b", 0.8),
        (r"\b(traumatologia|cardiologia|neurologia|ginecologia|dermatologia|oftalmologia|urologia|endocrinologia)\b", 0.85),
        (r"\bseguimiento de\b", 0.85),
        (r"\bmi episodio\b", 0.9),
        (r"\bhistoria de\b", 0.7),
    ],
    IntentKind.UPLOAD_INFO: [
        (r"\b(subir|cargar|agregar|adjuntar)\b.*\b(examen|documento|receta|orden|resultado|informe|foto)\b", 1.0),
        (r"\bnuev[oa] (documento|examen|receta)\b", 0.9),
        (r"\bregistrar\b.*\b(examen|documento|consulta|resultado|informe)\b", 0.9),
        (r"\bguardar\b.*\b(documento|examen|receta|resultado|informe)\b", 0.95),
    ],
    IntentKind.MEDICATION_INFO: [
        (r"\bmedicamentos?\b", 0.9),
        (r"\bremedios?\b", 0.9),
        (r"\bpastillas?\b", 0.9),
        (r"\bdosis\b", 0.9),
        (r"\b(tomar|tome|tomo)\b.*\b(remedio|medicamento|pastilla)\b", 0.95),
        (r"\badherencia\b", 0.95),
        (r"\bmi tratamiento\b", 0.6),
        (r"\bpara que (es|sirve|se (usa|toma))\b", 0.85),
        (r"\bque hace (este|el|la|mi) (remedio|medicamento|pastilla)\b", 0.95),
        (r"\bsirve para\b", 0.8),
    ],
    IntentKind.APPOINTMENT_ACTION: [
        (r"\bcitas?\b", 0.7),
        (r"\bhoras? medicas?\b", 0.85),
        (r"\bagendar\b", 0.9),
        (r"\bconfirmar (cita|hora)\b", 0.95),
        (r"\bcancelar (cita|hora)\b", 0.95),
        (r"\breagendar\b", 0.95),
        (r"\bproxima cita\b", 0.95),
        (r"\bcuando es mi (cita|examen|control)\b", 0.9),
    ],
    IntentKind.GENERAL_QUESTION: [
        # Preguntas genéricas de salud que no matchean con nada específico.
        (r"^que es\b", 0.5),
        (r"^como funciona\b", 0.5),
        (r"\besto es normal\b", 0.6),
        (r"\bque significa\b", 0.5),
    ],
    IntentKind.GREETING: [
        (r"^\s*hola\b", 1.0),
        (r"^\s*buenas?\b", 0.95),
        (r"^\s*buen[oa]s? (dias|tardes|noches)\b", 1.0),
        (r"^\s*hey\b", 0.9),
        (r"^\s*saludos\b", 0.9),
    ],
    IntentKind.ASSISTANT_CAPABILITIES: [
        (r"\bque capacidades tienes\b", 1.0),
        (r"\b(que (puedes|puede|sabes) hacer)\b", 1.0),
        (r"\ben que me ayudas\b", 0.95),
        (r"\bcomo me (puedes|podrias) asistir\b", 0.95),
        (r"\b(capacidades|funcionalidades)\b", 0.85),
        (r"\bcomo (uso|funciona) (la app|klinip)\b", 0.9),
        (r"\bque es klinip\b", 1.0),
        (r"\bme (gustaria|gustaria que) (me )?(asista|asistas|ayudes|ayude)\b", 0.8),
    ],
    IntentKind.FAMILY_INFO: [
        (r"\bmi familia\b", 0.9),
        (r"\bfamiliares?\b", 0.85),
        (r"\bgrupo familiar\b", 1.0),
        (r"\bfamiliares? (asociados?|vinculad[oa]s?|de mi cuenta)\b", 0.95),
        (r"\b(asociados?|vinculad[oa]s?) a mi (cuenta|perfil)\b", 0.9),
        (r"\bcuantos (familiares?|usuarios?)\b", 0.9),
        (r"\b(publicacione?s?|posts?|feed)\b", 0.85),
        (r"\b(acceso|permisos?) (como )?admin(istrador)?\b", 0.9),
        (r"\badmin a mi perfil\b", 0.95),
        (r"\b(quien|tiene|tienen) acceso a mi perfil\b", 0.95),
        (r"\bacceso a mi perfil\b", 0.85),
        (r"\bes mi (esposa|esposo|pareja|hijo|hija|mama|papa|hermano|hermana)\b", 0.85),
    ],
    IntentKind.DOCUMENT_INFO: [
        (r"\b(ultimo|mi ultimo) documento\b", 1.0),
        (r"\bleer (el |mi )?documento\b", 0.95),
        (r"\bde que trata (el |mi )?documento\b", 1.0),
        (r"\bque dice (el |mi )?documento\b", 1.0),
        (r"\bdocumentos?\b", 0.7),
        (r"\bmostrar (el |mi )?documento\b", 0.9),
    ],
    IntentKind.HISTORY_SUMMARY: [
        (r"\bmi historial\b", 1.0),
        (r"\bhistorial (clinico|medico)\b", 1.0),
        (r"\bque me puedes decir\b", 0.85),
        (r"\bcuantas atenciones\b", 0.95),
        (r"\bque tengo registrado\b", 0.95),
        (r"\bresumen de (mi )?historial\b", 1.0),
        (r"\bque (me )?dijo (el )?doctor\b", 1.0),
        (r"\bque (me )?indico (el )?doctor\b", 0.95),
        (r"\bque dice (mi )?(ultima )?(atencion|consulta)\b", 0.9),
    ],
    IntentKind.EXAM_INFO: [
        (r"\bexamenes? que (debo|tengo que) (realizarme|hacerme|hacer)\b", 1.0),
        (r"\bque examenes?\b", 0.9),
        (r"\bcuales son mis examenes?\b", 0.95),
        (r"\bque examen debo hacerme\b", 1.0),
        (r"\b(mi |mis )?orden(es)? medic[oa]s?\b", 0.95),
        (r"\bcuales son mis orden(es)? medic[oa]s?\b", 1.0),
        (r"\b(mis )?examenes?\b", 0.7),
    ],
    IntentKind.FOLLOW_UP_ACTION: [
        (r"^\s*si\s+hazlo\b", 1.0),
        (r"^\s*si toda la informacion es correcta\b", 1.0),
        (r"^\s*correcto\b", 0.95),
        (r"^\s*esta bien\b", 0.9),
        (r"^\s*(confirmo|de acuerdo|perfecto)\b", 0.9),
        (r"^\s*si\s*[.!]?\s*$", 0.85),
    ],
}


def _score_intents(
    normalized: str,
) -> tuple[dict[IntentKind, float], dict[IntentKind, list[str]]]:
    scores: dict[IntentKind, float] = {kind: 0.0 for kind in INTENT_PATTERNS}
    matches: dict[IntentKind, list[str]] = {kind: [] for kind in INTENT_PATTERNS}

    for kind, patterns in INTENT_PATTERNS.items():
        for pattern, weight in patterns:
            if re.search(pattern, normalized):
                scores[kind] += weight
                matches[kind].append(pattern)

    # Normalizar a [0, 1]. El peso máximo "creíble" por intent es ~1.5
    # (un patrón fuerte + un refuerzo). Capamos suavemente.
    normalized_scores = {
        kind: min(1.0, value / 1.5) for kind, value in scores.items()
    }
    return normalized_scores, matches


_PRIORITY_ORDER: list[IntentKind] = [
    IntentKind.GREETING,
    IntentKind.ASSISTANT_CAPABILITIES,
    IntentKind.FAMILY_INFO,
    IntentKind.DOCUMENT_INFO,
    IntentKind.MEDICATION_INFO,
    IntentKind.EXAM_INFO,
    IntentKind.HISTORY_SUMMARY,
    IntentKind.GET_STATUS,
    IntentKind.GET_PENDING,
    IntentKind.GET_EPISODE_DETAIL,
    IntentKind.UPLOAD_INFO,
    IntentKind.APPOINTMENT_ACTION,
    IntentKind.GENERAL_QUESTION,
    IntentKind.FOLLOW_UP_ACTION,
]
_PRIORITY_RANK: dict[IntentKind, int] = {kind: i for i, kind in enumerate(_PRIORITY_ORDER)}
_TIE_EPSILON = 0.05


def _pick_top(scores: dict[IntentKind, float]) -> tuple[IntentKind, float]:
    """Elige el intent ganador. Score manda; prioridad desempata empates cercanos."""
    if not scores:
        return IntentKind.UNKNOWN, 0.0
    top_score = max(scores.values())
    if top_score <= 0.0:
        return IntentKind.UNKNOWN, 0.0
    candidates = [
        (kind, value)
        for kind, value in scores.items()
        if value >= top_score - _TIE_EPSILON
    ]
    winner = min(
        candidates,
        key=lambda item: _PRIORITY_RANK.get(item[0], len(_PRIORITY_ORDER)),
    )
    return winner[0], winner[1]


# ─── Desambiguación por estado clínico ───────────────────────────────────────


def _apply_state_disambiguation(
    kind: IntentKind,
    confidence: float,
    scores: dict[IntentKind, float],
    state: ClinicalState,
) -> tuple[IntentKind, float]:
    """Usa el ClinicalState para subir confidence en casos ambiguos.

    Regla: si el top score es bajo y el estado tiene señales fuertes
    (episodio primario activo, pending_tasks > 0), boosteamos los intents
    naturalmente relacionados.
    """
    if confidence >= 0.8:
        return kind, confidence  # ya es claro, no tocar

    status_score = scores.get(IntentKind.GET_STATUS, 0.0)
    pending_score = scores.get(IntentKind.GET_PENDING, 0.0)
    episode_score = scores.get(IntentKind.GET_EPISODE_DETAIL, 0.0)

    # Hay una señal clara de estado activo con pendientes
    if state.pending_tasks > 0 and pending_score > 0.3:
        return IntentKind.GET_PENDING, min(1.0, pending_score + 0.15)

    # Usuario pregunta por su estado y hay un episodio primario activo
    if (
        state.primary_episode_id
        and status_score > 0.3
        and state.phase != ClinicalPhase.NO_CONTEXT
    ):
        return IntentKind.GET_STATUS, min(1.0, status_score + 0.15)

    # Pregunta por detalle y el estado confirma episodio primario
    if state.primary_episode_id and episode_score > 0.3:
        return IntentKind.GET_EPISODE_DETAIL, min(1.0, episode_score + 0.1)

    return kind, confidence


# ─── LLM fallback (opcional) ─────────────────────────────────────────────────


def _llm_fallback_available() -> bool:
    if (os.getenv("KLINIP_INTENT_LLM_FALLBACK") or "").lower() not in {"1", "true", "yes"}:
        return False
    return bool((os.getenv("OPENAI_API_KEY") or "").strip())


def _llm_classify(message: str) -> Optional[Intent]:
    """Fallback minimalista al LLM. Solo se invoca si el flag está ON.

    Mantenido como stub de integración: la ejecución real se delega al
    helper de OpenAI existente en main.py en la Fase 2. En shadow mode
    (Fase 1b) este fallback está apagado por defecto.
    """
    # Intencionalmente sin llamada real al LLM en Fase 1b.
    # La integración concreta se añadirá cuando el orchestrator salga de shadow.
    return None
