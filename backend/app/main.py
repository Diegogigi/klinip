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
from sqlalchemy import text, inspect, func
from typing import List
import os
import mimetypes
import base64
from datetime import timedelta, datetime
import hashlib
import secrets
import smtplib
import ssl
from pathlib import Path
from email.message import EmailMessage
from html import escape
import json
import io
import re
import unicodedata
import threading
from difflib import SequenceMatcher
import time
from zoneinfo import ZoneInfo
from urllib import request as urlrequest
from urllib import error as urlerror

try:
    from jinja2 import Environment, FileSystemLoader, select_autoescape
except Exception:
    Environment = None
    FileSystemLoader = None
    select_autoescape = None

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

        if "notifications_consent" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_consent VARCHAR DEFAULT ''"
                )
            else:
                statements.append("ALTER TABLE users ADD COLUMN notifications_consent VARCHAR")
            added_columns.append("notifications_consent")

        if "notifications_last_prompt" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_last_prompt TIMESTAMP"
                )
            else:
                statements.append("ALTER TABLE users ADD COLUMN notifications_last_prompt DATETIME")
            added_columns.append("notifications_last_prompt")

        if "token_version" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0"
                )
            else:
                statements.append("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0")
            added_columns.append("token_version")

        if "data_consent_revoked" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS data_consent_revoked BOOLEAN DEFAULT FALSE"
                )
            else:
                statements.append("ALTER TABLE users ADD COLUMN data_consent_revoked BOOLEAN DEFAULT 0")
            added_columns.append("data_consent_revoked")

        if "deleted" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE"
                )
            else:
                statements.append("ALTER TABLE users ADD COLUMN deleted BOOLEAN DEFAULT 0")
            added_columns.append("deleted")

        if "chronic_condition" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS chronic_condition VARCHAR DEFAULT ''"
                )
            else:
                statements.append("ALTER TABLE users ADD COLUMN chronic_condition VARCHAR")
            added_columns.append("chronic_condition")

        if "primary_care_center" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_care_center VARCHAR DEFAULT ''"
                )
            else:
                statements.append("ALTER TABLE users ADD COLUMN primary_care_center VARCHAR")
            added_columns.append("primary_care_center")

        if "reminder_preferred_time" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_preferred_time VARCHAR DEFAULT '08:00'"
                )
            else:
                statements.append(
                    "ALTER TABLE users ADD COLUMN reminder_preferred_time VARCHAR DEFAULT '08:00'"
                )
            added_columns.append("reminder_preferred_time")

        if "email_reminders_enabled" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_reminders_enabled BOOLEAN DEFAULT FALSE"
                )
            else:
                statements.append(
                    "ALTER TABLE users ADD COLUMN email_reminders_enabled BOOLEAN DEFAULT 0"
                )
            added_columns.append("email_reminders_enabled")

        if "notification_settings_json" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_settings_json TEXT DEFAULT ''"
                )
            else:
                statements.append(
                    "ALTER TABLE users ADD COLUMN notification_settings_json TEXT DEFAULT ''"
                )
            added_columns.append("notification_settings_json")

        if "plan_type" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_type VARCHAR DEFAULT 'basico'"
                )
            else:
                statements.append(
                    "ALTER TABLE users ADD COLUMN plan_type VARCHAR DEFAULT 'basico'"
                )
            added_columns.append("plan_type")

        if "active_health_profile_id" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_health_profile_id INTEGER"
                )
            else:
                statements.append(
                    "ALTER TABLE users ADD COLUMN active_health_profile_id INTEGER"
                )
            added_columns.append("active_health_profile_id")

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


def ensure_health_profile_schema():
    """
    Garantiza columnas nuevas de health_profiles para Fase 3.
    """
    try:
        inspector = inspect(engine)
        columns = {col["name"] for col in inspector.get_columns("health_profiles")}
        backend = engine.url.get_backend_name()
        statements = []
        added_columns = []

        if "automation_settings_json" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS automation_settings_json TEXT DEFAULT ''"
                )
            else:
                statements.append(
                    "ALTER TABLE health_profiles ADD COLUMN automation_settings_json TEXT DEFAULT ''"
                )
            added_columns.append("automation_settings_json")

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
            print(
                "DEBUG ensure_health_profile_schema: columnas agregadas a health_profiles: "
                + ", ".join(added_columns)
            )
        else:
            print("DEBUG ensure_health_profile_schema: tabla health_profiles ya esta al dia")
    except Exception as exc:
        print(f"WARNING ensure_health_profile_schema: no se pudo ajustar la tabla: {exc}")


ensure_health_profile_schema()

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

PLAN_RULES = {
    "basico": {
        "max_profiles": 1,
        "collaboration_enabled": False,
        "family_panel_enabled": False,
    },
    "plus": {
        "max_profiles": 3,
        "collaboration_enabled": False,
        "family_panel_enabled": False,
    },
    "familiar": {
        "max_profiles": 5,
        "collaboration_enabled": True,
        "family_panel_enabled": True,
    },
}

ROLE_LEVELS = {
    "viewer": 1,
    "visualizador": 1,
    "caregiver": 2,
    "cuidador": 2,
    "admin": 3,
    "administrador": 3,
}


def _normalize_role(value: str | None) -> str:
    raw = (value or "viewer").strip().lower()
    aliases = {
        "visualizador": "viewer",
        "viewer": "viewer",
        "cuidador": "caregiver",
        "caregiver": "caregiver",
        "administrador": "admin",
        "admin": "admin",
    }
    role = aliases.get(raw, "viewer")
    return role


def _normalize_plan_type(value: str | None) -> str:
    raw = (value or "basico").strip().lower()
    if raw in PLAN_RULES:
        return raw
    aliases = {
        "basic": "basico",
        "pro": "plus",
        "plus_individual": "plus",
        "family": "familiar",
    }
    return aliases.get(raw, "basico")


def _plan_features(plan_type: str | None) -> dict:
    normalized = _normalize_plan_type(plan_type)
    return PLAN_RULES.get(normalized, PLAN_RULES["basico"])


def _count_owned_profiles(db: Session, user_id: int) -> int:
    return (
        db.query(models.HealthProfile)
        .filter(
            models.HealthProfile.owner_user_id == user_id,
            models.HealthProfile.is_archived.is_(False),
        )
        .count()
    )


def _create_primary_health_profile_if_missing(db: Session, user: models.User) -> models.HealthProfile:
    profile = (
        db.query(models.HealthProfile)
        .filter(
            models.HealthProfile.owner_user_id == user.id,
            models.HealthProfile.is_primary_profile.is_(True),
            models.HealthProfile.is_archived.is_(False),
        )
        .first()
    )
    if profile:
        return profile

    profile = models.HealthProfile(
        owner_user_id=user.id,
        full_name=(user.name or user.email or "Perfil principal").strip(),
        birth_date=None,
        gender="",
        relation_with_owner="propio",
        avatar_url="",
        base_medical_data="",
        is_primary_profile=True,
        is_archived=False,
        created_by_user_id=user.id,
    )
    db.add(profile)
    db.flush()
    return profile


def _ensure_profile_link(
    db: Session,
    profile_id: int,
    user_id: int,
    role: str = "admin",
    relationship_type: str = "self",
):
    link = (
        db.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.profile_id == profile_id,
            models.ProfileRelationship.user_id == user_id,
        )
        .first()
    )
    if link:
        return link
    now = datetime.utcnow()
    link = models.ProfileRelationship(
        profile_id=profile_id,
        user_id=user_id,
        role=role,
        relationship_type=relationship_type,
        status="accepted",
        invited_at=now,
        accepted_at=now,
    )
    db.add(link)
    db.flush()
    return link


def ensure_family_schema_data():
    """
    Backfill seguro:
    - plan_type por defecto
    - perfil principal por usuario
    - relacion admin del titular con su perfil principal
    - perfil activo inicial
    """
    db = SessionLocal()
    try:
        users = db.query(models.User).all()
        for user in users:
            user.plan_type = _normalize_plan_type(getattr(user, "plan_type", None))
            primary = _create_primary_health_profile_if_missing(db, user)
            _ensure_profile_link(
                db,
                profile_id=primary.id,
                user_id=user.id,
                role="admin",
                relationship_type="self",
            )
            if not getattr(user, "active_health_profile_id", None):
                user.active_health_profile_id = primary.id
            db.add(user)
        db.commit()
        print("DEBUG ensure_family_schema_data: perfiles principales verificados")
    except Exception as exc:
        db.rollback()
        print(f"WARNING ensure_family_schema_data: no se pudo completar: {exc}")
    finally:
        db.close()


