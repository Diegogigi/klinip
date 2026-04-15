from __future__ import annotations

from datetime import datetime, timedelta
import re
import unicodedata

from sqlalchemy.orm import Session

from .. import models

GENERIC_TOKENS = {
    "clinica",
    "clinico",
    "control",
    "consulta",
    "doctor",
    "doctora",
    "hospital",
    "medico",
    "medica",
    "salud",
    "resultado",
    "resultados",
    "documento",
    "documentos",
    "tratamiento",
    "examen",
    "examenes",
    "orden",
    "informe",
    "centro",
    "receta",
}


def _normalize_text(value: str | None) -> str:
    raw = unicodedata.normalize("NFKD", str(value or ""))
    ascii_text = "".join(char for char in raw if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9\s]", " ", ascii_text.lower()).strip()


def _tokens_for(*values: str | None, max_tokens: int = 18) -> list[str]:
    tokens: list[str] = []
    for value in values:
        for token in _normalize_text(value).split():
            if len(token) < 3 or token in GENERIC_TOKENS or token in tokens:
                continue
            tokens.append(token)
            if len(tokens) >= max_tokens:
                return tokens
    return tokens


def _merge_tokens(existing: list[str], new_tokens: list[str], *, max_tokens: int = 24) -> list[str]:
    merged = list(existing)
    for token in new_tokens:
        if token in merged:
            continue
        merged.append(token)
        if len(merged) >= max_tokens:
            break
    return merged


def _clip(value: str | None, max_len: int) -> str:
    text = str(value or "").strip()
    return text[:max_len]


def _record_anchor(record_type: str, record) -> datetime | None:
    if record_type == "appointment":
        return getattr(record, "date_time", None) or getattr(record, "created_at", None)
    if record_type == "document":
        return getattr(record, "date", None) or getattr(record, "created_at", None)
    if record_type == "medication":
        return getattr(record, "start_at", None) or getattr(record, "created_at", None)
    if record_type == "external_record":
        return getattr(record, "event_at", None) or getattr(record, "created_at", None)
    return getattr(record, "created_at", None)


def _episode_title_for_record(record_type: str, record) -> str:
    if record_type == "appointment":
        specialty = _clip(getattr(record, "specialty", None), 80)
        appointment_type = getattr(getattr(record, "type", None), "value", getattr(record, "type", "clinica"))
        return specialty or f"Atencion {appointment_type}"
    if record_type == "document":
        notes = _clip(getattr(record, "notes", None), 80)
        filename = _clip(getattr(record, "filename", None), 80)
        doc_type = getattr(getattr(record, "doc_type", None), "value", getattr(record, "doc_type", "documento"))
        return notes or filename or f"Proceso asociado a {doc_type}"
    if record_type == "medication":
        return f"Tratamiento con {_clip(getattr(record, 'name', None), 100) or 'medicacion'}"
    if record_type == "external_record":
        return _clip(getattr(record, "title", None), 120) or "Registro clinico externo"
    return "Proceso clinico"


def _episode_summary_for_record(record_type: str, record) -> str:
    if record_type == "appointment":
        center = _clip(getattr(record, "center", None), 80)
        notes = _clip(getattr(record, "notes", None), 180)
        return notes or (f"Atencion registrada en {center}" if center else "Atencion registrada para seguimiento.")
    if record_type == "document":
        center = _clip(getattr(record, "center", None), 80)
        notes = _clip(getattr(record, "notes", None), 180)
        return notes or (f"Documento subido desde {center}" if center else "Documento asociado al proceso.")
    if record_type == "medication":
        dose = _clip(getattr(record, "dose", None), 60)
        frequency = _clip(getattr(record, "frequency", None), 60)
        parts = [part for part in [dose, frequency] if part]
        return " · ".join(parts) if parts else "Tratamiento activo registrado."
    if record_type == "external_record":
        return _clip(getattr(record, "summary", None), 180) or "Resultado o registro externo vinculado."
    return "Proceso clinico en seguimiento."


def _episode_type_for_record(record_type: str, record) -> str:
    if record_type == "appointment":
        raw_type = getattr(getattr(record, "type", None), "value", getattr(record, "type", ""))
        return "diagnostic_workup" if raw_type == "examen" else "clinical_follow_up"
    if record_type == "document":
        doc_type = getattr(getattr(record, "doc_type", None), "value", getattr(record, "doc_type", ""))
        if doc_type == "resultado":
            return "diagnostic_workup"
        if doc_type == "receta":
            return "treatment_cycle"
        return "clinical_follow_up"
    if record_type == "medication":
        return "treatment_cycle"
    if record_type == "external_record":
        return "interoperability"
    return "general"


