from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from .. import models
from .timeline_builder_service import get_episode_related_items


def build_episode_summary(db: Session, episode: models.ClinicalEpisode) -> dict:
    related = get_episode_related_items(db, episode)
    tasks = (
        db.query(models.ClinicalTask)
        .filter(models.ClinicalTask.episode_id == episode.id)
        .order_by(models.ClinicalTask.due_at.asc(), models.ClinicalTask.created_at.asc())
        .all()
    )
    pending_tasks = [task for task in tasks if (task.status or "pending") not in {"done", "completed", "cancelled"}]
    next_due = next((task.due_at for task in pending_tasks if task.due_at), None)

    summary_parts = []
    if related["appointments"]:
        summary_parts.append(f"{len(related['appointments'])} cita(s)")
    if related["documents"]:
        summary_parts.append(f"{len(related['documents'])} documento(s)")
    if related["medications"]:
        summary_parts.append(f"{len(related['medications'])} medicamento(s)")
    if related["external_records"]:
        summary_parts.append(f"{len(related['external_records'])} registro(s) externo(s)")

    base_summary = ", ".join(summary_parts) if summary_parts else "Sin elementos vinculados todavía"
    next_step = pending_tasks[0].title if pending_tasks else "Sin pendientes clínicos inmediatos"
    patient_summary = f"Este proceso incluye {base_summary}. Próximo paso: {next_step}."

    last_activity_candidates = [
        episode.last_activity_at,
        *(item.date_time or item.created_at for item in related["appointments"]),
        *(item.date or item.created_at for item in related["documents"]),
        *(item.start_at or item.created_at for item in related["medications"]),
        *(item.event_at or item.created_at for item in related["external_records"]),
    ]
    last_activity = max((value for value in last_activity_candidates if value), default=episode.updated_at or datetime.now())

    return {
        "linked_appointments": len(related["appointments"]),
        "linked_documents": len(related["documents"]),
        "linked_medications": len(related["medications"]),
        "linked_external_records": len(related["external_records"]),
        "pending_tasks": len(pending_tasks),
        "next_due_at": next_due,
        "summary": base_summary,
        "care_summary": patient_summary,
        "last_activity_at": last_activity,
    }


def refresh_episode_snapshot(db: Session, episode: models.ClinicalEpisode) -> dict:
    payload = build_episode_summary(db, episode)
    episode.summary = payload["summary"]
    episode.care_summary = payload["care_summary"]
    episode.last_activity_at = payload["last_activity_at"]
    if payload["pending_tasks"] == 0 and episode.status == models.ClinicalEpisodeStatus.active:
        episode.status = models.ClinicalEpisodeStatus.monitoring
    if payload["pending_tasks"] > 0 and episode.status == models.ClinicalEpisodeStatus.monitoring:
        episode.status = models.ClinicalEpisodeStatus.active
    db.add(episode)
    return payload


def serialize_episode_out(db: Session, episode: models.ClinicalEpisode) -> dict:
    payload = refresh_episode_snapshot(db, episode)
    return {
        **{column.name: getattr(episode, column.name) for column in episode.__table__.columns},
        **payload,
    }