ensure_family_schema_data()

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


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _is_production_env() -> bool:
    return bool(os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_PUBLIC_DOMAIN"))


def _email_provider() -> str:
    # auto: usa Resend si hay API key; de lo contrario SMTP
    return (os.getenv("EMAIL_PROVIDER", "auto") or "auto").strip().lower()


def _resend_enabled() -> bool:
    return bool(os.getenv("RESEND_API_KEY"))


def _smtp_enabled() -> bool:
    return bool(os.getenv("SMTP_USER") and os.getenv("SMTP_PASS"))


def _mail_from_security() -> str | None:
    return (
        os.getenv("EMAIL_FROM_SECURITY")
        or os.getenv("EMAIL_FROM")
        or os.getenv("MAIL_FROM_SECURITY")
        or os.getenv("RESEND_FROM_SECURITY")
        or os.getenv("MAIL_FROM")
        or os.getenv("RESEND_FROM")
        or os.getenv("SMTP_FROM_SECURITY")
        or os.getenv("SMTP_FROM")
        or os.getenv("SMTP_USER")
    )


def _mail_from_notifications() -> str | None:
    return (
        os.getenv("EMAIL_FROM_NOTIFICATIONS")
        or os.getenv("EMAIL_FROM")
        or os.getenv("MAIL_FROM_NOTIFICATIONS")
        or os.getenv("RESEND_FROM_NOTIFICATIONS")
        or os.getenv("MAIL_FROM")
        or os.getenv("RESEND_FROM")
        or os.getenv("SMTP_FROM_NOTIFICATIONS")
        or os.getenv("SMTP_FROM")
        or os.getenv("SMTP_USER")
    )


def _email_channel_errors(require_support_target: bool = False) -> list[str]:
    provider = _email_provider()
    errors = []
    from_security = _mail_from_security()
    from_notifications = _mail_from_notifications()

    if provider in ("resend",):
        if not _resend_enabled():
            errors.append("RESEND_API_KEY")
    elif provider in ("smtp",):
        if not os.getenv("SMTP_USER"):
            errors.append("SMTP_USER")
        if not os.getenv("SMTP_PASS"):
            errors.append("SMTP_PASS")
    else:
        if not (_resend_enabled() or _smtp_enabled()):
            errors.append("RESEND_API_KEY|SMTP_USER+SMTP_PASS")

    if not (from_security or from_notifications):
        errors.append(
            "EMAIL_FROM_*|EMAIL_FROM|MAIL_FROM_SECURITY|MAIL_FROM_NOTIFICATIONS|MAIL_FROM|RESEND_FROM_*|SMTP_FROM_*"
        )

    if require_support_target and not (
        os.getenv("EMAIL_TO_PRIVACY")
        or os.getenv("SUPPORT_EMAIL")
        or os.getenv("EMAIL_TO_SUPPORT")
        or os.getenv("SMTP_SUPPORT_TO")
        or os.getenv("SMTP_USER")
    ):
        errors.append("EMAIL_TO_PRIVACY|SUPPORT_EMAIL|EMAIL_TO_SUPPORT|SMTP_SUPPORT_TO")

    return errors


_EMAIL_TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates" / "email"
_EMAIL_TEMPLATE_ENV = None


def _email_logo_url() -> str:
    return (os.getenv("EMAIL_LOGO_URL") or "https://www.klinip.cl/icons/android-chrome-192x192.png").strip()


def _app_display_name() -> str:
    return (os.getenv("APP_DISPLAY_NAME") or "Klinip").strip()


def _email_template_env():
    global _EMAIL_TEMPLATE_ENV
    if _EMAIL_TEMPLATE_ENV is not None:
        return _EMAIL_TEMPLATE_ENV
    if not (Environment and FileSystemLoader and select_autoescape):
        return None
    _EMAIL_TEMPLATE_ENV = Environment(
        loader=FileSystemLoader(str(_EMAIL_TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    return _EMAIL_TEMPLATE_ENV


def _render_email_template(template_name: str, context: dict) -> str:
    env = _email_template_env()
    if env is None:
        raise RuntimeError("Jinja2 no disponible para renderizar plantillas de correo")
    template = env.get_template(template_name)
    return template.render(**context)


def _html_to_text(html_value: str) -> str:
    compact = re.sub(r"(?is)<(script|style).*?>.*?</\\1>", "", html_value)
    compact = re.sub(r"(?i)<br\\s*/?>", "\n", compact)
    compact = re.sub(r"(?i)</p>|</div>|</li>|</tr>|</h[1-6]>", "\n", compact)
    compact = re.sub(r"(?is)<[^>]+>", "", compact)
    compact = compact.replace("&nbsp;", " ")
    compact = compact.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    compact = re.sub(r"\n{3,}", "\n\n", compact)
    return compact.strip()


def _send_templated_email(
    to_email: str,
    subject: str,
    template_name: str,
    context: dict,
    from_security: bool = False,
):
    if not to_email:
        raise RuntimeError("Destinatario de correo no definido")

    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    sender = _smtp_from_security(smtp_user) if from_security else _smtp_from_notifications(smtp_user)
    if not sender:
        raise RuntimeError("Remitente de correo no configurado")

    template_context = {
        "app_name": _app_display_name(),
        "logo_url": _email_logo_url(),
        **(context or {}),
    }
    html_body = _render_email_template(template_name, template_context)
    text_body = _html_to_text(html_body)

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(text_body or subject)
    msg.add_alternative(html_body, subtype="html")
    _deliver_message(msg, smtp_user, smtp_pass)


def _password_reset_config_errors() -> list[str]:
    errors = _email_channel_errors(require_support_target=False)
    if _is_production_env() and not os.getenv("FRONTEND_BASE_URL"):
        errors.append("FRONTEND_BASE_URL")
    if _is_production_env() and os.getenv("SECRET_KEY", "supersecretkey_change_me_in_production") == "supersecretkey_change_me_in_production":
        errors.append("SECRET_KEY")
    return errors


def _privacy_contact_config_errors() -> list[str]:
    return _email_channel_errors(require_support_target=True)


def _email_config_error_detail(config_errors: list[str]) -> str:
    base = "Canal de correo no disponible temporalmente. Intenta nuevamente."
    # Facilita diagnostico en despliegues donde no se tienen logs a mano.
    return f"{base} Missing: {', '.join(config_errors)}"


def _build_reset_url(request: Request, raw_token: str) -> str:
    frontend_base_url = (os.getenv("FRONTEND_BASE_URL") or "").strip().rstrip("/")
    if not frontend_base_url:
        if _is_production_env():
            raise RuntimeError("FRONTEND_BASE_URL no configurado")
        origin = (request.headers.get("origin") or "").strip().rstrip("/")
        if origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1"):
            frontend_base_url = origin
        else:
            frontend_base_url = str(request.base_url).rstrip("/")
    return f"{frontend_base_url}/#/reset-password?token={raw_token}"


def _warn_password_reset_config():
    errors = _password_reset_config_errors()
    if errors:
        print(
            "WARNING password reset: configuracion incompleta. Faltan variables: "
            + ", ".join(errors)
        )


_warn_password_reset_config()


def _smtp_from_security(smtp_user: str | None) -> str | None:
    return (
        _mail_from_security()
        or os.getenv("SMTP_FROM_SECURITY")
        or os.getenv("SMTP_FROM")
        or smtp_user
    )


def _smtp_from_notifications(smtp_user: str | None) -> str | None:
    return (
        _mail_from_notifications()
        or os.getenv("SMTP_FROM_NOTIFICATIONS")
        or os.getenv("SMTP_FROM")
        or smtp_user
    )


def _msg_text_body(msg: EmailMessage) -> str:
    text_part = msg.get_body(preferencelist=("plain",))
    if text_part:
        return text_part.get_content()
    try:
        return msg.get_content()
    except Exception:
        return ""


def _msg_html_body(msg: EmailMessage) -> str | None:
    html_part = msg.get_body(preferencelist=("html",))
    if html_part:
        return html_part.get_content()
    return None


def _msg_attachments(msg: EmailMessage) -> list[dict]:
    items = []
    try:
        for part in msg.iter_attachments():
            filename = (part.get_filename() or "adjunto").strip()
            payload_bytes = part.get_payload(decode=True) or b""
            if not payload_bytes:
                continue
            items.append(
                {
                    "filename": filename,
                    "content": base64.b64encode(payload_bytes).decode("ascii"),
                }
            )
    except Exception:
        return []
    return items


def _resend_send_message(msg: EmailMessage):
    api_key = (os.getenv("RESEND_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("RESEND_API_KEY no configurado")

    from_email = (msg.get("From") or "").strip()
    to_email = (msg.get("To") or "").strip()
    subject = (msg.get("Subject") or "").strip()
    text_body = _msg_text_body(msg)
    html_body = _msg_html_body(msg)

    if not (from_email and to_email and subject):
        raise RuntimeError("Mensaje invalido para Resend (From/To/Subject)")

    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "text": text_body or "",
    }
    if html_body:
        payload["html"] = html_body
    attachments = _msg_attachments(msg)
    if attachments:
        payload["attachments"] = attachments

    req = urlrequest.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "klinip-backend/1.0",
            "Accept": "application/json",
        },
        method="POST",
    )

    timeout = int(os.getenv("EMAIL_API_TIMEOUT", "20"))
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            status = getattr(resp, "status", 200)
            body = resp.read().decode("utf-8", errors="ignore")
            if status < 200 or status >= 300:
                raise RuntimeError(f"Resend HTTP {status}: {body[:300]}")
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Resend HTTP {exc.code}: {detail[:300]}") from exc
    except Exception as exc:
        raise RuntimeError(f"Resend delivery failed: {exc}") from exc


def _deliver_message(msg: EmailMessage, smtp_user: str | None = None, smtp_pass: str | None = None):
    provider = _email_provider()

    if provider == "resend":
        _resend_send_message(msg)
        return

    if provider == "smtp":
        if not (smtp_user and smtp_pass):
            raise RuntimeError("SMTP no configurado")
        _smtp_send_message(msg, smtp_user, smtp_pass)
        return

    # auto: prioriza API HTTPS si existe para Railway Hobby
    if _resend_enabled():
        _resend_send_message(msg)
        return
    if smtp_user and smtp_pass:
        _smtp_send_message(msg, smtp_user, smtp_pass)
        return

    raise RuntimeError("Canal de correo no configurado (RESEND_API_KEY o SMTP_USER/SMTP_PASS)")


def _smtp_connection_settings() -> tuple[str, int, int, bool]:
    smtp_host = (os.getenv("SMTP_HOST", "smtp.zoho.com") or "smtp.zoho.com").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_timeout = int(os.getenv("SMTP_TIMEOUT", "25"))
    smtp_use_ssl = (os.getenv("SMTP_USE_SSL", "false") or "false").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    # Puerto 465 normalmente usa SSL directo.
    if smtp_port == 465:
        smtp_use_ssl = True
    return smtp_host, smtp_port, smtp_timeout, smtp_use_ssl


def _smtp_candidate_hosts(primary_host: str) -> list[str]:
    raw_hosts = (os.getenv("SMTP_HOSTS") or "").strip()
    hosts = []
    if raw_hosts:
        hosts.extend([h.strip() for h in raw_hosts.split(",") if h.strip()])
    if primary_host:
        hosts.append(primary_host)

    # Fallback tipico para Zoho por region/infra
    if any("zoho" in h for h in hosts) or ("zoho" in primary_host):
        hosts.extend(
            [
                "smtp.zoho.com",
                "smtppro.zoho.com",
                "smtp.zoho.eu",
                "smtp.zoho.in",
                "smtp.zoho.com.au",
            ]
        )

    unique_hosts = []
    for h in hosts:
        if h not in unique_hosts:
            unique_hosts.append(h)
    return unique_hosts


def _smtp_delivery_attempts(host: str, port: int, use_ssl: bool) -> list[tuple[str, int, bool]]:
    attempts = [(host, port, use_ssl)]
    if port == 587:
        attempts.append((host, 465, True))
    elif port == 465:
        attempts.append((host, 587, False))
    else:
        attempts.append((host, 587, False))
        attempts.append((host, 465, True))

    uniq = []
    for item in attempts:
        if item not in uniq:
            uniq.append(item)
    return uniq


def _smtp_send_message(msg: EmailMessage, smtp_user: str, smtp_pass: str):
    smtp_host, smtp_port, smtp_timeout, smtp_use_ssl = _smtp_connection_settings()
    max_attempts = int(os.getenv("SMTP_MAX_ATTEMPTS", "4"))
    hosts = _smtp_candidate_hosts(smtp_host)
    failures = []
    attempt_counter = 0

    for host in hosts:
        for try_host, try_port, try_ssl in _smtp_delivery_attempts(host, smtp_port, smtp_use_ssl):
            attempt_counter += 1
            if attempt_counter > max_attempts:
                break
            try:
                print(
                    f"DEBUG smtp: intento={attempt_counter}/{max_attempts} host={try_host} port={try_port} use_ssl={try_ssl} timeout={smtp_timeout}"
                )
                if try_ssl:
                    with smtplib.SMTP_SSL(try_host, try_port, timeout=smtp_timeout) as server:
                        server.login(smtp_user, smtp_pass)
                        server.send_message(msg)
                    return

                with smtplib.SMTP(try_host, try_port, timeout=smtp_timeout) as server:
                    server.ehlo()
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                    server.login(smtp_user, smtp_pass)
                    server.send_message(msg)
                return
            except Exception as exc:
                failures.append(f"{try_host}:{try_port} ssl={try_ssl} -> {exc!r}")
        if attempt_counter > max_attempts:
            break

    detail = " | ".join(failures[:max_attempts]) if failures else "sin detalle"
    raise RuntimeError(f"SMTP delivery failed. {detail}")


def _send_reset_email(to_email: str, reset_url: str):
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    smtp_from = _smtp_from_security(smtp_user)

    if not (smtp_from and to_email):
        raise RuntimeError("Canal de correo no configurado")

    msg = EmailMessage()
    msg["Subject"] = "Klinip - Restablecer contrasena"
    msg["From"] = smtp_from
    msg["To"] = to_email
    msg.set_content(
        "Hola,\n\n"
        "Recibimos una solicitud para restablecer tu contrasena.\n"
        f"Ingresa al siguiente enlace para continuar:\n{reset_url}\n\n"
        "Si no solicitaste este cambio, ignora este mensaje.\n"
    )

    _deliver_message(msg, smtp_user, smtp_pass)


def _send_reset_email_safe(to_email: str, reset_url: str):
    try:
        _send_reset_email(to_email, reset_url)
        print(f"DEBUG reset email: enviado a {to_email}")
    except Exception as exc:
        print(f"ERROR sending reset email async: {exc}")


def _support_email_target() -> str:
    # Destino para soporte general
    return (
        os.getenv("EMAIL_TO_SUPPORT")
        or os.getenv("SUPPORT_EMAIL")
        or os.getenv("SMTP_SUPPORT_TO")
        or os.getenv("SMTP_USER")
        or "soporte@klinip.cl"
    )


def _privacy_email_target() -> str:
    # Destino para solicitudes sensibles de privacidad
    return (
        os.getenv("EMAIL_TO_PRIVACY")
        or os.getenv("SUPPORT_EMAIL")
        or os.getenv("EMAIL_TO_SUPPORT")
        or os.getenv("SMTP_SUPPORT_TO")
        or os.getenv("SMTP_USER")
        or "soporte@klinip.cl"
    )


def _send_privacy_support_email(payload: dict):
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    smtp_from = _smtp_from_notifications(smtp_user)
    support_to = _privacy_email_target()

    if not (smtp_from and support_to):
        raise RuntimeError("Canal de correo no configurado para soporte de privacidad")

    msg = EmailMessage()
    msg["Subject"] = f"Klinip - Solicitud de privacidad #{payload.get('request_id')}"
    msg["From"] = smtp_from
    msg["To"] = support_to
    text_body = (
        "Nueva solicitud de soporte de privacidad\n\n"
        f"Request ID: {payload.get('request_id')}\n"
        f"Usuario ID: {payload.get('user_id')}\n"
        f"Email usuario: {payload.get('email')}\n"
        f"Motivo: {payload.get('reason')}\n"
        f"Incluir informacion tecnica: {payload.get('include_tech')}\n"
        f"IP: {payload.get('ip')}\n"
        f"User-Agent: {payload.get('user_agent')}\n\n"
        f"Mensaje:\n{payload.get('message')}\n"
    )
    msg.set_content(text_body)
    msg.add_alternative(
        f"""
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:18px 22px;background:linear-gradient(135deg,#2563eb,#22c55e);color:#ffffff;">
                <h2 style="margin:0;font-size:20px;">Klinip · Nueva solicitud de privacidad</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 22px;">
                <p style="margin:0 0 10px;"><strong>Seguimiento:</strong> #{escape(str(payload.get('request_id') or ''))}</p>
                <p style="margin:0 0 10px;"><strong>Usuario ID:</strong> {escape(str(payload.get('user_id') or ''))}</p>
                <p style="margin:0 0 10px;"><strong>Email:</strong> {escape(str(payload.get('email') or ''))}</p>
                <p style="margin:0 0 10px;"><strong>Motivo:</strong> {escape(str(payload.get('reason') or ''))}</p>
                <p style="margin:0 0 10px;"><strong>Incluye info tecnica:</strong> {escape(str(payload.get('include_tech') or ''))}</p>
                <p style="margin:0 0 10px;"><strong>IP:</strong> {escape(str(payload.get('ip') or ''))}</p>
                <p style="margin:0 0 10px;"><strong>User-Agent:</strong> {escape(str(payload.get('user_agent') or ''))}</p>
                <div style="margin-top:14px;padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">
                  <p style="margin:0 0 8px;font-weight:700;">Mensaje</p>
                  <p style="margin:0;white-space:pre-wrap;">{escape(str(payload.get('message') or ''))}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 22px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;">
                Klinip · Canal interno de soporte de privacidad
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
        """.strip(),
        subtype="html",
    )

    _deliver_message(msg, smtp_user, smtp_pass)


def _send_privacy_support_email_safe(payload: dict):
    try:
        _send_privacy_support_email(payload)
        print(
            f"DEBUG privacy support email: enviado request_id={payload.get('request_id')} a {_privacy_email_target()}"
        )
    except Exception as exc:
        print(f"ERROR sending privacy support email async: {exc}")


def _send_privacy_user_ack_email(to_email: str, payload: dict):
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    smtp_from = _smtp_from_notifications(smtp_user)

    if not (smtp_from and to_email):
        raise RuntimeError("Canal de correo no configurado para acuse de recibo al usuario")

    msg = EmailMessage()
    msg["Subject"] = f"Klinip - Solicitud recibida #{payload.get('request_id')}"
    msg["From"] = smtp_from
    msg["To"] = to_email
    text_body = (
        "Hola,\n\n"
        "Recibimos tu solicitud de soporte de privacidad correctamente.\n"
        f"Numero de seguimiento: #{payload.get('request_id')}\n\n"
        "Resumen de tu solicitud:\n"
        f"- Motivo: {payload.get('reason')}\n"
        f"- Mensaje: {payload.get('message')}\n"
        f"- Fecha: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC\n\n"
        "Nuestro equipo revisara tu caso y te respondera lo antes posible.\n\n"
        "Gracias,\n"
        "Equipo Klinip\n"
    )
    msg.set_content(text_body)
    msg.add_alternative(
        f"""
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:18px 22px;background:linear-gradient(135deg,#2563eb,#22c55e);color:#ffffff;">
                <h2 style="margin:0;font-size:20px;">Klinip · Solicitud recibida</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 22px;">
                <p style="margin:0 0 12px;">Hola,</p>
                <p style="margin:0 0 12px;">Recibimos tu solicitud de soporte de privacidad correctamente.</p>
                <div style="margin:10px 0;padding:12px;border:1px solid #dbeafe;border-radius:10px;background:#eff6ff;">
                  <p style="margin:0 0 6px;"><strong>Numero de seguimiento:</strong> #{escape(str(payload.get('request_id') or ''))}</p>
                  <p style="margin:0 0 6px;"><strong>Motivo:</strong> {escape(str(payload.get('reason') or ''))}</p>
                  <p style="margin:0;"><strong>Mensaje:</strong> {escape(str(payload.get('message') or ''))}</p>
                </div>
                <p style="margin:12px 0 0;">Nuestro equipo revisara tu caso y te respondera lo antes posible.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 22px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;">
                Gracias por confiar en Klinip.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
        """.strip(),
        subtype="html",
    )

    _deliver_message(msg, smtp_user, smtp_pass)


def _send_privacy_user_ack_email_safe(to_email: str, payload: dict):
    try:
        _send_privacy_user_ack_email(to_email, payload)
        print(
            f"DEBUG privacy ack email: enviado request_id={payload.get('request_id')} a {to_email}"
        )
    except Exception as exc:
        print(f"ERROR sending privacy ack email async: {exc}")


def _send_welcome_email_safe(to_email: str, user_name: str):
    try:
        _send_templated_email(
            to_email=to_email,
            subject="Bienvenido a Klinip",
            template_name="welcome.html",
            context={
                "user_name": user_name or "Usuario",
                "year": datetime.utcnow().year,
            },
        )
        print(f"DEBUG welcome email: enviado a {to_email}")
    except Exception as exc:
        print(f"ERROR sending welcome email async: {exc}")


def _send_appointment_confirmation_email_safe(to_email: str, user_name: str, payload: dict):
    try:
        _send_templated_email(
            to_email=to_email,
            subject="Cita confirmada",
            template_name="appointment_confirmation.html",
            context={
                "user_name": user_name or "Usuario",
                "center": payload.get("center") or "Centro de salud",
                "specialty": payload.get("specialty") or "Atencion medica",
                "date_label": payload.get("date_label") or "Pendiente",
                "notes": payload.get("notes") or "",
                "year": datetime.utcnow().year,
            },
        )
        print(f"DEBUG appointment email: enviado a {to_email}")
    except Exception as exc:
        print(f"ERROR sending appointment confirmation email async: {exc}")


def _send_appointment_reminder_email_safe(to_email: str, user_name: str, payload: dict):
    try:
        _send_templated_email(
            to_email=to_email,
            subject=f"Recordatorio de cita - {payload.get('offset_label') or 'proxima cita'}",
            template_name="appointment_reminder.html",
            context={
                "user_name": user_name or "Usuario",
                "offset_label": payload.get("offset_label") or "",
                "specialty": payload.get("specialty") or "Atencion medica",
                "center": payload.get("center") or "Centro de salud",
                "date_label": payload.get("date_label") or "",
                "notes": payload.get("notes") or "",
                "year": datetime.utcnow().year,
            },
        )
    except Exception as exc:
        print(f"ERROR sending appointment reminder email async: {exc}")


def _send_medical_order_uploaded_email_safe(to_email: str, user_name: str, payload: dict):
    try:
        _send_templated_email(
            to_email=to_email,
            subject="Orden medica procesada",
            template_name="medical_order_processed.html",
            context={
                "user_name": user_name or "Usuario",
                "document_type": payload.get("document_type") or "Documento medico",
                "uploaded_at": payload.get("uploaded_at") or datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
                "year": datetime.utcnow().year,
            },
        )
        print(f"DEBUG order processed email: enviado a {to_email}")
    except Exception as exc:
        print(f"ERROR sending order processed email async: {exc}")


def _send_document_backup_email_safe(
    to_email: str,
    user_name: str,
    payload: dict,
    filename: str,
    file_bytes: bytes,
):
    try:
        if not to_email or not file_bytes:
            return
        smtp_user = os.getenv("SMTP_USER")
        smtp_pass = os.getenv("SMTP_PASS")
        sender = _smtp_from_notifications(smtp_user)
        if not sender:
            raise RuntimeError("Remitente de correo no configurado")

        subject = f"Respaldo de documento: {filename}"
        doc_type = payload.get("document_type") or "Documento"
        center = payload.get("center") or "Sin centro"
        uploaded_at = payload.get("uploaded_at") or datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

        text_body = (
            f"Hola {user_name or 'Usuario'},\n\n"
            f"Adjuntamos una copia de respaldo de tu documento subido en Klinip.\n\n"
            f"Tipo: {doc_type}\n"
            f"Centro: {center}\n"
            f"Fecha de carga: {uploaded_at}\n\n"
            f"Equipo {_app_display_name()}"
        )
        html_body = (
            f"<p>Hola {escape(user_name or 'Usuario')},</p>"
            f"<p>Adjuntamos una copia de respaldo de tu documento subido en {_app_display_name()}.</p>"
            f"<p><strong>Tipo:</strong> {escape(doc_type)}<br>"
            f"<strong>Centro:</strong> {escape(center)}<br>"
            f"<strong>Fecha de carga:</strong> {escape(uploaded_at)}</p>"
        )

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = sender
        msg["To"] = to_email
        msg.set_content(text_body)
        msg.add_alternative(html_body, subtype="html")

        mime_type, _ = mimetypes.guess_type(filename or "")
        maintype, subtype = ("application", "octet-stream")
        if mime_type and "/" in mime_type:
            maintype, subtype = mime_type.split("/", 1)
        msg.add_attachment(
            file_bytes,
            maintype=maintype,
            subtype=subtype,
            filename=filename or "documento",
        )

        _deliver_message(msg, smtp_user, smtp_pass)
        print(f"DEBUG document backup email: enviado a {to_email} adjunto={filename}")
    except Exception as exc:
        print(f"ERROR sending document backup email async: {exc}")


def _send_medications_detected_email_safe(to_email: str, user_name: str, medications: list[dict]):
    if not medications:
        return
    try:
        _send_templated_email(
            to_email=to_email,
            subject="Medicamentos detectados en tu orden medica",
            template_name="medications_detected.html",
            context={
                "user_name": user_name or "Usuario",
                "medications": medications,
                "year": datetime.utcnow().year,
            },
        )
        print(f"DEBUG medications detected email: enviado a {to_email} total={len(medications)}")
    except Exception as exc:
        print(f"ERROR sending medications detected email async: {exc}")


def _send_medication_reminder_email_safe(to_email: str, user_name: str, payload: dict):
    try:
        _send_templated_email(
            to_email=to_email,
            subject="Recordatorio de medicamento",
            template_name="reminder.html",
            context={
                "user_name": user_name or "Usuario",
                "medication": payload.get("medication") or "Medicamento",
                "dose": payload.get("dose") or "-",
                "time_label": payload.get("time_label") or "Ahora",
                "notes": payload.get("notes") or "",
                "year": datetime.utcnow().year,
            },
        )
    except Exception as exc:
        print(f"ERROR sending medication reminder email async: {exc}")


def _send_health_alert_email_safe(to_email: str, user_name: str, payload: dict):
    try:
        _send_templated_email(
            to_email=to_email,
            subject=payload.get("subject") or "Alerta importante de salud",
            template_name="health_alert.html",
            context={
                "user_name": user_name or "Usuario",
                "title": payload.get("title") or "Alerta importante",
                "message": payload.get("message") or "",
                "year": datetime.utcnow().year,
            },
            from_security=True,
        )
    except Exception as exc:
        print(f"ERROR sending health alert email async: {exc}")


def _send_family_report_email_safe(
    to_email: str,
    user_name: str,
    report_payload: dict,
):
    try:
        _send_templated_email(
            to_email=to_email,
            subject="Reporte familiar de salud - Klinip",
            template_name="family_report_digest.html",
            context={
                "user_name": user_name or "Usuario",
                "period_days": report_payload.get("period_days") or 7,
                "totals": report_payload.get("totals") or {},
                "profiles": report_payload.get("profiles") or [],
                "year": datetime.utcnow().year,
            },
        )
    except Exception as exc:
        print(f"ERROR sending family report email async: {exc}")




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


_DEFAULT_NOTIFICATION_SETTINGS = {
    "appointmentReminders": True,
    "medicationReminders": True,
    "customOffsets": {
        "days7": True,
        "days3": True,
        "days1": True,
        "hours2": True,
        "minutes30": True,
        "minutes5": True,
    },
}


def _user_notification_settings(user: models.User) -> dict:
    raw = getattr(user, "notification_settings_json", "") or ""
    if not raw:
        return _DEFAULT_NOTIFICATION_SETTINGS
    try:
        parsed = json.loads(raw)
    except Exception:
        return _DEFAULT_NOTIFICATION_SETTINGS

    custom = (parsed.get("customOffsets") or {}) if isinstance(parsed, dict) else {}
    defaults_custom = _DEFAULT_NOTIFICATION_SETTINGS["customOffsets"]

    return {
        "appointmentReminders": bool(parsed.get("appointmentReminders", True)) if isinstance(parsed, dict) else True,
        "medicationReminders": bool(parsed.get("medicationReminders", True)) if isinstance(parsed, dict) else True,
        "customOffsets": {
            "days7": bool(custom.get("days7", defaults_custom["days7"])),
            "days3": bool(custom.get("days3", defaults_custom["days3"])),
            "days1": bool(custom.get("days1", defaults_custom["days1"])),
            "hours2": bool(custom.get("hours2", defaults_custom["hours2"])),
            "minutes30": bool(custom.get("minutes30", defaults_custom["minutes30"])),
            "minutes5": bool(custom.get("minutes5", defaults_custom["minutes5"])),
        },
    }


def _appointment_offsets_for_user(user: models.User):
    prefs = _user_notification_settings(user)
    custom = prefs.get("customOffsets", {})
    all_offsets = _appointment_offsets()
    mapping = {
        "7 dias antes": "days7",
        "3 dias antes": "days3",
        "1 dia antes": "days1",
        "2 horas antes": "hours2",
        "30 minutos antes": "minutes30",
        "5 minutos antes": "minutes5",
    }
    selected = []
    for item in all_offsets:
        key = mapping.get(item["label"])
        if key and bool(custom.get(key, True)):
            selected.append(item)
    return selected or all_offsets


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


def _medication_time_slots(med: models.Medication):
    schedule_slot = _parse_schedule_time(getattr(med, "schedule_time", "") or "")
    if schedule_slot:
        return [schedule_slot]
    return [(hour, 0) for hour in _derive_dose_hours(med.frequency)]


def _calculate_expected_doses_until(med: models.Medication, now: datetime) -> int:
    start = med.created_at or now
    end = now
    if med.end_date and med.end_date < end:
        end = med.end_date
    if end < start:
        return 0

    slots = _medication_time_slots(med)
    day = start.replace(hour=0, minute=0, second=0, microsecond=0)
    end_day = end.replace(hour=0, minute=0, second=0, microsecond=0)
    expected = 0

    while day <= end_day:
        for hour, minute in slots:
            trigger_at = _build_med_trigger(day, hour, minute)
            if trigger_at < start:
                continue
            if trigger_at <= end:
                expected += 1
        day += timedelta(days=1)

    return expected


def _attach_medication_adherence(
    db: Session, medications: list[models.Medication], current_user: models.User
):
    if not medications:
        return medications

    now = datetime.now()
    medication_ids = [m.id for m in medications]
    taken_counts = {mid: 0 for mid in medication_ids}

    intake_rows = (
        db.query(
            models.MedicationIntake.medication_id,
            func.count(models.MedicationIntake.id),
        )
        .filter(
            models.MedicationIntake.user_id == current_user.id,
            models.MedicationIntake.medication_id.in_(medication_ids),
        )
        .group_by(models.MedicationIntake.medication_id)
        .all()
    )

    for medication_id, count in intake_rows:
        taken_counts[medication_id] = int(count or 0)

    for med in medications:
        expected = _calculate_expected_doses_until(med, now)
        taken = int(taken_counts.get(med.id, 0))
        missed = max(expected - taken, 0)
        adherence = None
        if expected > 0:
            adherence = round(min((taken / expected) * 100, 100), 1)
        setattr(med, "expected_doses", expected)
        setattr(med, "taken_doses", taken)
        setattr(med, "missed_doses", missed)
        setattr(med, "adherence_rate", adherence)

    return medications


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
            user_settings = _user_notification_settings(user)
            user_tz = _resolve_user_tz(user)
            now = datetime.now(user_tz)

            if bool(user_settings.get("appointmentReminders", True)):
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

                    for offset in _appointment_offsets_for_user(user):
                        trigger_at = appt_dt - offset["delta"]
                        if not _is_due(now, trigger_at):
                            continue

                        label = offset["label"]
                        tag = f"appointment-{appt.id}-{label}-sub-{subscription.id}"
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
                                "userId": user_id,
                                "tag": tag,
                            },
                        )
                        if ok:
                            _record_sent(db, user_id, tag, "appointment", trigger_at, now)

                        email_tag = f"appointment-email-{appt.id}-{label}"
                        if (
                            user
                            and user.email
                            and bool(getattr(user, "email_reminders_enabled", False))
                            and not _notification_already_sent(db, email_tag)
                        ):
                            _send_appointment_reminder_email_safe(
                                user.email,
                                user.name or "",
                                {
                                    "offset_label": label,
                                    "specialty": appt.specialty or appt.type,
                                    "center": center,
                                    "date_label": when_text,
                                    "notes": appt.notes or "",
                                },
                            )
                            _record_sent(
                                db,
                                user_id,
                                email_tag,
                                "appointment_email",
                                trigger_at,
                                now,
                            )

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

            if not bool(user_settings.get("medicationReminders", True)):
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
                                f"medication-{med.id}-{trigger_exact_ms}-lead-{offset_minutes}-sub-{subscription.id}"
                            )
                            if _notification_already_sent(db, tag):
                                continue
                            email_tag = (
                                f"medication-email-{med.id}-{trigger_exact_ms}-lead-{offset_minutes}"
                            )

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
                                    "userId": user_id,
                                    "tag": tag,
                                },
                            )
                            if ok:
                                _record_sent(db, user_id, tag, "medication", trigger_at, now)
                            if (
                                user
                                and user.email
                                and bool(getattr(user, "email_reminders_enabled", False))
                                and not _notification_already_sent(db, email_tag)
                            ):
                                time_label = trigger_exact.strftime("%H:%M hrs")
                                _send_medication_reminder_email_safe(
                                    user.email,
                                    user.name or "",
                                    {
                                        "medication": med.name or "Medicamento",
                                        "dose": med.dose or "",
                                        "time_label": time_label,
                                        "notes": med.notes or "",
                                    },
                                )
                                _record_sent(
                                    db,
                                    user_id,
                                    email_tag,
                                    "medication_email",
                                    trigger_at,
                                    now,
                                )
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
    if "rp" in lowered and (
        "favor realizar" in lowered
        or "ecografia" in lowered
        or "ultrasonido" in lowered
        or "examen" in lowered
    ):
        return "orden"
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
    if "citacion" in lowered or "toma de muestra" in lowered:
        return "orden"
    if (
        "ecografia" in lowered
        or "ultrasonido" in lowered
        or "radiografia" in lowered
        or "rx" in lowered
        or "examen" in lowered
    ):
        return "orden"
    if (
        "vacuna" in lowered
        or "vacunacion" in lowered
        or "carnet" in lowered
        or "inmunizacion" in lowered
        or "antihepatitis" in lowered
    ):
        return "informe"
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
    cleaned = _safe_text(cleaned)
    if "rosita renard" in _normalize_text(cleaned):
        return "CESFAM Rosita Renard"
    return cleaned


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

    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    for idx, line in enumerate(lines):
        normalized = _normalize_text(line)
        if "fecha" in normalized:
            token = _extract_date_token(line)
            if not token and idx + 1 < len(lines):
                token = _extract_date_token(lines[idx + 1])
            if token:
                try:
                    day, month, year = token.split("/")
                    return datetime(int(year), int(month), int(day))
                except Exception:
                    pass

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

    vaccine_notes = _extract_vaccine_notes(text)
    if vaccine_notes:
        return vaccine_notes[:400]
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


