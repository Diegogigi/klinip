from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    UploadFile,
    File,
    Form,
    Request,
    BackgroundTasks,
)
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import text, inspect
from typing import List
import os
import mimetypes
from datetime import timedelta, datetime
import json
import io
import re
import unicodedata
import threading
import time
from zoneinfo import ZoneInfo

from .database import Base, engine, SessionLocal
from . import models, schemas, auth

try:
    from pywebpush import webpush, WebPushException
except Exception:
    webpush = None
    WebPushException = Exception

try:
    import pytesseract
    from PIL import Image, ImageOps, ImageFilter
except Exception:
    pytesseract = None
    Image = None

try:
    from pdf2image import convert_from_bytes
except Exception:
    convert_from_bytes = None

# Crear las tablas
Base.metadata.create_all(bind=engine)


def ensure_document_schema():
    """
    Garantiza que la tabla documents tenga las columnas nuevas usadas por la app
    (file_data y filename). Es una migracion ligera para entornos sin Alembic.
    """
    try:
        inspector = inspect(engine)
        columns = {col["name"] for col in inspector.get_columns("documents")}
        backend = engine.url.get_backend_name()
        statements = []
        added_columns = []

        if "file_data" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_data BYTEA"
                )
            else:
                statements.append("ALTER TABLE documents ADD COLUMN file_data BLOB")
            added_columns.append("file_data")

        if "filename" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS filename VARCHAR"
                )
            else:
                statements.append("ALTER TABLE documents ADD COLUMN filename VARCHAR")
            added_columns.append("filename")

        if "ocr_text" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS ocr_text TEXT"
                )
            else:
                statements.append("ALTER TABLE documents ADD COLUMN ocr_text TEXT")
            added_columns.append("ocr_text")

        if "ocr_status" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS ocr_status VARCHAR"
                )
            else:
                statements.append("ALTER TABLE documents ADD COLUMN ocr_status VARCHAR")
            added_columns.append("ocr_status")

        if "ocr_lang" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS ocr_lang VARCHAR"
                )
            else:
                statements.append("ALTER TABLE documents ADD COLUMN ocr_lang VARCHAR")
            added_columns.append("ocr_lang")

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
            print(
                f"DEBUG ensure_document_schema: columnas agregadas a documents: {', '.join(added_columns)}"
            )
        else:
            print("DEBUG ensure_document_schema: tabla documents ya esta al dia")
    except Exception as exc:
        # No detener la app si la verificacion falla; solo dejar el log.
        print(f"WARNING ensure_document_schema: no se pudo ajustar la tabla: {exc}")


ensure_document_schema()


def ensure_user_schema():
    """
    Garantiza que la tabla users tenga columnas nuevas usadas por la app.
    """
    try:
        inspector = inspect(engine)
        columns = {col["name"] for col in inspector.get_columns("users")}
        backend = engine.url.get_backend_name()
        statements = []
        added_columns = []

        if "timezone" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR DEFAULT 'America/Santiago'"
                )
            else:
                statements.append(
                    "ALTER TABLE users ADD COLUMN timezone VARCHAR DEFAULT 'America/Santiago'"
                )
            added_columns.append("timezone")

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
            print(
                f"DEBUG ensure_user_schema: columnas agregadas a users: {', '.join(added_columns)}"
            )
        else:
            print("DEBUG ensure_user_schema: tabla users ya esta al dia")
    except Exception as exc:
        print(f"WARNING ensure_user_schema: no se pudo ajustar la tabla: {exc}")


ensure_user_schema()

def ensure_medication_schema():
    """
    Garantiza que la tabla medications tenga columnas nuevas usadas por la app.
    """
    try:
        inspector = inspect(engine)
        columns = {col["name"] for col in inspector.get_columns("medications")}
        backend = engine.url.get_backend_name()
        statements = []
        added_columns = []

        if "schedule_time" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE medications ADD COLUMN IF NOT EXISTS schedule_time VARCHAR DEFAULT ''"
                )
            else:
                statements.append("ALTER TABLE medications ADD COLUMN schedule_time VARCHAR")
            added_columns.append("schedule_time")

        if "completed" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE medications ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT FALSE"
                )
            else:
                statements.append("ALTER TABLE medications ADD COLUMN completed BOOLEAN DEFAULT 0")
            added_columns.append("completed")

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
            print(
                f"DEBUG ensure_medication_schema: columnas agregadas a medications: {', '.join(added_columns)}"
            )
        else:
            print("DEBUG ensure_medication_schema: tabla medications ya esta al dia")
    except Exception as exc:
        print(f"WARNING ensure_medication_schema: no se pudo ajustar la tabla: {exc}")


ensure_medication_schema()

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_EMAIL = os.getenv("VAPID_EMAIL", "mailto:admin@klinip.app")


def send_web_push(subscription: models.PushSubscription, payload: dict):
    if not (webpush and VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY):
        print("DEBUG push: faltan claves VAPID o pywebpush")
        return False
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_EMAIL},
        )
        return True
    except WebPushException as exc:
        print(f"WARNING push: fallo al enviar push: {exc}")
        return False




SCHEDULE_WINDOW_SECONDS = 60
SCHEDULE_INTERVAL_SECONDS = 60
MEDICATION_LEAD_MINUTES = 5
DEFAULT_TZ_NAME = "America/Santiago"


def _resolve_user_tz(user: models.User | None) -> ZoneInfo:
    tz_name = getattr(user, "timezone", None) or DEFAULT_TZ_NAME
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return ZoneInfo(DEFAULT_TZ_NAME)


def _to_schedule_tz(value: datetime | None, tz: ZoneInfo) -> datetime | None:
    if not value:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=tz)
    return value.astimezone(tz)


def _appointment_type_label(appt_type) -> str:
    if appt_type == models.AppointmentType.examen:
        return "Examen"
    if appt_type == models.AppointmentType.tramite:
        return "Tramite"
    return "Cita medica"


def _appointment_offsets():
    return [
        {"label": "7 dias antes", "delta": timedelta(days=7), "priority": "low"},
        {"label": "3 dias antes", "delta": timedelta(days=3), "priority": "normal"},
        {"label": "1 dia antes", "delta": timedelta(days=1), "priority": "high"},
        {"label": "2 horas antes", "delta": timedelta(hours=2), "priority": "urgent"},
        {"label": "30 minutos antes", "delta": timedelta(minutes=30), "priority": "urgent"},
        {"label": "5 minutos antes", "delta": timedelta(minutes=5), "priority": "urgent"},
    ]


def _derive_dose_hours(frequency_text: str = ""):
    text = (frequency_text or "").lower()

    if "4" in text and "hora" in text:
        return [6, 10, 14, 18, 22, 2]
    if "6" in text and "hora" in text:
        return [6, 12, 18, 24]
    if "8" in text and "hora" in text:
        return [7, 15, 23]
    if "12" in text and "hora" in text:
        return [8, 20]
    if "3" in text and "vez" in text:
        return [8, 14, 20]
    if "2" in text and "vez" in text:
        return [8, 20]
    return [9]

def _parse_schedule_time(value: str | None):
    if not value:
        return None
    parts = value.split(":")
    if len(parts) != 2:
        return None
    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except ValueError:
        return None
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return hour, minute


