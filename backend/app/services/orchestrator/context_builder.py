"""Context Builder — Fase 2a del Clinical Orchestrator.

Recibe (profile_id, state, intent) y produce un `ClinicalContext` priorizado
y filtrado según el intent. NO es un assembler de prompts — eso es la Fase 2d
(Prompt Composer). Aquí solo se decide *qué* datos entran al contexto y *en
qué orden*; el formato textual lo resuelve la capa siguiente.

Principios:
- Determinista: misma (profile, state, intent, reloj) → mismo context.
- Intent-aware: cada intent define qué secciones carga y con qué límites.
- State-aware: usa `state.primary_episode_id` para anclar episodio primario.
- Trazable: cada decisión de inclusión/exclusión queda en `context.trace`.
- Stand-alone: no depende de capas posteriores; testeable sin LLM.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from ... import models
from .contracts import (
    AlertSummary,
    AppointmentSummary,
    ClinicalContext,
    ClinicalPhase,
    ClinicalState,
    ContextTrace,
    DocumentRef,
    EpisodeSummary,
    Intent,
    IntentKind,
    MedicationSummary,
    TaskSummary,
)


# ─── Estrategia por intent ────────────────────────────────────────────────────


@dataclass(frozen=True)
class _IntentStrategy:
    build_reason: str
    include_primary_episode: bool = True
    include_secondary_episodes: bool = False
    pending_tasks_limit: int = 0
    include_active_medications: bool = False
    upcoming_appointments_limit: int = 0
    recent_documents_limit: int = 0
    include_critical_alerts: bool = False
    scope_to_primary: bool = False  # filtra tasks/meds/etc al primary_episode


_INTENT_STRATEGY: dict[IntentKind, _IntentStrategy] = {
    IntentKind.GET_STATUS: _IntentStrategy(
        build_reason="full_status_summary",
        include_primary_episode=True,
        include_secondary_episodes=True,
        pending_tasks_limit=5,
        include_active_medications=True,
        upcoming_appointments_limit=3,
        include_critical_alerts=True,
    ),
    IntentKind.GET_PENDING: _IntentStrategy(
        build_reason="pending_focus",
        include_primary_episode=True,
        pending_tasks_limit=10,
        upcoming_appointments_limit=3,
        include_critical_alerts=True,
    ),
    IntentKind.GET_EPISODE_DETAIL: _IntentStrategy(
        build_reason="episode_deep_dive",
        include_primary_episode=True,
        pending_tasks_limit=10,
        include_active_medications=True,
        upcoming_appointments_limit=5,
        recent_documents_limit=3,
        include_critical_alerts=True,
        scope_to_primary=True,
    ),
    IntentKind.MEDICATION_INFO: _IntentStrategy(
        build_reason="medications_focus",
        include_primary_episode=True,
        pending_tasks_limit=3,
        include_active_medications=True,
        include_critical_alerts=True,
    ),
    IntentKind.APPOINTMENT_ACTION: _IntentStrategy(
        build_reason="appointments_focus",
        include_primary_episode=True,
        pending_tasks_limit=3,
        upcoming_appointments_limit=10,
        include_critical_alerts=True,
    ),
    IntentKind.UPLOAD_INFO: _IntentStrategy(
        build_reason="upload_minimal",
        include_primary_episode=True,
    ),
    IntentKind.VOICE_INPUT: _IntentStrategy(
        build_reason="voice_minimal",
        include_primary_episode=True,
    ),
    IntentKind.GENERAL_QUESTION: _IntentStrategy(
        build_reason="general_light",
        include_primary_episode=True,
        include_critical_alerts=True,
    ),
    IntentKind.UNKNOWN: _IntentStrategy(
        build_reason="unknown_light",
        include_primary_episode=True,
        include_critical_alerts=True,
    ),
}


# ─── Entry point ──────────────────────────────────────────────────────────────


def build_clinical_context(
    db: Session,
    *,
    profile_id: int,
    state: ClinicalState,
    intent: Intent,
    now: Optional[datetime] = None,
) -> ClinicalContext:
    """Construye un ClinicalContext según (profile, state, intent).

    Args:
        db: sesión SQLAlchemy.
        profile_id: id del HealthProfile objetivo.
        state: ClinicalState ya calculado (Fase 1a).
        intent: Intent clasificado (Fase 1b).
        now: timestamp de referencia (útil para tests determinísticos).
    """
    strategy = _INTENT_STRATEGY.get(intent.kind, _INTENT_STRATEGY[IntentKind.UNKNOWN])
    reference = now or datetime.now()
    trace = ContextTrace(
        build_reason=strategy.build_reason,
        intent_focus=intent.kind,
    )

    ctx = ClinicalContext(profile_id=profile_id, intent_focus=intent.kind)

    primary_episode_id = _resolve_primary_episode_id(db, profile_id, state)
    primary_episode = _load_primary_episode(
        db, profile_id, primary_episode_id, state, strategy, trace
    )
    ctx.primary_episode = primary_episode

    if strategy.include_secondary_episodes:
        ctx.secondary_episodes = _load_secondary_episodes(
            db, profile_id, primary_episode_id, state, trace
        )
    else:
        trace.excluded["secondary_episodes"] = "intent strategy skips secondaries"

    scope_ep = primary_episode_id if strategy.scope_to_primary else None

    if strategy.pending_tasks_limit > 0:
        ctx.pending_tasks = _load_pending_tasks(
            db,
            profile_id,
            scope_ep,
            strategy.pending_tasks_limit,
            reference,
            trace,
        )
    else:
        trace.excluded["pending_tasks"] = "intent strategy skips tasks"

    if strategy.include_active_medications:
        ctx.active_medications = _load_active_medications(
            db, profile_id, scope_ep, trace
        )
    else:
        trace.excluded["active_medications"] = "intent strategy skips medications"

    if strategy.upcoming_appointments_limit > 0:
        ctx.upcoming_appointments = _load_upcoming_appointments(
            db,
            profile_id,
            scope_ep,
            strategy.upcoming_appointments_limit,
            reference,
            trace,
        )
    else:
        trace.excluded["upcoming_appointments"] = "intent strategy skips appointments"

    if strategy.recent_documents_limit > 0:
        ctx.recent_documents = _load_recent_documents(
            db,
            profile_id,
            scope_ep,
            strategy.recent_documents_limit,
            trace,
        )
    else:
        trace.excluded["recent_documents"] = "intent strategy skips documents"

    if strategy.include_critical_alerts:
        ctx.critical_alerts = _load_critical_alerts(db, profile_id, trace)
    else:
        trace.excluded["critical_alerts"] = "intent strategy skips alerts"

    ctx.token_estimate = _estimate_tokens(ctx)
    ctx.trace = trace
    return ctx


# ─── Resolución del episodio primario ────────────────────────────────────────


def _resolve_primary_episode_id(
    db: Session, profile_id: int, state: ClinicalState
) -> Optional[int]:
    if state.primary_episode_id:
        return int(state.primary_episode_id)
    # Fallback: episodio activo más reciente
    row = (
        db.query(models.ClinicalEpisode)
        .filter(
            models.ClinicalEpisode.profile_id == profile_id,
            models.ClinicalEpisode.status == models.ClinicalEpisodeStatus.active,
        )
        .order_by(models.ClinicalEpisode.last_activity_at.desc().nullslast())
        .first()
    )
    return int(row.id) if row else None


def _load_primary_episode(
    db: Session,
    profile_id: int,
    primary_episode_id: Optional[int],
    state: ClinicalState,
    strategy: _IntentStrategy,
    trace: ContextTrace,
) -> Optional[EpisodeSummary]:
    if not strategy.include_primary_episode:
        trace.excluded["primary_episode"] = "intent strategy skips primary episode"
        return None
    if primary_episode_id is None:
        trace.excluded["primary_episode"] = "no active episode found for profile"
        return None
    episode = (
        db.query(models.ClinicalEpisode)
        .filter(
            models.ClinicalEpisode.id == primary_episode_id,
            models.ClinicalEpisode.profile_id == profile_id,
        )
        .first()
    )
    if episode is None:
        trace.excluded["primary_episode"] = "primary_episode_id not found in profile"
        return None

    summary = _episode_to_summary(db, episode, state)
    trace.included["primary_episode"] = 1
    return summary


def _load_secondary_episodes(
    db: Session,
    profile_id: int,
    primary_episode_id: Optional[int],
    state: ClinicalState,
    trace: ContextTrace,
    limit: int = 3,
) -> list[EpisodeSummary]:
    q = db.query(models.ClinicalEpisode).filter(
        models.ClinicalEpisode.profile_id == profile_id,
        models.ClinicalEpisode.status == models.ClinicalEpisodeStatus.active,
    )
    if primary_episode_id is not None:
        q = q.filter(models.ClinicalEpisode.id != primary_episode_id)
    rows = (
        q.order_by(models.ClinicalEpisode.last_activity_at.desc().nullslast())
        .limit(limit)
        .all()
    )
    summaries = [_episode_to_summary(db, r, state) for r in rows]
    trace.included["secondary_episodes"] = len(summaries)
    return summaries


def _episode_to_summary(
    db: Session, episode: models.ClinicalEpisode, state: ClinicalState
) -> EpisodeSummary:
    phase = state.phase_per_episode.get(int(episode.id), ClinicalPhase.FOLLOW_UP)
    pending_count = (
        db.query(models.ClinicalTask)
        .filter(
            models.ClinicalTask.episode_id == episode.id,
            models.ClinicalTask.status == "pending",
        )
        .count()
    )
    med_count = (
        db.query(models.Medication)
        .filter(
            models.Medication.episode_id == episode.id,
            models.Medication.completed.is_(False),
        )
        .count()
    )
    status_raw = episode.status
    status_str = getattr(status_raw, "value", str(status_raw) if status_raw else "")
    return EpisodeSummary(
        id=int(episode.id),
        title=episode.title or "",
        status=status_str,
        episode_type=episode.episode_type or "general",
        phase=phase,
        started_at=episode.started_at,
        last_activity_at=episode.last_activity_at,
        summary=(episode.summary or "")[:500],
        pending_task_count=int(pending_count),
        active_medication_count=int(med_count),
    )


# ─── Secciones ────────────────────────────────────────────────────────────────


def _load_pending_tasks(
    db: Session,
    profile_id: int,
    scope_episode_id: Optional[int],
    limit: int,
    reference: datetime,
    trace: ContextTrace,
) -> list[TaskSummary]:
    q = db.query(models.ClinicalTask).filter(
        models.ClinicalTask.profile_id == profile_id,
        models.ClinicalTask.status == "pending",
    )
    if scope_episode_id is not None:
        q = q.filter(models.ClinicalTask.episode_id == scope_episode_id)
    rows = (
        q.order_by(
            models.ClinicalTask.due_at.asc().nullslast(),
            models.ClinicalTask.created_at.asc(),
        )
        .limit(limit)
        .all()
    )
    summaries = [
        TaskSummary(
            id=int(r.id),
            episode_id=int(r.episode_id) if r.episode_id else None,
            title=r.title or "",
            task_type=r.task_type or "follow_up",
            status=r.status or "pending",
            due_at=r.due_at,
            is_overdue=bool(r.due_at and r.due_at < reference),
        )
        for r in rows
    ]
    trace.included["pending_tasks"] = len(summaries)
    if scope_episode_id is not None:
        trace.notes.append(f"pending_tasks scoped to episode={scope_episode_id}")
    return summaries


def _load_active_medications(
    db: Session,
    profile_id: int,
    scope_episode_id: Optional[int],
    trace: ContextTrace,
) -> list[MedicationSummary]:
    q = db.query(models.Medication).filter(
        models.Medication.profile_id == profile_id,
        models.Medication.completed.is_(False),
    )
    if scope_episode_id is not None:
        q = q.filter(models.Medication.episode_id == scope_episode_id)
    rows = q.order_by(models.Medication.created_at.desc()).all()
    summaries = [
        MedicationSummary(
            id=int(r.id),
            name=r.name or "",
            dose=r.dose or "",
            frequency=r.frequency or "",
            episode_id=int(r.episode_id) if r.episode_id else None,
            completed=bool(r.completed),
        )
        for r in rows
    ]
    trace.included["active_medications"] = len(summaries)
    if scope_episode_id is not None:
        trace.notes.append(f"active_medications scoped to episode={scope_episode_id}")
    return summaries


def _load_upcoming_appointments(
    db: Session,
    profile_id: int,
    scope_episode_id: Optional[int],
    limit: int,
    reference: datetime,
    trace: ContextTrace,
) -> list[AppointmentSummary]:
    q = db.query(models.Appointment).filter(
        models.Appointment.profile_id == profile_id,
        models.Appointment.date_time.isnot(None),
        models.Appointment.date_time >= reference,
    )
    if scope_episode_id is not None:
        q = q.filter(models.Appointment.episode_id == scope_episode_id)
    rows = q.order_by(models.Appointment.date_time.asc()).limit(limit).all()
    summaries: list[AppointmentSummary] = []
    for r in rows:
        status_val = getattr(r.status, "value", str(r.status) if r.status else "")
        hours = None
        if r.date_time is not None:
            hours = round((r.date_time - reference).total_seconds() / 3600.0, 1)
        summaries.append(
            AppointmentSummary(
                id=int(r.id),
                specialty=r.specialty or "",
                center=r.center or "",
                date_time=r.date_time,
                status=status_val,
                episode_id=int(r.episode_id) if r.episode_id else None,
                hours_until=hours,
            )
        )
    trace.included["upcoming_appointments"] = len(summaries)
    return summaries


def _load_recent_documents(
    db: Session,
    profile_id: int,
    scope_episode_id: Optional[int],
    limit: int,
    trace: ContextTrace,
) -> list[DocumentRef]:
    q = db.query(models.Document).filter(models.Document.profile_id == profile_id)
    if scope_episode_id is not None:
        q = q.filter(models.Document.episode_id == scope_episode_id)
    rows = q.order_by(models.Document.date.desc().nullslast()).limit(limit).all()
    refs = [
        DocumentRef(
            id=int(r.id),
            doc_type=getattr(r.doc_type, "value", str(r.doc_type) if r.doc_type else ""),
            filename=r.filename or "",
            date=r.date,
            episode_id=int(r.episode_id) if r.episode_id else None,
        )
        for r in rows
    ]
    trace.included["recent_documents"] = len(refs)
    return refs


def _load_critical_alerts(
    db: Session, profile_id: int, trace: ContextTrace
) -> list[AlertSummary]:
    rows = (
        db.query(models.HealthAlert)
        .filter(
            models.HealthAlert.profile_id == profile_id,
            models.HealthAlert.status == "active",
            models.HealthAlert.severity.in_(["high", "critical"]),
        )
        .order_by(models.HealthAlert.detected_at.desc())
        .all()
    )
    summaries = [
        AlertSummary(
            id=int(r.id),
            alert_type=r.alert_type or "",
            severity=r.severity or "",
            title=r.title or "",
            description=(r.description or "")[:300],
            detected_at=r.detected_at,
        )
        for r in rows
    ]
    trace.included["critical_alerts"] = len(summaries)
    return summaries


# ─── Token estimate ──────────────────────────────────────────────────────────


# Heurística: ~3.5 caracteres por token en español (aproximación conservadora).
CHARS_PER_TOKEN = 3.5


def _estimate_tokens(ctx: ClinicalContext) -> int:
    chars = 0
    if ctx.primary_episode:
        chars += len(ctx.primary_episode.title) + len(ctx.primary_episode.summary) + 30
    for ep in ctx.secondary_episodes:
        chars += len(ep.title) + len(ep.summary) + 30
    for t in ctx.pending_tasks:
        chars += len(t.title) + 20
    for m in ctx.active_medications:
        chars += len(m.name) + len(m.dose) + len(m.frequency) + 15
    for a in ctx.upcoming_appointments:
        chars += len(a.specialty) + len(a.center) + 30
    for d in ctx.recent_documents:
        chars += len(d.filename) + len(d.doc_type) + 15
    for al in ctx.critical_alerts:
        chars += len(al.title) + len(al.description) + 20
    return max(0, int(chars / CHARS_PER_TOKEN))