def _extract_vaccine_notes(text: str) -> str | None:
    if not text:
        return None
    normalized = _normalize_text(text)
    if not any(
        k in normalized
        for k in ("vacuna", "vacunacion", "carnet", "inmunizacion", "antihepatitis")
    ):
        return None

    vaccine = ""
    if "antihepatitis" in normalized or "hepatitis b" in normalized:
        vaccine = "Vacuna Antihepatitis B"
    elif "influenza" in normalized:
        vaccine = "Vacuna Influenza"
    elif "covid" in normalized or "coronavirus" in normalized:
        vaccine = "Vacuna COVID-19"

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    dose_notes = []
    for idx, line in enumerate(lines):
        norm_line = _normalize_text(line)
        if "dosis" not in norm_line:
            continue
        dose_label = ""
        if "1" in norm_line and "dosis" in norm_line:
            dose_label = "1a dosis"
        elif "2" in norm_line and "dosis" in norm_line:
            dose_label = "2a dosis"
        elif "3" in norm_line and "dosis" in norm_line:
            dose_label = "3a dosis"

        date_value = _extract_date_token(line)
        if not date_value and idx + 1 < len(lines):
            date_value = _extract_date_token(lines[idx + 1])
        if not date_value and idx + 2 < len(lines):
            date_value = _extract_date_token(lines[idx + 2])

        if dose_label and date_value:
            dose_notes.append(f"{dose_label}: {date_value}")
        elif date_value:
            dose_notes.append(f"Dosis: {date_value}")

    parts = []
    if vaccine:
        parts.append(vaccine)
    if dose_notes:
        parts.append(" | ".join(dose_notes))
    if parts:
        return "Carnet de vacunacion: " + " - ".join(parts)
    return None