def _record_tokens(record_type: str, record) -> list[str]:
    if record_type == "appointment":
        return _tokens_for(record.specialty, record.notes)
    if record_type == "document":
        return _tokens_for(record.notes, record.filename, getattr(record.doc_type, "value", record.doc_type), record.center)
    if record_type == "medication":
        return _tokens_for(record.name, record.dose, record.frequency, record.notes)
    if record_type == "external_record":
        return _tokens_for(record.title, record.summary, record.record_type)
    return []


def _find_explicit_related_episode(db: Session, record_type: str, record) -> models.ClinicalEpisode | None:
    explicit_episode_id = getattr(record, "episode_id", None)
    if explicit_episode_id:
        return db.query(models.ClinicalEpisode).filter(models.ClinicalEpisode.id == int(explicit_episode_id)).first()

    if record_type == "document":
        appointment_id = getattr(record, "appointment_id", None)
        if appointment_id:
            appointment = db.query(models.Appointment).filter(models.Appointment.id == int(appointment_id)).first()
            if appointment and getattr(appointment, "episode_id", None):
                return db.query(models.ClinicalEpisode).filter(models.ClinicalEpisode.id == int(appointment.episode_id)).first()

    if record_type == "medication":
        document_id = getattr(record, "document_id", None)
        if document_id:
            document = db.query(models.Document).filter(models.Document.id == int(document_id)).first()
            if document and getattr(document, "episode_id", None):
                return db.query(models.ClinicalEpisode).filter(models.ClinicalEpisode.id == int(document.episode_id)).first()

    if record_type == "external_record":
        payload = getattr(record, "payload_json", {}) or {}
        for model_class, key in (
            (models.Appointment, "appointment_id"),
            (models.Document, "document_id"),
            (models.Medication, "medication_id"),
        ):
            linked_id = payload.get(key)
            if not linked_id:
                continue
            linked = db.query(model_class).filter(model_class.id == int(linked_id)).first()
            if linked and getattr(linked, "episode_id", None):
                return db.query(models.ClinicalEpisode).filter(models.ClinicalEpisode.id == int(linked.episode_id)).first()
    return None


def _episode_context_tokens(db: Session, episode: models.ClinicalEpisode) -> list[str]:
    tokens = _tokens_for(
        episode.title,
        episode.summary,
        episode.care_summary,
        " ".join(episode.tags_json or []),
        max_tokens=18,
    )

    appointments = (
        db.query(models.Appointment)
        .filter(models.Appointment.episode_id == int(episode.id))
        .order_by(models.Appointment.created_at.desc())
        .limit(4)
        .all()
    )
    for item in appointments:
        tokens = _merge_tokens(tokens, _tokens_for(item.specialty, item.notes, max_tokens=10))

    documents = (
        db.query(models.Document)
        .filter(models.Document.episode_id == int(episode.id))
        .order_by(models.Document.created_at.desc())
        .limit(4)
        .all()
    )
    for item in documents:
        tokens = _merge_tokens(tokens, _tokens_for(item.notes, item.filename, item.center, max_tokens=10))

    medications = (
        db.query(models.Medication)
        .filter(models.Medication.episode_id == int(episode.id))
        .order_by(models.Medication.created_at.desc())
        .limit(4)
        .all()
    )
    for item in medications:
        tokens = _merge_tokens(tokens, _tokens_for(item.name, item.notes, max_tokens=10))

    external_records = (
        db.query(models.ExternalClinicalRecord)
        .filter(models.ExternalClinicalRecord.episode_id == int(episode.id))
        .order_by(models.ExternalClinicalRecord.created_at.desc())
        .limit(3)
        .all()
    )
    for item in external_records:
        tokens = _merge_tokens(tokens, _tokens_for(item.title, item.summary, max_tokens=10))

    return tokens[:24]


def _candidate_status_value(candidate: models.ClinicalEpisode) -> str:
    return str(getattr(getattr(candidate, "status", None), "value", getattr(candidate, "status", "")) or "").lower()


