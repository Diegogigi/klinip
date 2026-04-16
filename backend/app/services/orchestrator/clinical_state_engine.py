"""Clinical State Engine — determina la fase clínica global del paciente.

Es determinista (sin LLM) y barato de computar. Consume episodios, tareas,
medicamentos, citas, documentos y alertas. Produce un ClinicalState que
el resto del orquestador consume para decidir contexto, prompt y respuesta.

Reglas principales:
- NO_CONTEXT: sin episodios activos en los últimos NO_CONTEXT_DAYS días.
- DIAGNOSIS: órdenes o exámenes pendientes sin resultado asociado.
- TREATMENT: medicación activa o procedimiento en curso.
- FOLLOW_UP: episodio en monitoring y sin tareas pendientes.
- MIXED: varias fases conviviendo entre episodios activos.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from ... import models
from .contracts import ClinicalPhase, ClinicalState, UrgencyLevel


NO_CONTEXT_DAYS = 90
STALE_EPISODE_DAYS = 60
CRITICAL_TASK_OVERDUE_DAYS = 7
UPCOMING_APPOINTMENT_HIGH_HOURS = 48
PENDING_TASK_MEDIUM_DAYS = 14

_COMPLETED_TASK_STATUSES = {"done", "completed", "cancelled"}
_ACTIVE_EPISODE_STATUSES = {
    models.ClinicalEpisodeStatus.active,
    models.ClinicalEpisodeStatus.monitoring,
}
_HIGH_ALERT_SEVERITIES = {"high", "critical"}


@dataclass
class _EpisodeSignals:
    episode: models.ClinicalEpisode
    pending_tasks: int
    overdue_tasks: int
    critically_overdue_tasks: int
    has_active_medication: bool
    has_pending_order_or_exam: bool
    has_resolved_result: bool
    last_activity_at: Optional[datetime]


def compute_clinical_state(
    db: Session,
    profile_id: int,
    *,
    now: Optional[datetime] = None,
) -> ClinicalState:
    """Calcula el ClinicalState del perfil indicado.

    `now` se expone para que los tests puedan fijar la hora de referencia.
    """
    reference_now = now or datetime.now()

    episodes = _load_non_archived_episodes(db, profile_id)
    active_episodes = [ep for ep in episodes if ep.status in _ACTIVE_EPISODE_STATUSES]

    if not _has_recent_activity(episodes, reference_now):
        return _build_no_context_state(
            db=db,
            profile_id=profile_id,
            reference_now=reference_now,
            all_episodes=episodes,
        )

    signals_per_episode = {
        ep.id: _collect_episode_signals(db, ep, reference_now)
        for ep in active_episodes
    }

    phase_per_episode: dict[int, ClinicalPhase] = {
        episode_id: _infer_episode_phase(signal)
        for episode_id, signal in signals_per_episode.items()
    }

    global_phase = _aggregate_phases(phase_per_episode.values())

    pending_tasks_total = sum(s.pending_tasks for s in signals_per_episode.values())
    overdue_tasks_total = sum(s.overdue_tasks for s in signals_per_episode.values())

    has_critical_alert = _profile_has_critical_alert(db, profile_id)
    upcoming_hours = _hours_to_next_appointment(db, profile_id, reference_now)

    urgency = _compute_urgency(
        overdue_tasks=overdue_tasks_total,
        pending_tasks=pending_tasks_total,
        has_critical_alert=has_critical_alert,
        upcoming_appointment_hours=upcoming_hours,
        signals=signals_per_episode.values(),
        reference_now=reference_now,
    )

    primary_episode_id = _pick_primary_episode(
        signals_per_episode,
        phase_per_episode,
        reference_now,
    )

    last_activity = _latest_activity([ep for ep in active_episodes])
    days_since = (
        (reference_now - last_activity).days if last_activity else None
    )

    confidence = _compute_confidence(
        phase_per_episode=phase_per_episode,
        days_since_last_activity=days_since,
        active_episode_count=len(active_episodes),
    )

    return ClinicalState(
        phase=global_phase,
        urgency=urgency,
        primary_episode_id=primary_episode_id,
        active_episode_count=len(active_episodes),
        phase_per_episode=phase_per_episode,
        overdue_tasks=overdue_tasks_total,
        pending_tasks=pending_tasks_total,
        days_since_last_activity=days_since,
        has_critical_alert=has_critical_alert,
        upcoming_appointment_hours=upcoming_hours,
        confidence=confidence,
    )


# ─── Helpers de carga ────────────────────────────────────────────────────────


def _load_non_archived_episodes(
    db: Session, profile_id: int
) -> list[models.ClinicalEpisode]:
    return (
        db.query(models.ClinicalEpisode)
        .filter(
            models.ClinicalEpisode.profile_id == int(profile_id),
            models.ClinicalEpisode.status != models.ClinicalEpisodeStatus.archived,
        )
        .all()
    )


def _has_recent_activity(
    episodes: list[models.ClinicalEpisode], reference_now: datetime
) -> bool:
    if not episodes:
        return False
    threshold = reference_now - timedelta(days=NO_CONTEXT_DAYS)
    for ep in episodes:
        anchor = ep.last_activity_at or ep.started_at or ep.created_at
        if anchor and anchor >= threshold and ep.status in _ACTIVE_EPISODE_STATUSES:
            return True
    return False


def _collect_episode_signals(
    db: Session, episode: models.ClinicalEpisode, reference_now: datetime
) -> _EpisodeSignals:
    tasks = (
        db.query(models.ClinicalTask)
        .filter(models.ClinicalTask.episode_id == episode.id)
        .all()
    )
    pending = [t for t in tasks if (t.status or "pending") not in _COMPLETED_TASK_STATUSES]
    overdue = [
        t for t in pending
        if t.due_at and t.due_at < reference_now
    ]
    critical_threshold = reference_now - timedelta(days=CRITICAL_TASK_OVERDUE_DAYS)
    critically_overdue = [t for t in overdue if t.due_at and t.due_at <= critical_threshold]

    medications = (
        db.query(models.Medication)
        .filter(models.Medication.episode_id == episode.id)
        .all()
    )
    has_active_medication = any(
        not bool(m.completed) and (m.end_date is None or m.end_date >= reference_now)
        for m in medications
    )

    appointments = (
        db.query(models.Appointment)
        .filter(models.Appointment.episode_id == episode.id)
        .all()
    )
    has_pending_exam = any(
        (a.type == models.AppointmentType.examen)
        and (a.status != models.AppointmentStatus.realizada)
        for a in appointments
    )

    documents = (
        db.query(models.Document)
        .filter(models.Document.episode_id == episode.id)
        .all()
    )
    has_pending_order = any(
        d.doc_type == models.DocumentType.orden for d in documents
    )
    has_resolved_result = any(
        d.doc_type in {models.DocumentType.resultado, models.DocumentType.informe}
        for d in documents
    )

    return _EpisodeSignals(
        episode=episode,
        pending_tasks=len(pending),
        overdue_tasks=len(overdue),
        critically_overdue_tasks=len(critically_overdue),
        has_active_medication=has_active_medication,
        has_pending_order_or_exam=has_pending_order or has_pending_exam,
        has_resolved_result=has_resolved_result,
        last_activity_at=episode.last_activity_at or episode.started_at or episode.created_at,
    )


# ─── Helpers de inferencia ───────────────────────────────────────────────────


def _infer_episode_phase(signal: _EpisodeSignals) -> ClinicalPhase:
    if signal.has_pending_order_or_exam and not signal.has_resolved_result:
        return ClinicalPhase.DIAGNOSIS

    if signal.has_active_medication:
        return ClinicalPhase.TREATMENT

    return ClinicalPhase.FOLLOW_UP


def _aggregate_phases(phases: Iterable[ClinicalPhase]) -> ClinicalPhase:
    distinct = {phase for phase in phases}
    if not distinct:
        return ClinicalPhase.NO_CONTEXT
    if len(distinct) == 1:
        return next(iter(distinct))
    return ClinicalPhase.MIXED


def _compute_urgency(
    *,
    overdue_tasks: int,
    pending_tasks: int,
    has_critical_alert: bool,
    upcoming_appointment_hours: Optional[float],
    signals: Iterable[_EpisodeSignals],
    reference_now: datetime,
) -> UrgencyLevel:
    any_critical_overdue = any(signal.critically_overdue_tasks > 0 for signal in signals)

    if has_critical_alert and (overdue_tasks > 0 or any_critical_overdue):
        return UrgencyLevel.CRITICAL

    if has_critical_alert:
        return UrgencyLevel.HIGH

    if (
        upcoming_appointment_hours is not None
        and 0 <= upcoming_appointment_hours <= UPCOMING_APPOINTMENT_HIGH_HOURS
    ):
        return UrgencyLevel.HIGH

    if any_critical_overdue:
        return UrgencyLevel.HIGH

    if pending_tasks > 0:
        return UrgencyLevel.MEDIUM

    return UrgencyLevel.LOW


def _pick_primary_episode(
    signals: dict[int, _EpisodeSignals],
    phases: dict[int, ClinicalPhase],
    reference_now: datetime,
) -> Optional[int]:
    if not signals:
        return None

    phase_priority = {
        ClinicalPhase.DIAGNOSIS: 3,
        ClinicalPhase.TREATMENT: 2,
        ClinicalPhase.FOLLOW_UP: 1,
        ClinicalPhase.MIXED: 0,
        ClinicalPhase.NO_CONTEXT: -1,
    }

    def score(item: tuple[int, _EpisodeSignals]) -> tuple:
        episode_id, signal = item
        phase = phases.get(episode_id, ClinicalPhase.TREATMENT)
        recency = signal.last_activity_at or datetime.min
        return (
            signal.overdue_tasks,
            signal.pending_tasks,
            phase_priority.get(phase, 0),
            recency,
        )

    best_id, _ = max(signals.items(), key=score)
    return int(best_id)


def _latest_activity(episodes: list[models.ClinicalEpisode]) -> Optional[datetime]:
    anchors = [
        ep.last_activity_at or ep.started_at or ep.created_at for ep in episodes
    ]
    anchors = [a for a in anchors if a]
    return max(anchors) if anchors else None


def _compute_confidence(
    *,
    phase_per_episode: dict[int, ClinicalPhase],
    days_since_last_activity: Optional[int],
    active_episode_count: int,
) -> float:
    confidence = 1.0

    if active_episode_count == 0:
        return 0.5

    distinct_phases = {p for p in phase_per_episode.values()}
    if len(distinct_phases) >= 3:
        confidence -= 0.2
    elif len(distinct_phases) == 2:
        confidence -= 0.1

    if days_since_last_activity is not None and days_since_last_activity > STALE_EPISODE_DAYS:
        confidence -= 0.25

    return max(0.0, min(1.0, confidence))


# ─── Alertas y próxima cita ──────────────────────────────────────────────────


def _profile_has_critical_alert(db: Session, profile_id: int) -> bool:
    alert = (
        db.query(models.HealthAlert)
        .filter(
            models.HealthAlert.profile_id == int(profile_id),
            models.HealthAlert.status == "active",
        )
        .all()
    )
    return any((a.severity or "").lower() in _HIGH_ALERT_SEVERITIES for a in alert)


def _hours_to_next_appointment(
    db: Session, profile_id: int, reference_now: datetime
) -> Optional[float]:
    next_appt = (
        db.query(models.Appointment)
        .filter(
            models.Appointment.profile_id == int(profile_id),
            models.Appointment.status != models.AppointmentStatus.realizada,
            models.Appointment.date_time != None,  # noqa: E711
            models.Appointment.date_time >= reference_now,
        )
        .order_by(models.Appointment.date_time.asc())
        .first()
    )
    if not next_appt or not next_appt.date_time:
        return None
    delta = next_appt.date_time - reference_now
    return max(0.0, delta.total_seconds() / 3600.0)


# ─── Estado sin contexto ─────────────────────────────────────────────────────


def _build_no_context_state(
    *,
    db: Session,
    profile_id: int,
    reference_now: datetime,
    all_episodes: list[models.ClinicalEpisode],
) -> ClinicalState:
    last_activity = _latest_activity(all_episodes)
    days_since = (reference_now - last_activity).days if last_activity else None
    has_critical_alert = _profile_has_critical_alert(db, profile_id)
    upcoming_hours = _hours_to_next_appointment(db, profile_id, reference_now)

    urgency = UrgencyLevel.LOW
    if has_critical_alert:
        urgency = UrgencyLevel.HIGH
    elif (
        upcoming_hours is not None
        and 0 <= upcoming_hours <= UPCOMING_APPOINTMENT_HIGH_HOURS
    ):
        urgency = UrgencyLevel.HIGH

    return ClinicalState(
        phase=ClinicalPhase.NO_CONTEXT,
        urgency=urgency,
        primary_episode_id=None,
        active_episode_count=0,
        phase_per_episode={},
        overdue_tasks=0,
        pending_tasks=0,
        days_since_last_activity=days_since,
        has_critical_alert=has_critical_alert,
        upcoming_appointment_hours=upcoming_hours,
        confidence=0.6 if all_episodes else 0.5,
    )