def _extract_date_token(text: str) -> str | None:
    if not text:
        return None

    match = re.search(r"\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b", text)
    if match:
        day = int(match.group(1))
        month = int(match.group(2))
        year = int(match.group(3))
        if year < 100:
            year += 2000
        return f"{day:02d}/{month:02d}/{year}"

    month_map = {
        "ene": 1,
        "feb": 2,
        "mar": 3,
        "abr": 4,
        "may": 5,
        "jun": 6,
        "jul": 7,
        "ago": 8,
        "sep": 9,
        "oct": 10,
        "nov": 11,
        "dic": 12,
        "jan": 1,
        "apr": 4,
        "aug": 8,
        "dec": 12,
    }
    match = re.search(r"\b(\d{1,2})\s*([A-Za-z]{3,})\s*(\d{2,4})\b", text)
    if match:
        day = int(match.group(1))
        month_raw = match.group(2).lower()
        month_key = month_raw[:3]
        month = month_map.get(month_key)
        year = int(match.group(3))
        if year < 100:
            year += 2000
        if month:
            return f"{day:02d}/{month:02d}/{year}"
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
    if not results:
        fallback_pattern = re.compile(
            r"(glucosa(?:\s+(?:basal|120\s*min|post))?)\s+(\d+(?:[.,]\d+)?)\s*(mg\/dl|mmol\/l)?",
            re.IGNORECASE,
        )
        for line in lines:
            match = fallback_pattern.search(line)
            if not match:
                continue
            name = _safe_text(match.group(1).title())
            value = match.group(2)
            unit = match.group(3) or "mg/dL"
            results.append(f"{name} {value} {unit}")
    if sample:
        results.insert(0, f"Muestra: {sample}")
    return results


def _extract_order_notes(text: str) -> list[str]:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return []
    notes = []
    normalized_text = _normalize_text(" ".join(lines))
    tokens = normalized_text.split()
    has_favor = _has_similar_token(tokens, "favor")
    has_realizar = _has_similar_token(tokens, "realizar")
    has_ecografia = _has_similar_token(tokens, "ecografia") or "ecogra" in normalized_text
    has_abdominal = (
        _has_similar_token(tokens, "abdominal")
        or _has_similar_token(tokens, "abdomen")
        or "abdom" in normalized_text
    )
    has_control = _has_similar_token(tokens, "control")
    has_polipos = _has_similar_token(tokens, "polipos")
    has_vesicular = _has_similar_token(tokens, "vesicular") or _has_similar_token(
        tokens, "vesiculares"
    )
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
        "ecografia",
        "ultrasonido",
        "abdominal",
        "muestra",
        "polipo",
        "vesicular",
    )
    post_notes = _extract_post_sample_notes(lines)
    if post_notes:
        notes.append("Indicaciones post toma de muestra: " + " | ".join(post_notes))
    for line in lines:
        if "sin ayuno" in _normalize_text(line):
            cleaned = _clean_ocr_line(line)
            if cleaned:
                notes.append(cleaned)
    for idx, line in enumerate(lines):
        normalized = _normalize_text(line)
        if normalized.startswith("rp") or normalized == "rp":
            rp_value = line.split(":", 1)[1].strip() if ":" in line else ""
            rp_parts = [rp_value] if rp_value else []
            for extra_line in lines[idx + 1 : idx + 4]:
                extra_norm = _normalize_text(extra_line)
                if extra_norm.startswith("dx") or extra_norm.startswith("diagnostico"):
                    break
                rp_parts.append(_clean_ocr_line(extra_line))
            rp_text = " ".join([p for p in rp_parts if p]).strip()
            rp_norm = _normalize_text(rp_text)
            if rp_text and any(
                k in rp_norm for k in ("ecografia", "ultrasonido", "radiografia")
            ):
                notes.append(rp_text)
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
            diagnostico = _clean_ocr_line(value)
        if not diagnostico and normalized.startswith("dx"):
            value = ""
            if ":" in line:
                _, tail = line.split(":", 1)
                value = tail.strip()
            if not value and idx + 1 < len(lines):
                value = lines[idx + 1].strip()
            diagnostico = _clean_ocr_line(value)
    tipo = re.sub(r"[|]+", "", tipo).strip()
    diagnostico = re.sub(r"[|]+", "", diagnostico).strip()
    if diagnostico:
        diag_norm = _normalize_text(diagnostico)
        if not any(k in diag_norm for k in diagnostico_keywords):
            diagnostico = ""
    parts = [p for p in [tipo, diagnostico] if p]
    if parts:
        notes.insert(0, " - ".join(parts))
    if has_ecografia:
        phrase = "Ecografia"
        if has_abdominal:
            phrase += " abdominal"
        if has_favor and has_realizar:
            notes.append(f"Favor realizar {phrase}")
        else:
            notes.append(phrase)
    if has_control and has_polipos:
        dx = "Control polipos"
        if has_vesicular:
            dx += " vesiculares"
        notes.append(f"Dx: {dx}")
    notes = [note for note in notes if note]
    filtered = []
    for note in notes:
        note_norm = _normalize_text(note)
        if any(
            k in note_norm
            for k in (
                "ecografia",
                "ultrasonido",
                "radiografia",
                "dx",
                "diagnostico",
                "polipo",
                "vesicular",
                "sin ayuno",
                "indicaciones post",
                "toma de muestra",
            )
        ):
            filtered.append(note)
    if filtered:
        notes = filtered
    deduped = []
    for note in notes:
        if note not in deduped:
            deduped.append(note)
    return deduped


def _extract_post_sample_notes(lines: list[str]) -> list[str]:
    notes = []
    if not lines:
        return notes
    start_idx = None
    for idx, line in enumerate(lines):
        normalized = _normalize_text(line)
        if "indicacion y cuidados post" in normalized:
            start_idx = idx + 1
            break
    if start_idx is None:
        return notes
    for line in lines[start_idx:]:
        normalized = _normalize_text(line)
        if "preparacion" in normalized and "examen" in normalized:
            break
        if normalized.startswith("procedimientos relacionados"):
            break
        cleaned = _safe_text(line.lstrip("•-").strip())
        if cleaned:
            notes.append(cleaned)
    return notes


def _clean_ocr_line(value: str) -> str:
    if not value:
        return ""
    cleaned = re.sub(r"[^A-Za-z0-9\\s]", " ", value)
    cleaned = re.sub(r"\\s+", " ", cleaned).strip()
    letters = sum(1 for ch in cleaned if ch.isalpha())
    total = len(cleaned.replace(" ", ""))
    if letters < 6:
        return ""
    if total > 0 and (letters / total) < 0.65:
        return ""
    return cleaned


def _has_similar_token(tokens: list[str], target: str, threshold: float = 0.72) -> bool:
    for token in tokens:
        if token == target:
            return True
        if len(token) < 3:
            continue
        if SequenceMatcher(None, token, target).ratio() >= threshold:
            return True
    return False