def _score_candidate_episode(
    *,
    record_tokens: list[str],
    anchor: datetime | None,
    candidate: models.ClinicalEpisode,
    candidate_tokens: list[str],
) -> float:
    overlap_tokens = set(record_tokens).intersection(candidate_tokens)
    score = float(len(overlap_tokens))

    if len(overlap_tokens) >= 2:
        score += 0.6
    if any(len(token) >= 6 for token in overlap_tokens):
        score += 0.4

    status_value = _candidate_status_value(candidate)
    if status_value in {"active", "monitoring", "pending"}:
        score += 0.5

    if anchor and candidate.last_activity_at:
        delta_days = abs((anchor - candidate.last_activity_at).days)
        if delta_days <= 45:
            score += 1.8
        elif delta_days <= 180:
            score += 1.1
        elif delta_days <= 365 and len(overlap_tokens) >= 2:
            score += 0.6

    return score


def _find_candidate_episode(
    db: Session,
    profile: models.HealthProfile,
    record_type: str,
    record,
) -> models.ClinicalEpisode | None:
    record_tokens = _record_tokens(record_type, record)
    if not record_tokens:
        return None

    anchor = _record_anchor(record_type, record)
    candidates = (
        db.query(models.ClinicalEpisode)
        .filter(
            models.ClinicalEpisode.profile_id == int(profile.id),
            models.ClinicalEpisode.status != models.ClinicalEpisodeStatus.archived,
        )
        .order_by(models.ClinicalEpisode.last_activity_at.desc(), models.ClinicalEpisode.created_at.desc())
        .limit(16)
        .all()
    )

    best_candidate = None
    best_score = 0.0
    for candidate in candidates:
        candidate_tokens = _episode_context_tokens(db, candidate)
        score = _score_candidate_episode(
            record_tokens=record_tokens,
            anchor=anchor,
            candidate=candidate,
            candidate_tokens=candidate_tokens,
        )
        if score > best_score:
            best_candidate = candidate
            best_score = score

    return best_candidate if best_candidate and best_score >= 2.7 else None


def _upsert_task(
    db: Session,
    episode: models.ClinicalEpisode,
    *,
    task_type: str,
    title: str,
    description: str,
    due_at: datetime | None,
    status: str,
    source_module: str,
    source_record_type: str,
    source_record_id: int | None,
    metadata_json: dict | None = None,
) -> models.ClinicalTask:
    row = (
        db.query(models.ClinicalTask)
        .filter(
            models.ClinicalTask.episode_id == episode.id,
            models.ClinicalTask.source_record_type == source_record_type,
            models.ClinicalTask.source_record_id == source_record_id,
            models.ClinicalTask.task_type == task_type,
        )
        .first()
    )
    if not row:
        row = models.ClinicalTask(
            episode_id=episode.id,
            profile_id=episode.profile_id,
            owner_user_id=episode.owner_user_id,
            task_type=task_type,
            source_module=source_module,
            source_record_type=source_record_type,
            source_record_id=source_record_id,
        )
    row.title = title
    row.description = description
    row.due_at = due_at
    row.status = status
    row.completed_at = datetime.now() if status in {"done", "completed"} else None
    row.metadata_json = metadata_json or {}
    db.add(row)
    return row


