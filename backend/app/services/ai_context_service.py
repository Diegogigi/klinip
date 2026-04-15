from __future__ import annotations

from sqlalchemy.orm import Session

from .. import models
from .clinical_summary_service import build_episode_summary
from .timeline_builder_service import build_episode_timeline, get_episode_related_items


def build_episode_ai_context(db: Session, episode: models.ClinicalEpisode) -> dict:
    related = get_episode_related_items(db, episode)
    summary = build_episode_summary(db, episode)
    timeline = build_episode_timeline(db, episode)

    ordered_documents = [
        item for item in related["documents"]
        if getattr(item.doc_type, "value", item.doc_type) in {"orden", "receta"}
    ]
    result_documents = [
        item for item in related["documents"]
        if getattr(item.doc_type, "value", item.doc_type) in {"resultado", "informe"}
    ]

    return {
        "episode": {
            "id": episode.id,
            "title": episode.title,
            "episode_type": episode.episode_type,
            "status": getattr(episode.status, "value", episode.status),
            "source": episode.source,
            "summary": summary["summary"],
            "care_summary": summary["care_summary"],
            "started_at": episode.started_at.isoformat() if episode.started_at else None,
            "last_activity_at": summary["last_activity_at"].isoformat() if summary["last_activity_at"] else None,
        },
        "linked_counts": {
            "appointments": summary["linked_appointments"],
            "documents": summary["linked_documents"],
            "medications": summary["linked_medications"],
            "external_records": summary["linked_external_records"],
            "pending_tasks": summary["pending_tasks"],
        },
        "longitudinal_answer_hints": {
            "origin_appointments": [
                {
                    "id": item.id,
                    "specialty": item.specialty,
                    "status": getattr(item.status, "value", item.status),
                    "date_time": item.date_time.isoformat() if item.date_time else None,
                }
                for item in related["appointments"]
            ],
            "ordered_documents": [
                {
                    "id": item.id,
                    "doc_type": getattr(item.doc_type, "value", item.doc_type),
                    "filename": item.filename,
                    "notes": item.notes or "",
                }
                for item in ordered_documents
            ],
            "result_documents": [
                {
                    "id": item.id,
                    "doc_type": getattr(item.doc_type, "value", item.doc_type),
                    "filename": item.filename,
                    "notes": item.notes or "",
                }
                for item in result_documents
            ],
            "derived_medications": [
                {
                    "id": item.id,
                    "name": item.name,
                    "dose": item.dose or "",
                    "frequency": item.frequency or "",
                    "document_id": item.document_id,
                }
                for item in related["medications"]
            ],
        },
        "timeline": timeline,
    }