def _build_med_trigger(day: datetime, hour: int, minute: int = 0) -> datetime:
    if hour == 24 and minute == 0:
        return (day + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return day.replace(hour=hour, minute=minute, second=0, microsecond=0)


def _is_due(now: datetime, trigger_at: datetime) -> bool:
    return trigger_at <= now <= (trigger_at + timedelta(seconds=SCHEDULE_WINDOW_SECONDS))


def _notification_already_sent(db: Session, tag: str) -> bool:
    return (
        db.query(models.PushNotificationLog)
        .filter(models.PushNotificationLog.tag == tag)
        .first()
        is not None
    )


def _record_sent(db: Session, user_id: int, tag: str, kind: str, trigger_at: datetime, sent_at: datetime):
    try:
        db.add(
            models.PushNotificationLog(
                user_id=user_id,
                tag=tag,
                kind=kind,
                trigger_at=trigger_at,
                sent_at=sent_at,
            )
        )
        db.commit()
    except Exception:
        db.rollback()


def _send_scheduled_push_reminders():
    if not (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and webpush):
        return

    db = SessionLocal()
    try:
        now_global = datetime.now(_resolve_user_tz(None))
        cutoff = now_global - timedelta(days=90)
        db.query(models.PushNotificationLog).filter(
            models.PushNotificationLog.sent_at < cutoff
        ).delete()
        db.commit()

        subscriptions = db.query(models.PushSubscription).all()

        for subscription in subscriptions:
            user_id = subscription.user_id
            user = subscription.user or db.query(models.User).filter(models.User.id == user_id).first()
            if not user:
                continue
            user_tz = _resolve_user_tz(user)
            now = datetime.now(user_tz)

            appointments = (
                db.query(models.Appointment)
                .filter(
                    models.Appointment.user_id == user_id,
                    models.Appointment.date_time.isnot(None),
                    models.Appointment.status != models.AppointmentStatus.realizada,
                )
                .all()
            )

            for appt in appointments:
                appt_dt = _to_schedule_tz(appt.date_time, user_tz)
                if not appt_dt:
                    continue

                for offset in _appointment_offsets():
                    trigger_at = appt_dt - offset["delta"]
                    if not _is_due(now, trigger_at):
                        continue

                    label = offset["label"]
                    tag = f"appointment-{appt.id}-{label}"
                    if _notification_already_sent(db, tag):
                        continue

                    category = _appointment_type_label(appt.type)
                    title = f"{category} - Recordatorio: {label}"
                    when_text = appt_dt.strftime("%d/%m/%Y %H:%M")
                    center = appt.center or "Centro medico"
                    body_lines = [
                        f"{appt.specialty or appt.type} en {center}",
                        when_text,
                    ]
                    if appt.notes:
                        body_lines.append(appt.notes)
                    body = "\n".join(body_lines)

                    ok = send_web_push(
                        subscription,
                        {
                            "title": title,
                            "body": body,
                            "url": "/appointments",
                            "priority": offset["priority"],
                            "sound": "appointment",
                            "appointmentId": appt.id,
                            "tag": tag,
                        },
                    )
                    if ok:
                        _record_sent(db, user_id, tag, "appointment", trigger_at, now)

            medications = (
                db.query(models.Medication)
                .filter(
                    models.Medication.user_id == user_id,
                    models.Medication.end_date.isnot(None),
                    models.Medication.end_date >= now,
                    models.Medication.completed.is_(False),
                )
                .all()
            )

            if not medications:
                continue

            for med in medications:
                end_dt = _to_schedule_tz(med.end_date, user_tz)
                if not end_dt:
                    continue

                schedule_slot = _parse_schedule_time(getattr(med, "schedule_time", "") or "")
                if schedule_slot:
                    time_slots = [schedule_slot]
                else:
                    time_slots = [(hour, 0) for hour in _derive_dose_hours(med.frequency)]

                today = now.replace(hour=0, minute=0, second=0, microsecond=0)
                for day_offset in [0, 1]:
                    day = today + timedelta(days=day_offset)
                    if day.date() > end_dt.date():
                        continue

                    for hour, minute in time_slots:
                        trigger_exact = _build_med_trigger(day, hour, minute)
                        if trigger_exact.date() > end_dt.date():
                            continue

                        trigger_exact_ms = int(trigger_exact.timestamp() * 1000)
                        for offset_minutes in [MEDICATION_LEAD_MINUTES, 0]:
                            trigger_at = trigger_exact - timedelta(minutes=offset_minutes)
                            if not _is_due(now, trigger_at):
                                continue

                            tag = (
                                f"medication-{med.id}-{trigger_exact_ms}-lead-{offset_minutes}"
                            )
                            if _notification_already_sent(db, tag):
                                continue

                            title = f"Medicacion: {med.name}"
                            prefix = (
                                "Ahora" if offset_minutes == 0 else f"En {offset_minutes} minutos"
                            )
                            body_lines = [prefix]
                            if med.dose:
                                body_lines.append(f"Dosis: {med.dose}")
                            if med.frequency:
                                body_lines.append(f"Frecuencia: {med.frequency}")
                            if med.notes:
                                body_lines.append(med.notes)
                            body = "\n".join(body_lines)

                            ok = send_web_push(
                                subscription,
                                {
                                    "title": title,
                                    "body": body,
                                    "url": "/medications",
                                    "priority": "high",
                                    "sound": "medication",
                                    "medicationId": med.id,
                                    "tag": tag,
                                },
                            )
                            if ok:
                                _record_sent(db, user_id, tag, "medication", trigger_at, now)
    finally:
        db.close()


_scheduler_started = False


def _scheduler_loop():
    while True:
        try:
            _send_scheduled_push_reminders()
        except Exception as exc:
            print(f"WARNING scheduler: {exc}")
        time.sleep(SCHEDULE_INTERVAL_SECONDS)


def _start_scheduler():
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True
    thread = threading.Thread(target=_scheduler_loop, daemon=True)
    thread.start()

app = FastAPI(title="MiRutaSalud API")

@app.on_event("startup")
def _startup_event():
    _start_scheduler()


OCR_MAX_BYTES = 4 * 1024 * 1024
OCR_MAX_PAGES = 3
OCR_LANG_DEFAULT = "spa"


def _safe_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _normalize_text(value: str) -> str:
    if not value:
        return ""
    lowered = value.lower()
    cleaned = "".join(
        ch
        for ch in unicodedata.normalize("NFD", lowered)
        if unicodedata.category(ch) != "Mn"
    )
    cleaned = re.sub(r"[^a-z0-9\s]", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _guess_doc_type(text: str) -> str | None:
    lowered = _normalize_text(text)
    if "receta" in lowered or "prescripcion" in lowered:
        return "receta"
    if "resultado" in lowered or "laboratorio" in lowered:
        return "resultado"
    if "valor referencia" in lowered or "parametro" in lowered or "area" in lowered:
        return "resultado"
    if "tipo de atencion" in lowered:
        return "orden"
    if "orden" in lowered or "ordenes" in lowered:
        return "orden"
    if "informe" in lowered or "reporte" in lowered:
        return "informe"
    return None


def _clean_center_line(line: str) -> str:
    if not line:
        return ""
    cleaned = re.sub(r"^[^a-zA-Z0-9]+", "", line).strip()
    cleaned = re.sub(r"^[\-\u2013\u2014\s]+", "", cleaned)
    cleaned = re.sub(r"\bcentro\s+de\s+salud\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\(\s*cesfam\s*\)", " CESFAM ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bpesfam\b", "CESFAM", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bcesfam\)?", "CESFAM", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.replace(")", "")
    if ":" in cleaned:
        parts = cleaned.split(":", 1)
        if len(parts) == 2 and parts[1].strip():
            cleaned = parts[1].strip()
    cleaned = re.sub(r"\b\d{1,2}:\d{2}\b", "", cleaned)
    cleaned = re.sub(r"\b\d{1,2}\/\d{1,2}\/\d{2,4}\b", "", cleaned)
    cleaned = re.sub(r"\b\d{1,3}(?:\.\d{3}){2}-\d\b", "", cleaned)
    cleaned = re.sub(r"\b\d{7,}\b", "", cleaned)
    cleaned = re.sub(
        r"\b(ingreso|recepcion|impresion)\b\s*:?", "", cleaned, flags=re.IGNORECASE
    )
    cleaned = re.sub(
        r"\b(sucursal|centro|hospital|clinica|laboratorio)\b\s*:?",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\b[A-Z]\b$", "", cleaned, flags=re.IGNORECASE)
    return _safe_text(cleaned)


def _extract_center_from_electronic_prescription(text: str) -> str | None:
    """
    Extrae el centro médico de recetas electrónicas chilenas
    """
    if not text:
        return None

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # Buscar líneas con "Dirección:" en recetas electrónicas
    for idx, line in enumerate(lines[:20]):
        normalized = _normalize_text(line)
        if "direccion" in normalized and ":" in line:
            # La dirección suele seguir después de los dos puntos
            if idx + 1 < len(lines):
                # La siguiente línea suele contener la dirección completa
                address_line = lines[idx + 1].strip()
                # Limpiar la dirección
                # Formato típico: "Pasaje El Boldo #654, Pudahuel, Santiago, Metropolitana de Santiago"
                # Queremos extraer "Pudahuel, Santiago" o similar
                parts = address_line.split(",")
                if len(parts) >= 2:
                    # Tomar la comuna y región
                    return _safe_text(
                        f"{parts[-3].strip()}, {parts[-2].strip()}"
                        if len(parts) >= 3
                        else f"{parts[0].strip()}, {parts[1].strip()}"
                    )

    # Si no encuentra dirección, buscar por profesión/institución
    for line in lines[:10]:
        normalized = _normalize_text(line)
        if "profesion" in normalized or "medico" in normalized:
            # Buscar si menciona alguna institución
            if (
                "hospital" in normalized
                or "clinica" in normalized
                or "cesfam" in normalized
            ):
                return _clean_center_line(line)

    return None


def _guess_center(text: str) -> str | None:
    """
    Detecta el centro de salud del documento
    """
    # Primero verificar si es receta electrónica
    if _is_electronic_prescription(text):
        center = _extract_center_from_electronic_prescription(text)
        if center:
            return center

    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    center_inline = re.compile(
        r"(centro de salud|cesfam)\s*[:\-]?\s*(.+)",
        re.IGNORECASE,
    )
    primary_keywords = ("sucursal", "cesfam", "consultorio")
    secondary_keywords = (
        "centro",
        "hospital",
        "clinica",
        "sanatorio",
        "instituto",
        "policlinico",
        "unidad",
        "laboratorio",
    )
    for line in lines:
        inline_match = center_inline.search(line)
        if inline_match:
            cleaned = _clean_center_line(inline_match.group(2))
            if cleaned:
                return cleaned[:120]
    for line in lines:
        lower = _normalize_text(line)
        if any(k in lower for k in primary_keywords):
            cleaned = _clean_center_line(line)
            if cleaned:
                return cleaned[:120]
    for line in lines:
        lower = _normalize_text(line)
        if any(k in lower for k in secondary_keywords):
            cleaned = _clean_center_line(line)
            if cleaned:
                return cleaned[:120]
    # NO buscar en las primeras líneas para recetas electrónicas
    # porque puede capturar direcciones
    return None


def _guess_date(text: str) -> datetime | None:
    if not text:
        return None

    # Patrón específico para recetas electrónicas chilenas
    # Formato: "Fecha de emisión: 2 de septiembre, 2025"
    month_names = {
        "enero": 1,
        "febrero": 2,
        "marzo": 3,
        "abril": 4,
        "mayo": 5,
        "junio": 6,
        "julio": 7,
        "agosto": 8,
        "septiembre": 9,
        "octubre": 10,
        "noviembre": 11,
        "diciembre": 12,
    }

    date_text_pattern = re.compile(
        r"(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)[,\s]+(\d{4})",
        re.IGNORECASE,
    )

    match = date_text_pattern.search(text)
    if match:
        try:
            day = int(match.group(1))
            month_name = match.group(2).lower()
            year = int(match.group(3))
            month = month_names.get(month_name)
            if month:
                return datetime(year, month, day)
        except Exception:
            pass

    # Patrones numéricos tradicionales
    patterns = [
        r"(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})",
        r"(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        parts = match.groups()
        try:
            if len(parts[0]) == 4:
                year = int(parts[0])
                month = int(parts[1])
                day = int(parts[2])
            else:
                day = int(parts[0])
                month = int(parts[1])
                year = int(parts[2])
                if year < 100:
                    year += 2000
            return datetime(year, month, day)
        except Exception:
            continue
    return None


def _guess_notes(text: str) -> str | None:
    if not text:
        return None

    # Si es receta electrónica, no intentar extraer notas genéricas
    # Los medicamentos se extraerán por separado
    if _is_electronic_prescription(text):
        # Buscar "Forma prescriptor" que tiene indicaciones especiales
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        for i, line in enumerate(lines):
            if "forma prescriptor" in _normalize_text(line):
                # Las siguientes líneas pueden tener indicaciones importantes
                if i + 1 < len(lines):
                    special_instructions = lines[i + 1].strip()
                    if special_instructions and len(special_instructions) > 10:
                        return f"Indicaciones especiales: {_safe_text(special_instructions)[:200]}"
        return None  # No extraer notas genéricas para recetas electrónicas

    lab_results = _extract_lab_results(text)
    if lab_results:
        return "\n".join(lab_results)[:400]
    order_notes = _extract_order_notes(text)
    if order_notes:
        return "\n".join(order_notes)[:400]
    keywords = (
        "radiografia",
        "rayos",
        "examen",
        "resultado",
        "diagnostico",
        "consulta",
        "control",
        "laboratorio",
        "medicamento",
    )
    # Excluir "indicacion" de keywords para evitar capturar texto genérico
    value_pattern = re.compile(
        r"([a-zA-Z][a-zA-Z\s]{2,})\s+(\d+(?:[.,]\d+)?)\s*(mg\/dl|mmol\/l|%|g\/l|mg\/l)",
        re.IGNORECASE,
    )
    ignore_fragments = (
        "unidad laboratorio",
        "muestra",
        "corporacion municipal",
        "laboratorio clinico",
        "indicacion de administracion",  # Ignorar este texto genérico de recetas
        "via de administracion",
        "metodo de administracion",
        "administrar",
        "frecuencia",
        "periodo de tratamiento",
    )
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    for line in lines:
        normalized = _normalize_text(line)
        if value_pattern.search(line):
            return _safe_text(line)[:160]
        if any(fragment in normalized for fragment in ignore_fragments):
            continue
        if any(k in normalized for k in keywords):
            return _safe_text(line)[:160]
    return None


def _extract_lab_results(text: str) -> list[str]:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return []
    results = []
    sample = ""
    sample_pattern = re.compile(r"muestra\s*[:\-]\s*(.+)", re.IGNORECASE)
    result_pattern = re.compile(
        r"^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{2,})\s+[*\-]?\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Z/%]+)\s*\[?\s*(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*\]?",
        re.IGNORECASE,
    )
    for line in lines:
        sample_match = sample_pattern.search(line)
        if sample_match and not sample:
            sample = _safe_text(sample_match.group(1))
        match = result_pattern.search(line)
        if not match:
            continue
        name = _safe_text(match.group(1).title())
        value = match.group(2)
        unit = match.group(3)
        ref_low = match.group(4)
        ref_high = match.group(5)
        results.append(f"{name} {value} {unit} (ref {ref_low}-{ref_high})")
    if sample:
        results.insert(0, f"Muestra: {sample}")
    return results


def _extract_order_notes(text: str) -> list[str]:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return []
    tipo = ""
    diagnostico = ""
    diagnostico_keywords = (
        "caries",
        "interprox",
        "evaluar",
        "control",
        "rx",
        "radiografia",
        "dental",
        "examen",
        "consulta",
    )
    for idx, line in enumerate(lines):
        normalized = _normalize_text(line)
        if "tipo de atencion" in normalized:
            value = ""
            if ":" in line:
                _, tail = line.split(":", 1)
                value = tail.strip()
            if not value and line.endswith(":") and idx + 1 < len(lines):
                value = lines[idx + 1].strip()
            tipo = _safe_text(value)
        if "diagnostico clinico" in normalized:
            value = ""
            if ":" in line:
                _, tail = line.split(":", 1)
                value = tail.strip()
            if not value and line.endswith(":") and idx + 1 < len(lines):
                value = lines[idx + 1].strip()
            diagnostico = _safe_text(value)
        if not diagnostico and "se desea saber" in normalized:
            value = ""
            if ":" in line:
                _, tail = line.split(":", 1)
                value = tail.strip()
            if not value and line.endswith(":") and idx + 1 < len(lines):
                value = lines[idx + 1].strip()
            diagnostico = _safe_text(value)
    tipo = re.sub(r"[|]+", "", tipo).strip()
    diagnostico = re.sub(r"[|]+", "", diagnostico).strip()
    if diagnostico:
        diag_norm = _normalize_text(diagnostico)
        if not any(k in diag_norm for k in diagnostico_keywords):
            diagnostico = ""
    parts = [p for p in [tipo, diagnostico] if p]
    if parts:
        return [" - ".join(parts)]
    return []


def _extract_order_schedule(text: str) -> dict | None:
    if not text:
        return None
    normalized = _normalize_text(text)
    raw_lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    normalized_lines = [_normalize_text(ln) for ln in raw_lines]
    month_map = {
        "enero": 1,
        "febrero": 2,
        "marzo": 3,
        "abril": 4,
        "mayo": 5,
        "junio": 6,
        "julio": 7,
        "agosto": 8,
        "septiembre": 9,
        "setiembre": 9,
        "octubre": 10,
        "noviembre": 11,
        "diciembre": 12,
    }
    date_pattern = re.compile(r"(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})")
    time_pattern = re.compile(r"\b(\d{1,2})[:.](\d{2})\b")
    date_match = date_pattern.search(normalized)
    time_match = None
    for raw_line, norm_line in zip(raw_lines, normalized_lines):
        if any(k in norm_line for k in ("hora", "hrs", "horario")):
            time_match = time_pattern.search(raw_line)
            if time_match:
                break
    if not time_match:
        time_match = time_pattern.search(text)
    if not date_match:
        return None
    day = int(date_match.group(1))
    month_name = date_match.group(2)
    month = month_map.get(month_name)
    year = int(date_match.group(3))
    if not month:
        return None
    hour = 0
    minute = 0
    if time_match:
        hour = int(time_match.group(1))
        minute = int(time_match.group(2))
    try:
        date_time = datetime(year, month, day, hour, minute)
    except Exception:
        return None

    specialty = ""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    for idx, line in enumerate(lines):
        if "tipo de atencion" in _normalize_text(line):
            value = ""
            if ":" in line:
                _, tail = line.split(":", 1)
                value = tail.strip()
            if not value and line.endswith(":") and idx + 1 < len(lines):
                value = lines[idx + 1].strip()
            specialty = _safe_text(value)
            break

    return {"date_time": date_time, "specialty": specialty}


def _is_electronic_prescription(text: str) -> bool:
    """
    Detecta si el documento es una receta electrónica chilena
    """
    if not text:
        return False
    normalized = _normalize_text(text)

    # Indicadores de receta electrónica
    indicators = [
        "receta electronica",
        "rp prescripcion",
        "maria constanza arratia",  # Sistema modelo
        "ministerio de salud",
        "minsal",
        "fecha de emision",
        "administrar",
        "periodo de tratamiento",
    ]

    # Si tiene código de barras o RUT con formato chileno
    has_barcode = bool(re.search(r"(\d{13}|\*[A-Z0-9]+\*)", text))
    has_rut = bool(re.search(r"\d{1,2}\.\d{3}\.\d{3}[-]\d{1}[kK0-9]", text))

    matches = sum(1 for indicator in indicators if indicator in normalized)

    return matches >= 2 or (has_rut and has_barcode)


def _extract_doctor_name(text: str) -> str | None:
    """
    Extrae el nombre del profesional de la receta electrónica
    """
    if not text:
        return None

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # Buscar nombre del profesional en las primeras 10 líneas
    for idx, line in enumerate(lines[:10]):
        normalized = _normalize_text(line)

        # Buscar después de "profesional", "medico", "doctor", "dra", "dr"
        if any(
            keyword in normalized
            for keyword in ["profesional", "medico", "doctor", "dra", "dr"]
        ):
            # El nombre suele estar en la misma línea o en las siguientes
            # Patrón: capturar nombre propio (2-4 palabras capitalizadas)
            name_pattern = re.compile(
                r"(?:dr\.?|dra\.?|doctor|doctora|profesional)?[\s:]+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})",
                re.IGNORECASE,
            )
            match = name_pattern.search(line)
            if match:
                name = match.group(1).strip()
                # Evitar capturar palabras comunes
                if len(name) > 5 and "administracion" not in name.lower():
                    return _safe_text(name)

            # Si no se encontró en la misma línea, buscar en las siguientes 2 líneas
            for next_idx in range(idx + 1, min(idx + 3, len(lines))):
                next_line = lines[next_idx]
                # Buscar línea con nombre propio
                if re.search(r"^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ]", next_line):
                    return _safe_text(next_line)

    return None


def _extract_rut(text: str) -> dict:
    """
    Extrae RUTs de médico y paciente de formato chileno
    """
    ruts = {"patient_rut": None, "doctor_rut": None, "doctor_registry": None}

    if not text:
        return ruts

    lines = text.splitlines()

    # Patrón RUT chileno: XX.XXX.XXX-X o XXXXXXXX-X
    rut_pattern = re.compile(r"(\d{1,2}\.?\d{3}\.?\d{3}[-]\d{1}[kK0-9])")

    # Patrón para registro profesional
    registry_pattern = re.compile(
        r"(?:registro|rut|run)[\s:]+[\w\d\.\-/]+[\s:]+(\d[\d\.\-/]+\d)", re.IGNORECASE
    )

    for idx, line in enumerate(lines[:15]):  # Buscar en primeras 15 líneas
        normalized = _normalize_text(line)

        # Buscar RUT del médico (usualmente al inicio)
        if idx < 5:
            rut_matches = rut_pattern.findall(line)
            if rut_matches and not ruts["doctor_rut"]:
                ruts["doctor_rut"] = rut_matches[0]

            # Buscar registro profesional
            if "registro" in normalized or "ris" in normalized:
                reg_match = re.search(r"(\d{6,8})", line)
                if reg_match:
                    ruts["doctor_registry"] = reg_match.group(1)

        # Buscar RUT del paciente (después de "paciente" o "rut")
        if "paciente" in normalized or ("rut" in normalized and idx > 3):
            rut_matches = rut_pattern.findall(line)
            if rut_matches:
                # El RUT del paciente suele ser diferente al del médico
                for rut in rut_matches:
                    if rut != ruts["doctor_rut"]:
                        ruts["patient_rut"] = rut
                        break

    return ruts


def _extract_electronic_prescription_meds(text: str) -> list[dict]:
    """
    Extrae medicamentos de recetas electrónicas chilenas con formato específico
    Las recetas electrónicas chilenas tienen el formato:

    nombre_medicamento dosis forma

    Administrar:
    Dosis
    X comprimido
    Vía de Administración
    oral
    Frecuencia
    Administrar cada X horas
    Periodo de Tratamiento
    Durante X días
    """
    if not text:
        return []

    medications = []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # Patrón para detectar línea de medicamento principal
    # Formato: "nombre dosis unidad forma"
    med_name_pattern = re.compile(
        r"^([a-záéíóúñ\s]+?)\s+(\d+(?:[.,]\d+)?)\s*(mg|g|ml|mcg|ug|ui|%)\s+(comprimido|capsula|tableta|jarabe|suspension|solucion|gotas|crema|gel|pomada|iny)",
        re.IGNORECASE,
    )

    i = 0
    while i < len(lines):
        line = lines[i]

        # Detectar inicio de medicamento
        med_match = med_name_pattern.search(line)

        if med_match:
            name = _safe_text(med_match.group(1))
            dose_value = med_match.group(2)
            dose_unit = med_match.group(3)
            form = med_match.group(4).lower()

            dose = f"{dose_value} {dose_unit}"

            # Buscar "Administrar:" en las siguientes líneas
            admin_amount = "1"
            via = ""
            method = ""
            frequency = ""
            duration_days = None

            # Buscar en las siguientes 30 líneas o hasta encontrar otro medicamento
            j = i + 1
            while j < min(i + 30, len(lines)):
                current_line = lines[j]
                next_line = lines[j + 1] if j + 1 < len(lines) else ""
                normalized = _normalize_text(current_line)

                # Si encontramos otro medicamento, detenernos
                if med_name_pattern.search(current_line) and j > i + 2:
                    break

                # Buscar cantidad a administrar (línea después de "Dosis")
                if normalized == "dosis" and next_line:
                    # La siguiente línea tiene la cantidad
                    dose_match = re.search(
                        r"(\d+)\s*(comprimido|capsula|tableta|ml|g)",
                        next_line,
                        re.IGNORECASE,
                    )
                    if dose_match:
                        admin_amount = dose_match.group(1)

                # Buscar vía de administración (línea después de "Vía de Administración" o "Vía")
                if "via" in normalized and "administracion" in normalized:
                    # La siguiente línea tiene la vía
                    if next_line:
                        via_normalized = _normalize_text(next_line)
                        if via_normalized in [
                            "oral",
                            "topica",
                            "intramuscular",
                            "intravenosa",
                            "sublingual",
                            "cutanea",
                            "oftalmica",
                        ]:
                            via = next_line.lower()

                # Buscar método (línea después de "Método de Administración")
                if "metodo" in normalized and "administracion" in normalized:
                    if next_line:
                        method_normalized = _normalize_text(next_line)
                        if method_normalized in [
                            "tragar",
                            "masticar",
                            "disolver",
                            "aplicar",
                            "inyectar",
                        ]:
                            method = next_line.lower()

                # Buscar frecuencia
                if "frecuencia" in normalized:
                    # La siguiente línea o la misma pueden tener la frecuencia
                    freq_text = current_line + " " + next_line
                    freq_match = re.search(
                        r"cada\s+(\d+)\s+horas?", freq_text, re.IGNORECASE
                    )
                    if freq_match:
                        hours = freq_match.group(1)
                        frequency = f"cada {hours} horas"

                # Buscar periodo de tratamiento
                if "periodo" in normalized or "durante" in normalized:
                    period_text = current_line + " " + next_line
                    period_match = re.search(
                        r"(\d+)\s+d[ií]as?", period_text, re.IGNORECASE
                    )
                    if period_match:
                        duration_days = int(period_match.group(1))

                j += 1

            # Construir frecuencia completa
            full_frequency = f"{admin_amount} {form}"
            if via:
                full_frequency += f", vía {via}"
            if method:
                full_frequency += f", {method}"
            if frequency:
                full_frequency += f", {frequency}"
            elif not frequency and via:
                # Si no hay frecuencia específica, al menos mencionar que es diario
                full_frequency += f", según indicación"

            # Construir información detallada de administración para las notas
            admin_details = []
            admin_details.append(f"Dosis: {admin_amount} {form}")
            if via:
                admin_details.append(f"Vía: {via}")
            if method:
                admin_details.append(f"Método: {method}")
            if frequency:
                admin_details.append(f"Frecuencia: {frequency}")
            if duration_days:
                admin_details.append(f"Duración: {duration_days} días")

            raw_info = f"{name} {dose}\n" + " | ".join(admin_details)

            medications.append(
                {
                    "name": name,
                    "dose": dose,
                    "frequency": full_frequency,
                    "duration_days": duration_days,
                    "route": via,
                    "form": form,
                    "raw": raw_info,
                }
            )

            i = j  # Saltar a donde terminamos de buscar
        else:
            i += 1

    return medications


def _extract_medication_from_text(text: str) -> dict | None:
    if not text:
        return None
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    candidates = [ln for ln in lines if "cada" in ln.lower() or "hora" in ln.lower()]
    candidates = candidates or lines

    dose_pattern = re.compile(r"(\d+(?:[.,]\d+)?)\s*(mg|ml|cc|g|mcg|ug)", re.IGNORECASE)
    freq_pattern = re.compile(r"cada\s+(\d+)\s+horas?", re.IGNORECASE)
    per_day_pattern = re.compile(r"(\d+)\s+veces\s+al\s+dia", re.IGNORECASE)
    duration_pattern = re.compile(r"por\s+(\d+)\s+d[ií]as?", re.IGNORECASE)
    weeks_pattern = re.compile(r"por\s+(\d+)\s+semanas?", re.IGNORECASE)
    route_pattern = re.compile(
        r"(oral|sublingual|topica|t[oó]pica|intramuscular|intravenosa|subcutanea|inhalatoria)",
        re.IGNORECASE,
    )

    ignore_tokens = {
        "jarabe",
        "comprimido",
        "comprimidos",
        "capsula",
        "capsulas",
        "tableta",
        "tabletas",
        "suspension",
        "gotas",
        "oral",
        "topica",
        "topico",
        "intramuscular",
        "intravenosa",
        "subcutanea",
        "inhalatoria",
        "cada",
        "horas",
        "hora",
        "por",
        "dias",
        "semanas",
    }

    for line in candidates:
        normalized = _normalize_text(line)
        dose_match = dose_pattern.search(line)
        freq_match = freq_pattern.search(line) or per_day_pattern.search(line)
        duration_match = duration_pattern.search(line) or weeks_pattern.search(line)
        route_match = route_pattern.search(line)

        parts = [p.strip() for p in re.split(r"[\/\-\|]", line) if p.strip()]
        name = None
        for part in parts:
            tokens = [t for t in re.split(r"\s+", _normalize_text(part)) if t]
            if not tokens:
                continue
            if any(t in ignore_tokens for t in tokens):
                continue
            if any(ch.isalpha() for ch in part):
                name = _safe_text(part)
                break

        if name or dose_match or freq_match:
            dose = ""
            if dose_match:
                dose = f"{dose_match.group(1)} {dose_match.group(2)}"
            frequency = ""
            if freq_match:
                frequency = f"cada {freq_match.group(1)} horas"
            elif per_day_pattern.search(line):
                frequency = per_day_pattern.search(line).group(0).lower()
            duration_days = None
            if duration_match:
                duration_days = int(duration_match.group(1))
            elif weeks_pattern.search(line):
                duration_days = int(weeks_pattern.search(line).group(1)) * 7
            route = route_match.group(1).lower() if route_match else ""

            return {
                "name": name or "",
                "dose": dose,
                "frequency": frequency,
                "duration_days": duration_days,
                "route": route,
                "raw": _safe_text(line),
            }
    return None


def _extract_ocr_text(data: bytes, filename: str) -> str:
    if not pytesseract or not Image:
        raise RuntimeError("tesseract_not_available")
    lang = os.getenv("OCR_LANG", OCR_LANG_DEFAULT)
    poppler_path = os.getenv("POPPLER_PATH") or None
    images = []
    if filename.lower().endswith(".pdf"):
        if not convert_from_bytes:
            raise RuntimeError("pdf_support_missing")
        images = convert_from_bytes(
            data,
            first_page=1,
            last_page=OCR_MAX_PAGES,
            poppler_path=poppler_path,
        )
    else:
        images = [Image.open(io.BytesIO(data))]

    def _preprocess_image(img: Image.Image) -> Image.Image:
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        if img.mode != "L":
            img = img.convert("L")
        img = ImageOps.autocontrast(img)
        width, height = img.size
        min_width = 1400
        if width < min_width:
            scale = min_width / float(width)
            img = img.resize((int(width * scale), int(height * scale)), Image.LANCZOS)
        img = img.filter(ImageFilter.SHARPEN)
        return img

    texts = []
    for img in images:
        img = _preprocess_image(img)
        try:
            text = pytesseract.image_to_string(img, lang=lang, config="--oem 3 --psm 6")
        except Exception:
            # Fallback to English if the language pack is missing.
            text = pytesseract.image_to_string(
                img, lang="eng", config="--oem 3 --psm 6"
            )
        texts.append(text)
    return "\n".join(texts)


def _run_document_ocr(document_id: int):
    db = SessionLocal()
    try:
        doc = (
            db.query(models.Document).filter(models.Document.id == document_id).first()
        )
        if not doc:
            return
        doc.ocr_status = "processing"
        db.commit()
        if not doc.file_data:
            doc.ocr_status = "error_no_file"
            db.commit()
            return
        if len(doc.file_data) > OCR_MAX_BYTES:
            doc.ocr_status = "skipped_size"
            db.commit()
            return
        filename = doc.filename or "document"
        try:
            text = _extract_ocr_text(doc.file_data, filename)
        except Exception as exc:
            doc.ocr_status = f"error_{str(exc)[:50]}"
            db.commit()
            return

        doc.ocr_text = text
        doc.ocr_status = "done"
        doc.ocr_lang = os.getenv("OCR_LANG", OCR_LANG_DEFAULT)

        if not doc.center:
            guess_center = _guess_center(text)
            if guess_center:
                doc.center = guess_center
        if not doc.date:
            guess_date = _guess_date(text)
            if guess_date:
                doc.date = guess_date
        if doc.doc_type == models.DocumentType.otro:
            guess_type = _guess_doc_type(text)
            if guess_type:
                doc.doc_type = models.DocumentType(guess_type)
        if not doc.notes:
            guess_notes = _guess_notes(text)
            if guess_notes:
                doc.notes = guess_notes

        if doc.doc_type == models.DocumentType.receta:
            # Detectar si es receta electrónica chilena
            is_electronic = _is_electronic_prescription(text)

            if is_electronic:
                # Extraer RUTs y nombre del profesional
                ruts = _extract_rut(text)
                doctor_name = _extract_doctor_name(text)

                # Si no hay centro de salud, usar el nombre del profesional
                if not doc.center and doctor_name:
                    center_parts = [doctor_name]
                    if ruts["doctor_rut"]:
                        center_parts.append(f"RUT: {ruts['doctor_rut']}")
                    doc.center = " | ".join(center_parts)

                # Construir información para las notas
                if ruts["patient_rut"] or ruts["doctor_rut"]:
                    rut_info_parts = []

                    if ruts["patient_rut"]:
                        rut_info_parts.append(f"Paciente RUT: {ruts['patient_rut']}")

                    if doctor_name:
                        rut_info_parts.append(f"Profesional: {doctor_name}")

                    if ruts["doctor_rut"]:
                        rut_info_parts.append(f"Profesional RUT: {ruts['doctor_rut']}")

                    if ruts["doctor_registry"]:
                        rut_info_parts.append(f"Registro: {ruts['doctor_registry']}")

                    rut_info = " | ".join(rut_info_parts)

                    if not doc.notes:
                        doc.notes = f"📋 Receta Electrónica MINSAL\n{rut_info}"
                    elif "Receta Electronica" not in doc.notes:
                        doc.notes = (
                            f"📋 Receta Electrónica MINSAL\n{rut_info}\n\n{doc.notes}"
                        )

            # Verificar si ya existen medicamentos
            existing_meds = (
                db.query(models.Medication)
                .filter(models.Medication.document_id == doc.id)
                .all()
            )

            if not existing_meds:
                medications_to_add = []

                # Intentar primero con extractor de recetas electrónicas
                if is_electronic:
                    medications_to_add = _extract_electronic_prescription_meds(text)

                # Si no se encontraron medicamentos o no es receta electrónica, usar método general
                if not medications_to_add:
                    med = _extract_medication_from_text(text)
                    if med and (
                        med.get("name") or med.get("dose") or med.get("frequency")
                    ):
                        medications_to_add = [med]

                # Agregar medicamentos encontrados
                for med in medications_to_add:
                    start_date = doc.date or datetime.now()
                    end_date = None
                    duration_days = med.get("duration_days")
                    if duration_days:
                        end_date = start_date + timedelta(days=duration_days)
                    duration_label = f"{duration_days} dias" if duration_days else ""

                    # Para recetas electrónicas, usar el campo "raw" que tiene todos los detalles estructurados
                    # Para otras recetas, construir las notas con la info disponible
                    if is_electronic and med.get("raw"):
                        med_notes = med.get("raw")
                    else:
                        med_notes_parts = [
                            med.get("raw"),
                            med.get("route"),
                            med.get("form"),
                        ]
                        med_notes = " ".join([p for p in med_notes_parts if p]).strip()

                    medication = models.Medication(
                        user_id=doc.user_id,
                        name=med.get("name") or "Medicamento",
                        dose=med.get("dose") or "",
                        frequency=med.get("frequency") or "",
                        duration=duration_label,
                        end_date=end_date,
                        notes=med_notes,
                        document_id=doc.id,
                    )
                    db.add(medication)

                    # Agregar info detallada del medicamento a las notas del documento
                    # Para recetas electrónicas, usar el formato estructurado completo
                    if is_electronic and med.get("raw"):
                        med_summary = f"💊 {med.get('raw')}"
                    else:
                        med_summary = f"💊 {med.get('name', 'Medicamento')}: {med.get('dose', '')} - {med.get('frequency', '')}"

                    if doc.notes:
                        # Evitar duplicados verificando si el nombre del medicamento ya está
                        if med.get("name") not in doc.notes:
                            doc.notes = f"{doc.notes}\n\n{med_summary}"
                    else:
                        doc.notes = med_summary

        if doc.doc_type == models.DocumentType.orden:
            if not doc.appointment_id:
                schedule = _extract_order_schedule(text) or {}
                date_time = schedule.get("date_time")
                specialty = schedule.get("specialty") or doc.notes or "Examen"
                status = (
                    models.AppointmentStatus.agendada
                    if date_time
                    else models.AppointmentStatus.pendiente
                )
                appointment = models.Appointment(
                    user_id=doc.user_id,
                    type=models.AppointmentType.examen,
                    specialty=specialty,
                    center=doc.center or "",
                    date_time=date_time,
                    status=status,
                    notes=doc.notes or "",
                )
                db.add(appointment)
                db.flush()
                doc.appointment_id = appointment.id
                if date_time:
                    date_label = date_time.strftime("%d/%m/%Y %H:%M")
                    if doc.notes:
                        if date_label not in doc.notes:
                            doc.notes = f"{doc.notes}\nFecha: {date_label}"
                    else:
                        doc.notes = f"Fecha: {date_label}"
                else:
                    missing_msg = "Falta fecha u hora, agregar manualmente en Citas."
                    if doc.notes:
                        if missing_msg not in doc.notes:
                            doc.notes = f"{doc.notes}\n{missing_msg}"
                    else:
                        doc.notes = missing_msg

        db.commit()
    finally:
        db.close()


# Configurar CORS
# En producción, permitir todos los orígenes (Railway puede usar diferentes dominios)
is_production = os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_PUBLIC_DOMAIN")
if is_production:
    # En producción, permitir todos los orígenes (sin credentials para compatibilidad)
    allow_origins = ["*"]
    allow_credentials = False
else:
    # En desarrollo, solo localhost
    allow_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*", "Authorization", "Content-Type"],
    expose_headers=["*"],
)


# Health check
@app.get("/health")
def health_check(db: Session = Depends(auth.get_db)):
    try:
        # Verificar conexión a la base de datos
        db.execute(text("SELECT 1"))
        db_status = "ok"

        # Contar usuarios
        from . import models

        user_count = db.query(models.User).count()
    except Exception as e:
        db_status = f"error: {str(e)}"
        user_count = 0

    # Verificar SECRET_KEY (sin exponerlo)
    secret_key_status = (
        "configurado"
        if auth.SECRET_KEY != "supersecretkey_change_me_in_production"
        else "NO CONFIGURADO (usando valor por defecto)"
    )
    is_production = os.getenv("RAILWAY_ENVIRONMENT") or os.getenv(
        "RAILWAY_PUBLIC_DOMAIN"
    )

    return {
        "status": "ok",
        "database": db_status,
        "user_count": user_count,
        "database_url": os.getenv("DATABASE_URL", "sqlite (default)")[:30] + "...",
        "secret_key": secret_key_status,
        "environment": "production" if is_production else "development",
    }


def _read_int_env(name: str, fallback: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return fallback
    try:
        return int(raw.replace(",", "").replace("+", "").strip())
    except ValueError:
        return fallback


def _resolve_stat(env_key: str, db_value: int, fallback: int) -> int:
    if os.getenv(env_key):
        return _read_int_env(env_key, fallback)
    if db_value:
        return db_value
    return fallback


# Public stats for landing page
@app.get("/public/stats")
def public_stats(db: Session = Depends(auth.get_db)):
    from . import models

    user_count = db.query(models.User).count()
    appointment_count = db.query(models.Appointment).count()
    medication_count = db.query(models.Medication).count()

    users = _resolve_stat("PUBLIC_STATS_USERS", user_count, 1200)
    appointments = _resolve_stat("PUBLIC_STATS_APPOINTMENTS", appointment_count, 15000)
    reminders = _resolve_stat("PUBLIC_STATS_REMINDERS", medication_count, 50000)
    satisfaction = _resolve_stat("PUBLIC_STATS_SATISFACTION", 0, 98)

    return {
        "users": users,
        "appointments": appointments,
        "reminders": reminders,
        "satisfaction": satisfaction,
    }


# Debug endpoint para verificar configuración
@app.get("/debug/config")
def debug_config():
    """Endpoint de debug para verificar configuración (sin exponer secretos)"""
    secret_key_configured = auth.SECRET_KEY != "supersecretkey_change_me_in_production"
    secret_key_length = len(auth.SECRET_KEY)
    is_production = os.getenv("RAILWAY_ENVIRONMENT") or os.getenv(
        "RAILWAY_PUBLIC_DOMAIN"
    )

    return {
        "secret_key_configured": secret_key_configured,
        "secret_key_length": secret_key_length,
        "secret_key_preview": (
            auth.SECRET_KEY[:10] + "..." if secret_key_configured else "NO CONFIGURADO"
        ),
        "algorithm": auth.ALGORITHM,
        "token_expire_minutes": auth.ACCESS_TOKEN_EXPIRE_MINUTES,
        "environment": "production" if is_production else "development",
        "database_url_configured": bool(os.getenv("DATABASE_URL")),
        "railway_environment": bool(is_production),
    }


# Debug endpoint (solo para desarrollo)
@app.get("/debug/users")
def debug_users(db: Session = Depends(auth.get_db)):
    """Endpoint de debug para ver usuarios (solo en desarrollo)"""
    from . import models

    users = db.query(models.User).all()
    return {
        "count": len(users),
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "has_password_hash": bool(u.password_hash),
                "password_hash_length": len(u.password_hash) if u.password_hash else 0,
            }
            for u in users
        ],
    }


# Debug endpoint para ver headers
@app.get("/debug/headers")
def debug_headers(request: Request):
    """Endpoint de debug para ver headers recibidos"""
    auth_header = request.headers.get("Authorization", "NO ENCONTRADO")
    return {
        "authorization": auth_header,
        "authorization_parts": (
            auth_header.split(" ") if auth_header != "NO ENCONTRADO" else None
        ),
        "all_headers": dict(request.headers),
        "method": request.method,
        "url": str(request.url),
    }


# Middleware para loggear todos los requests
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Middleware para loggear requests y headers"""
    auth_header = request.headers.get("Authorization")
    if auth_header:
        print(f"DEBUG middleware: Authorization header recibido: {auth_header[:30]}...")
    else:
        print(
            f"DEBUG middleware: NO hay Authorization header en request a {request.url.path}"
        )

    response = await call_next(request)
    return response


# Auth endpoints
@app.post("/auth/register", response_model=schemas.UserOut)
def register(user_in: schemas.UserCreate, db: Session = Depends(auth.get_db)):
    try:
        existing = auth.get_user_by_email(db, user_in.email)
        if existing:
            raise HTTPException(status_code=400, detail="El correo ya está registrado")

        user = models.User(
            email=user_in.email,
            password_hash=auth.get_password_hash(user_in.password),
            name=user_in.name,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error creating user: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al crear usuario: {str(e)}")


@app.post("/auth/login", response_model=schemas.Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(auth.get_db),
):
    print(f"DEBUG: Intento de login con email: {form_data.username}")
    user = auth.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        print(f"DEBUG: Autenticación fallida para: {form_data.username}")
        raise HTTPException(status_code=400, detail="Correo o contraseña incorrectos")
    print(f"DEBUG: Autenticación exitosa para usuario ID: {user.id}")
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    # JWT requiere que 'sub' sea una cadena, no un entero
    access_token = auth.create_access_token(
        data={"sub": str(user.id)}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/me", response_model=schemas.UserOut)
async def read_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


@app.put("/me", response_model=schemas.UserOut)
async def update_me(
    payload: schemas.UserUpdate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if payload.name is not None:
        current_user.name = payload.name

    if payload.timezone:
        try:
            ZoneInfo(payload.timezone)
        except Exception:
            raise HTTPException(status_code=400, detail="Zona horaria invalida")
        current_user.timezone = payload.timezone

    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user


# Appointments
@app.get("/appointments", response_model=List[schemas.AppointmentOut])
async def list_appointments(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return (
        db.query(models.Appointment)
        .filter(models.Appointment.user_id == current_user.id)
        .order_by(models.Appointment.date_time)
        .all()
    )


@app.post("/appointments", response_model=schemas.AppointmentOut)
async def create_appointment(
    appt_in: schemas.AppointmentCreate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    appt = models.Appointment(
        user_id=current_user.id,
        type=appt_in.type,
        specialty=appt_in.specialty,
        center=appt_in.center,
        date_time=appt_in.date_time,
        status=appt_in.status,
        notes=appt_in.notes,
        checklist=appt_in.checklist or [],
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)
    return appt


@app.put("/appointments/{appointment_id}", response_model=schemas.AppointmentOut)
async def update_appointment(
    appointment_id: int,
    appt_in: schemas.AppointmentUpdate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    appt = (
        db.query(models.Appointment)
        .filter(
            models.Appointment.id == appointment_id,
            models.Appointment.user_id == current_user.id,
        )
        .first()
    )
    if not appt:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    for field, value in appt_in.dict(exclude_unset=True).items():
        setattr(appt, field, value)

    db.commit()
    db.refresh(appt)
    return appt


@app.delete("/appointments/{appointment_id}")
async def delete_appointment(
    appointment_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    appt = (
        db.query(models.Appointment)
        .filter(
            models.Appointment.id == appointment_id,
            models.Appointment.user_id == current_user.id,
        )
        .first()
    )
    if not appt:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    db.delete(appt)
    db.commit()
    return {"ok": True}


# Medications
@app.get("/medications", response_model=List[schemas.MedicationOut])
async def list_medications(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return (
        db.query(models.Medication)
        .filter(models.Medication.user_id == current_user.id)
        .order_by(models.Medication.created_at.desc())
        .all()
    )


@app.post("/medications", response_model=schemas.MedicationOut)
async def create_medication(
    med_in: schemas.MedicationCreate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        med = models.Medication(
            user_id=current_user.id,
            name=med_in.name,
            dose=med_in.dose or "",
            frequency=med_in.frequency or "",
            duration=med_in.duration or "",
            schedule_time=med_in.schedule_time or "",
            completed=bool(med_in.completed) if med_in.completed is not None else False,
            end_date=med_in.end_date,
            notes=med_in.notes or "",
            document_id=med_in.document_id,
        )
        db.add(med)
        db.commit()
        db.refresh(med)
        return med
    except Exception as e:
        db.rollback()
        print(f"Error al crear medicamento: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error al crear medicamento: {str(e)}"
        )


@app.put("/medications/{medication_id}", response_model=schemas.MedicationOut)
async def update_medication(
    medication_id: int,
    med_in: schemas.MedicationUpdate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    med = (
        db.query(models.Medication)
        .filter(
            models.Medication.id == medication_id,
            models.Medication.user_id == current_user.id,
        )
        .first()
    )
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento no encontrado")

    for field, value in med_in.dict(exclude_unset=True).items():
        setattr(med, field, value)

    db.commit()
    db.refresh(med)
    return med


@app.delete("/medications/{medication_id}")
async def delete_medication(
    medication_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    med = (
        db.query(models.Medication)
        .filter(
            models.Medication.id == medication_id,
            models.Medication.user_id == current_user.id,
        )
        .first()
    )
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento no encontrado")
    db.delete(med)
    db.commit()
    return {"ok": True}


# Push subscriptions
@app.post("/push/subscribe", response_model=schemas.PushSubscriptionOut)
async def subscribe_push(
    sub_in: schemas.PushSubscriptionIn,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    keys = sub_in.keys or {}
    p256dh = keys.get("p256dh")
    auth_key = keys.get("auth")
    if not (sub_in.endpoint and p256dh and auth_key):
        raise HTTPException(status_code=400, detail="SuscripciЧn incompleta")

    # Eliminar todas las suscripciones antiguas del usuario para evitar duplicados
    db.query(models.PushSubscription).filter(
        models.PushSubscription.user_id == current_user.id
    ).delete()
    db.commit()

    # Crear nueva suscripción única para el usuario
    sub = models.PushSubscription(
        user_id=current_user.id,
        endpoint=sub_in.endpoint,
        p256dh=p256dh,
        auth=auth_key,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


@app.post("/push/cleanup-duplicates")
async def cleanup_duplicate_subscriptions(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Elimina suscripciones duplicadas, manteniendo solo la más reciente
    """
    all_subs = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == current_user.id)
        .order_by(models.PushSubscription.created_at.desc())
        .all()
    )

    if len(all_subs) <= 1:
        return {"message": "No hay suscripciones duplicadas", "removed": 0}

    # Mantener solo la más reciente (primera en la lista)
    to_remove = all_subs[1:]
    for sub in to_remove:
        db.delete(sub)

    db.commit()
    return {
        "message": f"Se eliminaron {len(to_remove)} suscripciones duplicadas",
        "removed": len(to_remove),
    }