def _extract_label_medication(text: str) -> dict | None:
    if not text:
        return None

    raw_lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not raw_lines:
        return None

    normalized = _normalize_text(" ".join(raw_lines))
    if not any(
        token in normalized
        for token in (
            "mg",
            "ml",
            "capsula",
            "comprimido",
            "tableta",
            "sobres",
            "sobre",
            "jarabe",
        )
    ):
        return None

    stop_words = {
        "capsulas",
        "capsula",
        "comprimidos",
        "comprimido",
        "tabletas",
        "tableta",
        "polvo",
        "solucion",
        "oral",
        "sabor",
        "libre",
        "gluten",
        "bioequivalente",
        "bago",
        "hetero",
        "opko",
        "precisionbiotics",
    }

    name_candidate = ""
    uppercase_words = re.findall(r"\b[A-ZÁÉÍÓÚÑ]{4,}\b", text)
    for word in uppercase_words:
        if _normalize_text(word) in stop_words:
            continue
        name_candidate = word.title()
        break

    if not name_candidate:
        for line in raw_lines[:8]:
            cleaned = _clean_ocr_line(line)
            normalized_line = _normalize_text(cleaned)
            if not cleaned:
                continue
            tokens = [t for t in normalized_line.split() if t]
            if not tokens:
                continue
            if any(t in stop_words for t in tokens):
                continue
            if sum(1 for ch in cleaned if ch.isalpha()) >= 6:
                name_candidate = cleaned.title()
                break

    if not name_candidate:
        return None

    dose_match = re.search(
        r"(\d+(?:[.,]\d+)?)\s*(mg|ml|cc|mcg|ug|g)",
        normalized,
        re.IGNORECASE,
    )
    dose = ""
    if dose_match:
        dose = f"{dose_match.group(1)} {dose_match.group(2)}"

    instruction_text = " ".join(raw_lines[-6:])
    instruction_norm = _normalize_text(instruction_text)

    duration_days = None
    duration_match = re.search(r"x\s*(\d+)\s*dias", instruction_norm)
    if not duration_match:
        duration_match = re.search(r"por\s*(\d+)\s*dias", instruction_norm)
    if duration_match:
        duration_days = int(duration_match.group(1))
    else:
        duration_weeks = re.search(r"x\s*(\d+)\s*semanas", instruction_norm)
        if duration_weeks:
            duration_days = int(duration_weeks.group(1)) * 7

    frequency = ""
    dose_hint = ""
    dose_unit_match = re.search(
        r"(\d+)\s*(sobre|sobres|capsula|capsulas|comprimido|comprimidos|tableta|tabletas|cc|ml|gotas?)",
        instruction_norm,
    )
    if dose_unit_match:
        dose_hint = f"{dose_unit_match.group(1)} {dose_unit_match.group(2)}"

    freq_match = re.search(r"cada\s*(\d+)\s*horas", instruction_norm)
    if freq_match:
        frequency = f"cada {freq_match.group(1)} horas"
    elif re.search(r"\b1\s*al\s*dia\b", instruction_norm) or re.search(
        r"\b1\s*por\s*dia\b", instruction_norm
    ):
        frequency = "cada 24 horas"
    elif re.search(r"\bal\s*dia\b", instruction_norm):
        frequency = "cada 24 horas"

    notes = _clean_ocr_line(instruction_text)
    if not frequency and notes:
        notes = f"{notes} (frecuencia pendiente)"

    return {
        "name": name_candidate,
        "dose": dose or dose_hint,
        "frequency": frequency,
        "duration_days": duration_days,
        "notes": notes,
    }


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
    date_numeric_pattern = re.compile(r"\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b")
    time_pattern = re.compile(r"\b(\d{1,2})[:.](\d{2})\b")
    date_match = date_pattern.search(normalized)
    time_match = None
    citacion_date = None
    citacion_time = None
    for idx, (raw_line, norm_line) in enumerate(zip(raw_lines, normalized_lines)):
        if "fecha y hora citacion" in norm_line:
            for look_ahead in raw_lines[idx : idx + 4]:
                date_match_local = date_numeric_pattern.search(look_ahead)
                if date_match_local:
                    day = int(date_match_local.group(1))
                    month = int(date_match_local.group(2))
                    year = int(date_match_local.group(3))
                    if year < 100:
                        year += 2000
                    citacion_date = (year, month, day)
                else:
                    date_match_local = date_pattern.search(_normalize_text(look_ahead))
                    if date_match_local:
                        day = int(date_match_local.group(1))
                        month_name = date_match_local.group(2)
                        month = month_map.get(month_name)
                        year = int(date_match_local.group(3))
                        if month:
                            citacion_date = (year, month, day)
                time_match_local = time_pattern.search(look_ahead)
                if time_match_local:
                    citacion_time = (
                        int(time_match_local.group(1)),
                        int(time_match_local.group(2)),
                    )
                if citacion_date and citacion_time:
                    break
            break
    for raw_line, norm_line in zip(raw_lines, normalized_lines):
        if any(k in norm_line for k in ("hora", "hrs", "horario")):
            time_match = time_pattern.search(raw_line)
            if time_match:
                break
    if not time_match:
        time_match = time_pattern.search(text)
    if not date_match and not citacion_date:
        return None
    if citacion_date:
        year, month, day = citacion_date
    else:
        day = int(date_match.group(1))
        month_name = date_match.group(2)
        month = month_map.get(month_name)
        year = int(date_match.group(3))
        if not month:
            return None
    hour = 0
    minute = 0
    if citacion_time:
        hour, minute = citacion_time
    elif time_match:
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
    if not specialty:
        for line in lines:
            normalized_line = _normalize_text(line)
            if "toma de muestra" in normalized_line:
                specialty = "Toma de muestra"
                break
    if not specialty and "citacion" in normalized:
        specialty = "Citacion examen"

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

    def _binarize_image(img: Image.Image) -> Image.Image:
        return img.point(lambda x: 0 if x < 140 else 255)

    def _run_ocr(img: Image.Image, lang_value: str) -> list[str]:
        configs = ("--oem 3 --psm 6", "--oem 3 --psm 4", "--oem 3 --psm 11")
        results = []
        for config in configs:
            try:
                text = pytesseract.image_to_string(
                    img, lang=lang_value, config=config
                )
            except Exception:
                continue
            if text and text.strip():
                results.append(text)
        return results

    texts = []
    for img in images:
        img = _preprocess_image(img)
        bin_img = _binarize_image(img)
        try:
            ocr_texts = _run_ocr(img, lang)
            ocr_texts += _run_ocr(bin_img, lang)
            text = "\n".join(ocr_texts)
        except Exception:
            # Fallback to English if the language pack is missing.
            ocr_texts = _run_ocr(img, "eng")
            ocr_texts += _run_ocr(bin_img, "eng")
            text = "\n".join(ocr_texts)
        texts.append(text)
    return "\n".join(texts)


def _run_document_ocr(document_id: int):
    db = SessionLocal()
    try:
        detected_meds_for_email: list[dict] = []
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
                        doc.notes = f"Receta Electronica MINSAL\n{rut_info}"
                    elif "Receta Electronica" not in doc.notes:
                        doc.notes = (
                            f"Receta Electronica MINSAL\n{rut_info}\n\n{doc.notes}"
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
                    detected_meds_for_email.append(
                        {
                            "name": med.get("name") or "Medicamento",
                            "dose": med.get("dose") or "",
                            "frequency": med.get("frequency") or "",
                        }
                    )

                    # Agregar info detallada del medicamento a las notas del documento
                    # Para recetas electrónicas, usar el formato estructurado completo
                    if is_electronic and med.get("raw"):
                        med_summary = f"Detalle medicamento: {med.get('raw')}"
                    else:
                        med_summary = (
                            f"Medicamento: {med.get('name', 'Medicamento')}: "
                            f"{med.get('dose', '')} - {med.get('frequency', '')}"
                        )

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
        elif (
            not doc.appointment_id
            and doc.doc_type in (models.DocumentType.otro, models.DocumentType.informe)
        ):
            label_med = _extract_label_medication(text)
            if label_med:
                start_date = doc.date or datetime.now()
                end_date = None
                duration_days = label_med.get("duration_days")
                if duration_days:
                    end_date = start_date + timedelta(days=duration_days)
                duration_label = f"{duration_days} dias" if duration_days else ""

                medication = models.Medication(
                    user_id=doc.user_id,
                    name=label_med.get("name") or "Medicamento",
                    dose=label_med.get("dose") or "",
                    frequency=label_med.get("frequency") or "",
                    duration=duration_label,
                    end_date=end_date,
                    notes=label_med.get("notes") or "",
                )
                db.add(medication)
                db.flush()
                detected_meds_for_email.append(
                    {
                        "name": label_med.get("name") or "Medicamento",
                        "dose": label_med.get("dose") or "",
                        "frequency": label_med.get("frequency") or "",
                    }
                )

                # Eliminar el documento para mantenerlo solo como medicamento
                db.delete(doc)
                db.commit()
                user = db.query(models.User).filter(models.User.id == medication.user_id).first()
                if user and user.email:
                    _send_medications_detected_email_safe(
                        user.email,
                        user.name or "",
                        detected_meds_for_email,
                    )
                return
        elif (
            not doc.appointment_id
            and doc.doc_type in (models.DocumentType.otro, models.DocumentType.informe)
        ):
            normalized = _normalize_text(text)
            if any(
                k in normalized
                for k in ("ecografia", "ultrasonido", "radiografia", "examen")
            ) and "resultado" not in normalized:
                doc.doc_type = models.DocumentType.orden
                schedule = _extract_order_schedule(text) or {}
                date_time = schedule.get("date_time")
                specialty = schedule.get("specialty") or ""
                if not specialty:
                    if "ecografia" in normalized:
                        specialty = "Ecografia"
                    elif "ultrasonido" in normalized:
                        specialty = "Ultrasonido"
                    elif "radiografia" in normalized:
                        specialty = "Radiografia"
                if not specialty:
                    specialty = "Examen"
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

        user = db.query(models.User).filter(models.User.id == doc.user_id).first()
        db.commit()
        if user and user.email and detected_meds_for_email:
            _send_medications_detected_email_safe(
                user.email,
                user.name or "",
                detected_meds_for_email,
            )
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
        "email_provider": _email_provider(),
        "resend_configured": bool(os.getenv("RESEND_API_KEY")),
        "email_from_configured": bool(_mail_from_security() or _mail_from_notifications()),
        "privacy_target_configured": bool(
            os.getenv("EMAIL_TO_PRIVACY")
            or os.getenv("SUPPORT_EMAIL")
            or os.getenv("EMAIL_TO_SUPPORT")
            or os.getenv("SMTP_SUPPORT_TO")
            or os.getenv("SMTP_USER")
        ),
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


def _build_plan_info(user: models.User, db: Session) -> dict:
    plan_type = _normalize_plan_type(getattr(user, "plan_type", None))
    features = _plan_features(plan_type)
    return {
        "plan_type": plan_type,
        "max_profiles": int(features.get("max_profiles", 1)),
        "collaboration_enabled": bool(features.get("collaboration_enabled", False)),
        "family_panel_enabled": bool(features.get("family_panel_enabled", False)),
        "current_profiles": _count_owned_profiles(db, user.id),
    }


def _assert_collaboration_enabled(current_user: models.User):
    info = _plan_features(getattr(current_user, "plan_type", None))
    if not bool(info.get("collaboration_enabled", False)):
        raise HTTPException(
            status_code=403,
            detail="La colaboracion familiar esta disponible solo en el plan familiar",
        )


_DEFAULT_PROFILE_AUTOMATION_SETTINGS = {
    "smart_alerts_enabled": True,
    "medication_overdue_alerts": True,
    "upcoming_appointment_alerts": True,
    "inactivity_alerts": True,
    "weekly_family_report_enabled": False,
    "auto_email_caregivers": False,
}


def _profile_automation_settings(profile: models.HealthProfile) -> dict:
    raw = getattr(profile, "automation_settings_json", "") or ""
    if not raw:
        return dict(_DEFAULT_PROFILE_AUTOMATION_SETTINGS)
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return dict(_DEFAULT_PROFILE_AUTOMATION_SETTINGS)
    except Exception:
        return dict(_DEFAULT_PROFILE_AUTOMATION_SETTINGS)
    settings = dict(_DEFAULT_PROFILE_AUTOMATION_SETTINGS)
    for key in settings.keys():
        if key in parsed:
            settings[key] = bool(parsed.get(key))
    return settings


def _serialize_profile_automation_settings(settings: dict) -> str:
    normalized = dict(_DEFAULT_PROFILE_AUTOMATION_SETTINGS)
    for key in normalized.keys():
        if key in settings:
            normalized[key] = bool(settings.get(key))
    return json.dumps(normalized, ensure_ascii=False)


def _build_profile_report(
    db: Session,
    profile: models.HealthProfile,
    period_days: int,
) -> schemas.FamilyReportProfileOut:
    now = datetime.now()
    since = now - timedelta(days=period_days)
    meds_active = 0
    meds_completed = 0
    intakes = 0
    appts_total = 0
    appts_completed = 0
    appts_upcoming = 0
    docs_uploaded = 0
    adherence_rate = None

    # Compatibilidad actual: los registros clinicos siguen ligados al user_id.
    # Solo perfil primario tiene metricas completas hasta migrar entidades por profile_id.
    if profile.is_primary_profile:
        user_id = profile.owner_user_id
        meds_active = (
            db.query(models.Medication)
            .filter(
                models.Medication.user_id == user_id,
                models.Medication.completed.is_(False),
            )
            .count()
        )
        meds_completed = (
            db.query(models.Medication)
            .filter(
                models.Medication.user_id == user_id,
                models.Medication.completed.is_(True),
            )
            .count()
        )
        intakes = (
            db.query(models.MedicationIntake)
            .filter(
                models.MedicationIntake.user_id == user_id,
                models.MedicationIntake.taken_at >= since,
            )
            .count()
        )
        appts_total = (
            db.query(models.Appointment)
            .filter(
                models.Appointment.user_id == user_id,
                models.Appointment.created_at >= since,
            )
            .count()
        )
        appts_completed = (
            db.query(models.Appointment)
            .filter(
                models.Appointment.user_id == user_id,
                models.Appointment.status == models.AppointmentStatus.realizada,
            )
            .count()
        )
        appts_upcoming = (
            db.query(models.Appointment)
            .filter(
                models.Appointment.user_id == user_id,
                models.Appointment.date_time.isnot(None),
                models.Appointment.date_time >= now,
                models.Appointment.status != models.AppointmentStatus.realizada,
            )
            .count()
        )
        docs_uploaded = (
            db.query(models.Document)
            .filter(
                models.Document.user_id == user_id,
                models.Document.created_at >= since,
            )
            .count()
        )

        all_meds = db.query(models.Medication).filter(models.Medication.user_id == user_id).all()
        if all_meds:
            _attach_medication_adherence(db, all_meds, models.User(id=user_id))
            valid_rates = [float(m.adherence_rate) for m in all_meds if m.adherence_rate is not None]
            if valid_rates:
                adherence_rate = round(sum(valid_rates) / len(valid_rates), 1)

    return schemas.FamilyReportProfileOut(
        profile_id=profile.id,
        profile_name=profile.full_name,
        medications_active=meds_active,
        medications_completed=meds_completed,
        intakes_recorded=intakes,
        appointments_total=appts_total,
        appointments_completed=appts_completed,
        appointments_upcoming=appts_upcoming,
        documents_uploaded=docs_uploaded,
        adherence_rate=adherence_rate,
    )


def _generate_smart_alerts_for_profile(
    db: Session,
    profile: models.HealthProfile,
    viewer_user: models.User,
) -> list[schemas.FamilyAlertOut]:
    settings = _profile_automation_settings(profile)
    if not settings.get("smart_alerts_enabled", True):
        return []

    alerts: list[schemas.FamilyAlertOut] = []
    now = datetime.now()
    base_id = f"profile-{profile.id}-{int(now.timestamp())}"

    if not profile.is_primary_profile:
        alerts.append(
            schemas.FamilyAlertOut(
                id=f"{base_id}-migration",
                profile_id=profile.id,
                profile_name=profile.full_name,
                severity="info",
                category="coverage",
                title="Cobertura clinica parcial",
                message="Este perfil aun no tiene citas/medicamentos/documentos dedicados por profile_id.",
                suggested_action="Migrar registros clinicos a perfil familiar en una siguiente fase",
                generated_at=now,
            )
        )
        return alerts

    user_id = profile.owner_user_id
    if settings.get("upcoming_appointment_alerts", True):
        upcoming = (
            db.query(models.Appointment)
            .filter(
                models.Appointment.user_id == user_id,
                models.Appointment.date_time.isnot(None),
                models.Appointment.date_time >= now,
                models.Appointment.date_time <= (now + timedelta(hours=24)),
                models.Appointment.status != models.AppointmentStatus.realizada,
            )
            .order_by(models.Appointment.date_time.asc())
            .first()
        )
        if upcoming:
            alerts.append(
                schemas.FamilyAlertOut(
                    id=f"{base_id}-appt-{upcoming.id}",
                    profile_id=profile.id,
                    profile_name=profile.full_name,
                    severity="high",
                    category="appointment",
                    title="Cita proxima en menos de 24 horas",
                    message=(
                        f"{upcoming.specialty or 'Atencion medica'} en "
                        f"{upcoming.center or 'Centro de salud'}"
                    ),
                    suggested_action="Confirmar asistencia y documentos necesarios",
                    generated_at=now,
                )
            )

    if settings.get("medication_overdue_alerts", True):
        meds = (
            db.query(models.Medication)
            .filter(
                models.Medication.user_id == user_id,
                models.Medication.completed.is_(False),
            )
            .all()
        )
        meds = _attach_medication_adherence(db, meds, viewer_user)
        risky = [m for m in meds if (getattr(m, "adherence_rate", 100) or 100) < 80]
        if risky:
            top = sorted(risky, key=lambda m: (m.adherence_rate or 0))[0]
            alerts.append(
                schemas.FamilyAlertOut(
                    id=f"{base_id}-med-{top.id}",
                    profile_id=profile.id,
                    profile_name=profile.full_name,
                    severity="medium",
                    category="medication",
                    title="Adherencia baja en medicamentos",
                    message=(
                        f"{top.name}: adherencia {top.adherence_rate or 0}% "
                        f"(faltantes: {getattr(top, 'missed_doses', 0)})"
                    ),
                    suggested_action="Contactar al paciente y ajustar recordatorios",
                    generated_at=now,
                )
            )

    if settings.get("inactivity_alerts", True):
        last_doc = (
            db.query(models.Document)
            .filter(models.Document.user_id == user_id)
            .order_by(models.Document.created_at.desc())
            .first()
        )
        if not last_doc or ((now - (last_doc.created_at or now)).days >= 45):
            alerts.append(
                schemas.FamilyAlertOut(
                    id=f"{base_id}-inactive-docs",
                    profile_id=profile.id,
                    profile_name=profile.full_name,
                    severity="low",
                    category="inactivity",
                    title="Sin actualizacion de documentos reciente",
                    message="No se registran documentos recientes para este perfil.",
                    suggested_action="Subir ordenes, recetas o resultados nuevos",
                    generated_at=now,
                )
            )

    return alerts


def _profile_out(profile: models.HealthProfile, link: models.ProfileRelationship | None = None):
    return schemas.HealthProfileOut(
        id=profile.id,
        owner_user_id=profile.owner_user_id,
        full_name=profile.full_name,
        birth_date=profile.birth_date,
        gender=profile.gender or "",
        relation_with_owner=profile.relation_with_owner or "",
        avatar_url=profile.avatar_url or "",
        base_medical_data=profile.base_medical_data or "",
        is_primary_profile=bool(profile.is_primary_profile),
        is_archived=bool(profile.is_archived),
        created_by_user_id=profile.created_by_user_id,
        created_at=profile.created_at,
        access_role=(link.role if link else None),
        access_status=(link.status if link else None),
        relationship_type=(link.relationship_type if link else None),
    )


def _relationship_out(link: models.ProfileRelationship):
    user = link.user
    return schemas.ProfileRelationshipOut(
        id=link.id,
        profile_id=link.profile_id,
        user_id=link.user_id,
        user_name=(user.name if user else ""),
        user_email=(user.email if user else ""),
        relationship_type=link.relationship_type or "",
        role=link.role or "viewer",
        status=link.status or "accepted",
        invited_at=link.invited_at,
        accepted_at=link.accepted_at,
        created_at=link.created_at,
    )


def _profile_note_out(item: models.ProfileNote):
    author = item.created_by_user
    return schemas.ProfileNoteOut(
        id=item.id,
        profile_id=item.profile_id,
        created_by_user_id=item.created_by_user_id,
        created_by_name=(author.name if author else ""),
        note=item.note,
        visibility=item.visibility or "shared",
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _get_profile_access_or_404(
    db: Session,
    current_user: models.User,
    profile_id: int,
) -> tuple[models.HealthProfile, models.ProfileRelationship]:
    link = (
        db.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.profile_id == profile_id,
            models.ProfileRelationship.user_id == current_user.id,
            models.ProfileRelationship.status == "accepted",
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Perfil de salud no encontrado")

    profile = (
        db.query(models.HealthProfile)
        .filter(
            models.HealthProfile.id == profile_id,
            models.HealthProfile.is_archived.is_(False),
        )
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil de salud no encontrado")

    return profile, link


def _require_role(link: models.ProfileRelationship, min_role: str = "admin"):
    got = ROLE_LEVELS.get((link.role or "").strip().lower(), 0)
    needed = ROLE_LEVELS.get(min_role.strip().lower(), 3)
    if got < needed:
        raise HTTPException(status_code=403, detail="No tienes permisos para esta accion")


def _assert_profile_creation_allowed(db: Session, current_user: models.User):
    plan_info = _build_plan_info(current_user, db)
    if plan_info["current_profiles"] >= plan_info["max_profiles"]:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Tu plan {plan_info['plan_type']} permite hasta "
                f"{plan_info['max_profiles']} perfiles de salud"
            ),
        )


def _log_profile_activity(
    db: Session,
    profile_id: int,
    actor_user_id: int,
    action_type: str,
    description: str,
    metadata_json: dict | None = None,
):
    log = models.ProfileActivityLog(
        profile_id=profile_id,
        performed_by_user_id=actor_user_id,
        action_type=action_type,
        description=description,
        metadata_json=metadata_json or {},
    )
    db.add(log)


# Auth endpoints
@app.post("/auth/register", response_model=schemas.UserOut)
def register(
    user_in: schemas.UserCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth.get_db),
):
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
        primary = _create_primary_health_profile_if_missing(db, user)
        _ensure_profile_link(
            db,
            profile_id=primary.id,
            user_id=user.id,
            role="admin",
            relationship_type="self",
        )
        user.active_health_profile_id = primary.id
        db.add(user)
        db.commit()
        db.refresh(user)
        if user.email:
            background_tasks.add_task(_send_welcome_email_safe, user.email, user.name or "")
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
        data={"sub": str(user.id), "tv": int(getattr(user, "token_version", 0) or 0)},
        expires_delta=access_token_expires,
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/auth/forgot-password")
def forgot_password(
    payload: schemas.ForgotPasswordIn,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth.get_db),
):
    config_errors = _password_reset_config_errors()
    if config_errors:
        raise HTTPException(
            status_code=503,
            detail=_email_config_error_detail(config_errors),
        )

    email = payload.email.lower().strip()
    user = auth.get_user_by_email(db, email)
    if not user or getattr(user, "deleted", False):
        return {"ok": True}

    db.query(models.PasswordResetToken).filter(
        models.PasswordResetToken.user_id == user.id,
        models.PasswordResetToken.used.is_(False),
    ).update({models.PasswordResetToken.used: True})

    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = datetime.utcnow() + timedelta(hours=1)
    reset = models.PasswordResetToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
        used=False,
    )
    db.add(reset)
    db.commit()

    reset_url = _build_reset_url(request, raw_token)
    background_tasks.add_task(_send_reset_email_safe, user.email, reset_url)

    return {"ok": True}