def sync_episode_tasks_for_record(
    db: Session,
    profile: models.HealthProfile,
    record_type: str,
    record,
    episode: models.ClinicalEpisode,
) -> None:
    if record_type == "appointment":
        appointment_type = getattr(getattr(record, "type", None), "value", getattr(record, "type", ""))
        appointment_status = getattr(getattr(record, "status", None), "value", getattr(record, "status", "pendiente"))
        pending = appointment_status != "realizada"
        title = "Realizar examen agendado" if appointment_type == "examen" else "Asistir a la atencion"
        description = _clip(getattr(record, "notes", None), 240) or _clip(getattr(record, "specialty", None), 160)
        _upsert_task(
            db,
            episode,
            task_type="appointment_follow_up",
            title=title,
            description=description,
            due_at=getattr(record, "date_time", None),
            status="pending" if pending else "completed",
            source_module="appointments",
            source_record_type="appointment",
            source_record_id=getattr(record, "id", None),
            metadata_json={"appointment_type": appointment_type, "status": appointment_status},
        )
        return

    if record_type == "document":
        doc_type = getattr(getattr(record, "doc_type", None), "value", getattr(record, "doc_type", ""))
        if doc_type == "orden":
            has_results = (
                db.query(models.Document)
                .filter(
                    models.Document.episode_id == episode.id,
                    models.Document.doc_type == models.DocumentType.resultado,
                )
                .count()
            ) > 0
            _upsert_task(
                db,
                episode,
                task_type="lab_result_follow_up",
                title="Subir resultado del examen u orden",
                description="Este proceso tiene una orden medica. Falta confirmar el resultado o el documento de cierre.",
                due_at=(getattr(record, "date", None) or getattr(record, "created_at", None)) + timedelta(days=30),
                status="completed" if has_results else "pending",
                source_module="documents",
                source_record_type="document",
                source_record_id=getattr(record, "id", None),
                metadata_json={"doc_type": doc_type},
            )
            return
        if doc_type == "receta":
            linked_meds = (
                db.query(models.Medication)
                .filter(
                    models.Medication.episode_id == episode.id,
                    models.Medication.document_id == getattr(record, "id", None),
                )
                .count()
            )
            _upsert_task(
                db,
                episode,
                task_type="prescription_follow_up",
                title="Confirmar tratamiento indicado",
                description="La receta ya esta guardada. Revisa si el tratamiento fue registrado en medicamentos.",
                due_at=(getattr(record, "date", None) or getattr(record, "created_at", None)) + timedelta(days=7),
                status="completed" if linked_meds > 0 else "pending",
                source_module="documents",
                source_record_type="document",
                source_record_id=getattr(record, "id", None),
                metadata_json={"doc_type": doc_type},
            )
            return


def refresh_episode_links_for_record(
    db: Session,
    profile: models.HealthProfile,
    record_type: str,
    record,
) -> models.ClinicalEpisode | None:
    explicit_episode = _find_explicit_related_episode(db, record_type, record)
    episode = explicit_episode or _find_candidate_episode(db, profile, record_type, record)

    anchor = _record_anchor(record_type, record)
    title = _episode_title_for_record(record_type, record)
    summary = _episode_summary_for_record(record_type, record)
    tokens = _record_tokens(record_type, record)

    if not episode:
        episode = models.ClinicalEpisode(
            profile_id=int(profile.id),
            owner_user_id=int(profile.owner_user_id),
            title=title,
            episode_type=_episode_type_for_record(record_type, record),
            source="auto_link",
            started_at=anchor,
            last_activity_at=anchor or datetime.now(),
            summary=summary,
            care_summary=summary,
            tags_json=tokens[:8],
        )
        db.add(episode)
        db.flush()

    if hasattr(record, "profile_id") and not getattr(record, "profile_id", None):
        record.profile_id = int(profile.id)
    if hasattr(record, "episode_id"):
        record.episode_id = int(episode.id)

    if episode.started_at is None:
        episode.started_at = anchor
    episode.last_activity_at = anchor or datetime.now()
    if not episode.title:
        episode.title = title
    if not (episode.summary or "").strip():
        episode.summary = summary
    if not (episode.care_summary or "").strip():
        episode.care_summary = summary
    episode.tags_json = _merge_tokens(list(episode.tags_json or []), tokens, max_tokens=12)

    db.add(record)
    db.add(episode)
    sync_episode_tasks_for_record(db, profile, record_type, record, episode)
    return episode


def set_record_episode(
    db: Session,
    profile: models.HealthProfile,
    *,
    record_type: str,
    record,
    episode_id: int | None,
) -> tuple[int | None, models.ClinicalEpisode | None]:
    previous_episode_id = getattr(record, "episode_id", None)
    target_episode = None
    if episode_id is not None:
        target_episode = (
            db.query(models.ClinicalEpisode)
            .filter(
                models.ClinicalEpisode.id == int(episode_id),
                models.ClinicalEpisode.profile_id == int(profile.id),
            )
            .first()
        )
        if not target_episode:
            raise ValueError("Episodio clinico no encontrado para este perfil")
        record.episode_id = int(target_episode.id)
        if hasattr(record, "profile_id") and not getattr(record, "profile_id", None):
            record.profile_id = int(profile.id)
        target_episode.last_activity_at = _record_anchor(record_type, record) or datetime.now()
        db.add(target_episode)
        sync_episode_tasks_for_record(db, profile, record_type, record, target_episode)
    else:
        record.episode_id = None
    db.add(record)
    return previous_episode_id, target_episode