@app.delete("/push/unsubscribe")
async def unsubscribe_push(
    sub_in: schemas.PushSubscriptionIn,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    existing = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.endpoint == sub_in.endpoint)
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()
    return {"ok": True}


@app.get("/push/status")
async def get_push_status(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Verificar si el usuario tiene una suscripción push activa
    """
    subscription = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == current_user.id)
        .order_by(models.PushSubscription.created_at.desc())
        .first()
    )
    return {
        "enabled": subscription is not None,
        "subscription_id": subscription.id if subscription else None,
        "created_at": subscription.created_at if subscription else None,
    }


@app.post("/push/test")
async def test_push(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and webpush):
        raise HTTPException(
            status_code=400, detail="Claves VAPID no configuradas en el servidor"
        )
    sub = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == current_user.id)
        .order_by(models.PushSubscription.created_at.desc())
        .first()
    )
    if not sub:
        raise HTTPException(
            status_code=404, detail="No hay suscripciЧn push para el usuario"
        )
    ok = send_web_push(
        sub,
        {
            "title": "Klinip",
            "body": "NotificaciЧn push de prueba",
            "url": "/",
        },
    )
    return {"sent": ok}


@app.post("/push/send-reminders")
async def send_appointment_reminders(
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Enviar recordatorios push para citas próximas
    """
    if not (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and webpush):
        raise HTTPException(
            status_code=400, detail="Claves VAPID no configuradas en el servidor"
        )

    # Obtener citas del usuario con fecha
    appointments = (
        db.query(models.Appointment)
        .filter(
            models.Appointment.user_id == current_user.id,
            models.Appointment.date_time.isnot(None),
            models.Appointment.status != models.AppointmentStatus.realizada,
        )
        .all()
    )

    if not appointments:
        return {"sent": 0, "message": "No hay citas programadas"}

    # Obtener la suscripción push más reciente del usuario (solo una para evitar duplicados)
    subscription = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == current_user.id)
        .order_by(models.PushSubscription.created_at.desc())
        .first()
    )

    if not subscription:
        raise HTTPException(
            status_code=404, detail="No hay suscripciones push para el usuario"
        )

    sent_count = 0
    user_tz = _resolve_user_tz(current_user)
    now = datetime.now(user_tz)

    for appt in appointments:
        appt_dt = _to_schedule_tz(appt.date_time, user_tz)
        if not appt_dt:
            continue

        # Calcular días hasta la cita
        time_until = appt_dt - now
        days_until = time_until.days
        hours_until = time_until.total_seconds() / 3600

        # Determinar si enviar recordatorio
        should_send = False
        message = ""
        priority = "normal"

        if 0 < hours_until <= 2:
            should_send = True
            message = "Tu cita es en menos de 2 horas"
            priority = "urgent"
        elif 0 < days_until <= 1:
            should_send = True
            message = "Tu cita es manana"
            priority = "high"
        elif days_until == 3:
            should_send = True
            message = "Tu cita es en 3 dias"
            priority = "normal"
        elif days_until == 7:
            should_send = True
            message = "Tu cita es en una semana"
            priority = "low"

        if should_send:
            title = f"Recordatorio: {appt.specialty or appt.type}"
            when_text = appt_dt.strftime("%d/%m/%Y %H:%M")
            center = appt.center or "Centro medico"
            body = "\n".join([message, when_text, center])

            ok = send_web_push(
                subscription,
                {
                    "title": title,
                    "body": body,
                    "url": "/appointments",
                    "priority": priority,
                    "sound": "appointment",
                    "appointmentId": appt.id,
                },
            )
            if ok:
                sent_count += 1

    return {
        "sent": sent_count,
        "appointments_checked": len(appointments),
        "message": f"Se enviaron {sent_count} recordatorios",
    }