@app.post("/auth/reset-password")
def reset_password(payload: schemas.ResetPasswordIn, db: Session = Depends(auth.get_db)):
    new_password = payload.new_password.strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="La contrasena debe tener al menos 6 caracteres")

    token_hash = _hash_token(payload.token)
    token = (
        db.query(models.PasswordResetToken)
        .filter(
            models.PasswordResetToken.token_hash == token_hash,
            models.PasswordResetToken.used.is_(False),
            models.PasswordResetToken.expires_at > datetime.utcnow(),
        )
        .first()
    )
    if not token:
        raise HTTPException(status_code=400, detail="Token invalido o expirado")

    user = db.query(models.User).filter(models.User.id == token.user_id).first()
    if not user or getattr(user, "deleted", False):
        raise HTTPException(status_code=400, detail="Usuario no valido")

    user.password_hash = auth.get_password_hash(new_password)
    user.token_version = int(getattr(user, "token_version", 0) or 0) + 1
    token.used = True
    db.add(user)
    db.add(token)
    db.commit()

    return {"ok": True}


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

    if payload.notifications_consent is not None:
        current_user.notifications_consent = payload.notifications_consent

    if payload.notifications_last_prompt is not None:
        current_user.notifications_last_prompt = payload.notifications_last_prompt

    if payload.data_consent_revoked is not None:
        current_user.data_consent_revoked = payload.data_consent_revoked

    if payload.chronic_condition is not None:
        current_user.chronic_condition = payload.chronic_condition

    if payload.primary_care_center is not None:
        current_user.primary_care_center = payload.primary_care_center

    if payload.reminder_preferred_time is not None:
        current_user.reminder_preferred_time = payload.reminder_preferred_time

    if payload.email_reminders_enabled is not None:
        current_user.email_reminders_enabled = payload.email_reminders_enabled

    if payload.notification_settings_json is not None:
        current_user.notification_settings_json = payload.notification_settings_json

    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user


