from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request, BackgroundTasks
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

from .database import Base, engine, SessionLocal
from . import models, schemas, auth

try:
    from pywebpush import webpush, WebPushException
except Exception:
    webpush = None
    WebPushException = Exception

try:
    import pytesseract
    from PIL import Image
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


app = FastAPI(title="MiRutaSalud API")

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
    cleaned = re.sub(r"\b(ingreso|recepcion|impresion)\b\s*:?", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(sucursal|centro|hospital|clinica|laboratorio)\b\s*:?", "", cleaned, flags=re.IGNORECASE)
    return _safe_text(cleaned)


def _guess_center(text: str) -> str | None:
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
    for line in lines[:6]:
        lower = _normalize_text(line)
        if len(lower) >= 12 and any(word.isalpha() for word in lower.split()):
            cleaned = _clean_center_line(line)
            if cleaned:
                return cleaned[:120]
    return None


def _guess_date(text: str) -> datetime | None:
    if not text:
        return None
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
        "indicacion",
        "consulta",
        "control",
        "laboratorio",
        "medicamento",
    )
    value_pattern = re.compile(
        r"([a-zA-Z][a-zA-Z\s]{2,})\s+(\d+(?:[.,]\d+)?)\s*(mg\/dl|mmol\/l|%|g\/l|mg\/l)",
        re.IGNORECASE,
    )
    ignore_fragments = (
        "unidad laboratorio",
        "muestra",
        "corporacion municipal",
        "laboratorio clinico",
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

    texts = []
    for img in images:
        try:
            text = pytesseract.image_to_string(img, lang=lang)
        except Exception:
            # Fallback to English if the language pack is missing.
            text = pytesseract.image_to_string(img, lang="eng")
        texts.append(text)
    return "\n".join(texts)


def _run_document_ocr(document_id: int):
    db = SessionLocal()
    try:
        doc = db.query(models.Document).filter(models.Document.id == document_id).first()
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
            existing_med = (
                db.query(models.Medication)
                .filter(models.Medication.document_id == doc.id)
                .first()
            )
            if not existing_med:
                med = _extract_medication_from_text(text)
                if med and (med.get("name") or med.get("dose") or med.get("frequency")):
                    start_date = doc.date or datetime.utcnow()
                    end_date = None
                    duration_days = med.get("duration_days")
                    if duration_days:
                        end_date = start_date + timedelta(days=duration_days)
                    duration_label = (
                        f"{duration_days} dias" if duration_days else ""
                    )
                    med_notes_parts = [med.get("raw"), med.get("route")]
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

                    if med_notes:
                        if not doc.notes:
                            doc.notes = med_notes
                        elif med_notes not in doc.notes:
                            doc.notes = f"{doc.notes}\n{med_notes}"

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

    existing = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.endpoint == sub_in.endpoint)
        .first()
    )
    if existing:
        existing.user_id = current_user.id
        existing.p256dh = p256dh
        existing.auth = auth_key
        db.commit()
        db.refresh(existing)
        return existing

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

        # Para "documents", solo interceptar si es exactamente "documents" o "documents/" sin más segmentos
        # Las rutas como "/documents/{id}/file" ya fueron manejadas arriba
        if full_path == "documents" or full_path == "documents/":
            raise HTTPException(status_code=404, detail="Not found")

        # Si parece un archivo (tiene extension) y no existe, devolver 404.
        file_path = os.path.join(static_dir, full_path)
        _, ext = os.path.splitext(full_path)
        if ext and (not os.path.exists(file_path) or not os.path.isfile(file_path)):
            raise HTTPException(status_code=404, detail="File not found")

        # Evitar que directorios de assets devuelvan el index.html.
        if (full_path == "assets" or full_path.startswith("assets/")) and not os.path.isfile(
            file_path
        ):
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