@app.post("/push/send-medication-reminders")
async def send_medication_reminders(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Enviar recordatorios push para medicación del día
    """
    if not (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and webpush):
        raise HTTPException(
            status_code=400, detail="Claves VAPID no configuradas en el servidor"
        )

    # Obtener medicamentos activos del usuario
    today = datetime.now(_resolve_user_tz(current_user))
    medications = (
        db.query(models.Medication)
        .filter(
            models.Medication.user_id == current_user.id,
            models.Medication.end_date.isnot(None),
            models.Medication.end_date >= today,
            models.Medication.completed.is_(False),
        )
        .all()
    )

    if not medications:
        return {"sent": 0, "message": "No hay medicamentos activos"}

    # Obtener la suscripción push más reciente del usuario (solo una para evitar duplicados)
    subscription = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == current_user.id)
        .order_by(models.PushSubscription.created_at.desc())
        .first()
    )

    if not subscription:
        raise HTTPException(
            status_code=404, detail="No hay suscripciones push para el usuario"
        )

    sent_count = 0

    for med in medications:
        title = f"💊 Recordatorio: {med.name}"
        body = f"Es hora de tomar tu medicamento"
        if med.dose:
            body += f"\nDosis: {med.dose}"
        if med.frequency:
            body += f"\nFrecuencia: {med.frequency}"

        ok = send_web_push(
            subscription,
            {
                "title": title,
                "body": body,
                "url": "/medications",
                "priority": "high",
                "sound": "medication",
                "medicationId": med.id,
            },
        )
        if ok:
            sent_count += 1

    return {
        "sent": sent_count,
        "medications_checked": len(medications),
        "message": f"Se enviaron {sent_count} recordatorios",
    }


# Documents
UPLOAD_DIR = "uploaded_docs"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.get("/documents", response_model=List[schemas.DocumentOut])
async def list_documents(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    docs = (
        db.query(models.Document)
        .filter(models.Document.user_id == current_user.id)
        .order_by(models.Document.created_at.desc())
        .all()
    )
    return docs


@app.post("/documents", response_model=schemas.DocumentOut)
async def upload_document(
    background_tasks: BackgroundTasks,
    doc_type: str = Form(...),
    appointment_id: int | None = Form(None),
    date: str | None = Form(None),
    center: str | None = Form(""),
    notes: str | None = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # Leer el contenido del archivo
    file_content = await file.read()
    original_filename = file.filename or "document"

    print(
        f"DEBUG upload_document: Subiendo archivo: {original_filename}, tamaño: {len(file_content)} bytes"
    )

    parsed_date = None
    if date:
        try:
            parsed_date = datetime.fromisoformat(date)
        except ValueError:
            parsed_date = None

    # Guardar el archivo directamente en la base de datos como BLOB
    file_path_placeholder = (
        ""  # Compatibilidad con esquemas antiguos donde file_path es NOT NULL
    )
    doc = models.Document(
        user_id=current_user.id,
        appointment_id=appointment_id,
        doc_type=models.DocumentType(doc_type),
        file_data=file_content,  # Guardar datos del archivo en la BD
        filename=original_filename,  # Guardar nombre original
        file_path=file_path_placeholder,  # Ya no usamos file_path para archivos nuevos
        date=parsed_date,
        center=center or "",
        notes=notes or "",
        ocr_status="pending",
        ocr_lang=OCR_LANG_DEFAULT,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    print(
        f"DEBUG upload_document: Documento guardado en BD con ID: {doc.id}, filename: {doc.filename}"
    )
    if background_tasks is not None:
        background_tasks.add_task(_run_document_ocr, doc.id)
    return doc


@app.delete("/documents/{document_id}")
async def delete_document(
    document_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    doc = (
        db.query(models.Document)
        .filter(
            models.Document.id == document_id,
            models.Document.user_id == current_user.id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    # Borrar archivo físico
    if doc.file_path and os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    db.delete(doc)
    db.commit()
    return {"ok": True}


@app.put("/documents/{document_id}", response_model=schemas.DocumentOut)
async def update_document(
    document_id: int,
    doc_in: schemas.DocumentUpdate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    doc = (
        db.query(models.Document)
        .filter(
            models.Document.id == document_id,
            models.Document.user_id == current_user.id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    for field, value in doc_in.dict(exclude_unset=True).items():
        setattr(doc, field, value)
    db.commit()
    db.refresh(doc)
    return doc


# Endpoint protegido para servir documentos
@app.get("/documents/{document_id}/file")
async def get_document_file(
    document_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Sirve un archivo de documento solo si el usuario tiene acceso"""
    print(
        f"DEBUG get_document_file: Solicitando documento ID {document_id} para usuario {current_user.id}"
    )

    doc = (
        db.query(models.Document)
        .filter(
            models.Document.id == document_id,
            models.Document.user_id == current_user.id,
        )
        .first()
    )

    if not doc:
        print(
            f"DEBUG get_document_file: Documento {document_id} no encontrado para usuario {current_user.id}"
        )
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    # Prioridad 1: Si el archivo está en la BD (file_data)
    if doc.file_data:
        print(
            f"DEBUG get_document_file: Sirviendo archivo desde BD, tamaño: {len(doc.file_data)} bytes"
        )
        filename = doc.filename or f"document_{doc.id}"

        # Detectar el tipo MIME del archivo
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type:
            mime_type = "application/octet-stream"

        print(f"DEBUG get_document_file: Tipo MIME: {mime_type}, filename: {filename}")
        return Response(
            content=doc.file_data,
            media_type=mime_type,
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )

    # Prioridad 2: Si el archivo está en el sistema de archivos (compatibilidad con documentos antiguos)
    if doc.file_path:
        print(
            f"DEBUG get_document_file: Intentando servir desde file_path: {doc.file_path}"
        )

        # Intentar con ruta absoluta si es relativa
        file_path_to_check = doc.file_path
        if not os.path.isabs(file_path_to_check):
            file_path_to_check = os.path.abspath(file_path_to_check)
            print(
                f"DEBUG get_document_file: Convirtiendo a ruta absoluta: {file_path_to_check}"
            )

        # También intentar con la ruta relativa original
        if not os.path.exists(file_path_to_check):
            # Intentar con la ruta relativa desde el directorio de trabajo
            relative_path = doc.file_path
            if not relative_path.startswith(UPLOAD_DIR):
                relative_path = os.path.join(
                    UPLOAD_DIR, os.path.basename(doc.file_path)
                )
            relative_path = os.path.abspath(relative_path)
            print(
                f"DEBUG get_document_file: Intentando ruta alternativa: {relative_path}"
            )
            if os.path.exists(relative_path):
                file_path_to_check = relative_path
                print(
                    f"DEBUG get_document_file: Archivo encontrado en ruta alternativa"
                )

        if os.path.exists(file_path_to_check):
            # Detectar el tipo MIME del archivo
            mime_type, _ = mimetypes.guess_type(file_path_to_check)
            if not mime_type:
                mime_type = "application/octet-stream"

            print(
                f"DEBUG get_document_file: Sirviendo archivo desde sistema de archivos"
            )
            return FileResponse(
                file_path_to_check,
                media_type=mime_type,
                filename=os.path.basename(file_path_to_check),
            )
        else:
            print(
                f"DEBUG get_document_file: Archivo no existe en file_path: {file_path_to_check}"
            )

    # Si no hay archivo ni en BD ni en sistema de archivos
    print(
        f"DEBUG get_document_file: No se encontró archivo para el documento {document_id}"
    )
    raise HTTPException(status_code=404, detail="Archivo no encontrado")


# Servir archivos subidos (mantener para compatibilidad, pero usar endpoint protegido)
# app.mount("/uploaded_docs", StaticFiles(directory=UPLOAD_DIR), name="uploaded_docs")

# Servir archivos estáticos del frontend
static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    # Ruta catch-all para el SPA del frontend
    # IMPORTANTE: Esta ruta debe estar al final para no interceptar rutas de API
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str, request: Request):
        # Bloquear rutas de codigo fuente o assets sin archivo real.
        if full_path == "src" or full_path.startswith("src/"):
            raise HTTPException(status_code=404, detail="Not found")

        # Si es una ruta de API, no servir el SPA (dejar que FastAPI maneje el 404)
        # IMPORTANTE: NO interceptar rutas que terminan en /file (para documentos)
        # Estas deben ser manejadas por el endpoint específico /documents/{id}/file
        if "/file" in full_path:
            raise HTTPException(status_code=404, detail="Not found")

        # Rutas de API que deben ser excluidas del SPA
        api_routes = (
            "api/",
            "auth/",
            "appointments",
            "medications",
            "me",
            "uploaded_docs",
            "health",
            "debug",
        )
        # Solo interceptar si empieza con estas rutas
        if full_path.startswith(api_routes) or full_path in ("health", "debug"):
            raise HTTPException(status_code=404, detail="Not found")

        # Para "documents", servir SPA cuando sea navegación HTML; mantener API para llamadas JSON.
        if full_path == "documents" or full_path == "documents/":
            accept = request.headers.get("accept", "")
            if "text/html" not in accept:
                raise HTTPException(status_code=404, detail="Not found")

        # Si parece un archivo (tiene extension) y no existe, devolver 404.
        file_path = os.path.join(static_dir, full_path)
        _, ext = os.path.splitext(full_path)
        if ext and (not os.path.exists(file_path) or not os.path.isfile(file_path)):
            raise HTTPException(status_code=404, detail="File not found")

        # Evitar que directorios de assets devuelvan el index.html.
        if (
            full_path == "assets" or full_path.startswith("assets/")
        ) and not os.path.isfile(file_path):
            raise HTTPException(status_code=404, detail="Not found")

        # Extensiones de archivos estáticos que deben servirse con su tipo MIME correcto
        static_extensions = {
            ".js",
            ".jsx",
            ".mjs",
            ".ts",
            ".tsx",  # JavaScript
            ".css",  # CSS
            ".json",  # JSON
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".svg",
            ".webp",
            ".ico",  # Imágenes
            ".woff",
            ".woff2",
            ".ttf",
            ".eot",  # Fuentes
            ".mp4",
            ".webm",
            ".ogg",  # Video
            ".mp3",
            ".wav",  # Audio
            ".pdf",  # PDF
            ".wasm",  # WebAssembly
        }

        # Verificar si es un archivo estático por su extensión
        is_static_file = any(
            full_path.lower().endswith(ext) for ext in static_extensions
        )

        # Intentar servir el archivo solicitado
        file_path = os.path.join(static_dir, full_path)

        # Si es un archivo estático y existe, servirlo con el tipo MIME correcto
        if is_static_file and os.path.exists(file_path) and os.path.isfile(file_path):
            # Detectar el tipo MIME
            mime_type, _ = mimetypes.guess_type(file_path)
            if not mime_type:
                # Tipos MIME por defecto para extensiones comunes
                if file_path.endswith((".js", ".jsx", ".mjs")):
                    mime_type = "application/javascript"
                elif file_path.endswith(".json"):
                    mime_type = "application/json"
                elif file_path.endswith(".wasm"):
                    mime_type = "application/wasm"
                else:
                    mime_type = "application/octet-stream"

            # Usar FileResponse que maneja correctamente la lectura del archivo
            return FileResponse(
                file_path,
                media_type=mime_type,
                headers={
                    "Cache-Control": (
                        "public, max-age=31536000"
                        if mime_type.startswith(
                            ("image/", "font/", "application/javascript", "text/css")
                        )
                        else "no-cache"
                    )
                },
            )

        # Si es un archivo estático pero no existe, devolver 404 (no index.html)
        if is_static_file:
            raise HTTPException(status_code=404, detail="File not found")

        # Para rutas que no son archivos estáticos, verificar si existe el archivo
        if os.path.exists(file_path) and os.path.isfile(file_path):
            mime_type, _ = mimetypes.guess_type(file_path)
            return FileResponse(file_path, media_type=mime_type or "text/html")

        # Si no existe, servir index.html (para rutas del SPA)
        index_path = os.path.join(static_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(
                index_path,
                media_type="text/html",
                headers={"Cache-Control": "no-store"},
            )

        raise HTTPException(status_code=404, detail="Not found")
