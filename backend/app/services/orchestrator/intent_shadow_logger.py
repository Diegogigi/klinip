"""Shadow logger — persiste clasificación de intent sin afectar respuestas.

Se usa en Fase 1b para recopilar data real: qué intents se clasifican,
cuándo diferiría la respuesta del orquestador respecto al chat actual,
cómo se distribuye el clinical_phase en producción.

Diseño fail-safe: cualquier excepción se silencia con log. Nunca debe
afectar el flujo de `/ai/chat`.
"""

from __future__ import annotations

import time
from typing import Optional

from sqlalchemy.orm import Session

from ... import models
from .clinical_state_engine import compute_clinical_state
from .contracts import ClinicalPhase, ClinicalState, Intent, IntentKind, UrgencyLevel
from .intent_classifier import classify_intent


MESSAGE_PREVIEW_MAX_CHARS = 200


def estimate_would_change_response(intent: Intent, state: ClinicalState) -> bool:
    """Estima si el orquestador daría una respuesta distinta al chat actual.

    Heurística conservadora usada solo para métricas de shadow:
    devuelve True cuando la combinación intent + state sugiere una
    respuesta estructurada por episodio en lugar de un listado de datos.
    """
    if intent.kind == IntentKind.GET_STATUS and state.phase != ClinicalPhase.NO_CONTEXT:
        return True

    if intent.kind == IntentKind.GET_PENDING and state.pending_tasks > 0:
        return True

    if intent.kind == IntentKind.GET_EPISODE_DETAIL and state.primary_episode_id:
        return True

    if intent.kind == IntentKind.MEDICATION_INFO and state.urgency in {
        UrgencyLevel.HIGH,
        UrgencyLevel.CRITICAL,
    }:
        return True

    if intent.kind == IntentKind.APPOINTMENT_ACTION and state.upcoming_appointment_hours is not None:
        return True

    if intent.kind == IntentKind.VOICE_INPUT:
        return True

    return False


def log_intent_shadow(
    db: Session,
    *,
    user_id: int,
    profile_id: Optional[int],
    conversation_id: str,
    source: str,
    message: str,
    intent: Intent,
    state: ClinicalState,
    latency_ms: int,
    extra_metadata: Optional[dict] = None,
) -> Optional[models.IntentShadowLog]:
    """Persiste una fila en intent_shadow_logs. Nunca levanta excepciones."""
    try:
        preview = (message or "")[:MESSAGE_PREVIEW_MAX_CHARS]
        would_change = estimate_would_change_response(intent, state)
        row = models.IntentShadowLog(
            user_id=int(user_id),
            profile_id=int(profile_id) if profile_id else None,
            conversation_id=conversation_id or "",
            source=source or "chat",
            message_preview=preview,
            intent_predicted=intent.kind.value,
            intent_source=intent.source.value,
            confidence=float(intent.confidence),
            used_llm_fallback=(intent.source.value == "llm"),
            clinical_phase=state.phase.value,
            clinical_urgency=state.urgency.value,
            primary_episode_id=state.primary_episode_id,
            would_change_response=would_change,
            latency_ms=int(latency_ms),
            metadata_json={
                "matched_patterns": intent.matched_patterns,
                "raw_scores": intent.raw_scores,
                "pending_tasks": state.pending_tasks,
                "overdue_tasks": state.overdue_tasks,
                "active_episode_count": state.active_episode_count,
                "state_confidence": state.confidence,
                **(extra_metadata or {}),
            },
        )
        db.add(row)
        db.commit()
        return row
    except Exception as exc:  # pragma: no cover
        # Shadow mode: fallar silenciosamente. Nunca bloquear producción.
        print(f"WARNING log_intent_shadow: {exc}")
        try:
            db.rollback()
        except Exception:
            pass
        return None


def run_intent_shadow_pipeline(
    db: Session,
    *,
    user_id: int,
    profile_id: Optional[int],
    conversation_id: str,
    source: str,
    message: str,
    extra_metadata: Optional[dict] = None,
) -> Optional[models.IntentShadowLog]:
    """Pipeline completo: compute_state → classify → log. Fail-safe.

    Pensado para invocarse inline en `/ai/chat` envuelto en try/except.
    Retorna la fila persistida o None si algo falló (sin propagar).
    """
    started = time.perf_counter()
    try:
        if profile_id:
            state = compute_clinical_state(db, profile_id)
        else:
            state = ClinicalState(
                phase=ClinicalPhase.NO_CONTEXT,
                urgency=UrgencyLevel.LOW,
                confidence=0.0,
            )
        intent = classify_intent(message, source=source, state=state)
        latency_ms = int((time.perf_counter() - started) * 1000)
        return log_intent_shadow(
            db,
            user_id=user_id,
            profile_id=profile_id,
            conversation_id=conversation_id,
            source=source,
            message=message,
            intent=intent,
            state=state,
            latency_ms=latency_ms,
            extra_metadata=extra_metadata,
        )
    except Exception as exc:  # pragma: no cover
        print(f"WARNING run_intent_shadow_pipeline: {exc}")
        return None
