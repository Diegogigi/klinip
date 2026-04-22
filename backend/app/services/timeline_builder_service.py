from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from .. import models


def get_episode_related_items(db: Session, episode: models.ClinicalEpisode) -> dict:
    appointments = (
        db.query(models.Appointment)
        .filter(models.Appointment.episode_id == episode.id)
        .order_by(models.Appointment.date_time.asc(), models.Appointment.created_at.asc())
        .all()
    )
    documents = (
        db.query(models.Document)
        .filter(models.Document.episode_id == episode.id)
        .order_by(models.Document.date.asc(), models.Document.created_at.asc())
        .all()
    )
    medications = (
        db.query(models.Medication)
        .filter(models.Medication.episode_id == episode.id)
        .order_by(models.Medication.start_at.asc(), models.Medication.created_at.asc())
        .all()
    )
    external_records = (
        db.query(models.ExternalClinicalRecord)
        .filter(models.ExternalClinicalRecord.episode_id == episode.id)
        .order_by(models.ExternalClinicalRecord.event_at.asc(), models.ExternalClinicalRecord.created_at.asc())
        .all()
    )
    return {
        "appointments": appointments,
        "documents": documents,
        "medications": medications,
        "external_records": external_records,
    }


def build_episode_folder_items(db: Session, episode: models.ClinicalEpisode) -> list[dict]:
    related = get_episode_related_items(db, episode)
    items: list[dict] = []

    for item in related["appointments"]:
        when = item.date_time or item.created_at
        status_value = getattr(item.status, "value", item.status) or ""
        subtitle_parts = [
            "Cita",
            status_value,
            item.center or "",
        ]
        items.append(
            {
                "item_type": "appointment",
                "item_id": int(item.id),
                "title": item.specialty or f"Cita {getattr(item.type, 'value', item.type)}",
                "subtitle": " · ".join(part for part in subtitle_parts if part),
                "event_at": when,
                "status_label": status_value,
                "source_module": "appointments",
                "metadata_json": {
                    "notes": item.notes or "",
                    "specialty": item.specialty or "",
                    "center": item.center or "",
                },
            }
        )

    for item in related["documents"]:
        when = item.date or item.created_at
        doc_type = getattr(item.doc_type, "value", item.doc_type) or ""
        subtitle_parts = [
            doc_type,
            item.center or "",
            item.notes or "",
        ]
        items.append(
            {
                "item_type": "document",
                "item_id": int(item.id),
                "title": item.filename or f"Documento {doc_type or 'clinico'}",
                "subtitle": " · ".join(part for part in subtitle_parts if part),
                "event_at": when,
                "status_label": doc_type,
                "source_module": "documents",
                "metadata_json": {
                    "center": item.center or "",
                    "notes": item.notes or "",
                    "appointment_id": item.appointment_id,
                },
            }
        )

    for item in related["medications"]:
        when = item.start_at or item.created_at
        status_value = "Finalizado" if bool(item.completed) else "Activo"
        subtitle_parts = [
            item.dose or "",
            item.frequency or "",
            status_value,
        ]
        items.append(
            {
                "item_type": "medication",
                "item_id": int(item.id),
                "title": item.name or "Medicamento",
                "subtitle": " · ".join(part for part in subtitle_parts if part),
                "event_at": when,
                "status_label": status_value,
                "source_module": "medications",
                "metadata_json": {
                    "dose": item.dose or "",
                    "frequency": item.frequency or "",
                    "notes": item.notes or "",
                    "completed": bool(item.completed),
                },
            }
        )

    for item in related["external_records"]:
        when = item.event_at or item.created_at
        record_type = item.record_type or "resultado"
        subtitle_parts = [
            record_type,
            item.summary or "",
        ]
        items.append(
            {
                "item_type": "external_record",
                "item_id": int(item.id),
                "title": item.title or "Resultado externo",
                "subtitle": " · ".join(part for part in subtitle_parts if part),
                "event_at": when,
                "status_label": record_type,
                "source_module": "interoperability",
                "metadata_json": {
                    "summary": item.summary or "",
                    "source_id": item.source_id,
                },
            }
        )

    items.sort(key=lambda current: current.get("event_at") or datetime.min, reverse=True)
    return items


def build_episode_timeline(db: Session, episode: models.ClinicalEpisode) -> list[dict]:
    related = get_episode_related_items(db, episode)
    events: list[dict] = []

    for item in related["appointments"]:
        when = item.date_time or item.created_at
        events.append(
            {
                "event_type": "appointment",
                "title": item.specialty or f"Cita {getattr(item.type, 'value', item.type)}",
                "summary": f"{getattr(item.status, 'value', item.status)} en {item.center or 'centro no informado'}",
                "event_at": when,
                "source_module": "appointments",
                "source_record_type": "appointment",
                "source_record_id": item.id,
                "metadata_json": {
                    "appointment_type": getattr(item.type, "value", item.type),
                    "status": getattr(item.status, "value", item.status),
                    "center": item.center or "",
                },
            }
        )

    for item in related["documents"]:
        when = item.date or item.created_at
        events.append(
            {
                "event_type": "document",
                "title": item.filename or f"Documento {getattr(item.doc_type, 'value', item.doc_type)}",
                "summary": item.notes or item.center or "Documento clínico vinculado al episodio",
                "event_at": when,
                "source_module": "documents",
                "source_record_type": "document",
                "source_record_id": item.id,
                "metadata_json": {
                    "doc_type": getattr(item.doc_type, "value", item.doc_type),
                    "appointment_id": item.appointment_id,
                },
            }
        )

    for item in related["medications"]:
        when = item.start_at or item.created_at
        status = "finalizado" if bool(item.completed) else "activo"
        events.append(
            {
                "event_type": "medication",
                "title": item.name,
                "summary": f"{item.dose or 'Sin dosis'} · {item.frequency or 'Sin frecuencia'} · {status}",
                "event_at": when,
                "source_module": "medications",
                "source_record_type": "medication",
                "source_record_id": item.id,
                "metadata_json": {
                    "dose": item.dose or "",
                    "frequency": item.frequency or "",
                    "completed": bool(item.completed),
                },
            }
        )

        intakes = (
            db.query(models.MedicationIntake)
            .filter(models.MedicationIntake.medication_id == item.id)
            .order_by(models.MedicationIntake.scheduled_at.asc(), models.MedicationIntake.taken_at.asc())
            .limit(20)
            .all()
        )
        for intake in intakes:
            events.append(
                {
                    "event_type": "medication_intake",
                    "title": f"Toma registrada: {item.name}",
                    "summary": getattr(intake, "status", "taken") or "taken",
                    "event_at": intake.scheduled_at or intake.taken_at or intake.created_at,
                    "source_module": "medications",
                    "source_record_type": "medication_intake",
                    "source_record_id": intake.id,
                    "metadata_json": {
                        "medication_id": item.id,
                        "status": intake.status,
                        "source": intake.source,
                    },
                }
            )

    for item in related["external_records"]:
        when = item.event_at or item.created_at
        events.append(
            {
                "event_type": "external_record",
                "title": item.title,
                "summary": item.summary or "Registro clínico externo",
                "event_at": when,
                "source_module": "interoperability",
                "source_record_type": "external_record",
                "source_record_id": item.id,
                "metadata_json": {
                    "record_type": item.record_type,
                    "source_id": item.source_id,
                },
            }
        )

    events.sort(key=lambda event: event.get("event_at") or datetime.min)
    return events
