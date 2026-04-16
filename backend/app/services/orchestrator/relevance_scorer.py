"""Relevance scoring — Fase 2b del Clinical Orchestrator.

Asigna un `relevance_score` ∈ [0, 1] a cada item del ClinicalContext.
No reordena ni elimina — eso lo hace el Token Budgeter (Fase 2c).

Reglas deterministas, pensadas para ser explicables:
- Score base por tipo + boosts por señales (overdue, proximidad a episodio
  primario, urgencia clínica, recencia).
- Todos los scores se clampean a [0, 1] para mantener una escala comparable.

Se mantiene separado del builder para que:
- Los tests del scorer no dependan de la capa de BD.
- El Prompt Composer (Fase 2d) pueda consumir los scores para destacar lo
  más relevante dentro del texto final.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from .contracts import (
    AlertSummary,
    AppointmentSummary,
    ClinicalContext,
    ClinicalState,
    DocumentRef,
    EpisodeSummary,
    Intent,
    MedicationSummary,
    TaskSummary,
    UrgencyLevel,
)


RECENT_WINDOW_DAYS = 7
HIGH_URGENCY_LEVELS = {UrgencyLevel.HIGH, UrgencyLevel.CRITICAL}


def score_context(
    context: ClinicalContext,
    *,
    state: ClinicalState,
    intent: Intent,
    now: Optional[datetime] = None,
) -> ClinicalContext:
    """Muta los relevance_score del ctx según (state, intent). Retorna el mismo ctx."""
    reference = now or datetime.now()
    primary_id = context.primary_episode.id if context.primary_episode else None
    high_urgency = state.urgency in HIGH_URGENCY_LEVELS

    if context.primary_episode:
        context.primary_episode.relevance_score = 1.0

    for ep in context.secondary_episodes:
        ep.relevance_score = _score_episode(ep, reference)

    for task in context.pending_tasks:
        task.relevance_score = _score_task(task, primary_id, high_urgency)

    for med in context.active_medications:
        med.relevance_score = _score_medication(med, primary_id, high_urgency)

    for appt in context.upcoming_appointments:
        appt.relevance_score = _score_appointment(appt, primary_id)

    for doc in context.recent_documents:
        doc.relevance_score = _score_document(doc, primary_id, reference)

    for alert in context.critical_alerts:
        alert.relevance_score = _score_alert(alert)

    if context.trace is not None:
        context.trace.notes.append(
            f"scored items with primary={primary_id} urgency={state.urgency.value}"
        )
    return context


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _score_task(task: TaskSummary, primary_id: Optional[int], high_urgency: bool) -> float:
    score = 0.5
    if task.is_overdue:
        score += 0.3
    if primary_id is not None and task.episode_id == primary_id:
        score += 0.2
    if high_urgency:
        score += 0.15
    return _clamp(score)


def _score_appointment(appt: AppointmentSummary, primary_id: Optional[int]) -> float:
    score = 0.5
    if appt.hours_until is not None:
        if appt.hours_until < 24:
            score += 0.3
        elif appt.hours_until < 72:
            score += 0.15
    if primary_id is not None and appt.episode_id == primary_id:
        score += 0.1
    return _clamp(score)


def _score_medication(
    med: MedicationSummary, primary_id: Optional[int], high_urgency: bool
) -> float:
    score = 0.5
    if primary_id is not None and med.episode_id == primary_id:
        score += 0.25
    if high_urgency:
        score += 0.15
    return _clamp(score)


def _score_alert(alert: AlertSummary) -> float:
    score = 0.7
    if (alert.severity or "").lower() == "critical":
        score += 0.2
    return _clamp(score)


def _score_episode(ep: EpisodeSummary, reference: datetime) -> float:
    score = 0.5
    if ep.last_activity_at is not None:
        if reference - ep.last_activity_at <= timedelta(days=RECENT_WINDOW_DAYS):
            score += 0.2
    if ep.pending_task_count > 0:
        score += 0.1
    return _clamp(score)


def _score_document(
    doc: DocumentRef, primary_id: Optional[int], reference: datetime
) -> float:
    score = 0.4
    if doc.date is not None:
        if reference - doc.date <= timedelta(days=RECENT_WINDOW_DAYS):
            score += 0.2
    if primary_id is not None and doc.episode_id == primary_id:
        score += 0.1
    return _clamp(score)