@app.get("/plans/me", response_model=schemas.PlanInfoOut)
async def read_my_plan(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return _build_plan_info(current_user, db)


@app.get("/health-profiles", response_model=List[schemas.HealthProfileOut])
async def list_health_profiles(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    links = (
        db.query(models.ProfileRelationship)
        .join(
            models.HealthProfile,
            models.HealthProfile.id == models.ProfileRelationship.profile_id,
        )
        .filter(
            models.ProfileRelationship.user_id == current_user.id,
            models.ProfileRelationship.status == "accepted",
            models.HealthProfile.is_archived.is_(False),
        )
        .order_by(
            models.HealthProfile.is_primary_profile.desc(),
            models.HealthProfile.full_name.asc(),
        )
        .all()
    )
    return [_profile_out(link.profile, link) for link in links if link.profile]


@app.get("/health-profiles/active", response_model=schemas.HealthProfileOut)
async def get_active_health_profile(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    active_id = getattr(current_user, "active_health_profile_id", None)
    if active_id:
        profile, link = _get_profile_access_or_404(db, current_user, int(active_id))
        return _profile_out(profile, link)

    links = (
        db.query(models.ProfileRelationship)
        .join(
            models.HealthProfile,
            models.HealthProfile.id == models.ProfileRelationship.profile_id,
        )
        .filter(
            models.ProfileRelationship.user_id == current_user.id,
            models.ProfileRelationship.status == "accepted",
            models.HealthProfile.is_archived.is_(False),
        )
        .order_by(
            models.HealthProfile.is_primary_profile.desc(),
            models.HealthProfile.created_at.asc(),
        )
        .all()
    )
    if not links:
        raise HTTPException(status_code=404, detail="No tienes perfiles de salud disponibles")

    active_link = links[0]
    current_user.active_health_profile_id = active_link.profile_id
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return _profile_out(active_link.profile, active_link)


@app.post("/health-profiles", response_model=schemas.HealthProfileOut)
async def create_health_profile(
    payload: schemas.HealthProfileCreate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _assert_profile_creation_allowed(db, current_user)

    profile = models.HealthProfile(
        owner_user_id=current_user.id,
        full_name=(payload.full_name or "").strip(),
        birth_date=payload.birth_date,
        gender=(payload.gender or "").strip(),
        relation_with_owner=(payload.relation_with_owner or "").strip(),
        avatar_url=(payload.avatar_url or "").strip(),
        base_medical_data=(payload.base_medical_data or "").strip(),
        is_primary_profile=False,
        is_archived=False,
        created_by_user_id=current_user.id,
    )
    if not profile.full_name:
        raise HTTPException(status_code=400, detail="Nombre del perfil es obligatorio")

    db.add(profile)
    db.flush()
    link = _ensure_profile_link(
        db,
        profile_id=profile.id,
        user_id=current_user.id,
        role="admin",
        relationship_type=payload.relation_with_owner or "asistido",
    )
    _log_profile_activity(
        db,
        profile_id=profile.id,
        actor_user_id=current_user.id,
        action_type="profile_created",
        description=f"{current_user.name or current_user.email} creo el perfil {profile.full_name}",
        metadata_json={"full_name": profile.full_name},
    )

    db.commit()
    db.refresh(profile)
    return _profile_out(profile, link)


@app.get("/health-profiles/{profile_id}", response_model=schemas.HealthProfileOut)
async def get_health_profile(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, link = _get_profile_access_or_404(db, current_user, profile_id)
    return _profile_out(profile, link)


@app.put("/health-profiles/{profile_id}", response_model=schemas.HealthProfileOut)
async def update_health_profile(
    profile_id: int,
    payload: schemas.HealthProfileUpdate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(link, "admin")

    for field, value in payload.dict(exclude_unset=True).items():
        setattr(profile, field, value)

    if not (profile.full_name or "").strip():
        raise HTTPException(status_code=400, detail="Nombre del perfil es obligatorio")

    profile.full_name = profile.full_name.strip()
    _log_profile_activity(
        db,
        profile_id=profile.id,
        actor_user_id=current_user.id,
        action_type="profile_updated",
        description=f"{current_user.name or current_user.email} actualizo el perfil {profile.full_name}",
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return _profile_out(profile, link)


@app.post("/health-profiles/{profile_id}/set-active", response_model=schemas.HealthProfileOut)
async def set_active_health_profile(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, link = _get_profile_access_or_404(db, current_user, profile_id)
    current_user.active_health_profile_id = profile.id
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return _profile_out(profile, link)


@app.get("/health-profiles/{profile_id}/activity")
async def get_health_profile_activity(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _, _ = _get_profile_access_or_404(db, current_user, profile_id)
    logs = (
        db.query(models.ProfileActivityLog)
        .filter(models.ProfileActivityLog.profile_id == profile_id)
        .order_by(models.ProfileActivityLog.created_at.desc())
        .limit(100)
        .all()
    )
    return [
        {
            "id": item.id,
            "profile_id": item.profile_id,
            "performed_by_user_id": item.performed_by_user_id,
            "action_type": item.action_type,
            "description": item.description,
            "metadata": item.metadata_json or {},
            "created_at": item.created_at.strftime("%Y-%m-%dT%H:%M:%S") if item.created_at else None,
        }
        for item in logs
    ]


@app.get("/family/panel", response_model=List[schemas.FamilyPanelCardOut])
async def family_panel(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    links = (
        db.query(models.ProfileRelationship)
        .join(
            models.HealthProfile,
            models.HealthProfile.id == models.ProfileRelationship.profile_id,
        )
        .filter(
            models.ProfileRelationship.user_id == current_user.id,
            models.ProfileRelationship.status == "accepted",
            models.HealthProfile.is_archived.is_(False),
        )
        .order_by(
            models.HealthProfile.is_primary_profile.desc(),
            models.HealthProfile.full_name.asc(),
        )
        .all()
    )

    now = datetime.now()
    cards: list[schemas.FamilyPanelCardOut] = []
    for link in links:
        profile = link.profile
        if not profile:
            continue
        age_years = None
        if profile.birth_date:
            age_years = max(0, (now.date() - profile.birth_date.date()).days // 365)

        caregivers_count = (
            db.query(models.ProfileRelationship)
            .filter(
                models.ProfileRelationship.profile_id == profile.id,
                models.ProfileRelationship.status == "accepted",
            )
            .count()
        )

        medications_active = 0
        reminders_pending = 0
        next_appointment = None
        # Compatibilidad Fase 1/2: mientras citas/meds sigan por user_id, se usa el perfil principal.
        if profile.is_primary_profile:
            medications_active = (
                db.query(models.Medication)
                .filter(
                    models.Medication.user_id == profile.owner_user_id,
                    models.Medication.completed.is_(False),
                )
                .count()
            )
            reminders_pending = medications_active
            next_appointment = (
                db.query(models.Appointment)
                .filter(
                    models.Appointment.user_id == profile.owner_user_id,
                    models.Appointment.date_time.isnot(None),
                    models.Appointment.date_time >= now,
                )
                .order_by(models.Appointment.date_time.asc())
                .first()
            )

        cards.append(
            schemas.FamilyPanelCardOut(
                profile_id=profile.id,
                name=profile.full_name,
                relationship=profile.relation_with_owner or link.relationship_type or "",
                age_years=age_years,
                medications_active=medications_active,
                next_appointment_at=(next_appointment.date_time if next_appointment else None),
                next_appointment_center=(next_appointment.center if next_appointment else ""),
                reminders_pending=reminders_pending,
                caregivers_count=caregivers_count,
                access_role=link.role or "",
            )
        )
    return cards


@app.get("/health-profiles/{profile_id}/caregivers", response_model=List[schemas.ProfileRelationshipOut])
async def list_profile_caregivers(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _, _ = _get_profile_access_or_404(db, current_user, profile_id)
    links = (
        db.query(models.ProfileRelationship)
        .filter(models.ProfileRelationship.profile_id == profile_id)
        .order_by(models.ProfileRelationship.created_at.asc())
        .all()
    )
    return [_relationship_out(link) for link in links]


@app.post("/health-profiles/{profile_id}/invitations", response_model=schemas.ProfileInvitationOut)
async def create_profile_invitation(
    profile_id: int,
    payload: schemas.ProfileInvitationCreate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _assert_collaboration_enabled(current_user)
    profile, access_link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(access_link, "admin")

    role = _normalize_role(payload.role)
    invitee_email = payload.email.lower().strip()
    if not invitee_email:
        raise HTTPException(status_code=400, detail="Email de invitacion es obligatorio")

    existing_user = (
        db.query(models.User)
        .filter(func.lower(models.User.email) == invitee_email)
        .first()
    )
    now = datetime.utcnow()

    if existing_user:
        existing_link = (
            db.query(models.ProfileRelationship)
            .filter(
                models.ProfileRelationship.profile_id == profile_id,
                models.ProfileRelationship.user_id == existing_user.id,
            )
            .first()
        )
        if existing_link and existing_link.status == "accepted":
            raise HTTPException(status_code=409, detail="Ese usuario ya tiene acceso al perfil")

        if existing_link:
            existing_link.status = "accepted"
            existing_link.role = role
            existing_link.relationship_type = payload.relationship_type or existing_link.relationship_type
            existing_link.accepted_at = now
            existing_link.invited_at = existing_link.invited_at or now
            db.add(existing_link)
            relationship_id = existing_link.id
        else:
            link = models.ProfileRelationship(
                profile_id=profile_id,
                user_id=existing_user.id,
                relationship_type=payload.relationship_type or "",
                role=role,
                status="accepted",
                invited_at=now,
                accepted_at=now,
            )
            db.add(link)
            db.flush()
            relationship_id = link.id

        invitation = models.ProfileInvitation(
            profile_id=profile_id,
            inviter_user_id=current_user.id,
            invitee_email=invitee_email,
            role=role,
            relationship_type=payload.relationship_type or "",
            status="accepted",
            token=secrets.token_urlsafe(24),
            accepted_by_user_id=existing_user.id,
            invited_at=now,
            accepted_at=now,
        )
        db.add(invitation)
        _log_profile_activity(
            db,
            profile_id=profile_id,
            actor_user_id=current_user.id,
            action_type="caregiver_added",
            description=f"{current_user.name or current_user.email} agrego colaborador {invitee_email} como {role}",
            metadata_json={"role": role, "email": invitee_email, "relationship_id": relationship_id},
        )
        db.commit()
        db.refresh(invitation)
        return invitation

    pending = (
        db.query(models.ProfileInvitation)
        .filter(
            models.ProfileInvitation.profile_id == profile_id,
            models.ProfileInvitation.invitee_email == invitee_email,
            models.ProfileInvitation.status == "pending",
        )
        .first()
    )
    if pending:
        return pending

    invitation = models.ProfileInvitation(
        profile_id=profile_id,
        inviter_user_id=current_user.id,
        invitee_email=invitee_email,
        role=role,
        relationship_type=payload.relationship_type or "",
        status="pending",
        token=secrets.token_urlsafe(24),
        invited_at=now,
    )
    db.add(invitation)
    _log_profile_activity(
        db,
        profile_id=profile_id,
        actor_user_id=current_user.id,
        action_type="invitation_created",
        description=f"{current_user.name or current_user.email} invito a {invitee_email} como {role}",
        metadata_json={"role": role, "email": invitee_email},
    )
    db.commit()
    db.refresh(invitation)
    return invitation


@app.get("/health-profiles/{profile_id}/invitations", response_model=List[schemas.ProfileInvitationOut])
async def list_profile_invitations(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _assert_collaboration_enabled(current_user)
    _, access_link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(access_link, "admin")
    invitations = (
        db.query(models.ProfileInvitation)
        .filter(models.ProfileInvitation.profile_id == profile_id)
        .order_by(models.ProfileInvitation.invited_at.desc())
        .all()
    )
    return invitations


@app.post("/health-profiles/invitations/accept", response_model=schemas.ProfileRelationshipOut)
async def accept_profile_invitation(
    payload: schemas.ProfileInvitationAcceptIn,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token de invitacion requerido")

    invitation = (
        db.query(models.ProfileInvitation)
        .filter(models.ProfileInvitation.token == token)
        .first()
    )
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitacion no encontrada")
    if invitation.status != "pending":
        raise HTTPException(status_code=400, detail="Invitacion ya no esta disponible")

    if (current_user.email or "").strip().lower() != (invitation.invitee_email or "").strip().lower():
        raise HTTPException(status_code=403, detail="Esta invitacion no corresponde a tu cuenta")

    profile = (
        db.query(models.HealthProfile)
        .filter(
            models.HealthProfile.id == invitation.profile_id,
            models.HealthProfile.is_archived.is_(False),
        )
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil de salud no disponible")

    role = _normalize_role(invitation.role)
    now = datetime.utcnow()
    link = (
        db.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.profile_id == invitation.profile_id,
            models.ProfileRelationship.user_id == current_user.id,
        )
        .first()
    )
    if link:
        link.status = "accepted"
        link.role = role
        link.relationship_type = invitation.relationship_type or link.relationship_type
        link.accepted_at = now
        link.invited_at = link.invited_at or invitation.invited_at or now
    else:
        link = models.ProfileRelationship(
            profile_id=invitation.profile_id,
            user_id=current_user.id,
            relationship_type=invitation.relationship_type or "",
            role=role,
            status="accepted",
            invited_at=invitation.invited_at or now,
            accepted_at=now,
        )
        db.add(link)
        db.flush()

    invitation.status = "accepted"
    invitation.accepted_by_user_id = current_user.id
    invitation.accepted_at = now
    db.add(invitation)

    if not getattr(current_user, "active_health_profile_id", None):
        current_user.active_health_profile_id = invitation.profile_id
    db.add(current_user)
    _log_profile_activity(
        db,
        profile_id=invitation.profile_id,
        actor_user_id=current_user.id,
        action_type="invitation_accepted",
        description=f"{current_user.name or current_user.email} acepto invitacion como {role}",
        metadata_json={"role": role, "email": current_user.email},
    )
    db.commit()
    db.refresh(link)
    return _relationship_out(link)


@app.put("/health-profiles/{profile_id}/relationships/{relationship_id}", response_model=schemas.ProfileRelationshipOut)
async def update_profile_relationship(
    profile_id: int,
    relationship_id: int,
    payload: schemas.ProfileRoleUpdateIn,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _assert_collaboration_enabled(current_user)
    _, access_link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(access_link, "admin")

    link = (
        db.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.id == relationship_id,
            models.ProfileRelationship.profile_id == profile_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Relacion no encontrada")

    if link.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="No puedes cambiar tu propio rol desde esta accion")

    role = _normalize_role(payload.role)
    link.role = role
    if payload.relationship_type is not None:
        link.relationship_type = payload.relationship_type
    db.add(link)
    _log_profile_activity(
        db,
        profile_id=profile_id,
        actor_user_id=current_user.id,
        action_type="caregiver_role_updated",
        description=f"{current_user.name or current_user.email} actualizo rol de colaborador a {role}",
        metadata_json={"relationship_id": relationship_id, "role": role},
    )
    db.commit()
    db.refresh(link)
    return _relationship_out(link)


@app.delete("/health-profiles/{profile_id}/relationships/{relationship_id}")
async def remove_profile_relationship(
    profile_id: int,
    relationship_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _assert_collaboration_enabled(current_user)
    _, access_link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(access_link, "admin")

    link = (
        db.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.id == relationship_id,
            models.ProfileRelationship.profile_id == profile_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Relacion no encontrada")
    if link.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propio acceso administrador")

    email = link.user.email if link.user else ""
    db.delete(link)
    _log_profile_activity(
        db,
        profile_id=profile_id,
        actor_user_id=current_user.id,
        action_type="caregiver_removed",
        description=f"{current_user.name or current_user.email} removio colaborador {email or link.user_id}",
        metadata_json={"relationship_id": relationship_id, "email": email},
    )
    db.commit()
    return {"ok": True}


@app.delete("/health-profiles/{profile_id}/invitations/{invitation_id}")
async def revoke_profile_invitation(
    profile_id: int,
    invitation_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _assert_collaboration_enabled(current_user)
    _, access_link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(access_link, "admin")

    invitation = (
        db.query(models.ProfileInvitation)
        .filter(
            models.ProfileInvitation.id == invitation_id,
            models.ProfileInvitation.profile_id == profile_id,
        )
        .first()
    )
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitacion no encontrada")
    if invitation.status != "pending":
        raise HTTPException(status_code=400, detail="Solo invitaciones pendientes pueden revocarse")

    invitation.status = "revoked"
    invitation.revoked_at = datetime.utcnow()
    db.add(invitation)
    _log_profile_activity(
        db,
        profile_id=profile_id,
        actor_user_id=current_user.id,
        action_type="invitation_revoked",
        description=f"{current_user.name or current_user.email} revoco invitacion a {invitation.invitee_email}",
        metadata_json={"invitation_id": invitation_id, "email": invitation.invitee_email},
    )
    db.commit()
    db.refresh(invitation)
    return {"ok": True}


@app.get("/family/alerts", response_model=List[schemas.FamilyAlertOut])
async def family_smart_alerts(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    links = (
        db.query(models.ProfileRelationship)
        .join(
            models.HealthProfile,
            models.HealthProfile.id == models.ProfileRelationship.profile_id,
        )
        .filter(
            models.ProfileRelationship.user_id == current_user.id,
            models.ProfileRelationship.status == "accepted",
            models.HealthProfile.is_archived.is_(False),
        )
        .all()
    )
    result: list[schemas.FamilyAlertOut] = []
    for link in links:
        profile = link.profile
        if not profile:
            continue
        result.extend(_generate_smart_alerts_for_profile(db, profile, current_user))

    # Ordenar por severidad y fecha
    priority = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    result.sort(key=lambda x: (priority.get(x.severity, 99), x.generated_at), reverse=False)
    return result


@app.get("/family/reports/summary", response_model=schemas.FamilyReportOut)
async def family_report_summary(
    days: int = 30,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    period_days = max(1, min(int(days or 30), 365))
    links = (
        db.query(models.ProfileRelationship)
        .join(
            models.HealthProfile,
            models.HealthProfile.id == models.ProfileRelationship.profile_id,
        )
        .filter(
            models.ProfileRelationship.user_id == current_user.id,
            models.ProfileRelationship.status == "accepted",
            models.HealthProfile.is_archived.is_(False),
        )
        .all()
    )
    profiles_report = []
    for link in links:
        profile = link.profile
        if not profile:
            continue
        profiles_report.append(_build_profile_report(db, profile, period_days))

    totals = {
        "profiles": len(profiles_report),
        "medications_active": sum(int(p.medications_active or 0) for p in profiles_report),
        "appointments_total": sum(int(p.appointments_total or 0) for p in profiles_report),
        "appointments_upcoming": sum(int(p.appointments_upcoming or 0) for p in profiles_report),
        "documents_uploaded": sum(int(p.documents_uploaded or 0) for p in profiles_report),
    }
    return schemas.FamilyReportOut(
        generated_at=datetime.utcnow(),
        period_days=period_days,
        totals=totals,
        profiles=profiles_report,
    )


@app.get("/health-profiles/{profile_id}/automation", response_model=schemas.ProfileAutomationSettingsOut)
async def get_profile_automation_settings(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, _ = _get_profile_access_or_404(db, current_user, profile_id)
    settings = _profile_automation_settings(profile)
    return schemas.ProfileAutomationSettingsOut(**settings)


@app.put("/health-profiles/{profile_id}/automation", response_model=schemas.ProfileAutomationSettingsOut)
async def update_profile_automation_settings(
    profile_id: int,
    payload: schemas.ProfileAutomationSettingsIn,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(link, "caregiver")
    current = _profile_automation_settings(profile)
    for key, value in payload.dict(exclude_unset=True).items():
        if value is not None:
            current[key] = bool(value)

    profile.automation_settings_json = _serialize_profile_automation_settings(current)
    db.add(profile)
    _log_profile_activity(
        db,
        profile_id=profile_id,
        actor_user_id=current_user.id,
        action_type="automation_updated",
        description=f"{current_user.name or current_user.email} actualizo automatizaciones del perfil",
        metadata_json=current,
    )
    db.commit()
    db.refresh(profile)
    return schemas.ProfileAutomationSettingsOut(**_profile_automation_settings(profile))


@app.post("/family/automations/run")
async def run_family_automations(
    send_email: bool = False,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    alerts = await family_smart_alerts(db=db, current_user=current_user)
    report = await family_report_summary(days=7, db=db, current_user=current_user)
    executed = {
        "alerts_generated": len(alerts),
        "report_profiles": len(report.profiles),
        "emails_sent": 0,
    }

    if send_email and current_user.email:
        can_send = bool(getattr(current_user, "email_reminders_enabled", False))
        if can_send:
            _send_family_report_email_safe(
                current_user.email,
                current_user.name or "",
                {
                    "period_days": report.period_days,
                    "totals": report.totals,
                    "profiles": [p.model_dump() for p in report.profiles],
                },
            )
            executed["emails_sent"] = 1
    return {
        "ok": True,
        "executed": executed,
        "alerts_preview": [a.model_dump() for a in alerts[:10]],
    }


@app.get("/health-profiles/{profile_id}/notes", response_model=List[schemas.ProfileNoteOut])
async def list_profile_notes(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _, _ = _get_profile_access_or_404(db, current_user, profile_id)
    notes = (
        db.query(models.ProfileNote)
        .filter(models.ProfileNote.profile_id == profile_id)
        .order_by(models.ProfileNote.created_at.desc())
        .limit(200)
        .all()
    )
    return [_profile_note_out(item) for item in notes]


@app.post("/health-profiles/{profile_id}/notes", response_model=schemas.ProfileNoteOut)
async def create_profile_note(
    profile_id: int,
    payload: schemas.ProfileNoteCreate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _, link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(link, "caregiver")
    note_text = (payload.note or "").strip()
    if not note_text:
        raise HTTPException(status_code=400, detail="La nota no puede estar vacia")

    item = models.ProfileNote(
        profile_id=profile_id,
        created_by_user_id=current_user.id,
        note=note_text,
        visibility=(payload.visibility or "shared").strip() or "shared",
    )
    db.add(item)
    _log_profile_activity(
        db,
        profile_id=profile_id,
        actor_user_id=current_user.id,
        action_type="note_added",
        description=f"{current_user.name or current_user.email} agrego una nota colaborativa",
        metadata_json={"visibility": item.visibility},
    )
    db.commit()
    db.refresh(item)
    return _profile_note_out(item)


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
    background_tasks: BackgroundTasks,
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
    if current_user.email:
        background_tasks.add_task(
            _send_appointment_confirmation_email_safe,
            current_user.email,
            current_user.name or "",
            {
                "center": appt.center or "",
                "specialty": appt.specialty or appt.type.value,
                "date_label": appt.date_time.strftime("%d/%m/%Y %H:%M") if appt.date_time else "Pendiente",
                "notes": appt.notes or "",
            },
        )
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
    medications = (
        db.query(models.Medication)
        .filter(models.Medication.user_id == current_user.id)
        .order_by(models.Medication.created_at.desc())
        .all()
    )
    return _attach_medication_adherence(db, medications, current_user)


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
        _attach_medication_adherence(db, [med], current_user)
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
    _attach_medication_adherence(db, [med], current_user)
    return med


@app.post("/medications/{medication_id}/intake", response_model=schemas.MedicationIntakeOut)
async def record_medication_intake(
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

    intake = models.MedicationIntake(
        user_id=current_user.id,
        medication_id=medication_id,
    )
    db.add(intake)
    db.commit()
    db.refresh(intake)
    return intake


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
    db.query(models.MedicationIntake).filter(
        models.MedicationIntake.medication_id == medication_id,
        models.MedicationIntake.user_id == current_user.id,
    ).delete()
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
        raise HTTPException(status_code=400, detail="Suscripci??n incompleta")

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
    Verificar si el usuario tiene una suscripci??n push activa
    """
    subscriptions = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == current_user.id)
        .order_by(models.PushSubscription.created_at.desc())
        .all()
    )
    latest = subscriptions[0] if subscriptions else None
    return {
        "enabled": bool(subscriptions),
        "count": len(subscriptions),
        "subscription_id": latest.id if latest else None,
        "created_at": latest.created_at if latest else None,
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
    subscriptions = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == current_user.id)
        .order_by(models.PushSubscription.created_at.desc())
        .all()
    )
    if not subscriptions:
        raise HTTPException(
            status_code=404, detail="No hay suscripci??n push para el usuario"
        )
    ok = False
    for sub in subscriptions:
        ok = send_web_push(
            sub,
            {
                "title": "Prueba de notificaciones",
                "body": "Notificaci??n push de prueba",
                "url": "/",
                "priority": "normal",
                "sound": "default",
                "userId": current_user.id,
            },
        ) or ok
    return {"ok": ok}


@app.post("/push/send-reminders")
async def send_reminders(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Enviar recordatorios push para citas pr??ximas
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

    subscriptions = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == current_user.id)
        .order_by(models.PushSubscription.created_at.desc())
        .all()
    )

    if not subscriptions:
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

        # Calcular d??as hasta la cita
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

            for subscription in subscriptions:
                ok = send_web_push(
                    subscription,
                    {
                        "title": title,
                        "body": body,
                        "url": "/appointments",
                        "priority": priority,
                        "sound": "appointment",
                        "appointmentId": appt.id,
                        "userId": current_user.id,
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
    Enviar recordatorios push para medicaci??n del d??a
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

    subscriptions = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == current_user.id)
        .order_by(models.PushSubscription.created_at.desc())
        .all()
    )

    if not subscriptions:
        raise HTTPException(
            status_code=404, detail="No hay suscripciones push para el usuario"
        )

    sent_count = 0

    for med in medications:
        title = f"Recordatorio: {med.name}"
        body = "Es hora de tomar tu medicamento"
        if med.dose:
            body += f"\nDosis: {med.dose}"
        if med.frequency:
            body += f"\nFrecuencia: {med.frequency}"

        for subscription in subscriptions:
            ok = send_web_push(
                subscription,
                {
                    "title": title,
                    "body": body,
                    "url": "/medications",
                    "priority": "high",
                    "sound": "medication",
                    "medicationId": med.id,
                    "userId": current_user.id,
                },
            )
            if ok:
                sent_count += 1

    return {
        "sent": sent_count,
        "medications_checked": len(medications),
        "message": f"Se enviaron {sent_count} recordatorios",
    }


@app.post("/privacy/revoke-consent")
async def revoke_data_consent(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    current_user.data_consent_revoked = True
    current_user.notifications_consent = "revoked"
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return {"ok": True, "data_consent_revoked": True}


@app.post("/privacy/delete-account")
async def delete_account(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    user_id = current_user.id

    db.query(models.MedicationIntake).filter(models.MedicationIntake.user_id == user_id).delete()
    db.query(models.Appointment).filter(models.Appointment.user_id == user_id).delete()
    db.query(models.Medication).filter(models.Medication.user_id == user_id).delete()
    db.query(models.Document).filter(models.Document.user_id == user_id).delete()
    db.query(models.PushSubscription).filter(models.PushSubscription.user_id == user_id).delete()
    db.query(models.PushNotificationLog).filter(models.PushNotificationLog.user_id == user_id).delete()

    current_user.deleted = True
    current_user.data_consent_revoked = True
    current_user.notifications_consent = "revoked"
    current_user.name = "Usuario eliminado"
    current_user.email = f"deleted-{user_id}@klinip.local"
    current_user.password_hash = ""
    db.add(current_user)
    db.commit()

    return {"ok": True}


@app.post("/privacy/contact")
async def privacy_contact(
    payload: schemas.PrivacyRequestIn,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    config_errors = _privacy_contact_config_errors()
    if config_errors:
        print(
            "ERROR privacy contact: configuracion incompleta de correo",
            {"missing": config_errors},
        )
        raise HTTPException(
            status_code=503,
            detail=_email_config_error_detail(config_errors),
        )

    clean_message = (payload.message or "").strip()
    if not clean_message:
        raise HTTPException(status_code=400, detail="Debes escribir un mensaje.")

    req = models.PrivacyRequest(
        user_id=current_user.id,
        reason=payload.reason,
        message=clean_message,
        include_tech=bool(payload.include_tech),
        user_email=current_user.email or "",
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    print(
        "PRIVACY REQUEST",
        {
            "id": req.id,
            "user_id": current_user.id,
            "email": current_user.email,
            "reason": payload.reason,
            "message": clean_message,
            "include_tech": payload.include_tech,
        },
    )

    support_payload = {
        "request_id": req.id,
        "user_id": current_user.id,
        "email": current_user.email,
        "reason": payload.reason,
        "message": clean_message,
        "include_tech": bool(payload.include_tech),
        "ip": getattr(request.client, "host", "") if request.client else "",
        "user_agent": request.headers.get("user-agent", ""),
    }

    print(
        "DEBUG privacy contact: encolando correos",
        {"request_id": req.id, "support_to": _privacy_email_target(), "user_email": current_user.email},
    )
    background_tasks.add_task(_send_privacy_support_email_safe, support_payload)

    if current_user.email:
        background_tasks.add_task(
            _send_privacy_user_ack_email_safe,
            current_user.email,
            {
                "request_id": req.id,
                "reason": payload.reason,
                "message": clean_message,
            },
        )

    return {"ok": True, "request_id": req.id}


# Documents
UPLOAD_DIR = "uploaded_docs"
os.makedirs(UPLOAD_DIR, exist_ok=True)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


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
    send_email_backup: bool = Form(False),
    file: UploadFile = File(...),
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # Leer el contenido del archivo
    file_content = await file.read()
    if len(file_content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Archivo demasiado grande. Maximo permitido: 10 MB.",
        )
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
    if current_user.email and doc.doc_type in (models.DocumentType.receta, models.DocumentType.orden):
        background_tasks.add_task(
            _send_medical_order_uploaded_email_safe,
            current_user.email,
            current_user.name or "",
            {
                "document_type": "Orden medica" if doc.doc_type == models.DocumentType.orden else "Receta medica",
                "uploaded_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
            },
        )
    if send_email_backup and current_user.email:
        background_tasks.add_task(
            _send_document_backup_email_safe,
            current_user.email,
            current_user.name or "",
            {
                "document_type": str(doc.doc_type.value if hasattr(doc.doc_type, "value") else doc.doc_type),
                "center": doc.center or "",
                "uploaded_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
            },
            doc.filename or original_filename,
            file_content,
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
