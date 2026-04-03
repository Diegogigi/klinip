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
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import text, inspect, func, or_
from sqlalchemy.exc import DBAPIError, IntegrityError, ProgrammingError
from typing import List
import os
import sys
import mimetypes
import base64
import subprocess
import tempfile
from datetime import timedelta, datetime, timezone
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
import collections
import math
from difflib import SequenceMatcher
import time

# Fuerza UTF-8 en logs/salida para evitar mojibake por configuracion regional.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# ── Seguridad: Rate limiting en memoria ────────────────────────────────────
_rl_store: dict = collections.defaultdict(list)
_rl_lock = threading.Lock()

# máx intentos / ventana en segundos por endpoint
_RATE_LIMITS: dict = {
    "login":            {"max": 10, "window": 60},
    "register":         {"max":  5, "window": 60},
    "forgot-password":  {"max":  5, "window": 60},
    "stepup-email":     {"max":  5, "window": 600},
    "ai-transcribe":    {"max": 12, "window": 60},
}

# Bloqueo de cuenta por intentos fallidos
_MAX_LOGIN_ATTEMPTS = 5
_LOCKOUT_MINUTES    = 15


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(request: Request, endpoint: str) -> None:
    cfg = _RATE_LIMITS.get(endpoint)
    if not cfg:
        return
    ip  = _get_client_ip(request)
    key = f"{ip}:{endpoint}"
    now = time.time()
    window = cfg["window"]
    with _rl_lock:
        _rl_store[key] = [t for t in _rl_store[key] if now - t < window]
        if len(_rl_store[key]) >= cfg["max"]:
            raise HTTPException(
                status_code=429,
                detail=f"Demasiados intentos. Espera {window} segundos e intenta de nuevo.",
                headers={"Retry-After": str(window)},
            )
        _rl_store[key].append(now)
# ───────────────────────────────────────────────────────────────────────────
from zoneinfo import ZoneInfo
from urllib import request as urlrequest
from urllib import error as urlerror
from urllib.parse import quote_plus

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

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

RUNTIME_SCHEMA_MUTATIONS_ENABLED = (
    (os.getenv("ENABLE_RUNTIME_SCHEMA_MUTATIONS") or "").strip() == "1"
    or not bool(os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_PUBLIC_DOMAIN"))
)

# En produccion el esquema debe llegar por migraciones, no por mutaciones implicitas al arrancar.
if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
    Base.metadata.create_all(bind=engine)
else:
    print("INFO schema bootstrap: mutaciones runtime deshabilitadas; se espera alembic upgrade head")


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

        if "profile_id" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS profile_id INTEGER NULL"
                )
            else:
                statements.append("ALTER TABLE documents ADD COLUMN profile_id INTEGER")
            added_columns.append("profile_id")

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
                try:
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_documents_profile_id ON documents (profile_id)"
                        )
                    )
                except Exception:
                    pass
            print(
                f"DEBUG ensure_document_schema: columnas agregadas a documents: {', '.join(added_columns)}"
            )
        else:
            print("DEBUG ensure_document_schema: tabla documents ya esta al dia")
    except Exception as exc:
        # No detener la app si la verificacion falla; solo dejar el log.
        print(f"WARNING ensure_document_schema: no se pudo ajustar la tabla: {exc}")


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
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

        if "failed_login_attempts" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0"
                )
            else:
                statements.append("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0")
            added_columns.append("failed_login_attempts")

        if "locked_until" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL"
                )
            else:
                statements.append("ALTER TABLE users ADD COLUMN locked_until DATETIME")
            added_columns.append("locked_until")

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

        if "family_ai_needs_refresh" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS family_ai_needs_refresh BOOLEAN DEFAULT FALSE"
                )
            else:
                statements.append(
                    "ALTER TABLE users ADD COLUMN family_ai_needs_refresh BOOLEAN DEFAULT 0"
                )
            added_columns.append("family_ai_needs_refresh")

        if "family_ai_refresh_requested_at" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS family_ai_refresh_requested_at TIMESTAMP NULL"
                )
            else:
                statements.append(
                    "ALTER TABLE users ADD COLUMN family_ai_refresh_requested_at DATETIME"
                )
            added_columns.append("family_ai_refresh_requested_at")

        if "family_ai_last_refreshed_at" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS family_ai_last_refreshed_at TIMESTAMP NULL"
                )
            else:
                statements.append(
                    "ALTER TABLE users ADD COLUMN family_ai_last_refreshed_at DATETIME"
                )
            added_columns.append("family_ai_last_refreshed_at")

        # MFA columns
        if "mfa_enabled" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE"
                )
            else:
                statements.append("ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN NOT NULL DEFAULT 0")
            added_columns.append("mfa_enabled")

        if "mfa_secret" not in columns:
            if backend == "postgresql":
                statements.append("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR")
            else:
                statements.append("ALTER TABLE users ADD COLUMN mfa_secret VARCHAR")
            added_columns.append("mfa_secret")

        if "mfa_backup_codes_json" not in columns:
            if backend == "postgresql":
                statements.append("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes_json TEXT")
            else:
                statements.append("ALTER TABLE users ADD COLUMN mfa_backup_codes_json TEXT")
            added_columns.append("mfa_backup_codes_json")

        # permissions_json in profile_relationships
        try:
            rel_columns = {col["name"] for col in inspector.get_columns("profile_relationships")}
            if "permissions_json" not in rel_columns:
                if backend == "postgresql":
                    statements.append(
                        "ALTER TABLE profile_relationships ADD COLUMN IF NOT EXISTS permissions_json TEXT"
                    )
                else:
                    statements.append("ALTER TABLE profile_relationships ADD COLUMN permissions_json TEXT")
                added_columns.append("profile_relationships.permissions_json")
        except Exception:
            pass

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
                if "family_ai_needs_refresh" in added_columns:
                    conn.execute(
                        text(
                            "UPDATE users SET family_ai_needs_refresh = COALESCE(family_ai_needs_refresh, FALSE)"
                        )
                    )
                if "failed_login_attempts" in added_columns:
                    conn.execute(
                        text(
                            "UPDATE users SET failed_login_attempts = COALESCE(failed_login_attempts, 0)"
                        )
                    )
            print(
                f"DEBUG ensure_user_schema: columnas agregadas a users: {', '.join(added_columns)}"
            )
        else:
            print("DEBUG ensure_user_schema: tabla users ya esta al dia")
    except Exception as exc:
        print(f"WARNING ensure_user_schema: no se pudo ajustar la tabla: {exc}")


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
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

        if "ai_needs_refresh" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS ai_needs_refresh BOOLEAN DEFAULT FALSE"
                )
            else:
                statements.append(
                    "ALTER TABLE health_profiles ADD COLUMN ai_needs_refresh BOOLEAN DEFAULT 0"
                )
            added_columns.append("ai_needs_refresh")

        if "ai_refresh_requested_at" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS ai_refresh_requested_at TIMESTAMP NULL"
                )
            else:
                statements.append(
                    "ALTER TABLE health_profiles ADD COLUMN ai_refresh_requested_at DATETIME"
                )
            added_columns.append("ai_refresh_requested_at")

        if "ai_last_refreshed_at" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS ai_last_refreshed_at TIMESTAMP NULL"
                )
            else:
                statements.append(
                    "ALTER TABLE health_profiles ADD COLUMN ai_last_refreshed_at DATETIME"
                )
            added_columns.append("ai_last_refreshed_at")

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
                if "ai_needs_refresh" in added_columns:
                    conn.execute(
                        text(
                            "UPDATE health_profiles SET ai_needs_refresh = COALESCE(ai_needs_refresh, FALSE)"
                        )
                    )
            print(
                "DEBUG ensure_health_profile_schema: columnas agregadas a health_profiles: "
                + ", ".join(added_columns)
            )
        else:
            print("DEBUG ensure_health_profile_schema: tabla health_profiles ya esta al dia")
    except Exception as exc:
        print(f"WARNING ensure_health_profile_schema: no se pudo ajustar la tabla: {exc}")


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
    ensure_health_profile_schema()


def ensure_feed_schema():
    """Garantiza columnas nuevas usadas por comentarios del feed."""
    try:
        inspector = inspect(engine)
        if not inspector.has_table("post_comments"):
            return

        columns = {col["name"] for col in inspector.get_columns("post_comments")}
        backend = engine.url.get_backend_name()
        statements = []
        added_columns = []

        def add_comment_column(name: str, pg_stmt: str, sqlite_stmt: str):
            if name in columns:
                return
            statements.append(pg_stmt if backend == "postgresql" else sqlite_stmt)
            added_columns.append(name)

        add_comment_column(
            "parent_comment_id",
            "ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS parent_comment_id INTEGER NULL",
            "ALTER TABLE post_comments ADD COLUMN parent_comment_id INTEGER",
        )
        add_comment_column(
            "mentions_json",
            "ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS mentions_json TEXT DEFAULT ''",
            "ALTER TABLE post_comments ADD COLUMN mentions_json TEXT DEFAULT ''",
        )

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
            print(
                "DEBUG ensure_feed_schema: columnas agregadas a post_comments: "
                + ", ".join(added_columns)
            )
        else:
            print("DEBUG ensure_feed_schema: tabla post_comments ya esta al dia")
    except Exception as exc:
        print(f"WARNING ensure_feed_schema: no se pudo ajustar la tabla: {exc}")


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
    ensure_feed_schema()


_medication_schema_ready = False


def ensure_medication_schema(force: bool = False):
    """
    Garantiza que la tabla medications tenga columnas nuevas usadas por la app.
    """
    global _medication_schema_ready
    if _medication_schema_ready:
        return
    if not RUNTIME_SCHEMA_MUTATIONS_ENABLED and not force:
        return
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

        if "start_at" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE medications ADD COLUMN IF NOT EXISTS start_at TIMESTAMP NULL"
                )
            else:
                statements.append("ALTER TABLE medications ADD COLUMN start_at DATETIME")
            added_columns.append("start_at")

        def add_med_column(name: str, pg_stmt: str, sqlite_stmt: str):
            if name in columns:
                return
            statements.append(pg_stmt if backend == "postgresql" else sqlite_stmt)
            added_columns.append(name)

        add_med_column(
            "refill_enabled",
            "ALTER TABLE medications ADD COLUMN IF NOT EXISTS refill_enabled BOOLEAN DEFAULT FALSE",
            "ALTER TABLE medications ADD COLUMN refill_enabled BOOLEAN DEFAULT 0",
        )
        add_med_column(
            "stock_total_doses",
            "ALTER TABLE medications ADD COLUMN IF NOT EXISTS stock_total_doses INTEGER DEFAULT 0",
            "ALTER TABLE medications ADD COLUMN stock_total_doses INTEGER DEFAULT 0",
        )
        add_med_column(
            "refill_alert_threshold_doses",
            "ALTER TABLE medications ADD COLUMN IF NOT EXISTS refill_alert_threshold_doses INTEGER DEFAULT 0",
            "ALTER TABLE medications ADD COLUMN refill_alert_threshold_doses INTEGER DEFAULT 0",
        )
        add_med_column(
            "refill_rotation_index",
            "ALTER TABLE medications ADD COLUMN IF NOT EXISTS refill_rotation_index INTEGER DEFAULT 0",
            "ALTER TABLE medications ADD COLUMN refill_rotation_index INTEGER DEFAULT 0",
        )
        add_med_column(
            "refill_last_notified_at",
            "ALTER TABLE medications ADD COLUMN IF NOT EXISTS refill_last_notified_at TIMESTAMP NULL",
            "ALTER TABLE medications ADD COLUMN refill_last_notified_at DATETIME",
        )
        add_med_column(
            "refill_last_notified_remaining",
            "ALTER TABLE medications ADD COLUMN IF NOT EXISTS refill_last_notified_remaining INTEGER NULL",
            "ALTER TABLE medications ADD COLUMN refill_last_notified_remaining INTEGER",
        )
        add_med_column(
            "refill_mode",
            "ALTER TABLE medications ADD COLUMN IF NOT EXISTS refill_mode VARCHAR DEFAULT 'rotativo'",
            "ALTER TABLE medications ADD COLUMN refill_mode VARCHAR DEFAULT 'rotativo'",
        )
        add_med_column(
            "refill_fixed_user_id",
            "ALTER TABLE medications ADD COLUMN IF NOT EXISTS refill_fixed_user_id INTEGER NULL",
            "ALTER TABLE medications ADD COLUMN refill_fixed_user_id INTEGER",
        )
        add_med_column(
            "refill_participants_json",
            "ALTER TABLE medications ADD COLUMN IF NOT EXISTS refill_participants_json TEXT NULL",
            "ALTER TABLE medications ADD COLUMN refill_participants_json TEXT",
        )
        add_med_column(
            "doses_per_intake",
            "ALTER TABLE medications ADD COLUMN IF NOT EXISTS doses_per_intake REAL DEFAULT 1.0",
            "ALTER TABLE medications ADD COLUMN doses_per_intake REAL DEFAULT 1.0",
        )
        add_med_column(
            "frequency_per_day",
            "ALTER TABLE medications ADD COLUMN IF NOT EXISTS frequency_per_day REAL DEFAULT 1.0",
            "ALTER TABLE medications ADD COLUMN frequency_per_day REAL DEFAULT 1.0",
        )

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
                if "start_at" in added_columns:
                    conn.execute(
                        text(
                            "UPDATE medications SET start_at = COALESCE(start_at, created_at)"
                        )
                    )
                if any(
                    name in added_columns
                    for name in [
                        "refill_enabled",
                        "stock_total_doses",
                        "refill_alert_threshold_doses",
                        "refill_rotation_index",
                    ]
                ):
                    conn.execute(
                        text(
                            "UPDATE medications SET "
                            "refill_enabled = COALESCE(refill_enabled, FALSE), "
                            "stock_total_doses = COALESCE(stock_total_doses, 0), "
                            "refill_alert_threshold_doses = COALESCE(refill_alert_threshold_doses, 0), "
                            "refill_rotation_index = COALESCE(refill_rotation_index, 0)"
                        )
                    )
            print(
                f"DEBUG ensure_medication_schema: columnas agregadas a medications: {', '.join(added_columns)}"
            )
        else:
            print("DEBUG ensure_medication_schema: tabla medications ya esta al dia")
        _medication_schema_ready = True
    except Exception as exc:
        _medication_schema_ready = False
        print(f"WARNING ensure_medication_schema: no se pudo ajustar la tabla: {exc}")


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
    ensure_medication_schema()


def ensure_medication_purchase_schema(force: bool = False):
    if not RUNTIME_SCHEMA_MUTATIONS_ENABLED and not force:
        return
    try:
        inspector = inspect(engine)
        if not inspector.has_table("medication_purchases"):
            Base.metadata.create_all(bind=engine)
            inspector = inspect(engine)
        columns = {col["name"] for col in inspector.get_columns("medication_purchases")}
        backend = engine.url.get_backend_name()
        statements = []
        added_columns = []

        def add_purchase_column(name: str, pg_stmt: str, sqlite_stmt: str):
            if name in columns:
                return
            statements.append(pg_stmt if backend == "postgresql" else sqlite_stmt)
            added_columns.append(name)

        add_purchase_column(
            "profile_id",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS profile_id INTEGER NULL",
            "ALTER TABLE medication_purchases ADD COLUMN profile_id INTEGER",
        )
        add_purchase_column(
            "assigned_user_id",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER NULL",
            "ALTER TABLE medication_purchases ADD COLUMN assigned_user_id INTEGER",
        )
        add_purchase_column(
            "purchased_by_user_id",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS purchased_by_user_id INTEGER NULL",
            "ALTER TABLE medication_purchases ADD COLUMN purchased_by_user_id INTEGER",
        )
        add_purchase_column(
            "medication_name_snapshot",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS medication_name_snapshot VARCHAR DEFAULT ''",
            "ALTER TABLE medication_purchases ADD COLUMN medication_name_snapshot VARCHAR DEFAULT ''",
        )
        add_purchase_column(
            "dose_snapshot",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS dose_snapshot VARCHAR DEFAULT ''",
            "ALTER TABLE medication_purchases ADD COLUMN dose_snapshot VARCHAR DEFAULT ''",
        )
        add_purchase_column(
            "assigned_name_snapshot",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS assigned_name_snapshot VARCHAR DEFAULT ''",
            "ALTER TABLE medication_purchases ADD COLUMN assigned_name_snapshot VARCHAR DEFAULT ''",
        )
        add_purchase_column(
            "purchased_by_name_snapshot",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS purchased_by_name_snapshot VARCHAR DEFAULT ''",
            "ALTER TABLE medication_purchases ADD COLUMN purchased_by_name_snapshot VARCHAR DEFAULT ''",
        )
        add_purchase_column(
            "quantity_added_doses",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS quantity_added_doses INTEGER DEFAULT 0",
            "ALTER TABLE medication_purchases ADD COLUMN quantity_added_doses INTEGER DEFAULT 0",
        )
        add_purchase_column(
            "previous_remaining_doses",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS previous_remaining_doses INTEGER NULL",
            "ALTER TABLE medication_purchases ADD COLUMN previous_remaining_doses INTEGER",
        )
        add_purchase_column(
            "new_stock_total_doses",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS new_stock_total_doses INTEGER DEFAULT 0",
            "ALTER TABLE medication_purchases ADD COLUMN new_stock_total_doses INTEGER DEFAULT 0",
        )
        add_purchase_column(
            "amount_total",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS amount_total DOUBLE PRECISION NULL",
            "ALTER TABLE medication_purchases ADD COLUMN amount_total REAL",
        )
        add_purchase_column(
            "currency",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS currency VARCHAR DEFAULT 'CLP'",
            "ALTER TABLE medication_purchases ADD COLUMN currency VARCHAR DEFAULT 'CLP'",
        )
        add_purchase_column(
            "notes",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS notes TEXT NULL",
            "ALTER TABLE medication_purchases ADD COLUMN notes TEXT",
        )
        add_purchase_column(
            "receipt_filename",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS receipt_filename VARCHAR NULL",
            "ALTER TABLE medication_purchases ADD COLUMN receipt_filename VARCHAR",
        )
        add_purchase_column(
            "receipt_mime_type",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS receipt_mime_type VARCHAR NULL",
            "ALTER TABLE medication_purchases ADD COLUMN receipt_mime_type VARCHAR",
        )
        add_purchase_column(
            "receipt_file_data",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS receipt_file_data BYTEA NULL",
            "ALTER TABLE medication_purchases ADD COLUMN receipt_file_data BLOB",
        )
        add_purchase_column(
            "purchased_at",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS purchased_at TIMESTAMP NULL",
            "ALTER TABLE medication_purchases ADD COLUMN purchased_at DATETIME",
        )
        add_purchase_column(
            "created_at",
            "ALTER TABLE medication_purchases ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NULL",
            "ALTER TABLE medication_purchases ADD COLUMN created_at DATETIME",
        )

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
                if any(
                    name in added_columns
                    for name in [
                        "medication_name_snapshot",
                        "dose_snapshot",
                        "assigned_name_snapshot",
                        "purchased_by_name_snapshot",
                        "quantity_added_doses",
                        "new_stock_total_doses",
                        "currency",
                        "purchased_at",
                        "created_at",
                    ]
                ):
                    conn.execute(
                        text(
                            "UPDATE medication_purchases SET "
                            "medication_name_snapshot = COALESCE(medication_name_snapshot, ''), "
                            "dose_snapshot = COALESCE(dose_snapshot, ''), "
                            "assigned_name_snapshot = COALESCE(assigned_name_snapshot, ''), "
                            "purchased_by_name_snapshot = COALESCE(purchased_by_name_snapshot, ''), "
                            "quantity_added_doses = COALESCE(quantity_added_doses, 0), "
                            "new_stock_total_doses = COALESCE(new_stock_total_doses, 0), "
                            "currency = COALESCE(currency, 'CLP'), "
                            "purchased_at = COALESCE(purchased_at, created_at), "
                            "created_at = COALESCE(created_at, purchased_at, CURRENT_TIMESTAMP)"
                        )
                    )
            print(
                "DEBUG ensure_medication_purchase_schema: columnas agregadas a medication_purchases: "
                + ", ".join(added_columns)
            )
        else:
            print("DEBUG ensure_medication_purchase_schema: tabla medication_purchases ya esta al dia")
    except Exception as exc:
        print(f"WARNING ensure_medication_purchase_schema: no se pudo ajustar la tabla: {exc}")


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
    ensure_medication_purchase_schema()


def ensure_medication_intake_schema():
    if not RUNTIME_SCHEMA_MUTATIONS_ENABLED:
        return
    try:
        inspector = inspect(engine)
        columns = {col["name"] for col in inspector.get_columns("medication_intakes")}
        backend = engine.url.get_backend_name()
        statements = []
        added_columns = []

        def add_column(name: str, pg_stmt: str, sqlite_stmt: str):
            if name in columns:
                return
            statements.append(pg_stmt if backend == "postgresql" else sqlite_stmt)
            added_columns.append(name)

        add_column(
            "scheduled_at",
            "ALTER TABLE medication_intakes ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP NULL",
            "ALTER TABLE medication_intakes ADD COLUMN scheduled_at DATETIME",
        )
        add_column(
            "status",
            "ALTER TABLE medication_intakes ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'taken'",
            "ALTER TABLE medication_intakes ADD COLUMN status VARCHAR DEFAULT 'taken'",
        )
        add_column(
            "source",
            "ALTER TABLE medication_intakes ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual'",
            "ALTER TABLE medication_intakes ADD COLUMN source VARCHAR DEFAULT 'manual'",
        )
        add_column(
            "notes",
            "ALTER TABLE medication_intakes ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''",
            "ALTER TABLE medication_intakes ADD COLUMN notes TEXT DEFAULT ''",
        )
        add_column(
            "created_at",
            "ALTER TABLE medication_intakes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP",
            "ALTER TABLE medication_intakes ADD COLUMN created_at DATETIME",
        )

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
                if "created_at" in added_columns:
                    conn.execute(text("UPDATE medication_intakes SET created_at = COALESCE(created_at, taken_at, CURRENT_TIMESTAMP)"))
            print(
                "DEBUG ensure_medication_intake_schema: columnas agregadas a medication_intakes: "
                + ", ".join(added_columns)
            )
        else:
            print("DEBUG ensure_medication_intake_schema: tabla medication_intakes ya esta al dia")
    except Exception as exc:
        print(f"WARNING ensure_medication_intake_schema: no se pudo ajustar la tabla: {exc}")


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
    ensure_medication_intake_schema()


def ensure_voice_session_schema():
    """Garantiza que la tabla voice_sessions tenga todas las columnas usadas por Klinip Voice."""
    if not RUNTIME_SCHEMA_MUTATIONS_ENABLED:
        return
    try:
        inspector = inspect(engine)
        if not inspector.has_table("voice_sessions"):
            Base.metadata.create_all(bind=engine)
            inspector = inspect(engine)
        columns = {col["name"] for col in inspector.get_columns("voice_sessions")}
        backend = engine.url.get_backend_name()
        statements = []
        added_columns = []

        def add_voice_column(name: str, pg_stmt: str, sqlite_stmt: str):
            if name in columns:
                return
            statements.append(pg_stmt if backend == "postgresql" else sqlite_stmt)
            added_columns.append(name)

        add_voice_column(
            "audio_consent",
            "ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS audio_consent TEXT",
            "ALTER TABLE voice_sessions ADD COLUMN audio_consent TEXT",
        )
        add_voice_column(
            "audio_session",
            "ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS audio_session TEXT",
            "ALTER TABLE voice_sessions ADD COLUMN audio_session TEXT",
        )
        add_voice_column(
            "audio_session_hash",
            "ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS audio_session_hash TEXT DEFAULT ''",
            "ALTER TABLE voice_sessions ADD COLUMN audio_session_hash TEXT DEFAULT ''",
        )
        add_voice_column(
            "transcripcion_tecnica",
            "ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS transcripcion_tecnica TEXT",
            "ALTER TABLE voice_sessions ADD COLUMN transcripcion_tecnica TEXT",
        )
        add_voice_column(
            "version_simple",
            "ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS version_simple TEXT",
            "ALTER TABLE voice_sessions ADD COLUMN version_simple TEXT",
        )
        add_voice_column(
            "indicaciones",
            "ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS indicaciones JSONB DEFAULT '[]'::jsonb",
            "ALTER TABLE voice_sessions ADD COLUMN indicaciones TEXT DEFAULT '[]'",
        )
        add_voice_column(
            "hablantes",
            "ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS hablantes JSONB",
            "ALTER TABLE voice_sessions ADD COLUMN hablantes TEXT",
        )
        add_voice_column(
            "metadata_clinica",
            "ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS metadata_clinica JSONB",
            "ALTER TABLE voice_sessions ADD COLUMN metadata_clinica TEXT",
        )
        add_voice_column(
            "compartido_en",
            "ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS compartido_en TIMESTAMP",
            "ALTER TABLE voice_sessions ADD COLUMN compartido_en DATETIME",
        )
        add_voice_column(
            "link_seguro",
            "ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS link_seguro TEXT",
            "ALTER TABLE voice_sessions ADD COLUMN link_seguro TEXT",
        )
        add_voice_column(
            "link_expira_en",
            "ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS link_expira_en TIMESTAMP",
            "ALTER TABLE voice_sessions ADD COLUMN link_expira_en DATETIME",
        )

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
                if any(name in added_columns for name in ["audio_session_hash", "indicaciones"]):
                    conn.execute(
                        text(
                            "UPDATE voice_sessions SET "
                            "audio_session_hash = COALESCE(audio_session_hash, ''), "
                            "indicaciones = COALESCE(indicaciones, '[]')"
                        )
                    )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_voice_sessions_profile_id ON voice_sessions (profile_id)"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_voice_sessions_user_id ON voice_sessions (user_id)"
                    )
                )
            print(
                "DEBUG ensure_voice_session_schema: columnas agregadas a voice_sessions: "
                + ", ".join(added_columns)
            )
        else:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_voice_sessions_profile_id ON voice_sessions (profile_id)"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_voice_sessions_user_id ON voice_sessions (user_id)"
                    )
                )
            print("DEBUG ensure_voice_session_schema: tabla voice_sessions ya esta al dia")
    except Exception as exc:
        print(f"WARNING ensure_voice_session_schema: no se pudo ajustar la tabla: {exc}")


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
    ensure_voice_session_schema()


def ensure_medication_performance_indexes():
    try:
        backend = engine.url.get_backend_name()
        statements = []
        if backend == "postgresql":
            statements.extend(
                [
                    "CREATE INDEX IF NOT EXISTS ix_medication_intakes_user_medication ON medication_intakes (user_id, medication_id)",
                    "CREATE INDEX IF NOT EXISTS ix_medication_intakes_medication_taken_at ON medication_intakes (medication_id, taken_at)",
                    "CREATE INDEX IF NOT EXISTS ix_medication_intakes_medication_scheduled_at ON medication_intakes (medication_id, scheduled_at)",
                    "CREATE INDEX IF NOT EXISTS ix_adherence_summaries_profile_med_window ON adherence_summaries (profile_id, medication_id, window_days)",
                ]
            )
        else:
            statements.extend(
                [
                    "CREATE INDEX IF NOT EXISTS ix_medication_intakes_user_medication ON medication_intakes (user_id, medication_id)",
                    "CREATE INDEX IF NOT EXISTS ix_medication_intakes_medication_taken_at ON medication_intakes (medication_id, taken_at)",
                    "CREATE INDEX IF NOT EXISTS ix_medication_intakes_medication_scheduled_at ON medication_intakes (medication_id, scheduled_at)",
                    "CREATE INDEX IF NOT EXISTS ix_adherence_summaries_profile_med_window ON adherence_summaries (profile_id, medication_id, window_days)",
                ]
            )

        with engine.begin() as conn:
            for stmt in statements:
                conn.execute(text(stmt))
        print("DEBUG ensure_medication_performance_indexes: indices verificados")
    except Exception as exc:
        print(f"WARNING ensure_medication_performance_indexes: no se pudo completar: {exc}")


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
    ensure_medication_performance_indexes()


def ensure_ai_conversation_schema():
    """
    Garantiza que ai_conversation_messages tenga columnas para conversaciones.
    """
    try:
        inspector = inspect(engine)
        columns = {col["name"] for col in inspector.get_columns("ai_conversation_messages")}
        backend = engine.url.get_backend_name()
        statements = []
        added_columns = []

        if "conversation_id" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE ai_conversation_messages ADD COLUMN IF NOT EXISTS conversation_id VARCHAR DEFAULT ''"
                )
            else:
                statements.append(
                    "ALTER TABLE ai_conversation_messages ADD COLUMN conversation_id VARCHAR DEFAULT ''"
                )
            added_columns.append("conversation_id")

        if "conversation_title" not in columns:
            if backend == "postgresql":
                statements.append(
                    "ALTER TABLE ai_conversation_messages ADD COLUMN IF NOT EXISTS conversation_title VARCHAR DEFAULT ''"
                )
            else:
                statements.append(
                    "ALTER TABLE ai_conversation_messages ADD COLUMN conversation_title VARCHAR DEFAULT ''"
                )
            added_columns.append("conversation_title")

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
            print(
                f"DEBUG ensure_ai_conversation_schema: columnas agregadas a ai_conversation_messages: {', '.join(added_columns)}"
            )
        else:
            print("DEBUG ensure_ai_conversation_schema: tabla ai_conversation_messages ya esta al dia")
    except Exception as exc:
        print(f"WARNING ensure_ai_conversation_schema: no se pudo ajustar la tabla: {exc}")


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
    ensure_ai_conversation_schema()


def ensure_ai_memory_schema():
    try:
        inspector = inspect(engine)
        backend = engine.url.get_backend_name()
        table_names = set(inspector.get_table_names())
        vector_available = False

        if backend == "postgresql":
            try:
                with engine.begin() as conn:
                    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                vector_available = True
            except Exception as exc:
                print(f"WARNING ensure_ai_memory_schema: no se pudo habilitar pgvector: {exc}")

        if "ai_document_chunks" in table_names:
            try:
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_ai_document_chunks_profile_document "
                            "ON ai_document_chunks (profile_id, document_id)"
                        )
                    )
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_ai_document_chunks_user_type "
                            "ON ai_document_chunks (user_id, document_type)"
                        )
                    )
            except Exception as exc:
                print(f"WARNING ensure_ai_memory_schema: no se pudieron crear indices basicos: {exc}")

            if backend == "postgresql" and vector_available:
                chunk_columns = {col["name"] for col in inspector.get_columns("ai_document_chunks")}
                if "embedding_vector" not in chunk_columns:
                    try:
                        with engine.begin() as conn:
                            conn.execute(
                                text(
                                    "ALTER TABLE ai_document_chunks "
                                    "ADD COLUMN IF NOT EXISTS embedding_vector vector(256)"
                                )
                            )
                    except Exception as exc:
                        print(f"WARNING ensure_ai_memory_schema: no se pudo crear columna vector: {exc}")
                try:
                    with engine.begin() as conn:
                        conn.execute(
                            text(
                                "CREATE INDEX IF NOT EXISTS ix_ai_document_chunks_embedding_vector "
                                "ON ai_document_chunks USING ivfflat "
                                "(embedding_vector vector_cosine_ops) WITH (lists = 100)"
                            )
                        )
                except Exception as exc:
                    print(f"WARNING ensure_ai_memory_schema: no se pudo crear indice pgvector: {exc}")

        if "ai_conversation_summaries" in table_names:
            try:
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_ai_conversation_summaries_profile_updated "
                            "ON ai_conversation_summaries (profile_id, updated_at)"
                        )
                    )
            except Exception as exc:
                print(f"WARNING ensure_ai_memory_schema: no se pudo indexar resúmenes de conversación: {exc}")

        if "ai_query_metrics" in table_names:
            try:
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_ai_query_metrics_profile_created "
                            "ON ai_query_metrics (profile_id, created_at)"
                        )
                    )
            except Exception as exc:
                print(f"WARNING ensure_ai_memory_schema: no se pudo indexar métricas IA: {exc}")

        print("DEBUG ensure_ai_memory_schema: tablas y extensiones de memoria verificadas")
    except Exception as exc:
        print(f"WARNING ensure_ai_memory_schema: no se pudo completar: {exc}")


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
    ensure_ai_memory_schema()

PLAN_DEFINITIONS = {
    "basico": {
        "limits": {
            "max_profiles": 1,
            "collaboration_enabled": False,
            "family_panel_enabled": False,
            "ai_access_level": "basica",
            "ai_chat_daily_limit": 15,
        },
        "public": {
            "slug": "basico",
            "name": "Básico",
            "price_monthly": "Gratis",
            "price_yearly": "Gratis",
            "yearly_equivalent": "Sin costo",
            "note": "Salud personal",
            "summary": "Para organizar tu salud personal con lo esencial, acceso a Klinip IA en modalidad básica y un KlinipFeed personal privado.",
            "recommended": False,
            "cta": "Empezar gratis",
            "features": [
                "1 perfil de salud",
                "Medicamentos, citas y calendario",
                "Documentos médicos con OCR básico",
                "Recordatorios esenciales",
                "Klinip IA básica con hasta 15 consultas al día",
                "KlinipFeed personal para actualizaciones privadas",
                "Acceso móvil y escritorio",
            ],
            "detail_sections": [
                {
                    "title": "Ideal para",
                    "items": [
                        "Personas que quieren centralizar su información médica",
                        "Usuarios que necesitan recordatorios, documentos y apoyo inicial de IA en un solo lugar",
                    ],
                },
                {
                    "title": "Incluye",
                    "items": [
                        "Gestión de citas, medicamentos y documentos",
                        "Historial básico de salud",
                        "Klinip IA con capacidad diaria limitada para consultas rápidas",
                        "KlinipFeed personal para registrar avances desde tu cuenta",
                        "Panel individual simple y rápido",
                    ],
                },
            ],
            "metrics": [
                {"label": "Perfiles", "value": "1"},
                {"label": "Colaboración", "value": "No"},
                {"label": "Panel familiar", "value": "No"},
            ],
        },
    },
    "plus": {
        "limits": {
            "max_profiles": 3,
            "collaboration_enabled": False,
            "family_panel_enabled": False,
            "ai_access_level": "completa",
            "ai_chat_daily_limit": None,
        },
        "public": {
            "slug": "plus",
            "name": "Plus",
            "price_monthly": "$3.990 / mes",
            "price_yearly": "$39.990 / año",
            "yearly_equivalent": "$3.332 / mes",
            "note": "Más perfiles + IA completa",
            "summary": "Más capacidad de perfiles, Klinip IA completa y un KlinipFeed para seguir varias personas desde una sola cuenta.",
            "recommended": True,
            "cta": "Probar Plus",
            "features": [
                "Hasta 3 perfiles de salud",
                "OCR mejorado",
                "Historial completo y reportes",
                "Recordatorios avanzados",
                "Klinip IA completa",
                "KlinipFeed para seguir hasta 3 perfiles desde tu cuenta",
                "Gestión individual de varios perfiles",
            ],
            "detail_sections": [
                {
                    "title": "Ideal para",
                    "items": [
                        "Usuarios que manejan su salud y la de hijos, padres o dependientes desde su propia cuenta",
                        "Personas que necesitan más trazabilidad y reportes",
                    ],
                },
                {
                    "title": "Incluye",
                    "items": [
                        "Hasta 3 perfiles sin colaboración multiusuario",
                        "Mayor profundidad en historial y documentos",
                        "Klinip IA completa para consultas, resúmenes y seguimiento",
                        "KlinipFeed para compartir avances entre perfiles que administras",
                    ],
                },
            ],
            "metrics": [
                {"label": "Perfiles", "value": "3"},
                {"label": "Colaboración", "value": "No"},
                {"label": "Panel familiar", "value": "No"},
            ],
        },
    },
    "familiar": {
        "limits": {
            "max_profiles": 5,
            "collaboration_enabled": True,
            "family_panel_enabled": True,
            "ai_access_level": "completa",
            "ai_chat_daily_limit": None,
        },
        "public": {
            "slug": "familiar",
            "name": "Familiar",
            "price_monthly": "$6.990 / mes",
            "price_yearly": "$69.990 / año",
            "yearly_equivalent": "$5.832 / mes",
            "note": "Ecosistema colaborativo",
            "summary": "Pensado para familias y cuidadores que coordinan la salud de varias personas con un KlinipFeed familiar compartido.",
            "recommended": False,
            "cta": "Elegir Familiar",
            "features": [
                "Hasta 5 perfiles de salud",
                "Panel familiar y calendarios compartidos",
                "Recordatorios por perfil",
                "Roles por cuidador y colaboración multiusuario",
                "Klinip IA completa para todo el grupo",
                "KlinipFeed familiar compartido entre cuidadores y familia",
                "Historial y actividad por persona",
            ],
            "detail_sections": [
                {
                    "title": "Ideal para",
                    "items": [
                        "Familias que coordinan citas, medicamentos y documentos",
                        "Cuidadores que necesitan visibilidad compartida",
                    ],
                },
                {
                    "title": "Incluye",
                    "items": [
                        "Panel familiar con contexto por integrante",
                        "Colaboración entre cuidadores y responsables",
                        "KlinipFeed familiar para publicar avances y novedades del grupo",
                        "Seguimiento diferenciado por perfil y actividad",
                    ],
                },
            ],
            "metrics": [
                {"label": "Perfiles", "value": "5"},
                {"label": "Colaboración", "value": "Sí"},
                {"label": "Panel familiar", "value": "Sí"},
            ],
        },
    },
}

PLAN_RULES = {
    slug: dict(definition.get("limits", {}))
    for slug, definition in PLAN_DEFINITIONS.items()
}

PUBLIC_PLAN_CATALOG = [
    dict(definition.get("public", {}))
    for definition in PLAN_DEFINITIONS.values()
]

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


if RUNTIME_SCHEMA_MUTATIONS_ENABLED:
    ensure_family_schema_data()

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_EMAIL = os.getenv("VAPID_EMAIL")


def _push_configured() -> bool:
    return bool(webpush and VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and VAPID_EMAIL)


def ensure_login_security_schema():
    if not RUNTIME_SCHEMA_MUTATIONS_ENABLED:
        return
    """
    Refuerzo puntual para entornos donde el esquema de users quedó desfasado
    respecto del flujo de login.
    """
    backend = engine.url.get_backend_name()
    try:
        with engine.begin() as conn:
            if backend == "postgresql":
                conn.execute(
                    text(
                        "ALTER TABLE users "
                        "ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0"
                    )
                )
                conn.execute(
                    text(
                        "ALTER TABLE users "
                        "ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL"
                    )
                )
            else:
                inspector = inspect(engine)
                columns = {col["name"] for col in inspector.get_columns("users")}
                if "failed_login_attempts" not in columns:
                    conn.execute(
                        text(
                            "ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0"
                        )
                    )
                if "locked_until" not in columns:
                    conn.execute(text("ALTER TABLE users ADD COLUMN locked_until DATETIME"))
            conn.execute(
                text(
                    "UPDATE users SET failed_login_attempts = COALESCE(failed_login_attempts, 0)"
                )
            )
        print("DEBUG ensure_login_security_schema: columnas criticas de login verificadas")
    except Exception as exc:
        print(f"WARNING ensure_login_security_schema: no se pudo reforzar users: {exc}")


def send_web_push(subscription: models.PushSubscription, payload: dict):
    if not _push_configured():
        print("DEBUG push: falta configuracion VAPID o pywebpush")
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
        status = getattr(exc.response, "status_code", None) if exc.response else None
        print(f"WARNING push: fallo al enviar push (status={status}): {exc}")
        if status in (404, 410):
            return "gone"
        return False


def _prune_push_subscriptions_for_user(db: Session, user_id: int, keep: int = 3) -> int:
    keep_count = max(1, int(keep or 1))
    subscriptions = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == user_id)
        .order_by(models.PushSubscription.created_at.desc(), models.PushSubscription.id.desc())
        .all()
    )
    stale_subs = subscriptions[keep_count:]
    if not stale_subs:
        return 0
    for sub in stale_subs:
        db.delete(sub)
    db.commit()
    return len(stale_subs)


def _send_push_to_user(db: Session, user_id: int, payload: dict) -> int:
    if not (webpush and VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY):
        return 0
    subscriptions = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == user_id)
        .order_by(models.PushSubscription.created_at.desc(), models.PushSubscription.id.desc())
        .all()
    )
    if not subscriptions:
        return 0
    # iOS acumula muchas suscripciones caducadas. Enviamos solo a las 3 más
    # recientes para evitar que un usuario de iPhone reciba decenas de
    # notificaciones duplicadas. Las demás se eliminan como limpieza proactiva.
    active_subs = subscriptions[:3]
    stale_subs = subscriptions[3:]
    for sub in stale_subs:
        db.delete(sub)
    if stale_subs:
        db.commit()

    sent = 0
    gone_ids = []
    for sub in active_subs:
        result = send_web_push(sub, payload)
        if result is True:
            sent += 1
        elif result == "gone":
            gone_ids.append(sub.id)

    if gone_ids:
        db.query(models.PushSubscription).filter(
            models.PushSubscription.id.in_(gone_ids)
        ).delete(synchronize_session=False)
        db.commit()

    return sent


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _is_production_env() -> bool:
    return bool(os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_PUBLIC_DOMAIN"))


def _parse_allowed_origins(raw_value: str) -> list[str]:
    origins = []
    for origin in (raw_value or "").split(","):
        normalized = origin.strip().rstrip("/")
        if normalized and normalized not in origins:
            origins.append(normalized)
    return origins


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
    if _is_production_env() and not auth.SECRET_KEY:
        errors.append("SECRET_KEY")
    return errors


def _privacy_contact_config_errors() -> list[str]:
    return _email_channel_errors(require_support_target=True)


def _email_config_error_detail(config_errors: list[str]) -> str:
    base = "Canal de correo no disponible temporalmente. Intenta nuevamente."
    # Facilita diagnostico en despliegues donde no se tienen logs a mano.
    return f"{base} Missing: {', '.join(config_errors)}"


def _frontend_link_base_url(default: str = "https://app.klinip.cl") -> str:
    base = (
        os.getenv("FRONTEND_BASE_URL")
        or os.getenv("FRONTEND_URL")
        or default
    )
    return base.strip().rstrip("/")


def _build_hash_route_url(base_url: str, route_path: str, query: str | None = None) -> str:
    normalized_path = "/" + (route_path or "").lstrip("/")
    normalized_query = (query or "").strip().lstrip("?")
    suffix = f"?{normalized_query}" if normalized_query else ""
    return f"{base_url}/#{normalized_path}{suffix}"


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
    return _build_hash_route_url(frontend_base_url, "/reset-password", f"token={quote_plus(raw_token)}")


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
        raise RuntimeError("Mensaje inválido para Resend (From/To/Subject)")

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
    _send_templated_email(
        to_email=to_email,
        subject=f"{_app_display_name()} - Restablecer contraseña",
        template_name="password_reset.html",
        context={"reset_url": reset_url, "year": datetime.utcnow().year},
        from_security=True,
    )


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
            subject=f"Recordatorio de cita - {payload.get('offset_label') or 'próxima cita'}",
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


def _send_medication_refill_email_safe(to_email: str, user_name: str, payload: dict):
    try:
        is_assignee = bool(payload.get("is_assignee"))
        subject = (
            f"Te toca comprar {payload.get('medication_name') or 'un medicamento'}"
            if is_assignee
            else f"Reposición de {payload.get('medication_name') or 'medicamento'} asignada"
        )
        _send_templated_email(
            to_email=to_email,
            subject=subject,
            template_name="medication_refill_assignment.html",
            context={
                "user_name": user_name or "Usuario",
                "patient_name": payload.get("patient_name") or "tu familiar",
                "medication_name": payload.get("medication_name") or "Medicamento",
                "dose": payload.get("dose") or "",
                "remaining_doses": int(payload.get("remaining_doses") or 0),
                "threshold_doses": int(payload.get("threshold_doses") or 0),
                "assignee_name": payload.get("assignee_name") or user_name or "Usuario",
                "is_assignee": is_assignee,
                "year": datetime.utcnow().year,
            },
        )
    except Exception as exc:
        print(f"ERROR sending medication refill email async: {exc}")


def _send_medication_programmed_email_safe(to_email: str, user_name: str, payload: dict):
    try:
        is_assignee = bool(payload.get("is_assignee"))
        subject = (
            f"Se programó {payload.get('medication_name') or 'un medicamento'}"
            if not is_assignee
            else f"Quedaste a cargo de {payload.get('medication_name') or 'un medicamento'}"
        )
        _send_templated_email(
            to_email=to_email,
            subject=subject,
            template_name="medication_refill_programmed.html",
            context={
                "user_name": user_name or "Usuario",
                "patient_name": payload.get("patient_name") or "tu familiar",
                "medication_name": payload.get("medication_name") or "Medicamento",
                "dose": payload.get("dose") or "",
                "frequency": payload.get("frequency") or "",
                "duration": payload.get("duration") or "",
                "start_label": payload.get("start_label") or "",
                "assignee_name": payload.get("assignee_name") or user_name or "Usuario",
                "participant_names": payload.get("participant_names") or "",
                "is_assignee": is_assignee,
                "year": datetime.utcnow().year,
            },
        )
    except Exception as exc:
        print(f"ERROR sending medication programmed email async: {exc}")


def _send_medication_purchase_email_safe(
    to_email: str,
    user_name: str,
    payload: dict,
    receipt_filename: str | None = None,
    receipt_bytes: bytes | None = None,
    receipt_mime_type: str | None = None,
):
    try:
        if not to_email:
            return
        smtp_user = os.getenv("SMTP_USER")
        smtp_pass = os.getenv("SMTP_PASS")
        sender = _smtp_from_notifications(smtp_user)
        if not sender:
            raise RuntimeError("Remitente de correo no configurado")

        template_context = {
            "app_name": _app_display_name(),
            "logo_url": _email_logo_url(),
            "user_name": user_name or "Usuario",
            "patient_name": payload.get("patient_name") or "Paciente",
            "medication_name": payload.get("medication_name") or "Medicamento",
            "dose": payload.get("dose") or "",
            "assigned_name": payload.get("assigned_name") or "",
            "purchased_by_name": payload.get("purchased_by_name") or "",
            "purchased_at_label": payload.get("purchased_at_label") or "",
            "amount_label": payload.get("amount_label") or "",
            "stock_label": payload.get("stock_label") or "",
            "notes": payload.get("notes") or "",
            "receipt_filename": receipt_filename or "",
            "year": datetime.utcnow().year,
        }
        html_body = _render_email_template("medication_purchase_receipt.html", template_context)
        text_body = _html_to_text(html_body)

        msg = EmailMessage()
        msg["Subject"] = f"Compra registrada: {payload.get('medication_name') or 'Medicamento'}"
        msg["From"] = sender
        msg["To"] = to_email
        msg.set_content(text_body or "Se registró una compra de medicamento en Klinip.")
        msg.add_alternative(html_body, subtype="html")
        if receipt_filename and receipt_bytes:
            mime_type = receipt_mime_type
            if not mime_type:
                mime_type, _ = mimetypes.guess_type(receipt_filename)
            maintype, subtype = ("application", "octet-stream")
            if mime_type and "/" in mime_type:
                maintype, subtype = mime_type.split("/", 1)
            msg.add_attachment(
                receipt_bytes,
                maintype=maintype,
                subtype=subtype,
                filename=receipt_filename,
            )
        _deliver_message(msg, smtp_user, smtp_pass)
    except Exception as exc:
        print(f"ERROR sending medication purchase email async: {exc}")


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


def _build_family_invite_url(token: str) -> str:
    base = _frontend_link_base_url("https://www.klinip.cl")
    return _build_hash_route_url(base, "/settings", f"family_invite_token={quote_plus(token)}")


def _send_profile_invitation_email_safe(
    to_email: str,
    inviter_name: str,
    profile_name: str,
    role: str,
    relationship_type: str,
    token: str,
):
    try:
        _send_templated_email(
            to_email=to_email,
            subject=f"Invitacion de {inviter_name} para colaborar en Klinip",
            template_name="profile_invitation.html",
            context={
                "invitee_email": to_email,
                "inviter_name": inviter_name or "Usuario Klinip",
                "profile_name": profile_name or "Perfil de salud",
                "role": role or "viewer",
                "relationship_type": relationship_type or "",
                "accept_url": _build_family_invite_url(token),
                "year": datetime.utcnow().year,
            },
        )
    except Exception as exc:
        print(f"ERROR sending profile invitation email async: {exc}")


def _send_profile_access_removed_email_safe(
    to_email: str,
    removed_by_name: str,
    profile_name: str,
):
    try:
        _send_templated_email(
            to_email=to_email,
            subject="Acceso removido en Klinip",
            template_name="profile_access_removed.html",
            context={
                "removed_email": to_email,
                "removed_by_name": removed_by_name or "Administrador",
                "profile_name": profile_name or "Perfil de salud",
                "year": datetime.utcnow().year,
            },
            from_security=True,
        )
    except Exception as exc:
        print(f"ERROR sending profile access removed email async: {exc}")




SCHEDULE_WINDOW_SECONDS = 90   # wider than interval to absorb scheduler drift
SCHEDULE_INTERVAL_SECONDS = 60
MEDICATION_LEAD_MINUTES = 5
AI_REFRESH_INTERVAL_SECONDS = 600
AI_REFRESH_BATCH_SIZE = 4
WORKER_JOB_TIMEOUT_SECONDS = max(
    10,
    int(os.getenv("WORKER_JOB_TIMEOUT_SECONDS", "25") or "25"),
)
WORKER_JOB_RETRIES = max(
    0,
    int(os.getenv("WORKER_JOB_RETRIES", "1") or "1"),
)
APPOINTMENT_REMINDER_BATCH_SIZE = max(
    1,
    int(os.getenv("APPOINTMENT_REMINDER_BATCH_SIZE", "12") or "12"),
)
APPOINTMENT_REMINDER_APPOINTMENT_LIMIT = max(
    1,
    int(os.getenv("APPOINTMENT_REMINDER_APPOINTMENT_LIMIT", "48") or "48"),
)
MEDICATION_REMINDER_BATCH_SIZE = max(
    1,
    int(os.getenv("MEDICATION_REMINDER_BATCH_SIZE", "10") or "10"),
)
MEDICATION_REMINDER_MEDICATION_LIMIT = max(
    1,
    int(os.getenv("MEDICATION_REMINDER_MEDICATION_LIMIT", "40") or "40"),
)
REFILL_ALERT_BATCH_SIZE = max(
    1,
    int(os.getenv("REFILL_ALERT_BATCH_SIZE", "12") or "12"),
)
FAMILY_AI_REFRESH_BATCH_SIZE = max(
    1,
    int(
        os.getenv(
            "FAMILY_AI_REFRESH_BATCH_SIZE",
            str(AI_REFRESH_BATCH_SIZE),
        )
        or str(AI_REFRESH_BATCH_SIZE)
    ),
)
_chat_profile_limiters_guard = threading.Lock()
_chat_profile_limiters: dict[int, threading.BoundedSemaphore] = {}
DEFAULT_TZ_NAME = "America/Santiago"
FALLBACK_TZ_OFFSETS = {
    "America/Santiago": -3,
    "UTC": 0,
}


def _safe_zoneinfo(tz_name: str | None) -> timezone | ZoneInfo:
    resolved_name = (tz_name or "").strip() or DEFAULT_TZ_NAME
    try:
        return ZoneInfo(resolved_name)
    except Exception:
        fallback_hours = FALLBACK_TZ_OFFSETS.get(resolved_name, FALLBACK_TZ_OFFSETS.get(DEFAULT_TZ_NAME, 0))
        return timezone(timedelta(hours=fallback_hours), name=resolved_name)


def _resolve_user_tz(user: models.User | None) -> timezone | ZoneInfo:
    tz_name = getattr(user, "timezone", None) or DEFAULT_TZ_NAME
    return _safe_zoneinfo(tz_name)


def _resolve_user_tz_name(user: models.User | None) -> str:
    tz_value = getattr(user, "timezone", None) or DEFAULT_TZ_NAME
    return (tz_value or DEFAULT_TZ_NAME).strip() or DEFAULT_TZ_NAME


def _normalize_dt_for_tz(value: datetime | None, tz: timezone | ZoneInfo) -> datetime | None:
    if not value:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=tz)
    try:
        return value.astimezone(tz)
    except Exception:
        return value.replace(tzinfo=tz)


def _to_schedule_tz(value: datetime | None, tz: timezone | ZoneInfo) -> datetime | None:
    if not value:
        return None
    return _normalize_dt_for_tz(value, tz)


def _appointment_type_label(appt_type) -> str:
    if appt_type == models.AppointmentType.examen:
        return "Examen"
    if appt_type == models.AppointmentType.tramite:
        return "Tramite"
    return "Cita medica"


def _appointment_offsets():
    return [
        {"label": "7 días antes", "delta": timedelta(days=7), "priority": "low"},
        {"label": "3 días antes", "delta": timedelta(days=3), "priority": "normal"},
        {"label": "1 día antes", "delta": timedelta(days=1), "priority": "high"},
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
        "7 días antes": "days7",
        "3 días antes": "days3",
        "1 día antes": "days1",
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


def _frequency_interval_hours(frequency_text: str = "") -> int | None:
    normalized = _normalize_text(frequency_text or "")
    match = re.search(r"\bcada\s+(\d{1,2})\s+hora", normalized)
    if match:
        try:
            hours = int(match.group(1))
        except ValueError:
            hours = 0
        if hours in {4, 6, 8, 12, 24}:
            return hours
    if any(token in normalized for token in ["cada 24", "una vez", "1 vez", "diaria", "al dia"]):
        return 24
    if any(token in normalized for token in ["cada 12", "2 veces", "dos veces"]):
        return 12
    if any(token in normalized for token in ["cada 8", "3 veces", "tres veces"]):
        return 8
    if any(token in normalized for token in ["cada 6", "4 veces", "cuatro veces"]):
        return 6
    return None


def _parse_medication_duration_days(value: str = "") -> int | None:
    normalized = _normalize_text(value or "")
    if not normalized:
        return None
    days_match = re.search(r"(\d+)\s*d[ií]a", normalized)
    if days_match:
        try:
            return max(int(days_match.group(1)), 0)
        except ValueError:
            return None
    weeks_match = re.search(r"(\d+)\s*semana", normalized)
    if weeks_match:
        try:
            return max(int(weeks_match.group(1)), 0) * 7
        except ValueError:
            return None
    return None


def _effective_frequency_per_day_from_values(
    frequency_text: str = "",
    fallback_value: float | None = None,
) -> float:
    interval_hours = _frequency_interval_hours(frequency_text or "")
    if interval_hours and interval_hours > 0:
        return round(24 / interval_hours, 2)
    try:
        fallback = float(fallback_value or 0)
    except (TypeError, ValueError):
        fallback = 0.0
    return round(max(fallback, 1.0), 2)


def _medication_start_at(med: models.Medication, fallback: datetime | None = None) -> datetime:
    if getattr(med, "start_at", None):
        return med.start_at
    if getattr(med, "created_at", None):
        return med.created_at
    return fallback or datetime.now()


def _medication_end_at(med: models.Medication) -> datetime | None:
    end_at = getattr(med, "end_date", None)
    if not end_at:
        duration_days = _parse_medication_duration_days(getattr(med, "duration", "") or "")
        start_at = _medication_start_at(med, None)
        if not duration_days or not start_at:
            return None
        interval_hours = _frequency_interval_hours(getattr(med, "frequency", "") or "")
        if interval_hours and interval_hours > 0:
            total_hours = max(duration_days * 24, interval_hours)
            steps = max(math.ceil(total_hours / interval_hours) - 1, 0)
            return start_at + timedelta(hours=steps * interval_hours)
        return start_at + timedelta(days=max(duration_days - 1, 0))
    if (
        end_at.hour == 0
        and end_at.minute == 0
        and end_at.second == 0
        and end_at.microsecond == 0
    ):
        return end_at.replace(hour=23, minute=59, second=59, microsecond=999999)
    return end_at


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
    day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    return day_start + timedelta(hours=hour, minutes=minute)


def _coerce_dt_aware(dt: datetime, reference: datetime) -> datetime:
    """Make dt timezone-aware using the reference's tzinfo if dt is naive."""
    if dt.tzinfo is None and reference is not None and reference.tzinfo is not None:
        return dt.replace(tzinfo=reference.tzinfo)
    if dt.tzinfo is not None and reference is not None and reference.tzinfo is None:
        return dt.replace(tzinfo=None)
    return dt


def _medication_schedule_events_between(
    med: models.Medication,
    window_start: datetime,
    window_end: datetime,
) -> list[datetime]:
    if window_end < window_start:
        return []
    anchor = _medication_start_at(med, window_start)
    # Normalize: DB datetimes are naive; window datetimes may be tz-aware.
    # Mismatch causes TypeError on comparison — coerce anchor to match window.
    if window_start is not None:
        anchor = _coerce_dt_aware(anchor, window_start)
    effective_start = max(anchor, window_start)
    effective_end = window_end
    medication_end_at = _medication_end_at(med)
    if medication_end_at:
        medication_end_at = _coerce_dt_aware(medication_end_at, window_end)
    if medication_end_at and medication_end_at < effective_end:
        effective_end = medication_end_at
    if effective_end < effective_start:
        return []

    interval_hours = _frequency_interval_hours(getattr(med, "frequency", "") or "")
    if interval_hours:
        interval = timedelta(hours=interval_hours)
        current = anchor
        if current < effective_start:
            elapsed_seconds = max(0.0, (effective_start - current).total_seconds())
            jump_steps = int(elapsed_seconds // interval.total_seconds())
            current = current + (interval * jump_steps)
            while current < effective_start:
                current += interval
        events = []
        while current <= effective_end:
            events.append(current)
            current += interval
        return events

    schedule_slot = _parse_schedule_time(getattr(med, "schedule_time", "") or "")
    if schedule_slot:
        hour, minute = schedule_slot
    else:
        hour, minute = _medication_start_at(med, effective_start).hour, _medication_start_at(med, effective_start).minute
    day = effective_start.replace(hour=0, minute=0, second=0, microsecond=0)
    if day > anchor.replace(hour=0, minute=0, second=0, microsecond=0):
        anchor_day = anchor.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        anchor_day = day
    current = _build_med_trigger(anchor_day, hour, minute)
    while current < effective_start:
        current += timedelta(days=1)
    events = []
    while current <= effective_end:
        events.append(current)
        current += timedelta(days=1)
    return events


def _medication_time_slots(med: models.Medication):
    anchor = _medication_start_at(med, datetime.now())
    schedule_slot = _parse_schedule_time(getattr(med, "schedule_time", "") or "")
    if not schedule_slot:
        schedule_slot = (anchor.hour, anchor.minute)
    interval_hours = _frequency_interval_hours(getattr(med, "frequency", "") or "")
    if schedule_slot and interval_hours and interval_hours < 24:
        base_minutes = schedule_slot[0] * 60 + schedule_slot[1]
        slot_count = max(int(math.ceil(24 / interval_hours)), 1)
        slots = []
        seen = set()
        for idx in range(slot_count):
            total_minutes = (base_minutes + (idx * interval_hours * 60)) % (24 * 60)
            hour = total_minutes // 60
            minute = total_minutes % 60
            key = (hour, minute)
            if key in seen:
                continue
            seen.add(key)
            slots.append(key)
        return sorted(slots, key=lambda item: (item[0], item[1]))
    if schedule_slot:
        return [schedule_slot]
    return [(hour, 0) for hour in _derive_dose_hours(med.frequency)]


def _medication_schedule_slot_strings(med: models.Medication) -> list[str]:
    slots = []
    for hour, minute in _medication_time_slots(med):
        slots.append(f"{int(hour) % 24:02d}:{int(minute) % 60:02d}")
    deduped = []
    seen = set()
    for slot in slots:
        if slot in seen:
            continue
        seen.add(slot)
        deduped.append(slot)
    return deduped


def _medication_schedule_summary(med: models.Medication) -> str:
    slots = _medication_schedule_slot_strings(med)
    if not slots:
        return ""
    if len(slots) == 1:
        return slots[0]
    if len(slots) == 2:
        return f"{slots[0]} y {slots[1]}"
    return ", ".join(slots[:-1]) + f" y {slots[-1]}"


def _parse_refill_participant_ids(raw_value) -> list[int]:
    if raw_value in (None, "", []):
        return []
    payload = raw_value
    if isinstance(raw_value, str):
        try:
            payload = json.loads(raw_value)
        except Exception:
            return []
    if not isinstance(payload, list):
        return []
    result = []
    seen = set()
    for item in payload:
        try:
            user_id = int(item)
        except (TypeError, ValueError):
            continue
        if user_id <= 0 or user_id in seen:
            continue
        seen.add(user_id)
        result.append(user_id)
    return result


def _serialize_refill_participant_ids(user_ids: list[int] | None) -> str | None:
    normalized = _parse_refill_participant_ids(user_ids or [])
    if not normalized:
        return None
    return json.dumps(normalized, ensure_ascii=False)


def _sanitize_refill_participant_ids(
    raw_ids,
    available_contacts: list[dict],
    fixed_user_id: int | None = None,
    default_all: bool = False,
) -> list[int]:
    available_by_id = {int(item["user_id"]): item for item in available_contacts}
    requested_ids = _parse_refill_participant_ids(raw_ids)
    if not requested_ids and default_all:
        requested_ids = list(available_by_id.keys())
    sanitized = [user_id for user_id in requested_ids if user_id in available_by_id]
    if fixed_user_id:
        try:
            fixed_id = int(fixed_user_id)
        except (TypeError, ValueError):
            fixed_id = 0
        if fixed_id and fixed_id in available_by_id and fixed_id not in sanitized:
            sanitized.append(fixed_id)
    return sanitized


def _calculate_expected_doses_between(
    med: models.Medication,
    window_start: datetime,
    window_end: datetime,
) -> int:
    return len(_medication_schedule_events_between(med, window_start, window_end))


def _calculate_expected_doses_until(med: models.Medication, now: datetime) -> int:
    return _calculate_expected_doses_between(med, _medication_start_at(med, now), now)


def _normalize_adherence_status(value: str | None) -> str:
    normalized = _normalize_text(value or "").lower()
    if normalized in {"late", "atrasada", "tarde"}:
        return "late"
    if normalized in {"missed", "omitida", "perdida"}:
        return "missed"
    if normalized in {"skipped", "saltada"}:
        return "skipped"
    return "taken"


def _build_medication_event_defaults(
    med: models.Medication,
    status: str,
    scheduled_at: datetime | None,
    taken_at: datetime | None,
) -> tuple[datetime | None, datetime | None, str]:
    now = datetime.now()
    # Strip timezone info upfront to avoid TypeError when comparing with timezone-naive datetimes
    if scheduled_at and getattr(scheduled_at, "tzinfo", None) is not None:
        scheduled_at = scheduled_at.replace(tzinfo=None)
    if taken_at and getattr(taken_at, "tzinfo", None) is not None:
        taken_at = taken_at.replace(tzinfo=None)
    schedule_dt = scheduled_at
    actual_taken_at = taken_at
    normalized_status = _normalize_adherence_status(status)
    if not schedule_dt:
        reference_dt = actual_taken_at or now
        candidate_slots = _medication_schedule_events_between(
            med,
            reference_dt - timedelta(days=2),
            reference_dt + timedelta(days=2),
        )
        if candidate_slots:
            due_candidates = [
                item for item in candidate_slots
                if item <= reference_dt + timedelta(minutes=90)
            ]
            if due_candidates:
                schedule_dt = max(due_candidates)
            else:
                schedule_dt = min(candidate_slots, key=lambda item: abs(item - reference_dt))
    if normalized_status in {"taken", "late"} and not actual_taken_at:
        actual_taken_at = now
    if normalized_status == "taken" and schedule_dt and actual_taken_at:
        if actual_taken_at > schedule_dt + timedelta(minutes=90):
            normalized_status = "late"
    return schedule_dt, actual_taken_at, normalized_status


def _materialize_medication_adherence_events(db: Session, user: models.User, horizon_days: int = 2):
    now = datetime.now(_resolve_user_tz(user))
    meds = (
        db.query(models.Medication)
        .filter(
            models.Medication.user_id == user.id,
            models.Medication.completed.is_(False),
        )
        .all()
    )
    for med in meds:
        for scheduled_at in _medication_schedule_events_between(
            med,
            now - timedelta(days=max(1, horizon_days)),
            now - timedelta(minutes=90),
        ):
            existing = (
                db.query(models.MedicationIntake)
                .filter(
                    models.MedicationIntake.medication_id == med.id,
                    models.MedicationIntake.user_id == user.id,
                    models.MedicationIntake.scheduled_at == scheduled_at.replace(tzinfo=None),
                )
                .first()
            )
            if existing:
                continue
            db.add(
                models.MedicationIntake(
                    user_id=user.id,
                    medication_id=med.id,
                    scheduled_at=scheduled_at.replace(tzinfo=None),
                    taken_at=None,
                    status="missed",
                    source="scheduler",
                    notes="Evento generado automaticamente por falta de registro.",
                )
                )


def _medication_remaining_doses(
    med: models.Medication,
    taken_doses: int | None = None,
) -> int | None:
    total = int(getattr(med, "stock_total_doses", 0) or 0)
    if total <= 0:
        return None
    consumed = int(taken_doses if taken_doses is not None else getattr(med, "taken_doses", 0) or 0)
    return max(total - max(consumed, 0), 0)


def _primary_profile_for_owner_user(
    db: Session,
    owner_user_id: int | None,
) -> models.HealthProfile | None:
    if not owner_user_id:
        return None
    return (
        db.query(models.HealthProfile)
        .filter(
            models.HealthProfile.owner_user_id == int(owner_user_id),
            models.HealthProfile.is_archived.is_(False),
        )
        .order_by(models.HealthProfile.is_primary_profile.desc(), models.HealthProfile.created_at.asc())
        .first()
    )


def _medication_refill_contacts(
    db: Session,
    owner_user_id: int | None,
) -> list[dict]:
    if not owner_user_id:
        return []
    owner_user = db.query(models.User).filter(models.User.id == int(owner_user_id)).first()
    if not owner_user or not _plan_allows_collaboration_for_user(owner_user):
        return []
    profile = _primary_profile_for_owner_user(db, owner_user_id)
    if not profile:
        return []
    rows = (
        db.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.profile_id == profile.id,
            models.ProfileRelationship.status == "accepted",
            models.ProfileRelationship.user_id != int(owner_user_id),
        )
        .order_by(models.ProfileRelationship.accepted_at.asc(), models.ProfileRelationship.created_at.asc())
        .all()
    )
    contacts = []
    for row in rows:
        user = row.user or db.query(models.User).filter(models.User.id == row.user_id).first()
        if not user:
            continue
        contacts.append(
            {
                "user_id": int(user.id),
                "name": (user.name or user.email or f"Usuario #{user.id}").strip(),
                "email": (user.email or "").strip(),
                "role": _normalize_role(getattr(row, "role", "")),
                "relationship_type": getattr(row, "relationship_type", "") or "",
                "user": user,
            }
        )
    return contacts


def _medication_selected_refill_contacts(
    med: models.Medication,
    contacts: list[dict] | None = None,
) -> list[dict]:
    all_contacts = list(contacts or [])
    if not all_contacts:
        return []
    participant_ids = _parse_refill_participant_ids(getattr(med, "refill_participants_json", None))
    available_by_id = {int(item["user_id"]): item for item in all_contacts}
    if participant_ids:
        return [available_by_id[user_id] for user_id in participant_ids if user_id in available_by_id]
    return all_contacts


def _medication_patient_name(
    profile: models.HealthProfile | None = None,
    owner_user: models.User | None = None,
) -> str:
    return (
        getattr(profile, "full_name", None)
        or getattr(profile, "name", None)
        or getattr(owner_user, "name", None)
        or "Paciente"
    )


def _format_medication_datetime_label(value: datetime | None) -> str:
    if not value:
        return ""
    try:
        return value.strftime("%d-%m-%Y %H:%M")
    except Exception:
        return str(value)


def _medication_participant_names(contacts: list[dict] | None) -> str:
    names = [str((item or {}).get("name") or "").strip() for item in (contacts or [])]
    names = [name for name in names if name]
    return ", ".join(names)


def _medication_notification_recipients(
    db: Session,
    med: models.Medication,
    owner_user: models.User | None = None,
    profile: models.HealthProfile | None = None,
) -> tuple[list[dict], list[dict], models.User | None, str]:
    owner = owner_user
    if not owner:
        owner = db.query(models.User).filter(models.User.id == getattr(med, "user_id", None)).first()
    selected_contacts = _medication_selected_refill_contacts(
        med,
        contacts=_medication_refill_contacts(db, getattr(med, "user_id", None)),
    )
    patient_name = _medication_patient_name(profile, owner)
    recipients: list[dict] = []
    seen_user_ids: set[int] = set()
    if owner:
        recipients.append(
            {
                "user_id": int(owner.id),
                "name": (owner.name or owner.email or f"Usuario #{owner.id}").strip(),
                "email": (owner.email or "").strip(),
                "user": owner,
                "is_owner": True,
            }
        )
        seen_user_ids.add(int(owner.id))
    for contact in selected_contacts:
        user_id = int(contact.get("user_id") or 0)
        if user_id <= 0 or user_id in seen_user_ids:
            continue
        recipients.append({**contact, "is_owner": False})
        seen_user_ids.add(user_id)
    return recipients, selected_contacts, owner, patient_name


def _medication_refill_current_assignee(
    db: Session,
    med: models.Medication,
    contacts: list[dict] | None = None,
) -> dict | None:
    all_contacts = contacts if contacts is not None else _medication_refill_contacts(db, med.user_id)
    if not all_contacts:
        return None
    participant_ids = _parse_refill_participant_ids(getattr(med, "refill_participants_json", None))
    available_by_id = {int(item["user_id"]): item for item in all_contacts}
    available_contacts = (
        [available_by_id[user_id] for user_id in participant_ids if user_id in available_by_id]
        if participant_ids
        else list(all_contacts)
    )
    if not available_contacts:
        return None
    mode = str(getattr(med, "refill_mode", None) or "rotativo")
    if mode == "fijo":
        fixed_uid = getattr(med, "refill_fixed_user_id", None)
        if fixed_uid:
            match = next((c for c in available_contacts if int(c["user_id"]) == int(fixed_uid)), None)
            if match:
                return match
    # rotativo (default) o manual sin configurar
    rotation_index = int(getattr(med, "refill_rotation_index", 0) or 0)
    return available_contacts[rotation_index % len(available_contacts)]


def _medication_refill_next_assignee(
    db: Session,
    med: models.Medication,
    contacts: list[dict] | None = None,
) -> dict | None:
    all_contacts = contacts if contacts is not None else _medication_refill_contacts(db, med.user_id)
    if not all_contacts:
        return None
    participant_ids = _parse_refill_participant_ids(getattr(med, "refill_participants_json", None))
    available_by_id = {int(item["user_id"]): item for item in all_contacts}
    available_contacts = (
        [available_by_id[user_id] for user_id in participant_ids if user_id in available_by_id]
        if participant_ids
        else list(all_contacts)
    )
    if not available_contacts:
        return None
    mode = str(getattr(med, "refill_mode", None) or "rotativo")
    if mode == "fijo":
        return _medication_refill_current_assignee(db, med, contacts=available_contacts)
    rotation_index = int(getattr(med, "refill_rotation_index", 0) or 0)
    return available_contacts[(rotation_index + 1) % len(available_contacts)]


def _medication_days_remaining(med: models.Medication, remaining: int | None) -> float | None:
    if remaining is None:
        return None
    dpi = float(getattr(med, "doses_per_intake", None) or 1.0)
    fpd = _effective_frequency_per_day_from_values(
        getattr(med, "frequency", "") or "",
        getattr(med, "frequency_per_day", None),
    )
    daily = max(dpi * fpd, 0.01)
    return round(remaining / daily, 1)


def _medication_refill_status(
    med: models.Medication,
    remaining: int | None,
    threshold: int,
) -> str:
    if not getattr(med, "refill_enabled", False) or remaining is None:
        return "normal"
    total = int(getattr(med, "stock_total_doses", 0) or 0)
    pct_20 = (total * 0.20) if total > 0 else 0
    if threshold > 0 and remaining <= max(threshold * 0.5, 1):
        return "critical"
    if threshold > 0 and remaining <= threshold:
        return "alert"
    if total > 0 and remaining <= pct_20:
        return "alert"
    return "normal"


def _populate_medication_refill_state(
    db: Session,
    med: models.Medication,
    taken_doses: int | None = None,
):
    remaining = _medication_remaining_doses(med, taken_doses=taken_doses)
    contacts = _medication_refill_contacts(db, getattr(med, "user_id", None))
    available_by_id = {int(item["user_id"]): item for item in contacts}
    participant_ids = _parse_refill_participant_ids(getattr(med, "refill_participants_json", None))
    selected_contacts = (
        [available_by_id[user_id] for user_id in participant_ids if user_id in available_by_id]
        if participant_ids
        else list(contacts)
    )
    assignee = _medication_refill_current_assignee(db, med, contacts=selected_contacts) if selected_contacts else None
    next_assignee = _medication_refill_next_assignee(db, med, contacts=selected_contacts) if selected_contacts else None
    threshold = int(getattr(med, "refill_alert_threshold_doses", 0) or 0)
    total = int(getattr(med, "stock_total_doses", 0) or 0)
    pct_20 = (total * 0.20) if total > 0 else 0
    alert_active = bool(
        getattr(med, "refill_enabled", False)
        and remaining is not None
        and (
            (threshold > 0 and remaining <= threshold)
            or (total > 0 and remaining <= pct_20)
        )
    )
    refill_status = _medication_refill_status(med, remaining, threshold)
    days_remaining = _medication_days_remaining(med, remaining)
    effective_end_date = _medication_end_at(med)
    schedule_times = _medication_schedule_slot_strings(med)
    setattr(med, "remaining_doses", remaining)
    setattr(med, "days_remaining", days_remaining)
    setattr(med, "refill_status", refill_status)
    setattr(med, "refill_contacts_count", len(selected_contacts))
    setattr(med, "refill_current_assignee_user_id", assignee.get("user_id") if assignee else None)
    setattr(med, "refill_current_assignee_name", assignee.get("name") if assignee else "")
    setattr(med, "refill_next_assignee_name", next_assignee.get("name") if next_assignee else "")
    setattr(med, "refill_alert_active", alert_active)
    setattr(med, "effective_end_date", effective_end_date)
    setattr(med, "computed_schedule_times", schedule_times)
    setattr(med, "computed_schedule_summary", _medication_schedule_summary(med))
    setattr(
        med,
        "effective_frequency_per_day",
        _effective_frequency_per_day_from_values(
            getattr(med, "frequency", "") or "",
            getattr(med, "frequency_per_day", None),
        ),
    )
    setattr(
        med,
        "refill_participant_user_ids",
        [int(item["user_id"]) for item in selected_contacts],
    )
    setattr(
        med,
        "refill_participant_names",
        [str(item.get("name") or "").strip() for item in selected_contacts if item.get("name")],
    )
    return med


def _handle_medication_refill_notifications(
    db: Session,
    med: models.Medication,
    owner_user: models.User | None = None,
    taken_doses: int | None = None,
) -> bool:
    if not med or not bool(getattr(med, "refill_enabled", False)):
        return False
    total_doses = int(getattr(med, "stock_total_doses", 0) or 0)
    threshold = int(getattr(med, "refill_alert_threshold_doses", 0) or 0)
    if total_doses <= 0 or threshold <= 0:
        return False
    owner = owner_user
    if not owner:
        owner = db.query(models.User).filter(models.User.id == med.user_id).first()
    if not owner or not _plan_allows_collaboration_for_user(owner):
        return False
    contacts = _medication_refill_contacts(db, getattr(med, "user_id", None))
    participant_ids = _parse_refill_participant_ids(getattr(med, "refill_participants_json", None))
    available_by_id = {int(item["user_id"]): item for item in contacts}
    selected_contacts = (
        [available_by_id[user_id] for user_id in participant_ids if user_id in available_by_id]
        if participant_ids
        else list(contacts)
    )
    if not selected_contacts:
        return False
    _populate_medication_refill_state(db, med, taken_doses=taken_doses)
    remaining = getattr(med, "remaining_doses", None)
    if remaining is None:
        return False
    # Condición de alerta: umbral de dosis O stock <= 20%
    total_doses = int(getattr(med, "stock_total_doses", 0) or 0)
    pct_20 = (total_doses * 0.20) if total_doses > 0 else 0
    alert_triggered = (threshold > 0 and remaining <= threshold) or (total_doses > 0 and remaining <= pct_20)
    last_notified_at = getattr(med, "refill_last_notified_at", None)
    if not alert_triggered:
        if last_notified_at is not None or getattr(med, "refill_last_notified_remaining", None) is not None:
            med.refill_last_notified_at = None
            med.refill_last_notified_remaining = None
            db.add(med)
            db.commit()
            db.refresh(med)
        return False
    if last_notified_at is not None:
        return False

    assignee = _medication_refill_current_assignee(db, med, contacts=selected_contacts)
    if not assignee:
        return False

    patient_profile = _primary_profile_for_owner_user(db, med.user_id)
    patient_name = (
        getattr(patient_profile, "name", None)
        or getattr(owner, "name", None)
        or "Perfil familiar"
    )
    cycle_key = (
        f"{int(getattr(med, 'refill_rotation_index', 0) or 0)}"
        f"-{max(int(remaining), 0)}"
    )
    sent_any = False

    for contact in selected_contacts:
        is_assignee = int(contact["user_id"]) == int(assignee["user_id"])
        push_tag = (
            f"medication-refill-{med.id}-"
            f"{'assignee' if is_assignee else 'family'}-{contact['user_id']}-{cycle_key}"
        )
        if not _notification_already_sent(db, push_tag):
            title = "Reposición de medicamento"
            if is_assignee:
                body = (
                    f"Te toca comprar {med.name} para {patient_name}. "
                    f"Quedan {remaining} dosis."
                )
            else:
                body = (
                    f"A {assignee['name']} le toca comprar {med.name} para {patient_name}. "
                    f"Quedan {remaining} dosis."
                )
            payload = {
                "title": title,
                "body": body,
                "url": "/medications",
                "priority": "high",
                "sound": "medication",
                "medicationId": med.id,
                "userId": int(contact["user_id"]),
                "tag": push_tag,
            }
            sent = _send_push_to_user(db, int(contact["user_id"]), payload)
            if sent:
                _record_sent(
                    db,
                    int(contact["user_id"]),
                    push_tag,
                    "medication_refill",
                    datetime.now(),
                    datetime.now(),
                )
                sent_any = True

        contact_user = contact.get("user")
        email_tag = f"medication-refill-email-{med.id}-{contact['user_id']}-{cycle_key}"
        if (
            contact_user
            and getattr(contact_user, "email", "")
            and bool(getattr(contact_user, "email_reminders_enabled", False))
            and not _notification_already_sent(db, email_tag)
        ):
            _send_medication_refill_email_safe(
                contact_user.email,
                contact.get("name") or "",
                {
                    "patient_name": patient_name,
                    "medication_name": med.name or "Medicamento",
                    "dose": med.dose or "",
                    "remaining_doses": remaining,
                    "threshold_doses": threshold,
                    "assignee_name": assignee.get("name") or "",
                    "is_assignee": is_assignee,
                },
            )
            _record_sent(
                db,
                int(contact["user_id"]),
                email_tag,
                "medication_refill_email",
                datetime.now(),
                datetime.now(),
            )
            sent_any = True

    # Notificar al paciente (owner) que el medicamento está por agotarse y quién es el responsable
    if owner:
        patient_push_tag = f"medication-refill-patient-{med.id}-{owner.id}-{cycle_key}"
        if not _notification_already_sent(db, patient_push_tag):
            days_rem = getattr(med, "days_remaining", None)
            days_str = f" (~{int(days_rem)} días)" if days_rem is not None and days_rem >= 1 else ""
            patient_body = (
                f"{med.name} está por agotarse: quedan {remaining} dosis{days_str}. "
                f"{assignee['name']} fue notificado para la compra."
            )
            patient_payload = {
                "title": "Medicamento por agotarse",
                "body": patient_body,
                "url": "/medications",
                "priority": "high",
                "sound": "medication",
                "medicationId": med.id,
                "userId": int(owner.id),
                "tag": patient_push_tag,
            }
            sent_patient = _send_push_to_user(db, int(owner.id), patient_payload)
            if sent_patient:
                _record_sent(
                    db,
                    int(owner.id),
                    patient_push_tag,
                    "medication_refill_patient",
                    datetime.now(),
                    datetime.now(),
                )
                sent_any = True

    med.refill_last_notified_at = datetime.now()
    med.refill_last_notified_remaining = int(remaining)
    db.add(med)
    db.commit()
    db.refresh(med)
    return sent_any


def _decorate_medication_purchase(item: models.MedicationPurchase | None):
    if not item:
        return None
    setattr(item, "has_receipt", bool(getattr(item, "receipt_file_data", None)))
    return item


def _send_medication_programmed_notifications(
    db: Session,
    med: models.Medication,
    profile: models.HealthProfile | None = None,
    owner_user: models.User | None = None,
) -> bool:
    if not med or not bool(getattr(med, "refill_enabled", False)):
        return False
    recipients, selected_contacts, owner, patient_name = _medication_notification_recipients(
        db,
        med,
        owner_user=owner_user,
        profile=profile,
    )
    if not selected_contacts:
        return False
    assignee = _medication_refill_current_assignee(db, med, contacts=selected_contacts)
    if not assignee:
        return False
    participant_names = _medication_participant_names(selected_contacts)
    start_label = _format_medication_datetime_label(
        getattr(med, "start_at", None) or getattr(med, "created_at", None)
    )
    sent_any = False
    for recipient in recipients:
        user_id = int(recipient.get("user_id") or 0)
        if user_id <= 0:
            continue
        is_assignee = int(assignee.get("user_id") or 0) == user_id
        push_tag = f"medication-programmed-{med.id}-{user_id}"
        if not _notification_already_sent(db, push_tag):
            if recipient.get("is_owner"):
                body = (
                    f"Se programó {med.name} para {patient_name}. "
                    f"Responsable actual de compra: {assignee.get('name') or 'sin asignar'}."
                )
            elif is_assignee:
                body = (
                    f"Se programó {med.name} para {patient_name}. "
                    "Te tocará la primera compra cuando llegue la reposición."
                )
            else:
                body = (
                    f"Se programó {med.name} para {patient_name}. "
                    f"La primera compra quedó asignada a {assignee.get('name') or 'sin asignar'}."
                )
            sent = _send_push_to_user(
                db,
                user_id,
                {
                    "title": "Medicamento programado",
                    "body": body,
                    "url": "/medications",
                    "priority": "high",
                    "sound": "medication",
                    "medicationId": med.id,
                    "userId": user_id,
                    "tag": push_tag,
                },
            )
            if sent:
                _record_sent(
                    db,
                    user_id,
                    push_tag,
                    "medication_programmed",
                    datetime.now(),
                    datetime.now(),
                )
                sent_any = True

        recipient_user = recipient.get("user")
        email_tag = f"medication-programmed-email-{med.id}-{user_id}"
        if (
            recipient_user
            and getattr(recipient_user, "email", "")
            and not _notification_already_sent(db, email_tag)
        ):
            _send_medication_programmed_email_safe(
                recipient_user.email,
                recipient.get("name") or "",
                {
                    "patient_name": patient_name,
                    "medication_name": med.name or "Medicamento",
                    "dose": med.dose or "",
                    "frequency": med.frequency or "",
                    "duration": med.duration or "",
                    "start_label": start_label,
                    "assignee_name": assignee.get("name") or "",
                    "participant_names": participant_names,
                    "is_assignee": is_assignee,
                },
            )
            _record_sent(
                db,
                user_id,
                email_tag,
                "medication_programmed_email",
                datetime.now(),
                datetime.now(),
            )
            sent_any = True
    return sent_any


def _send_medication_purchase_notifications(
    db: Session,
    med: models.Medication,
    purchase: models.MedicationPurchase,
    profile: models.HealthProfile | None = None,
    owner_user: models.User | None = None,
) -> bool:
    if not med or not purchase:
        return False
    recipients, _, owner, patient_name = _medication_notification_recipients(
        db,
        med,
        owner_user=owner_user,
        profile=profile,
    )
    if not recipients and owner:
        recipients = [
            {
                "user_id": int(owner.id),
                "name": (owner.name or owner.email or f"Usuario #{owner.id}").strip(),
                "email": (owner.email or "").strip(),
                "user": owner,
                "is_owner": True,
            }
        ]
    if not recipients:
        return False
    amount_value = getattr(purchase, "amount_total", None)
    currency = getattr(purchase, "currency", None) or "CLP"
    amount_label = ""
    if amount_value is not None:
        try:
            amount_label = f"{currency} {float(amount_value):,.0f}".replace(",", ".")
        except Exception:
            amount_label = f"{currency} {amount_value}"
    purchased_at_label = _format_medication_datetime_label(getattr(purchase, "purchased_at", None))
    stock_label = f"{int(getattr(purchase, 'new_stock_total_doses', 0) or 0)} dosis cargadas"
    assigned_name = getattr(purchase, "assigned_name_snapshot", "") or "Sin responsable"
    purchased_by_name = getattr(purchase, "purchased_by_name_snapshot", "") or "Sin registrar"
    sent_any = False
    for recipient in recipients:
        user_id = int(recipient.get("user_id") or 0)
        if user_id <= 0:
            continue
        push_tag = f"medication-purchase-{purchase.id}-{user_id}"
        if not _notification_already_sent(db, push_tag):
            body = (
                f"{purchased_by_name} marcó como comprado {med.name} para {patient_name}. "
                f"Nuevo stock: {int(getattr(purchase, 'new_stock_total_doses', 0) or 0)} dosis."
            )
            sent = _send_push_to_user(
                db,
                user_id,
                {
                    "title": "Compra de medicamento registrada",
                    "body": body,
                    "url": "/medications",
                    "priority": "high",
                    "sound": "medication",
                    "medicationId": med.id,
                    "userId": user_id,
                    "tag": push_tag,
                },
            )
            if sent:
                _record_sent(
                    db,
                    user_id,
                    push_tag,
                    "medication_purchase",
                    datetime.now(),
                    datetime.now(),
                )
                sent_any = True

        recipient_user = recipient.get("user")
        email_tag = f"medication-purchase-email-{purchase.id}-{user_id}"
        if (
            recipient_user
            and getattr(recipient_user, "email", "")
            and not _notification_already_sent(db, email_tag)
        ):
            _send_medication_purchase_email_safe(
                recipient_user.email,
                recipient.get("name") or "",
                {
                    "patient_name": patient_name,
                    "medication_name": getattr(purchase, "medication_name_snapshot", None) or med.name or "Medicamento",
                    "dose": getattr(purchase, "dose_snapshot", None) or med.dose or "",
                    "assigned_name": assigned_name,
                    "purchased_by_name": purchased_by_name,
                    "purchased_at_label": purchased_at_label,
                    "amount_label": amount_label,
                    "stock_label": stock_label,
                    "notes": getattr(purchase, "notes", None) or "",
                },
                receipt_filename=getattr(purchase, "receipt_filename", None),
                receipt_bytes=getattr(purchase, "receipt_file_data", None),
                receipt_mime_type=getattr(purchase, "receipt_mime_type", None),
            )
            _record_sent(
                db,
                user_id,
                email_tag,
                "medication_purchase_email",
                datetime.now(),
                datetime.now(),
            )
            sent_any = True
    return sent_any


def _record_medication_purchase(
    db: Session,
    med: models.Medication,
    profile: models.HealthProfile | None,
    current_user: models.User,
    *,
    new_stock_total_doses: int,
    amount_total: float | None = None,
    currency: str | None = None,
    notes: str | None = None,
    purchased_at: datetime | None = None,
    receipt_filename: str | None = None,
    receipt_mime_type: str | None = None,
    receipt_bytes: bytes | None = None,
) -> models.MedicationPurchase:
    previous_remaining = _medication_remaining_doses(med)
    selected_contacts = _medication_selected_refill_contacts(
        med,
        contacts=_medication_refill_contacts(db, getattr(med, "user_id", None)),
    )
    assignee = _medication_refill_current_assignee(db, med, contacts=selected_contacts)
    normalized_stock = max(int(new_stock_total_doses or 0), 0)
    purchase = models.MedicationPurchase(
        user_id=int(getattr(med, "user_id", 0) or 0),
        medication_id=int(getattr(med, "id", 0) or 0),
        profile_id=int(getattr(profile, "id", 0) or 0) or None,
        assigned_user_id=int(assignee.get("user_id") or 0) if assignee else None,
        purchased_by_user_id=int(getattr(current_user, "id", 0) or 0) or None,
        medication_name_snapshot=(getattr(med, "name", None) or "").strip(),
        dose_snapshot=(getattr(med, "dose", None) or "").strip(),
        assigned_name_snapshot=(assignee.get("name") if assignee else "") or "",
        purchased_by_name_snapshot=(getattr(current_user, "name", None) or getattr(current_user, "email", None) or "").strip(),
        quantity_added_doses=normalized_stock,
        previous_remaining_doses=previous_remaining,
        new_stock_total_doses=normalized_stock,
        amount_total=amount_total,
        currency=((currency or "CLP").strip().upper() or "CLP")[:8],
        notes=_clip_text(notes or "", 500),
        receipt_filename=receipt_filename,
        receipt_mime_type=receipt_mime_type,
        receipt_file_data=receipt_bytes,
        purchased_at=purchased_at or datetime.now(),
    )
    if normalized_stock > 0:
        med.stock_total_doses = normalized_stock
    med.refill_rotation_index = int(getattr(med, "refill_rotation_index", 0) or 0) + 1
    med.refill_last_notified_at = None
    med.refill_last_notified_remaining = None
    db.add(purchase)
    db.add(med)
    return _decorate_medication_purchase(purchase)


def _attach_medication_adherence(
    db: Session,
    medications: list[models.Medication],
    current_user: models.User,
    profile_id: int | None = None,
    owner_user_id: int | None = None,
):
    if not medications:
        return medications

    now = datetime.now()
    medication_ids = [m.id for m in medications if getattr(m, "id", None)]
    status_counts = {
        int(mid): {"taken": 0, "late": 0, "missed": 0, "skipped": 0}
        for mid in medication_ids
    }
    if medication_ids:
        intake_rows = (
            db.query(
                models.MedicationIntake.medication_id,
                models.MedicationIntake.status,
            )
            .filter(
                models.MedicationIntake.user_id == (owner_user_id or current_user.id),
                models.MedicationIntake.medication_id.in_(medication_ids),
            )
            .all()
        )
        for medication_id, status in intake_rows:
            key = _normalize_adherence_status(status)
            if int(medication_id) not in status_counts:
                continue
            if key not in status_counts[int(medication_id)]:
                key = "taken"
            status_counts[int(medication_id)][key] += 1

    for med in medications:
        expected = _calculate_expected_doses_until(med, now)
        med_counts = status_counts.get(int(med.id), {})
        taken = int((med_counts.get("taken") or 0) + (med_counts.get("late") or 0))
        explicit_missed = int((med_counts.get("missed") or 0) + (med_counts.get("skipped") or 0))
        missed = max(explicit_missed, max(expected - taken, 0))
        adherence = None
        if expected > 0:
            adherence = round(min((taken / expected) * 100, 100), 1)
        setattr(med, "expected_doses", expected)
        setattr(med, "taken_doses", taken)
        setattr(med, "missed_doses", missed)
        setattr(med, "adherence_rate", adherence)
        _populate_medication_refill_state(db, med, taken_doses=taken)

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


def _job_batch_limit(job_name: str, default: int) -> int:
    env_key = f"{job_name.upper()}_BATCH_SIZE"
    raw = (os.getenv(env_key) or "").strip()
    try:
        return max(1, int(raw or default))
    except Exception:
        return max(1, int(default or 1))


def _job_item_limit(job_name: str, item_name: str, default: int) -> int:
    env_key = f"{job_name.upper()}_{item_name.upper()}_LIMIT"
    raw = (os.getenv(env_key) or "").strip()
    try:
        return max(1, int(raw or default))
    except Exception:
        return max(1, int(default or 1))


def _job_timeout_seconds(job_name: str, default: int | None = None) -> int:
    env_key = f"{job_name.upper()}_TIMEOUT_SECONDS"
    raw = (os.getenv(env_key) or "").strip()
    fallback = default if default is not None else WORKER_JOB_TIMEOUT_SECONDS
    try:
        return max(5, int(raw or fallback))
    except Exception:
        return max(5, int(fallback or WORKER_JOB_TIMEOUT_SECONDS))


def _job_retry_count(job_name: str, default: int | None = None) -> int:
    env_key = f"{job_name.upper()}_RETRIES"
    raw = (os.getenv(env_key) or "").strip()
    fallback = default if default is not None else WORKER_JOB_RETRIES
    try:
        return max(0, int(raw or fallback))
    except Exception:
        return max(0, int(fallback or WORKER_JOB_RETRIES))


def _job_deadline_exceeded(deadline_at: float | None) -> bool:
    return bool(deadline_at and time.time() >= float(deadline_at))


def _format_job_metrics(metrics: dict) -> str:
    parts = []
    for key, value in (metrics or {}).items():
        if isinstance(value, bool):
            value = "yes" if value else "no"
        parts.append(f"{key}={value}")
    return " ".join(parts)


def _record_observability_metric(
    observability: dict | None,
    *,
    module_name: str,
    elapsed_ms: float,
    rollback: bool = False,
):
    if observability is None:
        return
    observability["db_query_ms"] = round(float(observability.get("db_query_ms", 0.0) or 0.0) + float(elapsed_ms or 0.0), 1)
    observability["db_query_count"] = int(observability.get("db_query_count", 0) or 0) + 1
    module_map = dict(observability.get("db_modules") or {})
    module_map[module_name] = round(float(elapsed_ms or 0.0), 1)
    observability["db_modules"] = module_map
    if rollback:
        observability["rollback_count"] = int(observability.get("rollback_count", 0) or 0) + 1


def _prune_old_push_logs(db: Session, now_global: datetime | None = None):
    now_value = now_global or datetime.now(_resolve_user_tz(None))
    cutoff = now_value - timedelta(days=90)
    db.query(models.PushNotificationLog).filter(
        models.PushNotificationLog.sent_at < cutoff
    ).delete()
    db.commit()


def _load_subscribed_user_ids(db: Session, limit: int | None = None) -> list[int]:
    rows = (
        db.query(models.PushSubscription.user_id)
        .distinct()
        .order_by(models.PushSubscription.user_id.asc())
        .all()
    )
    user_ids = [row[0] for row in rows if row and row[0]]
    if limit:
        return user_ids[: max(1, int(limit))]
    return user_ids


def _load_notification_users(
    db: Session,
    *,
    kind: str,
    limit: int | None = None,
) -> list[models.User]:
    rows = (
        db.query(models.User)
        .outerjoin(
            models.PushSubscription,
            models.PushSubscription.user_id == models.User.id,
        )
        .filter(
            models.User.deleted.is_(False),
            or_(
                models.User.email_reminders_enabled.is_(True),
                models.PushSubscription.id.isnot(None),
            ),
        )
        .order_by(models.User.id.asc())
        .distinct()
        .all()
    )
    enabled_users = []
    for user in rows:
        settings = _user_notification_settings(user)
        if kind == "appointment" and not bool(settings.get("appointmentReminders", True)):
            continue
        if kind == "medication" and not bool(settings.get("medicationReminders", True)):
            continue
        enabled_users.append(user)
        if limit and len(enabled_users) >= max(1, int(limit)):
            break
    return enabled_users


def _active_refill_candidates(
    db: Session,
    *,
    limit: int,
    now: datetime | None = None,
) -> list[models.Medication]:
    current_dt = now or datetime.now()
    return (
        db.query(models.Medication)
        .filter(
            models.Medication.refill_enabled.is_(True),
            models.Medication.completed.is_(False),
            models.Medication.stock_total_doses > 0,
            models.Medication.refill_alert_threshold_doses > 0,
            models.Medication.refill_last_notified_at.is_(None),
            or_(
                models.Medication.end_date.is_(None),
                models.Medication.end_date >= current_dt,
            ),
        )
        .order_by(models.Medication.created_at.desc().nullslast(), models.Medication.id.asc())
        .limit(max(1, int(limit)))
        .all()
    )


def _job_send_appointment_reminders(
    deadline_at: float | None = None,
    user_limit: int | None = None,
) -> dict:
    push_enabled = _push_configured()
    user_batch = max(
        1,
        int(user_limit or _job_batch_limit("send_appointment_reminders", APPOINTMENT_REMINDER_BATCH_SIZE)),
    )
    appointment_limit = _job_item_limit(
        "send_appointment_reminders",
        "appointment",
        APPOINTMENT_REMINDER_APPOINTMENT_LIMIT,
    )
    db = SessionLocal()
    metrics = {
        "job": "send_appointment_reminders",
        "users": 0,
        "appointments": 0,
        "push_sent": 0,
        "email_sent": 0,
        "errors": 0,
        "timed_out": False,
        "limit_hit": False,
        "db_query_ms": 0.0,
        "rollback_count": 0,
    }
    try:
        started_query_at = time.perf_counter()
        now_global = datetime.now(_resolve_user_tz(None))
        _prune_old_push_logs(db, now_global)
        notification_users = _load_notification_users(
            db,
            kind="appointment",
            limit=user_batch,
        )
        metrics["db_query_ms"] = round(metrics["db_query_ms"] + ((time.perf_counter() - started_query_at) * 1000), 1)
        for user in notification_users:
            if _job_deadline_exceeded(deadline_at):
                metrics["timed_out"] = True
                break
            user_id = int(user.id)
            metrics["users"] += 1
            user_tz = _resolve_user_tz(user)
            now = datetime.now(user_tz)
            now_naive = now.replace(tzinfo=None)
            # Only fetch appointments within the reminder horizon.
            # The max reminder offset is 7 days before, so appointments older
            # than 8 days ago are irrelevant and skipped to avoid wasted work.
            oldest_relevant = now_naive - timedelta(days=8)
            appointments_started_at = time.perf_counter()
            appointments = (
                db.query(models.Appointment)
                .filter(
                    models.Appointment.user_id == user_id,
                    models.Appointment.date_time.isnot(None),
                    models.Appointment.date_time >= oldest_relevant,
                    models.Appointment.status != models.AppointmentStatus.realizada,
                )
                .all()
            )
            metrics["db_query_ms"] = round(metrics["db_query_ms"] + ((time.perf_counter() - appointments_started_at) * 1000), 1)
            for appt in appointments:
                if _job_deadline_exceeded(deadline_at):
                    metrics["timed_out"] = True
                    break
                if metrics["appointments"] >= appointment_limit:
                    metrics["limit_hit"] = True
                    break
                metrics["appointments"] += 1
                appt_dt = _to_schedule_tz(appt.date_time, user_tz)
                if not appt_dt:
                    continue
                for offset in _appointment_offsets_for_user(user):
                    trigger_at = appt_dt - offset["delta"]
                    if not _is_due(now, trigger_at):
                        continue
                    label = offset["label"]
                    tag = f"appointment-{appt.id}-{label}-user-{user_id}"
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
                    ok = False
                    if push_enabled:
                        ok = bool(_send_push_to_user(
                            db,
                            user_id,
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
                        ))
                    if ok:
                        _record_sent(db, user_id, tag, "appointment", trigger_at, now)
                        metrics["push_sent"] += 1
                    email_tag = f"appointment-email-{appt.id}-{label}"
                    if (
                        user.email
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
                        metrics["email_sent"] += 1
            if metrics["timed_out"]:
                break
            if metrics["limit_hit"]:
                break
        return metrics
    except Exception:
        metrics["errors"] += 1
        metrics["rollback_count"] += 1
        raise
    finally:
        db.close()


def _job_send_medication_reminders(
    deadline_at: float | None = None,
    user_limit: int | None = None,
) -> dict:
    push_enabled = _push_configured()
    user_batch = max(
        1,
        int(user_limit or _job_batch_limit("send_medication_reminders", MEDICATION_REMINDER_BATCH_SIZE)),
    )
    medication_limit = _job_item_limit(
        "send_medication_reminders",
        "medication",
        MEDICATION_REMINDER_MEDICATION_LIMIT,
    )
    db = SessionLocal()
    metrics = {
        "job": "send_medication_reminders",
        "users": 0,
        "medications": 0,
        "push_sent": 0,
        "email_sent": 0,
        "errors": 0,
        "timed_out": False,
        "limit_hit": False,
        "db_query_ms": 0.0,
        "rollback_count": 0,
    }
    try:
        users_started_at = time.perf_counter()
        notification_users = _load_notification_users(
            db,
            kind="medication",
            limit=user_batch,
        )
        metrics["db_query_ms"] = round(metrics["db_query_ms"] + ((time.perf_counter() - users_started_at) * 1000), 1)
        for user in notification_users:
            if _job_deadline_exceeded(deadline_at):
                metrics["timed_out"] = True
                break
            user_id = int(user.id)
            metrics["users"] += 1
            user_tz = _resolve_user_tz(user)
            now = datetime.now(user_tz)
            # DB stores naive datetimes; strip tzinfo for SQL comparison to avoid
            # ProgrammingError on PostgreSQL (TIMESTAMP vs TIMESTAMPTZ mismatch).
            now_naive = now.replace(tzinfo=None)
            medications_started_at = time.perf_counter()
            medications = (
                db.query(models.Medication)
                .filter(
                    models.Medication.user_id == user_id,
                    or_(
                        models.Medication.end_date.is_(None),
                        models.Medication.end_date >= now_naive,
                    ),
                    models.Medication.completed.is_(False),
                )
                .all()
            )
            metrics["db_query_ms"] = round(metrics["db_query_ms"] + ((time.perf_counter() - medications_started_at) * 1000), 1)
            for med in medications:
                if _job_deadline_exceeded(deadline_at):
                    metrics["timed_out"] = True
                    break
                if metrics["medications"] >= medication_limit:
                    metrics["limit_hit"] = True
                    break
                metrics["medications"] += 1
                for trigger_exact in _medication_schedule_events_between(
                    med,
                    now - timedelta(minutes=MEDICATION_LEAD_MINUTES + 5),
                    now + timedelta(days=2),
                ):
                    if _job_deadline_exceeded(deadline_at):
                        metrics["timed_out"] = True
                        break
                    trigger_exact_ms = int(trigger_exact.timestamp() * 1000)
                    for offset_minutes in [MEDICATION_LEAD_MINUTES, 0]:
                        trigger_at = trigger_exact - timedelta(minutes=offset_minutes)
                        if not _is_due(now, trigger_at):
                            continue
                        tag = (
                            f"medication-{med.id}-{trigger_exact_ms}-lead-{offset_minutes}-user-{user_id}"
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
                        ok = False
                        if push_enabled:
                            ok = bool(_send_push_to_user(
                                db,
                                user_id,
                                {
                                    "title": title,
                                    "body": body,
                                    "url": f"/medications?notify=1&medicationId={med.id}&trigger={trigger_exact_ms}",
                                    "priority": "high" if offset_minutes == 0 else "normal",
                                    "sound": "medication",
                                    "medicationId": med.id,
                                    "userId": user_id,
                                    "tag": tag,
                                },
                            ))
                        if ok:
                            _record_sent(db, user_id, tag, "medication", trigger_at, now)
                            metrics["push_sent"] += 1
                        if (
                            user.email
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
                            metrics["email_sent"] += 1
                    if metrics["timed_out"]:
                        break
                if metrics["timed_out"]:
                    break
                if metrics["limit_hit"]:
                    break
            if metrics["limit_hit"]:
                break
        return metrics
    except Exception:
        metrics["errors"] += 1
        metrics["rollback_count"] += 1
        raise
    finally:
        db.close()


def _job_send_note_reminders(deadline_at: float | None = None) -> dict:
    db = SessionLocal()
    metrics = {"job": "send_note_reminders", "sent": 0, "errors": 0}
    try:
        # reminder_at is stored as UTC naive (frontend sends UTC ISO with Z).
        # Compare against utcnow() to match regardless of server TZ.
        now = datetime.utcnow()
        window_start = now - timedelta(seconds=SCHEDULE_WINDOW_SECONDS)
        due_notes = (
            db.query(models.ProfileNote)
            .filter(
                models.ProfileNote.reminder_at.isnot(None),
                models.ProfileNote.reminder_sent.is_(False),
                models.ProfileNote.visibility != "done",
                models.ProfileNote.reminder_at >= window_start,
                models.ProfileNote.reminder_at <= now,
            )
            .limit(50)
            .all()
        )
        for note in due_notes:
            if deadline_at and time.time() >= deadline_at:
                break
            try:
                tag = f"note-reminder-{note.id}"
                body = note.note[:120] + ("..." if len(note.note) > 120 else "")
                sent = _send_push_to_user(
                    db,
                    note.created_by_user_id,
                    {
                        "title": "Recordatorio de nota",
                        "body": body,
                        "url": "/",
                        "kind": "note",
                        "noteId": note.id,
                        "userId": note.created_by_user_id,
                        "tag": tag,
                    },
                )
                note.reminder_sent = True
                db.add(note)
                db.commit()
                if sent:
                    metrics["sent"] += 1
            except Exception as exc:
                db.rollback()
                metrics["errors"] += 1
                print(f"WARNING note reminder note_id={note.id}: {exc}")
    finally:
        db.close()
    return metrics


def _job_send_refill_alerts(
    deadline_at: float | None = None,
    medication_limit: int | None = None,
) -> dict:
    medication_batch = max(
        1,
        int(medication_limit or _job_batch_limit("send_refill_alerts", REFILL_ALERT_BATCH_SIZE)),
    )
    db = SessionLocal()
    metrics = {
        "job": "send_refill_alerts",
        "medications": 0,
        "errors": 0,
        "timed_out": False,
        "limit_hit": False,
        "db_query_ms": 0.0,
        "rollback_count": 0,
    }
    try:
        refill_started_at = time.perf_counter()
        refill_candidates = _active_refill_candidates(
            db,
            limit=medication_batch,
        )
        metrics["db_query_ms"] = round(metrics["db_query_ms"] + ((time.perf_counter() - refill_started_at) * 1000), 1)
        if len(refill_candidates) >= medication_batch:
            metrics["limit_hit"] = True
        for med in refill_candidates:
            if _job_deadline_exceeded(deadline_at):
                metrics["timed_out"] = True
                break
            try:
                owner_user = db.query(models.User).filter(models.User.id == med.user_id).first()
                _handle_medication_refill_notifications(
                    db,
                    med,
                    owner_user=owner_user,
                )
                metrics["medications"] += 1
            except Exception as exc:
                db.rollback()
                metrics["errors"] += 1
                metrics["rollback_count"] += 1
                print(
                    f"WARNING medication refill notifications {getattr(med, 'id', '?')}: {exc}"
                )
        return metrics
    finally:
        db.close()


def _send_scheduled_push_reminders():
    summaries = [
        _job_send_appointment_reminders(),
        _job_send_medication_reminders(),
        _job_send_refill_alerts(),
    ]
    print(
        "INFO scheduler reminders: "
        + " | ".join(_format_job_metrics(item) for item in summaries if item)
    )


_scheduler_started = False
_last_ai_refresh_ts = 0.0


def _mark_family_ai_dirty(
    db: Session,
    user: models.User | None,
    requested_at: datetime | None = None,
):
    if not user:
        return
    user.family_ai_needs_refresh = True
    user.family_ai_refresh_requested_at = requested_at or datetime.now()
    db.add(user)


def _family_ai_eligible(db: Session, user: models.User | None) -> bool:
    if not user:
        return False
    plan_info = _build_plan_info(user, db)
    if not bool(plan_info.get("collaboration_enabled")):
        return False
    accepted_links = _accepted_profile_links_for_user(db, user)
    return len(accepted_links) > 1


def _mark_profile_ai_dirty(
    db: Session,
    profile: models.HealthProfile | None,
    include_family: bool = True,
    requested_at: datetime | None = None,
):
    if not profile or bool(getattr(profile, "is_archived", False)):
        return
    mark_at = requested_at or datetime.now()
    profile.ai_needs_refresh = True
    profile.ai_refresh_requested_at = mark_at
    db.add(profile)
    owner_user = (
        db.query(models.User).filter(models.User.id == int(profile.owner_user_id)).first()
    )
    if include_family and _family_ai_eligible(db, owner_user):
        _mark_family_ai_dirty(db, owner_user, mark_at)


def _load_dirty_profiles_for_refresh(
    db: Session,
    limit: int = AI_REFRESH_BATCH_SIZE,
) -> list[models.HealthProfile]:
    rows = (
        db.query(models.HealthProfile, models.User.active_health_profile_id)
        .join(models.User, models.User.id == models.HealthProfile.owner_user_id)
        .filter(
            models.HealthProfile.is_archived.is_(False),
            models.HealthProfile.ai_needs_refresh.is_(True),
        )
        .order_by(
            func.coalesce(
                models.HealthProfile.ai_refresh_requested_at,
                models.HealthProfile.created_at,
            ).asc()
        )
        .all()
    )
    rows.sort(key=lambda item: 0 if item[1] == item[0].id else 1)
    return [item[0] for item in rows[: max(1, int(limit or AI_REFRESH_BATCH_SIZE))]]


def _load_dirty_family_users_for_refresh(
    db: Session,
    limit: int = AI_REFRESH_BATCH_SIZE,
) -> list[models.User]:
    return (
        db.query(models.User)
        .filter(models.User.family_ai_needs_refresh.is_(True))
        .order_by(
            func.coalesce(
                models.User.family_ai_refresh_requested_at,
                models.User.created_at,
            ).asc()
        )
        .limit(max(1, int(limit or AI_REFRESH_BATCH_SIZE)))
        .all()
    )


def _user_has_pending_profile_refresh(db: Session, user_id: int) -> bool:
    return bool(
        db.query(models.HealthProfile.id)
        .filter(
            models.HealthProfile.owner_user_id == int(user_id),
            models.HealthProfile.is_archived.is_(False),
            models.HealthProfile.ai_needs_refresh.is_(True),
        )
        .first()
    )


def _family_ai_should_refresh_now(db: Session, user: models.User | None) -> bool:
    if not user or not _family_ai_eligible(db, user):
        return False
    if _user_has_pending_profile_refresh(db, user.id):
        return False
    last_family_refresh = getattr(user, "family_ai_last_refreshed_at", None)
    if not last_family_refresh:
        return True
    profile_rows = (
        db.query(models.HealthProfile.ai_last_refreshed_at)
        .join(
            models.ProfileRelationship,
            models.ProfileRelationship.profile_id == models.HealthProfile.id,
        )
        .filter(
            models.ProfileRelationship.user_id == int(user.id),
            models.ProfileRelationship.status == "accepted",
            models.HealthProfile.is_archived.is_(False),
        )
        .all()
    )
    refreshed_values = [row[0] for row in profile_rows if row and row[0]]
    if not refreshed_values:
        return False
    latest_profile_refresh = max(refreshed_values)
    return bool(latest_profile_refresh and latest_profile_refresh > last_family_refresh)


def _refresh_profile_ai_analytics(db: Session, profile: models.HealthProfile):
    if not profile or bool(getattr(profile, "is_archived", False)):
        return
    owner_user_id = int(profile.owner_user_id)
    owner_user = db.query(models.User).filter(models.User.id == owner_user_id).first()
    if owner_user:
        _materialize_medication_adherence_events(db, owner_user)
    appointments = (
        db.query(models.Appointment)
        .filter(models.Appointment.user_id == owner_user_id)
        .order_by(models.Appointment.date_time.asc().nullslast())
        .all()
    )
    medications = (
        db.query(models.Medication)
        .filter(models.Medication.user_id == owner_user_id)
        .order_by(models.Medication.created_at.desc())
        .all()
    )
    documents = (
        db.query(models.Document)
        .filter(models.Document.user_id == owner_user_id)
        .order_by(models.Document.created_at.desc())
        .all()
    )
    advanced_context = _build_advanced_health_context(
        db,
        profile,
        appointments,
        medications,
        documents,
        refresh=True,
    )
    _refresh_profile_ai_learning_memory(db, owner_user_id)
    _refresh_profile_ai_summary(
        db,
        profile,
        appointments,
        medications,
        documents,
        advanced_context,
    )
    now_dt = datetime.now()
    profile.ai_needs_refresh = False
    profile.ai_refresh_requested_at = None
    profile.ai_last_refreshed_at = now_dt
    db.add(profile)


def _job_refresh_profile_ai(
    deadline_at: float | None = None,
    batch_limit: int | None = None,
) -> dict:
    db = SessionLocal()
    profile_batch = max(
        1,
        int(batch_limit or _job_batch_limit("refresh_profile_ai", AI_REFRESH_BATCH_SIZE)),
    )
    metrics = {
        "job": "refresh_profile_ai",
        "queued": 0,
        "refreshed": 0,
        "errors": 0,
        "timed_out": False,
        "limit_hit": False,
        "db_query_ms": 0.0,
        "rollback_count": 0,
    }
    try:
        profiles_started_at = time.perf_counter()
        profiles = _load_dirty_profiles_for_refresh(db, profile_batch)
        metrics["db_query_ms"] = round(metrics["db_query_ms"] + ((time.perf_counter() - profiles_started_at) * 1000), 1)
        metrics["queued"] = len(profiles)
        if len(profiles) >= profile_batch:
            metrics["limit_hit"] = True
        for profile in profiles:
            if _job_deadline_exceeded(deadline_at):
                metrics["timed_out"] = True
                break
            try:
                _refresh_profile_ai_analytics(db, profile)
                db.commit()
                metrics["refreshed"] += 1
            except Exception as exc:
                db.rollback()
                metrics["errors"] += 1
                metrics["rollback_count"] += 1
                print(f"WARNING ai_refresh profile {getattr(profile, 'id', 'unknown')}: {exc}")
        return metrics
    finally:
        db.close()


def _job_refresh_family_ai(
    deadline_at: float | None = None,
    batch_limit: int | None = None,
) -> dict:
    db = SessionLocal()
    user_batch = max(
        1,
        int(batch_limit or _job_batch_limit("refresh_family_ai", FAMILY_AI_REFRESH_BATCH_SIZE)),
    )
    metrics = {
        "job": "refresh_family_ai",
        "queued": 0,
        "refreshed": 0,
        "skipped_pending_profile": 0,
        "errors": 0,
        "timed_out": False,
        "limit_hit": False,
        "db_query_ms": 0.0,
        "rollback_count": 0,
    }
    try:
        family_started_at = time.perf_counter()
        family_users = _load_dirty_family_users_for_refresh(db, user_batch)
        metrics["db_query_ms"] = round(metrics["db_query_ms"] + ((time.perf_counter() - family_started_at) * 1000), 1)
        metrics["queued"] = len(family_users)
        if len(family_users) >= user_batch:
            metrics["limit_hit"] = True
        for user in family_users:
            if _job_deadline_exceeded(deadline_at):
                metrics["timed_out"] = True
                break
            try:
                if _user_has_pending_profile_refresh(db, user.id):
                    metrics["skipped_pending_profile"] += 1
                    continue
                if not _family_ai_should_refresh_now(db, user):
                    user.family_ai_needs_refresh = False
                    user.family_ai_refresh_requested_at = None
                    db.add(user)
                    db.commit()
                    continue
                if _family_ai_eligible(db, user):
                    _refresh_family_ai_summary(db, user, 7)
                    _refresh_family_ai_summary(db, user, 30)
                user.family_ai_needs_refresh = False
                user.family_ai_refresh_requested_at = None
                user.family_ai_last_refreshed_at = datetime.now()
                db.add(user)
                db.commit()
                metrics["refreshed"] += 1
            except Exception as exc:
                db.rollback()
                metrics["errors"] += 1
                metrics["rollback_count"] += 1
                print(f"WARNING family_ai_refresh user {getattr(user, 'id', 'unknown')}: {exc}")
        return metrics
    finally:
        db.close()


def _start_scheduler():
    global _scheduler_started
    if _scheduler_started:
        return
    from app.jobs.registry import format_job_metrics, run_scheduled_jobs_once, schedule_interval_seconds
    from app.jobs.runtime import start_embedded_scheduler

    _scheduler_started = True
    start_embedded_scheduler(
        run_once=run_scheduled_jobs_once,
        format_metrics=format_job_metrics,
        interval_seconds=schedule_interval_seconds(),
    )

app = FastAPI(title="MiRutaSalud API")

@app.on_event("startup")
def _startup_event():
    from app.jobs.registry import embedded_scheduler_enabled

    if embedded_scheduler_enabled():
        print("INFO startup: embedded scheduler enabled")
        _start_scheduler()
    else:
        print("INFO startup: embedded scheduler disabled for web process")


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
                profile = _resolve_profile_for_user_learning(db, medication.user_id)
                _mark_profile_ai_dirty(db, profile, include_family=True)
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

        try:
            _upsert_document_intelligence(db, doc)
            _upsert_document_memory_chunks(db, doc, profile_id=_resolve_document_profile_id(db, doc))
        except Exception as exc:
            print(f"WARNING _run_document_ocr memory sync: {exc}")

        user = db.query(models.User).filter(models.User.id == doc.user_id).first()
        profile = _resolve_profile_for_user_learning(db, doc.user_id)
        _mark_profile_ai_dirty(db, profile, include_family=True)
        db.commit()
        if user and user.email and detected_meds_for_email:
            _send_medications_detected_email_safe(
                user.email,
                user.name or "",
                detected_meds_for_email,
            )
    finally:
        db.close()


# ── CORS ─────────────────────────────────────────────────────────────────
is_production = _is_production_env()
if is_production:
    # En produccion solo se admiten los origenes configurados explicitamente.
    # Configura ALLOWED_ORIGINS en Railway como lista separada por comas.
    _raw_origins = os.getenv("ALLOWED_ORIGINS", "")
    allow_origins = _parse_allowed_origins(_raw_origins)
    if not allow_origins:
        raise RuntimeError(
            "ALLOWED_ORIGINS no esta configurado en produccion. "
            "Define los dominios permitidos en Railway, separados por comas."
        )
    allow_origin_regex = None
    allow_credentials = False
else:
    allow_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    # Permitir cualquier puerto local en desarrollo para no depender del puerto
    # exacto que Vite asigne cuando 5173 ya está ocupado.
    allow_origin_regex = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=allow_credentials,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
    expose_headers=["Retry-After"],
)
# ───────────────────────────────────────────────────────────────────────────


# ── Security headers ──────────────────────────────────────────────────────
@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"]  = "nosniff"
    response.headers["X-Frame-Options"]          = "DENY"
    response.headers["X-XSS-Protection"]         = "1; mode=block"
    response.headers["Referrer-Policy"]           = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"]        = "camera=(), microphone=(self), geolocation=()"
    if is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response
# ───────────────────────────────────────────────────────────────────────────


# Health check
@app.get("/health")
def health_check(db: Session = Depends(auth.get_db)):
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "timestamp": timestamp},
        )

    return {"status": "ok", "timestamp": timestamp}


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

    ensure_medication_schema(force=True)
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


# Debug endpoints — solo disponibles en entorno de desarrollo
def _require_dev_env():
    if is_production:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")


@app.get("/debug/config")
def debug_config():
    _require_dev_env()
    return {
        "secret_key_configured": bool(auth.SECRET_KEY),
        "algorithm": auth.ALGORITHM,
        "token_expire_minutes": auth.ACCESS_TOKEN_EXPIRE_MINUTES,
        "environment": "development",
        "database_url_configured": bool(os.getenv("DATABASE_URL")),
    }



def _build_plan_info(user: models.User, db: Session) -> dict:
    plan_type = _normalize_plan_type(getattr(user, "plan_type", None))
    features = _plan_features(plan_type)
    return {
        "plan_type": plan_type,
        "max_profiles": int(features.get("max_profiles", 1)),
        "collaboration_enabled": bool(features.get("collaboration_enabled", False)),
        "family_panel_enabled": bool(features.get("family_panel_enabled", False)),
        "current_profiles": _count_owned_profiles(db, user.id),
        "ai_access_level": _safe_text(features.get("ai_access_level", "basica"))[:20] or "basica",
        "ai_chat_daily_limit": (
            int(features["ai_chat_daily_limit"])
            if features.get("ai_chat_daily_limit") is not None
            else None
        ),
    }


def _count_ai_chat_messages_today(db: Session, user_id: int) -> int:
    now = datetime.now()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    return (
        db.query(models.AiConversationMessage)
        .filter(
            models.AiConversationMessage.user_id == user_id,
            models.AiConversationMessage.role == "user",
            models.AiConversationMessage.created_at >= day_start,
            models.AiConversationMessage.created_at < day_end,
        )
        .count()
    )


def _assert_ai_chat_capacity_available(db: Session, current_user: models.User) -> None:
    plan_info = _build_plan_info(current_user, db)
    daily_limit = plan_info.get("ai_chat_daily_limit")
    if daily_limit is None:
        return
    used_today = _count_ai_chat_messages_today(db, current_user.id)
    if used_today >= int(daily_limit):
        raise HTTPException(
            status_code=429,
            detail=(
                f"Tu plan {str(plan_info.get('plan_type') or 'basico').capitalize()} incluye Klinip IA "
                f"con hasta {int(daily_limit)} consultas al día. Vuelve mañana o cambia a Plus o Familiar "
                "para usar IA completa."
            ),
        )


def _plan_allows_collaboration_for_user(user: models.User | None) -> bool:
    if not user:
        return False
    info = _plan_features(getattr(user, "plan_type", None))
    return bool(info.get("collaboration_enabled", False))


def _assert_collaboration_enabled(
    current_user: models.User,
    db: Session | None = None,
    owner_user_id: int | None = None,
):
    info = None
    if db is not None and owner_user_id:
        owner_user = db.query(models.User).filter(models.User.id == int(owner_user_id)).first()
        if owner_user:
            info = _plan_features(getattr(owner_user, "plan_type", None))
    if info is None:
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
    "voice_auto_share_enabled": False,
    "voice_auto_share_include_audio": True,
    "voice_auto_share_recipient_ids": [],
}


_PROFILE_AUTOMATION_BOOL_KEYS = {
    "smart_alerts_enabled",
    "medication_overdue_alerts",
    "upcoming_appointment_alerts",
    "inactivity_alerts",
    "weekly_family_report_enabled",
    "auto_email_caregivers",
    "voice_auto_share_enabled",
    "voice_auto_share_include_audio",
}


_PROFILE_AUTOMATION_LIST_INT_KEYS = {
    "voice_auto_share_recipient_ids",
}


def _normalize_profile_automation_list_int(value) -> list[int]:
    if not isinstance(value, list):
        return []
    normalized: list[int] = []
    seen: set[int] = set()
    for raw in value:
        try:
            item = int(raw)
        except Exception:
            continue
        if item <= 0 or item in seen:
            continue
        seen.add(item)
        normalized.append(item)
    return normalized


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
            if key in _PROFILE_AUTOMATION_BOOL_KEYS:
                settings[key] = bool(parsed.get(key))
            elif key in _PROFILE_AUTOMATION_LIST_INT_KEYS:
                settings[key] = _normalize_profile_automation_list_int(parsed.get(key))
    return settings


def _serialize_profile_automation_settings(settings: dict) -> str:
    normalized = dict(_DEFAULT_PROFILE_AUTOMATION_SETTINGS)
    for key in normalized.keys():
        if key in settings:
            if key in _PROFILE_AUTOMATION_BOOL_KEYS:
                normalized[key] = bool(settings.get(key))
            elif key in _PROFILE_AUTOMATION_LIST_INT_KEYS:
                normalized[key] = _normalize_profile_automation_list_int(settings.get(key))
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
                    title="Cita próxima en menos de 24 horas",
                    message=(
                        f"{upcoming.specialty or 'Atención médica'} en "
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
    user_avatar_url = ""
    if user:
        primary = next(
            (p for p in user.health_profiles_owned if p.is_primary_profile and not p.is_archived),
            None,
        )
        if primary and primary.avatar_url and primary.avatar_url.startswith("data:"):
            user_avatar_url = primary.avatar_url
    return schemas.ProfileRelationshipOut(
        id=link.id,
        profile_id=link.profile_id,
        user_id=link.user_id,
        user_name=(user.name if user else ""),
        user_email=(user.email if user else ""),
        user_avatar_url=user_avatar_url,
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
        color=item.color or "yellow",
        reminder_at=item.reminder_at,
        reminder_sent=bool(item.reminder_sent),
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


def _get_active_profile_context(
    db: Session,
    current_user: models.User,
    require_write: bool = False,
):
    """
    Resuelve el perfil activo y devuelve (profile, link, owner_user_id).
    owner_user_id corresponde al dueño real de los datos clínicos.
    """
    active_id = getattr(current_user, "active_health_profile_id", None)
    if active_id:
        profile, link = _get_profile_access_or_404(db, current_user, int(active_id))
    else:
        links = (
            db.query(models.ProfileRelationship)
            .join(models.HealthProfile, models.HealthProfile.id == models.ProfileRelationship.profile_id)
            .filter(
                models.ProfileRelationship.user_id == current_user.id,
                models.ProfileRelationship.status == "accepted",
                models.HealthProfile.is_archived.is_(False),
            )
            .order_by(
                models.HealthProfile.is_primary_profile.desc(),
                models.ProfileRelationship.created_at.asc(),
            )
            .all()
        )
        if not links:
            raise HTTPException(status_code=404, detail="No tienes perfiles activos")
        link = links[0]
        profile = link.profile
        current_user.active_health_profile_id = profile.id
        db.add(current_user)
        db.commit()
        db.refresh(current_user)

    if require_write:
        _require_role(link, "caregiver")
    return profile, link, profile.owner_user_id


def _require_role(link: models.ProfileRelationship, min_role: str = "admin"):
    got = ROLE_LEVELS.get((link.role or "").strip().lower(), 0)
    needed = ROLE_LEVELS.get(min_role.strip().lower(), 3)
    if got < needed:
        raise HTTPException(status_code=403, detail="No tienes permisos para esta accion")


def _document_scope_filter(profile: models.HealthProfile, target_user_id: int):
    base_filter = models.Document.user_id == int(target_user_id)
    if bool(getattr(profile, "is_primary_profile", False)):
        return base_filter, or_(
            models.Document.profile_id == int(profile.id),
            models.Document.profile_id.is_(None),
        )
    return base_filter, models.Document.profile_id == int(profile.id)


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


AI_KLINIP_DISCLAIMER = (
    "Klinip IA entrega informacion orientativa y no reemplaza la evaluacion "
    "de un profesional de salud."
)


def _ai_model_name() -> str:
    return (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip() or "gpt-4o-mini"


def _ai_temperature() -> float:
    raw = (os.getenv("OPENAI_TEMPERATURE") or "0.2").strip()
    try:
        value = float(raw)
    except Exception:
        return 0.2
    return max(0.0, min(1.0, value))


def _ai_max_output_tokens() -> int:
    raw = (os.getenv("OPENAI_MAX_OUTPUT_TOKENS") or "400").strip()
    try:
        value = int(raw)
    except Exception:
        return 400
    return max(80, min(1200, value))


def _ai_openai_timeout_seconds() -> float:
    raw = (os.getenv("OPENAI_TIMEOUT_SECONDS") or "20").strip()
    try:
        value = float(raw)
    except Exception:
        return 20.0
    return max(5.0, min(60.0, value))


def _ai_db_statement_timeout_ms() -> int:
    raw = (os.getenv("AI_DB_STATEMENT_TIMEOUT_MS") or "2200").strip()
    try:
        value = int(raw)
    except Exception:
        return 2200
    return max(300, min(10000, value))


def _ai_context_timeout_ms() -> int:
    raw = (os.getenv("AI_CONTEXT_TIMEOUT_MS") or "2800").strip()
    try:
        value = int(raw)
    except Exception:
        return 2800
    return max(600, min(15000, value))


def _ai_chat_concurrency_limit() -> int:
    raw = (os.getenv("AI_CHAT_PROFILE_CONCURRENCY_LIMIT") or "1").strip()
    try:
        value = int(raw)
    except Exception:
        return 1
    return max(1, min(4, value))


def _ai_chat_prompt_pressure_threshold_ms(kind: str) -> int:
    defaults = {
        "lean_db_query": 900,
        "minimal_db_query": 1700,
        "lean_context": 1200,
        "minimal_context": 2200,
    }
    fallback = int(defaults.get(kind, 1200))
    raw = (os.getenv(f"AI_CHAT_{kind.upper()}_MS") or str(fallback)).strip()
    try:
        value = int(raw)
    except Exception:
        return fallback
    return max(100, min(10000, value))


_AI_EMBEDDING_DIMENSIONS = 256
_AI_RESPONSE_CACHE: dict[str, dict] = {}
_AI_RESPONSE_CACHE_LOCK = threading.Lock()
_AI_MEMORY_STOPWORDS = {
    "de", "la", "el", "los", "las", "un", "una", "unos", "unas", "que", "del",
    "para", "con", "por", "sin", "sobre", "este", "esta", "esto", "tengo",
    "tiene", "como", "donde", "cuando", "cual", "cuales", "mi", "mis", "tu",
    "sus", "hola", "favor", "puedes", "puedo", "quiero", "necesito", "me",
    "hay", "hoy", "ayer", "mañana", "manana", "segun", "según", "clinico",
    "clinica", "clinicos", "clinicas", "documento", "documentos", "perfil",
    "klinip", "ia",
}


def _ai_embedding_model_name() -> str:
    configured = (os.getenv("OPENAI_EMBEDDING_MODEL") or "").strip()
    return configured or "text-embedding-3-small"


def _ai_response_cache_ttl_seconds() -> int:
    raw = (os.getenv("AI_RESPONSE_CACHE_TTL_SECONDS") or "900").strip()
    try:
        value = int(raw)
    except Exception:
        return 900
    return max(60, min(3600, value))


def _estimate_token_count(value: str | None) -> int:
    text_value = (value or "").strip()
    if not text_value:
        return 0
    return max(1, math.ceil(len(text_value) / 4))


def _normalize_embedding(vector: list[float], dimensions: int = _AI_EMBEDDING_DIMENSIONS) -> list[float]:
    sized = [float(item or 0.0) for item in (vector or [])[:dimensions]]
    if len(sized) < dimensions:
        sized.extend([0.0] * (dimensions - len(sized)))
    norm = math.sqrt(sum(item * item for item in sized))
    if norm <= 1e-9:
        return [0.0] * dimensions
    return [round(item / norm, 8) for item in sized]


def _fallback_text_embedding(value: str, dimensions: int = _AI_EMBEDDING_DIMENSIONS) -> list[float]:
    vector = [0.0] * dimensions
    tokens = [
        token
        for token in re.split(r"[^a-z0-9]+", _normalize_text(value or ""))
        if token and len(token) >= 2
    ]
    for idx, token in enumerate(tokens[:1200]):
        digest = hashlib.sha256(f"{idx}:{token}".encode("utf-8")).digest()
        slot = int.from_bytes(digest[:2], "big") % dimensions
        sign = -1.0 if digest[2] % 2 else 1.0
        weight = 1.0 + (min(len(token), 12) / 12.0)
        vector[slot] += sign * weight
    return _normalize_embedding(vector, dimensions=dimensions)


def _cosine_similarity(left: list[float] | None, right: list[float] | None) -> float:
    if not left or not right:
        return 0.0
    size = min(len(left), len(right), _AI_EMBEDDING_DIMENSIONS)
    if size <= 0:
        return 0.0
    return float(sum(float(left[idx] or 0.0) * float(right[idx] or 0.0) for idx in range(size)))


def _pgvector_literal(vector: list[float] | None) -> str:
    values = [f"{float(item or 0.0):.8f}" for item in (vector or [])[:_AI_EMBEDDING_DIMENSIONS]]
    if len(values) < _AI_EMBEDDING_DIMENSIONS:
        values.extend(["0.00000000"] * (_AI_EMBEDDING_DIMENSIONS - len(values)))
    return "[" + ",".join(values) + "]"


def _embed_text_batch(texts: list[str]) -> tuple[list[list[float]], str, str]:
    cleaned = [_clip_text((text_value or "").strip(), 6000) for text_value in texts]
    if not cleaned:
        return [], "", "none"

    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if api_key and OpenAI is not None:
        client = OpenAI(api_key=api_key, timeout=_ai_openai_timeout_seconds())
        model_name = _ai_embedding_model_name()
        try:
            response = client.embeddings.create(
                model=model_name,
                input=cleaned,
                dimensions=_AI_EMBEDDING_DIMENSIONS,
            )
            vectors = [
                _normalize_embedding(list(getattr(item, "embedding", []) or []))
                for item in (getattr(response, "data", []) or [])
            ]
            if len(vectors) == len(cleaned):
                return vectors, model_name, "openai"
        except Exception as exc:
            print(f"WARNING ai embeddings create failed: {exc}")
            try:
                response = client.embeddings.create(model=model_name, input=cleaned)
                vectors = [
                    _normalize_embedding(list(getattr(item, "embedding", []) or []))
                    for item in (getattr(response, "data", []) or [])
                ]
                if len(vectors) == len(cleaned):
                    return vectors, model_name, "openai"
            except Exception as inner_exc:
                print(f"WARNING ai embeddings fallback failed: {inner_exc}")

    return [
        _fallback_text_embedding(text_value, dimensions=_AI_EMBEDDING_DIMENSIONS)
        for text_value in cleaned
    ], "fallback-hash-256", "fallback"


def _chunk_text_for_memory(value: str, chunk_chars: int = 900, overlap_chars: int = 140) -> list[str]:
    source = (value or "").strip()
    if not source:
        return []
    paragraphs = [part.strip() for part in re.split(r"\n{2,}", source) if part and part.strip()]
    if not paragraphs:
        paragraphs = [source]
    chunks: list[str] = []
    current = ""
    for part in paragraphs:
        candidate = f"{current}\n\n{part}".strip() if current else part
        if current and len(candidate) > chunk_chars:
            chunks.append(current.strip())
            overlap = _clip_text(current[-overlap_chars:], overlap_chars) if overlap_chars > 0 else ""
            current = f"{overlap}\n{part}".strip() if overlap else part
            continue
        if len(part) > chunk_chars and not current:
            start = 0
            while start < len(part):
                end = min(len(part), start + chunk_chars)
                chunk = part[start:end].strip()
                if chunk:
                    chunks.append(chunk)
                if end >= len(part):
                    break
                start = max(0, end - overlap_chars)
            current = ""
            continue
        current = candidate
    if current.strip():
        chunks.append(current.strip())
    deduped: list[str] = []
    seen: set[str] = set()
    for chunk in chunks:
        normalized = _normalize_text(chunk)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(_clip_text(chunk, 1200))
    return deduped[:8]


def _memory_keywords(*values: str) -> list[str]:
    tokens: list[str] = []
    seen: set[str] = set()
    for value in values:
        for token in re.split(r"[^a-z0-9]+", _normalize_text(value or "")):
            if len(token) < 3 or token in _AI_MEMORY_STOPWORDS or token in seen:
                continue
            seen.add(token)
            tokens.append(token)
    return tokens[:10]


def _build_document_memory_source_text(
    doc: models.Document,
    summary: models.DocumentSummary | None = None,
) -> str:
    sections: list[str] = []
    if getattr(doc, "filename", ""):
        sections.append(f"Archivo: {doc.filename}")
    sections.append(f"Tipo clínico: {_infer_document_type(doc)}")
    if getattr(doc, "center", ""):
        sections.append(f"Centro: {doc.center}")
    if getattr(doc, "notes", ""):
        sections.append(f"Notas: {doc.notes}")
    if summary:
        if getattr(summary, "summary_plain", ""):
            sections.append(f"Resumen: {summary.summary_plain}")
        key_points = list(getattr(summary, "key_points_json", []) or [])
        if key_points:
            sections.append("Puntos clave: " + " | ".join(str(item) for item in key_points[:6]))
        abnormal_values = list(getattr(summary, "abnormal_values_json", []) or [])
        if abnormal_values:
            sections.append("Valores alterados: " + " | ".join(str(item) for item in abnormal_values[:6]))
    if getattr(doc, "ocr_text", ""):
        sections.append("OCR:\n" + _clip_text(doc.ocr_text or "", 12000))
    return "\n\n".join(section for section in sections if (section or "").strip())


def _resolve_document_profile_id(db: Session, doc: models.Document) -> int | None:
    profile_id = getattr(doc, "profile_id", None)
    if profile_id:
        return int(profile_id)
    if not getattr(doc, "user_id", None):
        return None
    rows = (
        db.query(models.HealthProfile)
        .filter(
            models.HealthProfile.owner_user_id == int(doc.user_id),
            models.HealthProfile.is_archived.is_(False),
        )
        .order_by(models.HealthProfile.is_primary_profile.desc(), models.HealthProfile.created_at.asc())
        .limit(2)
        .all()
    )
    if len(rows) == 1:
        return int(rows[0].id)
    primary = next((item for item in rows if bool(getattr(item, "is_primary_profile", False))), None)
    return int(primary.id) if primary else None


def _sync_pgvector_chunk(db: Session, row_id: int, embedding: list[float] | None) -> None:
    if engine.url.get_backend_name() != "postgresql" or not row_id or not embedding:
        return
    try:
        db.execute(
            text(
                "UPDATE ai_document_chunks "
                "SET embedding_vector = CAST(:embedding AS vector) "
                "WHERE id = :row_id"
            ),
            {"embedding": _pgvector_literal(embedding), "row_id": int(row_id)},
        )
    except Exception as exc:
        print(f"WARNING _sync_pgvector_chunk: {exc}")


def _upsert_document_memory_chunks(
    db: Session,
    doc: models.Document,
    *,
    profile_id: int | None = None,
) -> list[models.AiDocumentChunk]:
    if not getattr(doc, "id", None):
        return []
    summary = (
        db.query(models.DocumentSummary)
        .filter(models.DocumentSummary.document_id == int(doc.id))
        .first()
    )
    source_text = _build_document_memory_source_text(doc, summary=summary)
    chunks = _chunk_text_for_memory(source_text)
    existing = (
        db.query(models.AiDocumentChunk)
        .filter(models.AiDocumentChunk.document_id == int(doc.id))
        .order_by(models.AiDocumentChunk.chunk_index.asc())
        .all()
    )
    if not chunks:
        for item in existing:
            db.delete(item)
        return []

    resolved_profile_id = profile_id or _resolve_document_profile_id(db, doc)
    if resolved_profile_id and not getattr(doc, "profile_id", None):
        doc.profile_id = int(resolved_profile_id)
        db.add(doc)

    embeddings, embedding_model, embedding_source = _embed_text_batch(chunks)
    rows_by_index = {int(item.chunk_index or 0): item for item in existing}
    saved_rows: list[models.AiDocumentChunk] = []
    document_type = _infer_document_type(doc)
    for idx, chunk_text in enumerate(chunks):
        row = rows_by_index.get(idx)
        if not row:
            row = models.AiDocumentChunk(document_id=int(doc.id), chunk_index=idx)
        row.user_id = int(doc.user_id)
        row.profile_id = int(resolved_profile_id) if resolved_profile_id else None
        row.document_type = document_type
        row.chunk_index = idx
        row.chunk_hash = hashlib.sha256(chunk_text.encode("utf-8")).hexdigest()
        row.chunk_text = chunk_text
        row.embedding_json = embeddings[idx] if idx < len(embeddings) else _fallback_text_embedding(chunk_text)
        row.embedding_model = embedding_model
        row.embedding_source = embedding_source
        row.token_estimate = _estimate_token_count(chunk_text)
        row.metadata_json = {
            "filename": getattr(doc, "filename", "") or "",
            "document_type": document_type,
            "ocr_status": getattr(doc, "ocr_status", "") or "",
            "text_length": len(chunk_text),
        }
        row.updated_at = datetime.now()
        db.add(row)
        saved_rows.append(row)

    for stale in existing:
        if int(getattr(stale, "chunk_index", -1) or -1) >= len(chunks):
            db.delete(stale)

    db.flush()
    for row in saved_rows:
        _sync_pgvector_chunk(db, int(row.id), list(getattr(row, "embedding_json", []) or []))
    return saved_rows


def _query_document_chunks_pgvector(
    db: Session,
    *,
    authorized_user_id: int,
    profile: models.HealthProfile,
    embedding: list[float],
    limit: int,
    document_type: str | None = None,
) -> list[dict]:
    if engine.url.get_backend_name() != "postgresql" or not embedding:
        return []
    filters = ["user_id = :user_id", "embedding_vector IS NOT NULL"]
    params: dict = {
        "user_id": int(authorized_user_id),
        "profile_id": int(profile.id),
        "limit": max(1, min(limit, 8)),
        "embedding": _pgvector_literal(embedding),
    }
    if bool(getattr(profile, "is_primary_profile", False)):
        filters.append("(profile_id = :profile_id OR profile_id IS NULL)")
    else:
        filters.append("profile_id = :profile_id")
    if document_type:
        filters.append("document_type = :document_type")
        params["document_type"] = document_type
    sql = (
        "SELECT id, document_id, chunk_text, document_type, metadata_json, "
        "1 - (embedding_vector <=> CAST(:embedding AS vector)) AS relevance "
        "FROM ai_document_chunks WHERE "
        + " AND ".join(filters)
        + " ORDER BY embedding_vector <=> CAST(:embedding AS vector) ASC LIMIT :limit"
    )
    try:
        rows = db.execute(text(sql), params).mappings().all()
    except Exception as exc:
        print(f"WARNING _query_document_chunks_pgvector: {exc}")
        return []
    return [dict(item) for item in rows]


def _load_relevant_document_chunks(
    db: Session,
    current_user: models.User,
    profile: models.HealthProfile,
    link: models.ProfileRelationship,
    message: str,
    *,
    limit: int = 4,
    document_type: str | None = None,
) -> list[dict]:
    if not message.strip():
        return []
    if not _check_permission(db, current_user, int(profile.id), "view_documents"):
        return []

    authorized_user_id = int(profile.owner_user_id)
    query_embedding = _embed_text_batch([message])[0]
    embedding = query_embedding[0] if query_embedding else _fallback_text_embedding(message)
    vector_rows = _query_document_chunks_pgvector(
        db,
        authorized_user_id=authorized_user_id,
        profile=profile,
        embedding=embedding,
        limit=max(3, min(limit, 5)),
        document_type=document_type,
    )
    if vector_rows:
        return [
            {
                "chunk_id": int(item.get("id") or 0),
                "document_id": int(item.get("document_id") or 0),
                "document_type": item.get("document_type") or "otro",
                "chunk_text": _clip_text(item.get("chunk_text") or "", 520),
                "relevance": round(float(item.get("relevance") or 0.0), 4),
                "filename": (item.get("metadata_json") or {}).get("filename") if isinstance(item.get("metadata_json"), dict) else "",
            }
            for item in vector_rows[: max(1, min(limit, 5))]
            if (item.get("chunk_text") or "").strip()
        ]

    query = db.query(models.AiDocumentChunk).filter(models.AiDocumentChunk.user_id == authorized_user_id)
    if bool(getattr(profile, "is_primary_profile", False)):
        query = query.filter(
            or_(
                models.AiDocumentChunk.profile_id == int(profile.id),
                models.AiDocumentChunk.profile_id.is_(None),
            )
        )
    else:
        query = query.filter(models.AiDocumentChunk.profile_id == int(profile.id))
    if document_type:
        query = query.filter(models.AiDocumentChunk.document_type == document_type)

    rows = (
        query.order_by(models.AiDocumentChunk.updated_at.desc(), models.AiDocumentChunk.id.desc())
        .limit(36)
        .all()
    )
    tokens = set(_memory_keywords(message))
    ranked: list[tuple[float, models.AiDocumentChunk]] = []
    for row in rows:
        text_value = getattr(row, "chunk_text", "") or ""
        lexical_score = 0.0
        normalized_row = _normalize_text(text_value)
        if tokens:
            lexical_score = sum(1 for token in tokens if token in normalized_row) / max(len(tokens), 1)
        semantic_score = _cosine_similarity(embedding, list(getattr(row, "embedding_json", []) or []))
        score = semantic_score + (0.18 * lexical_score)
        if score <= 0.05:
            continue
        ranked.append((score, row))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [
        {
            "chunk_id": int(item.id),
            "document_id": int(item.document_id),
            "document_type": item.document_type or "otro",
            "chunk_text": _clip_text(item.chunk_text or "", 520),
            "relevance": round(score, 4),
            "filename": (getattr(item, "metadata_json", {}) or {}).get("filename", ""),
        }
        for score, item in ranked[: max(1, min(limit, 5))]
    ]


def _build_conversation_summary_payload(
    history: list[dict],
    *,
    latest_user_message: str,
    latest_reply: str,
    event_type: str,
    mode: str,
) -> dict:
    relevant_history = history[-8:] if history else []
    user_messages = [
        _clip_text((item.get("content") or "").strip(), 180)
        for item in relevant_history
        if (item.get("role") or "") == "user" and (item.get("content") or "").strip()
    ]
    assistant_messages = [
        _clip_text((item.get("content") or "").strip(), 180)
        for item in relevant_history
        if (item.get("role") or "") == "assistant" and (item.get("content") or "").strip()
    ]
    focus_terms = _memory_keywords(" ".join(user_messages[-3:]), latest_user_message, latest_reply)
    last_request = _clip_text(latest_user_message, 180)
    last_reply = _clip_text(latest_reply, 220)
    summary_parts = []
    if focus_terms:
        summary_parts.append("Temas: " + ", ".join(focus_terms[:5]) + ".")
    if last_request:
        summary_parts.append("Última solicitud: " + last_request + ".")
    if last_reply:
        summary_parts.append("Respuesta entregada: " + last_reply + ".")
    summary_text = " ".join(summary_parts).strip() or _clip_text(last_request or last_reply, 260)
    return {
        "summary": _clip_text(summary_text, 420),
        "event_type": (event_type or "general").strip() or "general",
        "mode": (mode or "").strip(),
        "recent_user_messages": user_messages[-3:],
        "recent_assistant_messages": assistant_messages[-2:],
        "keywords": focus_terms[:6],
    }


def _upsert_conversation_summary(
    db: Session,
    *,
    profile_id: int,
    user_id: int,
    conversation_id: str,
    event_type: str,
    mode: str,
    history: list[dict],
    latest_user_message: str,
    latest_reply: str,
    last_message_id: int | None = None,
) -> models.AiConversationSummary:
    payload = _build_conversation_summary_payload(
        history,
        latest_user_message=latest_user_message,
        latest_reply=latest_reply,
        event_type=event_type,
        mode=mode,
    )
    row = (
        db.query(models.AiConversationSummary)
        .filter(
            models.AiConversationSummary.profile_id == int(profile_id),
            models.AiConversationSummary.conversation_id == (conversation_id or "").strip(),
            models.AiConversationSummary.summary_type == "rolling",
        )
        .first()
    )
    if not row:
        row = models.AiConversationSummary(
            profile_id=int(profile_id),
            user_id=int(user_id),
            conversation_id=(conversation_id or "").strip(),
            summary_type="rolling",
        )
    row.user_id = int(user_id)
    row.event_type = payload.get("event_type") or "general"
    row.summary = payload.get("summary") or ""
    row.summary_json = payload
    row.source_message_count = len(history) + 2
    row.last_message_id = int(last_message_id) if last_message_id else None
    row.updated_at = datetime.now()
    db.add(row)
    return row


def _load_relevant_conversation_memory(
    db: Session,
    *,
    profile_id: int,
    message: str,
    conversation_id: str | None = None,
    limit: int = 3,
) -> list[dict]:
    rows = (
        db.query(models.AiConversationSummary)
        .filter(models.AiConversationSummary.profile_id == int(profile_id))
        .order_by(models.AiConversationSummary.updated_at.desc(), models.AiConversationSummary.id.desc())
        .limit(18)
        .all()
    )
    tokens = set(_memory_keywords(message))
    ranked: list[tuple[float, models.AiConversationSummary]] = []
    for row in rows:
        score = 0.0
        if conversation_id and (row.conversation_id or "") == conversation_id:
            score += 0.6
        normalized_summary = _normalize_text((row.summary or "") + " " + " ".join((row.summary_json or {}).get("keywords") or []))
        if tokens:
            score += sum(1 for token in tokens if token in normalized_summary) / max(len(tokens), 1)
        if score <= 0.0:
            updated_at = getattr(row, "updated_at", None) or getattr(row, "created_at", None)
            if updated_at:
                age_hours = max(0.0, (datetime.now() - updated_at).total_seconds() / 3600.0)
                score += max(0.0, 0.35 - min(age_hours / 200.0, 0.35))
        ranked.append((score, row))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [
        {
            "conversation_id": item.conversation_id or "",
            "summary": _clip_text(item.summary or "", 320),
            "event_type": item.event_type or "general",
            "keywords": list((item.summary_json or {}).get("keywords") or [])[:6],
            "updated_at": _safe_iso(getattr(item, "updated_at", None)),
            "message_count": int(getattr(item, "source_message_count", 0) or 0),
        }
        for score, item in ranked[: max(1, min(limit, 4))]
        if (item.summary or "").strip()
    ]


def _build_context_fingerprint(context: dict) -> str:
    profile = context.get("profile") or {}
    documents = context.get("documents") or []
    medications = context.get("medications") or []
    appointments = context.get("appointments") or []
    context_totals = context.get("context_totals") or {}
    latest_document = documents[0] if documents else None
    latest_appointment = appointments[0] if appointments else None
    latest_medication = medications[0] if medications else None
    raw = json.dumps(
        {
            "profile_id": profile.get("id"),
            "docs": int(context_totals.get("documents", len(documents)) or 0),
            "meds": int(context_totals.get("medications", len(medications)) or 0),
            "appts": int(context_totals.get("appointments", len(appointments)) or 0),
            "latest_doc": _safe_iso(getattr(latest_document, "created_at", None)),
            "latest_appt": _safe_iso(getattr(latest_appointment, "date_time", None) or getattr(latest_appointment, "created_at", None)),
            "latest_med": _safe_iso(getattr(latest_medication, "created_at", None)),
            "summary": _clip_text(context.get("brief_profile_summary") or "", 180),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cached_ai_reply_get(cache_key: str) -> dict | None:
    if not cache_key:
        return None
    now_ts = time.time()
    ttl = _ai_response_cache_ttl_seconds()
    with _AI_RESPONSE_CACHE_LOCK:
        payload = _AI_RESPONSE_CACHE.get(cache_key)
        if not payload:
            return None
        if now_ts - float(payload.get("stored_at", 0.0) or 0.0) > ttl:
            _AI_RESPONSE_CACHE.pop(cache_key, None)
            return None
        return dict(payload)


def _cached_ai_reply_put(cache_key: str, payload: dict) -> None:
    if not cache_key:
        return
    with _AI_RESPONSE_CACHE_LOCK:
        _AI_RESPONSE_CACHE[cache_key] = {"stored_at": time.time(), **(payload or {})}


def _context_total_count(context: dict, key: str, fallback: int = 0) -> int:
    totals = context.get("context_totals") or {}
    try:
        return max(0, int(totals.get(key, fallback) or fallback))
    except Exception:
        return max(0, int(fallback or 0))


def _structured_medications_reply(context: dict) -> str:
    medications = [item for item in (context.get("medications") or []) if not bool(getattr(item, "completed", False))]
    if not medications:
        return "No veo medicamentos activos registrados en el perfil seleccionado."
    active_total = _context_total_count(context, "active_medications", len(medications))
    labels = []
    for item in medications[:6]:
        label = getattr(item, "name", "") or "Medicamento"
        if getattr(item, "dose", ""):
            label += f" ({item.dose})"
        if getattr(item, "frequency", ""):
            label += f", {item.frequency}"
        labels.append(label)
    extra = max(0, active_total - len(labels))
    reply = f"En el perfil activo aparecen {active_total} medicamento(s) activo(s): " + "; ".join(labels) + "."
    if extra > 0:
        reply += f" Hay {extra} más registrados."
    return reply


def _structured_next_appointment_reply(context: dict) -> str:
    insight = (context.get("appointment_insights") or {}).get("next_upcoming")
    if not insight:
        return "No veo una próxima cita agendada en el perfil activo."
    specialty = insight.get("specialty") or insight.get("type") or "cita"
    center = insight.get("center") or "sin centro registrado"
    when_label = insight.get("date_time") or "sin fecha registrada"
    return f"La próxima cita registrada es {specialty} para {when_label} en {center}."


def _document_entities_for_context(context: dict, document_id: int | None) -> list[models.DocumentClinicalEntity]:
    if not document_id:
        return []
    entity_map = context.get("document_entities_by_document") or {}
    return list(entity_map.get(int(document_id), []) or [])


def _document_chunks_for_context(context: dict, document_id: int | None) -> list[dict]:
    if not document_id:
        return []
    return [
        item
        for item in (context.get("document_chunks") or [])
        if int(item.get("document_id") or 0) == int(document_id)
    ]


def _document_summary_for_context(context: dict, document_id: int | None):
    if not document_id:
        return None
    return next(
        (
            item
            for item in (context.get("document_summaries") or [])
            if getattr(item, "document_id", None) == document_id
        ),
        None,
    )


def _structured_last_appointment_reply(context: dict, normalized_message: str) -> str:
    appointment_insights = context.get("appointment_insights") or {}
    wants_scheduled = any(token in normalized_message for token in ["agendada", "programada"])
    pick = appointment_insights.get("last_scheduled_created") if wants_scheduled else appointment_insights.get("last_created")
    if not pick:
        return "No encuentro una ultima cita registrada que coincida con ese criterio."
    status = pick.get("status") or "sin estado"
    detail = (
        f"La ultima cita {'agendada ' if wants_scheduled else ''}registrada fue "
        f"{pick.get('date_time') or 'sin fecha'}"
    )
    if pick.get("specialty"):
        detail += f", especialidad {pick.get('specialty')}"
    if pick.get("center"):
        detail += f", en {pick.get('center')}"
    if pick.get("created_at"):
        detail += f", creada {pick.get('created_at')}"
    detail += f". Estado: {status}."
    return detail


def _structured_document_inventory_reply(context: dict) -> str:
    documents = context.get("documents") or []
    document_insights = context.get("document_insights") or {}
    total_documents = _context_total_count(context, "documents", len(documents))
    if total_documents <= 0:
        return "No veo documentos clinicos registrados en el perfil activo."
    counts_type = document_insights.get("counts_by_type") or {}
    counts_format = document_insights.get("counts_by_format") or {}
    sample_complete = total_documents <= len(documents)
    parts = [f"Hoy veo {total_documents} documento(s) registrado(s) en el perfil activo."]
    if sample_complete:
        parts.extend([
            (
                "Tipos detectados: receta "
                f"{counts_type.get('receta', 0)}, orden {counts_type.get('orden', 0)}, "
                f"resultado {counts_type.get('resultado', 0)}, informe {counts_type.get('informe', 0)}, "
                f"otro {counts_type.get('otro', 0)}."
            ),
            (
                "Formatos: pdf "
                f"{counts_format.get('pdf', 0)}, imagen {counts_format.get('imagen', 0)}, "
                f"otro {counts_format.get('otro', 0)}."
            ),
        ])
    else:
        parts.append("El detalle por tipo puede seguir actualizandose en segundo plano si hay muchos documentos cargados.")
    last_doc = document_insights.get("last_created") or {}
    if last_doc:
        detail = (
            f"El mas reciente es {last_doc.get('filename') or 'un documento'}"
            f" ({last_doc.get('detected_doc_type') or last_doc.get('doc_type') or 'otro'})"
        )
        if last_doc.get("date"):
            detail += f", con fecha {last_doc.get('date')}"
        elif last_doc.get("created_at"):
            detail += f", cargado {last_doc.get('created_at')}"
        if last_doc.get("center"):
            detail += f", centro {last_doc.get('center')}"
        parts.append(detail + ".")
    return " ".join(parts)


def _structured_document_reply(doc: models.Document | None, context: dict) -> str:
    if not doc:
        return "No veo documentos clínicos registrados en el perfil activo."
    summary = _document_summary_for_context(context, getattr(doc, "id", None))
    doc_type = _infer_document_type(doc)
    file_format = _document_file_format(doc)
    filename = getattr(doc, "filename", "") or f"#{getattr(doc, 'id', '')}"
    center = getattr(doc, "center", "") or "sin centro registrado"
    date_label = _safe_iso_local(getattr(doc, "date", None), context.get("timezone_name") or DEFAULT_TZ_NAME) or "sin fecha"
    parts = [
        f"Documento {filename}: tipo {doc_type}, formato {file_format}, centro {center}, fecha {date_label}."
    ]
    if getattr(doc, "notes", ""):
        parts.append("Notas guardadas: " + _clip_text(getattr(doc, "notes", "") or "", 220) + ".")
    if summary and (getattr(summary, "patient_friendly_explanation", "") or getattr(summary, "summary_plain", "")):
        parts.append(
            _clip_text(
                getattr(summary, "patient_friendly_explanation", "") or getattr(summary, "summary_plain", ""),
                280,
            )
        )
    elif getattr(doc, "ocr_text", ""):
        parts.append("Resumen OCR orientativo: " + _clip_text(getattr(doc, "ocr_text", "") or "", 900))
        parts.append("La lectura OCR puede contener errores y conviene validarla con el documento original.")
    else:
        parts.append("Todavía no hay texto OCR disponible para ese documento.")
    return " ".join(parts)


def _structured_document_reply_rich(doc: models.Document | None, context: dict) -> str:
    if not doc:
        return "No veo documentos clinicos registrados en el perfil activo."
    summary = _document_summary_for_context(context, getattr(doc, "id", None))
    entities = _document_entities_for_context(context, getattr(doc, "id", None))
    relevant_chunks = _document_chunks_for_context(context, getattr(doc, "id", None))
    doc_type = _infer_document_type(doc)
    file_format = _document_file_format(doc)
    filename = getattr(doc, "filename", "") or f"#{getattr(doc, 'id', '')}"
    center = getattr(doc, "center", "") or "sin centro registrado"
    date_label = _safe_iso_local(getattr(doc, "date", None), context.get("timezone_name") or DEFAULT_TZ_NAME) or "sin fecha"
    parts = [f"Documento {filename}: tipo {doc_type}, formato {file_format}, centro {center}, fecha {date_label}."]
    if getattr(doc, "notes", ""):
        parts.append("Notas guardadas: " + _clip_text(getattr(doc, "notes", "") or "", 220) + ".")
    if summary and (getattr(summary, "patient_friendly_explanation", "") or getattr(summary, "summary_plain", "")):
        parts.append(
            "Explicacion: "
            + _clip_text(
                getattr(summary, "patient_friendly_explanation", "") or getattr(summary, "summary_plain", ""),
                540,
            )
        )
        key_points = []
        for item in (getattr(summary, "key_points_json", None) or [])[:4]:
            if isinstance(item, dict):
                label = str(item.get("label") or item.get("title") or item.get("name") or item.get("point") or "").strip()
                detail = str(item.get("detail") or item.get("description") or item.get("text") or "").strip()
                rendered = f"{label}: {detail}" if label and detail else (label or detail)
            else:
                rendered = str(item or "").strip()
            if rendered:
                key_points.append(_clip_text(rendered, 160))
        if key_points:
            parts.append("Puntos clave: " + "; ".join(key_points) + ".")

        abnormal_values = []
        for item in (getattr(summary, "abnormal_values_json", None) or [])[:4]:
            if isinstance(item, dict):
                label = str(item.get("label") or item.get("name") or item.get("analyte") or "valor").strip()
                value = str(item.get("value") or item.get("result") or "").strip()
                unit = str(item.get("unit") or "").strip()
                ref = str(item.get("reference_range") or item.get("reference") or "").strip()
                flag = str(item.get("flag") or "").strip().lower()
                rendered = label
                if value:
                    rendered += f" {value}{(' ' + unit) if unit else ''}"
                if ref:
                    rendered += f" (referencia {ref})"
                if flag and flag not in {"normal", "unknown", "ok"}:
                    rendered += f", alerta {flag}"
            else:
                rendered = str(item or "").strip()
            if rendered:
                abnormal_values.append(_clip_text(rendered, 160))
        if abnormal_values:
            parts.append("Valores a revisar: " + "; ".join(abnormal_values) + ".")
    elif getattr(doc, "ocr_text", ""):
        parts.append("Lectura OCR orientativa: " + _clip_text(getattr(doc, "ocr_text", "") or "", 1400))
        parts.append("La lectura OCR puede contener errores y conviene validarla con el documento original.")
    else:
        parts.append("Todavia no hay texto OCR disponible para ese documento.")

    rendered_entities = []
    seen_entities: set[str] = set()
    for entity in entities:
        entity_name = str(getattr(entity, "entity_name", "") or "").strip()
        entity_value = str(getattr(entity, "entity_value", "") or getattr(entity, "source_text", "") or "").strip()
        entity_type = str(getattr(entity, "entity_type", "") or "").strip()
        if not (entity_name or entity_value):
            continue
        rendered = entity_name or entity_value
        if entity_name and entity_value and entity_value.lower() != entity_name.lower():
            rendered += f": {_clip_text(entity_value, 120)}"
        if entity_type:
            rendered = f"{entity_type}: {rendered}"
        rendered = _clip_text(rendered, 180)
        dedupe_key = rendered.lower()
        if dedupe_key in seen_entities:
            continue
        seen_entities.add(dedupe_key)
        rendered_entities.append(rendered)
        if len(rendered_entities) >= 4:
            break
    if rendered_entities:
        parts.append("Hallazgos extraidos: " + "; ".join(rendered_entities) + ".")
    if relevant_chunks:
        best_chunk = str(relevant_chunks[0].get("chunk_text") or "").strip()
        if best_chunk:
            parts.append("Fragmento relevante: " + _clip_text(best_chunk, 420))
    return " ".join(parts)


def _structured_latest_document_reply(context: dict) -> str:
    documents = context.get("documents") or []
    latest = documents[0] if documents else None
    if not latest:
        return "No veo documentos clínicos registrados en el perfil activo."
    return _structured_document_reply_rich(latest, context)


def _maybe_resolve_structured_ai_query(message: str, context: dict) -> tuple[str, str, str] | None:
    normalized = _normalize_text(message or "")
    if not normalized:
        return None
    if any(token in normalized for token in ["que medicamentos", "cuales son mis medicamentos", "medicamentos activos", "que tomo"]):
        return _structured_medications_reply(context), "structured-memory", "structured-medications"
    appointment_question = any(
        token in normalized for token in ["cita", "citas", "control", "hora", "agenda", "agendada", "programada"]
    )
    if appointment_question and any(
        token in normalized for token in ["proxima", "mas proxima", "siguiente", "cercana", "mas cercana"]
    ):
        return _structured_next_appointment_reply(context), "structured-memory", "structured-next-appointment"
    if appointment_question and any(
        token in normalized for token in ["ultima", "ultimo", "reciente", "agregue", "agendada", "programada"]
    ):
        return _structured_last_appointment_reply(context, normalized), "structured-memory", "structured-last-appointment"
    if any(
        token in normalized
        for token in ["cuantos documentos", "cuantos archivos", "cantidad de documentos", "total de documentos"]
    ):
        return _structured_document_inventory_reply(context), "structured-memory", "structured-document-inventory"
    if any(token in normalized for token in ["ultimo documento", "ultimo examen", "ultimo informe", "ultimo resultado"]):
        return _structured_latest_document_reply(context), "structured-memory", "structured-latest-document"
    return None


def _persist_ai_query_metric(
    db: Session,
    *,
    user_id: int,
    profile_id: int,
    conversation_id: str,
    query_type: str,
    model: str,
    provider: str,
    mode: str,
    used_llm: bool,
    cache_hit: bool,
    structured_hit: bool,
    history_messages: int,
    chunk_count: int,
    input_chars: int,
    context_chars: int,
    output_chars: int,
    prompt_tokens_estimate: int,
    output_tokens_estimate: int,
    metadata_json: dict | None = None,
) -> None:
    metric = models.AiQueryMetric(
        user_id=int(user_id),
        profile_id=int(profile_id),
        conversation_id=(conversation_id or "").strip(),
        query_type=(query_type or "general").strip() or "general",
        model=(model or "").strip(),
        provider=(provider or "").strip(),
        mode=(mode or "").strip(),
        used_llm=bool(used_llm),
        cache_hit=bool(cache_hit),
        structured_hit=bool(structured_hit),
        history_messages=max(0, int(history_messages or 0)),
        chunk_count=max(0, int(chunk_count or 0)),
        input_chars=max(0, int(input_chars or 0)),
        context_chars=max(0, int(context_chars or 0)),
        output_chars=max(0, int(output_chars or 0)),
        prompt_tokens_estimate=max(0, int(prompt_tokens_estimate or 0)),
        output_tokens_estimate=max(0, int(output_tokens_estimate or 0)),
        total_tokens_estimate=max(0, int(prompt_tokens_estimate or 0)) + max(0, int(output_tokens_estimate or 0)),
        metadata_json=metadata_json or {},
    )
    db.add(metric)


def _safe_iso(dt: datetime | None) -> str:
    if not dt:
        return ""
    try:
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(dt)


def _ai_dt_in_tz(value: datetime | None, tz_name: str | None) -> datetime | None:
    if not value:
        return None
    tz = _safe_zoneinfo(tz_name)
    return _normalize_dt_for_tz(value, tz)


def _safe_iso_local(dt: datetime | None, tz_name: str | None) -> str:
    localized = _ai_dt_in_tz(dt, tz_name)
    if not localized:
        return ""
    try:
        return localized.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(localized)


def _safe_iso_client(dt: datetime | None, tz_name: str | None = None) -> str:
    localized = _ai_dt_in_tz(dt, tz_name) if tz_name else dt
    if not localized:
        return ""
    try:
        return localized.strftime("%Y-%m-%dT%H:%M:%S")
    except Exception:
        return str(localized)


def _appointment_status_key(value) -> str:
    return str(getattr(value, "value", value) or "").strip().lower()


def _appointment_type_key(value) -> str:
    return str(getattr(value, "value", value) or "").strip().lower()


def _appointment_to_ai_dict(item: models.Appointment | None, tz_name: str) -> dict | None:
    if not item:
        return None
    return {
        "type": _appointment_type_key(item.type),
        "specialty": item.specialty or "",
        "center": item.center or "",
        "status": _appointment_status_key(item.status),
        "date_time": _safe_iso_local(item.date_time, tz_name),
        "created_at": _safe_iso_local(item.created_at, tz_name),
        "notes": _clip_text(item.notes or "", 180),
    }


def _appointment_insights(appointments: list[models.Appointment], tz_name: str) -> dict:
    if not appointments:
        return {
            "last_created": None,
            "last_scheduled_created": None,
            "latest_by_date": None,
            "next_upcoming": None,
            "counts_by_status": {"pendiente": 0, "agendada": 0, "realizada": 0},
        }

    safe_tz = _safe_zoneinfo(tz_name)
    now_dt = datetime.now(safe_tz)
    now_ts = now_dt.timestamp()

    def _ts(value: datetime | None) -> float:
        localized = _ai_dt_in_tz(value, tz_name)
        return localized.timestamp() if localized else float("-inf")

    counts_by_status = {"pendiente": 0, "agendada": 0, "realizada": 0}
    for appt in appointments:
        status = _appointment_status_key(appt.status)
        if status in counts_by_status:
            counts_by_status[status] += 1

    with_created = [item for item in appointments if item.created_at]
    with_date = [item for item in appointments if item.date_time]
    scheduled = [item for item in appointments if _appointment_status_key(item.status) == "agendada"]
    non_done_with_date = [
        item
        for item in appointments
        if item.date_time and _appointment_status_key(item.status) != "realizada"
    ]
    future_non_done = [item for item in non_done_with_date if _ts(item.date_time) >= now_ts]

    last_created = max(with_created, key=lambda item: _ts(item.created_at), default=None)
    last_scheduled_created = max(
        [item for item in scheduled if item.created_at],
        key=lambda item: _ts(item.created_at),
        default=None,
    )
    latest_by_date = max(with_date, key=lambda item: _ts(item.date_time), default=None)
    next_upcoming = min(future_non_done, key=lambda item: _ts(item.date_time), default=None)
    if not next_upcoming:
        next_upcoming = min(non_done_with_date, key=lambda item: abs(_ts(item.date_time) - now_ts), default=None)

    return {
        "last_created": _appointment_to_ai_dict(last_created, tz_name),
        "last_scheduled_created": _appointment_to_ai_dict(last_scheduled_created, tz_name),
        "latest_by_date": _appointment_to_ai_dict(latest_by_date, tz_name),
        "next_upcoming": _appointment_to_ai_dict(next_upcoming, tz_name),
        "counts_by_status": counts_by_status,
    }


def _document_type_key(value) -> str:
    return str(getattr(value, "value", value) or "").strip().lower()


def _document_file_format(doc: models.Document | None) -> str:
    if not doc:
        return "desconocido"
    name = (getattr(doc, "filename", None) or "").strip().lower()
    if not name:
        name = (getattr(doc, "file_path", None) or "").strip().lower()
    ext = Path(name).suffix.lower()
    if ext == ".pdf":
        return "pdf"
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic"}:
        return "imagen"
    return "otro"


def _infer_document_type(doc: models.Document | None) -> str:
    declared = _document_type_key(getattr(doc, "doc_type", None))
    if not doc:
        return declared or "otro"
    raw = " ".join(
        [
            getattr(doc, "filename", "") or "",
            getattr(doc, "notes", "") or "",
            getattr(doc, "ocr_text", "") or "",
        ]
    )
    norm = _normalize_text(raw)
    if not norm:
        return declared or "otro"

    keyword_map = {
        "receta": ["receta", "prescripcion", "farmaco", "medicamento", "dosis", "administrar"],
        "orden": ["orden", "solicitud", "examen", "citacion", "toma de muestra", "interconsulta"],
        "resultado": ["resultado", "valores de referencia", "laboratorio", "parametro", "hemoglobina", "glucosa"],
        "informe": ["informe", "epicrisis", "conclusion", "impresion diagnostica", "alta medica", "evolucion"],
    }
    best_type = declared or "otro"
    best_score = 0
    for doc_type, keywords in keyword_map.items():
        score = sum(1 for kw in keywords if kw in norm)
        if score > best_score:
            best_score = score
            best_type = doc_type
    if best_score == 0:
        return declared or "otro"
    return best_type


def _document_to_ai_dict(item: models.Document | None, tz_name: str) -> dict | None:
    if not item:
        return None
    return {
        "document_id": int(getattr(item, "id", 0) or 0),
        "doc_type": _document_type_key(item.doc_type),
        "detected_doc_type": _infer_document_type(item),
        "file_format": _document_file_format(item),
        "filename": item.filename or "",
        "date": _safe_iso_local(item.date, tz_name),
        "created_at": _safe_iso_local(item.created_at, tz_name),
        "center": item.center or "",
        "ocr_status": item.ocr_status or "",
        "notes": _clip_text(item.notes or "", 180),
        "ocr_excerpt": _clip_text(item.ocr_text or "", 240),
    }


def _ordered_unique_document_ids_from_chunks(chunks: list[dict] | None) -> list[int]:
    ordered: list[int] = []
    seen: set[int] = set()
    for item in chunks or []:
        document_id = int(item.get("document_id") or 0)
        if document_id <= 0 or document_id in seen:
            continue
        seen.add(document_id)
        ordered.append(document_id)
    return ordered


def _document_insights(documents: list[models.Document], tz_name: str) -> dict:
    type_keys = ["receta", "orden", "resultado", "informe", "otro"]
    format_keys = ["pdf", "imagen", "otro", "desconocido"]
    if not documents:
        return {
            "last_created": None,
            "last_with_ocr": None,
            "counts_by_type": {key: 0 for key in type_keys},
            "counts_by_format": {key: 0 for key in format_keys},
        }

    def _ts(value: datetime | None) -> float:
        localized = _ai_dt_in_tz(value, tz_name)
        return localized.timestamp() if localized else float("-inf")

    counts_by_type = {key: 0 for key in type_keys}
    counts_by_format = {key: 0 for key in format_keys}
    for doc in documents:
        doc_type = _infer_document_type(doc)
        if doc_type in counts_by_type:
            counts_by_type[doc_type] += 1
        else:
            counts_by_type["otro"] += 1
        fmt = _document_file_format(doc)
        counts_by_format[fmt if fmt in counts_by_format else "otro"] += 1

    with_created = [item for item in documents if item.created_at]
    with_ocr = [item for item in documents if (item.ocr_text or "").strip()]
    last_created = max(with_created, key=lambda item: _ts(item.created_at), default=None)
    last_with_ocr = max(with_ocr, key=lambda item: _ts(item.created_at), default=None)
    return {
        "last_created": _document_to_ai_dict(last_created, tz_name),
        "last_with_ocr": _document_to_ai_dict(last_with_ocr, tz_name),
        "counts_by_type": counts_by_type,
        "counts_by_format": counts_by_format,
    }


def _medication_to_ai_dict(item: models.Medication | None, tz_name: str) -> dict | None:
    if not item:
        return None
    return {
        "name": item.name or "Medicamento",
        "dose": item.dose or "",
        "frequency": item.frequency or "",
        "schedule_time": item.schedule_time or "",
        "start_at": _safe_iso_local(getattr(item, "start_at", None), tz_name),
        "completed": bool(item.completed),
        "status": "realizada" if bool(item.completed) else "activa",
        "end_date": _safe_iso_local(item.end_date, tz_name),
        "created_at": _safe_iso_local(item.created_at, tz_name),
        "notes": _clip_text(item.notes or "", 160),
        "adherence_rate": getattr(item, "adherence_rate", None),
        "remaining_doses": getattr(item, "remaining_doses", None),
        "refill_alert_active": bool(getattr(item, "refill_alert_active", False)),
        "refill_current_assignee_name": getattr(item, "refill_current_assignee_name", "") or "",
    }


def _medication_insights(medications: list[models.Medication], tz_name: str) -> dict:
    if not medications:
        return {
            "last_created": None,
            "last_active_created": None,
            "counts_by_status": {"activa": 0, "realizada": 0},
            "counts_by_schedule": {"con_horario": 0, "sin_horario": 0},
            "counts_by_frequency": {"con_frecuencia": 0, "sin_frecuencia": 0},
        }

    def _ts(value: datetime | None) -> float:
        localized = _ai_dt_in_tz(value, tz_name)
        return localized.timestamp() if localized else float("-inf")

    counts_by_status = {"activa": 0, "realizada": 0}
    counts_by_schedule = {"con_horario": 0, "sin_horario": 0}
    counts_by_frequency = {"con_frecuencia": 0, "sin_frecuencia": 0}
    for med in medications:
        is_completed = bool(med.completed)
        counts_by_status["realizada" if is_completed else "activa"] += 1
        has_schedule = bool((med.schedule_time or "").strip())
        counts_by_schedule["con_horario" if has_schedule else "sin_horario"] += 1
        has_frequency = bool((med.frequency or "").strip())
        counts_by_frequency["con_frecuencia" if has_frequency else "sin_frecuencia"] += 1

    with_created = [item for item in medications if item.created_at]
    active_items = [item for item in medications if not bool(item.completed) and item.created_at]
    last_created = max(with_created, key=lambda item: _ts(item.created_at), default=None)
    last_active_created = max(active_items, key=lambda item: _ts(item.created_at), default=None)
    return {
        "last_created": _medication_to_ai_dict(last_created, tz_name),
        "last_active_created": _medication_to_ai_dict(last_active_created, tz_name),
        "counts_by_status": counts_by_status,
        "counts_by_schedule": counts_by_schedule,
        "counts_by_frequency": counts_by_frequency,
    }


def _voice_indication_type_key(value) -> str:
    raw = str(value or "").strip().lower()
    return raw if raw in {"medicamento", "control", "examen", "dieta", "ejercicio", "otro"} else "otro"


def _voice_indications_to_ai_list(
    items: list | None,
    *,
    limit: int = 4,
    text_chars: int = 180,
) -> list[dict]:
    rows: list[dict] = []
    for raw in items or []:
        if len(rows) >= max(1, limit):
            break
        if isinstance(raw, dict):
            text = _clip_text(
                str(
                    raw.get("texto")
                    or raw.get("text")
                    or raw.get("descripcion")
                    or raw.get("description")
                    or ""
                ),
                text_chars,
            )
            if not text:
                continue
            rows.append(
                {
                    "texto": text,
                    "tipo": _voice_indication_type_key(raw.get("tipo")),
                    "recordatorio_sugerido": bool(raw.get("recordatorio_sugerido")),
                }
            )
            continue
        text = _clip_text(str(raw or ""), text_chars)
        if not text:
            continue
        rows.append(
            {
                "texto": text,
                "tipo": "otro",
                "recordatorio_sugerido": False,
            }
        )
    return rows


def _voice_session_to_ai_dict(
    item: models.VoiceSession | None,
    tz_name: str,
    *,
    technical_chars: int = 360,
    simple_chars: int = 240,
    indications_limit: int = 4,
) -> dict | None:
    if not item:
        return None
    indications = _voice_indications_to_ai_list(
        getattr(item, "indicaciones", None),
        limit=indications_limit,
        text_chars=max(120, min(220, simple_chars)),
    )
    return {
        "session_id": int(getattr(item, "id", 0) or 0),
        "created_at": _safe_iso_local(getattr(item, "created_at", None), tz_name),
        "transcripcion_tecnica": _clip_text(getattr(item, "transcripcion_tecnica", "") or "", technical_chars),
        "version_simple": _clip_text(getattr(item, "version_simple", "") or "", simple_chars),
        "indicaciones": indications,
        "indicaciones_count": len(getattr(item, "indicaciones", None) or []),
        "shared": bool(getattr(item, "compartido_en", None) or getattr(item, "link_seguro", None)),
        "compartido_en": _safe_iso_local(getattr(item, "compartido_en", None), tz_name),
        "link_expira_en": _safe_iso_local(getattr(item, "link_expira_en", None), tz_name),
    }


def _voice_session_insights(sessions: list[models.VoiceSession], tz_name: str) -> dict:
    indication_types = ["medicamento", "control", "examen", "dieta", "ejercicio", "otro"]
    if not sessions:
        return {
            "last_created": None,
            "last_shared": None,
            "total_sessions": 0,
            "sessions_with_simple_version": 0,
            "shared_sessions": 0,
            "total_indications": 0,
            "counts_by_indication_type": {key: 0 for key in indication_types},
        }

    def _ts(value: datetime | None) -> float:
        localized = _ai_dt_in_tz(value, tz_name)
        return localized.timestamp() if localized else float("-inf")

    counts_by_type = {key: 0 for key in indication_types}
    shared_sessions = 0
    total_indications = 0
    sessions_with_simple_version = 0
    last_shared = None

    for session in sessions:
        if (getattr(session, "version_simple", "") or "").strip():
            sessions_with_simple_version += 1
        if getattr(session, "compartido_en", None) or getattr(session, "link_seguro", None):
            shared_sessions += 1
        if getattr(session, "compartido_en", None):
            if not last_shared or _ts(getattr(session, "compartido_en", None)) > _ts(getattr(last_shared, "compartido_en", None)):
                last_shared = session
        session_indications = getattr(session, "indicaciones", None) or []
        total_indications += len(session_indications)
        for item in session_indications:
            item_type = _voice_indication_type_key(item.get("tipo") if isinstance(item, dict) else "otro")
            counts_by_type[item_type] += 1

    with_created = [item for item in sessions if getattr(item, "created_at", None)]
    last_created = max(with_created, key=lambda item: _ts(getattr(item, "created_at", None)), default=None)
    return {
        "last_created": _voice_session_to_ai_dict(last_created, tz_name, technical_chars=220, simple_chars=180, indications_limit=3),
        "last_shared": _voice_session_to_ai_dict(last_shared, tz_name, technical_chars=180, simple_chars=160, indications_limit=2),
        "total_sessions": len(sessions),
        "sessions_with_simple_version": sessions_with_simple_version,
        "shared_sessions": shared_sessions,
        "total_indications": total_indications,
        "counts_by_indication_type": counts_by_type,
    }


def _sanitize_ai_reply(text: str) -> str:
    if not text:
        return ""
    cleaned = (text or "").replace("**", "").replace("__", "")
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _new_ai_conversation_id() -> str:
    return f"conv_{secrets.token_urlsafe(8)}"


def _derive_ai_conversation_title(message: str | None) -> str:
    base = re.sub(r"\s+", " ", (message or "").strip())
    if not base:
        return "Nueva conversacion"
    return _clip_text(base, 48)


def _get_ai_conversation_messages(
    db: Session,
    *,
    profile_id: int,
    conversation_id: str | None = None,
    limit: int = 100,
) -> list[models.AiConversationMessage]:
    query = db.query(models.AiConversationMessage).filter(
        models.AiConversationMessage.profile_id == profile_id
    )
    if conversation_id:
        query = query.filter(models.AiConversationMessage.conversation_id == conversation_id)
    items = (
        query.order_by(
            models.AiConversationMessage.created_at.desc(),
            models.AiConversationMessage.id.desc(),
        )
        .limit(limit)
        .all()
    )
    return list(reversed(items))


def _ai_conversation_summaries(
    db: Session,
    *,
    profile_id: int,
    limit: int = 12,
) -> list[dict]:
    items = (
        db.query(models.AiConversationMessage)
        .filter(models.AiConversationMessage.profile_id == profile_id)
        .order_by(
            models.AiConversationMessage.created_at.desc(),
            models.AiConversationMessage.id.desc(),
        )
        .limit(400)
        .all()
    )
    grouped: dict[str, dict] = {}
    for item in items:
        conv_id = (item.conversation_id or "").strip()
        if not conv_id:
            continue
        group = grouped.get(conv_id)
        if not group:
            grouped[conv_id] = {
                "conversation_id": conv_id,
                "title": (item.conversation_title or "").strip() or "Nueva conversacion",
                "updated_at": item.created_at,
                "message_count": 1,
                "last_message_excerpt": _clip_text(item.content or "", 110),
            }
        else:
            group["message_count"] += 1
            if not group.get("title") and item.conversation_title:
                group["title"] = item.conversation_title.strip()
    summaries = sorted(
        grouped.values(),
        key=lambda item: item.get("updated_at") or datetime.min,
        reverse=True,
    )
    return summaries[:limit]


def _ai_recent_conversation_context(
    db: Session,
    *,
    profile_id: int,
    exclude_conversation_id: str | None = None,
    limit: int = 4,
) -> list[dict]:
    summaries = _ai_conversation_summaries(db, profile_id=profile_id, limit=limit + 2)
    result = []
    for summary in summaries:
        if exclude_conversation_id and summary["conversation_id"] == exclude_conversation_id:
            continue
        conv_messages = _get_ai_conversation_messages(
            db,
            profile_id=profile_id,
            conversation_id=summary["conversation_id"],
            limit=24,
        )
        first_user = next((m for m in conv_messages if m.role == "user"), None)
        last_assistant = next((m for m in reversed(conv_messages) if m.role == "assistant"), None)
        result.append(
            {
                "conversation_id": summary["conversation_id"],
                "title": summary["title"],
                "message_count": summary["message_count"],
                "first_user_message": _clip_text(first_user.content if first_user else "", 140),
                "last_assistant_reply": _clip_text(last_assistant.content if last_assistant else "", 180),
                "updated_at": _safe_iso(summary.get("updated_at")),
            }
        )
        if len(result) >= limit:
            break
    return result


AI_CHAT_WORKFLOW_CONFIG = {
    "appointment": {
        "resource_label": "cita médica",
        "required_fields": ["type", "date", "time"],
        "optional_fields": ["specialty", "center", "status", "notes"],
    },
    "medication": {
        "resource_label": "medicamento",
        "required_fields": ["name", "frequency", "start_at"],
        "optional_fields": ["dose", "duration", "end_date", "notes"],
    },
    "document": {
        "resource_label": "documento",
        "required_fields": ["doc_type", "file"],
        "optional_fields": ["date", "center", "notes"],
    },
    "profile_note": {
        "resource_label": "nota del perfil",
        "required_fields": ["note"],
        "optional_fields": [],
    },
}

AI_CHAT_WORKFLOW_FIELD_LABELS = {
    "type": "tipo",
    "date": "fecha",
    "time": "hora",
    "specialty": "especialidad",
    "center": "centro",
    "status": "estado",
    "notes": "notas",
    "name": "nombre",
    "dose": "dosis",
    "frequency": "frecuencia",
    "start_at": "inicio del tratamiento",
    "schedule_time": "horario",
    "duration": "duración",
    "end_date": "fecha de término",
    "doc_type": "tipo de documento",
    "file": "archivo",
    "note": "nota del perfil",
}

AI_CHAT_WORKFLOW_CANCEL_TOKENS = {
    "cancelar",
    "cancelalo",
    "cancelar flujo",
    "detener",
    "salir",
    "olvidalo",
    "olvídalo",
    "ya no",
}

AI_CHAT_WORKFLOW_SKIP_TOKENS = {
    "omitir",
    "omite",
    "sin dato",
    "sin datos",
    "no se",
    "no sé",
    "ninguno",
    "ninguna",
    "no aplica",
    "pasar",
    "saltalo",
    "sáltalo",
}

AI_CHAT_WORKFLOW_CONFIRM_TOKENS = {
    "si",
    "sí",
    "si guardala",
    "sí guárdala",
    "guardala",
    "guárdala",
    "guardarla",
    "guardar",
    "guardar asi",
    "guardar así",
    "tal como esta",
    "tal como está",
    "asi esta bien",
    "así está bien",
    "confirmar",
    "confirmo",
    "ok",
    "okay",
    "dale",
    "correcto",
    "perfecto",
    "listo",
}


def _get_ai_conversation_workflow(
    db: Session,
    *,
    profile_id: int,
    conversation_id: str | None,
):
    conv_id = (conversation_id or "").strip()
    if not conv_id:
        return None
    return (
        db.query(models.AiConversationWorkflow)
        .filter(
            models.AiConversationWorkflow.profile_id == profile_id,
            models.AiConversationWorkflow.conversation_id == conv_id,
        )
        .first()
    )


def _save_ai_conversation_workflow(
    db: Session,
    *,
    profile_id: int,
    user_id: int,
    conversation_id: str,
    workflow_type: str,
    payload_json: dict | None = None,
    status: str = "collecting",
):
    item = _get_ai_conversation_workflow(
        db,
        profile_id=profile_id,
        conversation_id=conversation_id,
    )
    if item is None:
        item = models.AiConversationWorkflow(
            profile_id=profile_id,
            user_id=user_id,
            conversation_id=(conversation_id or "").strip(),
            workflow_type=(workflow_type or "").strip(),
            status=(status or "").strip() or "collecting",
            payload_json=payload_json or {},
        )
        db.add(item)
    else:
        item.workflow_type = (workflow_type or "").strip()
        item.status = (status or "").strip() or "collecting"
        item.payload_json = payload_json or {}
        item.updated_at = datetime.now()
    db.commit()
    db.refresh(item)
    return item


def _clear_ai_conversation_workflow(
    db: Session,
    *,
    profile_id: int,
    conversation_id: str | None,
):
    item = _get_ai_conversation_workflow(
        db,
        profile_id=profile_id,
        conversation_id=conversation_id,
    )
    if item is None:
        return False
    db.delete(item)
    db.commit()
    return True


def _workflow_cancel_requested(message: str | None) -> bool:
    normalized = _normalize_text(message or "")
    return normalized in {_normalize_text(token) for token in AI_CHAT_WORKFLOW_CANCEL_TOKENS}


def _workflow_skip_requested(message: str | None) -> bool:
    normalized = _normalize_text(message or "")
    if not normalized:
        return False
    return normalized in {_normalize_text(token) for token in AI_CHAT_WORKFLOW_SKIP_TOKENS}


def _detect_chat_creation_target(message: str | None) -> str | None:
    normalized = _normalize_text(message or "")
    if not normalized:
        return None
    appointment_tokens = [
        "crear cita",
        "crea una cita",
        "agendar cita",
        "agenda una cita",
        "crear examen",
        "agendar examen",
        "crear hora",
        "reservar hora",
    ]
    medication_tokens = [
        "crear medicamento",
        "crea un medicamento",
        "agregar medicamento",
        "agrega un medicamento",
        "registrar medicamento",
        "guardar medicamento",
        "crear remedio",
        "agregar remedio",
    ]
    document_tokens = [
        "subir documento",
        "guardar documento",
        "crear documento",
        "agregar documento",
        "subir receta",
        "subir resultado",
        "subir informe",
        "subir orden",
    ]
    profile_note_tokens = [
        "crear nota del perfil",
        "crea una nota del perfil",
        "crear nota",
        "crea una nota",
        "crear nota rapida",
        "crear nota rápida",
        "agregar nota del perfil",
        "agregar nota",
        "agrega una nota",
        "agregar nota rapida",
        "agregar nota rápida",
        "guardar nota del perfil",
        "guardar nota",
        "guardar nota rapida",
        "guardar nota rápida",
        "registrar nota",
        "necesito una nota",
        "quiero una nota",
        "haz una nota",
        "hacer una nota",
        "anota que",
        "anotar que",
        "deja una nota",
    ]
    if any(token in normalized for token in appointment_tokens):
        return "appointment"
    if any(token in normalized for token in medication_tokens):
        return "medication"
    if any(token in normalized for token in document_tokens):
        return "document"
    if any(token in normalized for token in profile_note_tokens):
        return "profile_note"
    return None


def _workflow_confirmation_accepted(message: str | None) -> bool:
    normalized = _normalize_text(message or "")
    if not normalized:
        return False
    if normalized in {_normalize_text(token) for token in AI_CHAT_WORKFLOW_CONFIRM_TOKENS}:
        return True
    return any(
        token in normalized
        for token in [
            "quiero guardarla",
            "quiero guardar",
            "puedes guardarla",
            "puedes guardar",
            "guardala tal como esta",
            "guárdala tal como está",
            "guardarla tal como esta",
            "guardarla tal como está",
        ]
    )


def _extract_profile_note_candidate(message: str | None) -> str:
    text_value = (message or "").strip()
    if not text_value:
        return ""
    cleaned = text_value
    patterns = [
        r"^(?:necesito|quiero|me gustaria|me gustaría|haz|hacer)\s+(?:una\s+)?nota\s+del\s+perfil\s*(?:para\s+)?(?:indicar|recordar|anotar)?\s*(?:que\s+)?",
        r"^(?:necesito|quiero|me gustaria|me gustaría|haz|hacer)\s+(?:una\s+)?nota(?:\s+rapida|\s+rápida)?\s*(?:para\s+)?(?:indicar|recordar|anotar)?\s*(?:que\s+)?",
        r"^(?:crea|crear|agrega|agregar|guarda|guardar|registra|registrar)\s+(?:una\s+)?nota\s+del\s+perfil\s*(?:para\s+)?(?:indicar|recordar|anotar)?\s*(?:que\s+)?",
        r"^(?:crea|crear|agrega|agregar|guarda|guardar|registra|registrar)\s+(?:una\s+)?nota(?:\s+rapida|\s+rápida)?\s*(?:para\s+)?(?:indicar|recordar|anotar)?\s*(?:que\s+)?",
        r"^(?:anota|anotar)\s+(?:que\s+)?",
        r"^(?:deja|dejar)\s+(?:una\s+)?nota\s+del\s+perfil\s*(?:que\s+)?",
        r"^(?:deja|dejar)\s+(?:una\s+)?nota(?:\s+rapida|\s+rápida)?\s*(?:que\s+)?",
    ]
    for pattern in patterns:
        next_value = re.sub(pattern, "", cleaned, flags=re.IGNORECASE).strip()
        if next_value != cleaned:
            cleaned = next_value
            break
    cleaned = cleaned.strip(" .:-")
    return cleaned or text_value


def _workflow_profile_note_confirmation_reply(note_text: str) -> str:
    clipped = _clip_text(note_text, 260)
    return (
        f'Voy a agregar la siguiente nota del perfil: "{clipped}". '
        "¿Te gustaría que la guarde así o deseas hacer algún cambio?"
    )


def _parse_chat_time_value(message: str | None) -> str | None:
    raw = message or ""
    match = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", raw, re.IGNORECASE)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or "0")
    suffix = (match.group(3) or "").lower()
    if suffix == "pm" and hour < 12:
        hour += 12
    if suffix == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


def _parse_chat_date_value(message: str | None, tz_name: str) -> str | None:
    raw = (message or "").strip()
    normalized = _normalize_text(raw)
    now = datetime.now(_safe_zoneinfo(tz_name))
    if "manana" in normalized:
        target = now + timedelta(days=1)
        return target.strftime("%Y-%m-%d")
    if "hoy" in normalized:
        return now.strftime("%Y-%m-%d")
    iso_match = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", raw)
    if iso_match:
        year, month, day = [int(part) for part in iso_match.groups()]
        try:
            return datetime(year, month, day).strftime("%Y-%m-%d")
        except ValueError:
            return None
    local_match = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b", raw)
    if local_match:
        day, month, year = [int(part) for part in local_match.groups()]
        if year < 100:
            year += 2000
        try:
            return datetime(year, month, day).strftime("%Y-%m-%d")
        except ValueError:
            return None
    return None


def _parse_chat_datetime_parts(message: str | None, tz_name: str) -> tuple[str | None, str | None]:
    return _parse_chat_date_value(message, tz_name), _parse_chat_time_value(message)


def _parse_appointment_type(message: str | None):
    normalized = _normalize_text(message or "")
    if "examen" in normalized:
        return models.AppointmentType.examen.value
    if "tramite" in normalized or "trámite" in (message or "").lower():
        return models.AppointmentType.tramite.value
    if any(token in normalized for token in ["cita", "consulta", "hora", "medica", "medica"]):
        return models.AppointmentType.cita.value
    return None


def _parse_appointment_status(message: str | None):
    normalized = _normalize_text(message or "")
    if "realizada" in normalized or "realizado" in normalized:
        return models.AppointmentStatus.realizada.value
    if "agendada" in normalized or "agendado" in normalized:
        return models.AppointmentStatus.agendada.value
    if "pendiente" in normalized:
        return models.AppointmentStatus.pendiente.value
    return None


def _parse_document_type(message: str | None):
    normalized = _normalize_text(message or "")
    if "receta" in normalized:
        return models.DocumentType.receta.value
    if "orden" in normalized:
        return models.DocumentType.orden.value
    if "resultado" in normalized or "laboratorio" in normalized:
        return models.DocumentType.resultado.value
    if "informe" in normalized:
        return models.DocumentType.informe.value
    if "documento" in normalized or "archivo" in normalized:
        return models.DocumentType.otro.value
    return None


def _strip_workflow_command_prefix(message: str | None) -> str:
    text_value = (message or "").strip()
    if not text_value:
        return ""
    cleaned = re.sub(
        r"^(?:necesito|quiero|puedes|por favor|favor)?\s*(?:que\s+)?(?:me\s+)?(?:crees?|crear|agregues?|agregar|guardes?|guardar|registres?|registrar|subas?|subir|agendes?|agendar)\s+(?:una?|el|la)?\s*",
        "",
        text_value,
        flags=re.IGNORECASE,
    ).strip()
    return cleaned or text_value


def _extract_workflow_values(
    workflow_type: str,
    message: str,
    *,
    tz_name: str,
    current_field: str | None = None,
) -> dict:
    text_value = (message or "").strip()
    extracted: dict = {}
    if workflow_type == "appointment":
        appointment_type = _parse_appointment_type(text_value)
        if appointment_type:
            extracted["type"] = appointment_type
        status_value = _parse_appointment_status(text_value)
        if status_value:
            extracted["status"] = status_value
        date_value, time_value = _parse_chat_datetime_parts(text_value, tz_name)
        if date_value:
            extracted["date"] = date_value
        if time_value:
            extracted["time"] = time_value
        if current_field == "specialty" and text_value:
            extracted["specialty"] = text_value
        if current_field == "center" and text_value:
            extracted["center"] = text_value
        if current_field == "notes" and text_value:
            extracted["notes"] = text_value
    elif workflow_type == "medication":
        if current_field == "name" and text_value:
            extracted["name"] = _strip_workflow_command_prefix(text_value)
        if current_field == "dose" and text_value:
            extracted["dose"] = text_value
        if current_field == "frequency" and text_value:
            extracted["frequency"] = text_value
        if current_field == "start_at":
            start_date_value, start_time_value = _parse_chat_datetime_parts(text_value, tz_name)
            if start_date_value and start_time_value:
                extracted["start_at"] = f"{start_date_value}T{start_time_value}:00"
                extracted["schedule_time"] = start_time_value
        if current_field == "schedule_time":
            schedule_value = _parse_chat_time_value(text_value)
            if schedule_value:
                extracted["schedule_time"] = schedule_value
            elif text_value:
                extracted["schedule_time"] = text_value
        if current_field == "duration" and text_value:
            extracted["duration"] = text_value
        if current_field == "end_date":
            end_date_value = _parse_chat_date_value(text_value, tz_name)
            if end_date_value:
                extracted["end_date"] = end_date_value
        if current_field == "notes" and text_value:
            extracted["notes"] = text_value
    elif workflow_type == "document":
        doc_type = _parse_document_type(text_value)
        if doc_type:
            extracted["doc_type"] = doc_type
        date_value = _parse_chat_date_value(text_value, tz_name)
        if date_value:
            extracted["date"] = date_value
        if current_field == "center" and text_value:
            extracted["center"] = text_value
        if current_field == "notes" and text_value:
            extracted["notes"] = text_value
    elif workflow_type == "profile_note":
        candidate = _extract_profile_note_candidate(text_value)
        if current_field == "note" and candidate:
            extracted["note"] = candidate
    return extracted


def _workflow_prompt_for_field(workflow_type: str, field_name: str) -> str:
    if workflow_type == "appointment":
        prompts = {
            "type": "¿Qué tipo de cita quieres crear: cita médica, examen o trámite?",
            "date": "¿Qué fecha quieres registrar? Puedes decirme algo como 2026-03-20 o 20/03/2026.",
            "time": "¿A qué hora quieres dejarla agendada? Por ejemplo 15:30.",
            "specialty": "¿Qué especialidad o motivo quieres registrar? Si prefieres, escribe 'omitir'.",
            "center": "¿En qué centro o clínica será? Si no lo sabes, escribe 'omitir'.",
            "status": "¿Qué estado quieres guardar: pendiente, agendada o realizada? Si no quieres cambiarlo, escribe 'omitir'.",
            "notes": "¿Quieres agregar notas adicionales? Si no, escribe 'omitir'.",
        }
        return prompts.get(field_name, "Falta un dato para crear la cita.")
    if workflow_type == "medication":
        prompts = {
            "name": "¿Cómo se llama el medicamento?",
            "start_at": "¿Cuándo fue la primera dosis? Indícame fecha y hora exactas, por ejemplo 2026-03-14 20:00 o 14/03/2026 20:00.",
            "dose": "¿Qué dosis quieres registrar? Si no la sabes, escribe 'omitir'.",
            "frequency": "¿Qué frecuencia de uso tendrá? Por ejemplo 'cada 8 horas' o 'cada 12 horas'.",
            "duration": "¿Cuál es la duración del tratamiento? Si no la sabes, escribe 'omitir'.",
            "end_date": "¿Hasta qué fecha aplica? Puedes decirme 2026-03-30. Si no quieres guardarla, escribe 'omitir'.",
            "notes": "¿Quieres agregar notas del medicamento? Si no, escribe 'omitir'.",
        }
        return prompts.get(field_name, "Falta un dato para crear el medicamento.")
    if workflow_type == "profile_note":
        prompts = {
            "note": "¿Qué texto quieres guardar como nota del perfil?",
        }
        return prompts.get(field_name, "Falta el texto de la nota del perfil.")
    prompts = {
        "doc_type": "¿Qué tipo de documento quieres guardar: receta, orden, resultado, informe u otro?",
        "file": "Adjunta el archivo del documento y envíame cualquier mensaje breve para continuar.",
        "date": "¿Qué fecha quieres asociar al documento? Si no la quieres indicar, escribe 'omitir'.",
        "center": "¿Desde qué centro, clínica o laboratorio viene? Si no lo sabes, escribe 'omitir'.",
        "notes": "¿Quieres agregar notas del documento? Si no, escribe 'omitir'.",
    }
    return prompts.get(field_name, "Falta un dato para guardar el documento.")


def _workflow_next_field(workflow_type: str, values: dict | None, skipped_fields: list[str] | None) -> str | None:
    config = AI_CHAT_WORKFLOW_CONFIG.get(workflow_type) or {}
    values = values or {}
    skipped = set(skipped_fields or [])
    for field_name in config.get("required_fields", []):
        if field_name == "file":
            if not values.get("file_ready"):
                return field_name
            continue
        if not values.get(field_name):
            return field_name
    for field_name in config.get("optional_fields", []):
        if field_name in skipped:
            continue
        if not values.get(field_name):
            return field_name
    return None


def _workflow_attachment_payload(attachment: schemas.AiChatAttachmentIn | None) -> dict | None:
    if attachment is None or not (attachment.data_base64 or "").strip():
        return None
    raw_data = (attachment.data_base64 or "").strip()
    if "," in raw_data and raw_data.lower().startswith("data:"):
        raw_data = raw_data.split(",", 1)[1]
    try:
        binary = base64.b64decode(raw_data, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="No pude leer el archivo adjunto del chat.")
    if len(binary) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Archivo demasiado grande. Maximo permitido: 10 MB.")
    filename = (attachment.filename or "").strip() or "documento"
    content_type = (attachment.content_type or "").strip() or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return {
        "filename": filename,
        "content_type": content_type,
        "content": binary,
    }


_CHAT_ATTACHMENT_OCR_MAX_BYTES = 5 * 1024 * 1024  # 5 MB límite para OCR inline en chat
_CHAT_ATTACHMENT_OCR_CLIP = 3200                   # chars máximos del texto OCR en contexto IA


def _classify_document_type_from_ocr(text: str, filename: str) -> str:
    """Clasifica el tipo de documento clínico a partir de texto OCR y nombre de archivo.
    Usa solo coincidencia de keywords — sin llamadas a APIs."""
    combined = _normalize_text(f"{filename} {text}")[:2000]
    if any(w in combined for w in ["receta", "prescripcion", "prescripcion medica", "medicamento prescrito", "rp "]):
        return "receta"
    if any(w in combined for w in ["resultado", "laboratorio", "hemograma", "glucosa", "colesterol", "examen de sangre",
                                    "creatinina", "hematocrito", "leucocitos", "plaquetas", "glicemia"]):
        return "examen"
    if any(w in combined for w in ["informe", "epicrisis", "alta medica", "resumen clinico", "diagnostico principal",
                                    "evolucion clinica", "anamnesis", "antecedentes"]):
        return "informe"
    if any(w in combined for w in ["orden", "solicitud de examen", "solicito", "se solicita", "indicacion", "indicaciones"]):
        return "orden"
    return "otro"


def _extract_chat_attachment_ocr(attachment_payload: dict | None) -> tuple[str, str]:
    """Extrae texto OCR de un attachment de chat de forma sincrónica.
    Devuelve (ocr_text, doc_type_inferred). Nunca lanza excepción."""
    if not attachment_payload:
        return "", "otro"
    binary = attachment_payload.get("content") or b""
    filename = attachment_payload.get("filename") or "documento"
    if not binary or len(binary) > _CHAT_ATTACHMENT_OCR_MAX_BYTES:
        return "", "otro"
    try:
        raw_text = _extract_ocr_text(binary, filename)
    except Exception:
        return "", "otro"
    if not raw_text or not raw_text.strip():
        return "", "otro"
    clipped = _clip_text(raw_text.strip(), _CHAT_ATTACHMENT_OCR_CLIP)
    doc_type = _classify_document_type_from_ocr(raw_text, filename)
    return clipped, doc_type


def _save_document_from_chat_attachment(
    db: Session,
    *,
    user_id: int,
    attachment_payload: dict,
    ocr_text: str,
    doc_type_inferred: str,
    profile,
) -> None:
    """Guarda el documento adjunto del chat como registro DB.
    Llamar siempre desde background_tasks para no bloquear la respuesta."""
    try:
        binary = attachment_payload.get("content") or b""
        filename = attachment_payload.get("filename") or "documento"
        if not binary:
            return
        doc_type_map = {
            "receta": models.DocumentType.receta,
            "examen": models.DocumentType.resultado,
            "informe": models.DocumentType.informe,
            "orden": models.DocumentType.orden,
        }
        doc_type_enum = doc_type_map.get(doc_type_inferred, models.DocumentType.otro)
        doc = models.Document(
            user_id=int(user_id),
            profile_id=int(getattr(profile, "id", 0) or 0) or None,
            doc_type=doc_type_enum,
            filename=filename,
            file_data=binary,
            ocr_text=ocr_text or None,
            ocr_status="done" if ocr_text else "pending",
            ocr_lang=OCR_LANG_DEFAULT,
            notes="Subido desde el chat de Klinip IA",
        )
        db.add(doc)
        db.flush()
        if ocr_text:
            _upsert_document_intelligence(db, doc)
            _upsert_document_memory_chunks(
                db,
                doc,
                profile_id=int(getattr(profile, "id", 0) or 0) or None,
            )
        _mark_profile_ai_dirty(db, profile, include_family=False)
        db.commit()
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        print(f"WARNING _save_document_from_chat_attachment: {exc}")


def _workflow_confirmation_reply(workflow_type: str, created_item, timezone_name: str) -> str:
    if workflow_type == "appointment":
        type_label = getattr(created_item.type, "value", created_item.type or "cita")
        when_label = _safe_iso_local(getattr(created_item, "date_time", None), timezone_name) or "sin fecha"
        return (
            f"Listo. Guardé la {type_label} para {when_label}. "
            f"Centro: {getattr(created_item, 'center', '') or 'sin centro'}. "
            "Si quieres, ahora puedo ayudarte a revisar esa cita."
        )
    if workflow_type == "medication":
        return (
            f"Listo. Guardé el medicamento {getattr(created_item, 'name', '') or 'sin nombre'}"
            + (f" con dosis {created_item.dose}." if getattr(created_item, "dose", "") else ".")
            + " Si quieres, también puedo resumirte el tratamiento."
        )
    if workflow_type == "profile_note":
        return (
            f'Listo. Guardé la nota del perfil "{_clip_text(getattr(created_item, "note", "") or "sin contenido", 220)}". '
            "Si quieres, también puedo recordarte tus notas recientes."
        )
    return (
        f"Listo. Guardé el documento {getattr(created_item, 'filename', '') or 'adjunto'}"
        + (f" como {getattr(getattr(created_item, 'doc_type', None), 'value', getattr(created_item, 'doc_type', 'documento'))}." if created_item else ".")
        + " El OCR quedará procesándose en segundo plano."
    )


def _create_appointment_from_workflow(
    db: Session,
    *,
    profile,
    target_user_id: int,
    values: dict,
    current_user: models.User,
    background_tasks: BackgroundTasks | None = None,
):
    date_value = (values.get("date") or "").strip()
    time_value = (values.get("time") or "").strip() or "09:00"
    date_time_value = None
    if date_value:
        try:
            date_time_value = datetime.fromisoformat(f"{date_value}T{time_value}:00")
        except ValueError:
            date_time_value = None
    appt = models.Appointment(
        user_id=target_user_id,
        type=models.AppointmentType(values.get("type") or models.AppointmentType.cita.value),
        specialty=(values.get("specialty") or "").strip(),
        center=(values.get("center") or "").strip(),
        date_time=date_time_value,
        status=models.AppointmentStatus(values.get("status") or models.AppointmentStatus.pendiente.value),
        notes=(values.get("notes") or "").strip(),
        checklist=[],
    )
    db.add(appt)
    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.commit()
    db.refresh(appt)
    if background_tasks is not None and current_user.email:
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


def _create_medication_from_workflow(
    db: Session,
    *,
    profile,
    target_user_id: int,
    values: dict,
    current_user: models.User,
):
    start_at_value = None
    if values.get("start_at"):
        try:
            start_at_value = datetime.fromisoformat(str(values["start_at"]).strip())
        except ValueError:
            start_at_value = None
    end_date_value = None
    if values.get("end_date"):
        try:
            end_date_value = datetime.fromisoformat(f"{values['end_date']}T00:00:00")
        except ValueError:
            end_date_value = None
    schedule_value = (values.get("schedule_time") or "").strip()
    if not schedule_value and start_at_value:
        schedule_value = start_at_value.strftime("%H:%M")
    med = models.Medication(
        user_id=target_user_id,
        name=(values.get("name") or "").strip(),
        dose=(values.get("dose") or "").strip(),
        frequency=(values.get("frequency") or "").strip(),
        duration=(values.get("duration") or "").strip(),
        schedule_time=schedule_value,
        start_at=start_at_value,
        completed=False,
        end_date=end_date_value,
        notes=(values.get("notes") or "").strip(),
        document_id=None,
    )
    db.add(med)
    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.commit()
    db.refresh(med)
    _attach_medication_adherence(db, [med], current_user)
    return med


def _create_profile_note_from_workflow(
    db: Session,
    *,
    profile,
    current_user: models.User,
    values: dict,
):
    note_text = (values.get("note") or "").strip()
    if not note_text:
        raise HTTPException(status_code=400, detail="La nota no puede estar vacía")
    item = models.ProfileNote(
        profile_id=int(getattr(profile, "id", 0) or 0),
        created_by_user_id=current_user.id,
        note=note_text,
        visibility="shared",
    )
    db.add(item)
    _log_profile_activity(
        db,
        profile_id=int(getattr(profile, "id", 0) or 0),
        actor_user_id=current_user.id,
        action_type="note_added",
        description=f"{current_user.name or current_user.email} agregó una nota del perfil desde Klinip IA",
        metadata_json={
            "visibility": item.visibility,
            "source": "ai_chat",
            "note_preview": _clip_text(note_text, 160),
        },
    )
    _mark_profile_ai_dirty(db, profile, include_family=False)
    db.commit()
    db.refresh(item)
    return item


def _create_document_from_workflow(
    db: Session,
    *,
    profile,
    target_user_id: int,
    values: dict,
    current_user: models.User,
    attachment_payload: dict,
    background_tasks: BackgroundTasks | None = None,
):
    parsed_date = None
    if values.get("date"):
        try:
            parsed_date = datetime.fromisoformat(f"{values['date']}T00:00:00")
        except ValueError:
            parsed_date = None
    original_filename = attachment_payload.get("filename") or "documento"
    doc = models.Document(
        user_id=target_user_id,
        profile_id=int(getattr(profile, "id", 0) or 0) or None,
        appointment_id=None,
        doc_type=models.DocumentType(values.get("doc_type") or models.DocumentType.otro.value),
        file_data=attachment_payload.get("content"),
        filename=original_filename,
        file_path="",
        date=parsed_date,
        center=(values.get("center") or "").strip(),
        notes=(values.get("notes") or "").strip(),
        ocr_status="pending",
        ocr_lang=OCR_LANG_DEFAULT,
    )
    db.add(doc)
    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.commit()
    db.refresh(doc)
    if background_tasks is not None:
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
        background_tasks.add_task(_run_document_ocr, doc.id)
    return doc


def _handle_chat_creation_workflow(
    db: Session,
    *,
    current_user: models.User,
    profile,
    target_user_id: int,
    conversation_id: str,
    message: str,
    timezone_name: str,
    attachment_payload: dict | None = None,
    background_tasks: BackgroundTasks | None = None,
):
    profile_id = int(profile.id)
    workflow_item = _get_ai_conversation_workflow(
        db,
        profile_id=profile_id,
        conversation_id=conversation_id,
    )
    workflow_type = (workflow_item.workflow_type or "").strip() if workflow_item else ""
    workflow_status = (workflow_item.status or "collecting").strip() if workflow_item else "collecting"
    if _workflow_cancel_requested(message):
        if workflow_item:
            _clear_ai_conversation_workflow(db, profile_id=profile_id, conversation_id=conversation_id)
            return {
                "handled": True,
                "reply": "Listo. Cancelé la creación en curso. Si quieres, puedes pedirme una nueva cita, medicamento o documento.",
                "mode": "workflow-cancelled",
                "model_name": "workflow-engine",
                "references": [],
            }
        return {"handled": False}

    if not workflow_item:
        workflow_type = _detect_chat_creation_target(message)
        if not workflow_type:
            return {"handled": False}
        payload_json = {"values": {}, "skipped_fields": []}
        workflow_item = _save_ai_conversation_workflow(
            db,
            profile_id=profile_id,
            user_id=current_user.id,
            conversation_id=conversation_id,
            workflow_type=workflow_type,
            payload_json=payload_json,
        )
        workflow_status = (workflow_item.status or "collecting").strip()

    if workflow_type == "profile_note":
        values = dict((workflow_item.payload_json or {}).get("values") or {})
        if workflow_status == "awaiting_confirmation":
            if _workflow_confirmation_accepted(message):
                created_item = _create_profile_note_from_workflow(
                    db,
                    profile=profile,
                    current_user=current_user,
                    values=values,
                )
                references = [
                    {
                        "kind": "profile-note-created",
                        "label": "Nota del perfil guardada",
                        "detail": _clip_text(getattr(created_item, "note", "") or "nota del perfil", 72),
                    }
                ]
                _clear_ai_conversation_workflow(db, profile_id=profile_id, conversation_id=conversation_id)
                return {
                    "handled": True,
                    "reply": _workflow_confirmation_reply(workflow_type, created_item, timezone_name),
                    "mode": "workflow-profile-note-created",
                    "model_name": "workflow-engine",
                    "references": references,
                }
            if _normalize_text(message or "") in {"no", "cambiar", "cambiala", "cámbiala", "editar", "modificar"}:
                _save_ai_conversation_workflow(
                    db,
                    profile_id=profile_id,
                    user_id=current_user.id,
                    conversation_id=conversation_id,
                    workflow_type=workflow_type,
                    payload_json={"values": values, "skipped_fields": []},
                    status="collecting",
                )
                return {
                    "handled": True,
                    "reply": "Perfecto. Escríbeme el texto exacto que quieres guardar como nota del perfil.",
                    "mode": "workflow-profile-note-editing",
                    "model_name": "workflow-engine",
                    "references": [],
                }

        candidate_note = _extract_profile_note_candidate(message)
        if candidate_note and not _workflow_confirmation_accepted(message):
            values["note"] = candidate_note
        note_value = (values.get("note") or "").strip()
        if not note_value:
            _save_ai_conversation_workflow(
                db,
                profile_id=profile_id,
                user_id=current_user.id,
                conversation_id=conversation_id,
                workflow_type=workflow_type,
                payload_json={"values": values, "skipped_fields": []},
                status="collecting",
            )
            return {
                "handled": True,
                "reply": _workflow_prompt_for_field(workflow_type, "note"),
                "mode": "workflow-profile-note-collecting",
                "model_name": "workflow-engine",
                "references": [],
            }

        _save_ai_conversation_workflow(
            db,
            profile_id=profile_id,
            user_id=current_user.id,
            conversation_id=conversation_id,
            workflow_type=workflow_type,
            payload_json={"values": values, "skipped_fields": []},
            status="awaiting_confirmation",
        )
        return {
            "handled": True,
            "reply": _workflow_profile_note_confirmation_reply(note_value),
            "mode": "workflow-profile-note-awaiting-confirmation",
            "model_name": "workflow-engine",
            "references": [
                {
                    "kind": "profile-note-draft",
                    "label": "Borrador de nota del perfil",
                    "detail": _clip_text(note_value, 72),
                }
            ],
        }

    values = dict((workflow_item.payload_json or {}).get("values") or {})
    skipped_fields = list((workflow_item.payload_json or {}).get("skipped_fields") or [])
    current_field = _workflow_next_field(workflow_type, values, skipped_fields)
    if attachment_payload and workflow_type == "document":
        values["file_ready"] = True
        values["file_name"] = attachment_payload.get("filename") or ""
    extracted = _extract_workflow_values(
        workflow_type,
        message,
        tz_name=timezone_name,
        current_field=current_field,
    )
    values.update({key: value for key, value in extracted.items() if value not in (None, "")})

    current_field = _workflow_next_field(workflow_type, values, skipped_fields)
    if current_field and current_field not in {"file"} and _workflow_skip_requested(message):
        if current_field not in skipped_fields:
            skipped_fields.append(current_field)
        current_field = _workflow_next_field(workflow_type, values, skipped_fields)

    if current_field is None:
        if workflow_type == "appointment":
            created_item = _create_appointment_from_workflow(
                db,
                profile=profile,
                target_user_id=target_user_id,
                values=values,
                current_user=current_user,
                background_tasks=background_tasks,
            )
            references = [
                {
                    "kind": "appointment-created",
                    "label": "Cita guardada",
                    "detail": getattr(created_item, "specialty", "") or getattr(created_item.type, "value", "cita"),
                }
            ]
        elif workflow_type == "medication":
            created_item = _create_medication_from_workflow(
                db,
                profile=profile,
                target_user_id=target_user_id,
                values=values,
                current_user=current_user,
            )
            references = [
                {
                    "kind": "medication-created",
                    "label": "Medicamento guardado",
                    "detail": getattr(created_item, "name", "") or "medicamento",
                }
            ]
        else:
            if not attachment_payload:
                values["file_ready"] = False
                payload_json = {"values": values, "skipped_fields": skipped_fields}
                _save_ai_conversation_workflow(
                    db,
                    profile_id=profile_id,
                    user_id=current_user.id,
                    conversation_id=conversation_id,
                    workflow_type=workflow_type,
                    payload_json=payload_json,
                )
                return {
                    "handled": True,
                    "reply": _workflow_prompt_for_field(workflow_type, "file"),
                    "mode": "workflow-awaiting-file",
                    "model_name": "workflow-engine",
                    "references": [],
                }
            created_item = _create_document_from_workflow(
                db,
                profile=profile,
                target_user_id=target_user_id,
                values=values,
                current_user=current_user,
                attachment_payload=attachment_payload,
                background_tasks=background_tasks,
            )
            references = [
                {
                    "kind": "document-created",
                    "label": "Documento guardado",
                    "detail": getattr(created_item, "filename", "") or "documento",
                }
            ]
        _clear_ai_conversation_workflow(db, profile_id=profile_id, conversation_id=conversation_id)
        return {
            "handled": True,
            "reply": _workflow_confirmation_reply(workflow_type, created_item, timezone_name),
            "mode": f"workflow-{workflow_type}-created",
            "model_name": "workflow-engine",
            "references": references,
        }

    payload_json = {"values": values, "skipped_fields": skipped_fields}
    _save_ai_conversation_workflow(
        db,
        profile_id=profile_id,
        user_id=current_user.id,
        conversation_id=conversation_id,
        workflow_type=workflow_type,
        payload_json=payload_json,
    )
    references = []
    if workflow_type == "document" and values.get("file_name"):
        references.append(
            {
                "kind": "attachment-ready",
                "label": "Archivo detectado",
                "detail": values.get("file_name") or "",
            }
        )
    return {
        "handled": True,
        "reply": _workflow_prompt_for_field(workflow_type, current_field),
        "mode": f"workflow-{workflow_type}-collecting",
        "model_name": "workflow-engine",
        "references": references,
    }

def _clip_text(value: str | None, limit: int = 420) -> str:
    text_value = (value or "").strip()
    if len(text_value) <= limit:
        return text_value
    return f"{text_value[:limit].rstrip()}..."


def _should_include_document_text_for_chat(message: str | None) -> bool:
    normalized = _normalize_text(message or "")
    if not normalized:
        return False
    explicit_tokens = [
        "texto completo",
        "texto del documento",
        "contenido completo",
        "transcribe",
        "transcribir",
        "ocr completo",
        "detalle completo",
        "copia el texto",
        "que dice exactamente",
        "lee el documento",
        # análisis e interpretación de documentos clínicos
        "explicame este",
        "explicame el documento",
        "explicame el examen",
        "explicame la receta",
        "explicame el informe",
        "que significa",
        "que dice el",
        "analiza el",
        "analiza este",
        "interpreta el",
        "interpreta este",
        "resume el",
        "resume este",
        "que contiene",
        "esta normal",
        "esta alterado",
        "valores alterados",
        "que debo hacer",
        "es grave",
        "que medicamento",
        "que diagnostico",
        "que hallazgos",
        "examen que subi",
        "documento que subi",
        "receta que subi",
        "informe que subi",
    ]
    return any(token in normalized for token in explicit_tokens)


def _compact_history_for_prompt(
    history: list[dict],
    *,
    max_recent_messages: int = 6,
    summary_char_limit: int = 900,
) -> tuple[list[dict], str]:
    cleaned: list[dict] = []
    for item in history or []:
        role_value = (item.get("role") or "").strip().lower()
        if role_value not in {"user", "assistant"}:
            continue
        content_value = _clip_text(item.get("content") or "", 280)
        if not content_value:
            continue
        cleaned.append({"role": role_value, "content": content_value})

    if len(cleaned) <= max_recent_messages:
        return cleaned, ""

    recent = cleaned[-max_recent_messages:]
    older = cleaned[:-max_recent_messages]
    prior_user_topics: list[str] = []
    prior_assistant_points: list[str] = []
    for item in older[-10:]:
        if item["role"] == "user":
            prior_user_topics.append(_clip_text(item["content"], 100))
        else:
            prior_assistant_points.append(_clip_text(item["content"], 110))

    summary_parts: list[str] = []
    if prior_user_topics:
        summary_parts.append(
            "Consultas previas: " + " | ".join(prior_user_topics[-4:])
        )
    if prior_assistant_points:
        summary_parts.append(
            "Respuestas previas: " + " | ".join(prior_assistant_points[-3:])
        )
    return recent, _clip_text(" ".join(summary_parts), summary_char_limit)


def _chat_profile_limiter(profile_id: int) -> threading.BoundedSemaphore:
    key = int(profile_id)
    with _chat_profile_limiters_guard:
        limiter = _chat_profile_limiters.get(key)
        if limiter is None:
            limiter = threading.BoundedSemaphore(_ai_chat_concurrency_limit())
            _chat_profile_limiters[key] = limiter
        return limiter


def _apply_ai_db_timeout(db: Session, timeout_ms: int):
    if timeout_ms <= 0:
        return
    try:
        if engine.url.get_backend_name() == "postgresql":
            db.execute(text(f"SET LOCAL statement_timeout = {int(timeout_ms)}"))
    except Exception as exc:
        print(f"WARNING ai db timeout setup failed: {exc}")


def _safe_ai_context_query(
    db: Session,
    *,
    module_name: str,
    loader,
    default_value,
    degraded_reasons: list[str],
    statement_timeout_ms: int,
    context_deadline_ts: float | None = None,
    observability: dict | None = None,
):
    if context_deadline_ts is not None and time.perf_counter() >= context_deadline_ts:
        degraded_reasons.append(f"{module_name}:budget")
        return default_value
    started_at = time.perf_counter()
    try:
        _apply_ai_db_timeout(db, statement_timeout_ms)
        value = loader()
    except Exception as exc:
        db.rollback()
        _record_observability_metric(
            observability,
            module_name=module_name,
            elapsed_ms=round((time.perf_counter() - started_at) * 1000, 1),
            rollback=True,
        )
        degraded_reasons.append(f"{module_name}:error")
        print(f"WARNING ai_context {module_name}: {exc}")
        return default_value
    _record_observability_metric(
        observability,
        module_name=module_name,
        elapsed_ms=round((time.perf_counter() - started_at) * 1000, 1),
    )
    if context_deadline_ts is not None and time.perf_counter() >= context_deadline_ts:
        degraded_reasons.append(f"{module_name}:partial")
    return value


def _degraded_ai_notice(context: dict) -> str:
    reasons = list(context.get("degraded_reasons") or [])
    if not reasons:
        return ""
    return (
        "Te respondo con el perfil activo y datos esenciales mientras termino de "
        "actualizar el analisis."
    )


def _prepend_degraded_notice(reply: str, context: dict) -> str:
    notice = _degraded_ai_notice(context)
    clean_reply = (reply or "").strip()
    if not notice:
        return clean_reply
    if clean_reply.startswith(notice):
        return clean_reply
    if not clean_reply:
        return notice
    return f"{notice} {clean_reply}"


AI_MEMORY_START = "[[KLINIP_AI_MEMORY_START]]"
AI_MEMORY_END = "[[/KLINIP_AI_MEMORY_END]]"


def _strip_ai_memory_block(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    pattern = re.compile(
        rf"{re.escape(AI_MEMORY_START)}.*?{re.escape(AI_MEMORY_END)}",
        flags=re.DOTALL,
    )
    cleaned = re.sub(pattern, "", raw).strip()
    return cleaned


def _extract_ai_memory_block(value: str | None) -> str:
    raw = value or ""
    pattern = re.compile(
        rf"{re.escape(AI_MEMORY_START)}(.*?){re.escape(AI_MEMORY_END)}",
        flags=re.DOTALL,
    )
    match = pattern.search(raw)
    if not match:
        return ""
    return (match.group(1) or "").strip()


def _merge_ai_memory_block(base_text: str | None, memory_text: str) -> str:
    clean_base = _strip_ai_memory_block(base_text)
    clean_memory = (memory_text or "").strip()
    if not clean_memory:
        return clean_base
    memory_block = f"{AI_MEMORY_START}\n{clean_memory}\n{AI_MEMORY_END}"
    if not clean_base:
        return memory_block
    return f"{clean_base}\n\n{memory_block}"


def _extract_clinical_signals_from_text(text: str | None) -> dict:
    raw = _clip_text(text or "", 16000)
    normalized = _normalize_text(raw)
    if not raw.strip():
        return {"conditions": [], "allergies": [], "metrics": [], "findings": []}

    condition_terms = [
        "diabetes",
        "hipertension",
        "hipotiroidismo",
        "asma",
        "epoc",
        "dislipidemia",
        "anemia",
        "insuficiencia renal",
        "cardiopatia",
        "arritmia",
        "cancer",
        "artritis",
        "depresion",
        "ansiedad",
    ]
    conditions = [term for term in condition_terms if term in normalized]

    allergies = []
    for m in re.finditer(r"alerg(?:ia|ias)\s*(?:a|:)?\s*([^\n\.;]{3,120})", raw, re.IGNORECASE):
        value = _clip_text((m.group(1) or "").strip(), 70)
        if value:
            allergies.append(value)

    metric_keywords = [
        "glucosa",
        "hemoglobina glicosilada",
        "hba1c",
        "colesterol total",
        "ldl",
        "hdl",
        "trigliceridos",
        "creatinina",
        "tsh",
        "t4",
        "hemoglobina",
    ]
    metrics = []
    metric_pattern = re.compile(
        r"(?P<label>[A-Za-zÁÉÍÓÚáéíóúñÑ0-9\s]+?)\s*[:=]?\s*(?P<value>\d+(?:[.,]\d+)?)\s*(?P<unit>%|mg/?dl|g/?dl|ui/?ml|m?mol/?l)?",
        re.IGNORECASE,
    )
    for match in metric_pattern.finditer(raw):
        label = (match.group("label") or "").strip()
        value = (match.group("value") or "").strip()
        unit = (match.group("unit") or "").strip()
        norm_label = _normalize_text(label)
        if not any(keyword in norm_label for keyword in metric_keywords):
            continue
        metric_text = f"{label}: {value}{(' ' + unit) if unit else ''}".strip()
        metrics.append(_clip_text(metric_text, 60))
        if len(metrics) >= 6:
            break

    findings = []
    finding_keywords = (
        "diagnostico",
        "impresion",
        "conclusion",
        "hallazgo",
        "indicacion",
        "plan",
        "tratamiento",
    )
    for line in raw.splitlines():
        line_clean = line.strip(" -:\t")
        if len(line_clean) < 8:
            continue
        line_norm = _normalize_text(line_clean)
        if any(keyword in line_norm for keyword in finding_keywords):
            findings.append(_clip_text(line_clean, 120))
        if len(findings) >= 6:
            break

    return {
        "conditions": list(dict.fromkeys(conditions))[:6],
        "allergies": list(dict.fromkeys(allergies))[:5],
        "metrics": list(dict.fromkeys(metrics))[:6],
        "findings": list(dict.fromkeys(findings))[:6],
    }


def _build_ai_profile_memory(
    *,
    profile: models.HealthProfile,
    documents: list[models.Document],
    medications: list[models.Medication],
    upcoming: list[models.Appointment],
) -> str:
    recent_docs = [doc for doc in (documents or []) if (doc.ocr_text or "").strip()][:4]
    aggregated_signals = {"conditions": [], "allergies": [], "metrics": [], "findings": []}
    for doc in recent_docs:
        signals = _extract_clinical_signals_from_text(doc.ocr_text or "")
        for key in aggregated_signals.keys():
            aggregated_signals[key].extend(signals.get(key) or [])

    for key in aggregated_signals.keys():
        aggregated_signals[key] = list(dict.fromkeys(aggregated_signals[key]))[:8]

    active_meds = [med for med in (medications or []) if not bool(getattr(med, "completed", False))]
    active_med_names = []
    for med in active_meds[:8]:
        detail = (med.name or "").strip() or "Medicamento"
        if med.dose:
            detail += f" ({med.dose})"
        active_med_names.append(detail)

    next_appointments = []
    for item in (upcoming or [])[:4]:
        if not item.date_time:
            continue
        label = _safe_iso(item.date_time)
        if item.specialty:
            label = f"{label} · {item.specialty}"
        if item.center:
            label = f"{label} · {item.center}"
        next_appointments.append(_clip_text(label, 120))

    lines = [
        f"Resumen automatico IA ({datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC).",
        f"Perfil: {profile.full_name}.",
    ]
    if aggregated_signals["conditions"]:
        lines.append("Condiciones detectadas en documentos: " + ", ".join(aggregated_signals["conditions"][:6]) + ".")
    if aggregated_signals["allergies"]:
        lines.append("Alergias mencionadas: " + ", ".join(aggregated_signals["allergies"][:5]) + ".")
    if active_med_names:
        lines.append("Medicacion activa estimada: " + "; ".join(active_med_names[:6]) + ".")
    if next_appointments:
        lines.append("Proximas citas: " + " | ".join(next_appointments[:3]) + ".")
    if aggregated_signals["metrics"]:
        lines.append("Metricas clinicas OCR: " + "; ".join(aggregated_signals["metrics"][:6]) + ".")
    if aggregated_signals["findings"]:
        lines.append("Hallazgos clave OCR: " + " | ".join(aggregated_signals["findings"][:4]) + ".")

    return "\n".join(lines).strip()


def _resolve_profile_for_user_learning(db: Session, user_id: int) -> models.HealthProfile | None:
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user and getattr(user, "active_health_profile_id", None):
        profile = (
            db.query(models.HealthProfile)
            .filter(
                models.HealthProfile.id == int(user.active_health_profile_id),
                models.HealthProfile.owner_user_id == user_id,
                models.HealthProfile.is_archived.is_(False),
            )
            .first()
        )
        if profile:
            return profile
    profile = (
        db.query(models.HealthProfile)
        .filter(
            models.HealthProfile.owner_user_id == user_id,
            models.HealthProfile.is_archived.is_(False),
        )
        .order_by(models.HealthProfile.is_primary_profile.desc(), models.HealthProfile.created_at.asc())
        .first()
    )
    return profile


def _refresh_profile_ai_learning_memory(db: Session, user_id: int):
    profile = _resolve_profile_for_user_learning(db, user_id)
    if not profile:
        return

    documents = (
        db.query(models.Document)
        .filter(models.Document.user_id == user_id)
        .order_by(models.Document.created_at.desc())
        .limit(20)
        .all()
    )
    medications = (
        db.query(models.Medication)
        .filter(models.Medication.user_id == user_id)
        .order_by(models.Medication.created_at.desc())
        .limit(30)
        .all()
    )
    upcoming = (
        db.query(models.Appointment)
        .filter(
            models.Appointment.user_id == user_id,
            models.Appointment.date_time.isnot(None),
            models.Appointment.status != models.AppointmentStatus.realizada,
        )
        .order_by(models.Appointment.date_time.asc())
        .limit(8)
        .all()
    )
    memory_text = _build_ai_profile_memory(
        profile=profile,
        documents=documents,
        medications=medications,
        upcoming=upcoming,
    )
    profile.base_medical_data = _merge_ai_memory_block(profile.base_medical_data or "", memory_text)
    db.add(profile)


def _parse_duration_days(value: str | None) -> int | None:
    raw = _normalize_text(value or "")
    if not raw:
        return None
    number_words = {
        "uno": 1,
        "una": 1,
        "dos": 2,
        "tres": 3,
        "cuatro": 4,
        "cinco": 5,
        "seis": 6,
        "siete": 7,
        "ocho": 8,
        "nueve": 9,
        "diez": 10,
        "catorce": 14,
        "quince": 15,
        "veintiuno": 21,
        "veintiocho": 28,
        "treinta": 30,
    }
    for word, amount in number_words.items():
        raw = re.sub(rf"\b{word}\b", str(amount), raw)
    match = re.search(r"(\d{1,3})\s*(dia|dias|day|days|semana|semanas|mes|meses)", raw)
    if not match:
        alt = re.search(r"(por|durante|x)\s*(\d{1,3})", raw)
        if alt:
            return int(alt.group(2))
        return None
    amount = int(match.group(1))
    unit = match.group(2)
    if unit.startswith("semana"):
        return amount * 7
    if unit.startswith("mes"):
        return amount * 30
    return amount


def _estimate_daily_frequency(med: models.Medication) -> int:
    schedule = [item.strip() for item in (med.schedule_time or "").split(",") if item.strip()]
    if schedule:
        return max(1, len(schedule))
    raw = _normalize_text(" ".join([med.frequency or "", med.notes or ""]))
    if not raw:
        return 1
    explicit_map = [
        (r"\b(cada 24|una vez|1 vez|diaria|al dia)\b", 1),
        (r"\b(cada 12|2 veces|dos veces|manana y noche)\b", 2),
        (r"\b(cada 8|3 veces|tres veces)\b", 3),
        (r"\b(cada 6|4 veces|cuatro veces)\b", 4),
    ]
    for pattern, value in explicit_map:
        if re.search(pattern, raw):
            return value
    found = re.search(r"\b(\d)\s*veces\b", raw)
    if found:
        return max(1, int(found.group(1)))
    return 1


def _upsert_adherence_summaries(
    db: Session,
    profile: models.HealthProfile,
    medications: list[models.Medication],
    window_days: int = 30,
) -> dict:
    now = datetime.now()
    since = now - timedelta(days=window_days)
    summaries: list[dict] = []
    overall_rates: list[float] = []
    low_items: list[dict] = []
    pattern_days: dict[str, int] = {}
    pattern_hours: dict[str, int] = {"manana": 0, "tarde": 0, "noche": 0}

    for med in medications:
        daily_freq = _estimate_daily_frequency(med)
        expected = _calculate_expected_doses_between(med, since, now)
        intake_rows = (
            db.query(models.MedicationIntake)
            .filter(
                models.MedicationIntake.medication_id == med.id,
                or_(
                    models.MedicationIntake.taken_at >= since,
                    models.MedicationIntake.scheduled_at >= since,
                ),
            )
            .all()
        )
        taken = 0
        late = 0
        explicit_missed = 0
        for row in intake_rows:
            normalized_status = _normalize_adherence_status(getattr(row, "status", "taken"))
            if normalized_status in {"taken", "late"}:
                taken += 1
            if normalized_status == "late":
                late += 1
            if normalized_status in {"missed", "skipped"}:
                explicit_missed += 1
        missed = max(explicit_missed, max(expected - taken, 0))
        adherence_rate = int(round(min((taken / max(expected, 1)) * 100, 100))) if expected else 0
        overall_rates.append(adherence_rate)
        if adherence_rate < 80 and not bool(med.completed):
            low_items.append(
                {
                    "medication_id": med.id,
                    "name": med.name or "Medicamento",
                    "adherence_rate": adherence_rate,
                    "missed_count": missed,
                }
            )
        for intake in intake_rows:
            event_dt = getattr(intake, "taken_at", None) or getattr(intake, "scheduled_at", None)
            if not event_dt:
                continue
            pattern_days[event_dt.strftime("%A").lower()] = pattern_days.get(event_dt.strftime("%A").lower(), 0) + 1
            hour = event_dt.hour
            slot = "manana" if hour < 12 else "tarde" if hour < 19 else "noche"
            pattern_hours[slot] = pattern_hours.get(slot, 0) + 1

        pattern_json = {
            "daily_frequency_estimate": daily_freq,
            "most_recorded_day": max(pattern_days, key=pattern_days.get) if pattern_days else "",
            "dominant_time_slot": max(pattern_hours, key=pattern_hours.get) if pattern_hours else "",
        }
        row = (
            db.query(models.AdherenceSummary)
            .filter(
                models.AdherenceSummary.profile_id == profile.id,
                models.AdherenceSummary.medication_id == med.id,
                models.AdherenceSummary.window_days == window_days,
            )
            .first()
        )
        if not row:
            row = models.AdherenceSummary(
                profile_id=profile.id,
                medication_id=med.id,
                window_days=window_days,
            )
        row.adherence_rate = adherence_rate
        row.missed_count = missed
        row.late_count = late
        row.expected_doses = expected
        row.taken_doses = taken
        row.pattern_json = pattern_json
        row.updated_at = now
        db.add(row)
        summaries.append(
            {
                "medication_id": med.id,
                "name": med.name or "Medicamento",
                "adherence_rate": adherence_rate,
                "expected_doses": expected,
                "taken_doses": taken,
                "missed_count": missed,
                "pattern": pattern_json,
            }
        )

    overall_rate = round(sum(overall_rates) / len(overall_rates), 1) if overall_rates else None
    best_day = max(pattern_days, key=pattern_days.get) if pattern_days else ""
    risk_slot = min(pattern_hours, key=pattern_hours.get) if any(pattern_hours.values()) else ""
    return {
        "window_days": window_days,
        "overall_adherence_rate": overall_rate,
        "low_adherence": bool(low_items),
        "low_adherence_items": low_items[:6],
        "medication_items": summaries[:12],
        "pattern_summary": {
            "most_consistent_day": best_day,
            "lowest_recorded_time_slot": risk_slot,
        },
    }


def _load_adherence_summary_cached(
    db: Session,
    profile: models.HealthProfile,
    medications: list[models.Medication],
    window_days: int = 30,
) -> dict:
    medication_ids = [med.id for med in medications if getattr(med, "id", None)]
    if not medication_ids:
        return {
            "window_days": window_days,
            "overall_adherence_rate": None,
            "low_adherence": False,
            "low_adherence_items": [],
            "medication_items": [],
            "pattern_summary": {
                "most_consistent_day": "",
                "lowest_recorded_time_slot": "",
            },
        }

    rows = (
        db.query(models.AdherenceSummary)
        .filter(
            models.AdherenceSummary.profile_id == profile.id,
            models.AdherenceSummary.window_days == window_days,
            models.AdherenceSummary.medication_id.in_(medication_ids),
        )
        .all()
    )
    row_by_medication = {row.medication_id: row for row in rows}
    summaries: list[dict] = []
    overall_rates: list[float] = []
    low_items: list[dict] = []
    day_counts: dict[str, int] = {}
    time_counts: dict[str, int] = {}

    for med in medications:
        row = row_by_medication.get(med.id)
        if not row:
            continue
        adherence_rate = int(getattr(row, "adherence_rate", 0) or 0)
        pattern_json = getattr(row, "pattern_json", {}) or {}
        summaries.append(
            {
                "medication_id": med.id,
                "name": med.name or "Medicamento",
                "adherence_rate": adherence_rate,
                "expected_doses": int(getattr(row, "expected_doses", 0) or 0),
                "taken_doses": int(getattr(row, "taken_doses", 0) or 0),
                "missed_count": int(getattr(row, "missed_count", 0) or 0),
                "pattern": pattern_json,
            }
        )
        overall_rates.append(adherence_rate)
        if adherence_rate < 80 and not bool(med.completed):
            low_items.append(
                {
                    "medication_id": med.id,
                    "name": med.name or "Medicamento",
                    "adherence_rate": adherence_rate,
                    "missed_count": int(getattr(row, "missed_count", 0) or 0),
                }
            )
        best_day = (pattern_json.get("most_recorded_day") or "").strip()
        dominant_slot = (pattern_json.get("dominant_time_slot") or "").strip()
        if best_day:
            day_counts[best_day] = day_counts.get(best_day, 0) + 1
        if dominant_slot:
            time_counts[dominant_slot] = time_counts.get(dominant_slot, 0) + 1

    return {
        "window_days": window_days,
        "overall_adherence_rate": round(sum(overall_rates) / len(overall_rates), 1) if overall_rates else None,
        "low_adherence": bool(low_items),
        "low_adherence_items": low_items[:6],
        "medication_items": summaries[:12],
        "pattern_summary": {
            "most_consistent_day": max(day_counts, key=day_counts.get) if day_counts else "",
            "lowest_recorded_time_slot": min(time_counts, key=time_counts.get) if time_counts else "",
        },
    }


def _extract_document_lab_entities(text: str) -> list[dict]:
    entities: list[dict] = []
    if not text:
        return entities
    lines = [_safe_text(ln) for ln in text.splitlines() if _safe_text(ln)]
    patterns = [
        re.compile(
            r"^(?P<name>[A-Za-zÁÉÍÓÚÑáéíóúñ0-9/%().,\- ]{3,80}?)[:\s]+"
            r"(?P<value>[<>]?\d+(?:[.,]\d+)?)"
            r"(?:\s+(?P<unit>[A-Za-z/%µ0-9.-]{1,24}))?"
            r"(?:\s+(?P<range>(?:ref\.?|rango|vr)?\s*\d+(?:[.,]\d+)?\s*[-–a]\s*\d+(?:[.,]\d+)?))?$",
            re.IGNORECASE,
        ),
        re.compile(
            r"^(?P<name>[A-Za-zÁÉÍÓÚÑáéíóúñ0-9/%().,\- ]{3,80}?)\s+"
            r"(?P<value>[<>]?\d+(?:[.,]\d+)?)\s*"
            r"(?P<unit>[A-Za-z/%µ0-9.-]{0,24})\s+"
            r"(?P<range>\d+(?:[.,]\d+)?\s*[-–a]\s*\d+(?:[.,]\d+)?)$",
            re.IGNORECASE,
        ),
    ]
    for line in lines[:120]:
        match = None
        for pattern in patterns:
            match = pattern.match(line)
            if match:
                break
        if not match:
            continue
        name = _safe_text(match.group("name"))
        value = (match.group("value") or "").replace(",", ".")
        unit = _safe_text(match.group("unit") or "")
        reference_range = _safe_text(re.sub(r"^(ref\.?|rango|vr)\s*", "", match.group("range") or "", flags=re.IGNORECASE))
        flag = "unknown"
        try:
            numeric = float(re.sub(r"[^0-9.<>-]", "", value).replace(">", "").replace("<", ""))
            if reference_range:
                low_raw, high_raw = re.split(r"[-–a]", reference_range, maxsplit=1)
                low_value = float(low_raw.replace(",", ".").strip())
                high_value = float(high_raw.replace(",", ".").strip())
                if numeric < low_value:
                    flag = "low"
                elif numeric > high_value:
                    flag = "high"
                else:
                    flag = "normal"
        except Exception:
            flag = "unknown"
        entities.append(
            {
                "entity_type": "lab_value",
                "entity_name": name,
                "entity_value": match.group("value") or "",
                "unit": unit,
                "reference_range": reference_range,
                "flag": flag,
                "confidence": 82,
                "source_text": line[:240],
            }
        )
    return entities[:24]


def _extract_prescription_entities(text: str) -> list[dict]:
    entities: list[dict] = []
    if not text:
        return entities
    lines = [_safe_text(line) for line in text.splitlines() if _safe_text(line)]
    generic_map = {
        "Paracetamol": ["paracetamol", "acetaminofen", "panadol", "tapcin"],
        "Ibuprofeno": ["ibuprofeno", "advil", "motrin"],
        "Naproxeno": ["naproxeno", "naprosyn", "flanax"],
        "Diclofenaco": ["diclofenaco", "voltaren", "cataflam"],
        "Ketorolaco": ["ketorolaco", "dolten", "toradol"],
        "Acido acetilsalicilico": ["acido acetilsalicilico", "aspirina", "aspirineta"],
        "Omeprazol": ["omeprazol", "omeprazole", "losec", "omepral"],
        "Esomeprazol": ["esomeprazol", "nexium"],
        "Pantoprazol": ["pantoprazol", "pantozol", "pantoloc"],
        "Amoxicilina": ["amoxicilina", "amox", "amoval"],
        "Amoxicilina/Acido clavulanico": [
            "amoxicilina/acido clavulanico",
            "amoxicilina clavulanato",
            "clavulin",
            "augmentin",
        ],
        "Azitromicina": ["azitromicina", "azitro", "zithromax"],
        "Cefalexina": ["cefalexina", "keflex"],
        "Ciprofloxacino": ["ciprofloxacino", "cipro", "ciprobay"],
        "Claritromicina": ["claritromicina", "klaricid"],
        "Metformina": ["metformina", "glafornil", "glucophage"],
        "Losartan": ["losartan", "cozaar", "losacor"],
        "Valsartan": ["valsartan", "diovan"],
        "Enalapril": ["enalapril", "renitec"],
        "Amlodipino": ["amlodipino", "norvasc"],
        "Hidroclorotiazida": ["hidroclorotiazida", "hctz", "esidrex"],
        "Carvedilol": ["carvedilol", "dilatrend"],
        "Bisoprolol": ["bisoprolol", "concor"],
        "Furosemida": ["furosemida", "lasix"],
        "Levotiroxina": ["levotiroxina", "eutirox", "t4"],
        "Atorvastatina": ["atorvastatina", "lipitor"],
        "Rosuvastatina": ["rosuvastatina", "crestor"],
        "Sertralina": ["sertralina", "serlift", "zoloft"],
        "Fluoxetina": ["fluoxetina", "prozac"],
        "Escitalopram": ["escitalopram", "lexapro", "cipralex"],
        "Clonazepam": ["clonazepam", "ravotril", "clonex"],
        "Alprazolam": ["alprazolam", "xanax"],
        "Quetiapina": ["quetiapina", "seroquel"],
        "Salbutamol": ["salbutamol", "ventolin"],
        "Budesonida": ["budesonida", "symbicort", "pulmicort"],
        "Montelukast": ["montelukast", "singulair"],
        "Insulina glargina": ["insulina glargina", "lantus"],
        "Insulina lispro": ["insulina lispro", "humalog"],
        "Loratadina": ["loratadina", "clarityne"],
        "Cetirizina": ["cetirizina", "zyrtec"],
        "Desloratadina": ["desloratadina", "aerius"],
        "Prednisona": ["prednisona", "meticorten"],
        "Pregabalina": ["pregabalina", "lyrica"],
        "Tramadol": ["tramadol", "tradol"],
    }
    alias_lookup: list[tuple[str, str]] = []
    for canonical_name, aliases in generic_map.items():
        for alias in aliases:
            alias_lookup.append((alias.lower(), canonical_name))
    alias_lookup.sort(key=lambda item: len(item[0]), reverse=True)
    dose_pattern = re.compile(
        r"(?P<dose>\d+(?:[.,]\d+)?(?:/\d+(?:[.,]\d+)?)?\s*(?:mg|mcg|ug|g|gr|ml|ui|ui/ml|meq|%"
        r"|comp(?:rimidos?)?|caps?(?:ulas?)?|gotas?|sobres?|puffs?|sprays?|ampollas?|tabletas?))",
        re.IGNORECASE,
    )
    frequency_pattern = re.compile(
        r"(?P<frequency>"
        r"(?:cada|c\/)\s*\d+\s*(?:h|hr|hrs|hora|horas|d[ií]a|d[ií]as)"
        r"|(?:una|dos|tres|cuatro|\d+)\s+veces\s+al\s+d[ií]a"
        r"|1-0-1|1-1-1|1-0-0|0-0-1|0-1-0|1-1-0|0-1-1"
        r"|en la manana|en la noche|manana y noche|desayuno|almuerzo|cena|al acostarse"
        r"|si es necesario|sos|prn|segun dolor)"
        r"",
        re.IGNORECASE,
    )
    duration_pattern = re.compile(
        r"(?P<duration>"
        r"(?:por|durante|x)\s*\d+\s*(?:d[ií]as?|semanas?|mes(?:es)?)"
        r"|x\s*\d+"
        r"|hasta terminar"
        r"|tratamiento cronico"
        r"|uso cronico"
        r"|continuo"
        r"|permanente"
        r"|por\s+\d+\s+cajas?)",
        re.IGNORECASE,
    )
    skip_tokens = (
        "rut",
        "diagnostico",
        "diagnóstico",
        "firma",
        "dr.",
        "dra.",
        "indicacion de administracion",
        "indicaciones",
        "prescripcion",
        "receta electronica",
    )
    for line in lines[:80]:
        normalized_line = re.sub(r"^[\-\u2022*]+\s*", "", line).strip()
        lowered_line = normalized_line.lower()
        if not normalized_line or any(token in lowered_line for token in skip_tokens):
            continue
        alias_matches = [(alias, canonical) for alias, canonical in alias_lookup if alias in lowered_line]
        dose_match = dose_pattern.search(normalized_line)
        frequency_match = frequency_pattern.search(lowered_line)
        duration_match = duration_pattern.search(lowered_line)
        if not (alias_matches or dose_match or frequency_match or duration_match):
            continue
        dose = _safe_text(dose_match.group("dose") if dose_match else "")
        frequency = _safe_text(frequency_match.group("frequency") if frequency_match else "")
        duration = _safe_text(duration_match.group("duration") if duration_match else "")
        cut_positions = [
            match.start()
            for match in [dose_match, frequency_match, duration_match]
            if match is not None and match.start() > 0
        ]
        name_fragment = normalized_line[: min(cut_positions)] if cut_positions else normalized_line
        name_fragment = re.sub(r"[:;,]+$", "", name_fragment).strip(" -,:;")
        canonical_name = alias_matches[0][1] if alias_matches else _safe_text(name_fragment)
        aliases = sorted({canonical_name, *[canonical for _, canonical in alias_matches], *[alias.title() for alias, _ in alias_matches]})
        if not canonical_name:
            continue
        if len(canonical_name) < 3 and not dose:
            continue
        summary_parts = [part for part in [dose, frequency, duration] if part]
        entities.append(
            {
                "entity_type": "medication_instruction",
                "entity_name": canonical_name,
                "entity_value": ", ".join(summary_parts) if summary_parts else normalized_line[:120],
                "unit": dose,
                "reference_range": ", ".join(aliases[:4]) if aliases else "",
                "flag": "instruction",
                "confidence": 84 if alias_matches else 74,
                "source_text": normalized_line[:240],
            }
        )
    return entities[:12]


def _extract_diagnosis_entities(text: str) -> list[dict]:
    entities: list[dict] = []
    if not text:
        return entities

    lines = [_safe_text(line) for line in text.splitlines() if _safe_text(line)]
    explicit_patterns = [
        re.compile(
            r"^(?:dx|diag(?:nostico|n[oó]stico)?|diagnostico(?:\s+clinico)?|impresion diagnostica|hipotesis diagnostica|juicio clinico|diagnosticos?)\s*[:\-]\s*(?P<value>.+)$",
            re.IGNORECASE,
        ),
        re.compile(
            r"^(?:conclusion|impresion|hallazgos principales|evaluacion clinica)\s*[:\-]\s*(?P<value>.+)$",
            re.IGNORECASE,
        ),
    ]
    diagnosis_keywords = [
        "sindrome",
        "síndrome",
        "infeccion",
        "infección",
        "hipertension",
        "hipertensión",
        "diabetes",
        "asma",
        "bronquitis",
        "neumonia",
        "neumonía",
        "anemia",
        "gastritis",
        "hipotiroidismo",
        "hipertiroidismo",
        "depresion",
        "depresión",
        "ansiedad",
        "rinitis",
        "otitis",
        "faringitis",
        "migraña",
        "migraña",
        "cefalea",
        "covid",
    ]
    seen: set[str] = set()
    for line in lines[:120]:
        normalized_line = re.sub(r"^[\-\u2022*]+\s*", "", line).strip()
        lowered_line = normalized_line.lower()
        value = ""
        confidence = 0
        for pattern in explicit_patterns:
            match = pattern.match(normalized_line)
            if match:
                value = _safe_text(match.group("value"))
                confidence = 88 if "diagn" in lowered_line or lowered_line.startswith("dx") else 74
                break
        if not value:
            if any(keyword in lowered_line for keyword in diagnosis_keywords):
                value = normalized_line
                confidence = 64
            elif (
                len(normalized_line) <= 140
                and any(token in lowered_line for token in ["compatible con", "sugestivo de", "se observa", "impresiona"])
                and any(keyword in lowered_line for keyword in diagnosis_keywords)
            ):
                value = normalized_line
                confidence = 60
        if not value:
            continue
        cleaned_value = re.sub(r"\s+", " ", value).strip(" .;:-")
        if len(cleaned_value) < 4:
            continue
        dedupe_key = _normalize_text(cleaned_value)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        entity_name = re.split(r"[.;]", cleaned_value, maxsplit=1)[0].strip()
        entities.append(
            {
                "entity_type": "diagnosis",
                "entity_name": entity_name[:120],
                "entity_value": cleaned_value[:240],
                "unit": "",
                "reference_range": "",
                "flag": "clinical",
                "confidence": confidence,
                "source_text": normalized_line[:240],
            }
        )
    return entities[:10]


def _build_document_intelligence(doc: models.Document) -> tuple[list[dict], dict]:
    doc_type = _infer_document_type(doc)
    file_format = _document_file_format(doc)
    text = (doc.ocr_text or "").strip()
    if doc_type == "resultado":
        entities = _extract_document_lab_entities(text)
    elif doc_type == "receta":
        entities = _extract_prescription_entities(text)
    elif doc_type == "informe":
        entities = _extract_diagnosis_entities(text)
    else:
        entities = []
    abnormal_values = [item for item in entities if item.get("flag") in {"high", "low"}]
    prescription_items = [item for item in entities if item.get("entity_type") == "medication_instruction"]
    diagnosis_items = [item for item in entities if item.get("entity_type") == "diagnosis"]
    key_points: list[str] = []
    if doc.center:
        key_points.append(f"Centro: {doc.center}")
    if doc.date:
        key_points.append(f"Fecha: {_safe_iso(doc.date)}")
    if doc.filename:
        key_points.append(f"Archivo: {doc.filename}")
    if doc.notes:
        key_points.append(_clip_text(doc.notes, 140))
    if abnormal_values:
        names = ", ".join(item.get("entity_name") or "valor" for item in abnormal_values[:4])
        key_points.append(f"Valores fuera de rango detectados: {names}")
    if diagnosis_items:
        names = ", ".join(item.get("entity_name") or "diagnostico" for item in diagnosis_items[:4])
        key_points.append(f"Diagnosticos o impresiones detectadas: {names}")

    if doc_type == "resultado":
        summary_plain = (
            f"Resultado clínico en formato {file_format}. "
            + (f"Se detectaron {len(entities)} valores legibles por OCR. " if entities else "No se detectaron valores estructurados. ")
            + (f"Hay {len(abnormal_values)} valor(es) posiblemente fuera de rango." if abnormal_values else "No se identificaron valores fuera de rango de forma automática.")
        )
        patient_friendly = (
            "Este documento parece corresponder a un resultado de examen. "
            + ("Algunos valores aparecen fuera del rango informado en el mismo documento. " if abnormal_values else "")
            + "Conviene revisarlo junto a un profesional si tienes síntomas o dudas."
        )
    elif doc_type == "receta":
        summary_plain = (
            f"Receta en formato {file_format}. "
            + (f"Se detectaron {len(prescription_items)} indicaciones de medicamentos con dosis o frecuencia." if prescription_items else "El OCR sugiere instrucciones de tratamiento, pero requiere confirmacion manual.")
        )
        patient_friendly = (
            "Este documento parece una receta. "
            + ("Puedo resumir los medicamentos detectados, sus dosis y la frecuencia registrada." if prescription_items else "Puedo ayudarte a revisar manualmente dosis, frecuencia y duracion usando el texto OCR.")
        )
        if prescription_items:
            medication_labels = []
            for item in prescription_items[:4]:
                label = item.get("entity_name") or "medicamento"
                if item.get("entity_value"):
                    label += f" ({item.get('entity_value')})"
                medication_labels.append(label)
            key_points.append(
                "Medicamentos detectados: "
                + ", ".join(medication_labels)
            )
    elif doc_type == "orden":
        summary_plain = f"Orden médica en formato {file_format}. Puede contener exámenes o procedimientos solicitados."
        patient_friendly = "Este documento parece una orden médica. Puedo ayudarte a revisar qué examen o trámite fue indicado y si falta el resultado."
    elif doc_type == "informe":
        summary_plain = (
            f"Informe clínico en formato {file_format}. "
            + (
                f"Se detectaron {len(diagnosis_items)} diagnostico(s) o impresiones clinicas en el texto OCR. "
                if diagnosis_items
                else "El OCR capturó observaciones médicas para resumen. "
            )
            + "Conviene validar el contenido directamente con el informe original."
        )
        patient_friendly = (
            "Este documento parece un informe médico. "
            + (
                "Puedo resumir los diagnosticos o impresiones clinicas detectadas en lenguaje simple. "
                if diagnosis_items
                else "Puedo resumir sus hallazgos en lenguaje simple. "
            )
            + "La lectura OCR puede contener errores y no reemplaza la explicacion de tu profesional."
        )
    else:
        summary_plain = f"Documento de salud en formato {file_format}. El tipo clínico no se pudo confirmar con total certeza."
        patient_friendly = "Este documento fue registrado, pero su tipo clínico no es completamente claro. Puedo intentar explicarlo con el texto OCR disponible."

    if text:
        key_points.append("OCR: " + _clip_text(text, 220))
    return entities, {
        "document_type_inferred": doc_type,
        "summary_plain": _clip_text(summary_plain, 500),
        "patient_friendly_explanation": _clip_text(patient_friendly, 700),
        "key_points_json": key_points[:8],
        "abnormal_values_json": abnormal_values[:8],
        "requires_review": bool(abnormal_values) or not text,
    }


def _upsert_document_intelligence(db: Session, doc: models.Document):
    db.query(models.DocumentClinicalEntity).filter(models.DocumentClinicalEntity.document_id == doc.id).delete()
    entities, summary_payload = _build_document_intelligence(doc)
    for entity in entities:
        db.add(models.DocumentClinicalEntity(document_id=doc.id, **entity))
    summary = (
        db.query(models.DocumentSummary)
        .filter(models.DocumentSummary.document_id == doc.id)
        .first()
    )
    if not summary:
        summary = models.DocumentSummary(document_id=doc.id)
    summary.document_type_inferred = summary_payload["document_type_inferred"]
    summary.summary_plain = summary_payload["summary_plain"]
    summary.patient_friendly_explanation = summary_payload["patient_friendly_explanation"]
    summary.key_points_json = summary_payload["key_points_json"]
    summary.abnormal_values_json = summary_payload["abnormal_values_json"]
    summary.requires_review = bool(summary_payload["requires_review"])
    summary.updated_at = datetime.now()
    db.add(summary)
    return summary


def _collect_missing_document_flags(
    documents: list[models.Document],
    appointments: list[models.Appointment],
    medications: list[models.Medication],
) -> dict:
    counts_by_type = {"receta": 0, "orden": 0, "resultado": 0, "informe": 0, "otro": 0}
    for doc in documents:
        counts_by_type[_infer_document_type(doc)] = counts_by_type.get(_infer_document_type(doc), 0) + 1
    has_orders = counts_by_type.get("orden", 0) > 0
    has_results = counts_by_type.get("resultado", 0) > 0
    active_meds = [med for med in medications if not bool(med.completed)]
    return {
        "missing_lab_results": bool(has_orders and not has_results),
        "missing_recent_documents": len(documents) == 0,
        "missing_treatment_support_docs": bool(active_meds and counts_by_type.get("receta", 0) == 0),
    }


def _upsert_profile_health_features(
    db: Session,
    profile: models.HealthProfile,
    appointments: list[models.Appointment],
    medications: list[models.Medication],
    documents: list[models.Document],
    adherence_summary: dict,
) -> models.ProfileHealthFeature:
    feature = (
        db.query(models.ProfileHealthFeature)
        .filter(models.ProfileHealthFeature.profile_id == profile.id)
        .first()
    )
    if not feature:
        feature = models.ProfileHealthFeature(profile_id=profile.id)
    dated_appointments = [item for item in appointments if item.date_time]
    compare_tz = _safe_zoneinfo(DEFAULT_TZ_NAME)
    now_dt = datetime.now(compare_tz)
    future_appointments = [
        item
        for item in dated_appointments
        if (_normalize_dt_for_tz(item.date_time, compare_tz) or datetime.min.replace(tzinfo=compare_tz))
        >= now_dt
    ]
    next_appointment = min(
        future_appointments,
        key=lambda item: _normalize_dt_for_tz(item.date_time, compare_tz)
        or datetime.max.replace(tzinfo=compare_tz),
        default=None,
    )
    last_appointment = max(
        dated_appointments,
        key=lambda item: _normalize_dt_for_tz(item.date_time, compare_tz)
        or datetime.min.replace(tzinfo=compare_tz),
        default=None,
    )
    feature.next_appointment_at = next_appointment.date_time if next_appointment else None
    feature.last_appointment_at = last_appointment.date_time if last_appointment else None
    feature.active_medications_count = len([med for med in medications if not bool(med.completed)])
    feature.low_adherence_risk = bool(adherence_summary.get("low_adherence"))
    active_count = feature.active_medications_count or 0
    completed_count = len([med for med in medications if bool(med.completed)])
    total_treatments = active_count + completed_count
    feature.treatment_completion_score = int(round((completed_count / total_treatments) * 100)) if total_treatments else 0
    feature.missing_documents_flags_json = _collect_missing_document_flags(documents, appointments, medications)
    feature.extra_features_json = {
        "document_count": len(documents),
        "appointment_count": len(appointments),
        "overall_adherence_rate": adherence_summary.get("overall_adherence_rate"),
        "low_adherence_items": adherence_summary.get("low_adherence_items") or [],
    }
    feature.updated_at = datetime.now()
    db.add(feature)
    return feature


def _build_health_alert_candidates(
    profile: models.HealthProfile,
    appointments: list[models.Appointment],
    medications: list[models.Medication],
    documents: list[models.Document],
    adherence_summary: dict,
) -> list[dict]:
    compare_tz = _safe_zoneinfo(DEFAULT_TZ_NAME)
    now = datetime.now(compare_tz)
    alerts: list[dict] = []
    for med in medications:
        if bool(med.completed):
            continue
        expected_end = _normalize_dt_for_tz(_medication_end_at(med), compare_tz)
        if not expected_end:
            duration_days = _parse_duration_days(med.duration)
            if duration_days:
                start_at = _normalize_dt_for_tz(_medication_start_at(med, now), compare_tz)
                expected_end = start_at + timedelta(days=duration_days) if start_at else None
        if expected_end and 0 <= (expected_end - now).days <= 5:
            alerts.append(
                {
                    "alert_type": "medication_running_out",
                    "severity": "medium",
                    "title": f"{med.name or 'Medicamento'} próximo a terminar",
                    "description": f"El tratamiento podría terminar alrededor de {_safe_iso(expected_end)}.",
                    "recommended_action": "Revisar stock, continuidad del tratamiento o renovación de receta.",
                    "evidence_json": {"medication_id": med.id, "estimated_end_date": _safe_iso_client(expected_end)},
                }
            )
    if adherence_summary.get("low_adherence"):
        top = (adherence_summary.get("low_adherence_items") or [{}])[0]
        alerts.append(
            {
                "alert_type": "low_adherence",
                "severity": "high",
                "title": "Adherencia baja al tratamiento",
                "description": (
                    f"Se detectó baja adherencia en {top.get('name') or 'un medicamento'} "
                    f"({top.get('adherence_rate') or 0}% en {adherence_summary.get('window_days', 30)} días)."
                ),
                "recommended_action": "Revisar recordatorios, horarios y posibles barreras para la toma.",
                "evidence_json": adherence_summary,
            }
        )
    overdue = [
        appt
        for appt in appointments
        if _normalize_dt_for_tz(appt.date_time, compare_tz)
        and _normalize_dt_for_tz(appt.date_time, compare_tz) < now - timedelta(hours=12)
        and _appointment_status_key(appt.status) != "realizada"
    ]
    if overdue:
        top = sorted(overdue, key=lambda item: item.date_time)[0]
        alerts.append(
            {
                "alert_type": "missed_appointment_followup",
                "severity": "high",
                "title": "Cita posiblemente olvidada o sin cierre",
                "description": f"Existe una cita registrada para {_safe_iso(top.date_time)} aún no marcada como realizada.",
                "recommended_action": "Confirmar si se realizó la cita y actualizar su estado.",
                "evidence_json": {"appointment_id": top.id},
            }
        )
    missing_flags = _collect_missing_document_flags(documents, appointments, medications)
    if missing_flags.get("missing_lab_results"):
        alerts.append(
            {
                "alert_type": "missing_lab_result",
                "severity": "medium",
                "title": "Faltan resultados asociados a órdenes médicas",
                "description": "Hay órdenes médicas registradas, pero no aparecen resultados clínicos vinculados recientemente.",
                "recommended_action": "Subir o registrar los resultados del examen pendiente.",
                "evidence_json": missing_flags,
            }
        )
    stale_active = [
        med
        for med in medications
        if not bool(med.completed)
        and _normalize_dt_for_tz(_medication_end_at(med), compare_tz)
        and _normalize_dt_for_tz(_medication_end_at(med), compare_tz) < now
    ]
    if stale_active:
        alerts.append(
            {
                "alert_type": "incomplete_treatment",
                "severity": "medium",
                "title": "Tratamiento posiblemente incompleto",
                "description": f"{stale_active[0].name or 'Un tratamiento'} ya superó su fecha estimada de término y sigue marcado como activo.",
                "recommended_action": "Revisar si el tratamiento terminó o si requiere continuidad.",
                "evidence_json": {"medication_id": stale_active[0].id},
            }
        )
    return alerts


def _sync_health_alerts(
    db: Session,
    profile: models.HealthProfile,
    appointments: list[models.Appointment],
    medications: list[models.Medication],
    documents: list[models.Document],
    adherence_summary: dict,
) -> list[models.HealthAlert]:
    candidates = _build_health_alert_candidates(profile, appointments, medications, documents, adherence_summary)
    existing = db.query(models.HealthAlert).filter(models.HealthAlert.profile_id == profile.id).all()
    existing_by_key = {(item.alert_type, item.title): item for item in existing}
    seen_keys = set()
    now = datetime.now()
    for payload in candidates:
        key = (payload["alert_type"], payload["title"])
        seen_keys.add(key)
        row = existing_by_key.get(key)
        if not row:
            row = models.HealthAlert(profile_id=profile.id, detected_at=now)
        row.alert_type = payload["alert_type"]
        row.severity = payload["severity"]
        row.title = payload["title"]
        row.description = payload["description"]
        row.evidence_json = payload.get("evidence_json") or {}
        row.recommended_action = payload.get("recommended_action") or ""
        row.status = "active"
        row.updated_at = now
        db.add(row)
    for item in existing:
        key = (item.alert_type, item.title)
        if key not in seen_keys and item.status == "active":
            item.status = "resolved"
            item.updated_at = now
            db.add(item)
    db.flush()
    return (
        db.query(models.HealthAlert)
        .filter(
            models.HealthAlert.profile_id == profile.id,
            models.HealthAlert.status == "active",
        )
        .order_by(models.HealthAlert.detected_at.desc())
        .all()
    )


def _build_advanced_health_context(
    db: Session,
    profile: models.HealthProfile,
    appointments: list[models.Appointment],
    medications: list[models.Medication],
    documents: list[models.Document],
    refresh: bool = False,
) -> dict:
    if refresh:
        adherence_summary = _upsert_adherence_summaries(db, profile, medications, window_days=30)
        document_summaries = []
        for doc in documents[:10]:
            summary = _upsert_document_intelligence(db, doc)
            document_summaries.append(summary)
    else:
        adherence_summary = _load_adherence_summary_cached(db, profile, medications, window_days=30)
        document_ids = [doc.id for doc in documents[:10]]
        summary_rows = []
        if document_ids:
            summary_rows = (
                db.query(models.DocumentSummary)
                .filter(models.DocumentSummary.document_id.in_(document_ids))
                .all()
            )
        summaries_by_document = {row.document_id: row for row in summary_rows}
        document_summaries = [
            summaries_by_document[doc.id]
            for doc in documents[:10]
            if doc.id in summaries_by_document
        ]
    document_entities_by_document: dict[int, list[models.DocumentClinicalEntity]] = {}
    document_ids = [doc.id for doc in documents[:10]]
    if document_ids:
        entity_rows = (
            db.query(models.DocumentClinicalEntity)
            .filter(models.DocumentClinicalEntity.document_id.in_(document_ids))
            .order_by(models.DocumentClinicalEntity.document_id.asc(), models.DocumentClinicalEntity.created_at.asc())
            .all()
        )
        for entity in entity_rows:
            document_entities_by_document.setdefault(entity.document_id, []).append(entity)
    if refresh:
        health_alerts = _sync_health_alerts(db, profile, appointments, medications, documents, adherence_summary)
        profile_features = _upsert_profile_health_features(
            db,
            profile,
            appointments,
            medications,
            documents,
            adherence_summary,
        )
    else:
        health_alerts = (
            db.query(models.HealthAlert)
            .filter(
                models.HealthAlert.profile_id == profile.id,
                models.HealthAlert.status == "active",
            )
            .order_by(models.HealthAlert.detected_at.desc())
            .all()
        )
        profile_features = (
            db.query(models.ProfileHealthFeature)
            .filter(models.ProfileHealthFeature.profile_id == profile.id)
            .first()
        )
    return {
        "adherence_summary": adherence_summary,
        "document_summaries": document_summaries,
        "document_entities_by_document": document_entities_by_document,
        "health_alerts": health_alerts,
        "profile_health_features": profile_features,
    }


def _build_clinical_report_payload(
    context: dict,
    report_type: str = "consulta_medica",
    period_days: int = 30,
) -> dict:
    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=max(1, period_days))
    adherence_summary = context.get("adherence_summary") or {}
    documents = context.get("documents") or []
    appointments = context.get("appointments") or []
    medications = context.get("medications") or []
    document_summaries = context.get("document_summaries") or []
    health_alerts = context.get("health_alerts") or []
    recent_appointments = [
        _appointment_to_ai_dict(item, context.get("timezone_name") or DEFAULT_TZ_NAME)
        for item in appointments[:8]
    ]
    current_medications = [
        _medication_to_ai_dict(item, context.get("timezone_name") or DEFAULT_TZ_NAME)
        for item in medications
        if not bool(item.completed)
    ][:10]
    return {
        "report_type": report_type,
        "generated_at": _safe_iso_client(end_dt),
        "period_start": _safe_iso_client(start_dt),
        "period_end": _safe_iso_client(end_dt),
        "profile": context.get("profile") or {},
        "current_medications": current_medications,
        "adherence": adherence_summary,
        "appointments": {
            "recent": recent_appointments,
            "next_upcoming": context.get("appointment_insights", {}).get("next_upcoming"),
        },
        "documents": {
            "count": len(documents),
            "summaries": [
                {
                    "document_id": item.document_id,
                    "document_type_inferred": item.document_type_inferred,
                    "summary_plain": item.summary_plain,
                    "patient_friendly_explanation": item.patient_friendly_explanation,
                    "abnormal_values_json": item.abnormal_values_json,
                }
                for item in document_summaries[:8]
            ],
        },
        "clinical_events": [
            {"kind": "appointment", "detail": item}
            for item in recent_appointments[:4]
            if item
        ],
        "alerts": [
            {
                "alert_type": item.alert_type,
                "severity": item.severity,
                "title": item.title,
                "description": item.description,
                "recommended_action": item.recommended_action,
            }
            for item in health_alerts[:8]
        ],
        "profile_health_features": (
            {
                "active_medications_count": getattr(context.get("profile_health_features"), "active_medications_count", 0),
                "low_adherence_risk": getattr(context.get("profile_health_features"), "low_adherence_risk", False),
                "treatment_completion_score": getattr(context.get("profile_health_features"), "treatment_completion_score", 0),
                "missing_documents_flags_json": getattr(context.get("profile_health_features"), "missing_documents_flags_json", {}) or {},
            }
        ),
    }


def _pdf_escape(value: str) -> str:
    raw = (value or "").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return raw.encode("latin-1", "replace").decode("latin-1")


def _generate_simple_pdf_bytes(report_payload: dict) -> bytes:
    lines = [
        "Klinip - Reporte clinico",
        f"Perfil: {(report_payload.get('profile') or {}).get('name') or 'Perfil activo'}",
        f"Periodo: {report_payload.get('period_start')} a {report_payload.get('period_end')}",
        f"Tipo: {report_payload.get('report_type')}",
        "",
        "Medicamentos actuales:",
    ]
    for med in (report_payload.get("current_medications") or [])[:8]:
        lines.append(
            f"- {med.get('name') or 'Medicamento'} {med.get('dose') or ''} {med.get('frequency') or ''}".strip()
        )
    adherence = report_payload.get("adherence") or {}
    lines.extend(
        [
            "",
            f"Adherencia 30d: {adherence.get('overall_adherence_rate') or 'sin datos'}%",
            "Citas recientes:",
        ]
    )
    for item in ((report_payload.get("appointments") or {}).get("recent") or [])[:5]:
        if not item:
            continue
        lines.append(f"- {item.get('date_time') or 'sin fecha'} {item.get('specialty') or ''} {item.get('status') or ''}".strip())
    lines.append("")
    lines.append("Alertas:")
    for alert in (report_payload.get("alerts") or [])[:6]:
        lines.append(f"- {alert.get('title')}: {alert.get('description')}")
    lines.append("")
    lines.append("Documentos:")
    for item in ((report_payload.get("documents") or {}).get("summaries") or [])[:6]:
        lines.append(f"- {item.get('document_type_inferred')}: {item.get('summary_plain')}")

    y = 790
    content_parts = ["BT", "/F1 10 Tf", "50 790 Td"]
    first = True
    for line in lines[:55]:
        escaped = _pdf_escape(_clip_text(line, 110))
        if first:
            content_parts.append(f"({escaped}) Tj")
            first = False
        else:
            y -= 14
            content_parts.append(f"0 -14 Td ({escaped}) Tj")
    content_parts.append("ET")
    content_stream = "\n".join(content_parts).encode("latin-1", "replace")

    objects = []
    objects.append(b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")
    objects.append(b"2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n")
    objects.append(b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n")
    objects.append(b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n")
    objects.append(f"5 0 obj << /Length {len(content_stream)} >> stream\n".encode("latin-1") + content_stream + b"\nendstream endobj\n")

    pdf = b"%PDF-1.4\n"
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf += obj
    xref_offset = len(pdf)
    pdf += f"xref\n0 {len(offsets)}\n".encode("latin-1")
    pdf += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        pdf += f"{offset:010d} 00000 n \n".encode("latin-1")
    pdf += (
        f"trailer << /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF".encode("latin-1")
    )
    return pdf


def _persist_clinical_report(
    db: Session,
    profile: models.HealthProfile,
    report_type: str,
    period_days: int,
    report_payload: dict,
) -> models.ClinicalReport:
    period_end = datetime.now()
    period_start = period_end - timedelta(days=max(1, period_days))
    pdf_bytes = _generate_simple_pdf_bytes(report_payload)
    item = models.ClinicalReport(
        profile_id=profile.id,
        report_type=report_type,
        period_start=period_start,
        period_end=period_end,
        report_json=report_payload,
        pdf_data=pdf_bytes,
        pdf_filename=f"klinip_reporte_{profile.id}_{period_end.strftime('%Y%m%d_%H%M')}.pdf",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _ai_context_bundle_for_profile(
    db: Session,
    current_user: models.User,
    profile: models.HealthProfile,
    link: models.ProfileRelationship,
    target_user_id: int,
    include_family_context: bool = True,
    refresh_advanced: bool = False,
) -> dict:
    plan_info = _build_plan_info(current_user, db)
    timezone_name = _resolve_user_tz_name(current_user)
    family_access = (
        _build_family_access_context(
            db,
            current_user,
            preferred_owner_user_id=int(profile.owner_user_id or 0) if getattr(profile, "owner_user_id", None) else None,
        )
        if include_family_context
        else {"available": False, "owner_user_id": None, "owner_name": "", "profiles": []}
    )

    appointments = (
        db.query(models.Appointment)
        .filter(models.Appointment.user_id == target_user_id)
        .order_by(
            models.Appointment.created_at.desc(),
            models.Appointment.date_time.desc(),
        )
        .all()
    )
    documents = (
        db.query(models.Document)
        .filter(*_document_scope_filter(profile, target_user_id))
        .order_by(models.Document.created_at.desc())
        .all()
    )
    medications = (
        db.query(models.Medication)
        .filter(models.Medication.user_id == target_user_id)
        .order_by(models.Medication.created_at.desc())
        .all()
    )
    medications = _attach_medication_adherence(db, medications, current_user)
    voice_sessions = (
        db.query(models.VoiceSession)
        .filter(models.VoiceSession.profile_id == profile.id)
        .order_by(models.VoiceSession.created_at.desc(), models.VoiceSession.id.desc())
        .limit(6)
        .all()
    )
    external_records = (
        db.query(models.ExternalClinicalRecord)
        .filter(models.ExternalClinicalRecord.profile_id == profile.id)
        .order_by(models.ExternalClinicalRecord.event_at.desc(), models.ExternalClinicalRecord.created_at.desc())
        .all()
    )

    profile_notes = []
    activity_log = []
    if plan_info.get("collaboration_enabled") or family_access.get("available"):
        profile_notes = (
            db.query(models.ProfileNote)
            .filter(models.ProfileNote.profile_id == profile.id)
            .order_by(models.ProfileNote.created_at.desc())
            .limit(5)
            .all()
        )
        activity_log = (
            db.query(models.ProfileActivityLog)
            .filter(models.ProfileActivityLog.profile_id == profile.id)
            .order_by(models.ProfileActivityLog.created_at.desc())
            .limit(5)
            .all()
        )

    upcoming = sorted(
        [
            appt
            for appt in appointments
            if appt.date_time and appt.status != models.AppointmentStatus.realizada
        ],
        key=lambda appt: _ai_dt_in_tz(appt.date_time, timezone_name) or datetime.max.replace(
            tzinfo=_safe_zoneinfo(DEFAULT_TZ_NAME)
        ),
    )
    future_upcoming = [
        appt
        for appt in upcoming
        if (_ai_dt_in_tz(appt.date_time, timezone_name) or datetime.min.replace(tzinfo=_safe_zoneinfo(DEFAULT_TZ_NAME)))
        >= datetime.now(_safe_zoneinfo(timezone_name))
    ]
    if future_upcoming:
        upcoming = future_upcoming
    active_medications = [med for med in medications if not bool(med.completed)]
    latest_document = documents[0] if documents else None
    latest_document_text = _clip_text(getattr(latest_document, "ocr_text", "") or "", 2400)
    appointment_insights = _appointment_insights(appointments, timezone_name)
    document_insights = _document_insights(documents, timezone_name)
    medication_insights = _medication_insights(medications, timezone_name)
    voice_session_insights = _voice_session_insights(voice_sessions, timezone_name)
    recent_conversations = _ai_recent_conversation_context(
        db,
        profile_id=profile.id,
        limit=4,
    )
    conversation_summaries = _ai_conversation_summaries(
        db,
        profile_id=profile.id,
        limit=12,
    )
    cached_profile_summary = _load_cached_profile_ai_summary(db, profile) or {}
    ai_memory_text = _extract_ai_memory_block(profile.base_medical_data or "")
    user_profile_notes_text = _strip_ai_memory_block(profile.base_medical_data or "")
    runtime_memory = _build_ai_profile_memory(
        profile=profile,
        documents=documents,
        medications=medications,
        upcoming=upcoming,
    )
    advanced_context = _build_advanced_health_context(
        db,
        profile,
        appointments,
        medications,
        documents,
        refresh=refresh_advanced,
    )
    family_summary_user = None
    family_owner_user_id = family_access.get("owner_user_id")
    if family_owner_user_id:
        family_summary_user = db.query(models.User).filter(models.User.id == int(family_owner_user_id)).first()
    family_context = (
        _load_cached_family_ai_summary(db, current_user, 7, summary_user=family_summary_user)
        if include_family_context and bool(family_access.get("available"))
        else None
    )

    sources = [
        {"key": "documents", "label": "Documentos", "count": len(documents), "enabled": True},
        {"key": "medications", "label": "Medicamentos", "count": len(medications), "enabled": True},
        {"key": "appointments", "label": "Citas y actividades", "count": len(appointments), "enabled": True},
        {"key": "voice", "label": "Klinip Voice", "count": len(voice_sessions), "enabled": True},
        {
            "key": "timeline",
            "label": "Historial clinico",
            "count": len(appointments) + len(documents) + len(medications) + len(voice_sessions),
            "enabled": True,
        },
        {
            "key": "reminders",
            "label": "Recordatorios",
            "count": len(upcoming) + len(active_medications),
            "enabled": True,
        },
        {
            "key": "family",
            "label": "Perfil familiar",
            "count": len((family_context or {}).get("profiles") or []),
            "enabled": bool(family_access.get("available")) and bool(family_context),
        },
        {
            "key": "adherence",
            "label": "Adherencia",
            "count": len((advanced_context.get("adherence_summary") or {}).get("medication_items") or []),
            "enabled": True,
        },
        {
            "key": "radar",
            "label": "Radar de salud",
            "count": len(advanced_context.get("health_alerts") or []),
            "enabled": True,
        },
    ]

    return {
        "profile": {
            "id": profile.id,
            "name": profile.full_name,
            "owner_user_id": target_user_id,
            "relation_with_owner": profile.relation_with_owner or "",
            "gender": profile.gender or "",
            "base_medical_data": _clip_text(user_profile_notes_text, 700),
            "learned_profile_context": _clip_text(ai_memory_text or runtime_memory, 1800),
            "brief_profile_summary": _clip_text(cached_profile_summary.get("summary") or "", 320),
            "access_role": (link.role or "").lower(),
            "is_primary": bool(profile.is_primary_profile),
        },
        "plan": plan_info,
        "family_access": family_access,
        "sources": sources,
        "timezone_name": timezone_name,
        "appointments": appointments,
        "documents": documents,
        "medications": medications,
        "voice_sessions": voice_sessions,
        "external_records": external_records,
        "upcoming": upcoming,
        "appointment_insights": appointment_insights,
        "document_insights": document_insights,
        "medication_insights": medication_insights,
        "voice_session_insights": voice_session_insights,
        "recent_conversations": recent_conversations,
        "conversation_summaries": conversation_summaries,
        "active_medications": active_medications,
        "latest_document": latest_document,
        "latest_document_text": latest_document_text,
        "learned_profile_context": _clip_text(ai_memory_text or runtime_memory, 1800),
        "brief_profile_summary": _clip_text(cached_profile_summary.get("summary") or "", 320),
        "profile_notes": profile_notes,
        "activity_log": activity_log,
        "adherence_summary": advanced_context.get("adherence_summary") or {},
        "document_summaries": advanced_context.get("document_summaries") or [],
        "document_entities_by_document": advanced_context.get("document_entities_by_document") or {},
        "health_alerts": advanced_context.get("health_alerts") or [],
        "profile_health_features": advanced_context.get("profile_health_features"),
        "family_context": family_context,
    }


def _ai_context_bundle(
    db: Session,
    current_user: models.User,
    refresh_advanced: bool = False,
    include_family_context: bool = True,
) -> dict:
    profile, link, target_user_id = _get_active_profile_context(db, current_user)
    return _ai_context_bundle_for_profile(
        db,
        current_user,
        profile,
        link,
        target_user_id,
        include_family_context=include_family_context,
        refresh_advanced=refresh_advanced,
    )


def _profile_age_years(profile: models.HealthProfile | None) -> int | None:
    if not profile or not getattr(profile, "birth_date", None):
        return None
    try:
        return max(0, (datetime.now().date() - profile.birth_date.date()).days // 365)
    except Exception:
        return None


def _load_profile_brief_summary(
    db: Session,
    profile: models.HealthProfile,
    target_user_id: int,
) -> str:
    cached_row = (
        db.query(models.ProfileAiSummary)
        .filter(models.ProfileAiSummary.profile_id == profile.id)
        .first()
    )
    if cached_row and (cached_row.summary or "").strip():
        return _clip_text(cached_row.summary or "", 320)

    learned_summary = _clip_text(_extract_ai_memory_block(profile.base_medical_data or "").strip(), 320)
    if learned_summary:
        return learned_summary

    latest_document_summary = (
        db.query(models.DocumentSummary)
        .join(models.Document, models.Document.id == models.DocumentSummary.document_id)
        .filter(*_document_scope_filter(profile, target_user_id))
        .order_by(models.Document.created_at.desc(), models.Document.id.desc())
        .first()
    )
    if latest_document_summary:
        return _clip_text(
            latest_document_summary.patient_friendly_explanation
            or latest_document_summary.summary_plain
            or "",
            320,
        )
    return ""


def _load_cached_profile_ai_summary(db: Session, profile: models.HealthProfile) -> dict | None:
    row = (
        db.query(models.ProfileAiSummary)
        .filter(models.ProfileAiSummary.profile_id == profile.id)
        .first()
    )
    if not row:
        return None
    payload = dict(getattr(row, "summary_json", {}) or {})
    payload["summary"] = row.summary or ""
    payload["updated_at"] = getattr(row, "updated_at", None)
    return payload


def _unique_compact_items(values: list[str], limit: int = 4) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        clean = _clip_text((value or "").strip(), 120)
        key = _normalize_text(clean)
        if not clean or not key or key in seen:
            continue
        seen.add(key)
        result.append(clean)
        if len(result) >= limit:
            break
    return result


def _extract_profile_relevant_conditions(
    profile: models.HealthProfile,
    advanced_context: dict,
) -> list[str]:
    conditions: list[str] = []
    for entities in (advanced_context.get("document_entities_by_document") or {}).values():
        for entity in entities or []:
            if getattr(entity, "entity_type", "") == "diagnosis":
                conditions.append(getattr(entity, "entity_name", "") or getattr(entity, "entity_value", ""))
    if conditions:
        return _unique_compact_items(conditions, limit=4)

    memory_text = _extract_ai_memory_block(profile.base_medical_data or "") or _strip_ai_memory_block(profile.base_medical_data or "")
    candidates = [
        part.strip(" -.,;:")
        for part in re.split(r"[\n.;]", memory_text or "")
        if (part or "").strip()
    ]
    return _unique_compact_items(candidates, limit=3)


def _relevant_medications_snapshot(medications: list[models.Medication]) -> list[str]:
    items: list[str] = []
    for med in medications:
        if bool(getattr(med, "completed", False)):
            continue
        detail = getattr(med, "name", "") or "Medicamento"
        if getattr(med, "dose", ""):
            detail += f" ({med.dose})"
        if getattr(med, "frequency", ""):
            detail += f", {med.frequency}"
        items.append(detail)
    return _unique_compact_items(items, limit=4)


def _relevant_appointments_snapshot(appointments: list[models.Appointment]) -> list[str]:
    compare_tz = _safe_zoneinfo(DEFAULT_TZ_NAME)
    now_dt = datetime.now(compare_tz)
    upcoming = sorted(
        [
            appt
            for appt in appointments
            if _normalize_dt_for_tz(getattr(appt, "date_time", None), compare_tz)
            and _normalize_dt_for_tz(getattr(appt, "date_time", None), compare_tz) >= now_dt
            and _appointment_status_key(getattr(appt, "status", "")) != "realizada"
        ],
        key=lambda appt: _normalize_dt_for_tz(getattr(appt, "date_time", None), compare_tz)
        or datetime.max.replace(tzinfo=compare_tz),
    )
    items: list[str] = []
    for appt in upcoming[:3]:
        label = getattr(appt, "specialty", "") or str(getattr(appt, "type", "") or "Cita")
        if getattr(appt, "date_time", None):
            label += f" {_safe_iso(getattr(appt, 'date_time', None))}"
        if getattr(appt, "center", ""):
            label += f" en {appt.center}"
        items.append(label)
    return _unique_compact_items(items, limit=3)


def _build_profile_ai_summary_payload(
    profile: models.HealthProfile,
    appointments: list[models.Appointment],
    medications: list[models.Medication],
    documents: list[models.Document],
    advanced_context: dict,
) -> dict:
    active_medications = [med for med in medications if not bool(med.completed)]
    compare_tz = _safe_zoneinfo(DEFAULT_TZ_NAME)
    now_dt = datetime.now(compare_tz)
    upcoming_count = len(
        [
            appt
            for appt in appointments
            if _normalize_dt_for_tz(getattr(appt, "date_time", None), compare_tz)
            and _normalize_dt_for_tz(getattr(appt, "date_time", None), compare_tz) >= now_dt
            and _appointment_status_key(getattr(appt, "status", "")) != "realizada"
        ]
    )
    adherence_summary = advanced_context.get("adherence_summary") or {}
    health_alerts = advanced_context.get("health_alerts") or []
    profile_features = advanced_context.get("profile_health_features")
    key_alerts = [getattr(item, "title", "") for item in health_alerts[:3] if getattr(item, "title", "")]
    pending_documents = [
        key
        for key, value in (getattr(profile_features, "missing_documents_flags_json", {}) or {}).items()
        if value
    ]
    relevant_conditions = _extract_profile_relevant_conditions(profile, advanced_context)
    relevant_medications = _relevant_medications_snapshot(medications)
    relevant_appointments = _relevant_appointments_snapshot(appointments)
    payload = {
        "profile_id": profile.id,
        "profile_name": profile.full_name,
        "relation_with_owner": profile.relation_with_owner or "",
        "active_medications": len(active_medications),
        "upcoming_appointments": upcoming_count,
        "documents": len(documents),
        "health_alerts": len(health_alerts),
        "overall_adherence_rate": adherence_summary.get("overall_adherence_rate"),
        "low_adherence": bool(adherence_summary.get("low_adherence")),
        "treatment_completion_score": getattr(profile_features, "treatment_completion_score", 0),
        "missing_documents_flags": getattr(profile_features, "missing_documents_flags_json", {}) or {},
        "pending_documents": pending_documents[:4],
        "relevant_conditions": relevant_conditions,
        "relevant_medications": relevant_medications,
        "relevant_appointments": relevant_appointments,
        "key_alerts": key_alerts,
        "key_risks": key_alerts,
    }
    summary = (
        f"Resumen clínico de {profile.full_name}: "
        f"{payload['active_medications']} medicamento(s) activo(s), "
        f"{payload['upcoming_appointments']} cita(s) próxima(s), "
        f"{payload['documents']} documento(s) y "
        f"{payload['health_alerts']} alerta(s) activa(s)."
    )
    if payload.get("overall_adherence_rate") is not None:
        summary += f" Adherencia estimada: {payload['overall_adherence_rate']}%."
    if relevant_conditions:
        summary += " Condiciones relevantes: " + ", ".join(relevant_conditions[:3]) + "."
    if key_alerts:
        summary += " Alertas clave: " + ", ".join(key_alerts[:3]) + "."
    payload["summary"] = summary
    return payload


def _refresh_profile_ai_summary(
    db: Session,
    profile: models.HealthProfile,
    appointments: list[models.Appointment],
    medications: list[models.Medication],
    documents: list[models.Document],
    advanced_context: dict,
) -> models.ProfileAiSummary:
    payload = _build_profile_ai_summary_payload(
        profile,
        appointments,
        medications,
        documents,
        advanced_context,
    )
    row = (
        db.query(models.ProfileAiSummary)
        .filter(models.ProfileAiSummary.profile_id == profile.id)
        .first()
    )
    if not row:
        row = models.ProfileAiSummary(profile_id=profile.id)
    row.summary = payload.get("summary") or ""
    row.summary_json = payload
    row.updated_at = datetime.now()
    db.add(row)
    return row


def _load_cached_family_ai_summary(
    db: Session,
    current_user: models.User,
    days: int = 30,
    summary_user: models.User | None = None,
) -> dict | None:
    window_days = max(1, min(int(days or 30), 365))
    target_user = summary_user or current_user
    row = (
        db.query(models.FamilyAiSummary)
        .filter(
            models.FamilyAiSummary.user_id == target_user.id,
            models.FamilyAiSummary.window_days == window_days,
        )
        .first()
    )
    if not row:
        return None
    return {
        "generated_at": getattr(row, "updated_at", None),
        "family_size": int(getattr(row, "family_size", 0) or 0),
        "active_alerts_total": int(getattr(row, "active_alerts_total", 0) or 0),
        "pending_documents_total": int(getattr(row, "pending_documents_total", 0) or 0),
        "low_adherence_profiles": int(getattr(row, "low_adherence_profiles", 0) or 0),
        "summary": getattr(row, "summary", "") or "",
        "profiles": list(getattr(row, "profiles_json", []) or []),
        "summary_json": dict(getattr(row, "summary_json", {}) or {}),
    }


def _refresh_family_ai_summary(
    db: Session,
    current_user: models.User,
    days: int = 30,
) -> models.FamilyAiSummary:
    window_days = max(1, min(int(days or 30), 365))
    links = _accepted_profile_links_for_user(db, current_user)
    profile_ids = [int(link.profile_id) for link in links if getattr(link, "profile_id", None)]
    summary_rows = []
    if profile_ids:
        summary_rows = (
            db.query(models.ProfileAiSummary)
            .filter(models.ProfileAiSummary.profile_id.in_(profile_ids))
            .all()
        )
    summaries_by_profile = {row.profile_id: dict(getattr(row, "summary_json", {}) or {}) for row in summary_rows}

    profile_rows: list[dict] = []
    active_alerts_total = 0
    pending_documents_total = 0
    low_adherence_profiles = 0
    for link in links:
        profile = link.profile
        if not profile:
            continue
        summary_payload = summaries_by_profile.get(profile.id, {})
        pending_documents = list(summary_payload.get("pending_documents") or [])[:4]
        low_adherence = bool(summary_payload.get("low_adherence"))
        upcoming_appointments = int(summary_payload.get("upcoming_appointments") or 0)
        key_alerts = list(summary_payload.get("key_alerts") or summary_payload.get("key_risks") or [])[:3]
        active_alert_count = int(summary_payload.get("health_alerts") or 0)
        active_alerts_total += active_alert_count
        pending_documents_total += len(pending_documents)
        low_adherence_profiles += 1 if low_adherence else 0
        profile_rows.append(
            {
                "profile_id": profile.id,
                "profile_name": summary_payload.get("profile_name") or profile.full_name,
                "relation_with_owner": summary_payload.get("relation_with_owner") or profile.relation_with_owner or "",
                "active_alerts": active_alert_count,
                "upcoming_appointments": upcoming_appointments,
                "low_adherence": low_adherence,
                "relevant_conditions": list(summary_payload.get("relevant_conditions") or [])[:4],
                "relevant_medications": list(summary_payload.get("relevant_medications") or [])[:4],
                "relevant_appointments": list(summary_payload.get("relevant_appointments") or [])[:3],
                "pending_documents": pending_documents[:4],
                "key_alerts": key_alerts,
                "key_risks": key_alerts,
            }
        )
    profile_rows.sort(
        key=lambda item: (item["active_alerts"], len(item["pending_documents"]), item["upcoming_appointments"]),
        reverse=True,
    )
    summary_text = (
        f"Panel familiar IA: {len(profile_rows)} perfiles analizados, "
        f"{active_alerts_total} alertas activas, {low_adherence_profiles} perfiles con adherencia baja "
        f"y {pending_documents_total} brechas documentales detectadas."
    )
    summary_json = {
        "family_size": len(profile_rows),
        "active_alerts_total": active_alerts_total,
        "pending_documents_total": pending_documents_total,
        "low_adherence_profiles": low_adherence_profiles,
    }
    row = (
        db.query(models.FamilyAiSummary)
        .filter(
            models.FamilyAiSummary.user_id == current_user.id,
            models.FamilyAiSummary.window_days == window_days,
        )
        .first()
    )
    if not row:
        row = models.FamilyAiSummary(user_id=current_user.id, window_days=window_days)
    row.family_size = len(profile_rows)
    row.active_alerts_total = active_alerts_total
    row.pending_documents_total = pending_documents_total
    row.low_adherence_profiles = low_adherence_profiles
    row.summary = summary_text
    row.profiles_json = profile_rows
    row.summary_json = summary_json
    row.updated_at = datetime.now()
    db.add(row)
    return row


def _build_chat_context_base(
    db: Session,
    current_user: models.User,
    profile: models.HealthProfile,
    link: models.ProfileRelationship,
    target_user_id: int,
    message: str = "",
    conversation_id: str | None = None,
    intent: str = "general",
    modules: dict | None = None,
    include_family_context: bool = False,
    include_document_text: bool = False,
) -> tuple[dict, dict]:
    modules = modules or select_context_modules(intent)
    db_started_at = time.perf_counter()
    statement_timeout_ms = _ai_db_statement_timeout_ms()
    context_timeout_ms = _ai_context_timeout_ms()
    context_deadline_ts = time.perf_counter() + (context_timeout_ms / 1000.0)
    degraded_reasons: list[str] = []
    query_observability = {
        "db_query_ms": 0.0,
        "db_query_count": 0,
        "rollback_count": 0,
        "db_modules": {},
    }
    plan_info = _build_plan_info(current_user, db)
    timezone_name = _resolve_user_tz_name(current_user)
    permissions_validated = {
        "view_profile": _check_permission(db, current_user, int(profile.id), "view_profile"),
        "view_medications": _check_permission(db, current_user, int(profile.id), "view_medications"),
        "view_documents": _check_permission(db, current_user, int(profile.id), "view_documents"),
    }
    context_totals = {
        "appointments": 0,
        "documents": 0,
        "medications": 0,
        "active_medications": 0,
    }
    appointments: list[models.Appointment] = []
    documents: list[models.Document] = []
    medications: list[models.Medication] = []
    voice_sessions: list[models.VoiceSession] = []
    profile_notes: list[models.ProfileNote] = []
    feed_posts: list[models.FeedPost] = []
    family_access = (
        _build_family_access_context(
            db,
            current_user,
            preferred_owner_user_id=int(profile.owner_user_id or 0) if getattr(profile, "owner_user_id", None) else None,
        )
        if intent == "familiar" or bool(modules.get("family")) or include_family_context
        else {"available": False, "owner_user_id": None, "owner_name": "", "profiles": []}
    )
    if modules.get("appointments"):
        context_totals["appointments"] = _safe_ai_context_query(
            db,
            module_name="appointments-count",
            loader=lambda: int(
                db.query(func.count(models.Appointment.id))
                .filter(models.Appointment.user_id == target_user_id)
                .scalar()
                or 0
            ),
            default_value=0,
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
        appointment_recent = _safe_ai_context_query(
            db,
            module_name="appointments-recent",
            loader=lambda: (
                db.query(models.Appointment)
                .filter(models.Appointment.user_id == target_user_id)
                .order_by(models.Appointment.created_at.desc(), models.Appointment.id.desc())
                .limit(48)
                .all()
            ),
            default_value=[],
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
        appointment_upcoming = _safe_ai_context_query(
            db,
            module_name="appointments-upcoming",
            loader=lambda: (
                db.query(models.Appointment)
                .filter(
                    models.Appointment.user_id == target_user_id,
                    models.Appointment.date_time.isnot(None),
                    models.Appointment.status != models.AppointmentStatus.realizada,
                )
                .order_by(
                    models.Appointment.date_time.asc(),
                    models.Appointment.created_at.desc(),
                    models.Appointment.id.desc(),
                )
                .limit(16)
                .all()
            ),
            default_value=[],
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
        appointments_by_id: dict[int, models.Appointment] = {}
        for item in [*(appointment_recent or []), *(appointment_upcoming or [])]:
            item_id = int(getattr(item, "id", 0) or 0)
            if item_id <= 0 or item_id in appointments_by_id:
                continue
            appointments_by_id[item_id] = item
        appointments = sorted(
            appointments_by_id.values(),
            key=lambda item: (
                _ai_dt_in_tz(getattr(item, "created_at", None), timezone_name)
                or datetime.min.replace(tzinfo=_safe_zoneinfo(DEFAULT_TZ_NAME)),
                int(getattr(item, "id", 0) or 0),
            ),
            reverse=True,
        )
    if modules.get("documents") and permissions_validated.get("view_documents"):
        context_totals["documents"] = _safe_ai_context_query(
            db,
            module_name="documents-count",
            loader=lambda: int(
                db.query(func.count(models.Document.id))
                .filter(*_document_scope_filter(profile, target_user_id))
                .scalar()
                or 0
            ),
            default_value=0,
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
        documents = _safe_ai_context_query(
            db,
            module_name="documents",
            loader=lambda: (
                db.query(models.Document)
                .filter(*_document_scope_filter(profile, target_user_id))
                .order_by(models.Document.created_at.desc(), models.Document.id.desc())
                .limit(18)
                .all()
            ),
            default_value=[],
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
    if modules.get("medications") and permissions_validated.get("view_medications"):
        context_totals["medications"] = _safe_ai_context_query(
            db,
            module_name="medications-count",
            loader=lambda: int(
                db.query(func.count(models.Medication.id))
                .filter(models.Medication.user_id == target_user_id)
                .scalar()
                or 0
            ),
            default_value=0,
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
        context_totals["active_medications"] = _safe_ai_context_query(
            db,
            module_name="medications-active-count",
            loader=lambda: int(
                db.query(func.count(models.Medication.id))
                .filter(
                    models.Medication.user_id == target_user_id,
                    or_(models.Medication.completed.is_(False), models.Medication.completed.is_(None)),
                )
                .scalar()
                or 0
            ),
            default_value=0,
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
        medications = _safe_ai_context_query(
            db,
            module_name="medications",
            loader=lambda: (
                db.query(models.Medication)
                .filter(models.Medication.user_id == target_user_id)
                .order_by(
                    models.Medication.completed.asc(),
                    models.Medication.created_at.desc(),
                    models.Medication.id.desc(),
                )
                .limit(24)
                .all()
            ),
            default_value=[],
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
    if modules.get("voice_sessions") and permissions_validated.get("view_profile"):
        voice_sessions = _safe_ai_context_query(
            db,
            module_name="voice-sessions",
            loader=lambda: (
                db.query(models.VoiceSession)
                .filter(models.VoiceSession.profile_id == profile.id)
                .order_by(models.VoiceSession.created_at.desc(), models.VoiceSession.id.desc())
                .limit(5)
                .all()
            ),
            default_value=[],
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
    if modules.get("profile_notes") and permissions_validated.get("view_profile"):
        profile_notes = _safe_ai_context_query(
            db,
            module_name="profile-notes",
            loader=lambda: (
                db.query(models.ProfileNote)
                .filter(models.ProfileNote.profile_id == profile.id)
                .order_by(models.ProfileNote.updated_at.desc(), models.ProfileNote.created_at.desc())
                .limit(6)
                .all()
            ),
            default_value=[],
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
    if modules.get("feed"):
        _family_user_ids_for_feed = _get_family_user_ids(db, current_user)
        feed_posts = _safe_ai_context_query(
            db,
            module_name="feed-posts",
            loader=lambda: (
                db.query(models.FeedPost)
                .filter(models.FeedPost.user_id.in_(_family_user_ids_for_feed))
                .order_by(models.FeedPost.created_at.desc())
                .limit(10)
                .all()
            ),
            default_value=[],
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
    brief_profile_summary = _safe_ai_context_query(
        db,
        module_name="profile-summary",
        loader=lambda: _load_profile_brief_summary(db, profile, target_user_id),
        default_value="",
        degraded_reasons=degraded_reasons,
        statement_timeout_ms=statement_timeout_ms,
        context_deadline_ts=context_deadline_ts,
        observability=query_observability,
    )
    db_load_ms = round((time.perf_counter() - db_started_at) * 1000, 1)

    context_started_at = time.perf_counter()
    upcoming = sorted(
        [
            appt
            for appt in appointments
            if appt.date_time and appt.status != models.AppointmentStatus.realizada
        ],
        key=lambda appt: _ai_dt_in_tz(appt.date_time, timezone_name) or datetime.max.replace(
            tzinfo=_safe_zoneinfo(DEFAULT_TZ_NAME)
        ),
    )
    future_upcoming = [
        appt
        for appt in upcoming
        if (_ai_dt_in_tz(appt.date_time, timezone_name) or datetime.min.replace(tzinfo=_safe_zoneinfo(DEFAULT_TZ_NAME)))
        >= datetime.now(_safe_zoneinfo(timezone_name))
    ]
    if future_upcoming:
        upcoming = future_upcoming

    active_medications = [med for med in medications if not bool(med.completed)]
    context_totals["appointments"] = max(int(context_totals.get("appointments") or 0), len(appointments))
    context_totals["documents"] = max(int(context_totals.get("documents") or 0), len(documents))
    context_totals["medications"] = max(int(context_totals.get("medications") or 0), len(medications))
    context_totals["active_medications"] = max(int(context_totals.get("active_medications") or 0), len(active_medications))
    latest_document = documents[0] if documents else None
    latest_document_text = (
        _clip_text(getattr(latest_document, "ocr_text", "") or "", 1800)
        if include_document_text
        else ""
    )
    appointment_insights = _appointment_insights(appointments, timezone_name) if modules.get("appointments") else {}
    document_insights = _document_insights(documents, timezone_name) if modules.get("documents") else {}
    medication_insights = _medication_insights(medications, timezone_name) if modules.get("medications") else {}
    voice_session_insights = _voice_session_insights(voice_sessions, timezone_name) if modules.get("voice_sessions") else {}
    adherence_summary = (
        _safe_ai_context_query(
            db,
            module_name="adherence",
            loader=lambda: _load_adherence_summary_cached(db, profile, medications, window_days=30),
            default_value={},
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
        if modules.get("adherence")
        else {}
    )
    document_ids: list[int] = []
    document_summaries = []
    document_entities_by_document: dict[int, list[models.DocumentClinicalEntity]] = {}
    relevant_documents: list[models.Document] = []
    if modules.get("document_summaries") and documents:
        document_ids = [doc.id for doc in documents if getattr(doc, "id", None) is not None]
        if document_ids:
            summary_rows = _safe_ai_context_query(
                db,
                module_name="document-summaries",
                loader=lambda: (
                    db.query(models.DocumentSummary)
                    .filter(models.DocumentSummary.document_id.in_(document_ids))
                    .all()
                ),
                default_value=[],
                degraded_reasons=degraded_reasons,
                statement_timeout_ms=statement_timeout_ms,
                context_deadline_ts=context_deadline_ts,
                observability=query_observability,
            )
            summaries_by_document = {row.document_id: row for row in summary_rows}
            document_summaries = [
                summaries_by_document[doc.id]
                for doc in documents
                if doc.id in summaries_by_document
            ]
            entity_rows = _safe_ai_context_query(
                db,
                module_name="document-entities",
                loader=lambda: (
                    db.query(models.DocumentClinicalEntity)
                    .filter(models.DocumentClinicalEntity.document_id.in_(document_ids))
                    .order_by(
                        models.DocumentClinicalEntity.document_id.asc(),
                        models.DocumentClinicalEntity.created_at.asc(),
                    )
                    .all()
                ),
                default_value=[],
                degraded_reasons=degraded_reasons,
                statement_timeout_ms=statement_timeout_ms,
                context_deadline_ts=context_deadline_ts,
                observability=query_observability,
            )
            for entity in entity_rows:
                document_entities_by_document.setdefault(entity.document_id, []).append(entity)
    if documents and permissions_validated.get("view_documents"):
        try:
            existing_chunk_doc_ids = {
                int(item[0])
                for item in (
                    db.query(models.AiDocumentChunk.document_id)
                    .filter(
                        models.AiDocumentChunk.document_id.in_(
                            [int(doc.id) for doc in documents[:4] if getattr(doc, "id", None) is not None]
                        )
                    )
                    .distinct()
                    .all()
                )
                if item and item[0] is not None
            }
            for doc in documents[:4]:
                if not getattr(doc, "id", None) or int(doc.id) in existing_chunk_doc_ids:
                    continue
                if not (getattr(doc, "ocr_text", "") or "").strip():
                    continue
                _upsert_document_memory_chunks(db, doc, profile_id=int(profile.id))
        except Exception as exc:
            print(f"WARNING _build_chat_context_base backfill chunks: {exc}")
    normalized_message = _normalize_text(message or "")
    document_memory_requested = bool(
        permissions_validated.get("view_documents")
        and (
            bool(modules.get("documents"))
            or intent == "documentos"
            or any(
                token in normalized_message
                for token in (
                    "documento",
                    "resultado",
                    "informe",
                    "examen",
                    "pdf",
                    "receta",
                    "orden",
                    "archivo",
                )
            )
        )
    )
    relevant_document_chunks = (
        _safe_ai_context_query(
            db,
            module_name="document-chunks",
            loader=lambda: _load_relevant_document_chunks(
                db,
                current_user,
                profile,
                link,
                message,
                limit=4 if intent != "documentos" else 5,
            ),
            default_value=[],
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
        if document_memory_requested
        else []
    )
    relevant_document_ids = _ordered_unique_document_ids_from_chunks(relevant_document_chunks)
    if relevant_document_ids and permissions_validated.get("view_documents"):
        loaded_document_ids = {
            int(getattr(doc, "id", 0) or 0)
            for doc in documents
            if getattr(doc, "id", None) is not None
        }
        missing_document_ids = [doc_id for doc_id in relevant_document_ids if doc_id not in loaded_document_ids]
        extra_relevant_documents = (
            _safe_ai_context_query(
                db,
                module_name="relevant-documents",
                loader=lambda: (
                    db.query(models.Document)
                    .filter(
                        models.Document.id.in_(missing_document_ids),
                        *_document_scope_filter(profile, target_user_id),
                    )
                    .all()
                ),
                default_value=[],
                degraded_reasons=degraded_reasons,
                statement_timeout_ms=statement_timeout_ms,
                context_deadline_ts=context_deadline_ts,
                observability=query_observability,
            )
            if missing_document_ids
            else []
        )
        documents_by_id = {
            int(getattr(doc, "id", 0) or 0): doc
            for doc in [*documents, *extra_relevant_documents]
            if getattr(doc, "id", None) is not None
        }
        relevant_documents = [
            documents_by_id[doc_id]
            for doc_id in relevant_document_ids
            if doc_id in documents_by_id
        ][:5]

        if modules.get("document_summaries") and relevant_documents:
            relevant_ids = [
                int(getattr(doc, "id", 0) or 0)
                for doc in relevant_documents
                if getattr(doc, "id", None) is not None
            ]
            existing_summary_ids = {
                int(getattr(item, "document_id", 0) or 0)
                for item in document_summaries
                if getattr(item, "document_id", None) is not None
            }
            missing_summary_ids = [doc_id for doc_id in relevant_ids if doc_id not in existing_summary_ids]
            if missing_summary_ids:
                extra_summary_rows = _safe_ai_context_query(
                    db,
                    module_name="relevant-document-summaries",
                    loader=lambda: (
                        db.query(models.DocumentSummary)
                        .filter(models.DocumentSummary.document_id.in_(missing_summary_ids))
                        .all()
                    ),
                    default_value=[],
                    degraded_reasons=degraded_reasons,
                    statement_timeout_ms=statement_timeout_ms,
                    context_deadline_ts=context_deadline_ts,
                    observability=query_observability,
                )
                summary_map = {
                    int(getattr(item, "document_id", 0) or 0): item
                    for item in [*document_summaries, *extra_summary_rows]
                    if getattr(item, "document_id", None) is not None
                }
                document_summaries = [
                    summary_map[doc_id]
                    for doc_id in [*document_ids, *missing_summary_ids]
                    if doc_id in summary_map
                ]

            entity_loaded_ids = {int(key) for key in document_entities_by_document.keys()}
            missing_entity_ids = [doc_id for doc_id in relevant_ids if doc_id not in entity_loaded_ids]
            if missing_entity_ids:
                extra_entity_rows = _safe_ai_context_query(
                    db,
                    module_name="relevant-document-entities",
                    loader=lambda: (
                        db.query(models.DocumentClinicalEntity)
                        .filter(models.DocumentClinicalEntity.document_id.in_(missing_entity_ids))
                        .order_by(
                            models.DocumentClinicalEntity.document_id.asc(),
                            models.DocumentClinicalEntity.created_at.asc(),
                        )
                        .all()
                    ),
                    default_value=[],
                    degraded_reasons=degraded_reasons,
                    statement_timeout_ms=statement_timeout_ms,
                    context_deadline_ts=context_deadline_ts,
                    observability=query_observability,
                )
                for entity in extra_entity_rows:
                    document_entities_by_document.setdefault(entity.document_id, []).append(entity)
    conversation_summaries = _safe_ai_context_query(
        db,
        module_name="conversation-summaries",
        loader=lambda: _load_relevant_conversation_memory(
            db,
            profile_id=int(profile.id),
            message=message,
            conversation_id=conversation_id,
            limit=3,
        ),
        default_value=[],
        degraded_reasons=degraded_reasons,
        statement_timeout_ms=statement_timeout_ms,
        context_deadline_ts=context_deadline_ts,
        observability=query_observability,
    )
    ai_memory_text = _extract_ai_memory_block(profile.base_medical_data or "")
    user_profile_notes_text = _strip_ai_memory_block(profile.base_medical_data or "")
    runtime_memory = _build_ai_profile_memory(
        profile=profile,
        documents=documents,
        medications=medications,
        upcoming=upcoming,
    )
    family_summary_user = None
    family_owner_user_id = family_access.get("owner_user_id")
    if family_owner_user_id:
        family_summary_user = _safe_ai_context_query(
            db,
            module_name="family-summary-user",
            loader=lambda: db.query(models.User).filter(models.User.id == int(family_owner_user_id)).first(),
            default_value=None,
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
    family_context = (
        _safe_ai_context_query(
            db,
            module_name="family-summary",
            loader=lambda: _load_cached_family_ai_summary(
                db,
                current_user,
                7,
                summary_user=family_summary_user,
            ),
            default_value=None,
            degraded_reasons=degraded_reasons,
            statement_timeout_ms=statement_timeout_ms,
            context_deadline_ts=context_deadline_ts,
            observability=query_observability,
        )
        if include_family_context and bool(family_access.get("available"))
        else None
    )
    context_build_ms = round((time.perf_counter() - context_started_at) * 1000, 1)
    degraded_reasons = list(dict.fromkeys(degraded_reasons))

    sources = [
        {"key": "profile-summary", "label": "Resumen del perfil", "count": 1 if brief_profile_summary else 0, "enabled": True},
        {
            "key": "profile-notes",
            "label": "Notas rápidas",
            "count": len(profile_notes),
            "enabled": bool(modules.get("profile_notes")) and bool(permissions_validated.get("view_profile")),
        },
        {
            "key": "documents",
            "label": "Documentos",
            "count": int(context_totals.get("documents") or 0),
            "enabled": bool(modules.get("documents")) and bool(permissions_validated.get("view_documents")),
        },
        {"key": "document-memory", "label": "Memoria documental", "count": len(relevant_document_chunks), "enabled": bool(relevant_document_chunks)},
        {
            "key": "medications",
            "label": "Medicamentos",
            "count": int(context_totals.get("medications") or 0),
            "enabled": bool(modules.get("medications")) and bool(permissions_validated.get("view_medications")),
        },
        {
            "key": "voice",
            "label": "Klinip Voice",
            "count": len(voice_sessions),
            "enabled": bool(modules.get("voice_sessions")) and bool(permissions_validated.get("view_profile")),
        },
        {"key": "appointments", "label": "Citas y actividades", "count": int(context_totals.get("appointments") or 0), "enabled": bool(modules.get("appointments"))},
        {"key": "conversation-memory", "label": "Memoria conversacional", "count": len(conversation_summaries), "enabled": bool(conversation_summaries)},
        {
            "key": "family",
            "label": "Perfil familiar",
            "count": len((family_context or {}).get("profiles") or []),
            "enabled": bool(modules.get("family")) and bool(family_access.get("available")) and bool(family_context),
        },
        {"key": "feed", "label": "KlinipFeed", "count": len(feed_posts), "enabled": bool(modules.get("feed")) and bool(feed_posts)},
    ]

    context = {
        "profile": {
            "id": profile.id,
            "name": profile.full_name,
            "owner_user_id": target_user_id,
            "relation_with_owner": profile.relation_with_owner or "",
            "gender": profile.gender or "",
            "age_years": _profile_age_years(profile),
            "base_medical_data": _clip_text(user_profile_notes_text, 500),
            "learned_profile_context": _clip_text(ai_memory_text or runtime_memory, 1200),
            "brief_profile_summary": brief_profile_summary,
            "access_role": (link.role or "").lower(),
            "is_primary": bool(profile.is_primary_profile),
        },
        "plan": plan_info,
        "family_access": family_access,
        "permissions_validated": permissions_validated,
        "sources": sources,
        "timezone_name": timezone_name,
        "chat_intent": intent,
        "current_question": _clip_text(message or "", 420),
        "enabled_modules": modules,
        "include_document_text": bool(include_document_text),
        "context_totals": context_totals,
        "degraded_reasons": degraded_reasons,
        "appointments": appointments,
        "documents": documents,
        "medications": medications,
        "voice_sessions": voice_sessions,
        "external_records": [],
        "upcoming": upcoming,
        "appointment_insights": appointment_insights,
        "document_insights": document_insights,
        "medication_insights": medication_insights,
        "voice_session_insights": voice_session_insights,
        "recent_conversations": [],
        "conversation_summaries": conversation_summaries,
        "active_medications": active_medications,
        "latest_document": latest_document,
        "latest_document_text": latest_document_text,
        "learned_profile_context": _clip_text(ai_memory_text or runtime_memory, 1200),
        "brief_profile_summary": brief_profile_summary,
        "profile_notes": profile_notes,
        "activity_log": [],
        "adherence_summary": adherence_summary,
        "document_summaries": document_summaries,
        "document_entities_by_document": document_entities_by_document,
        "document_chunks": relevant_document_chunks,
        "relevant_documents": relevant_documents,
        "health_alerts": [],
        "profile_health_features": None,
        "family_context": family_context,
        "feed_posts": feed_posts,
    }
    timing_info = {
        "db_load_ms": db_load_ms,
        "context_build_ms": context_build_ms,
        "chat_context_ms": round(db_load_ms + context_build_ms, 1),
        "db_query_ms": round(float(query_observability.get("db_query_ms", 0.0) or 0.0), 1),
        "db_query_count": int(query_observability.get("db_query_count", 0) or 0),
        "rollback_count": int(query_observability.get("rollback_count", 0) or 0),
        "db_modules": dict(query_observability.get("db_modules") or {}),
        "db_statement_timeout_ms": statement_timeout_ms,
        "context_timeout_ms": context_timeout_ms,
        "degraded_reasons": degraded_reasons,
    }
    return context, timing_info


def _select_ai_prompt_profile(context: dict, timing_info: dict | None = None) -> dict:
    info = timing_info or {}
    db_query_ms = float(info.get("db_query_ms", 0.0) or 0.0)
    chat_context_ms = float(info.get("chat_context_ms", 0.0) or 0.0)
    rollback_count = int(info.get("rollback_count", 0) or 0)
    degraded = bool((context or {}).get("degraded_reasons"))
    intent = (context or {}).get("chat_intent") or "general"

    profile = {
        "name": "normal",
        "history_messages": 6,
        "summary_chars": 900,
        "conversation_summaries_limit": 3,
        "appointments_limit": 6,
        "documents_limit": 4,
        "document_summaries_limit": 4,
        "document_diagnoses_limit": 4,
        "document_chunks_limit": 4,
        "chunk_chars": 420,
        "medications_limit": 6,
        "family_profiles_limit": 4,
        "document_ocr_first_chars": 1200,
        "document_ocr_other_chars": 320,
        "notes_chars": 180,
        "memory_chars": 1500,
        "brief_summary_chars": 320,
        "family_summary_chars": 520,
    }

    if (
        rollback_count > 0
        or db_query_ms >= _ai_chat_prompt_pressure_threshold_ms("minimal_db_query")
        or chat_context_ms >= _ai_chat_prompt_pressure_threshold_ms("minimal_context")
    ):
        profile.update(
            {
                "name": "minimal",
                "history_messages": 2,
                "summary_chars": 260,
                "conversation_summaries_limit": 1,
                "appointments_limit": 2,
                "documents_limit": 1,
                "document_summaries_limit": 1,
                "document_diagnoses_limit": 1,
                "document_chunks_limit": 2,
                "chunk_chars": 220,
                "medications_limit": 3,
                "family_profiles_limit": 1,
                "document_ocr_first_chars": 0,
                "document_ocr_other_chars": 0,
                "notes_chars": 90,
                "memory_chars": 420,
                "brief_summary_chars": 180,
                "family_summary_chars": 220,
            }
        )
    elif (
        degraded
        or db_query_ms >= _ai_chat_prompt_pressure_threshold_ms("lean_db_query")
        or chat_context_ms >= _ai_chat_prompt_pressure_threshold_ms("lean_context")
    ):
        profile.update(
            {
                "name": "lean",
                "history_messages": 4,
                "summary_chars": 520,
                "conversation_summaries_limit": 2,
                "appointments_limit": 4,
                "documents_limit": 2,
                "document_summaries_limit": 2,
                "document_diagnoses_limit": 2,
                "document_chunks_limit": 3,
                "chunk_chars": 320,
                "medications_limit": 4,
                "family_profiles_limit": 2,
                "document_ocr_first_chars": 420,
                "document_ocr_other_chars": 0,
                "notes_chars": 120,
                "memory_chars": 900,
                "brief_summary_chars": 220,
                "family_summary_chars": 320,
            }
        )

    if intent == "documentos":
        profile["documents_limit"] = max(profile["documents_limit"], 2)
        profile["document_summaries_limit"] = max(profile["document_summaries_limit"], 2)
        profile["document_chunks_limit"] = max(profile["document_chunks_limit"], 4)
        if profile["name"] != "minimal":
            profile["document_ocr_first_chars"] = max(profile["document_ocr_first_chars"], 420)
    elif intent == "medicamentos":
        profile["medications_limit"] = max(profile["medications_limit"], 4)
    elif intent == "citas":
        profile["appointments_limit"] = max(profile["appointments_limit"], 3)
    elif intent == "familiar":
        profile["family_profiles_limit"] = max(profile["family_profiles_limit"], 2)
    elif intent == "general":
        profile["conversation_summaries_limit"] = max(profile["conversation_summaries_limit"], 2)

    return profile


def _serialize_ai_context(context: dict, prompt_profile: dict | None = None) -> dict:
    timezone_name = context.get("timezone_name") or DEFAULT_TZ_NAME
    family_context = context.get("family_context") or {}
    family_access = context.get("family_access") or {}
    enabled_modules = context.get("enabled_modules") or {}
    include_document_text = bool(context.get("include_document_text"))
    prompt_profile = prompt_profile or {}
    appointments_limit = max(1, int(prompt_profile.get("appointments_limit", 6) or 6))
    documents_limit = max(1, int(prompt_profile.get("documents_limit", 4) or 4))
    document_summaries_limit = max(1, int(prompt_profile.get("document_summaries_limit", 4) or 4))
    document_diagnoses_limit = max(1, int(prompt_profile.get("document_diagnoses_limit", 4) or 4))
    conversation_summaries_limit = max(1, int(prompt_profile.get("conversation_summaries_limit", 3) or 3))
    document_chunks_limit = max(1, int(prompt_profile.get("document_chunks_limit", 4) or 4))
    chunk_chars = max(180, int(prompt_profile.get("chunk_chars", 420) or 420))
    medications_limit = max(1, int(prompt_profile.get("medications_limit", 6) or 6))
    voice_sessions_limit = max(1, int(prompt_profile.get("voice_sessions_limit", 3) or 3))
    voice_indications_limit = max(1, int(prompt_profile.get("voice_indications_limit", 4) or 4))
    voice_technical_chars = max(180, int(prompt_profile.get("voice_technical_chars", 360) or 360))
    voice_simple_chars = max(140, int(prompt_profile.get("voice_simple_chars", 240) or 240))
    family_profiles_limit = max(1, int(prompt_profile.get("family_profiles_limit", 4) or 4))
    profile_notes_limit = max(1, int(prompt_profile.get("profile_notes_limit", 6) or 6))
    notes_chars = max(60, int(prompt_profile.get("notes_chars", 180) or 180))
    memory_chars = max(120, int(prompt_profile.get("memory_chars", 1500) or 1500))
    brief_summary_chars = max(100, int(prompt_profile.get("brief_summary_chars", 320) or 320))
    family_summary_chars = max(120, int(prompt_profile.get("family_summary_chars", 520) or 520))
    document_ocr_first_chars = max(0, int(prompt_profile.get("document_ocr_first_chars", 1200) or 0))
    document_ocr_other_chars = max(0, int(prompt_profile.get("document_ocr_other_chars", 320) or 0))
    payload = {
        "profile": context["profile"],
        "current_question": _clip_text(context.get("current_question") or "", 320),
        "learned_profile_context": _clip_text(context.get("learned_profile_context") or "", memory_chars),
        "brief_profile_summary": context.get("brief_profile_summary")
        or (context.get("profile") or {}).get("brief_profile_summary")
        or "",
        "timezone": timezone_name,
        "chat_intent": context.get("chat_intent") or "general",
        "context_totals": context.get("context_totals") or {},
        "enabled_modules": enabled_modules,
        "permissions_validated": {
            "view_profile": bool((context.get("permissions_validated") or {}).get("view_profile")),
            "view_medications": bool((context.get("permissions_validated") or {}).get("view_medications")),
            "view_documents": bool((context.get("permissions_validated") or {}).get("view_documents")),
        },
        "plan": {
            "plan_type": context["plan"].get("plan_type"),
            "max_profiles": context["plan"].get("max_profiles"),
            "collaboration_enabled": context["plan"].get("collaboration_enabled"),
            "family_panel_enabled": context["plan"].get("family_panel_enabled"),
        },
        "family_access": {
            "available": bool(family_access.get("available")),
            "owner_user_id": family_access.get("owner_user_id"),
            "owner_name": family_access.get("owner_name") or "",
            "profiles": [
                {
                    "profile_name": item.get("profile_name") or "",
                    "relation_with_owner": item.get("relation_with_owner") or "",
                    "role_label": item.get("role_label") or "",
                    "can_view": bool(item.get("can_view")),
                    "can_edit": bool(item.get("can_edit")),
                    "can_manage_collaborators": bool(item.get("can_manage_collaborators")),
                }
                for item in (family_access.get("profiles") or [])[:family_profiles_limit]
            ],
        },
    }
    if enabled_modules.get("appointments"):
        payload["appointment_insights"] = context.get("appointment_insights") or {}
        payload["appointments"] = [
            {
                "type": str(getattr(item.type, "value", item.type)),
                "specialty": item.specialty or "",
                "center": item.center or "",
                "date_time": _safe_iso_local(item.date_time, timezone_name),
                "created_at": _safe_iso_local(item.created_at, timezone_name),
                "status": str(getattr(item.status, "value", item.status)),
                "notes": _clip_text(item.notes or "", notes_chars),
            }
            for item in context["appointments"][:appointments_limit]
        ]
    if enabled_modules.get("documents"):
        payload["document_insights"] = context.get("document_insights") or {}
        payload["documents"] = [
            {
                "doc_type": str(getattr(item.doc_type, "value", item.doc_type)),
                "detected_doc_type": _infer_document_type(item),
                "date": _safe_iso_local(item.date, timezone_name),
                "created_at": _safe_iso_local(item.created_at, timezone_name),
                "center": item.center or "",
                "notes": _clip_text(item.notes or "", notes_chars),
                "ocr_status": item.ocr_status or "",
                "filename": item.filename or "",
                "file_format": _document_file_format(item),
                **(
                    {
                        "ocr_excerpt": _clip_text(
                            item.ocr_text or "",
                            document_ocr_first_chars if index == 0 else document_ocr_other_chars,
                        )
                    }
                    if include_document_text
                    and (item.ocr_text or "").strip()
                    and ((document_ocr_first_chars if index == 0 else document_ocr_other_chars) > 0)
                    else {}
                ),
            }
            for index, item in enumerate(context["documents"][:documents_limit])
        ]
        if context.get("relevant_documents"):
            summary_map = {
                int(getattr(item, "document_id", 0) or 0): item
                for item in (context.get("document_summaries") or [])
                if getattr(item, "document_id", None) is not None
            }
            chunk_relevance_map = {}
            for item in (context.get("document_chunks") or []):
                document_id = int(item.get("document_id") or 0)
                if document_id <= 0 or document_id in chunk_relevance_map:
                    continue
                chunk_relevance_map[document_id] = round(float(item.get("relevance") or 0.0), 4)
            payload["relevant_documents"] = [
                {
                    **(_document_to_ai_dict(item, timezone_name) or {}),
                    "relevance": chunk_relevance_map.get(int(getattr(item, "id", 0) or 0), 0.0),
                    **(
                        {
                            "summary_plain": _clip_text(
                                getattr(summary_map.get(int(getattr(item, "id", 0) or 0)), "summary_plain", "") or "",
                                max(180, brief_summary_chars),
                            ),
                            "patient_friendly_explanation": _clip_text(
                                getattr(
                                    summary_map.get(int(getattr(item, "id", 0) or 0)),
                                    "patient_friendly_explanation",
                                    "",
                                ) or "",
                                max(220, family_summary_chars),
                            ),
                        }
                        if summary_map.get(int(getattr(item, "id", 0) or 0))
                        else {}
                    ),
                }
                for item in (context.get("relevant_documents") or [])[: min(3, documents_limit)]
            ]
    if enabled_modules.get("document_summaries"):
        payload["document_summaries"] = [
            {
                "document_id": item.document_id,
                "document_type_inferred": item.document_type_inferred,
                "summary_plain": _clip_text(item.summary_plain, max(180, brief_summary_chars)),
                "patient_friendly_explanation": _clip_text(item.patient_friendly_explanation, max(220, family_summary_chars)),
                "abnormal_values_json": (item.abnormal_values_json or [])[: max(2, document_summaries_limit)],
                "key_points_json": (item.key_points_json or [])[: max(2, document_summaries_limit)],
            }
            for item in (context.get("document_summaries") or [])[:document_summaries_limit]
        ]
        payload["document_diagnoses"] = [
            {
                "document_id": document_id,
                "diagnoses": [
                    {
                        "name": entity.entity_name,
                        "detail": _clip_text(entity.entity_value or entity.source_text or "", 180),
                        "confidence": entity.confidence,
                    }
                    for entity in entities
                    if getattr(entity, "entity_type", "") == "diagnosis"
                ][: max(1, min(3, document_diagnoses_limit))],
            }
            for document_id, entities in list((context.get("document_entities_by_document") or {}).items())[:document_diagnoses_limit]
            if any(getattr(entity, "entity_type", "") == "diagnosis" for entity in entities)
        ]
    if context.get("document_chunks"):
        payload["document_chunks"] = [
            {
                "document_id": item.get("document_id"),
                "document_type": item.get("document_type") or "otro",
                "filename": item.get("filename") or "",
                "relevance": item.get("relevance", 0.0),
                "chunk_text": _clip_text(item.get("chunk_text") or "", chunk_chars),
            }
            for item in (context.get("document_chunks") or [])[:document_chunks_limit]
        ]
    if enabled_modules.get("medications"):
        payload["medication_insights"] = context.get("medication_insights") or {}
        payload["medications"] = [
            {
                "name": item.name,
                "dose": item.dose or "",
                "frequency": item.frequency or "",
                "duration": item.duration or "",
                "schedule_time": item.schedule_time or "",
                "completed": bool(item.completed),
                "end_date": _safe_iso_local(item.end_date, timezone_name),
                "created_at": _safe_iso_local(item.created_at, timezone_name),
                "notes": _clip_text(item.notes or "", notes_chars),
                "adherence_rate": getattr(item, "adherence_rate", None),
                "expected_doses": getattr(item, "expected_doses", 0),
                "taken_doses": getattr(item, "taken_doses", 0),
            }
            for item in context["medications"][:medications_limit]
        ]
    if enabled_modules.get("voice_sessions"):
        payload["voice_session_insights"] = context.get("voice_session_insights") or {}
        voice_rows = []
        for item in (context.get("voice_sessions") or [])[:voice_sessions_limit]:
            row = _voice_session_to_ai_dict(
                item,
                timezone_name,
                technical_chars=voice_technical_chars,
                simple_chars=voice_simple_chars,
                indications_limit=voice_indications_limit,
            )
            if row:
                voice_rows.append(row)
        payload["voice_sessions"] = voice_rows
    if enabled_modules.get("adherence"):
        payload["adherence_summary"] = context.get("adherence_summary") or {}
    if enabled_modules.get("profile_notes") and context.get("profile_notes"):
        payload["profile_notes"] = [
            {
                "note": _clip_text(item.note or "", max(140, notes_chars + 80)),
                "visibility": item.visibility or "shared",
                "created_at": _safe_iso_local(item.created_at, timezone_name),
                "updated_at": _safe_iso_local(item.updated_at, timezone_name),
                "created_by_name": getattr(getattr(item, "created_by_user", None), "name", "") or "",
            }
            for item in (context.get("profile_notes") or [])[:profile_notes_limit]
        ]
    if enabled_modules.get("family") and family_context:
        payload["family_context"] = {
            "summary": _clip_text(family_context.get("summary") or "", family_summary_chars),
            "family_size": family_context.get("family_size", 0),
            "active_alerts_total": family_context.get("active_alerts_total", 0),
            "low_adherence_profiles": family_context.get("low_adherence_profiles", 0),
            "pending_documents_total": family_context.get("pending_documents_total", 0),
            "profiles": [
                {
                    "profile_id": item.get("profile_id"),
                    "profile_name": item.get("profile_name"),
                    "relation_with_owner": item.get("relation_with_owner"),
                    "active_alerts": item.get("active_alerts", 0),
                    "upcoming_appointments": item.get("upcoming_appointments", 0),
                    "low_adherence": bool(item.get("low_adherence")),
                    "relevant_conditions": item.get("relevant_conditions") or [],
                    "relevant_medications": item.get("relevant_medications") or [],
                    "relevant_appointments": item.get("relevant_appointments") or [],
                    "pending_documents": item.get("pending_documents") or [],
                    "key_alerts": item.get("key_alerts") or [],
                    "key_risks": item.get("key_risks") or [],
                }
                for item in (family_context.get("profiles") or [])[:family_profiles_limit]
            ],
        }
    if context.get("conversation_summaries"):
        payload["conversation_summaries"] = [
            {
                "conversation_id": item.get("conversation_id") or "",
                "event_type": item.get("event_type") or "general",
                "summary": _clip_text(item.get("summary") or "", max(180, brief_summary_chars)),
                "keywords": list(item.get("keywords") or [])[:4],
                "updated_at": item.get("updated_at") or "",
            }
            for item in (context.get("conversation_summaries") or [])[:conversation_summaries_limit]
        ]
    if enabled_modules.get("feed") and context.get("feed_posts"):
        payload["feed_posts"] = [
            {
                "author": (getattr(getattr(item, "user", None), "name", None) or ""),
                "post_type": str(item.post_type or "general"),
                "content": _clip_text(item.content or "", 300),
                "reactions_count": len(getattr(item, "reactions", None) or []),
                "comments_count": len(getattr(item, "comments", None) or []),
                "created_at": _safe_iso_local(item.created_at, timezone_name),
            }
            for item in (context.get("feed_posts") or [])[:10]
        ]
    payload["brief_profile_summary"] = _clip_text(payload.get("brief_profile_summary") or "", brief_summary_chars)
    # Texto OCR extraído del documento adjunto directamente en el chat
    chat_attachment_text = (context.get("chat_attachment_text") or "").strip()
    if chat_attachment_text:
        payload["chat_attachment"] = {
            "filename": context.get("chat_attachment_filename") or "",
            "doc_type_inferred": context.get("chat_attachment_doc_type") or "otro",
            "ocr_text": _clip_text(chat_attachment_text, _CHAT_ATTACHMENT_OCR_CLIP),
        }
    return payload


def _ai_system_prompt(context: dict, prompt_profile: dict | None = None) -> str:
    family_access = context.get("family_access") or {}
    prompt_profile = prompt_profile or {}
    memory_chars = max(120, int(prompt_profile.get("memory_chars", 1500) or 1500))
    brief_summary_chars = max(100, int(prompt_profile.get("brief_summary_chars", 320) or 320))
    family_access_profiles = ", ".join(
        f"{item.get('profile_name') or 'Perfil'} ({item.get('role_label') or item.get('role') or 'sin rol'})"
        for item in (family_access.get("profiles") or [])[:4]
    ) or "ninguno"
    return (
        "Eres Klinip IA, un asistente de salud orientativo integrado en Klinip.\n"
        "Reglas obligatorias:\n"
        "1. Usa solo el contexto clinico entregado.\n"
        "2. Si falta informacion, dilo claramente; no inventes.\n"
        "3. No diagnostiques ni reemplaces a un profesional.\n"
        "4. No indiques suspender o iniciar medicamentos por cuenta propia.\n"
        "5. Si el usuario describe urgencia, deriva a atencion profesional.\n"
        "6. Explica en espanol claro, con tono cercano, humano y respetuoso.\n"
        "7. Si resumes documentos OCR, aclara que la lectura puede contener errores.\n"
        "8. Responde con estructura practica: resumen breve + acciones concretas + cierre corto.\n"
        "9. Prioriza utilidad: entrega recomendaciones accionables sin alarmismo.\n"
        "10. Si aplica, pide una aclaracion puntual para mejorar la recomendacion.\n"
        "11. Si hay memoria clinica del perfil, usala para personalizar la respuesta.\n"
        "12. No uses formato Markdown ni asteriscos dobles; responde en texto plano.\n"
        "13. Si preguntan por 'ultima cita agendada', usa appointment_insights.last_scheduled_created (ultima agendada por creacion).\n"
        "14. Distingue correctamente estados de citas: pendiente, agendada, realizada.\n"
        "15. Para documentos, reconoce tipo clinico (receta, orden, resultado, informe, otro) y tipo de archivo (pdf o imagen).\n"
        "16. Si el usuario pide resumen de documentos o medicamentos, responde ordenado por secciones cortas y en texto claro.\n"
        "17. Para medicamentos, distingue estado activa vs realizada usando medication_insights.\n"
        "18. Si existe historial de conversaciones guardadas, usalo como contexto adicional del perfil sin contradecir el contexto clinico actual.\n"
        "19. Si el usuario retoma una conversacion anterior, manten continuidad y reconoce lo ya conversado.\n"
        "20. Usa adherence_summary y health_alerts para explicar como va el tratamiento y riesgos detectados.\n"
        "21. Si el usuario pide preparar una cita, usa proximas citas, documentos y medicamentos activos para sugerir que llevar.\n"
        "22. Si interpretas resultados, usa document_summaries y abnormal_values_json; explica en lenguaje simple y sin diagnosticar.\n"
        "23. Si el usuario pide un reporte clínico, resume los bloques disponibles y sugiere generar el reporte estructurado.\n"
        "24. Si el usuario pregunta por su familia, primero usa family_access para explicar exactamente a que perfiles tiene acceso y con que rol. Usa family_context solo si existe y necesitas priorizar alertas activas, adherencia baja, citas proximas o documentos pendientes. Si family_access.available es verdadero, no respondas que no tiene acceso familiar aunque su plan personal sea basico.\n"
        "25. Si un informe medico contiene diagnosticos o impresiones clinicas detectadas por OCR, puedes resumirlos como hallazgos documentales sin presentarlos como diagnostico definitivo.\n"
        "26. Si el contexto incluye 'chat_attachment' con ocr_text, analiza ese documento prioritariamente: identifica su tipo (receta, examen, informe, orden), extrae la informacion clave (medicamentos y dosis si es receta; valores y rangos si es examen; diagnostico y hallazgos si es informe), entrega primero un resumen en lenguaje simple y luego responde la pregunta del usuario. Advierte si la calidad del OCR puede afectar la lectura.\n"
        "27. Para documentos de tipo examen en chat_attachment: indica explicitamente si los valores parecen normales o alterados segun los rangos de referencia del documento, sin diagnosticar. Para recetas: lista medicamentos, dosis y frecuencia. Para informes: resume diagnostico principal y recomendaciones.\n"
        "28. Si el usuario pregunta sobre un documento que subio previamente (no en este chat), busca en 'relevant_documents', 'document_chunks', 'documents' y 'document_summaries' para responder con datos reales.\n"
        "29. Si existe 'relevant_documents', prioriza esos documentos porque ya fueron seleccionados por relevancia para la pregunta actual.\n"
        "30. Si existe 'document_chunks', prioriza esos fragmentos porque ya fueron recuperados por relevancia semántica y permisos validados.\n"
        "31. Si existe 'conversation_summaries', úsalo como memoria breve para continuidad, pero nunca por encima de datos estructurados actuales.\n"
        "32. Si existe 'profile_notes', úsalas como contexto declarado por el usuario para pendientes, recordatorios, objetivos o temas a resolver. No las presentes como hechos clínicos confirmados si la nota solo expresa una intención o tarea.\n"
        "33. No afirmes que guardaste, creaste, registraste o modificaste datos dentro de Klinip a menos que esa acción haya sido confirmada por el sistema. Si el usuario pide guardar algo y no hay confirmación del sistema, limita tu respuesta a redactar o preparar el contenido.\n"
        "34. Si existe 'feed_posts' en el contexto, usalo para responder preguntas sobre publicaciones recientes de la familia en KlinipFeed: quién publicó, qué compartió, cuándo, tipo de publicación (general, examen, consulta, medicamento) y nivel de interacción (reacciones y comentarios). No inventes publicaciones si no existen en el contexto.\n"
        f"Perfil activo: {context['profile']['name']} (rol {context['profile']['access_role']}).\n"
        f"Plan actual: {context['plan'].get('plan_type')}.\n"
        f"Acceso familiar efectivo: {'si' if family_access.get('available') else 'no'}.\n"
        f"Perfiles familiares accesibles: {_clip_text(family_access_profiles, 260)}\n"
        f"Resumen breve persistido del perfil: {_clip_text(context.get('brief_profile_summary') or '', brief_summary_chars)}\n"
        f"Memoria clinica del perfil: {_clip_text(context.get('learned_profile_context') or '', memory_chars)}\n"
        f"Disclaimer obligatorio: {AI_KLINIP_DISCLAIMER}"
    )


def _call_openai_ai(
    system_prompt: str,
    history: list[dict],
    message: str,
    conversation_summary: str = "",
) -> tuple[str, str] | None:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key or OpenAI is None:
        return None

    model = _ai_model_name()
    temperature = _ai_temperature()
    max_output_tokens = _ai_max_output_tokens()
    messages = [{"role": "system", "content": system_prompt}]
    if conversation_summary:
        messages.append(
            {
                "role": "system",
                "content": "Resumen breve de la conversacion previa: "
                + _clip_text(conversation_summary, 900),
            }
        )
    for item in history:
        role = "assistant" if (item.get("role") or "") == "assistant" else "user"
        content = (item.get("content") or "").strip()
        if content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    client = OpenAI(api_key=api_key, timeout=_ai_openai_timeout_seconds())

    responses_input = []
    for item in messages:
        responses_input.append(
            {
                "role": item["role"],
                "content": [{"type": "input_text", "text": item["content"]}],
            }
        )

    try:
        response = client.responses.create(
            model=model,
            input=responses_input,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )
        content = (getattr(response, "output_text", "") or "").strip()
        if not content:
            # Fallback compatible con algunos modelos/parsers
            for output_item in getattr(response, "output", []) or []:
                for output_content in getattr(output_item, "content", []) or []:
                    text_value = getattr(output_content, "text", "") or ""
                    if text_value.strip():
                        content = text_value.strip()
                        break
                if content:
                    break
        if not content:
            return None
        return content, model
    except Exception as exc:
        print(f"WARNING ai openai responses provider failed: {exc}")

    # Fallback con chat.completions del SDK oficial
    try:
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_output_tokens,
        )
        choices = getattr(completion, "choices", None) or []
        if not choices:
            return None
        content = (getattr(choices[0].message, "content", "") or "").strip()
        if not content:
            return None
        return content, model
    except Exception as exc:
        print(f"WARNING ai openai chat-completions provider failed: {exc}")
        return None


_AI_AUDIO_MAX_BYTES = 10 * 1024 * 1024
_AI_AUDIO_ALLOWED_MIME_TYPES: dict[str, str] = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".aac",
}
_AI_AUDIO_ALLOWED_EXTENSIONS = set(_AI_AUDIO_ALLOWED_MIME_TYPES.values())


def _ai_transcription_model_candidates() -> list[str]:
    configured = (os.getenv("OPENAI_AUDIO_TRANSCRIPTION_MODEL") or "").strip()
    base = [configured] if configured else []
    base.extend(["gpt-4o-mini-transcribe", "whisper-1"])
    return list(dict.fromkeys(item for item in base if item))


def _validate_ai_audio_upload(
    content: bytes,
    filename: str,
    content_type: str | None = None,
    max_bytes: int = _AI_AUDIO_MAX_BYTES,
) -> tuple[str, str]:
    if not content:
        raise HTTPException(status_code=400, detail="El audio está vacío.")
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail="La nota de voz supera el tamaño permitido.")

    safe_filename = _sanitize_filename(filename or "nota-voz.webm")
    ext = Path(safe_filename).suffix.lower()
    declared_mime = (content_type or "").split(";")[0].strip().lower()
    guessed_mime = (mimetypes.guess_type(safe_filename)[0] or "").strip().lower()
    detected_mime = declared_mime or guessed_mime

    if detected_mime not in _AI_AUDIO_ALLOWED_MIME_TYPES:
        if ext in _AI_AUDIO_ALLOWED_EXTENSIONS:
            detected_mime = next(
                (mime for mime, expected_ext in _AI_AUDIO_ALLOWED_MIME_TYPES.items() if expected_ext == ext),
                "",
            )
        else:
            raise HTTPException(status_code=400, detail="Formato de audio no compatible.")

    expected_ext = _AI_AUDIO_ALLOWED_MIME_TYPES.get(detected_mime, "")
    if expected_ext and ext != expected_ext:
        base_name = os.path.splitext(safe_filename)[0] or "nota-voz"
        safe_filename = f"{base_name}{expected_ext}"

    return detected_mime, safe_filename


def _voice_audio_response_meta(file_path: str | None, fallback_stem: str) -> tuple[str, str]:
    ext = Path(file_path or "").suffix.lower()
    mime_by_ext = {
        ".webm": "audio/webm",
        ".ogg": "audio/ogg",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
    }
    media_type = mime_by_ext.get(ext) or (mimetypes.guess_type(file_path or "")[0] or "").strip().lower() or "application/octet-stream"
    safe_ext = ext if ext in mime_by_ext else _AI_AUDIO_ALLOWED_MIME_TYPES.get(media_type, ".webm")
    return media_type, f"{fallback_stem}{safe_ext or '.webm'}"


def _ai_transcription_timeout_seconds() -> float:
    """Timeout for audio transcription — needs to be much higher than chat completions."""
    raw = (os.getenv("OPENAI_TRANSCRIPTION_TIMEOUT") or "180").strip()
    try:
        value = float(raw)
    except Exception:
        return 180.0
    return max(30.0, min(600.0, value))


def _transcribe_ai_audio(content: bytes, filename: str) -> tuple[str, str] | None:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key or OpenAI is None:
        return None

    client = OpenAI(api_key=api_key, timeout=_ai_transcription_timeout_seconds())
    prompt = (
        "Transcripción de consulta médica en español latinoamericano. "
        "Contexto: diálogo entre un profesional de salud y un paciente. "
        "Prioridades: (1) nombres de medicamentos, dosis y frecuencias exactas, "
        "(2) valores numéricos clínicos como presión arterial, frecuencia cardíaca, "
        "temperatura, glicemia, (3) términos diagnósticos y anatómicos, "
        "(4) fechas e intervalos de tiempo, (5) indicaciones y restricciones del profesional. "
        "Mantén fidelidad absoluta — no interpretes ni resumas."
    )

    for model_name in _ai_transcription_model_candidates():
        try:
            audio_file = io.BytesIO(content)
            audio_file.name = filename
            transcript = client.audio.transcriptions.create(
                model=model_name,
                file=audio_file,
                language="es",
                prompt=prompt,
            )
            text_value = (getattr(transcript, "text", "") or "").strip()
            if not text_value and isinstance(transcript, dict):
                text_value = str(transcript.get("text") or "").strip()
            text_value = re.sub(r"\s+", " ", text_value).strip()
            if text_value:
                return _clip_text(text_value, 12000), model_name
        except Exception as exc:
            print(f"WARNING ai audio transcription failed with {model_name}: {exc}")
    return None


def _family_attention_priority(item: dict) -> tuple[int, int, int, int]:
    pending_count = len(item.get("pending_documents") or [])
    return (
        int(item.get("active_alerts") or 0),
        1 if item.get("low_adherence") else 0,
        pending_count,
        int(item.get("upcoming_appointments") or 0),
    )


def _diagnosis_mentions_from_context(context: dict) -> list[dict]:
    diagnosis_rows: list[dict] = []
    summaries_by_document = {
        getattr(item, "document_id", None): item
        for item in (context.get("document_summaries") or [])
        if getattr(item, "document_id", None) is not None
    }
    for document_id, entities in (context.get("document_entities_by_document") or {}).items():
        summary = summaries_by_document.get(document_id)
        for entity in entities or []:
            if getattr(entity, "entity_type", "") != "diagnosis":
                continue
            diagnosis_rows.append(
                {
                    "document_id": document_id,
                    "name": getattr(entity, "entity_name", "") or "Hallazgo clinico",
                    "detail": getattr(entity, "entity_value", "") or getattr(entity, "source_text", ""),
                    "confidence": getattr(entity, "confidence", 0),
                    "document_summary": getattr(summary, "patient_friendly_explanation", "") if summary else "",
                    "updated_at": getattr(summary, "updated_at", None) if summary else None,
                }
            )
    diagnosis_rows.sort(key=lambda item: item.get("updated_at") or datetime.min, reverse=True)
    return diagnosis_rows


def _fallback_ai_reply(message: str, context: dict) -> str:
    normalized = _normalize_text(message or "")
    latest_document = context.get("latest_document")
    active_medications = context.get("active_medications") or []
    upcoming = context.get("upcoming") or []
    appointments = context.get("appointments") or []
    documents = context.get("documents") or []
    medications = context.get("medications") or []
    learned_context = _clip_text(context.get("learned_profile_context") or "", 220)
    appointment_insights = context.get("appointment_insights") or {}
    document_insights = context.get("document_insights") or {}
    medication_insights = context.get("medication_insights") or {}
    adherence_summary = context.get("adherence_summary") or {}
    health_alerts = context.get("health_alerts") or []
    document_summaries = context.get("document_summaries") or []
    profile_notes = context.get("profile_notes") or []
    family_access = context.get("family_access") or {}
    family_context = context.get("family_context") or {}
    family_profiles = family_context.get("profiles") or []
    diagnosis_mentions = _diagnosis_mentions_from_context(context)
    appointments_total = _context_total_count(context, "appointments", len(appointments))
    documents_total = _context_total_count(context, "documents", len(documents))
    medications_total = _context_total_count(context, "medications", len(medications))
    active_medications_total = _context_total_count(context, "active_medications", len(active_medications))

    if _message_asks_family_access(message):
        return _build_family_access_reply(context)

    if family_profiles and any(
        token in normalized
        for token in [
            "familiar",
            "familia",
            "quien necesita mas atencion",
            "quien necesita mas ayuda",
            "que familiar necesita mas atencion",
        ]
    ):
        ranked = sorted(family_profiles, key=_family_attention_priority, reverse=True)
        top = ranked[0]
        reasons = []
        if top.get("active_alerts"):
            reasons.append(f"{top.get('active_alerts')} alerta(s) activa(s)")
        if top.get("low_adherence"):
            reasons.append("adherencia baja")
        if top.get("upcoming_appointments"):
            reasons.append(f"{top.get('upcoming_appointments')} cita(s) proxima(s)")
        if top.get("pending_documents"):
            reasons.append(f"documentos pendientes: {', '.join((top.get('pending_documents') or [])[:3])}")
        response = (
            f"El familiar que hoy necesita mas atencion es {top.get('profile_name') or 'un perfil familiar'}"
            + (f" ({top.get('relation_with_owner')})" if top.get("relation_with_owner") else "")
            + ". "
        )
        response += "Motivos principales: " + (", ".join(reasons) if reasons else "aparece primero por prioridad del radar familiar") + "."
        if len(ranked) > 1:
            runner_up = ranked[1]
            response += f" Despues viene {runner_up.get('profile_name') or 'otro perfil'} con {runner_up.get('active_alerts', 0)} alerta(s)."
        return response

    if diagnosis_mentions and any(
        token in normalized
        for token in ["diagnostico", "diagnostico detectado", "diagnosticos", "informe medico", "hallazgo"]
    ):
        top = diagnosis_mentions[0]
        reply = f"En los documentos del perfil activo detecto como hallazgo documental principal: {top.get('name')}."
        if top.get("detail"):
            reply += f" Texto OCR relacionado: {_clip_text(top.get('detail'), 180)}."
        if top.get("document_summary"):
            reply += " Explicacion simple del documento: " + _clip_text(top.get("document_summary"), 220) + "."
        reply += " Esto debe leerse como informacion del informe y no como diagnostico definitivo por si sola."
        return reply

    if any(token in normalized for token in ["como va mi tratamiento", "como va el tratamiento", "como voy con mi tratamiento"]):
        overall = adherence_summary.get("overall_adherence_rate")
        low_items = adherence_summary.get("low_adherence_items") or []
        reply_parts = [
            f"Tratamiento actual del perfil {context['profile']['name']}: {active_medications_total} medicamento(s) activo(s)."
        ]
        if overall is not None:
            reply_parts.append(f"Adherencia estimada en 30 dias: {overall}%.")
        if low_items:
            top = low_items[0]
            reply_parts.append(
                f"El principal punto a revisar es {top.get('name') or 'un medicamento'}, con adherencia {top.get('adherence_rate') or 0}%."
            )
        if health_alerts:
            reply_parts.append(f"Radar de salud: {len(health_alerts)} alerta(s) activa(s).")
        return " ".join(reply_parts)

    if any(token in normalized for token in ["que debo llevar a mi cita", "que llevar a mi cita", "cita de manana", "cita de mañana"]):
        next_item = next((item for item in upcoming if item.date_time), None)
        if not next_item:
            return "No encuentro una cita próxima registrada para preparar."
        checklist = ["documento de identidad", "orden médica o motivo de consulta", "lista de medicamentos actuales"]
        if latest_document:
            checklist.append("resultados o documentos clínicos recientes")
        return (
            f"Para tu próxima cita del {_safe_iso(next_item.date_time)}, te sugiero llevar: "
            + ", ".join(checklist)
            + ". Si corresponde, confirma el centro y la especialidad antes de salir."
        )

    if any(token in normalized for token in ["radar", "alertas", "riesgos", "que debo revisar"]):
        if not health_alerts:
            return "No detecto alertas activas relevantes en este momento para el perfil activo."
        parts = [f"Radar de salud: hay {len(health_alerts)} alerta(s) activa(s)."]
        for alert in health_alerts[:3]:
            parts.append(f"{alert.title}: {alert.description}")
        return " ".join(parts)

    if any(token in normalized for token in ["reporte clinico", "reporte clínico", "genera un reporte", "reporte medico", "reporte médico"]):
        overall = adherence_summary.get("overall_adherence_rate")
        return (
            f"Puedo generar un reporte clínico estructurado del perfil activo {context['profile']['name']}. "
            f"Hoy veo {active_medications_total} medicamento(s) activo(s), {appointments_total} cita(s), "
            f"{documents_total} documento(s) y adherencia estimada de {overall if overall is not None else 'sin datos'}%."
        )

    if any(
        token in normalized
        for token in [
            "nota del perfil",
            "notas del perfil",
            "nota rapida",
            "nota rápida",
            "notas rapidas",
            "notas rápidas",
            "mis notas",
            "que anote",
            "qué anoté",
        ]
    ):
        if not profile_notes:
            return "No veo notas del perfil guardadas en el perfil activo."
        rendered_notes = []
        for item in profile_notes[:5]:
            timestamp = _safe_iso_local(getattr(item, "updated_at", None) or getattr(item, "created_at", None), context.get("timezone_name") or DEFAULT_TZ_NAME)
            note_text = _clip_text(getattr(item, "note", "") or "", 180)
            rendered_notes.append(note_text + (f" ({timestamp})" if timestamp else ""))
        return "Notas rápidas recientes del perfil activo: " + " | ".join(rendered_notes) + "."

    if "ultima" in normalized and "cita" in normalized:
        return _structured_last_appointment_reply(context, normalized)

    if any(token in normalized for token in ["documentos", "tipos de documento", "tipo de documento", "archivo pdf", "archivo imagen"]):
        counts_type = (document_insights.get("counts_by_type") or {})
        counts_format = (document_insights.get("counts_by_format") or {})
        last_doc = document_insights.get("last_created") or {}
        sample_complete = documents_total <= len(documents)
        parts = [f"Documentos registrados: {documents_total}."]
        if sample_complete:
            parts.extend([
                (
                    "Tipos: receta "
                    f"{counts_type.get('receta', 0)}, orden {counts_type.get('orden', 0)}, "
                    f"resultado {counts_type.get('resultado', 0)}, informe {counts_type.get('informe', 0)}, "
                    f"otro {counts_type.get('otro', 0)}."
                ),
                (
                    "Formato de archivo: pdf "
                    f"{counts_format.get('pdf', 0)}, imagen {counts_format.get('imagen', 0)}, "
                    f"otro {counts_format.get('otro', 0)}."
                ),
            ])
        else:
            parts.append("El detalle por tipo aun puede ser parcial si el perfil tiene muchos documentos.")
        if last_doc:
            detail = (
                f"Último documento: {last_doc.get('detected_doc_type') or last_doc.get('doc_type') or 'otro'} "
                f"({last_doc.get('file_format') or 'desconocido'})"
            )
            if last_doc.get("date"):
                detail += f", fecha {last_doc.get('date')}"
            elif last_doc.get("created_at"):
                detail += f", cargado {last_doc.get('created_at')}"
            if last_doc.get("center"):
                detail += f", centro {last_doc.get('center')}"
            parts.append(detail + ".")
        ocr_doc = document_insights.get("last_with_ocr") or {}
        if ocr_doc.get("ocr_excerpt"):
            parts.append("Resumen OCR orientativo: " + _clip_text(ocr_doc.get("ocr_excerpt"), 260))
            parts.append("La lectura OCR puede contener errores y conviene validarla con el archivo original.")
        return " ".join(parts)

    latest_document_tokens = [
        "ultimo documento",
        "último documento",
        "explicame mi ultimo documento",
        "explícame mi último documento",
        "ultimo informe",
        "último informe",
        "ultimo resultado",
        "último resultado",
        "ultimo examen",
        "último examen",
    ]
    if any(token in normalized for token in latest_document_tokens):
        if not latest_document:
            return (
                "No encuentro documentos registrados para el perfil activo. "
                "Si subes un documento, podré ayudarte a resumirlo."
            )
        return _structured_document_reply_rich(latest_document, context)

    relevant_documents = context.get("relevant_documents") or []
    if relevant_documents and any(
        token in normalized
        for token in ["documento", "ocr", "informe", "resultado", "receta", "orden", "pdf", "imagen", "archivo"]
    ):
        return _structured_document_reply_rich(relevant_documents[0], context)

    if any(token in normalized for token in ["resumen de medicamentos", "mis medicamentos", "estado de medicamentos"]):
        status_counts = medication_insights.get("counts_by_status") or {}
        schedule_counts = medication_insights.get("counts_by_schedule") or {}
        frequency_counts = medication_insights.get("counts_by_frequency") or {}
        last_active = medication_insights.get("last_active_created") or {}
        parts = [
            f"Medicamentos registrados: {medications_total}.",
            f"Estado: activos {status_counts.get('activa', 0)}, realizados {status_counts.get('realizada', 0)}.",
            f"Horario: con horario {schedule_counts.get('con_horario', 0)}, sin horario {schedule_counts.get('sin_horario', 0)}.",
            f"Frecuencia: con frecuencia {frequency_counts.get('con_frecuencia', 0)}, sin frecuencia {frequency_counts.get('sin_frecuencia', 0)}.",
        ]
        if last_active:
            detail = f"Último medicamento activo agregado: {last_active.get('name') or 'Medicamento'}"
            if last_active.get("dose"):
                detail += f" ({last_active.get('dose')})"
            if last_active.get("frequency"):
                detail += f", frecuencia {last_active.get('frequency')}"
            if last_active.get("schedule_time"):
                detail += f", horario {last_active.get('schedule_time')}"
            parts.append(detail + ".")
        return " ".join(parts)

    if any(token in normalized for token in ["medicamento", "medicamentos", "que medicamentos estoy tomando", "que estoy tomando"]):
        if not active_medications:
            return "No veo medicamentos activos registrados para el perfil activo."
        items = []
        for med in active_medications[:6]:
            detail = med.name
            if med.dose:
                detail += f" ({med.dose})"
            if med.frequency:
                detail += f", frecuencia {med.frequency}"
            items.append(detail)
        return (
            f"Actualmente aparecen {active_medications_total} medicamento(s) activo(s): "
            + "; ".join(items)
            + "."
        )

    if any(token in normalized for token in ["proxima cita", "proxima actividad", "cuando es mi proxima cita", "cita proxima", "cita mas proxima", "cita mas cercana"]):
        next_item = next((item for item in upcoming if item.date_time), None)
        if not next_item:
            return "No encuentro una cita próxima con fecha registrada para el perfil activo."
        appt_type = str(getattr(next_item.type, "value", next_item.type))
        status = str(getattr(next_item.status, "value", next_item.status))
        return (
            f"La próxima actividad registrada es una {appt_type} el {_safe_iso(next_item.date_time)}"
            + (f" en {next_item.center}" if next_item.center else "")
            + (f", especialidad {next_item.specialty}" if next_item.specialty else "")
            + f". Estado actual: {status}."
        )

    if any(token in normalized for token in ["resume mi historial", "resumen de mi historial", "historial clinico", "historial"]):
        latest_doc_text = ""
        if latest_document:
            latest_doc_text = (
                f" Último documento: {str(getattr(latest_document.doc_type, 'value', latest_document.doc_type))}"
                + (f" del {_safe_iso(latest_document.date)}." if latest_document.date else ".")
            )
        next_item = next((item for item in upcoming if item.date_time), None)
        next_appt_text = (
            f" Próxima cita: {_safe_iso(next_item.date_time)}."
            if next_item
            else " No hay próxima cita fechada."
        )
        diagnosis_text = ""
        if diagnosis_mentions:
            diagnosis_text = f" Hallazgos documentales recientes: {', '.join(item.get('name') or 'hallazgo' for item in diagnosis_mentions[:3])}."
        return (
            f"Resumen del perfil activo {context['profile']['name']}: "
            f"{appointments_total} actividad(es), {documents_total} documento(s) y {medications_total} medicamento(s) registrados."
            + latest_doc_text
            + next_appt_text
            + diagnosis_text
        )

        return (
            f"Claro, te ayudo con el perfil activo {context['profile']['name']}. "
            + (f"Contexto relevante detectado: {learned_context}. " if learned_context else "")
        + "Puedo revisar documentos, medicamentos, citas, historial, adherencia, radar de salud y reportes clínicos. "
        + "Si quieres, partimos con una de estas: "
        + "'Explícame mi último documento', 'Qué medicamentos estoy tomando', "
        + "'Cómo va mi tratamiento', 'Qué debo llevar a mi cita de mañana' o 'Genera un reporte clínico'."
        )


def _build_ai_references(message: str, context: dict) -> list[dict]:
    normalized = _normalize_text(message or "")
    refs: list[dict] = []
    latest_document = context.get("latest_document")
    relevant_documents = context.get("relevant_documents") or []
    active_medications = context.get("active_medications") or []
    upcoming = context.get("upcoming") or []
    profile_notes = context.get("profile_notes") or []
    voice_sessions = context.get("voice_sessions") or []
    voice_session_insights = context.get("voice_session_insights") or {}
    document_insights = context.get("document_insights") or {}
    medication_insights = context.get("medication_insights") or {}
    adherence_summary = context.get("adherence_summary") or {}
    health_alerts = context.get("health_alerts") or []
    family_access = context.get("family_access") or {}
    family_context = context.get("family_context") or {}
    diagnosis_mentions = _diagnosis_mentions_from_context(context)

    referenced_document = (
        relevant_documents[0]
        if relevant_documents and any(
            token in normalized for token in ["documento", "documentos", "ocr", "informe", "resultado", "receta", "orden", "pdf", "imagen", "archivo"]
        )
        else latest_document
        if latest_document and any(
            token in normalized for token in ["ultimo documento", "explicame mi ultimo documento", "ultimo informe", "ultimo resultado", "ultimo examen"]
        )
        else None
    )

    if referenced_document:
        doc_type = _infer_document_type(referenced_document)
        refs.append(
            {
                "kind": "document",
                "label": f"Documento {referenced_document.filename or f'#{referenced_document.id}'}",
                "detail": f"{doc_type} | {_document_file_format(referenced_document)} | {referenced_document.center or 'Sin centro'}",
            }
        )

    if document_insights and any(token in normalized for token in ["documentos", "tipos", "pdf", "imagen"]):
        counts = document_insights.get("counts_by_type") or {}
        refs.append(
            {
                "kind": "document-summary",
                "label": "Resumen de tipos de documento",
                "detail": (
                    f"Receta {counts.get('receta', 0)} | Orden {counts.get('orden', 0)} | "
                    f"Resultado {counts.get('resultado', 0)} | Informe {counts.get('informe', 0)}"
                ),
            }
        )

    if active_medications and any(
        token in normalized for token in ["medicamento", "medicamentos", "tomando", "dosis", "frecuencia"]
    ):
        for med in active_medications[:3]:
            refs.append(
                {
                    "kind": "medication",
                    "label": med.name,
                    "detail": ", ".join([value for value in [med.dose or "", med.frequency or ""] if value]),
                }
            )

    if medication_insights and any(token in normalized for token in ["medicamentos", "estado", "adherencia"]):
        status_counts = medication_insights.get("counts_by_status") or {}
        refs.append(
            {
                "kind": "medication-summary",
                "label": "Resumen de estado de medicamentos",
                "detail": f"Activos {status_counts.get('activa', 0)} | Realizados {status_counts.get('realizada', 0)}",
            }
        )

    if voice_sessions and any(
        token in normalized
        for token in [
            "audio",
            "audios",
            "transcripcion",
            "transcripción",
            "grabacion",
            "grabación",
            "klinip voice",
            "consulta grabada",
            "resumen de la consulta",
            "resumen consulta",
            "que dijo el medico",
            "qué dijo el médico",
            "indicaciones del medico",
            "indicaciones del médico",
        ]
    ):
        latest_voice = voice_sessions[0]
        latest_voice_summary = _voice_session_to_ai_dict(
            latest_voice,
            context.get("timezone_name") or DEFAULT_TZ_NAME,
            technical_chars=160,
            simple_chars=140,
            indications_limit=2,
        ) or {}
        refs.append(
            {
                "kind": "voice-session",
                "label": "Klinip Voice más reciente",
                "detail": " | ".join(
                    [
                        value
                        for value in [
                            latest_voice_summary.get("created_at") or "sin fecha",
                            f"{latest_voice_summary.get('indicaciones_count', 0)} indicaciones",
                            "compartida" if latest_voice_summary.get("shared") else "no compartida",
                        ]
                        if value
                    ]
                ),
            }
        )

    if int(voice_session_insights.get("total_sessions", 0) or 0) > 0 and any(
        token in normalized for token in ["indicaciones", "audio", "transcripcion", "transcripción", "grabacion", "grabación", "consulta grabada"]
    ):
        refs.append(
            {
                "kind": "voice-summary",
                "label": "Resumen Klinip Voice",
                "detail": (
                    f"Sesiones {voice_session_insights.get('total_sessions', 0)} | "
                    f"Indicaciones {voice_session_insights.get('total_indications', 0)}"
                ),
            }
        )

    if adherence_summary and any(token in normalized for token in ["adherencia", "tratamiento", "recordatorio"]):
        refs.append(
            {
                "kind": "adherence",
                "label": "Resumen de adherencia",
                "detail": f"{adherence_summary.get('overall_adherence_rate') or 'sin datos'}% en {adherence_summary.get('window_days', 30)} días",
            }
        )

    if health_alerts and any(token in normalized for token in ["radar", "alerta", "riesgo"]):
        first = health_alerts[0]
        refs.append(
            {
                "kind": "health-alert",
                "label": first.title,
                "detail": first.severity,
            }
            )

    if profile_notes and any(
        token in normalized
        for token in [
            "nota del perfil",
            "notas del perfil",
            "nota rapida",
            "nota rápida",
            "notas rapidas",
            "notas rápidas",
            "mis notas",
            "pendiente personal",
            "recordatorio personal",
        ]
    ):
        for item in profile_notes[:3]:
            refs.append(
                {
                    "kind": "profile-note",
                    "label": _clip_text(getattr(item, "note", "") or "Nota rápida", 72),
                    "detail": _safe_iso_local(
                        getattr(item, "updated_at", None) or getattr(item, "created_at", None),
                        context.get("timezone_name") or DEFAULT_TZ_NAME,
                    )
                    or "sin fecha",
                }
            )

    if family_context and any(
        token in normalized for token in ["familiar", "familia", "quien necesita mas atencion", "que familiar"]
    ):
        top_profiles = sorted(family_context.get("profiles") or [], key=_family_attention_priority, reverse=True)[:2]
        for item in top_profiles:
            refs.append(
                {
                    "kind": "family-summary",
                    "label": item.get("profile_name") or "Perfil familiar",
                    "detail": (
                        f"Alertas {item.get('active_alerts', 0)} | "
                        f"Adherencia baja {'si' if item.get('low_adherence') else 'no'} | "
                        f"Citas {item.get('upcoming_appointments', 0)}"
                    ),
                }
            )

    if family_access and _message_asks_family_access(message):
        for item in (family_access.get("profiles") or [])[:3]:
            refs.append(
                {
                    "kind": "family-access",
                    "label": item.get("profile_name") or "Perfil compartido",
                    "detail": (
                        f"{item.get('role_label') or 'Lector'} | "
                        f"{item.get('relation_with_owner') or 'Perfil compartido'}"
                    ),
                }
            )

    if diagnosis_mentions and any(
        token in normalized for token in ["diagnostico", "diagnosticos", "informe", "hallazgo", "resultado"]
    ):
        for item in diagnosis_mentions[:2]:
            refs.append(
                {
                    "kind": "diagnosis-document",
                    "label": item.get("name") or "Hallazgo documental",
                    "detail": _clip_text(item.get("detail") or item.get("document_summary") or "", 120),
                }
            )

    if upcoming and any(token in normalized for token in ["cita", "proxima", "actividad", "agenda"]):
        item = next((appt for appt in upcoming if appt.date_time), None)
        if item:
            appt_type = str(getattr(item.type, "value", item.type))
            refs.append(
                {
                    "kind": "appointment",
                    "label": f"{appt_type.title()} próxima",
                    "detail": " · ".join(
                        [value for value in [_safe_iso(item.date_time), item.specialty or "", item.center or ""] if value]
                    ),
                }
            )

    if any(token in normalized for token in ["historial", "perfil", "resume"]) and context.get("profile"):
        refs.append(
            {
                "kind": "profile",
                "label": f"Perfil activo: {context['profile']['name']}",
                "detail": f"Plan {context['plan'].get('plan_type')}",
            }
        )
    if context.get("learned_profile_context") and any(
        token in normalized
        for token in ["perfil", "contexto", "historial", "documento", "resumen", "condicion", "alergia"]
    ):
        refs.append(
            {
                "kind": "memory",
                "label": "Memoria clinica IA",
                "detail": _clip_text(context.get("learned_profile_context") or "", 120),
            }
        )

    seen = set()
    unique_refs = []
    for ref in refs:
        key = (ref.get("kind"), ref.get("label"), ref.get("detail"))
        if key in seen:
            continue
        seen.add(key)
        unique_refs.append(ref)
    return unique_refs[:4]


def _build_ai_reply(
    message: str,
    history: list[dict],
    context: dict,
    timing_info: dict | None = None,
) -> tuple[str, str, str, list[dict]]:
    prompt_profile = _select_ai_prompt_profile(context, timing_info)
    compact_history, conversation_summary = _compact_history_for_prompt(
        history,
        max_recent_messages=int(prompt_profile.get("history_messages", 6) or 6),
        summary_char_limit=int(prompt_profile.get("summary_chars", 900) or 900),
    )
    persisted_summaries = [
        _clip_text(item.get("summary") or "", 240)
        for item in (context.get("conversation_summaries") or [])[:2]
        if (item.get("summary") or "").strip()
    ]
    merged_conversation_summary = "\n".join(
        item for item in [*persisted_summaries, conversation_summary] if (item or "").strip()
    )
    serialized_context = _serialize_ai_context(context, prompt_profile=prompt_profile)
    serialized_context_json = json.dumps(
        serialized_context,
        ensure_ascii=False,
    )
    system_prompt = _ai_system_prompt(context, prompt_profile=prompt_profile) + "\n\nContexto clinico JSON:\n" + serialized_context_json
    references = _build_ai_references(message, context)
    if timing_info is not None:
        timing_info["prompt_profile"] = prompt_profile.get("name") or "normal"
        timing_info["prompt_context_chars"] = len(serialized_context_json)
        timing_info["prompt_system_chars"] = len(system_prompt)
    openai_started_at = time.perf_counter()
    provider_reply = _call_openai_ai(
        system_prompt,
        compact_history,
        message,
        conversation_summary=merged_conversation_summary,
    )
    openai_ms = round((time.perf_counter() - openai_started_at) * 1000, 1)
    if timing_info is not None:
        timing_info["openai_ms"] = openai_ms
        timing_info["prompt_history_messages"] = len(compact_history)
        timing_info["conversation_summary_chars"] = len(merged_conversation_summary or "")
        timing_info["memory_summary_count"] = len(persisted_summaries)
    if provider_reply:
        text_reply, model = provider_reply
        return _prepend_degraded_notice(_sanitize_ai_reply(text_reply), context), model, "openai", references
    return (
        _prepend_degraded_notice(_sanitize_ai_reply(_fallback_ai_reply(message, context)), context),
        "context-fallback",
        "fallback",
        references,
    )


def _extract_direct_report_request(message: str) -> dict | None:
    normalized = _normalize_text(message or "")
    if "reporte" not in normalized:
        return None
    if not any(token in normalized for token in ["genera", "generar", "crea", "crear", "prepara", "preparar", "haz", "hacer"]):
        return None

    report_type = "consulta_medica"
    if "seguimiento" in normalized or "tratamiento" in normalized:
        report_type = "seguimiento_tratamiento"
    elif "mensual" in normalized:
        report_type = "resumen_mensual"
    elif "familiar" in normalized or "familia" in normalized:
        report_type = "resumen_familiar"

    period_days = 30
    if "semanal" in normalized or "esta semana" in normalized or "7 dias" in normalized or "7 dias" in normalized:
        period_days = 7
    elif "quincenal" in normalized or "15 dias" in normalized:
        period_days = 15
    elif "mensual" in normalized or "30 dias" in normalized:
        period_days = 30
    elif "trimestral" in normalized or "90 dias" in normalized:
        period_days = 90

    explicit_days = re.search(r"(\d{1,3})\s*dias?", normalized)
    if explicit_days:
        period_days = max(1, min(365, int(explicit_days.group(1))))

    return {
        "report_type": report_type,
        "period_days": period_days,
    }


def _generate_direct_chat_report(
    db: Session,
    current_user: models.User,
    context: dict,
    message: str,
) -> tuple[str, str, str, list[dict]]:
    request = _extract_direct_report_request(message)
    if not request:
        return _build_ai_reply(message, [], context)

    profile, _ = _get_profile_access_or_404(db, current_user, int(context["profile"]["id"]))
    report_payload = _build_clinical_report_payload(
        context,
        report_type=request["report_type"],
        period_days=request["period_days"],
    )
    report = _persist_clinical_report(
        db,
        profile,
        report_type=report_payload["report_type"],
        period_days=request["period_days"],
        report_payload=report_payload,
    )
    adherence = context.get("adherence_summary") or {}
    reply = (
        f"Ya generé un reporte clínico de tipo {report_payload['report_type'].replace('_', ' ')} para {context['profile']['name']} "
        f"con ventana de {request['period_days']} días. "
        f"El reporte incluye {len(report_payload.get('current_medications') or [])} medicamento(s) actual(es), "
        f"{len((report_payload.get('appointments') or {}).get('recent') or [])} cita(s) reciente(s), "
        f"{len((report_payload.get('documents') or {}).get('summaries') or [])} documento(s) resumido(s) "
        f"y adherencia estimada de {adherence.get('overall_adherence_rate') if adherence.get('overall_adherence_rate') is not None else 'sin datos'}%. "
        "Lo dejé disponible en Reportes clínicos para descargar en PDF."
    )
    references = [
        {
            "kind": "clinical-report",
            "label": f"Reporte #{report.id}",
            "detail": f"{report.report_type} | {report.pdf_filename or 'PDF disponible'}",
        },
        {
            "kind": "profile",
            "label": f"Perfil activo: {context['profile']['name']}",
            "detail": f"Plan {context['plan'].get('plan_type')}",
        },
    ]
    return reply, "clinical-report-generator", "report-generated", references


def _persist_ai_message(
    db: Session,
    *,
    profile_id: int,
    user_id: int,
    conversation_id: str,
    conversation_title: str = "",
    role: str,
    content: str,
    metadata_json: dict | None = None,
):
    item = models.AiConversationMessage(
        profile_id=profile_id,
        user_id=user_id,
        conversation_id=(conversation_id or "").strip(),
        conversation_title=(conversation_title or "").strip(),
        role=(role or "").strip().lower() or "assistant",
        content=(content or "").strip(),
        metadata_json=metadata_json or {},
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


# Auth endpoints
@app.post("/auth/register", response_model=schemas.UserOut)
def register(
    request: Request,
    user_in: schemas.UserCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth.get_db),
):
    _check_rate_limit(request, "register")
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
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(auth.get_db),
):
    # 1. Rate limiting por IP
    _check_rate_limit(request, "login")
    ensure_login_security_schema()

    email = (form_data.username or "").lower().strip()
    try:
        user = auth.get_user_by_email(db, email)
    except ProgrammingError as exc:
        db.rollback()
        detail = str(getattr(exc, "orig", exc) or "").lower()
        if "failed_login_attempts" in detail or "locked_until" in detail:
            ensure_login_security_schema()
            user = auth.get_user_by_email(db, email)
        else:
            raise

    # 2. Verificar bloqueo de cuenta
    if user and not getattr(user, "deleted", False):
        locked_until = getattr(user, "locked_until", None)
        if locked_until and locked_until > datetime.utcnow():
            mins = max(1, int((locked_until - datetime.utcnow()).total_seconds() / 60) + 1)
            raise HTTPException(
                status_code=429,
                detail=f"Cuenta bloqueada por multiples intentos fallidos. "
                       f"Intenta de nuevo en {mins} minuto(s).",
            )

    # 3. Verificar credenciales
    password_ok = (
        user is not None
        and not getattr(user, "deleted", False)
        and auth.verify_password(form_data.password, user.password_hash)
    )

    if not password_ok:
        if user and not getattr(user, "deleted", False):
            attempts = (getattr(user, "failed_login_attempts", 0) or 0) + 1
            user.failed_login_attempts = attempts
            if attempts >= _MAX_LOGIN_ATTEMPTS:
                user.locked_until = datetime.utcnow() + timedelta(minutes=_LOCKOUT_MINUTES)
            db.add(user)
            db.commit()
        _write_audit_log(db, "login_failed",
                         user_id=user.id if user else None,
                         ip_address=_get_client_ip(request),
                         user_agent=request.headers.get("user-agent", ""))
        raise HTTPException(status_code=400, detail="Correo o contraseña incorrectos")

    # 4. Exito: resetear contador
    user.failed_login_attempts = 0
    user.locked_until = None
    db.add(user)
    db.commit()

    tv = int(getattr(user, "token_version", 0) or 0)

    # 5. Si MFA está activo, devolver token temporal (paso 2 pendiente)
    if getattr(user, "mfa_enabled", False):
        mfa_token = auth.create_mfa_temp_token(user.id, tv)
        _write_audit_log(db, "login_mfa_required", user_id=user.id,
                         ip_address=_get_client_ip(request),
                         user_agent=request.headers.get("user-agent", ""))
        return {"access_token": "", "token_type": "bearer",
                "mfa_required": True, "mfa_token": mfa_token}

    # 6. Login completo: emitir access token + refresh token
    access_token = auth.create_access_token(
        data={"sub": str(user.id), "tv": tv},
    )
    device_label = request.headers.get("user-agent", "")[:200]
    refresh_token = auth.create_refresh_token(
        db, user.id,
        ip_address=_get_client_ip(request),
        device_label=device_label,
    )
    _write_audit_log(db, "login_ok", user_id=user.id,
                     ip_address=_get_client_ip(request),
                     user_agent=device_label)
    return {"access_token": access_token, "token_type": "bearer",
            "refresh_token": refresh_token}


@app.post("/auth/forgot-password")
def forgot_password(
    payload: schemas.ForgotPasswordIn,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth.get_db),
):
    _check_rate_limit(request, "forgot-password")
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
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")

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
        raise HTTPException(status_code=400, detail="Token inválido o expirado")

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


# ─── Audit log helper ─────────────────────────────────────────────────────────

def _write_audit_log(
    db: Session,
    action: str,
    user_id: int | None = None,
    resource_type: str = "",
    resource_id: int | None = None,
    ip_address: str = "",
    user_agent: str = "",
    metadata: dict | None = None,
):
    """Registra un evento de seguridad en la tabla audit_logs."""
    try:
        entry = models.AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=ip_address,
            user_agent=user_agent,
            metadata_json=metadata or {},
        )
        db.add(entry)
        db.commit()
    except Exception:
        db.rollback()


STEPUP_EMAIL_CODE_LENGTH = 6
STEPUP_EMAIL_CODE_EXPIRE_MINUTES = 5
STEPUP_EMAIL_CODE_MAX_ATTEMPTS = 5


def _mask_email_address(email: str) -> str:
    local_part, _, domain = (email or "").partition("@")
    if not local_part or not domain:
        return email or ""
    if len(local_part) <= 2:
        visible_local = local_part[:1]
    else:
        visible_local = f"{local_part[:2]}***"
    domain_name, dot, domain_suffix = domain.partition(".")
    visible_domain = domain_name[:1] + "***" if domain_name else "***"
    if dot and domain_suffix:
        return f"{visible_local}@{visible_domain}.{domain_suffix}"
    return f"{visible_local}@{visible_domain}"


def _generate_stepup_email_code(length: int = STEPUP_EMAIL_CODE_LENGTH) -> str:
    upper_bound = 10 ** max(length, 1)
    return str(secrets.randbelow(upper_bound)).zfill(length)


def _invalidate_pending_stepup_email_codes(db: Session, user_id: int) -> None:
    pending_codes = (
        db.query(models.StepUpEmailCode)
        .filter(
            models.StepUpEmailCode.user_id == user_id,
            models.StepUpEmailCode.used.is_(False),
        )
        .all()
    )
    for item in pending_codes:
        item.used = True
        item.used_at = datetime.utcnow()
        db.add(item)


def _get_active_stepup_email_code(db: Session, user_id: int) -> models.StepUpEmailCode | None:
    return (
        db.query(models.StepUpEmailCode)
        .filter(
            models.StepUpEmailCode.user_id == user_id,
            models.StepUpEmailCode.used.is_(False),
        )
        .order_by(models.StepUpEmailCode.created_at.desc())
        .first()
    )


def _verify_stepup_email_code(
    db: Session,
    current_user: models.User,
    code: str,
) -> tuple[bool, str | None]:
    active_code = _get_active_stepup_email_code(db, current_user.id)
    if not active_code:
        return False, "Primero solicita un código temporal por correo."

    if active_code.expires_at <= datetime.utcnow():
        active_code.used = True
        active_code.used_at = datetime.utcnow()
        db.add(active_code)
        db.commit()
        return False, "El código temporal expiró. Solicita uno nuevo."

    if active_code.attempts >= STEPUP_EMAIL_CODE_MAX_ATTEMPTS:
        active_code.used = True
        active_code.used_at = datetime.utcnow()
        db.add(active_code)
        db.commit()
        return False, "Se agotaron los intentos. Solicita un nuevo código."

    normalized_code = re.sub(r"\D", "", code or "")
    code_matches = (
        len(normalized_code) == STEPUP_EMAIL_CODE_LENGTH
        and auth.hash_token(normalized_code) == active_code.code_hash
    )
    if not code_matches:
        active_code.attempts = int(active_code.attempts or 0) + 1
        if active_code.attempts >= STEPUP_EMAIL_CODE_MAX_ATTEMPTS:
            active_code.used = True
            active_code.used_at = datetime.utcnow()
        db.add(active_code)
        db.commit()
        return False, "El código ingresado no es válido."

    active_code.used = True
    active_code.used_at = datetime.utcnow()
    db.add(active_code)
    db.commit()
    return True, None


# ─── MFA endpoints ────────────────────────────────────────────────────────────

@app.post("/auth/mfa/enroll", response_model=schemas.MfaEnrollOut)
def mfa_enroll(
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Inicia el enrolamiento TOTP. Devuelve URI para QR + secret + backup codes."""
    secret = auth.generate_totp_secret()
    totp_uri = auth.get_totp_uri(secret, current_user.email)  # usa el secret plano para el URI
    raw_codes = auth.generate_backup_codes(10)
    codes_json = auth.hash_backup_codes(raw_codes)

    # Guardamos secret cifrado y backup codes en el usuario pero NO activamos MFA aún
    current_user.mfa_secret = auth.encrypt_field(secret)
    current_user.mfa_backup_codes_json = codes_json
    db.add(current_user)
    db.commit()

    _write_audit_log(
        db, "mfa_enroll_started",
        user_id=current_user.id,
        ip_address=_get_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    return {"totp_uri": totp_uri, "secret": secret, "backup_codes": raw_codes}


@app.post("/auth/mfa/verify-enrollment")
def mfa_verify_enrollment(
    payload: schemas.MfaVerifyIn,
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Confirma el enrolamiento verificando el primer código TOTP."""
    if not current_user.mfa_secret:
        raise HTTPException(status_code=400, detail="No hay enrolamiento MFA pendiente")
    if current_user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA ya está activado")

    if not auth.verify_totp(current_user.mfa_secret, payload.code):
        _write_audit_log(db, "mfa_enroll_failed", user_id=current_user.id,
                         ip_address=_get_client_ip(request))
        raise HTTPException(status_code=400, detail="Código incorrecto")

    current_user.mfa_enabled = True
    # Invalidar todas las sesiones al activar MFA (seguridad)
    current_user.token_version = int(getattr(current_user, "token_version", 0) or 0) + 1
    auth.revoke_all_refresh_tokens(db, current_user.id)
    db.add(current_user)
    db.commit()

    _write_audit_log(db, "mfa_enabled", user_id=current_user.id,
                     ip_address=_get_client_ip(request),
                     user_agent=request.headers.get("user-agent", ""))
    return {"ok": True, "message": "MFA activado correctamente"}


@app.post("/auth/mfa/disable")
def mfa_disable(
    payload: schemas.MfaDisableIn,
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Desactiva MFA. Requiere código TOTP o backup code para confirmar."""
    if not current_user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA no está activado")

    # Verificar con TOTP o con backup code
    totp_ok = auth.verify_totp(current_user.mfa_secret or "", payload.code)
    backup_ok = False
    new_codes_json = None
    if not totp_ok and current_user.mfa_backup_codes_json:
        new_codes_json = auth.verify_backup_code(current_user.mfa_backup_codes_json, payload.code)
        backup_ok = new_codes_json is not None

    if not totp_ok and not backup_ok:
        _write_audit_log(db, "mfa_disable_failed", user_id=current_user.id,
                         ip_address=_get_client_ip(request))
        raise HTTPException(status_code=400, detail="Código incorrecto")

    current_user.mfa_enabled = False
    current_user.mfa_secret = None
    current_user.mfa_backup_codes_json = None
    # Invalidar sesiones al desactivar MFA
    current_user.token_version = int(getattr(current_user, "token_version", 0) or 0) + 1
    auth.revoke_all_refresh_tokens(db, current_user.id)
    db.add(current_user)
    db.commit()

    _write_audit_log(db, "mfa_disabled", user_id=current_user.id,
                     ip_address=_get_client_ip(request),
                     user_agent=request.headers.get("user-agent", ""))
    return {"ok": True, "message": "MFA desactivado"}


@app.post("/auth/mfa/verify", response_model=schemas.Token)
def mfa_verify_login(
    payload: schemas.MfaLoginIn,
    request: Request,
    db: Session = Depends(auth.get_db),
):
    """
    Segundo paso del login: valida el código TOTP (o backup code)
    y devuelve access_token + refresh_token.
    """
    decoded = auth.decode_mfa_temp_token(payload.mfa_token)
    if not decoded:
        raise HTTPException(status_code=401, detail="Token MFA inválido o expirado")

    user_id = int(decoded["sub"])
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or getattr(user, "deleted", False):
        raise HTTPException(status_code=401, detail="Usuario no válido")

    # Verificar que token_version coincide (evita replay con token viejo)
    if int(decoded.get("tv", -1)) != int(getattr(user, "token_version", 0) or 0):
        raise HTTPException(status_code=401, detail="Token MFA inválido o expirado")

    # Verificar código TOTP o backup code
    code_ok = auth.verify_totp(user.mfa_secret or "", payload.code)
    if not code_ok and user.mfa_backup_codes_json:
        new_codes = auth.verify_backup_code(user.mfa_backup_codes_json, payload.code)
        if new_codes is not None:
            code_ok = True
            user.mfa_backup_codes_json = new_codes
            db.add(user)
            db.commit()

    if not code_ok:
        _write_audit_log(db, "mfa_verify_failed", user_id=user.id,
                         ip_address=_get_client_ip(request))
        raise HTTPException(status_code=400, detail="Código MFA incorrecto")

    tv = int(getattr(user, "token_version", 0) or 0)
    access_token = auth.create_access_token({"sub": str(user.id), "tv": tv})
    device_label = request.headers.get("user-agent", "")[:200]
    refresh_token = auth.create_refresh_token(
        db, user.id,
        ip_address=_get_client_ip(request),
        device_label=device_label,
    )

    _write_audit_log(db, "login_ok", user_id=user.id,
                     ip_address=_get_client_ip(request),
                     user_agent=device_label,
                     metadata={"method": "mfa_totp"})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "refresh_token": refresh_token,
    }


@app.post("/auth/mfa/backup-codes/regenerate")
def mfa_regenerate_backup_codes(
    payload: schemas.MfaVerifyIn,
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Regenera los backup codes. Requiere código TOTP para confirmar."""
    if not current_user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA no está activado")
    if not auth.verify_totp(current_user.mfa_secret or "", payload.code):
        raise HTTPException(status_code=400, detail="Código incorrecto")

    raw_codes = auth.generate_backup_codes(10)
    current_user.mfa_backup_codes_json = auth.hash_backup_codes(raw_codes)
    db.add(current_user)
    db.commit()

    _write_audit_log(db, "mfa_backup_codes_regenerated", user_id=current_user.id,
                     ip_address=_get_client_ip(request))
    return {"backup_codes": raw_codes}


@app.post("/auth/stepup/email/request")
def request_stepup_email_code(
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _check_rate_limit(request, "stepup-email")
    if not current_user.email:
        raise HTTPException(status_code=400, detail="Tu cuenta no tiene un correo disponible para verificación.")

    code = _generate_stepup_email_code()
    expires_at = datetime.utcnow() + timedelta(minutes=STEPUP_EMAIL_CODE_EXPIRE_MINUTES)
    masked_email = _mask_email_address(current_user.email)

    _invalidate_pending_stepup_email_codes(db, current_user.id)
    email_code = models.StepUpEmailCode(
        user_id=current_user.id,
        code_hash=auth.hash_token(code),
        sent_to_email=current_user.email,
        expires_at=expires_at,
    )
    db.add(email_code)

    try:
        _send_templated_email(
            to_email=current_user.email,
            subject=f"Código temporal de seguridad - {_app_display_name()}",
            template_name="security_stepup_code.html",
            context={
                "user_name": current_user.name or current_user.email,
                "code": code,
                "masked_email": masked_email,
                "expires_minutes": STEPUP_EMAIL_CODE_EXPIRE_MINUTES,
                "year": datetime.utcnow().year,
            },
            from_security=True,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"WARNING stepup email: no se pudo enviar código temporal: {exc}")
        raise HTTPException(status_code=503, detail="No se pudo enviar el código temporal. Intenta nuevamente.")

    _write_audit_log(
        db,
        "stepup_email_requested",
        user_id=current_user.id,
        ip_address=_get_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        metadata={"masked_email": masked_email},
    )
    return {
        "masked_email": masked_email,
        "expires_in": STEPUP_EMAIL_CODE_EXPIRE_MINUTES * 60,
    }


@app.post("/auth/stepup/verify", response_model=schemas.StepUpOut)
def stepup_verify(
    payload: dict,
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Eleva el nivel de confianza del usuario para una acción sensible.
    Acepta como prueba:
      - Contraseña actual
      - Código temporal enviado al correo
      - Código TOTP o código de respaldo si MFA está activo
    Devuelve un step-up token válido por 10 minutos.
    """
    payload = payload or {}
    raw_proof = str(payload.get("proof") or "")
    method = str(payload.get("method") or "password").strip().lower()
    normalized_proof = raw_proof.strip()
    if not normalized_proof:
        raise HTTPException(status_code=400, detail="Debes proporcionar una prueba de identidad.")

    verified = False
    failure_detail = "Verificación incorrecta."

    if method == "email_code":
        verified, failure_detail = _verify_stepup_email_code(db, current_user, normalized_proof)
        if not verified:
            _write_audit_log(
                db,
                "stepup_email_failed",
                user_id=current_user.id,
                ip_address=_get_client_ip(request),
                user_agent=request.headers.get("user-agent", ""),
            )

    elif method == "authenticator":
        if not current_user.mfa_enabled or not current_user.mfa_secret:
            raise HTTPException(status_code=400, detail="Tu cuenta no tiene una app autenticadora activa.")
        if auth.verify_totp(current_user.mfa_secret, normalized_proof):
            verified = True
        if not verified and current_user.mfa_backup_codes_json:
            new_codes = auth.verify_backup_code(current_user.mfa_backup_codes_json, normalized_proof)
            if new_codes is not None:
                verified = True
                current_user.mfa_backup_codes_json = new_codes
                db.add(current_user)
                db.commit()
        if not verified:
            failure_detail = "El código del autenticador o de respaldo no es válido."

    else:
        if auth.verify_password(raw_proof, current_user.password_hash):
            verified = True
        elif raw_proof != normalized_proof and auth.verify_password(normalized_proof, current_user.password_hash):
            verified = True
        else:
            failure_detail = "Tu contraseña actual no coincide."

    if not verified:
        _write_audit_log(db, "stepup_failed", user_id=current_user.id,
                         ip_address=_get_client_ip(request))
        raise HTTPException(status_code=403, detail=failure_detail)

    stepup_token = auth.create_stepup_token(current_user.id)
    _write_audit_log(db, "stepup_granted", user_id=current_user.id,
                     ip_address=_get_client_ip(request),
                     user_agent=request.headers.get("user-agent", ""),
                     metadata={"method": method})
    return {"stepup_token": stepup_token, "expires_in": auth.STEPUP_TOKEN_EXPIRE_MINUTES * 60}


def _check_stepup(request: Request, user: models.User) -> None:
    """
    Verifica que la solicitud incluya un step-up token válido.
    El token debe venir en el header X-StepUp-Token.
    Si falta o es inválido, lanza 403 con detail estructurado para que el frontend
    muestre el modal de step-up.
    """
    token = request.headers.get("X-StepUp-Token", "").strip()
    if not token or not auth.verify_stepup_token(token, user.id):
        raise HTTPException(
            status_code=403,
            detail={"code": "step_up_required",
                    "message": "Esta acción requiere verificación adicional de identidad."},
        )


@app.get("/auth/mfa/status")
def mfa_status(current_user: models.User = Depends(auth.get_current_user)):
    """Devuelve el estado MFA del usuario actual."""
    codes_count = 0
    if current_user.mfa_backup_codes_json:
        try:
            import json as _json
            codes_count = len(_json.loads(current_user.mfa_backup_codes_json))
        except Exception:
            pass
    return {
        "mfa_enabled": bool(current_user.mfa_enabled),
        "backup_codes_remaining": codes_count,
    }


# ─── Refresh token + sesiones ─────────────────────────────────────────────────

@app.post("/auth/token/refresh", response_model=schemas.Token)
def token_refresh(
    payload: schemas.RefreshTokenIn,
    request: Request,
    db: Session = Depends(auth.get_db),
):
    """Rota el refresh token y emite un nuevo access token."""
    result = auth.rotate_refresh_token(
        db,
        payload.refresh_token,
        ip_address=_get_client_ip(request),
        device_label=request.headers.get("user-agent", "")[:200],
    )
    if not result:
        raise HTTPException(status_code=401, detail="Refresh token inválido o expirado")

    new_refresh, user_id = result
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or getattr(user, "deleted", False):
        raise HTTPException(status_code=401, detail="Usuario no válido")

    tv = int(getattr(user, "token_version", 0) or 0)
    access_token = auth.create_access_token({"sub": str(user.id), "tv": tv})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "refresh_token": new_refresh,
    }


@app.get("/auth/sessions")
def list_sessions(
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Lista las sesiones activas del usuario."""
    sessions = (
        db.query(models.RefreshToken)
        .filter(
            models.RefreshToken.user_id == current_user.id,
            models.RefreshToken.revoked.is_(False),
            models.RefreshToken.expires_at > datetime.utcnow(),
        )
        .order_by(models.RefreshToken.created_at.desc())
        .all()
    )
    return [
        {
            "id": s.id,
            "device_label": s.device_label,
            "ip_address": s.ip_address,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "last_used_at": s.last_used_at.isoformat() if s.last_used_at else None,
        }
        for s in sessions
    ]


@app.delete("/auth/sessions/{session_id}")
def revoke_session(
    session_id: int,
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Revoca una sesión específica del usuario."""
    rt = db.query(models.RefreshToken).filter(
        models.RefreshToken.id == session_id,
        models.RefreshToken.user_id == current_user.id,
    ).first()
    if not rt:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    rt.revoked = True
    db.add(rt)
    db.commit()
    _write_audit_log(db, "session_revoked", user_id=current_user.id,
                     ip_address=_get_client_ip(request),
                     metadata={"session_id": session_id})
    return {"ok": True}


@app.delete("/auth/sessions")
def revoke_all_sessions(
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Cierra todas las sesiones activas (logout global)."""
    n = auth.revoke_all_refresh_tokens(db, current_user.id)
    # También incrementar token_version para invalidar access tokens activos
    current_user.token_version = int(getattr(current_user, "token_version", 0) or 0) + 1
    db.add(current_user)
    db.commit()
    _write_audit_log(db, "sessions_revoked_all", user_id=current_user.id,
                     ip_address=_get_client_ip(request),
                     metadata={"count": n})
    return {"ok": True, "revoked": n}


# ─── Permisos granulares por relación familiar ────────────────────────────────

# Permisos válidos para relaciones familiares/cuidadores
VALID_PERMISSIONS = {
    "view_profile",
    "view_medications",
    "edit_medications",
    "view_documents",
    "download_documents",
    "receive_alerts",
    "manage_refills",
}

# Permisos por defecto según rol
_DEFAULT_PERMISSIONS = {
    "viewer": ["view_profile", "view_medications", "view_documents"],
    "caregiver": ["view_profile", "view_medications", "edit_medications",
                  "view_documents", "receive_alerts", "manage_refills"],
    "admin": list(VALID_PERMISSIONS),
}


def _get_profile_permissions(link: models.ProfileRelationship) -> list:
    """Devuelve los permisos efectivos de un enlace, usando defaults si no hay explícitos."""
    if link.permissions_json:
        try:
            import json as _json
            return _json.loads(link.permissions_json)
        except Exception:
            pass
    role = (link.role or "viewer").strip().lower()
    return _DEFAULT_PERMISSIONS.get(role, _DEFAULT_PERMISSIONS["viewer"])


def _check_permission(
    db: Session,
    user: models.User,
    profile_id: int,
    permission: str,
) -> bool:
    """
    Verifica si el usuario tiene un permiso específico sobre un perfil.
    El owner siempre tiene todos los permisos.
    """
    profile = db.query(models.HealthProfile).filter(
        models.HealthProfile.id == profile_id
    ).first()
    if profile and profile.owner_user_id == user.id:
        return True

    link = db.query(models.ProfileRelationship).filter(
        models.ProfileRelationship.profile_id == profile_id,
        models.ProfileRelationship.user_id == user.id,
        models.ProfileRelationship.status == "accepted",
    ).first()
    if not link:
        return False
    return permission in _get_profile_permissions(link)


@app.get("/health-profiles/{profile_id}/permissions")
def get_profile_permissions(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Devuelve los permisos del usuario actual sobre un perfil."""
    profile = db.query(models.HealthProfile).filter(
        models.HealthProfile.id == profile_id
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil no encontrado")

    # Owner: todos los permisos
    if profile.owner_user_id == current_user.id:
        return {"permissions": list(VALID_PERMISSIONS), "role": "owner"}

    link = db.query(models.ProfileRelationship).filter(
        models.ProfileRelationship.profile_id == profile_id,
        models.ProfileRelationship.user_id == current_user.id,
        models.ProfileRelationship.status == "accepted",
    ).first()
    if not link:
        raise HTTPException(status_code=403, detail="Sin acceso a este perfil")

    return {
        "permissions": _get_profile_permissions(link),
        "role": link.role or "viewer",
    }


@app.put("/health-profiles/{profile_id}/relationships/{relationship_id}/permissions")
def update_relationship_permissions(
    profile_id: int,
    relationship_id: int,
    payload: schemas.PermissionsUpdate,
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Actualiza los permisos granulares de una relación familiar.
    Solo el admin del perfil puede hacerlo.
    """
    profile = db.query(models.HealthProfile).filter(
        models.HealthProfile.id == profile_id
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil no encontrado")

    # Verificar que el usuario es admin o owner del perfil
    is_owner = profile.owner_user_id == current_user.id
    if not is_owner:
        admin_link = db.query(models.ProfileRelationship).filter(
            models.ProfileRelationship.profile_id == profile_id,
            models.ProfileRelationship.user_id == current_user.id,
            models.ProfileRelationship.status == "accepted",
        ).first()
        if not admin_link or (admin_link.role or "").lower() not in ("admin", "administrador"):
            raise HTTPException(status_code=403, detail="Solo el administrador puede cambiar permisos")

    link = db.query(models.ProfileRelationship).filter(
        models.ProfileRelationship.id == relationship_id,
        models.ProfileRelationship.profile_id == profile_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Relación no encontrada")

    # Modificar permisos de acceso a datos de salud es una acción sensible: step-up
    _check_stepup(request, current_user)

    # Validar y filtrar permisos
    valid = [p for p in payload.permissions if p in VALID_PERMISSIONS]
    import json as _json
    link.permissions_json = _json.dumps(valid)
    db.add(link)
    db.commit()

    _write_audit_log(
        db, "permissions_updated",
        user_id=current_user.id,
        resource_type="profile_relationship",
        resource_id=relationship_id,
        ip_address=_get_client_ip(request),
        metadata={"profile_id": profile_id, "permissions": valid},
    )
    return {"ok": True, "permissions": valid}


# ─── Audit log endpoint ───────────────────────────────────────────────────────

@app.get("/audit/logs")
def get_audit_logs(
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Devuelve el historial de eventos de seguridad del usuario."""
    logs = (
        db.query(models.AuditLog)
        .filter(models.AuditLog.user_id == current_user.id)
        .order_by(models.AuditLog.created_at.desc())
        .offset(offset)
        .limit(min(limit, 200))
        .all()
    )
    return [
        {
            "id": l.id,
            "action": l.action,
            "resource_type": l.resource_type,
            "resource_id": l.resource_id,
            "ip_address": l.ip_address,
            "created_at": l.created_at.isoformat() if l.created_at else None,
            "metadata": l.metadata_json,
        }
        for l in logs
    ]


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
            _safe_zoneinfo(payload.timezone)
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


@app.get("/public/plans", response_model=List[schemas.PublicPlanOut])
async def read_public_plans():
    return PUBLIC_PLAN_CATALOG


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

    result = []
    seen_ids = set()
    external_owner_ids = set()

    for link in links:
        profile = link.profile
        if not profile:
            continue
        seen_ids.add(profile.id)
        result.append(_profile_out(profile, link))
        # Si el usuario tiene acceso a una primary profile de otro dueño,
        # registrar ese dueño para incluir también sus perfiles secundarios.
        if profile.is_primary_profile and profile.owner_user_id != current_user.id:
            external_owner_ids.add(profile.owner_user_id)

    # Incluir perfiles secundarios de grupos externos (p.ej. hermana en el grupo de mamá)
    if external_owner_ids:
        secondary = (
            db.query(models.HealthProfile)
            .filter(
                models.HealthProfile.owner_user_id.in_(external_owner_ids),
                models.HealthProfile.is_primary_profile.is_(False),
                models.HealthProfile.is_archived.is_(False),
            )
            .order_by(models.HealthProfile.full_name.asc())
            .all()
        )
        for p in secondary:
            if p.id not in seen_ids:
                seen_ids.add(p.id)
                result.append(_profile_out(p, None))

    return result


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
    _mark_profile_ai_dirty(db, profile, include_family=True)

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
    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return _profile_out(profile, link)


@app.post("/health-profiles/{profile_id}/avatar")
async def upload_health_profile_avatar(
    profile_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(link, "admin")

    # Para perfiles primarios, solo el propietario puede cambiar el avatar
    # (evita que un admin externo sobreescriba la foto personal de otra cuenta)
    if profile.is_primary_profile and profile.owner_user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Solo el titular de la cuenta puede cambiar la foto de su perfil principal.",
        )

    data = await file.read()
    if len(data) > 3 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="La imagen no puede superar 3MB")

    mime_type, _ = mimetypes.guess_type(file.filename or "image.jpg")
    mime_type = mime_type or "image/jpeg"
    b64 = base64.b64encode(data).decode("utf-8")
    profile.avatar_url = f"data:{mime_type};base64,{b64}"

    db.add(profile)
    db.commit()
    return {"avatar_url": profile.avatar_url, "profile_id": profile_id}


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
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, access_link = _get_profile_access_or_404(db, current_user, profile_id)
    _assert_collaboration_enabled(current_user, db=db, owner_user_id=profile.owner_user_id)
    _require_role(access_link, "admin")

    role = _normalize_role(payload.role)
    invitee_email = payload.email.lower().strip()
    if not invitee_email:
        raise HTTPException(status_code=400, detail="Email de invitacion es obligatorio")
    if invitee_email == (current_user.email or "").strip().lower():
        raise HTTPException(status_code=400, detail="No puedes invitar tu propio correo")

    existing_user = (
        db.query(models.User)
        .filter(func.lower(models.User.email) == invitee_email)
        .first()
    )
    now = datetime.utcnow()

    if existing_user:
        # Verifica si el invitado ya tiene acceso al perfil que se esta compartiendo.
        existing_link = (
            db.query(models.ProfileRelationship)
            .filter(
                models.ProfileRelationship.profile_id == profile_id,
                models.ProfileRelationship.user_id == existing_user.id,
                models.ProfileRelationship.status == "accepted",
            )
            .first()
        )
        if existing_link:
            raise HTTPException(status_code=409, detail="Ese usuario ya tiene acceso al perfil")

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
        pending.role = role
        pending.relationship_type = payload.relationship_type or pending.relationship_type
        pending.token = pending.token or secrets.token_urlsafe(24)
        pending.invited_at = now
        db.add(pending)
        db.commit()
        db.refresh(pending)
        background_tasks.add_task(
            _send_profile_invitation_email_safe,
            invitee_email,
            current_user.name or current_user.email or "Usuario Klinip",
            profile.full_name or "Perfil de salud",
            role,
            payload.relationship_type or "",
            pending.token,
        )
        if existing_user:
            sent = _send_push_to_user(
                db,
                existing_user.id,
                {
                    "title": "Nueva invitacion familiar",
                    "body": (
                        f"{current_user.name or current_user.email} te invito al perfil "
                        f"{profile.full_name or 'de salud'} con rol {role}."
                    ),
                    "url": "/family",
                    "priority": "high",
                    "sound": "default",
                    "kind": "family-invitation",
                    "profileId": profile_id,
                },
            )
            if sent:
                print(
                    "DEBUG family invitation push: enviado",
                    {"to_user_id": existing_user.id, "sent": sent, "profile_id": profile_id},
                )
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
    background_tasks.add_task(
        _send_profile_invitation_email_safe,
        invitee_email,
        current_user.name or current_user.email or "Usuario Klinip",
        profile.full_name or "Perfil de salud",
        role,
        payload.relationship_type or "",
        invitation.token,
    )
    if existing_user:
        sent = _send_push_to_user(
            db,
            existing_user.id,
            {
                "title": "Nueva invitacion familiar",
                "body": (
                    f"{current_user.name or current_user.email} te invito al perfil "
                    f"{profile.full_name or 'de salud'} con rol {role}."
                ),
                "url": "/family",
                "priority": "high",
                "sound": "default",
                "kind": "family-invitation",
                "profileId": profile_id,
            },
        )
        if sent:
            print(
                "DEBUG family invitation push: enviado",
                {"to_user_id": existing_user.id, "sent": sent, "profile_id": profile_id},
            )
    return invitation


@app.get("/health-profiles/{profile_id}/invitations", response_model=List[schemas.ProfileInvitationOut])
async def list_profile_invitations(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, access_link = _get_profile_access_or_404(db, current_user, profile_id)
    _assert_collaboration_enabled(current_user, db=db, owner_user_id=profile.owner_user_id)
    _require_role(access_link, "admin")
    invitations = (
        db.query(models.ProfileInvitation)
        .filter(models.ProfileInvitation.profile_id == profile_id)
        .order_by(models.ProfileInvitation.invited_at.desc())
        .all()
    )
    return invitations


@app.get("/health-profiles/invitations/my-pending", response_model=List[schemas.PendingProfileInvitationOut])
async def list_my_pending_profile_invitations(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    email = (current_user.email or "").strip().lower()
    if not email:
        return []

    invitations = (
        db.query(models.ProfileInvitation)
        .join(models.HealthProfile, models.HealthProfile.id == models.ProfileInvitation.profile_id)
        .outerjoin(models.User, models.User.id == models.ProfileInvitation.inviter_user_id)
        .filter(
            func.lower(models.ProfileInvitation.invitee_email) == email,
            models.ProfileInvitation.status == "pending",
            models.HealthProfile.is_archived.is_(False),
        )
        .order_by(models.ProfileInvitation.invited_at.desc())
        .all()
    )

    output = []
    for inv in invitations:
        output.append(
            schemas.PendingProfileInvitationOut(
                id=inv.id,
                profile_id=inv.profile_id,
                profile_name=(inv.profile.full_name if inv.profile else f"Perfil #{inv.profile_id}"),
                inviter_user_id=inv.inviter_user_id,
                inviter_name=(inv.inviter_user.name if inv.inviter_user else ""),
                invitee_email=inv.invitee_email,
                role=inv.role or "viewer",
                relationship_type=inv.relationship_type or "",
                status=inv.status or "pending",
                token=inv.token,
                invited_at=inv.invited_at or datetime.utcnow(),
            )
        )
    return output


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

    role = _normalize_role(invitation.role)
    now = datetime.utcnow()
    inviter_user = (
        db.query(models.User)
        .filter(models.User.id == invitation.inviter_user_id)
        .first()
    )
    if not inviter_user:
        raise HTTPException(status_code=404, detail="Usuario que invita no disponible")

    invited_profile = (
        db.query(models.HealthProfile)
        .filter(
            models.HealthProfile.id == invitation.profile_id,
            models.HealthProfile.is_archived.is_(False),
        )
        .first()
    )
    if not invited_profile:
        raise HTTPException(status_code=404, detail="Perfil de salud no disponible")

    link = (
        db.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.profile_id == invited_profile.id,
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
            profile_id=invited_profile.id,
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
    _log_profile_activity(
        db,
        profile_id=invited_profile.id,
        actor_user_id=current_user.id,
        action_type="invitation_accepted",
        description=f"{current_user.name or current_user.email} acepto invitacion para colaborar en el perfil de {inviter_user.name or inviter_user.email}",
        metadata_json={"role": role, "email": current_user.email, "inviter_user_id": inviter_user.id},
    )
    _mark_profile_ai_dirty(db, invited_profile, include_family=True)
    db.commit()
    db.refresh(link)

    invited_role = _normalize_role(link.role)
    invited_profile_name = invited_profile.full_name or "Perfil de salud"
    inviter_display = inviter_user.name or inviter_user.email or "Usuario Klinip"
    invitee_display = current_user.name or current_user.email or "Usuario Klinip"

    sent_invitee = _send_push_to_user(
        db,
        current_user.id,
        {
            "title": "Invitacion aceptada",
            "body": f"Ya puedes colaborar en {invited_profile_name} con rol {invited_role}.",
            "url": "/family",
            "priority": "high",
            "sound": "default",
            "kind": "family-invitation-accepted",
            "profileId": invited_profile.id,
            "role": invited_role,
        },
    )
    sent_inviter = _send_push_to_user(
        db,
        inviter_user.id,
        {
            "title": "Invitacion aceptada",
            "body": (
                f"{invitee_display} acepto tu invitacion y ya esta vinculado a "
                f"{invited_profile_name} con rol {invited_role}."
            ),
            "url": "/family",
            "priority": "high",
            "sound": "default",
            "kind": "family-invitation-accepted",
            "profileId": invited_profile.id,
            "role": invited_role,
        },
    )
    if sent_invitee or sent_inviter:
        print(
            "DEBUG family invitation accepted push: enviado",
            {
                "profile_id": invited_profile.id,
                "sent_invitee": sent_invitee,
                "sent_inviter": sent_inviter,
                "inviter": inviter_display,
            },
        )
    return _relationship_out(link)


@app.put("/health-profiles/{profile_id}/relationships/{relationship_id}", response_model=schemas.ProfileRelationshipOut)
async def update_profile_relationship(
    profile_id: int,
    relationship_id: int,
    payload: schemas.ProfileRoleUpdateIn,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, access_link = _get_profile_access_or_404(db, current_user, profile_id)
    _assert_collaboration_enabled(current_user, db=db, owner_user_id=profile.owner_user_id)
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
    if link.profile:
        _mark_profile_ai_dirty(db, link.profile, include_family=True)
    db.commit()
    db.refresh(link)
    return _relationship_out(link)


@app.delete("/health-profiles/{profile_id}/relationships/{relationship_id}")
async def remove_profile_relationship(
    profile_id: int,
    relationship_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, access_link = _get_profile_access_or_404(db, current_user, profile_id)
    _assert_collaboration_enabled(current_user, db=db, owner_user_id=profile.owner_user_id)
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
    removed_user_id = link.user_id
    removed_profile_name = link.profile.full_name if link.profile else f"Perfil #{profile_id}"
    remover_name = current_user.name or current_user.email or "Administrador"
    db.delete(link)
    _log_profile_activity(
        db,
        profile_id=profile_id,
        actor_user_id=current_user.id,
        action_type="caregiver_removed",
        description=f"{current_user.name or current_user.email} removio colaborador {email or link.user_id}",
        metadata_json={"relationship_id": relationship_id, "email": email},
    )
    if link.profile:
        _mark_profile_ai_dirty(db, link.profile, include_family=True)
    db.commit()
    if email:
        background_tasks.add_task(
            _send_profile_access_removed_email_safe,
            email,
            remover_name,
            removed_profile_name,
        )
    sent = _send_push_to_user(
        db,
        removed_user_id,
        {
            "title": "Acceso removido",
            "body": (
                f"{remover_name} te quito del perfil {removed_profile_name}. "
                "Ya no podrás ver ni editar su información."
            ),
            "url": "/family",
            "priority": "high",
            "sound": "default",
            "kind": "family-access-removed",
            "profileId": profile_id,
        },
    )
    if sent:
        print(
            "DEBUG family access removed push: enviado",
            {"removed_user_id": removed_user_id, "profile_id": profile_id, "sent": sent},
        )
    return {"ok": True}


@app.delete("/health-profiles/{profile_id}/invitations/{invitation_id}")
async def revoke_profile_invitation(
    profile_id: int,
    invitation_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, access_link = _get_profile_access_or_404(db, current_user, profile_id)
    _assert_collaboration_enabled(current_user, db=db, owner_user_id=profile.owner_user_id)
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

    removed_user_id = None
    if invitation.status == "accepted":
        invitee_user = (
            db.query(models.User)
            .filter(func.lower(models.User.email) == (invitation.invitee_email or "").strip().lower())
            .first()
        )
        invitee_user_id = invitee_user.id if invitee_user else invitation.accepted_by_user_id
        removed_user_id = invitee_user_id
        if not invitee_user_id:
            raise HTTPException(status_code=400, detail="No se pudo resolver el usuario invitado")
        granted_link = (
            db.query(models.ProfileRelationship)
            .filter(
                models.ProfileRelationship.profile_id == profile_id,
                models.ProfileRelationship.user_id == invitee_user_id,
            )
            .first()
        )
        if granted_link:
            db.delete(granted_link)
    elif invitation.status not in ("pending",):
        raise HTTPException(status_code=400, detail="Esta invitacion ya no puede modificarse")

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
    if invitation.profile and removed_user_id:
        _mark_profile_ai_dirty(db, invitation.profile, include_family=True)
    db.commit()
    db.refresh(invitation)
    profile_name = invitation.profile.full_name if invitation.profile else f"Perfil #{profile_id}"
    remover_name = current_user.name or current_user.email or "Administrador"
    if invitation.status == "revoked" and removed_user_id:
        if invitation.invitee_email:
            background_tasks.add_task(
                _send_profile_access_removed_email_safe,
                invitation.invitee_email,
                remover_name,
                profile_name,
            )
        sent = _send_push_to_user(
            db,
            removed_user_id,
            {
                "title": "Acceso removido",
                "body": (
                    f"{remover_name} revoco tu acceso al perfil {profile_name}. "
                    "Ya no podrás ver ni editar su información."
                ),
                "url": "/family",
                "priority": "high",
                "sound": "default",
                "kind": "family-access-removed",
                "profileId": profile_id,
            },
        )
        if sent:
            print(
                "DEBUG family invitation revoked push: enviado",
                {"removed_user_id": removed_user_id, "profile_id": profile_id, "sent": sent},
            )
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
    profile, link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(link, "caregiver")
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
    allowed_voice_targets = {
        int(item.user_id)
        for item in _voice_allowed_share_targets(db, profile, exclude_user_id=current_user.id)
    }
    for key, value in payload.dict(exclude_unset=True).items():
        if value is not None:
            if key in _PROFILE_AUTOMATION_BOOL_KEYS:
                current[key] = bool(value)
            elif key == "voice_auto_share_recipient_ids":
                current[key] = [
                    user_id
                    for user_id in _normalize_profile_automation_list_int(value)
                    if int(user_id) in allowed_voice_targets
                ]

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
        raise HTTPException(status_code=400, detail="La nota no puede estar vacía")

    raw_color = (payload.color or "yellow").strip().lower()
    safe_color = raw_color if raw_color in schemas.NOTE_COLORS else "yellow"
    item = models.ProfileNote(
        profile_id=profile_id,
        created_by_user_id=current_user.id,
        note=note_text,
        visibility=(payload.visibility or "shared").strip() or "shared",
        color=safe_color,
        reminder_at=payload.reminder_at,
        reminder_sent=False,
    )
    db.add(item)
    _log_profile_activity(
        db,
        profile_id=profile_id,
        actor_user_id=current_user.id,
        action_type="note_added",
        description=f"{current_user.name or current_user.email} agregó una nota del perfil",
        metadata_json={
            "visibility": item.visibility,
            "note_preview": _clip_text(note_text, 160),
        },
    )
    db.commit()
    db.refresh(item)
    return _profile_note_out(item)


@app.put("/health-profiles/{profile_id}/notes/{note_id}", response_model=schemas.ProfileNoteOut)
async def update_profile_note(
    profile_id: int,
    note_id: int,
    payload: schemas.ProfileNoteUpdate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _, link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(link, "caregiver")
    item = (
        db.query(models.ProfileNote)
        .filter(
            models.ProfileNote.id == note_id,
            models.ProfileNote.profile_id == profile_id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Nota no encontrada")

    updated_note = (payload.note if payload.note is not None else item.note).strip()
    if not updated_note:
        raise HTTPException(status_code=400, detail="La nota no puede estar vacía")

    item.note = updated_note
    if payload.visibility is not None:
        item.visibility = (payload.visibility or "shared").strip() or "shared"
    if payload.color is not None:
        raw_color = payload.color.strip().lower()
        item.color = raw_color if raw_color in schemas.NOTE_COLORS else "yellow"
    if "reminder_at" in (payload.model_fields_set or set()):
        item.reminder_at = payload.reminder_at
        item.reminder_sent = False
    item.updated_at = datetime.now()
    _log_profile_activity(
        db,
        profile_id=profile_id,
        actor_user_id=current_user.id,
        action_type="note_updated",
        description=f"{current_user.name or current_user.email} actualizó una nota del perfil",
        metadata_json={
            "note_id": item.id,
            "visibility": item.visibility,
            "note_preview": _clip_text(updated_note, 160),
        },
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _profile_note_out(item)


@app.delete("/health-profiles/{profile_id}/notes/{note_id}")
async def delete_profile_note(
    profile_id: int,
    note_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _, link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(link, "caregiver")
    item = (
        db.query(models.ProfileNote)
        .filter(
            models.ProfileNote.id == note_id,
            models.ProfileNote.profile_id == profile_id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Nota no encontrada")

    _log_profile_activity(
        db,
        profile_id=profile_id,
        actor_user_id=current_user.id,
        action_type="note_deleted",
        description=f"{current_user.name or current_user.email} eliminó una nota del perfil",
        metadata_json={
            "note_id": item.id,
            "visibility": item.visibility or "shared",
            "note_preview": _clip_text(item.note, 160),
        },
    )
    db.delete(item)
    db.commit()
    return {"ok": True}


@app.post("/ai/chat", response_model=schemas.AiChatResponse)
async def ai_chat(
    payload: schemas.AiChatRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    total_started_at = time.perf_counter()
    message = (payload.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Debes escribir un mensaje.")
    _assert_ai_chat_capacity_available(db, current_user)

    direct_report_request = _extract_direct_report_request(message)
    chat_intent = detect_chat_intent(message)
    context_modules = select_context_modules(chat_intent)
    include_document_text = _should_include_document_text_for_chat(message)
    profile, link, target_user_id = _get_active_profile_context(db, current_user)
    timezone_name = _resolve_user_tz_name(current_user)
    conversation_id = (payload.conversation_id or "").strip()
    if not conversation_id:
        conversation_id = _new_ai_conversation_id()
    conversation_title = ""
    existing_title_item = (
        db.query(models.AiConversationMessage)
        .filter(
            models.AiConversationMessage.profile_id == int(profile.id),
            models.AiConversationMessage.conversation_id == conversation_id,
        )
        .order_by(models.AiConversationMessage.id.asc())
        .first()
    )
    if existing_title_item:
        conversation_title = (existing_title_item.conversation_title or "").strip()
    if not conversation_title:
        conversation_title = _derive_ai_conversation_title(message)
    attachment_payload = _workflow_attachment_payload(payload.attachment)
    has_workflow = _get_ai_conversation_workflow(
        db,
        profile_id=int(profile.id),
        conversation_id=conversation_id,
    )
    detected_workflow_type = (has_workflow.workflow_type or "").strip() if has_workflow else (_detect_chat_creation_target(message) or "")
    if has_workflow or detected_workflow_type:
        try:
            writable_profile, _, writable_target_user_id = _get_active_profile_context(
                db,
                current_user,
                require_write=True,
            )
            if detected_workflow_type != "profile_note":
                _assert_collaboration_enabled(
                    current_user,
                    db=db,
                    owner_user_id=writable_profile.owner_user_id,
                )
        except HTTPException as exc:
            if exc.status_code == 403:
                _clear_ai_conversation_workflow(
                    db,
                    profile_id=int(profile.id),
                    conversation_id=conversation_id,
                )
                detail_text = str(getattr(exc, "detail", "") or "").lower()
                if "plan familiar" in detail_text or "colaboracion familiar" in detail_text:
                    reply = (
                        "La creación asistida desde el chat está disponible solo en el plan familiar "
                        "y sobre perfiles con colaboración habilitada."
                    )
                    mode = "workflow-plan-denied"
                else:
                    reply = "No tienes permisos de edición en el perfil activo para guardar esa información desde el chat."
                    mode = "workflow-permission-denied"
                model_name = "workflow-engine"
                references = []
                user_item = _persist_ai_message(
                    db,
                    profile_id=int(profile.id),
                    user_id=current_user.id,
                    conversation_id=conversation_id,
                    conversation_title=conversation_title,
                    role="user",
                    content=message,
                    metadata_json={"mode": "input"},
                )
                assistant_item = _persist_ai_message(
                    db,
                    profile_id=int(profile.id),
                    user_id=current_user.id,
                    conversation_id=conversation_id,
                    conversation_title=conversation_title,
                    role="assistant",
                    content=reply,
                    metadata_json={"model": model_name, "mode": mode, "references": references},
                )
                return {
                    "reply": reply,
                    "disclaimer": AI_KLINIP_DISCLAIMER,
                    "model": model_name,
                    "mode": mode,
                    "active_profile_id": int(profile.id),
                    "active_profile_name": profile.full_name or "",
                    "sources": [],
                    "references": references,
                    "user_message_created_at": _safe_iso_client(user_item.created_at, timezone_name),
                    "assistant_message_created_at": _safe_iso_client(assistant_item.created_at, timezone_name),
                    "conversation_id": conversation_id,
                    "conversation_title": conversation_title,
                }
            raise
        workflow_result = _handle_chat_creation_workflow(
            db,
            current_user=current_user,
            profile=writable_profile,
            target_user_id=writable_target_user_id,
            conversation_id=conversation_id,
            message=message,
            timezone_name=timezone_name,
            attachment_payload=attachment_payload,
            background_tasks=background_tasks,
        )
        if workflow_result.get("handled"):
            reply = workflow_result.get("reply") or "No pude completar esa acción desde el chat."
            model_name = workflow_result.get("model_name") or "workflow-engine"
            mode = workflow_result.get("mode") or "workflow"
            references = workflow_result.get("references") or []
            user_item = _persist_ai_message(
                db,
                profile_id=int(profile.id),
                user_id=current_user.id,
                conversation_id=conversation_id,
                conversation_title=conversation_title,
                role="user",
                content=message,
                metadata_json={"mode": "input"},
            )
            assistant_item = _persist_ai_message(
                db,
                profile_id=int(profile.id),
                user_id=current_user.id,
                conversation_id=conversation_id,
                conversation_title=conversation_title,
                role="assistant",
                content=reply,
                metadata_json={"model": model_name, "mode": mode, "references": references},
            )
            return {
                "reply": reply,
                "disclaimer": AI_KLINIP_DISCLAIMER,
                "model": model_name,
                "mode": mode,
                "active_profile_id": int(profile.id),
                "active_profile_name": profile.full_name or "",
                "sources": [],
                "references": references,
                "user_message_created_at": _safe_iso_client(user_item.created_at, timezone_name),
                "assistant_message_created_at": _safe_iso_client(assistant_item.created_at, timezone_name),
                "conversation_id": conversation_id,
                "conversation_title": conversation_title,
            }
    include_family_context = _should_include_family_context_for_chat(
        db,
        current_user,
        message,
        preferred_owner_user_id=target_user_id,
    )
    if not include_family_context:
        context_modules["family"] = False
    if direct_report_request:
        context_modules["appointments"] = True
        context_modules["documents"] = True
        context_modules["document_summaries"] = True
        context_modules["medications"] = True
        context_modules["adherence"] = True
        if direct_report_request.get("report_type") == "resumen_familiar" and include_family_context:
            context_modules["family"] = True
    profile_id = int(profile.id)
    limiter = _chat_profile_limiter(profile_id)
    limiter_acquired = limiter.acquire(blocking=False)
    degraded_busy = not limiter_acquired
    if degraded_busy:
        context_modules = select_context_modules("general")
        include_family_context = False
        include_document_text = False
        direct_report_request = None
    try:
        context, timing_info = _build_chat_context_base(
            db,
            current_user,
            profile,
            link,
            target_user_id,
            message=message,
            conversation_id=conversation_id,
            intent=chat_intent,
            modules=context_modules,
            include_family_context=include_family_context,
            include_document_text=include_document_text,
        )
        timing_info.setdefault("openai_ms", 0.0)

        # Auditar uso de documentos por IA (qué documentos se exponen como contexto)
        if context_modules.get("documents"):
            ctx_docs = context.get("documents") or []
            ctx_chunks = context.get("document_chunks") or []
            if ctx_docs or ctx_chunks:
                _write_audit_log(
                    db, "ai_context_documents_used",
                    user_id=current_user.id,
                    resource_type="document",
                    metadata={
                        "profile_id": int(profile.id),
                        "document_ids": [d.id for d in ctx_docs if hasattr(d, "id")],
                        "count": len(ctx_docs),
                        "chunk_document_ids": sorted(
                            {
                                int(item.get("document_id") or 0)
                                for item in ctx_chunks
                                if int(item.get("document_id") or 0) > 0
                            }
                        ),
                        "chunk_ids": [int(item.get("chunk_id") or 0) for item in ctx_chunks if int(item.get("chunk_id") or 0) > 0],
                        "chunk_count": len(ctx_chunks),
                        "conversation_id": conversation_id,
                    },
                )

        if degraded_busy:
            current_reasons = list(context.get("degraded_reasons") or [])
            current_reasons.append("busy-profile")
            context["degraded_reasons"] = list(dict.fromkeys(current_reasons))
            timing_info["degraded_reasons"] = list(context["degraded_reasons"])
        timezone_name = context.get("timezone_name") or getattr(current_user, "timezone", None) or DEFAULT_TZ_NAME
        existing_items = []
        if conversation_id:
            existing_items = _safe_ai_context_query(
                db,
                module_name="conversation-history",
                loader=lambda: _get_ai_conversation_messages(
                    db,
                    profile_id=profile_id,
                    conversation_id=conversation_id,
                    limit=80,
                ),
                default_value=[],
                degraded_reasons=context["degraded_reasons"],
                statement_timeout_ms=_ai_db_statement_timeout_ms(),
                observability=timing_info,
            )
            if existing_items:
                conversation_title = (existing_items[0].conversation_title or "").strip()
        if not conversation_title:
            conversation_title = _derive_ai_conversation_title(message)

        history = []
        seen_pairs: set[tuple[str, str]] = set()
        for item in existing_items:
            content_value = (item.content or "").strip()
            role_value = (item.role or "").strip().lower()
            if not content_value:
                continue
            key = (role_value, content_value)
            history.append({"role": role_value, "content": content_value})
            seen_pairs.add(key)
        for item in (payload.history or []):
            content_value = (item.content or "").strip()
            role_value = (item.role or "").strip().lower()
            if not content_value:
                continue
            key = (role_value, content_value)
            if key in seen_pairs:
                continue
            history.append({"role": role_value, "content": content_value})
            seen_pairs.add(key)
        # --- Lectura inteligente de documentos adjuntos en chat ---
        # Si el usuario adjuntó un archivo directamente en el chat (y no fue manejado
        # por workflow), extrae el texto OCR de forma sincrónica y lo inyecta en el
        # contexto de la IA. El guardado en DB se delega a background_tasks.
        if attachment_payload and not degraded_busy:
            chat_ocr_text, chat_doc_type = _extract_chat_attachment_ocr(attachment_payload)
            if chat_ocr_text:
                context["chat_attachment_text"] = chat_ocr_text
                context["chat_attachment_filename"] = attachment_payload.get("filename") or ""
                context["chat_attachment_doc_type"] = chat_doc_type
                include_document_text = True  # forzar inclusión de OCR en contexto
                background_tasks.add_task(
                    _save_document_from_chat_attachment,
                    db,
                    user_id=int(target_user_id),
                    attachment_payload=attachment_payload,
                    ocr_text=chat_ocr_text,
                    doc_type_inferred=chat_doc_type,
                    profile=profile,
                )

        family_access_request = _message_asks_family_access(message)
        cache_hit = False
        structured_hit = False
        cache_key = (
            f"{profile_id}:{chat_intent}:{_build_context_fingerprint(context)}:{_normalize_text(message)}"
            if not attachment_payload and not degraded_busy and not direct_report_request
            else ""
        )
        if family_access_request:
            references = _build_ai_references(message, context)
            reply = _build_family_access_reply(context)
            model_name = "access-policy"
            mode = "family-access"
            timing_info["openai_ms"] = 0.0
            timing_info["prompt_history_messages"] = 0
            timing_info["conversation_summary_chars"] = 0
        elif direct_report_request and context.get("degraded_reasons"):
            references = _build_ai_references(message, context)
            reply = _prepend_degraded_notice(
                "Todavia no genero el reporte porque faltan algunos datos secundarios. "
                "Intenta nuevamente en unos segundos.",
                context,
            )
            model_name = "context-fallback"
            mode = "degraded-report-wait"
            timing_info["openai_ms"] = 0.0
            timing_info["prompt_history_messages"] = 0
            timing_info["conversation_summary_chars"] = 0
        elif direct_report_request:
            reply, model_name, mode, references = _generate_direct_chat_report(
                db=db,
                current_user=current_user,
                context=context,
                message=message,
            )
            timing_info["openai_ms"] = 0.0
        elif degraded_busy:
            references = _build_ai_references(message, context)
            reply = _prepend_degraded_notice(
                _sanitize_ai_reply(_fallback_ai_reply(message, context)),
                context,
            )
            model_name = "context-fallback"
            mode = "degraded-busy"
            timing_info["prompt_history_messages"] = 0
            timing_info["conversation_summary_chars"] = 0
        else:
            cached_payload = _cached_ai_reply_get(cache_key)
            if cached_payload:
                references = _build_ai_references(message, context)
                reply = _prepend_degraded_notice(
                    _sanitize_ai_reply(cached_payload.get("reply") or ""),
                    context,
                )
                model_name = cached_payload.get("model_name") or "structured-memory-cache"
                mode = "structured-cache"
                cache_hit = True
                structured_hit = bool(cached_payload.get("structured_hit", True))
                timing_info["openai_ms"] = 0.0
                timing_info["prompt_history_messages"] = 0
                timing_info["conversation_summary_chars"] = 0
            else:
                structured_result = _maybe_resolve_structured_ai_query(message, context)
                if structured_result:
                    reply, model_name, mode = structured_result
                    references = _build_ai_references(message, context)
                    structured_hit = True
                    timing_info["openai_ms"] = 0.0
                    timing_info["prompt_history_messages"] = 0
                    timing_info["conversation_summary_chars"] = 0
                    _cached_ai_reply_put(
                        cache_key,
                        {
                            "reply": reply,
                            "model_name": model_name,
                            "structured_hit": True,
                        },
                    )
                else:
                    reply, model_name, mode, references = _build_ai_reply(message, history, context, timing_info=timing_info)
        user_item = _persist_ai_message(
            db,
            profile_id=profile_id,
            user_id=current_user.id,
            conversation_id=conversation_id,
            conversation_title=conversation_title,
            role="user",
            content=message,
            metadata_json={"mode": "input"},
        )
        assistant_item = _persist_ai_message(
            db,
            profile_id=profile_id,
            user_id=current_user.id,
            conversation_id=conversation_id,
            conversation_title=conversation_title,
            role="assistant",
            content=reply,
            metadata_json={"model": model_name, "mode": mode, "references": references},
        )
        try:
            combined_history = history + [
                {"role": "user", "content": message},
                {"role": "assistant", "content": reply},
            ]
            _upsert_conversation_summary(
                db,
                profile_id=profile_id,
                user_id=current_user.id,
                conversation_id=conversation_id,
                event_type=chat_intent,
                mode=mode,
                history=combined_history[:-2],
                latest_user_message=message,
                latest_reply=reply,
                last_message_id=int(getattr(assistant_item, "id", 0) or 0) or None,
            )
            prompt_chars = int(timing_info.get("prompt_system_chars", 0) or 0) + len(message)
            output_chars = len(reply or "")
            _persist_ai_query_metric(
                db,
                user_id=current_user.id,
                profile_id=profile_id,
                conversation_id=conversation_id,
                query_type=chat_intent,
                model=model_name,
                provider="openai" if mode == "openai" else ("cache" if cache_hit else "backend"),
                mode=mode,
                used_llm=bool(mode == "openai"),
                cache_hit=cache_hit,
                structured_hit=structured_hit,
                history_messages=int(timing_info.get("prompt_history_messages", 0) or 0),
                chunk_count=len(context.get("document_chunks") or []),
                input_chars=len(message),
                context_chars=int(timing_info.get("prompt_context_chars", 0) or 0),
                output_chars=output_chars,
                prompt_tokens_estimate=max(0, math.ceil(max(0, prompt_chars) / 4)),
                output_tokens_estimate=_estimate_token_count(reply),
                metadata_json={
                    "degraded_reasons": list(context.get("degraded_reasons") or []),
                    "prompt_profile": timing_info.get("prompt_profile") or "",
                    "memory_summary_count": int(timing_info.get("memory_summary_count", 0) or 0),
                    "document_chunk_ids": [int(item.get("chunk_id") or 0) for item in (context.get("document_chunks") or [])],
                },
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            print(f"WARNING ai_chat memory persistence failed: {exc}")
        timing_info["total_ms"] = round((time.perf_counter() - total_started_at) * 1000, 1)
        db_modules = timing_info.get("db_modules") or {}
        slow_modules = ",".join(
            f"{name}:{value}"
            for name, value in sorted(
                db_modules.items(),
                key=lambda item: float(item[1] or 0),
                reverse=True,
            )[:5]
        ) or "none"
        print(
            "INFO ai_chat_timing "
            f"profile {profile_id}: "
            f"db_load_ms={timing_info.get('db_load_ms', 0)} "
            f"context_build_ms={timing_info.get('context_build_ms', 0)} "
            f"chat_context_ms={timing_info.get('chat_context_ms', 0)} "
            f"db_query_ms={timing_info.get('db_query_ms', 0)} "
            f"db_query_count={timing_info.get('db_query_count', 0)} "
            f"rollback_count={timing_info.get('rollback_count', 0)} "
            f"openai_ms={timing_info.get('openai_ms', 0)} "
            f"total_ms={timing_info.get('total_ms', 0)} "
            f"db_statement_timeout_ms={timing_info.get('db_statement_timeout_ms', 0)} "
            f"context_timeout_ms={timing_info.get('context_timeout_ms', 0)} "
            f"prompt_history_messages={timing_info.get('prompt_history_messages', 0)} "
            f"conversation_summary_chars={timing_info.get('conversation_summary_chars', 0)} "
            f"prompt_profile={timing_info.get('prompt_profile', 'n/a')} "
            f"prompt_context_chars={timing_info.get('prompt_context_chars', 0)} "
            f"prompt_system_chars={timing_info.get('prompt_system_chars', 0)} "
            f"slow_db_modules={slow_modules} "
            f"intent={chat_intent} "
            f"modules={','.join(sorted(key for key, enabled in context_modules.items() if enabled)) or 'base'} "
            f"family_context={'yes' if include_family_context else 'no'} "
            f"document_text={'yes' if include_document_text else 'no'} "
            f"degraded={'yes' if bool(context.get('degraded_reasons')) else 'no'} "
            f"degraded_reasons={','.join(context.get('degraded_reasons') or []) or 'none'} "
            f"mode={mode}"
        )
        return {
            "reply": reply,
            "disclaimer": AI_KLINIP_DISCLAIMER,
            "model": model_name,
            "mode": mode,
            "active_profile_id": profile_id,
            "active_profile_name": context["profile"]["name"],
            "sources": context["sources"],
            "references": references,
            "user_message_created_at": _safe_iso_client(user_item.created_at, timezone_name),
            "assistant_message_created_at": _safe_iso_client(assistant_item.created_at, timezone_name),
            "conversation_id": conversation_id,
            "conversation_title": conversation_title,
        }
    except Exception as exc:
        failure_total_ms = round((time.perf_counter() - total_started_at) * 1000, 1)
        print(
            "ERROR ai_chat_failure "
            f"profile {profile_id}: "
            f"intent={chat_intent} "
            f"conversation_id={conversation_id or 'new'} "
            f"total_ms={failure_total_ms} "
            f"db_query_ms={timing_info.get('db_query_ms', 0) if 'timing_info' in locals() else 0} "
            f"prompt_profile={timing_info.get('prompt_profile', 'n/a') if 'timing_info' in locals() else 'n/a'} "
            f"prompt_context_chars={timing_info.get('prompt_context_chars', 0) if 'timing_info' in locals() else 0} "
            f"error={exc}"
        )
        raise
    finally:
        if limiter_acquired:
            limiter.release()


@app.post("/ai/chat/transcribe", response_model=schemas.AiChatTranscriptionOut)
async def ai_chat_transcribe(
    request: Request,
    file: UploadFile = File(...),
    current_user: models.User = Depends(auth.get_current_user),
):
    _check_rate_limit(request, "ai-transcribe")
    _ = current_user

    file_content = await file.read()
    _detected_mime, safe_filename = _validate_ai_audio_upload(
        file_content,
        file.filename or "nota-voz.webm",
        file.content_type,
    )
    transcription = _transcribe_ai_audio(file_content, safe_filename)
    if not transcription:
        raise HTTPException(
            status_code=503,
            detail="La transcripción de voz no está disponible en este momento.",
        )

    transcript_text, model_name = transcription
    if not transcript_text:
        raise HTTPException(
            status_code=422,
            detail="No pude identificar una voz clara en el audio. Intenta grabar de nuevo.",
        )

    return {
        "transcript": transcript_text,
        "model": model_name,
        "language": "es",
    }


# ── Klinip Voice ───────────────────────────────────────────────────────────


_VOICE_AUDIO_MAX_BYTES = 500 * 1024 * 1024  # 500 MB — sin límite práctico para consultas largas
_VOICE_UPLOAD_DIR = os.environ.get(
    "VOICE_UPLOAD_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads", "voice"),
)
_VOICE_PROFESSIONAL_ROLE_CATALOG = {
    "medico": {
        "label": "Médico",
        "can_issue_medical_diagnosis": True,
        "source_hint": "profesional confirmado por el usuario",
    },
    "kinesiologo": {
        "label": "Kinesiólogo",
        "can_issue_medical_diagnosis": False,
        "source_hint": "profesional confirmado por el usuario",
    },
    "fonoaudiologo": {
        "label": "Fonoaudiólogo",
        "can_issue_medical_diagnosis": False,
        "source_hint": "profesional confirmado por el usuario",
    },
    "psicologo": {
        "label": "Psicólogo",
        "can_issue_medical_diagnosis": False,
        "source_hint": "profesional confirmado por el usuario",
    },
    "nutricionista": {
        "label": "Nutricionista",
        "can_issue_medical_diagnosis": False,
        "source_hint": "profesional confirmado por el usuario",
    },
    "terapeuta_ocupacional": {
        "label": "Terapeuta ocupacional",
        "can_issue_medical_diagnosis": False,
        "source_hint": "profesional confirmado por el usuario",
    },
    "enfermeria": {
        "label": "Profesional de enfermería",
        "can_issue_medical_diagnosis": False,
        "source_hint": "profesional confirmado por el usuario",
    },
    "otro": {
        "label": "Otro profesional de salud",
        "can_issue_medical_diagnosis": False,
        "source_hint": "profesional confirmado por el usuario",
    },
    "no_identificado": {
        "label": "Profesional de salud no identificado",
        "can_issue_medical_diagnosis": False,
        "source_hint": "rol no confirmado por el usuario",
    },
}


def _resolve_voice_professional_role(role_value: str | None) -> dict:
    normalized = _normalize_text(role_value or "").replace(" ", "_")
    role_info = _VOICE_PROFESSIONAL_ROLE_CATALOG.get(normalized)
    if role_info:
        return {"key": normalized, **role_info}
    return {"key": "no_identificado", **_VOICE_PROFESSIONAL_ROLE_CATALOG["no_identificado"]}


def _build_voice_prompt_tecnica(role_info: dict) -> str:
    role_label = role_info["label"]
    if role_info["can_issue_medical_diagnosis"]:
        role_rules = (
            "- El profesional confirmado para esta atención es un médico. Puedes consignar diagnóstico médico "
            "solo cuando esté explícitamente dicho en la transcripción.\n"
            "- Si el paciente menciona diagnósticos previos, distínguelos de lo expresado por el profesional actual."
        )
        impression_section = (
            "## DIAGNÓSTICO MÉDICO EXPLÍCITO O IMPRESIÓN CLÍNICA\n"
            "[Diagnóstico mencionado por el médico o impresión clínica explícita. "
            'Si no existe, escribir "No registrado en la consulta"]'
        )
    else:
        role_rules = (
            f"- El profesional confirmado para esta atención es: {role_label}. "
            "No lo llames médico, doctor o doctora salvo que la transcripción mencione de forma explícita a otro médico.\n"
            "- NO inventes ni redactes diagnósticos médicos propios para esta atención.\n"
            "- Si el paciente relata un diagnóstico previo dado por un médico, regístralo solo como antecedente referido "
            "por el paciente o antecedente previo, nunca como diagnóstico emitido en esta atención.\n"
            "- Para profesiones no médicas, prioriza hallazgos funcionales, evaluación del profesional, objetivos terapéuticos, "
            "ejercicios, cuidados, educación, seguimiento y derivaciones."
        )
        impression_section = (
            "## HALLAZGOS E IMPRESIÓN DEL PROFESIONAL\n"
            "[Hallazgos, evaluación funcional, objetivos terapéuticos o impresión explícita del profesional. "
            'No redactes diagnóstico médico inferido. Si no hay contenido suficiente, escribir "No registrado en la consulta"]'
        )

    return f"""\
Eres un asistente experto en documentación clínica y terapéutica de atenciones de salud en español latinoamericano.

Se te entrega la transcripción automática de una atención real entre un profesional de salud y un paciente/usuario.
Profesional confirmado por el usuario: {role_label} ({role_info["source_hint"]}).

REGLAS ESTRICTAS:
- Fidelidad absoluta: no agregues diagnósticos, medicamentos ni indicaciones que no estén en la transcripción
- Si una sección no tiene información suficiente, escribe "No registrado en la consulta"
- Corrige errores obvios de transcripción automática sin alterar el sentido clínico o terapéutico
- Distingue con claridad al profesional de salud del paciente/usuario
- Solo usa "médico", "doctor" o "doctora" si el contexto confirmado es médico o si la transcripción lo dice de forma explícita
- Si hay marcadores [PAUSA Xm Ys] en la transcripción, respétalos como discontinuidades temporales reales de la atención
- Usa terminología clínica estándar, pero sin adjudicar competencias que el rol profesional no tiene
{role_rules}

FORMATO DE SALIDA — usa exactamente estas secciones:

## DATOS DE LA ATENCIÓN
Tipo de atención: [consulta / terapia / control / evaluación / seguimiento / urgencia / otro — inferir del contexto]
Profesional: [{role_label}]
Duración estimada: [inferir del contenido]

## MOTIVO DE CONSULTA
[Razón principal por la que el paciente/usuario consulta, sin agregar interpretación no mencionada]

## ANTECEDENTES Y RELATO DEL PACIENTE/USUARIO
[Síntomas, antecedentes, evolución del cuadro, preocupaciones o contexto referido por la persona atendida]

## EVALUACIÓN O INTERVENCIÓN DEL PROFESIONAL
[Hallazgos, observaciones, maniobras, educación, ejercicios, indicaciones verbales y evaluación realizada por el profesional]

## EXAMEN FÍSICO Y SIGNOS REGISTRADOS
[Hallazgos objetivos o signos mencionados. Si no hay, escribir "No registrado en la consulta"]

{impression_section}

## PLAN DE MANEJO
### Farmacológico
[Medicamentos mencionados, solo si fueron indicados explícitamente]
### No farmacológico
[Ejercicios, reposo, cuidados, educación, dieta, adaptación funcional u otras indicaciones]
### Exámenes solicitados
[Exámenes o evaluaciones complementarias solicitadas]
### Derivaciones
[Interconsultas, derivaciones o sugerencia de evaluación por otro profesional]

## PRÓXIMOS PASOS
[Seguimiento, controles, retorno, signos de alarma o próximas acciones]

## OBSERVACIONES
[Información relevante no categorizada en las secciones anteriores]"""


def _build_voice_prompt_simple(role_info: dict) -> str:
    role_label = role_info["label"]
    if role_info["can_issue_medical_diagnosis"]:
        role_rules = (
            "- Puedes mencionar diagnóstico solo cuando el reporte técnico lo consigne explícitamente como diagnóstico médico.\n"
            "- Mantén la diferencia entre lo dicho por el médico y lo referido por el paciente."
        )
    else:
        role_rules = (
            f"- El profesional confirmado en esta atención es {role_label}. No lo llames médico, doctor o doctora.\n"
            "- No uses frases como 'diagnosticó', 'el médico encontró' o equivalentes para esta atención.\n"
            "- Si aparece un diagnóstico previo en el reporte, preséntalo solo como antecedente comentado o diagnóstico previo, "
            "no como conclusión emitida en esta atención.\n"
            "- Explica lo que observó, trabajó o indicó el profesional, distinguiéndolo de lo que sintió o relató el paciente/usuario."
        )

    return f"""\
Eres el asistente de salud de Klinip. Tu rol es traducir una atención de salud técnica a lenguaje claro y humano para el paciente y su familia.

Profesional confirmado por el usuario: {role_label}.

REGLAS ESTRICTAS:
- Usa lenguaje simple, cálido y directo
- No uses términos técnicos sin explicarlos
- Fidelidad absoluta: no inventes indicaciones, hallazgos ni diagnósticos que no estén en el reporte
- Si algo no está claro en el reporte, no lo incluyas
- Tono: orientador, nunca alarmista
- Español latinoamericano neutro
- Diferencia siempre entre lo dicho por el profesional y lo referido por el paciente/usuario
{role_rules}

TAREA 1 — resumen_simple:
Escribe un resumen en 2-4 párrafos cortos que explique:
(a) por qué fue el paciente/usuario
(b) qué observó, explicó o indicó el profesional
(c) qué debe hacer ahora
Máximo 200 palabras. Párrafos separados por \\n\\n.

TAREA 2 — indicaciones:
Extrae TODAS las indicaciones concretas del reporte.
Para cada indicación:
- texto: descripción clara en lenguaje simple
- tipo: "medicamento" | "control" | "examen" | "dieta" | "ejercicio" | "reposo" | "cuidado" | "otro"
- recordatorio_sugerido: true si tiene fecha, frecuencia o plazo concreto, false si es general
- prioridad: "alta" si es urgente o crítico, "media" si es importante, "baja" si es recomendación
- detalle_recordatorio: string con frecuencia/plazo si aplica, null si no aplica

TAREA 3 — hablantes:
Identifica los fragmentos principales de cada hablante. Máximo 3 fragmentos por hablante.
- profesional: lo más relevante que dijo el profesional tratante
- paciente: síntomas, dudas o contexto más importante del paciente/usuario

TAREA 4 — metadata_clinica:
- tipo_consulta: inferido del contenido
- especialidad_inferida: inferida del lenguaje, respetando el profesional confirmado por el usuario
- profesional_confirmado: "{role_label}"
- puede_diagnosticar_medicamente: {str(role_info["can_issue_medical_diagnosis"]).lower()}
- tiene_diagnostico: true solo si el reporte contiene un diagnóstico médico explícito
- tiene_medicamentos: true/false
- tiene_examenes: true/false
- tiene_derivacion: true/false
- nivel_urgencia: "normal" | "seguimiento" | "urgente"
- pausas_detectadas: número de [PAUSA] encontrados

RESPONDE SOLO EN JSON VÁLIDO con esta estructura exacta — sin texto antes ni después, sin markdown:
{{
  "resumen_simple": "string",
  "indicaciones": [
    {{
      "texto": "string",
      "tipo": "string",
      "recordatorio_sugerido": true,
      "prioridad": "string",
      "detalle_recordatorio": "string | null"
    }}
  ],
  "hablantes": {{
    "profesional": ["string"],
    "paciente": ["string"]
  }},
  "metadata_clinica": {{
    "tipo_consulta": "string",
    "especialidad_inferida": "string",
    "profesional_confirmado": "string",
    "puede_diagnosticar_medicamente": true,
    "tiene_diagnostico": true,
    "tiene_medicamentos": true,
    "tiene_examenes": true,
    "tiene_derivacion": false,
    "nivel_urgencia": "string",
    "pausas_detectadas": 0
  }}
}}"""


def _voice_share_sender_name(user: models.User | None) -> str:
    return (
        (getattr(user, "name", None) or getattr(user, "email", None) or "Usuario Klinip")
        .strip()
    )


def _voice_session_title(session: models.VoiceSession) -> str:
    created = getattr(session, "created_at", None)
    if created:
        return f"Atencion Voice del {created.strftime('%d/%m/%Y %H:%M')}"
    return f"Atencion Voice #{getattr(session, 'id', '')}".strip()


def _voice_share_relationship_map(
    db: Session,
    profile_id: int,
    user_ids: list[int] | None = None,
) -> dict[int, models.ProfileRelationship]:
    query = db.query(models.ProfileRelationship).filter(
        models.ProfileRelationship.profile_id == int(profile_id)
    )
    if user_ids:
        query = query.filter(models.ProfileRelationship.user_id.in_(user_ids))
    rows = query.all()
    mapping: dict[int, models.ProfileRelationship] = {}
    for row in rows:
        mapping[int(row.user_id)] = row
    return mapping


def _voice_family_share_out(
    share: models.VoiceFamilyShare,
    relationship_map: dict[int, models.ProfileRelationship] | None = None,
) -> schemas.VoiceFamilyShareOut:
    relationship_map = relationship_map or {}
    relation = relationship_map.get(int(share.recipient_user_id))
    recipient = getattr(share, "recipient_user", None)
    return schemas.VoiceFamilyShareOut(
        id=share.id,
        recipient_user_id=share.recipient_user_id,
        recipient_name=(getattr(recipient, "name", None) or ""),
        recipient_email=(getattr(recipient, "email", None) or ""),
        relationship_type=(getattr(relation, "relationship_type", None) or ""),
        role=(getattr(relation, "role", None) or "viewer"),
        share_mode=share.share_mode or "manual",
        include_audio=bool(share.include_audio),
        status=share.status or "active",
        shared_at=share.shared_at,
        revoked_at=share.revoked_at,
    )


def _voice_manager_can_access(
    session: models.VoiceSession,
    profile: models.HealthProfile,
    current_user: models.User,
) -> bool:
    return int(current_user.id) in {
        int(getattr(profile, "owner_user_id", 0) or 0),
        int(getattr(session, "user_id", 0) or 0),
    }


def _voice_active_share_for_user(
    db: Session,
    session_id: int,
    user_id: int,
) -> models.VoiceFamilyShare | None:
    return (
        db.query(models.VoiceFamilyShare)
        .filter(
            models.VoiceFamilyShare.voice_session_id == int(session_id),
            models.VoiceFamilyShare.recipient_user_id == int(user_id),
            models.VoiceFamilyShare.status == "active",
        )
        .first()
    )


def _voice_session_family_shares_map(
    db: Session,
    session_ids: list[int],
) -> dict[int, list[models.VoiceFamilyShare]]:
    if not session_ids:
        return {}
    rows = (
        db.query(models.VoiceFamilyShare)
        .filter(models.VoiceFamilyShare.voice_session_id.in_(session_ids))
        .order_by(
            models.VoiceFamilyShare.shared_at.desc(),
            models.VoiceFamilyShare.id.desc(),
        )
        .all()
    )
    grouped: dict[int, list[models.VoiceFamilyShare]] = {}
    for row in rows:
        grouped.setdefault(int(row.voice_session_id), []).append(row)
    return grouped


def _voice_session_out(
    db: Session,
    session: models.VoiceSession,
    profile: models.HealthProfile,
    current_user: models.User,
    active_share: models.VoiceFamilyShare | None = None,
    family_shares_map: dict[int, list[models.VoiceFamilyShare]] | None = None,
    relationship_map: dict[int, models.ProfileRelationship] | None = None,
) -> schemas.VoiceSessionOut:
    is_manager = _voice_manager_can_access(session, profile, current_user)
    shared_rows = []
    if is_manager:
        shared_rows = (family_shares_map or {}).get(int(session.id), [])
    relationship_map = relationship_map or {}
    audio_file_exists = bool(getattr(session, "audio_session", None) and os.path.isfile(session.audio_session))

    if active_share and not is_manager:
        sender_name = (
            active_share.sender_display_name
            or _voice_share_sender_name(getattr(active_share, "sender_user", None))
        )
        return schemas.VoiceSessionOut(
            id=session.id,
            profile_id=session.profile_id,
            created_at=session.created_at,
            audio_session_hash=session.audio_session_hash or "",
            transcripcion_tecnica=None,
            version_simple=(active_share.shared_summary or session.version_simple or ""),
            indicaciones=active_share.shared_indicaciones or session.indicaciones or [],
            hablantes=None,
            metadata_clinica=session.metadata_clinica or {},
            compartido_en=session.compartido_en,
            link_seguro=None,
            link_expira_en=None,
            access_scope="shared",
            shared_at=active_share.shared_at,
            shared_by_name=sender_name,
            received_share_id=active_share.id,
            can_view_technical=False,
            can_manage_family_shares=False,
            audio_available=bool(active_share.include_audio and audio_file_exists),
            family_share_active_count=0,
            family_shares=[],
        )

    manager_scope = "owner" if int(profile.owner_user_id) == int(current_user.id) else "creator"
    family_shares = [
        _voice_family_share_out(item, relationship_map=relationship_map)
        for item in shared_rows
    ]
    family_share_active_count = sum(1 for item in shared_rows if (item.status or "") == "active")
    return schemas.VoiceSessionOut(
        id=session.id,
        profile_id=session.profile_id,
        created_at=session.created_at,
        audio_session_hash=session.audio_session_hash or "",
        transcripcion_tecnica=session.transcripcion_tecnica,
        version_simple=session.version_simple,
        indicaciones=session.indicaciones or [],
        hablantes=session.hablantes or {},
        metadata_clinica=session.metadata_clinica or {},
        compartido_en=session.compartido_en,
        link_seguro=session.link_seguro,
        link_expira_en=session.link_expira_en,
        access_scope=manager_scope,
        shared_at=None,
        shared_by_name=None,
        received_share_id=None,
        can_view_technical=True,
        can_manage_family_shares=True,
        audio_available=audio_file_exists,
        family_share_active_count=family_share_active_count,
        family_shares=family_shares,
    )


def _voice_session_access_context(
    db: Session,
    current_user: models.User,
    session_id: int,
) -> tuple[models.VoiceSession, models.HealthProfile, models.ProfileRelationship, models.VoiceFamilyShare | None, bool]:
    session = (
        db.query(models.VoiceSession)
        .filter(models.VoiceSession.id == int(session_id))
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Sesion de voz no encontrada.")
    profile, link = _get_profile_access_or_404(db, current_user, int(session.profile_id))
    active_share = _voice_active_share_for_user(db, session.id, current_user.id)
    can_manage = _voice_manager_can_access(session, profile, current_user)
    if not can_manage and not active_share:
        raise HTTPException(status_code=404, detail="Sesion de voz no encontrada.")
    return session, profile, link, active_share, can_manage


def _voice_allowed_share_targets(
    db: Session,
    profile: models.HealthProfile,
    exclude_user_id: int | None = None,
) -> list[models.ProfileRelationship]:
    owner_user = db.query(models.User).filter(models.User.id == int(profile.owner_user_id)).first()
    if not _plan_allows_collaboration_for_user(owner_user):
        return []
    query = (
        db.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.profile_id == int(profile.id),
            models.ProfileRelationship.status == "accepted",
        )
        .order_by(models.ProfileRelationship.created_at.asc())
    )
    rows = query.all()
    if exclude_user_id is None:
        return rows
    return [row for row in rows if int(row.user_id) != int(exclude_user_id)]


def _voice_share_targets_out(
    db: Session,
    profile: models.HealthProfile,
    exclude_user_id: int | None = None,
) -> list[schemas.VoiceShareTargetOut]:
    settings = _profile_automation_settings(profile)
    auto_recipient_ids = set(settings.get("voice_auto_share_recipient_ids", []))
    rows = _voice_allowed_share_targets(db, profile, exclude_user_id=exclude_user_id)
    items: list[schemas.VoiceShareTargetOut] = []
    for row in rows:
        user = getattr(row, "user", None)
        items.append(
            schemas.VoiceShareTargetOut(
                user_id=row.user_id,
                user_name=(getattr(user, "name", None) or ""),
                user_email=(getattr(user, "email", None) or ""),
                relationship_type=row.relationship_type or "",
                role=row.role or "viewer",
                is_auto_selected=int(row.user_id) in auto_recipient_ids,
            )
        )
    return items


def _upsert_voice_family_share(
    db: Session,
    session: models.VoiceSession,
    profile: models.HealthProfile,
    sender_user: models.User,
    recipient_user_id: int,
    include_audio: bool,
    share_mode: str,
) -> models.VoiceFamilyShare:
    share = (
        db.query(models.VoiceFamilyShare)
        .filter(
            models.VoiceFamilyShare.voice_session_id == int(session.id),
            models.VoiceFamilyShare.recipient_user_id == int(recipient_user_id),
        )
        .first()
    )
    now = datetime.utcnow()
    if not share:
        share = models.VoiceFamilyShare(
            voice_session_id=session.id,
            profile_id=profile.id,
            sender_user_id=sender_user.id,
            recipient_user_id=int(recipient_user_id),
        )
    share.sender_user_id = sender_user.id
    share.share_mode = (share_mode or "manual").strip().lower() or "manual"
    share.include_audio = bool(include_audio)
    share.message_title = _voice_session_title(session)
    share.sender_display_name = _voice_share_sender_name(sender_user)
    share.shared_summary = (session.version_simple or "").strip()
    share.shared_indicaciones = session.indicaciones or []
    share.status = "active"
    share.shared_at = now
    share.revoked_at = None
    db.add(share)
    return share


def _send_voice_family_share_push(
    db: Session,
    share: models.VoiceFamilyShare,
    profile: models.HealthProfile,
) -> int:
    sender_name = share.sender_display_name or "Tu familia"
    return _send_push_to_user(
        db,
        int(share.recipient_user_id),
        {
            "title": "Nueva atencion compartida",
            "body": (
                f"{sender_name} compartio una atencion de {profile.full_name or 'tu perfil'} "
                "en Klinip Voice."
            ),
            "url": (
                f"/voice?view=shared&profile_id={int(profile.id)}&share_id={int(share.id)}"
            ),
            "priority": "high",
            "sound": "default",
            "kind": "voice-family-share",
            "profileId": int(profile.id),
            "voiceSessionId": int(share.voice_session_id),
            "shareId": int(share.id),
        },
    )


def _apply_voice_family_shares(
    db: Session,
    session: models.VoiceSession,
    profile: models.HealthProfile,
    sender_user: models.User,
    recipient_user_ids: list[int],
    include_audio: bool,
    share_mode: str = "manual",
) -> list[models.VoiceFamilyShare]:
    valid_targets = {
        int(row.user_id)
        for row in _voice_allowed_share_targets(db, profile, exclude_user_id=sender_user.id)
    }
    normalized_ids = [
        user_id
        for user_id in _normalize_profile_automation_list_int(recipient_user_ids)
        if int(user_id) in valid_targets
    ]
    if not normalized_ids:
        return []
    shares = [
        _upsert_voice_family_share(
            db,
            session,
            profile,
            sender_user,
            recipient_user_id=user_id,
            include_audio=include_audio,
            share_mode=share_mode,
        )
        for user_id in normalized_ids
    ]
    db.flush()
    return shares

def _voice_call_ai(
    system_prompt: str,
    message: str,
    max_tokens: int = 2500,
    temperature: float = 0.15,
) -> tuple[str, str] | None:
    """Call OpenAI for Voice clinical processing."""
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key or OpenAI is None:
        return None
    model = _ai_model_name()
    client = OpenAI(api_key=api_key, timeout=120.0)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": message},
    ]
    try:
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        choices = getattr(completion, "choices", None) or []
        if not choices:
            return None
        content = (
            getattr(choices[0].message, "content", "") or ""
        ).strip()
        return (content, model) if content else None
    except Exception as exc:
        print(f"WARNING voice ai call failed: {exc}")
        return None


@app.post("/voice/process", response_model=schemas.VoiceSessionOut)
async def voice_process(
    request: Request,
    audio_consent: UploadFile = File(...),
    audio_session: UploadFile = File(...),
    profile_id: int = Form(...),
    professional_role: str = Form(default=""),
    pause_timestamps: str = Form(default=""),
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _check_rate_limit(request, "ai-transcribe")

    # Validate profile access
    profile, _ = _get_profile_access_or_404(db, current_user, profile_id)

    # Read and validate audio files
    consent_bytes = await audio_consent.read()
    session_bytes = await audio_session.read()

    if not consent_bytes:
        raise HTTPException(status_code=400, detail="El audio de consentimiento está vacío.")
    if not session_bytes:
        raise HTTPException(status_code=400, detail="El audio de la consulta está vacío.")

    _detected_mime_consent, safe_consent = _validate_ai_audio_upload(
        consent_bytes, audio_consent.filename or "consent.webm", audio_consent.content_type,
        max_bytes=_VOICE_AUDIO_MAX_BYTES,
    )
    _detected_mime_session, safe_session = _validate_ai_audio_upload(
        session_bytes, audio_session.filename or "session.webm", audio_session.content_type,
        max_bytes=_VOICE_AUDIO_MAX_BYTES,
    )

    # Hash del audio de sesión
    audio_hash = hashlib.sha256(session_bytes).hexdigest()
    role_info = _resolve_voice_professional_role(professional_role)

    # 1. Transcribir audio de la consulta
    transcription = _transcribe_ai_audio(session_bytes, safe_session)
    if not transcription:
        raise HTTPException(status_code=503, detail="La transcripción de voz no está disponible en este momento.")
    raw_transcript, _whisper_model = transcription
    if not raw_transcript:
        raise HTTPException(status_code=422, detail="No se detectó voz clara en el audio de la consulta.")

    # Inyectar marcadores de pausa si el frontend los envió
    if pause_timestamps:
        try:
            pauses = json.loads(pause_timestamps)
            # Insertar de atrás hacia adelante para no desplazar offsets
            for pause in sorted(pauses, key=lambda p: p.get("at_char", 0), reverse=True):
                duration_s = int(pause.get("duration_s", 0))
                marker = f" [PAUSA {duration_s // 60}m{duration_s % 60}s] "
                insert_at = pause.get("at_char", len(raw_transcript))
                raw_transcript = raw_transcript[:insert_at] + marker + raw_transcript[insert_at:]
        except Exception:
            pass

    # 2. Generar transcripción técnica (reporte clínico estructurado)
    tecnica_result = _voice_call_ai(
        _build_voice_prompt_tecnica(role_info),
        raw_transcript,
        max_tokens=3000,
        temperature=0.1,
    )
    transcripcion_tecnica = tecnica_result[0] if tecnica_result else raw_transcript

    # 3. Generar versión simple + indicaciones + hablantes + metadata
    version_simple = ""
    indicaciones = []
    hablantes = {}
    metadata_clinica = {}
    simple_result = _voice_call_ai(
        _build_voice_prompt_simple(role_info),
        (
            f"Profesional confirmado por el usuario: {role_info['label']}\n"
            f"Puede emitir diagnóstico médico: {'sí' if role_info['can_issue_medical_diagnosis'] else 'no'}\n\n"
            f"Reporte clínico técnico:\n{transcripcion_tecnica}"
        ),
        max_tokens=2500,
        temperature=0.25,
    )
    if simple_result:
        raw_json = simple_result[0]
        # Limpiar markdown code fences si las hay
        cleaned = raw_json.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        try:
            parsed = json.loads(cleaned)
            version_simple = parsed.get("resumen_simple", parsed.get("version_simple", ""))
            indicaciones = parsed.get("indicaciones", [])
            hablantes = parsed.get("hablantes", {})
            metadata_clinica = parsed.get("metadata_clinica", {})
        except (json.JSONDecodeError, AttributeError):
            version_simple = raw_json
            indicaciones = []
            hablantes = {}
            metadata_clinica = {}

    metadata_clinica = {
        **(metadata_clinica or {}),
        "profesional_confirmado": role_info["label"],
        "profesional_clave": role_info["key"],
        "puede_diagnosticar_medicamente": bool(role_info["can_issue_medical_diagnosis"]),
    }

    # 4. Guardar archivos de audio en filesystem y paths en BD
    import time as _time
    voice_dir = os.path.join(_VOICE_UPLOAD_DIR, f"{current_user.id}_{profile.id}_{int(_time.time())}")
    try:
        os.makedirs(voice_dir, exist_ok=True)
        consent_path = os.path.join(voice_dir, safe_consent)
        session_path = os.path.join(voice_dir, safe_session)
        with open(consent_path, "wb") as f:
            f.write(consent_bytes)
        with open(session_path, "wb") as f:
            f.write(session_bytes)
    except OSError as exc:
        print(f"WARNING voice file I/O failed: {exc}")
        raise HTTPException(status_code=500, detail="Error al guardar los archivos de audio.")

    try:
        session_record = models.VoiceSession(
            profile_id=profile.id,
            user_id=current_user.id,
            audio_consent=consent_path,
            audio_session=session_path,
            audio_session_hash=audio_hash,
            transcripcion_tecnica=transcripcion_tecnica,
            version_simple=version_simple,
            indicaciones=indicaciones,
            hablantes=hablantes,
            metadata_clinica=metadata_clinica,
        )
        db.add(session_record)
        db.commit()
        db.refresh(session_record)
    except Exception as exc:
        db.rollback()
        print(f"WARNING voice db save failed: {exc}")
        raise HTTPException(status_code=500, detail="Error al guardar la sesión de voz.")

    auto_shared = []
    try:
        _assert_collaboration_enabled(current_user, db=db, owner_user_id=profile.owner_user_id)
        automation = _profile_automation_settings(profile)
        if automation.get("voice_auto_share_enabled", False):
            auto_shared = _apply_voice_family_shares(
                db,
                session_record,
                profile,
                current_user,
                recipient_user_ids=automation.get("voice_auto_share_recipient_ids", []),
                include_audio=automation.get("voice_auto_share_include_audio", True),
                share_mode="automatic",
            )
            if auto_shared:
                _log_profile_activity(
                    db,
                    profile_id=profile.id,
                    actor_user_id=current_user.id,
                    action_type="voice_family_share_auto",
                    description=(
                        f"{current_user.name or current_user.email} compartio automaticamente "
                        f"una atencion Voice con {len(auto_shared)} integrante(s)"
                    ),
                    metadata_json={
                        "voice_session_id": session_record.id,
                        "recipient_user_ids": [int(item.recipient_user_id) for item in auto_shared],
                        "include_audio": bool(automation.get("voice_auto_share_include_audio", True)),
                    },
                )
                db.commit()
                for item in auto_shared:
                    _send_voice_family_share_push(db, item, profile)
    except HTTPException:
        pass
    except Exception as exc:
        db.rollback()
        print(f"WARNING voice auto share failed: {exc}")

    family_shares_map = {int(session_record.id): auto_shared} if auto_shared else {}
    relationship_map = _voice_share_relationship_map(
        db,
        profile.id,
        user_ids=[int(item.recipient_user_id) for item in auto_shared],
    ) if auto_shared else {}
    return _voice_session_out(
        db,
        session_record,
        profile,
        current_user,
        family_shares_map=family_shares_map,
        relationship_map=relationship_map,
    )


@app.get("/voice/sessions", response_model=List[schemas.VoiceSessionOut])
async def get_voice_sessions(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        profile, _, _ = _get_active_profile_context(db, current_user)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"WARNING voice sessions profile context failed: {exc}")
        return []
    query = db.query(models.VoiceSession).filter(models.VoiceSession.profile_id == profile.id)
    if int(profile.owner_user_id) != int(current_user.id):
        query = query.filter(models.VoiceSession.user_id == current_user.id)
    sessions = (
        query.order_by(models.VoiceSession.created_at.desc())
        .limit(50)
        .all()
    )
    family_shares_map = _voice_session_family_shares_map(
        db,
        [int(item.id) for item in sessions],
    )
    recipient_user_ids = [
        int(share.recipient_user_id)
        for shares in family_shares_map.values()
        for share in shares
    ]
    relationship_map = _voice_share_relationship_map(
        db,
        profile.id,
        user_ids=recipient_user_ids,
    ) if recipient_user_ids else {}
    return [
        _voice_session_out(
            db,
            item,
            profile,
            current_user,
            family_shares_map=family_shares_map,
            relationship_map=relationship_map,
        )
        for item in sessions
    ]


@app.get("/voice/sessions/{session_id}", response_model=schemas.VoiceSessionOut)
async def get_voice_session(
    session_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    session, profile, _, active_share, can_manage = _voice_session_access_context(
        db,
        current_user,
        session_id,
    )
    family_shares_map = {}
    relationship_map = {}
    if can_manage:
        family_shares_map = _voice_session_family_shares_map(db, [int(session.id)])
        recipient_user_ids = [
            int(item.recipient_user_id)
            for item in family_shares_map.get(int(session.id), [])
        ]
        if recipient_user_ids:
            relationship_map = _voice_share_relationship_map(
                db,
                profile.id,
                user_ids=recipient_user_ids,
            )
    return _voice_session_out(
        db,
        session,
        profile,
        current_user,
        active_share=active_share,
        family_shares_map=family_shares_map,
        relationship_map=relationship_map,
    )


@app.get("/health-profiles/{profile_id}/voice-share-targets", response_model=List[schemas.VoiceShareTargetOut])
async def get_voice_share_targets(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, link = _get_profile_access_or_404(db, current_user, profile_id)
    _require_role(link, "caregiver")
    return _voice_share_targets_out(db, profile, exclude_user_id=current_user.id)


@app.get("/voice/shared/received", response_model=List[schemas.VoiceSessionOut])
async def get_voice_received_sessions(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        profile, _, _ = _get_active_profile_context(db, current_user)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"WARNING voice received profile context failed: {exc}")
        return []
    shares = (
        db.query(models.VoiceFamilyShare)
        .join(models.VoiceSession, models.VoiceSession.id == models.VoiceFamilyShare.voice_session_id)
        .filter(
            models.VoiceFamilyShare.profile_id == int(profile.id),
            models.VoiceFamilyShare.recipient_user_id == int(current_user.id),
            models.VoiceFamilyShare.status == "active",
        )
        .order_by(models.VoiceFamilyShare.shared_at.desc())
        .limit(50)
        .all()
    )
    return [
        _voice_session_out(
            db,
            item.session,
            profile,
            current_user,
            active_share=item,
        )
        for item in shares
        if getattr(item, "session", None)
    ]


@app.post("/voice/{session_id}/share/family", response_model=schemas.VoiceSessionOut)
async def share_voice_with_family(
    session_id: int,
    payload: schemas.VoiceFamilyShareIn,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    session, profile, _, _, can_manage = _voice_session_access_context(db, current_user, session_id)
    if not can_manage:
        raise HTTPException(status_code=403, detail="No tienes permisos para compartir esta atencion.")
    _assert_collaboration_enabled(current_user, db=db, owner_user_id=profile.owner_user_id)
    shares = _apply_voice_family_shares(
        db,
        session,
        profile,
        current_user,
        recipient_user_ids=payload.recipient_user_ids,
        include_audio=payload.include_audio,
        share_mode="manual",
    )
    if not shares:
        raise HTTPException(status_code=400, detail="Selecciona al menos un integrante valido para compartir.")
    _log_profile_activity(
        db,
        profile_id=profile.id,
        actor_user_id=current_user.id,
        action_type="voice_family_share_manual",
        description=(
            f"{current_user.name or current_user.email} compartio una atencion Voice "
            f"con {len(shares)} integrante(s)"
        ),
        metadata_json={
            "voice_session_id": session.id,
            "recipient_user_ids": [int(item.recipient_user_id) for item in shares],
            "include_audio": bool(payload.include_audio),
        },
    )
    db.commit()
    for item in shares:
        _send_voice_family_share_push(db, item, profile)
    family_shares_map = _voice_session_family_shares_map(db, [int(session.id)])
    relationship_map = _voice_share_relationship_map(
        db,
        profile.id,
        user_ids=[int(item.recipient_user_id) for item in family_shares_map.get(int(session.id), [])],
    )
    return _voice_session_out(
        db,
        session,
        profile,
        current_user,
        family_shares_map=family_shares_map,
        relationship_map=relationship_map,
    )


@app.delete("/voice/family-shares/{share_id}", response_model=schemas.VoiceSessionOut)
async def revoke_voice_family_share(
    share_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    share = (
        db.query(models.VoiceFamilyShare)
        .filter(models.VoiceFamilyShare.id == int(share_id))
        .first()
    )
    if not share:
        raise HTTPException(status_code=404, detail="Compartido de Voice no encontrado.")
    session, profile, _, _, can_manage = _voice_session_access_context(db, current_user, int(share.voice_session_id))
    if not can_manage:
        raise HTTPException(status_code=403, detail="No tienes permisos para revocar este compartido.")
    share.status = "revoked"
    share.revoked_at = datetime.utcnow()
    db.add(share)
    _log_profile_activity(
        db,
        profile_id=profile.id,
        actor_user_id=current_user.id,
        action_type="voice_family_share_revoked",
        description=f"{current_user.name or current_user.email} revoco un compartido de Klinip Voice",
        metadata_json={
            "voice_session_id": session.id,
            "recipient_user_id": int(share.recipient_user_id),
            "share_id": int(share.id),
        },
    )
    db.commit()
    family_shares_map = _voice_session_family_shares_map(db, [int(session.id)])
    relationship_map = _voice_share_relationship_map(
        db,
        profile.id,
        user_ids=[int(item.recipient_user_id) for item in family_shares_map.get(int(session.id), [])],
    )
    return _voice_session_out(
        db,
        session,
        profile,
        current_user,
        family_shares_map=family_shares_map,
        relationship_map=relationship_map,
    )


@app.post("/voice/{session_id}/share/link")
async def voice_share_link(
    session_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    session, profile, _, _, can_manage = _voice_session_access_context(db, current_user, session_id)
    if not can_manage:
        raise HTTPException(status_code=403, detail="No tienes permisos para compartir esta atencion.")

    token = secrets.token_urlsafe(32)
    expires = datetime.now() + timedelta(hours=48)
    base_url = _frontend_link_base_url("https://app.klinip.cl")
    url = _build_hash_route_url(base_url, f"/voice/shared/{token}")

    session.link_seguro = url
    session.link_expira_en = expires
    session.compartido_en = datetime.now()
    db.commit()

    return {"url": url, "expires_at": expires.isoformat()}


@app.post("/voice/{session_id}/share/email")
async def voice_share_email(
    session_id: int,
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    body = await request.json()
    email = (body.get("email") or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="Email inválido.")

    session, profile, _, _, can_manage = _voice_session_access_context(db, current_user, session_id)
    if not can_manage:
        raise HTTPException(status_code=403, detail="No tienes permisos para compartir esta atencion.")

    # Generate share link if not already present
    if not session.link_seguro:
        token = secrets.token_urlsafe(32)
        base_url = _frontend_link_base_url("https://app.klinip.cl")
        session.link_seguro = _build_hash_route_url(base_url, f"/voice/shared/{token}")
        session.link_expira_en = datetime.now() + timedelta(hours=48)
    elif session.link_expira_en and session.link_expira_en < datetime.now():
        # Refresh expired link
        token = secrets.token_urlsafe(32)
        base_url = _frontend_link_base_url("https://app.klinip.cl")
        session.link_seguro = _build_hash_route_url(base_url, f"/voice/shared/{token}")
        session.link_expira_en = datetime.now() + timedelta(hours=48)

    session.compartido_en = datetime.now()
    db.commit()

    share_url = session.link_seguro
    profile_obj = db.query(models.HealthProfile).filter(models.HealthProfile.id == session.profile_id).first()
    patient_name = getattr(profile_obj, "full_name", None) or getattr(profile_obj, "nombre", None) or "Paciente"
    created_date = session.created_at.strftime("%d/%m/%Y %H:%M") if session.created_at else "—"

    try:
        _send_templated_email(
            to_email=email,
            subject=f"{_app_display_name()} Voice - Registro de consulta compartido",
            template_name="voice_share.html",
            context={
                "share_url": share_url,
                "patient_name": patient_name,
                "created_date": created_date,
                "year": datetime.now().year,
            },
            from_security=False,
        )
    except Exception as exc:
        print(f"ERROR sending voice share email: {exc}")
        raise HTTPException(status_code=500, detail="No se pudo enviar el correo. Intenta de nuevo.")

    return {"ok": True, "url": share_url}


@app.get("/voice/{session_id}/pdf")
async def voice_download_pdf(
    session_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    session, profile, _, active_share, can_manage = _voice_session_access_context(db, current_user, session_id)
    if not can_manage and not active_share:
        raise HTTPException(status_code=404, detail="Sesion de voz no encontrada.")

    # Build plain-text PDF content
    created = session.created_at.strftime("%d/%m/%Y %H:%M") if session.created_at else "—"
    lines = [
        "KLINIP VOICE — Registro de Consulta",
        "=" * 42,
        "",
        f"Fecha:       {created}",
        f"Perfil ID:   {session.profile_id}",
        f"Sesión ID:   {session.id}",
        f"Hash audio:  {session.audio_session_hash or '—'}",
        "",
        "-" * 42,
        "TRANSCRIPCIÓN TÉCNICA",
        "-" * 42,
        "",
        session.transcripcion_tecnica or "(sin transcripción)",
        "",
        "-" * 42,
        "INDICACIONES EXTRAÍDAS",
        "-" * 42,
        "",
    ]
    for ind in (session.indicaciones or []):
        tipo = ind.get("tipo", "otro")
        texto = ind.get("texto", "")
        lines.append(f"  [{tipo.upper()}] {texto}")
    if not session.indicaciones:
        lines.append("  (sin indicaciones)")
    lines.append("")
    lines.append("-" * 42)
    lines.append("Generado por Klinip Voice · klinip.cl")

    content = "\n".join(lines)
    return Response(
        content=content.encode("utf-8"),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="klinip-voice-{session.id}.pdf"',
        },
    )


@app.get("/api/voice/shared/{token}")
async def voice_shared_view(token: str, db: Session = Depends(auth.get_db)):
    """Public API endpoint — no authentication required. Returns session data for shared link."""
    session = (
        db.query(models.VoiceSession)
        .filter(models.VoiceSession.link_seguro.contains(token))
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Enlace no encontrado o inválido.")
    if session.link_expira_en and session.link_expira_en < datetime.now():
        raise HTTPException(status_code=410, detail="Este enlace ha expirado.")

    profile = db.query(models.HealthProfile).filter(models.HealthProfile.id == session.profile_id).first()
    profile_name = getattr(profile, "full_name", None) or getattr(profile, "nombre", None) or "Paciente"
    created = session.created_at.strftime("%d/%m/%Y %H:%M") if session.created_at else None
    consent_ts = session.created_at.strftime("%Y-%m-%dT%H:%M:%S") if session.created_at else None

    return {
        "id": session.id,
        "profile_name": profile_name,
        "created_at": created,
        "consent_timestamp": consent_ts,
        "transcripcion_tecnica": session.transcripcion_tecnica,
        "indicaciones": session.indicaciones or [],
        "metadata_clinica": session.metadata_clinica or {},
        "audio_session_hash": session.audio_session_hash or "",
        "has_audio": bool(session.audio_session and os.path.isfile(session.audio_session)),
        "expires_at": session.link_expira_en.isoformat() if session.link_expira_en else None,
    }


@app.get("/api/voice/shared/{token}/audio")
async def voice_shared_audio(token: str, db: Session = Depends(auth.get_db)):
    """Public endpoint — streams the session audio for a valid shared link."""
    session = (
        db.query(models.VoiceSession)
        .filter(models.VoiceSession.link_seguro.contains(token))
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Enlace no encontrado.")
    if session.link_expira_en and session.link_expira_en < datetime.now():
        raise HTTPException(status_code=410, detail="Este enlace ha expirado.")
    if not session.audio_session or not os.path.isfile(session.audio_session):
        raise HTTPException(status_code=404, detail="Audio no disponible.")

    media_type, download_name = _voice_audio_response_meta(session.audio_session, f"consulta-{session.id}")
    return FileResponse(
        session.audio_session,
        media_type=media_type,
        filename=download_name,
    )


@app.get("/voice/{session_id}/audio")
async def voice_session_audio(
    session_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Authenticated endpoint — streams audio for the session owner."""
    session, profile, _, active_share, can_manage = _voice_session_access_context(
        db,
        current_user,
        session_id,
    )
    if not can_manage and not active_share:
        raise HTTPException(status_code=404, detail="Sesion de voz no encontrada.")
    if active_share and not bool(active_share.include_audio):
        raise HTTPException(status_code=403, detail="El audio no esta disponible para este compartido.")
    if not session.audio_session or not os.path.isfile(session.audio_session):
        raise HTTPException(status_code=404, detail="Audio no disponible.")

    media_type, download_name = _voice_audio_response_meta(session.audio_session, f"consulta-{session.id}")
    return FileResponse(
        session.audio_session,
        media_type=media_type,
        filename=download_name,
    )


@app.get("/ai/conversations", response_model=List[schemas.AiConversationSummaryOut])
async def get_ai_conversations(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, _, _ = _get_active_profile_context(db, current_user)
    return _ai_conversation_summaries(db, profile_id=profile.id, limit=20)


@app.get("/ai/history", response_model=List[schemas.AiConversationMessageOut])
async def get_ai_history(
    conversation_id: str | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, _, _ = _get_active_profile_context(db, current_user)
    items = _get_ai_conversation_messages(
        db,
        profile_id=profile.id,
        conversation_id=(conversation_id or "").strip() or None,
        limit=160,
    )
    return items


@app.patch("/ai/conversations/{conversation_id}", response_model=schemas.AiConversationSummaryOut)
async def rename_ai_conversation(
    conversation_id: str,
    payload: schemas.AiConversationRenameIn,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, link, _ = _get_active_profile_context(db, current_user, require_write=True)
    conversation_id = (conversation_id or "").strip()
    title = (payload.title or "").strip()
    if not conversation_id:
        raise HTTPException(status_code=400, detail="Conversacion invalida")
    if not title:
        raise HTTPException(status_code=400, detail="El titulo no puede estar vacio")

    normalized_title = _clip_text(title, 120)
    updated = (
        db.query(models.AiConversationMessage)
        .filter(
            models.AiConversationMessage.profile_id == profile.id,
            models.AiConversationMessage.conversation_id == conversation_id,
        )
        .update(
            {models.AiConversationMessage.conversation_title: normalized_title},
            synchronize_session=False,
        )
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Conversacion no encontrada")

    _log_profile_activity(
        db,
        profile_id=profile.id,
        actor_user_id=current_user.id,
        action_type="ai_conversation_renamed",
        description=f"{current_user.name or current_user.email} renombro una conversacion de Klinip IA",
        metadata_json={
            "conversation_id": conversation_id,
            "conversation_title": normalized_title,
            "role": link.role,
        },
    )
    db.commit()

    summaries = _ai_conversation_summaries(db, profile_id=profile.id, limit=50)
    for summary in summaries:
        if summary["conversation_id"] == conversation_id:
            return summary
    return {
        "conversation_id": conversation_id,
        "title": normalized_title,
        "updated_at": datetime.now(),
        "message_count": updated,
        "last_message_excerpt": "",
    }


def _requested_or_active_profile_context(
    db: Session,
    current_user: models.User,
    profile_id: int | None = None,
    refresh_advanced: bool = False,
) -> dict:
    if profile_id:
        profile, link = _get_profile_access_or_404(db, current_user, int(profile_id))
        return _ai_context_bundle_for_profile(
            db,
            current_user,
            profile,
            link,
            profile.owner_user_id,
            refresh_advanced=refresh_advanced,
        )
    return _ai_context_bundle(db, current_user, refresh_advanced=refresh_advanced)


def _requested_or_active_profile_only(
    db: Session,
    current_user: models.User,
    profile_id: int | None = None,
) -> tuple[models.HealthProfile, models.ProfileRelationship, int]:
    if profile_id:
        profile, link = _get_profile_access_or_404(db, current_user, int(profile_id))
        return profile, link, int(profile.owner_user_id)
    return _get_active_profile_context(db, current_user)


def _accepted_profile_links_for_user(db: Session, current_user: models.User) -> list[models.ProfileRelationship]:
    return (
        db.query(models.ProfileRelationship)
        .join(models.HealthProfile, models.HealthProfile.id == models.ProfileRelationship.profile_id)
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


def _accepted_collaboration_links_for_user(
    db: Session,
    current_user: models.User,
    owner_user_id: int | None = None,
) -> list[models.ProfileRelationship]:
    links = _accepted_profile_links_for_user(db, current_user)
    owner_ids = {
        int(link.profile.owner_user_id)
        for link in links
        if getattr(link, "profile", None) and getattr(link.profile, "owner_user_id", None) is not None
    }
    if not owner_ids:
        return []
    owner_rows = (
        db.query(models.User)
        .filter(models.User.id.in_(sorted(owner_ids)))
        .all()
    )
    eligible_owner_ids = {
        int(row.id)
        for row in owner_rows
        if _plan_allows_collaboration_for_user(row)
    }
    if owner_user_id is not None:
        owner_user_id = int(owner_user_id)
        if owner_user_id not in eligible_owner_ids:
            return []
        eligible_owner_ids = {owner_user_id}
    return [
        link
        for link in links
        if getattr(link, "profile", None)
        and int(getattr(link.profile, "owner_user_id", 0) or 0) in eligible_owner_ids
    ]


def _resolve_effective_family_scope(
    db: Session,
    current_user: models.User,
    preferred_owner_user_id: int | None = None,
) -> tuple[models.User | None, list[models.ProfileRelationship]]:
    preferred_owner_id = int(preferred_owner_user_id) if preferred_owner_user_id else None
    if preferred_owner_id:
        preferred_links = _accepted_collaboration_links_for_user(
            db,
            current_user,
            owner_user_id=preferred_owner_id,
        )
        if preferred_links:
            owner_user = db.query(models.User).filter(models.User.id == preferred_owner_id).first()
            if owner_user:
                return owner_user, preferred_links

    collaboration_links = _accepted_collaboration_links_for_user(db, current_user)
    if not collaboration_links:
        return None, []

    links_by_owner: dict[int, list[models.ProfileRelationship]] = {}
    for link in collaboration_links:
        profile = getattr(link, "profile", None)
        if not profile or getattr(profile, "owner_user_id", None) is None:
            continue
        links_by_owner.setdefault(int(profile.owner_user_id), []).append(link)
    if not links_by_owner:
        return None, []

    sorted_owner_ids = sorted(
        links_by_owner.keys(),
        key=lambda owner_id: (
            0 if owner_id == preferred_owner_id else 1,
            -len(links_by_owner[owner_id]),
            owner_id,
        ),
    )
    selected_owner_id = sorted_owner_ids[0]
    owner_user = db.query(models.User).filter(models.User.id == selected_owner_id).first()
    return owner_user, links_by_owner.get(selected_owner_id, [])


def _role_access_summary(role_value: str | None) -> dict:
    role = _normalize_role(role_value)
    return {
        "role": role,
        "label": "Administrador" if role == "admin" else "Editor" if role == "caregiver" else "Lector",
        "can_view": True,
        "can_edit": role in {"admin", "caregiver"},
        "can_manage_collaborators": role == "admin",
    }


def _build_family_access_context(
    db: Session,
    current_user: models.User,
    preferred_owner_user_id: int | None = None,
) -> dict:
    owner_user, links = _resolve_effective_family_scope(
        db,
        current_user,
        preferred_owner_user_id=preferred_owner_user_id,
    )
    profiles: list[dict] = []
    for link in links:
        profile = getattr(link, "profile", None)
        if not profile:
            continue
        role_meta = _role_access_summary(getattr(link, "role", None))
        profiles.append(
            {
                "profile_id": int(profile.id),
                "profile_name": profile.full_name or f"Perfil #{profile.id}",
                "relation_with_owner": profile.relation_with_owner or link.relationship_type or "",
                "owner_user_id": int(profile.owner_user_id),
                "owner_name": (owner_user.name if owner_user else "") or "",
                "role": role_meta["role"],
                "role_label": role_meta["label"],
                "can_view": role_meta["can_view"],
                "can_edit": role_meta["can_edit"],
                "can_manage_collaborators": role_meta["can_manage_collaborators"],
                "is_primary_profile": bool(getattr(profile, "is_primary_profile", False)),
            }
        )
    profiles.sort(
        key=lambda item: (
            0 if item.get("can_manage_collaborators") else 1,
            0 if item.get("can_edit") else 1,
            str(item.get("profile_name") or "").lower(),
        )
    )
    return {
        "available": bool(profiles),
        "owner_user_id": int(owner_user.id) if owner_user else None,
        "owner_name": (owner_user.name if owner_user else "") or "",
        "profiles": profiles,
    }


def detect_chat_intent(message: str | None) -> str:
    normalized = _normalize_text(message or "")
    if _message_needs_family_context(message):
        return "familiar"
    voice_tokens = [
        "klinip voice",
        "audio",
        "audios",
        "transcripcion",
        "transcripción",
        "grabacion",
        "grabación",
        "consulta grabada",
        "resumen de la consulta",
        "resumen consulta",
        "que dijo el medico",
        "qué dijo el médico",
        "indicaciones del medico",
        "indicaciones del médico",
    ]
    if any(token in normalized for token in voice_tokens):
        return "voice"
    medication_tokens = [
        "medicamento",
        "medicamentos",
        "tratamiento",
        "adherencia",
        "dosis",
        "frecuencia",
        "pastilla",
        "remedio",
    ]
    if any(token in normalized for token in medication_tokens):
        return "medicamentos"
    document_tokens = [
        "documento",
        "documentos",
        "ocr",
        "pdf",
        "imagen",
        "resultado",
        "informe",
        "receta",
        "orden medica",
        "orden médica",
        "archivo",
    ]
    if any(token in normalized for token in document_tokens):
        return "documentos"
    appointment_tokens = [
        "cita",
        "citas",
        "agenda",
        "agendada",
        "proxima cita",
        "próxima cita",
        "consulta",
        "doctor",
        "medico",
        "médico",
        "hora",
    ]
    if any(token in normalized for token in appointment_tokens):
        return "citas"
    feed_tokens = [
        "feed",
        "klinipfeed",
        "publicacion",
        "publicaciones",
        "publico",
        "publico en el feed",
        "compartio",
        "compartió",
        "compartieron",
        "noticias",
        "actualizacion familiar",
        "actualización familiar",
        "que hay de nuevo",
        "novedades",
    ]
    if any(token in normalized for token in feed_tokens):
        return "feed"
    return "general"


def select_context_modules(intent: str) -> dict:
    base_modules = {
        "profile_notes": True,
        "voice_sessions": True,
        "appointments": False,
        "documents": False,
        "document_summaries": False,
        "medications": False,
        "adherence": False,
        "family": False,
    }
    if intent == "voice":
        base_modules["voice_sessions"] = True
    elif intent == "medicamentos":
        base_modules["medications"] = True
        base_modules["adherence"] = True
    elif intent == "documentos":
        base_modules["documents"] = True
        base_modules["document_summaries"] = True
    elif intent == "citas":
        base_modules["appointments"] = True
    elif intent == "familiar":
        base_modules["family"] = True
    elif intent == "feed":
        base_modules["feed"] = True
    return base_modules


def _message_needs_family_context(message: str | None) -> bool:
    normalized = _normalize_text(message or "")
    family_tokens = [
        "familia",
        "familiar",
        "cuidador",
        "cuidadora",
        "perfil familiar",
        "perfil asistido",
        "colaborador",
        "colaboradora",
        "mama",
        "mamá",
        "papa",
        "papá",
        "hijo",
        "hija",
        "esposo",
        "esposa",
        "quien necesita mas atencion",
        "que familiar necesita mas atencion",
    ]
    return any(token in normalized for token in family_tokens)


def _message_asks_family_access(message: str | None) -> bool:
    normalized = _normalize_text(message or "")
    access_tokens = [
        "de que familiar puedo revisar",
        "de que familiar puedo ver",
        "a que familiar puedo revisar",
        "a que familiar puedo ver",
        "que familiar puedo revisar",
        "que familiar puedo ver",
        "que perfiles familiares puedo revisar",
        "que perfiles puedo revisar",
        "que perfiles tengo acceso",
        "a que perfiles tengo acceso",
        "que familiares tengo vinculados",
        "que familiares puedo revisar",
    ]
    return any(token in normalized for token in access_tokens)


def _should_include_family_context_for_chat(
    db: Session,
    current_user: models.User,
    message: str | None,
    preferred_owner_user_id: int | None = None,
) -> bool:
    if not _message_needs_family_context(message):
        return False
    family_access = _build_family_access_context(
        db,
        current_user,
        preferred_owner_user_id=preferred_owner_user_id,
    )
    return bool(family_access.get("available"))


def _build_family_access_reply(context: dict) -> str:
    family_access = context.get("family_access") or {}
    profiles = list(family_access.get("profiles") or [])
    if not profiles:
        return (
            "Hoy no tienes perfiles familiares compartidos disponibles para revisar desde esta cuenta. "
            "Si esperabas ver un familiar, revisa que la invitacion este aceptada y que el perfil siga vinculado."
        )

    lines = [
        "Hoy puedes revisar la informacion medica de estos perfiles vinculados:",
    ]
    for item in profiles[:5]:
        role_label = item.get("role_label") or "Lector"
        relation = item.get("relation_with_owner") or "Perfil compartido"
        capability = (
            "puedes ver, editar y administrar colaboradores"
            if item.get("can_manage_collaborators")
            else "puedes ver y editar"
            if item.get("can_edit")
            else "solo lectura"
        )
        lines.append(
            f"- {item.get('profile_name') or 'Perfil'} ({relation}): rol {role_label}, {capability}."
        )
    lines.append(
        "Regla de permisos: Lector solo ve; Editor puede ver y editar datos clinicos; "
        "Administrador puede editar y ademas invitar, quitar o cambiar permisos de otros colaboradores."
    )
    return " ".join(lines)


def _life_timeline_events_from_context(context: dict, include_alerts: bool = False) -> list[dict]:
    profile_data = context.get("profile") or {}
    profile_id = int(profile_data.get("id") or 0)
    profile_name = profile_data.get("name") or "Perfil"
    timezone_name = context.get("timezone_name") or DEFAULT_TZ_NAME
    document_entities_by_document = context.get("document_entities_by_document") or {}
    events: list[dict] = []

    for appt in context.get("appointments") or []:
        event_at_tz = _ai_dt_in_tz(getattr(appt, "date_time", None), timezone_name)
        event_at = event_at_tz.replace(tzinfo=None) if event_at_tz else getattr(appt, "created_at", None)
        events.append(
            {
                "id": f"appointment-{appt.id}",
                "profile_id": profile_id,
                "profile_name": profile_name,
                "event_type": "appointment",
                "category": getattr(appt, "status", "") or "agenda",
                "title": getattr(appt, "specialty", "") or "Actividad clinica",
                "summary": getattr(appt, "center", "") or "Centro por confirmar",
                "event_at": event_at,
                "related_ids": {"appointment_id": appt.id},
                "metadata_json": {
                    "type": getattr(appt, "type", ""),
                    "status": getattr(appt, "status", ""),
                    "notes": getattr(appt, "notes", "") or "",
                },
            }
        )

    for doc in context.get("documents") or []:
        matching_summary = next(
            (item for item in (context.get("document_summaries") or []) if getattr(item, "document_id", None) == doc.id),
            None,
        )
        diagnosis_entities = [
            entity
            for entity in (document_entities_by_document.get(doc.id) or [])
            if getattr(entity, "entity_type", "") == "diagnosis"
        ]
        events.append(
            {
                "id": f"document-{doc.id}",
                "profile_id": profile_id,
                "profile_name": profile_name,
                "event_type": "document",
                "category": _infer_document_type(doc),
                "title": _infer_document_type(doc).title(),
                "summary": _clip_text(
                    (getattr(matching_summary, "patient_friendly_explanation", "") if matching_summary else "")
                    or getattr(doc, "notes", "")
                    or getattr(doc, "center", "")
                    or "Documento clinico cargado",
                    220,
                ),
                "event_at": getattr(doc, "date", None) or getattr(doc, "created_at", None),
                "related_ids": {"document_id": doc.id, "appointment_id": getattr(doc, "appointment_id", None)},
                "metadata_json": {
                    "filename": getattr(doc, "filename", "") or "",
                    "ocr_status": getattr(doc, "ocr_status", "") or "",
                    "diagnosis_count": len(diagnosis_entities),
                },
            }
        )
        for index, entity in enumerate(diagnosis_entities[:3]):
            diagnosis_summary = getattr(entity, "entity_value", "") or getattr(entity, "source_text", "") or ""
            if matching_summary and getattr(matching_summary, "patient_friendly_explanation", ""):
                diagnosis_summary = (
                    diagnosis_summary + " | " if diagnosis_summary else ""
                ) + getattr(matching_summary, "patient_friendly_explanation", "")
            events.append(
                {
                    "id": f"diagnosis-{doc.id}-{index}",
                    "profile_id": profile_id,
                    "profile_name": profile_name,
                    "event_type": "diagnosis",
                    "category": "documented",
                    "title": getattr(entity, "entity_name", "") or "Diagnostico documentado",
                    "summary": _clip_text(diagnosis_summary or "Hallazgo detectado en informe clinico.", 220),
                    "event_at": getattr(doc, "date", None)
                    or getattr(matching_summary, "updated_at", None)
                    or getattr(doc, "created_at", None),
                    "related_ids": {"document_id": doc.id, "appointment_id": getattr(doc, "appointment_id", None)},
                    "metadata_json": {
                        "confidence": getattr(entity, "confidence", 0),
                        "source_text": getattr(entity, "source_text", "") or "",
                    },
                }
            )

    for med in context.get("medications") or []:
        summary_parts = [part for part in [getattr(med, "dose", ""), getattr(med, "frequency", ""), getattr(med, "duration", "")] if part]
        events.append(
            {
                "id": f"medication-{med.id}",
                "profile_id": profile_id,
                "profile_name": profile_name,
                "event_type": "treatment" if getattr(med, "completed", False) else "medication",
                "category": "completed" if getattr(med, "completed", False) else "active",
                "title": getattr(med, "name", "") or "Medicamento",
                "summary": " | ".join(summary_parts) if summary_parts else "Tratamiento registrado",
                "event_at": getattr(med, "created_at", None),
                "related_ids": {"medication_id": med.id, "document_id": getattr(med, "document_id", None)},
                "metadata_json": {
                    "end_date": _safe_iso_client(getattr(med, "end_date", None)),
                    "notes": getattr(med, "notes", "") or "",
                },
            }
        )

    for summary in context.get("document_summaries") or []:
        abnormal_values = getattr(summary, "abnormal_values_json", None) or []
        if abnormal_values:
            events.append(
                {
                    "id": f"diagnostic-result-{getattr(summary, 'document_id', 0)}",
                    "profile_id": profile_id,
                    "profile_name": profile_name,
                    "event_type": "diagnostic_result",
                    "category": "review_required",
                    "title": "Resultados con valores a revisar",
                    "summary": _clip_text(
                        ", ".join(
                            f"{item.get('entity_name', 'valor')}: {item.get('entity_value', '')}"
                            for item in abnormal_values[:3]
                        )
                        or "Se detectaron resultados fuera de rango en un documento.",
                        220,
                    ),
                    "event_at": getattr(summary, "updated_at", None),
                    "related_ids": {"document_id": getattr(summary, "document_id", None)},
                    "metadata_json": {"abnormal_values": abnormal_values[:5]},
                }
            )

    external_records = context.get("external_records") or []
    for record in external_records:
        events.append(
            {
                "id": f"external-record-{record.id}",
                "profile_id": profile_id,
                "profile_name": profile_name,
                "event_type": "external_record",
                "category": getattr(record, "record_type", "") or "external",
                "title": getattr(record, "title", "") or "Registro externo",
                "summary": _clip_text(getattr(record, "summary", "") or "", 220),
                "event_at": getattr(record, "event_at", None) or getattr(record, "created_at", None),
                "related_ids": {"external_record_id": record.id, "source_id": getattr(record, "source_id", None)},
                "metadata_json": getattr(record, "payload_json", {}) or {},
            }
        )

    if include_alerts:
        for alert in context.get("health_alerts") or []:
            events.append(
                {
                    "id": f"alert-{alert.id}",
                    "profile_id": profile_id,
                    "profile_name": profile_name,
                    "event_type": "health_alert",
                    "category": getattr(alert, "severity", "") or "low",
                    "title": getattr(alert, "title", "") or "Alerta de salud",
                    "summary": _clip_text(getattr(alert, "description", "") or "", 220),
                    "event_at": getattr(alert, "detected_at", None) or getattr(alert, "updated_at", None),
                    "related_ids": {"alert_id": alert.id},
                    "metadata_json": getattr(alert, "evidence_json", {}) or {},
                }
            )

    return sorted(
        [item for item in events if item.get("event_at")],
        key=lambda item: item.get("event_at") or datetime.min,
        reverse=True,
    )


def _life_timeline_summary(events: list[dict], profile_label: str) -> str:
    if not events:
        return f"No hay eventos clinicos suficientes para resumir la evolucion de {profile_label}."
    categories: dict[str, int] = {}
    for item in events:
        key = item.get("event_type", "evento")
        categories[key] = categories.get(key, 0) + 1
    dominant = max(categories, key=categories.get) if categories else "eventos clinicos"
    latest_titles = ", ".join(item.get("title", "evento") for item in events[:3])
    return (
        f"Evolucion resumida de {profile_label}: {len(events)} eventos clinicos registrados. "
        f"Predominan {dominant}. Ultimos hitos: {latest_titles}."
    )


def _build_family_ai_summary(db: Session, current_user: models.User, days: int = 30) -> dict:
    return _load_cached_family_ai_summary(db, current_user, days) or {
        "generated_at": None,
        "family_size": 0,
        "active_alerts_total": 0,
        "pending_documents_total": 0,
        "low_adherence_profiles": 0,
        "summary": "",
        "profiles": [],
    }


def _empty_adherence_summary(window_days: int = 30) -> dict:
    return {
        "window_days": window_days,
        "overall_adherence_rate": None,
        "low_adherence": False,
        "low_adherence_items": [],
        "medication_items": [],
        "pattern_summary": {
            "most_consistent_day": "",
            "lowest_recorded_time_slot": "",
        },
    }


def _build_cached_ai_health_context_response(
    db: Session,
    current_user: models.User,
    profile: models.HealthProfile,
    link: models.ProfileRelationship,
) -> dict:
    plan_info = _build_plan_info(current_user, db)
    target_user_id = int(getattr(profile, "owner_user_id", 0) or 0)
    medications = (
        db.query(models.Medication)
        .filter(models.Medication.user_id == target_user_id)
        .order_by(models.Medication.created_at.desc())
        .all()
    )
    adherence_summary = (
        _load_adherence_summary_cached(db, profile, medications, window_days=30)
        if medications
        else _empty_adherence_summary(30)
    )
    health_alerts = (
        db.query(models.HealthAlert)
        .filter(
            models.HealthAlert.profile_id == profile.id,
            models.HealthAlert.status == "active",
        )
        .order_by(models.HealthAlert.detected_at.desc())
        .all()
    )
    document_summaries = (
        db.query(models.DocumentSummary)
        .join(models.Document, models.Document.id == models.DocumentSummary.document_id)
        .filter(*_document_scope_filter(profile, target_user_id))
        .order_by(models.Document.created_at.desc(), models.DocumentSummary.updated_at.desc())
        .limit(20)
        .all()
    )
    profile_features = (
        db.query(models.ProfileHealthFeature)
        .filter(models.ProfileHealthFeature.profile_id == profile.id)
        .first()
    )
    cached_summary = _load_cached_profile_ai_summary(db, profile) or {}
    pending_refresh = bool(getattr(profile, "ai_needs_refresh", False))
    return {
        "profile": {
            "id": profile.id,
            "name": profile.full_name,
            "owner_user_id": target_user_id,
            "relation_with_owner": profile.relation_with_owner or "",
            "gender": profile.gender or "",
            "age_years": _profile_age_years(profile),
            "access_role": (link.role or "").lower(),
            "is_primary": bool(profile.is_primary_profile),
            "brief_profile_summary": cached_summary.get("summary") or "",
        },
        "plan": plan_info,
        "adherence_summary": adherence_summary,
        "health_alerts": health_alerts,
        "document_summaries": document_summaries,
        "profile_health_features": (
            {
                "next_appointment_at": _safe_iso_client(getattr(profile_features, "next_appointment_at", None)),
                "last_appointment_at": _safe_iso_client(getattr(profile_features, "last_appointment_at", None)),
                "active_medications_count": getattr(profile_features, "active_medications_count", 0),
                "low_adherence_risk": getattr(profile_features, "low_adherence_risk", False),
                "treatment_completion_score": getattr(profile_features, "treatment_completion_score", 0),
                "missing_documents_flags_json": getattr(profile_features, "missing_documents_flags_json", {}) or {},
                "updated_at": _safe_iso_client(getattr(profile_features, "updated_at", None)),
            }
            if profile_features
            else {}
        ),
        "context": {
            "cache_source": "persistent",
            "pending_refresh": pending_refresh,
            "profile_summary": cached_summary,
            "summary_updated_at": _safe_iso_client(cached_summary.get("updated_at")),
            "alerts_cached": True,
            "adherence_cached": True,
            "documents_cached": True,
        },
    }


@app.get("/ai/context/profile/{profile_id}", response_model=schemas.AiHealthContextOut)
async def get_ai_profile_context(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, link = _get_profile_access_or_404(db, current_user, profile_id)
    return _build_cached_ai_health_context_response(db, current_user, profile, link)


@app.get("/ai/context/profile/{profile_id}/summary")
async def get_ai_profile_context_summary(
    profile_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, _ = _get_profile_access_or_404(db, current_user, profile_id)
    cached_summary = _load_cached_profile_ai_summary(db, profile) or {}
    return {
        "profile": {
            "id": profile.id,
            "name": profile.full_name,
            "relation_with_owner": profile.relation_with_owner or "",
        },
        "summary": {
            "text": cached_summary.get("summary") or "",
            "active_medications": int(cached_summary.get("active_medications") or 0),
            "upcoming_appointments": int(cached_summary.get("upcoming_appointments") or 0),
            "documents": int(cached_summary.get("documents") or 0),
            "health_alerts": int(cached_summary.get("health_alerts") or 0),
            "overall_adherence_rate": cached_summary.get("overall_adherence_rate"),
            "treatment_completion_score": int(cached_summary.get("treatment_completion_score") or 0),
            "key_risks": cached_summary.get("key_risks") or [],
            "updated_at": _safe_iso_client(cached_summary.get("updated_at")),
            "pending_refresh": bool(getattr(profile, "ai_needs_refresh", False)),
        },
    }


@app.get("/ai/family/context", response_model=schemas.AiFamilyContextOut)
async def get_ai_family_context(
    days: int = 30,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, _, owner_user_id = _get_active_profile_context(db, current_user)
    owner_user, _ = _resolve_effective_family_scope(
        db,
        current_user,
        preferred_owner_user_id=owner_user_id or getattr(profile, "owner_user_id", None),
    )
    cached = _load_cached_family_ai_summary(
        db,
        current_user,
        days,
        summary_user=owner_user,
    )
    if cached:
        return cached
    return {
        "generated_at": None,
        "family_size": 0,
        "active_alerts_total": 0,
        "pending_documents_total": 0,
        "low_adherence_profiles": 0,
        "summary": "",
        "profiles": [],
    }


@app.get("/ai/life-timeline", response_model=schemas.LifeTimelineOut)
async def get_ai_life_timeline(
    profile_id: int | None = None,
    days: int = 365,
    include_family: bool = False,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    context = _requested_or_active_profile_context(db, current_user, profile_id)
    events = _life_timeline_events_from_context(context, include_alerts=True)
    if include_family:
        current_profile_id = int((context.get("profile") or {}).get("id") or 0)
        for link in _accepted_profile_links_for_user(db, current_user):
            profile = link.profile
            if not profile or profile.id == current_profile_id:
                continue
            family_context = _ai_context_bundle_for_profile(db, current_user, profile, link, profile.owner_user_id)
            events.extend(_life_timeline_events_from_context(family_context, include_alerts=False))
        events = sorted(events, key=lambda item: item.get("event_at") or datetime.min, reverse=True)
    if days and int(days) > 0:
        cutoff = datetime.now() - timedelta(days=max(1, min(int(days), 3650)))
        events = [item for item in events if (item.get("event_at") or datetime.min) >= cutoff]
    profile_label = "la familia" if include_family else ((context.get("profile") or {}).get("name") or "tu perfil")
    return {
        "generated_at": datetime.now(),
        "profile_id": (context.get("profile") or {}).get("id"),
        "include_family": bool(include_family),
        "summary": _life_timeline_summary(events, profile_label),
        "event_count": len(events),
        "events": events[:250],
    }


@app.get("/ai/interoperability/sources", response_model=List[schemas.ExternalClinicalSourceOut])
async def list_external_clinical_sources(
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    target_profile_id = int(profile_id or _requested_or_active_profile_context(db, current_user).get("profile", {}).get("id") or 0)
    profile, _ = _get_profile_access_or_404(db, current_user, target_profile_id)
    return (
        db.query(models.ExternalClinicalSource)
        .filter(models.ExternalClinicalSource.profile_id == profile.id)
        .order_by(models.ExternalClinicalSource.updated_at.desc(), models.ExternalClinicalSource.created_at.desc())
        .all()
    )


@app.post("/ai/interoperability/sources", response_model=schemas.ExternalClinicalSourceOut)
async def create_external_clinical_source(
    payload: schemas.ExternalClinicalSourceCreate,
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    target_profile_id = int(profile_id or _requested_or_active_profile_context(db, current_user).get("profile", {}).get("id") or 0)
    profile, link = _get_profile_access_or_404(db, current_user, target_profile_id)
    _require_role(link, "caregiver")
    row = models.ExternalClinicalSource(
        profile_id=profile.id,
        source_type=_safe_text(payload.source_type or "manual")[:40] or "manual",
        source_name=_clip_text(payload.source_name or "Fuente clinica", 120),
        status=_safe_text(payload.status or "connected")[:30] or "connected",
        metadata_json=payload.metadata_json or {},
        last_sync_at=datetime.now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.get("/ai/interoperability/records", response_model=List[schemas.ExternalClinicalRecordOut])
async def list_external_clinical_records(
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    target_profile_id = int(profile_id or _requested_or_active_profile_context(db, current_user).get("profile", {}).get("id") or 0)
    profile, _ = _get_profile_access_or_404(db, current_user, target_profile_id)
    return (
        db.query(models.ExternalClinicalRecord)
        .filter(models.ExternalClinicalRecord.profile_id == profile.id)
        .order_by(models.ExternalClinicalRecord.event_at.desc(), models.ExternalClinicalRecord.created_at.desc())
        .all()
    )


@app.post("/ai/interoperability/records", response_model=schemas.ExternalClinicalRecordOut)
async def create_external_clinical_record(
    payload: schemas.ExternalClinicalRecordCreate,
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    target_profile_id = int(profile_id or _requested_or_active_profile_context(db, current_user).get("profile", {}).get("id") or 0)
    profile, link = _get_profile_access_or_404(db, current_user, target_profile_id)
    _require_role(link, "caregiver")
    row = models.ExternalClinicalRecord(
        profile_id=profile.id,
        source_id=payload.source_id,
        external_id=_safe_text(payload.external_id or "")[:80],
        record_type=_safe_text(payload.record_type or "lab_result")[:40] or "lab_result",
        title=_clip_text(payload.title or "Registro externo", 140),
        summary=_clip_text(payload.summary or "", 400),
        payload_json=payload.payload_json or {},
        event_at=payload.event_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.get("/ai/health-radar", response_model=List[schemas.HealthAlertOut])
async def get_ai_health_radar(
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, _, _ = _requested_or_active_profile_only(db, current_user, profile_id)
    return (
        db.query(models.HealthAlert)
        .filter(
            models.HealthAlert.profile_id == profile.id,
            models.HealthAlert.status == "active",
        )
        .order_by(models.HealthAlert.detected_at.desc())
        .all()
    )


@app.post("/ai/health-radar/run", response_model=List[schemas.HealthAlertOut])
async def run_ai_health_radar(
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    context = _requested_or_active_profile_context(
        db,
        current_user,
        profile_id,
        refresh_advanced=True,
    )
    db.commit()
    return context.get("health_alerts") or []


@app.get("/ai/adherence")
async def get_ai_adherence_summary(
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ensure_medication_schema(force=True)
    profile, _, target_user_id = _requested_or_active_profile_only(db, current_user, profile_id)
    medications = (
        db.query(models.Medication)
        .filter(models.Medication.user_id == target_user_id)
        .order_by(models.Medication.created_at.desc())
        .all()
    )
    summary = (
        _load_adherence_summary_cached(db, profile, medications, window_days=30)
        if medications
        else _empty_adherence_summary(30)
    )
    summary["pending_refresh"] = bool(getattr(profile, "ai_needs_refresh", False))
    summary["cache_source"] = "persistent"
    return summary


@app.get("/ai/documents/intelligence", response_model=List[schemas.DocumentSummaryOut])
async def get_ai_document_intelligence(
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, _, target_user_id = _requested_or_active_profile_only(db, current_user, profile_id)
    return (
        db.query(models.DocumentSummary)
        .join(models.Document, models.Document.id == models.DocumentSummary.document_id)
        .filter(*_document_scope_filter(profile, target_user_id))
        .order_by(models.Document.created_at.desc())
        .limit(20)
        .all()
    )


@app.post("/ai/reports/generate", response_model=schemas.ClinicalReportOut)
async def generate_ai_clinical_report(
    payload: schemas.ClinicalReportRequest,
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    context = _requested_or_active_profile_context(db, current_user, profile_id)
    profile, _ = _get_profile_access_or_404(db, current_user, int(context["profile"]["id"]))
    report_payload = _build_clinical_report_payload(
        context,
        report_type=(payload.report_type or "consulta_medica").strip() or "consulta_medica",
        period_days=max(1, min(365, int(payload.period_days or 30))),
    )
    report = _persist_clinical_report(
        db,
        profile,
        report_type=report_payload["report_type"],
        period_days=max(1, min(365, int(payload.period_days or 30))),
        report_payload=report_payload,
    )
    return report


@app.get("/ai/reports", response_model=List[schemas.ClinicalReportOut])
async def list_ai_clinical_reports(
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, _, _ = _requested_or_active_profile_only(db, current_user, profile_id)
    reports = (
        db.query(models.ClinicalReport)
        .filter(models.ClinicalReport.profile_id == profile.id)
        .order_by(models.ClinicalReport.created_at.desc())
        .limit(20)
        .all()
    )
    return reports


@app.get("/ai/reports/{report_id}", response_model=schemas.ClinicalReportOut)
async def get_ai_clinical_report(
    report_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    report = db.query(models.ClinicalReport).filter(models.ClinicalReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Reporte no encontrado")
    _get_profile_access_or_404(db, current_user, report.profile_id)
    return report


@app.get("/ai/reports/{report_id}/pdf")
async def get_ai_clinical_report_pdf(
    report_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    report = db.query(models.ClinicalReport).filter(models.ClinicalReport.id == report_id).first()
    if not report or not report.pdf_data:
        raise HTTPException(status_code=404, detail="PDF no encontrado")
    _get_profile_access_or_404(db, current_user, report.profile_id)
    headers = {"Content-Disposition": f'attachment; filename="{report.pdf_filename or "klinip_reporte.pdf"}"'}
    return Response(content=report.pdf_data, media_type="application/pdf", headers=headers)


@app.delete("/ai/conversations/{conversation_id}")
async def delete_ai_conversation(
    conversation_id: str,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, link, _ = _get_active_profile_context(db, current_user, require_write=True)
    conversation_id = (conversation_id or "").strip()
    if not conversation_id:
        raise HTTPException(status_code=400, detail="Conversacion invalida")

    deleted = (
        db.query(models.AiConversationMessage)
        .filter(
            models.AiConversationMessage.profile_id == profile.id,
            models.AiConversationMessage.conversation_id == conversation_id,
        )
        .delete()
    )
    db.query(models.AiConversationWorkflow).filter(
        models.AiConversationWorkflow.profile_id == profile.id,
        models.AiConversationWorkflow.conversation_id == conversation_id,
    ).delete()
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversacion no encontrada")
    _log_profile_activity(
        db,
        profile_id=profile.id,
        actor_user_id=current_user.id,
        action_type="ai_conversation_deleted",
        description=f"{current_user.name or current_user.email} elimino una conversacion de Klinip IA",
        metadata_json={
            "conversation_id": conversation_id,
            "messages_deleted": deleted,
            "role": link.role,
        },
    )
    db.commit()
    return {"ok": True, "messages_deleted": deleted}


@app.delete("/ai/history")
async def clear_ai_history(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, link, _ = _get_active_profile_context(db, current_user, require_write=True)
    deleted = (
        db.query(models.AiConversationMessage)
        .filter(models.AiConversationMessage.profile_id == profile.id)
        .delete()
    )
    _log_profile_activity(
        db,
        profile_id=profile.id,
        actor_user_id=current_user.id,
        action_type="ai_history_cleared",
        description=f"{current_user.name or current_user.email} limpio el historial de Klinip IA",
        metadata_json={"messages_deleted": deleted, "role": link.role},
    )
    db.commit()
    return {"ok": True, "deleted": deleted}


# Appointments
@app.get("/appointments", response_model=List[schemas.AppointmentOut])
async def list_appointments(
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _, _, target_user_id = _requested_or_active_profile_only(db, current_user, profile_id)
    return (
        db.query(models.Appointment)
        .filter(models.Appointment.user_id == target_user_id)
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
    profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
    appt = models.Appointment(
        user_id=target_user_id,
        type=appt_in.type,
        specialty=appt_in.specialty,
        center=appt_in.center,
        date_time=appt_in.date_time,
        status=appt_in.status,
        notes=appt_in.notes,
        checklist=appt_in.checklist or [],
    )
    db.add(appt)
    _mark_profile_ai_dirty(db, profile, include_family=True)
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
    profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
    appt = (
        db.query(models.Appointment)
        .filter(
            models.Appointment.id == appointment_id,
            models.Appointment.user_id == target_user_id,
        )
        .first()
    )
    if not appt:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    for field, value in appt_in.dict(exclude_unset=True).items():
        setattr(appt, field, value)

    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.commit()
    db.refresh(appt)
    return appt


@app.delete("/appointments/{appointment_id}")
async def delete_appointment(
    appointment_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
    appt = (
        db.query(models.Appointment)
        .filter(
            models.Appointment.id == appointment_id,
            models.Appointment.user_id == target_user_id,
        )
        .first()
    )
    if not appt:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    db.delete(appt)
    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.commit()
    return {"ok": True}


# Medications
@app.get("/medications", response_model=List[schemas.MedicationOut])
async def list_medications(
    profile_id: int | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ensure_medication_schema(force=True)
    profile, _, target_user_id = _requested_or_active_profile_only(db, current_user, profile_id)
    medications = (
        db.query(models.Medication)
        .filter(models.Medication.user_id == target_user_id)
        .order_by(models.Medication.created_at.desc())
        .all()
    )
    return _attach_medication_adherence(
        db,
        medications,
        current_user,
        profile_id=profile.id,
        owner_user_id=target_user_id,
    )


@app.post("/medications", response_model=schemas.MedicationOut)
async def create_medication(
    med_in: schemas.MedicationCreate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        ensure_medication_schema(force=True)
        profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
        available_refill_contacts = _medication_refill_contacts(db, target_user_id)
        refill_enabled = bool(getattr(med_in, "refill_enabled", False))
        refill_mode = str(getattr(med_in, "refill_mode", None) or "rotativo")
        refill_fixed_user_id = getattr(med_in, "refill_fixed_user_id", None)
        refill_participant_user_ids = _sanitize_refill_participant_ids(
            getattr(med_in, "refill_participant_user_ids", None),
            available_refill_contacts,
            fixed_user_id=refill_fixed_user_id,
            default_all=refill_enabled,
        )
        effective_frequency_per_day = _effective_frequency_per_day_from_values(
            med_in.frequency or "",
            getattr(med_in, "frequency_per_day", None),
        )
        if refill_mode == "fijo" and not refill_fixed_user_id and refill_participant_user_ids:
            refill_fixed_user_id = int(refill_participant_user_ids[0])
        med = models.Medication(
            user_id=target_user_id,
            name=med_in.name,
            dose=med_in.dose or "",
            frequency=med_in.frequency or "",
            duration=med_in.duration or "",
            schedule_time=(med_in.schedule_time or (med_in.start_at.strftime("%H:%M") if med_in.start_at else "")),
            start_at=med_in.start_at,
            refill_enabled=refill_enabled,
            refill_mode=refill_mode,
            refill_fixed_user_id=refill_fixed_user_id,
            refill_participants_json=_serialize_refill_participant_ids(refill_participant_user_ids),
            doses_per_intake=max(float(getattr(med_in, "doses_per_intake", None) or 1.0), 0.01),
            frequency_per_day=effective_frequency_per_day,
            stock_total_doses=max(int(getattr(med_in, "stock_total_doses", 0) or 0), 0),
            refill_alert_threshold_doses=max(
                int(getattr(med_in, "refill_alert_threshold_doses", 0) or 0),
                0,
            ),
            completed=bool(med_in.completed) if med_in.completed is not None else False,
            end_date=med_in.end_date,
            notes=med_in.notes or "",
            document_id=med_in.document_id,
        )
        if not med.refill_enabled or med.stock_total_doses <= 0:
            med.refill_alert_threshold_doses = 0
        elif med.refill_alert_threshold_doses > med.stock_total_doses:
            med.refill_alert_threshold_doses = med.stock_total_doses
        db.add(med)
        _mark_profile_ai_dirty(db, profile, include_family=True)
        db.commit()
        db.refresh(med)
        _attach_medication_adherence(db, [med], current_user, owner_user_id=target_user_id)
        if med.refill_enabled:
            try:
                _send_medication_programmed_notifications(
                    db,
                    med,
                    profile=profile,
                    owner_user=current_user if int(current_user.id) == int(target_user_id) else None,
                )
            except Exception as notify_exc:
                print(f"WARNING medication programmed notifications {med.id}: {notify_exc}")
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
    ensure_medication_schema(force=True)
    profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
    med = (
        db.query(models.Medication)
        .filter(
            models.Medication.id == medication_id,
            models.Medication.user_id == target_user_id,
        )
        .first()
    )
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento no encontrado")

    previous_refill_enabled = bool(getattr(med, "refill_enabled", False))
    previous_stock_total = int(getattr(med, "stock_total_doses", 0) or 0)
    previous_last_notified_at = getattr(med, "refill_last_notified_at", None)
    updated_fields = med_in.dict(exclude_unset=True)
    refill_participant_user_ids = updated_fields.pop("refill_participant_user_ids", None)
    for field, value in updated_fields.items():
        setattr(med, field, value)
    if "start_at" in updated_fields and "schedule_time" not in updated_fields:
        med.schedule_time = med.schedule_time or (med.start_at.strftime("%H:%M") if med.start_at else "")
    med.frequency_per_day = _effective_frequency_per_day_from_values(
        getattr(med, "frequency", "") or "",
        getattr(med, "frequency_per_day", None),
    )
    available_refill_contacts = _medication_refill_contacts(db, target_user_id)
    if bool(getattr(med, "refill_enabled", False)):
        refill_ids = _sanitize_refill_participant_ids(
            refill_participant_user_ids if refill_participant_user_ids is not None else getattr(med, "refill_participants_json", None),
            available_refill_contacts,
            fixed_user_id=getattr(med, "refill_fixed_user_id", None),
            default_all=True,
        )
        med.refill_participants_json = _serialize_refill_participant_ids(refill_ids)
        if str(getattr(med, "refill_mode", None) or "rotativo") == "fijo" and not getattr(med, "refill_fixed_user_id", None):
            med.refill_fixed_user_id = int(refill_ids[0]) if refill_ids else None
    elif refill_participant_user_ids is not None:
        med.refill_participants_json = _serialize_refill_participant_ids(
            _sanitize_refill_participant_ids(
                refill_participant_user_ids,
                available_refill_contacts,
                fixed_user_id=getattr(med, "refill_fixed_user_id", None),
                default_all=False,
            )
        )
    med.stock_total_doses = max(int(getattr(med, "stock_total_doses", 0) or 0), 0)
    med.refill_alert_threshold_doses = max(
        int(getattr(med, "refill_alert_threshold_doses", 0) or 0),
        0,
    )
    if not bool(getattr(med, "refill_enabled", False)) or med.stock_total_doses <= 0:
        med.refill_alert_threshold_doses = 0
        med.refill_last_notified_at = None
        med.refill_last_notified_remaining = None
    elif med.refill_alert_threshold_doses > med.stock_total_doses:
        med.refill_alert_threshold_doses = med.stock_total_doses
    elif (
        previous_last_notified_at is not None
        and med.stock_total_doses > previous_stock_total
    ):
        med.refill_rotation_index = int(getattr(med, "refill_rotation_index", 0) or 0) + 1
        med.refill_last_notified_at = None
        med.refill_last_notified_remaining = None

    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.commit()
    db.refresh(med)
    _attach_medication_adherence(db, [med], current_user, owner_user_id=target_user_id)
    if med.refill_enabled and not previous_refill_enabled:
        try:
            _send_medication_programmed_notifications(
                db,
                med,
                profile=profile,
            )
        except Exception as notify_exc:
            print(f"WARNING medication programmed notifications {med.id}: {notify_exc}")
    return med


@app.post("/medications/{medication_id}/intake", response_model=schemas.MedicationIntakeOut)
async def record_medication_intake(
    medication_id: int,
    payload: schemas.MedicationIntakeCreate | None = None,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ensure_medication_schema(force=True)
    profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
    med = (
        db.query(models.Medication)
        .filter(
            models.Medication.id == medication_id,
            models.Medication.user_id == target_user_id,
        )
        .first()
    )
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento no encontrado")

    ensure_medication_intake_schema()

    requested_status = _normalize_adherence_status(getattr(payload, "status", "taken"))
    scheduled_at, taken_at, normalized_status = _build_medication_event_defaults(
        med,
        requested_status,
        getattr(payload, "scheduled_at", None),
        getattr(payload, "taken_at", None),
    )

    def _write_intake_record():
        intake = None
        if scheduled_at:
            intake = (
                db.query(models.MedicationIntake)
                .filter(
                    models.MedicationIntake.medication_id == medication_id,
                    models.MedicationIntake.user_id == target_user_id,
                    models.MedicationIntake.scheduled_at == scheduled_at,
                )
                .order_by(models.MedicationIntake.id.desc())
                .first()
            )
        if not intake:
            intake = models.MedicationIntake(
                user_id=target_user_id,
                medication_id=medication_id,
            )
        intake.scheduled_at = scheduled_at
        intake.taken_at = taken_at
        intake.status = normalized_status
        intake.source = _safe_text(getattr(payload, "source", "") or "manual")[:40] or "manual"
        intake.notes = _clip_text(getattr(payload, "notes", "") or "", 240)
        db.add(intake)
        db.flush()
        try:
            _mark_profile_ai_dirty(db, profile, include_family=True)
        except Exception as ai_exc:
            print(f"WARNING medication intake: no se pudo marcar refresh de IA: {ai_exc}")
        db.commit()
        db.refresh(intake)
        return intake

    def _is_medication_intake_schema_error(exc: Exception) -> bool:
        detail = str(getattr(exc, "orig", exc) or "").lower()
        return (
            "medication_intakes" in detail
            or "scheduled_at" in detail
            or "status" in detail
            or "source" in detail
            or "notes" in detail
            or "created_at" in detail
            or "no such column" in detail
            or "has no column named" in detail
            or "undefined column" in detail
            or "unknown column" in detail
            or "invalid column name" in detail
        )

    def _legacy_write_taken_intake():
        if normalized_status not in {"taken", "late"}:
            return None
        fallback_taken_at = taken_at or datetime.now()
        fallback_source = _safe_text(getattr(payload, "source", "") or "legacy_fallback")[:40] or "legacy_fallback"
        fallback_notes = _clip_text(getattr(payload, "notes", "") or "", 240)
        created_at = datetime.now()
        inserted_id = None
        backend = engine.url.get_backend_name()
        if backend == "postgresql":
            inserted_id = db.execute(
                text(
                    """
                    INSERT INTO medication_intakes (user_id, medication_id, taken_at)
                    VALUES (:user_id, :medication_id, :taken_at)
                    RETURNING id
                    """
                ),
                {
                    "user_id": target_user_id,
                    "medication_id": medication_id,
                    "taken_at": fallback_taken_at,
                },
            ).scalar()
        else:
            result = db.execute(
                text(
                    """
                    INSERT INTO medication_intakes (user_id, medication_id, taken_at)
                    VALUES (:user_id, :medication_id, :taken_at)
                    """
                ),
                {
                    "user_id": target_user_id,
                    "medication_id": medication_id,
                    "taken_at": fallback_taken_at,
                },
            )
            inserted_id = getattr(result, "lastrowid", None)
        try:
            _mark_profile_ai_dirty(db, profile, include_family=True)
        except Exception as ai_exc:
            print(f"WARNING medication intake legacy fallback: no se pudo marcar refresh de IA: {ai_exc}")
        db.commit()
        return {
            "id": int(inserted_id or 0),
            "medication_id": medication_id,
            "user_id": target_user_id,
            "scheduled_at": scheduled_at,
            "taken_at": fallback_taken_at,
            "status": normalized_status,
            "source": fallback_source,
            "notes": fallback_notes,
            "created_at": created_at,
        }

    try:
        return _write_intake_record()
    except DBAPIError as exc:
        db.rollback()
        if _is_medication_intake_schema_error(exc):
            print(
                "WARNING medication intake: se detecto esquema desfasado, reintentando "
                f"(medication_id={medication_id}, user_id={target_user_id}): {exc}"
            )
            ensure_medication_intake_schema()
            db.expire_all()
            try:
                return _write_intake_record()
            except Exception as retry_exc:
                db.rollback()
                if _is_medication_intake_schema_error(retry_exc):
                    try:
                        legacy_intake = _legacy_write_taken_intake()
                        if legacy_intake:
                            print(
                                "WARNING medication intake: se uso fallback legado para registrar la toma "
                                f"(medication_id={medication_id}, user_id={target_user_id})"
                            )
                            return legacy_intake
                    except Exception as legacy_exc:
                        db.rollback()
                        print(
                            "WARNING medication intake: fallo fallback legado "
                            f"(medication_id={medication_id}, user_id={target_user_id}): {legacy_exc}"
                        )
                print(
                    "WARNING medication intake: fallo tras reintento "
                    f"(medication_id={medication_id}, status={normalized_status}, scheduled_at={scheduled_at}, "
                    f"taken_at={taken_at}, user_id={target_user_id}): {retry_exc}"
                )
                raise HTTPException(status_code=500, detail="No se pudo registrar la toma")
        print(
            "WARNING medication intake: error SQL no recuperable "
            f"(medication_id={medication_id}, status={normalized_status}, scheduled_at={scheduled_at}, "
            f"taken_at={taken_at}, user_id={target_user_id}): {exc}"
        )
        raise HTTPException(status_code=500, detail="No se pudo registrar la toma")
    except Exception as exc:
        db.rollback()
        print(
            "WARNING medication intake: no se pudo registrar la toma "
            f"(medication_id={medication_id}, status={normalized_status}, scheduled_at={scheduled_at}, "
            f"taken_at={taken_at}, user_id={target_user_id}): {exc}"
        )
        raise HTTPException(status_code=500, detail="No se pudo registrar la toma")


@app.get("/medications/{medication_id}/intakes", response_model=schemas.MedicationIntakeListOut)
async def list_medication_intakes(
    medication_id: int,
    limit: int = 40,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ensure_medication_schema(force=True)
    _, _, target_user_id = _get_active_profile_context(db, current_user, require_write=False)
    med = (
        db.query(models.Medication)
        .filter(
            models.Medication.id == medication_id,
            models.Medication.user_id == target_user_id,
        )
        .first()
    )
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento no encontrado")
    items = (
        db.query(models.MedicationIntake)
        .filter(
            models.MedicationIntake.medication_id == medication_id,
            models.MedicationIntake.user_id == target_user_id,
        )
        .order_by(models.MedicationIntake.created_at.desc(), models.MedicationIntake.id.desc())
        .limit(max(1, min(int(limit or 40), 120)))
        .all()
    )
    return {"medication_id": medication_id, "items": items}


@app.get("/medications/purchases", response_model=List[schemas.MedicationPurchaseOut])
async def list_medication_purchases(
    medication_id: int | None = None,
    limit: int = 40,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ensure_medication_schema(force=True)
    ensure_medication_purchase_schema(force=True)
    _, _, target_user_id = _get_active_profile_context(db, current_user, require_write=False)
    query = db.query(models.MedicationPurchase).filter(
        models.MedicationPurchase.user_id == target_user_id,
    )
    if medication_id:
        query = query.filter(models.MedicationPurchase.medication_id == int(medication_id))
    items = (
        query.order_by(
            models.MedicationPurchase.purchased_at.desc(),
            models.MedicationPurchase.id.desc(),
        )
        .limit(max(1, min(int(limit or 40), 120)))
        .all()
    )
    return [_decorate_medication_purchase(item) for item in items]


@app.post("/medications/{medication_id}/purchases", response_model=schemas.MedicationPurchaseOut)
async def create_medication_purchase(
    medication_id: int,
    new_stock_total_doses: int = Form(...),
    amount_total: str | None = Form(None),
    currency: str | None = Form("CLP"),
    notes: str | None = Form(""),
    purchased_at: str | None = Form(None),
    receipt: UploadFile | None = File(None),
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ensure_medication_schema(force=True)
    ensure_medication_purchase_schema(force=True)
    profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
    med = (
        db.query(models.Medication)
        .filter(
            models.Medication.id == medication_id,
            models.Medication.user_id == target_user_id,
        )
        .first()
    )
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento no encontrado")

    normalized_amount = None
    if amount_total not in (None, ""):
        try:
            normalized_amount = max(float(str(amount_total).replace(",", ".").strip()), 0.0)
        except Exception:
            raise HTTPException(status_code=400, detail="El monto ingresado no es válido")

    parsed_purchased_at = None
    if purchased_at:
        try:
            parsed_purchased_at = datetime.fromisoformat(str(purchased_at).strip().replace("Z", "+00:00"))
            if getattr(parsed_purchased_at, "tzinfo", None) is not None:
                parsed_purchased_at = parsed_purchased_at.replace(tzinfo=None)
        except Exception:
            raise HTTPException(status_code=400, detail="La fecha de compra no es válida")

    receipt_filename = None
    receipt_mime_type = None
    receipt_bytes = None
    if receipt is not None:
        receipt_bytes = await receipt.read()
        if receipt_bytes:
            receipt_mime_type, receipt_filename = _validate_upload(
                receipt_bytes,
                receipt.filename or "boleta",
            )
        else:
            receipt_bytes = None

    purchase = _record_medication_purchase(
        db,
        med,
        profile,
        current_user,
        new_stock_total_doses=new_stock_total_doses,
        amount_total=normalized_amount,
        currency=currency,
        notes=notes,
        purchased_at=parsed_purchased_at,
        receipt_filename=receipt_filename,
        receipt_mime_type=receipt_mime_type,
        receipt_bytes=receipt_bytes,
    )
    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.commit()
    db.refresh(med)
    db.refresh(purchase)
    _decorate_medication_purchase(purchase)
    try:
        _send_medication_purchase_notifications(
            db,
            med,
            purchase,
            profile=profile,
        )
    except Exception as notify_exc:
        print(f"WARNING medication purchase notifications {purchase.id}: {notify_exc}")
    return purchase


@app.get("/medications/purchases/{purchase_id}/receipt")
async def get_medication_purchase_receipt(
    purchase_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ensure_medication_purchase_schema(force=True)
    _, _, target_user_id = _get_active_profile_context(db, current_user, require_write=False)
    purchase = (
        db.query(models.MedicationPurchase)
        .filter(
            models.MedicationPurchase.id == purchase_id,
            models.MedicationPurchase.user_id == target_user_id,
        )
        .first()
    )
    if not purchase or not getattr(purchase, "receipt_file_data", None):
        raise HTTPException(status_code=404, detail="Boleta no encontrada")
    filename = getattr(purchase, "receipt_filename", None) or f"boleta-medicamento-{purchase.id}"
    mime_type = getattr(purchase, "receipt_mime_type", None) or "application/octet-stream"
    return Response(
        content=purchase.receipt_file_data,
        media_type=mime_type,
        headers={"Content-Disposition": f'inline; filename=\"{filename}\"'},
    )


@app.post("/medications/{medication_id}/mark-purchased", response_model=schemas.MedicationOut)
async def mark_medication_refill_purchased(
    medication_id: int,
    payload: dict = {},
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Marca un medicamento como reabastecido. Actualiza el stock total,
    avanza el índice de rotación (siguiente responsable en turno)
    y limpia el estado de notificación para permitir nuevo ciclo.
    """
    ensure_medication_schema(force=True)
    ensure_medication_purchase_schema(force=True)
    profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
    med = (
        db.query(models.Medication)
        .filter(
            models.Medication.id == medication_id,
            models.Medication.user_id == target_user_id,
        )
        .first()
    )
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento no encontrado")
    new_stock = int((payload or {}).get("new_stock_total_doses", 0) or 0)
    amount_total = (payload or {}).get("amount_total", None)
    normalized_amount = None
    if amount_total not in (None, ""):
        try:
            normalized_amount = max(float(str(amount_total).replace(",", ".").strip()), 0.0)
        except Exception:
            raise HTTPException(status_code=400, detail="El monto ingresado no es válido")
    purchase = _record_medication_purchase(
        db,
        med,
        profile,
        current_user,
        new_stock_total_doses=new_stock,
        amount_total=normalized_amount,
        currency=(payload or {}).get("currency", "CLP"),
        notes=(payload or {}).get("notes", ""),
    )
    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.add(med)
    db.commit()
    db.refresh(med)
    db.refresh(purchase)
    try:
        _send_medication_purchase_notifications(
            db,
            med,
            purchase,
            profile=profile,
        )
    except Exception as notify_exc:
        print(f"WARNING medication purchase notifications {purchase.id}: {notify_exc}")
    _attach_medication_adherence(db, [med], current_user, owner_user_id=target_user_id)
    return med



@app.delete("/medications/{medication_id}")
async def delete_medication(
    medication_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ensure_medication_schema(force=True)
    ensure_medication_purchase_schema(force=True)
    profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
    med = (
        db.query(models.Medication)
        .filter(
            models.Medication.id == medication_id,
            models.Medication.user_id == target_user_id,
        )
        .first()
    )
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento no encontrado")
    db.query(models.MedicationIntake).filter(
        models.MedicationIntake.medication_id == medication_id,
        models.MedicationIntake.user_id == target_user_id,
    ).delete()
    db.query(models.MedicationPurchase).filter(
        models.MedicationPurchase.medication_id == medication_id,
        models.MedicationPurchase.user_id == target_user_id,
    ).delete()
    db.query(models.AdherenceSummary).filter(
        models.AdherenceSummary.medication_id == medication_id,
    ).delete()
    db.delete(med)
    _mark_profile_ai_dirty(db, profile, include_family=True)
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
        raise HTTPException(status_code=400, detail="Suscripción incompleta")

    existing = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.endpoint == sub_in.endpoint)
        .first()
    )

    if existing:
        existing.user_id = current_user.id
        existing.p256dh = p256dh
        existing.auth = auth_key
        existing.created_at = datetime.now()
        try:
            db.commit()
            db.refresh(existing)
            _prune_push_subscriptions_for_user(db, int(current_user.id), keep=5)
            return existing
        except Exception as exc:
            db.rollback()
            print(f"WARNING push subscribe: no se pudo actualizar endpoint existente: {exc}")
            raise HTTPException(status_code=503, detail="No se pudo registrar la suscripción push")

    sub = models.PushSubscription(
        user_id=current_user.id,
        endpoint=sub_in.endpoint,
        p256dh=p256dh,
        auth=auth_key,
    )
    db.add(sub)
    try:
        db.commit()
        db.refresh(sub)
        _prune_push_subscriptions_for_user(db, int(current_user.id), keep=5)
        return sub
    except IntegrityError:
        db.rollback()
        recovered = (
            db.query(models.PushSubscription)
            .filter(models.PushSubscription.endpoint == sub_in.endpoint)
            .first()
        )
        if recovered:
            recovered.user_id = current_user.id
            recovered.p256dh = p256dh
            recovered.auth = auth_key
            recovered.created_at = datetime.now()
            try:
                db.commit()
                db.refresh(recovered)
                _prune_push_subscriptions_for_user(db, int(current_user.id), keep=5)
                return recovered
            except Exception as exc:
                db.rollback()
                print(f"WARNING push subscribe: no se pudo recuperar suscripcion duplicada: {exc}")
        raise HTTPException(status_code=503, detail="No se pudo registrar la suscripción push")
    except Exception as exc:
        db.rollback()
        print(f"WARNING push subscribe: error inesperado registrando suscripcion: {exc}")
        raise HTTPException(status_code=503, detail="No se pudo registrar la suscripción push")


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
    if not _push_configured():
        raise HTTPException(
            status_code=400,
            detail="Configuración VAPID incompleta en el servidor",
        )
    subscriptions = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == current_user.id)
        .order_by(models.PushSubscription.created_at.desc())
        .all()
    )
    if not subscriptions:
        raise HTTPException(
            status_code=404, detail="No hay suscripción push para el usuario"
        )
    ok = False
    for sub in subscriptions:
        ok = send_web_push(
            sub,
            {
                "title": "Prueba de notificaciones",
                "body": "Notificación push de prueba",
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
    if not _push_configured():
        raise HTTPException(
            status_code=400,
            detail="Configuración VAPID incompleta en el servidor",
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
            message = "Tu cita es mañana"
            priority = "high"
        elif days_until == 3:
            should_send = True
            message = "Tu cita es en 3 días"
            priority = "normal"
        elif days_until == 7:
            should_send = True
            message = "Tu cita es en una semana"
            priority = "low"

        if should_send:
            title = f"Recordatorio: {appt.specialty or appt.type}"
            when_text = appt_dt.strftime("%d/%m/%Y %H:%M")
            center = appt.center or "Centro médico"
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
    if not _push_configured():
        raise HTTPException(
            status_code=400,
            detail="Configuración VAPID incompleta en el servidor",
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
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # Eliminar cuenta es una acción irreversible: requiere step-up
    _check_stepup(request, current_user)
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


# ─── Upload safety ────────────────────────────────────────────────────────────

# Tipos MIME permitidos para documentos clínicos
_ALLOWED_MIME_TYPES: dict[str, str] = {
    "application/pdf":  ".pdf",
    "image/jpeg":       ".jpg",
    "image/png":        ".png",
    "image/tiff":       ".tif",
    "image/webp":       ".webp",
    "image/heic":       ".heic",
    "image/heif":       ".heif",
}

# Magic bytes → MIME type (primeros bytes del archivo)
_MAGIC_BYTES: list[tuple[bytes, str]] = [
    (b"%PDF-",        "application/pdf"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n",  "image/png"),
    (b"II*\x00",      "image/tiff"),  # TIFF little-endian
    (b"MM\x00*",      "image/tiff"),  # TIFF big-endian
    (b"RIFF",         "image/webp"),  # verificación parcial: también revisar bytes 8-12
]

# Firmas de archivos peligrosos a rechazar (ejecutables, scripts)
_DANGEROUS_SIGNATURES: list[bytes] = [
    b"MZ",              # PE executable (Windows)
    b"\x7fELF",         # ELF (Linux)
    b"\xca\xfe\xba\xbe",# Mach-O fat binary
    b"\xfe\xed\xfa\xce",# Mach-O 32-bit
    b"\xfe\xed\xfa\xcf",# Mach-O 64-bit
    b"#!/",             # shell script shebang
    b"<?php",           # PHP
    b"<script",         # JS/HTML injection
]

# Extensiones prohibidas (independent of MIME)
_BLOCKED_EXTENSIONS = {
    ".exe", ".dll", ".so", ".bat", ".cmd", ".ps1", ".vbs",
    ".sh", ".bash", ".zsh", ".py", ".rb", ".pl", ".php",
    ".js", ".ts", ".html", ".htm", ".xml", ".svg", ".zip",
    ".tar", ".gz", ".rar", ".7z", ".iso", ".img",
}


def _detect_mime_from_magic(data: bytes) -> str:
    """Detecta tipo MIME por magic bytes (primeros bytes del archivo)."""
    if not data:
        return "application/octet-stream"
    for magic, mime in _MAGIC_BYTES:
        if data[:len(magic)] == magic:
            # Verificar WEBP completo: RIFF????WEBP
            if mime == "image/webp" and not (len(data) >= 12 and data[8:12] == b"WEBP"):
                continue
            return mime
    # HEIC/HEIF: magic a offset 4
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand in (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"):
            return "image/heic"
    return "application/octet-stream"


def _sanitize_filename(filename: str) -> str:
    """Limpia el nombre de archivo: elimina rutas, reemplaza caracteres peligrosos."""
    # Quitar componentes de ruta
    name = os.path.basename(filename)
    # Eliminar caracteres peligrosos
    name = re.sub(r'[^\w\s.\-()]', '_', name).strip()
    # Limitar longitud
    if len(name) > 200:
        base, ext = os.path.splitext(name)
        name = base[:196] + ext
    return name or "document"


def _validate_upload(content: bytes, filename: str, max_bytes: int | None = None) -> tuple[str, str]:
    """
    Valida el archivo subido: tamaño, magic bytes, extensión, firmas peligrosas.
    Devuelve (mime_type, safe_filename) o lanza HTTPException.
    """
    if max_bytes is None:
        max_bytes = MAX_UPLOAD_BYTES
    if not content:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")

    if len(content) > max_bytes:
        mb = max_bytes // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"Archivo demasiado grande. Máximo permitido: {mb} MB.")

    safe_filename = _sanitize_filename(filename)
    _, ext = os.path.splitext(safe_filename.lower())

    # Rechazar extensiones prohibidas
    if ext in _BLOCKED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Tipo de archivo no permitido: {ext}")

    # Rechazar firmas peligrosas
    for sig in _DANGEROUS_SIGNATURES:
        if content[: len(sig)].lower() == sig.lower():
            raise HTTPException(status_code=415, detail="Archivo rechazado: tipo no seguro.")

    # Detectar MIME real por magic bytes
    detected_mime = _detect_mime_from_magic(content)

    if detected_mime not in _ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Solo se permiten PDF, JPEG, PNG, TIFF, WEBP y HEIC/HEIF.",
        )

    # Coherencia entre extensión declarada y contenido real
    expected_ext = _ALLOWED_MIME_TYPES[detected_mime]
    common_aliases = {
        "image/jpeg": {".jpg", ".jpeg", ".jpe", ""},
        "image/tiff": {".tif", ".tiff", ""},
        "image/heic": {".heic", ".heif", ""},
    }
    aliases = common_aliases.get(detected_mime, {expected_ext, ""})
    if ext and ext not in aliases and ext != expected_ext:
        # Extensión no coincide con contenido — posible spoofing
        # No rechazamos, pero registramos la extensión "real"
        safe_filename = os.path.splitext(safe_filename)[0] + expected_ext

    return detected_mime, safe_filename


# ─── Suspicious activity tracker (download burst) ─────────────────────────────

_download_tracker: dict = collections.defaultdict(list)
_download_lock = threading.Lock()
_MAX_DOWNLOADS_WINDOW = int(os.getenv("MAX_DOWNLOADS_WINDOW", "20"))   # intentos máximos
_DOWNLOADS_WINDOW_SECS = int(os.getenv("DOWNLOADS_WINDOW_SECS", "300")) # ventana en segundos (5 min)


def _track_download(user_id: int) -> bool:
    """
    Registra un acceso de descarga. Devuelve True si el patrón es sospechoso
    (burst de descargas en poco tiempo).
    """
    key = f"dl:{user_id}"
    now = time.time()
    with _download_lock:
        _download_tracker[key] = [
            t for t in _download_tracker[key]
            if now - t < _DOWNLOADS_WINDOW_SECS
        ]
        count = len(_download_tracker[key])
        _download_tracker[key].append(now)
    return count >= _MAX_DOWNLOADS_WINDOW


# Documents
UPLOAD_DIR = "uploaded_docs"
os.makedirs(UPLOAD_DIR, exist_ok=True)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@app.get("/documents", response_model=List[schemas.DocumentOut])
async def list_documents(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, _, target_user_id = _get_active_profile_context(db, current_user)
    docs = (
        db.query(models.Document)
        .filter(*_document_scope_filter(profile, target_user_id))
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
    profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
    # Leer y validar el archivo
    file_content = await file.read()
    original_filename = file.filename or "document"
    _detected_mime, safe_filename = _validate_upload(file_content, original_filename)

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
        user_id=target_user_id,
        profile_id=int(getattr(profile, "id", 0) or 0) or None,
        appointment_id=appointment_id,
        doc_type=models.DocumentType(doc_type),
        file_data=file_content,
        filename=safe_filename,   # nombre saneado
        file_path=file_path_placeholder,
        date=parsed_date,
        center=center or "",
        notes=notes or "",
        ocr_status="pending",
        ocr_lang=OCR_LANG_DEFAULT,
    )
    db.add(doc)
    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.commit()
    db.refresh(doc)
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
    profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
    doc = (
        db.query(models.Document)
        .filter(
            models.Document.id == document_id,
            *_document_scope_filter(profile, target_user_id),
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    # Borrar archivo físico
    if doc.file_path and os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    db.query(models.AiDocumentChunk).filter(models.AiDocumentChunk.document_id == doc.id).delete()
    db.query(models.DocumentClinicalEntity).filter(models.DocumentClinicalEntity.document_id == doc.id).delete()
    db.query(models.DocumentSummary).filter(models.DocumentSummary.document_id == doc.id).delete()
    db.delete(doc)
    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.commit()
    return {"ok": True}


@app.put("/documents/{document_id}", response_model=schemas.DocumentOut)
async def update_document(
    document_id: int,
    doc_in: schemas.DocumentUpdate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    profile, _, target_user_id = _get_active_profile_context(db, current_user, require_write=True)
    doc = (
        db.query(models.Document)
        .filter(
            models.Document.id == document_id,
            *_document_scope_filter(profile, target_user_id),
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    for field, value in doc_in.dict(exclude_unset=True).items():
        setattr(doc, field, value)
    _mark_profile_ai_dirty(db, profile, include_family=True)
    db.commit()
    db.refresh(doc)
    return doc


# Endpoint protegido para servir documentos
@app.get("/documents/{document_id}/file")
async def get_document_file(
    request: Request,
    document_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Sirve un archivo de documento solo si el usuario tiene acceso."""
    profile, link, target_user_id = _get_active_profile_context(db, current_user)

    # Verificar permiso granular de descarga (owners siempre pueden)
    if profile.owner_user_id != current_user.id:
        if not _check_permission(db, current_user, profile.id, "download_documents"):
            raise HTTPException(
                status_code=403,
                detail="No tienes permiso para descargar documentos de este perfil.",
            )

    # Step-up requerido para descargar documentos clínicos
    _check_stepup(request, current_user)

    doc = (
        db.query(models.Document)
        .filter(
            models.Document.id == document_id,
            *_document_scope_filter(profile, target_user_id),
        )
        .first()
    )

    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    # Detectar ráfaga de descargas (actividad sospechosa)
    if _track_download(current_user.id):
        _write_audit_log(
            db, "suspicious_download_burst",
            user_id=current_user.id,
            resource_type="document",
            ip_address=_get_client_ip(request),
            user_agent=request.headers.get("user-agent", ""),
            metadata={"document_id": document_id, "window_secs": _DOWNLOADS_WINDOW_SECS},
        )

    # Registrar descarga en audit log
    _write_audit_log(
        db, "document_downloaded",
        user_id=current_user.id,
        resource_type="document",
        resource_id=document_id,
        ip_address=_get_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        metadata={"filename": doc.filename or ""},
    )

    # Prioridad 1: Archivo almacenado en BD (file_data)
    if doc.file_data:
        filename = doc.filename or f"document_{doc.id}"
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type:
            mime_type = "application/octet-stream"
        return Response(
            content=doc.file_data,
            media_type=mime_type,
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )

    # Prioridad 2: Archivo en sistema de archivos (compatibilidad con documentos antiguos)
    if doc.file_path:
        file_path_to_check = doc.file_path
        if not os.path.isabs(file_path_to_check):
            file_path_to_check = os.path.abspath(file_path_to_check)

        if not os.path.exists(file_path_to_check):
            relative_path = doc.file_path
            if not relative_path.startswith(UPLOAD_DIR):
                relative_path = os.path.join(UPLOAD_DIR, os.path.basename(doc.file_path))
            relative_path = os.path.abspath(relative_path)
            if os.path.exists(relative_path):
                file_path_to_check = relative_path

        if os.path.exists(file_path_to_check):
            mime_type, _ = mimetypes.guess_type(file_path_to_check)
            if not mime_type:
                mime_type = "application/octet-stream"
            return FileResponse(
                file_path_to_check,
                media_type=mime_type,
                filename=os.path.basename(file_path_to_check),
            )

    raise HTTPException(status_code=404, detail="Archivo no encontrado")


# ─── KlinipFeed ───────────────────────────────────────────────────────────────

def _get_family_user_ids(db: Session, current_user) -> set:
    """Retorna el conjunto de user_ids que comparten al menos un perfil con current_user."""
    owned_profile_ids = [
        p.id for p in db.query(models.HealthProfile)
        .filter(
            models.HealthProfile.owner_user_id == current_user.id,
            models.HealthProfile.is_archived == False,
        ).all()
    ]
    linked_profile_ids = [
        r.profile_id for r in db.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.user_id == current_user.id,
            models.ProfileRelationship.status == "accepted",
        ).all()
    ]
    all_profile_ids = list(set(owned_profile_ids + linked_profile_ids))
    if not all_profile_ids:
        return {current_user.id}

    owner_ids = [
        p.owner_user_id for p in db.query(models.HealthProfile)
        .filter(models.HealthProfile.id.in_(all_profile_ids)).all()
    ]
    relation_user_ids = [
        r.user_id for r in db.query(models.ProfileRelationship)
        .filter(
            models.ProfileRelationship.profile_id.in_(all_profile_ids),
            models.ProfileRelationship.status == "accepted",
        ).all()
    ]
    return set(owner_ids + relation_user_ids + [current_user.id])


def _get_user_avatar_url(user) -> str:
    """Devuelve el avatar_url del perfil primario del usuario, o '' si no tiene."""
    if not user:
        return ""
    primary = next(
        (p for p in user.health_profiles_owned if p.is_primary_profile and not p.is_archived),
        None,
    )
    if primary and primary.avatar_url and primary.avatar_url.startswith("data:"):
        return primary.avatar_url
    return ""


def _parse_comment_mentions(raw_value) -> list[int]:
    if not raw_value:
        return []
    if isinstance(raw_value, list):
        values = raw_value
    else:
        try:
            values = json.loads(raw_value)
        except Exception:
            return []

    mention_ids = []
    for value in values:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed not in mention_ids:
            mention_ids.append(parsed)
    return mention_ids


def _serialize_comment(comment: models.PostComment, current_user_id: int | None = None) -> dict:
    likes = list(getattr(comment, "likes", []) or [])
    return {
        "id": comment.id,
        "post_id": comment.post_id,
        "user_id": comment.user_id,
        "user_name": comment.user.name if comment.user else "",
        "user_avatar_url": _get_user_avatar_url(comment.user),
        "parent_comment_id": comment.parent_comment_id,
        "mention_user_ids": _parse_comment_mentions(getattr(comment, "mentions_json", "")),
        "likes_count": len(likes),
        "my_like": any(like.user_id == current_user_id for like in likes) if current_user_id is not None else False,
        "content": comment.content,
        "created_at": comment.created_at.strftime("%Y-%m-%dT%H:%M:%S") if comment.created_at else None,
    }


def _can_access_feed_post(db: Session, current_user, post: models.FeedPost) -> bool:
    if not post:
        return False
    if post.user_id == current_user.id:
        return True
    family_ids = _get_family_user_ids(db, current_user)
    return post.user_id in family_ids


def _ensure_feed_post_access(db: Session, current_user, post: models.FeedPost) -> None:
    if not _can_access_feed_post(db, current_user, post):
        raise HTTPException(status_code=403, detail="Sin acceso a esta publicación")


def _resolve_feed_comment_mentions(
    db: Session,
    current_user,
    post: models.FeedPost,
    requested_ids,
) -> list[int]:
    allowed_user_ids = _get_family_user_ids(db, current_user) | {post.user_id}
    mention_ids = []
    for raw_id in requested_ids or []:
        try:
            user_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if user_id in allowed_user_ids and user_id not in mention_ids:
            mention_ids.append(user_id)
    return mention_ids


def _get_feed_comment_participants(db: Session, post_id: int) -> set[int]:
    rows = (
        db.query(models.PostComment.user_id)
        .filter(models.PostComment.post_id == post_id)
        .distinct()
        .all()
    )
    return {int(row[0]) for row in rows if row and row[0] is not None}


def _serialize_post(post: models.FeedPost, db: Session, current_user_id: int) -> dict:
    my_reaction = None
    for r in post.reactions:
        if r.user_id == current_user_id:
            my_reaction = r.reaction_type
            break

    user_avatar_url = _get_user_avatar_url(post.user)

    return {
        "id": post.id,
        "user_id": post.user_id,
        "user_name": post.user.name if post.user else "",
        "user_avatar_url": user_avatar_url,
        "profile_id": post.profile_id,
        "profile_name": post.profile.full_name if post.profile else "",
        "content": post.content,
        "post_type": post.post_type,
        "privacy": post.privacy,
        "linked_document_id": post.linked_document_id,
        "mention_profile_ids": [m.tagged_profile_id for m in post.mentions],
        "reactions_count": len(post.reactions),
        "my_reaction": my_reaction,
        "comments_count": len(post.comments),
        "attachments": [
            {
                "id": a.id,
                "post_id": a.post_id,
                "attachment_type": a.attachment_type,
                "filename": a.filename,
                "created_at": a.created_at.strftime("%Y-%m-%dT%H:%M:%S") if a.created_at else None,
            }
            for a in post.attachments
        ],
        "comments": [
            _serialize_comment(c, current_user_id)
            for c in sorted(post.comments, key=lambda x: (x.created_at or datetime.min, x.id or 0))
        ],
        "created_at": post.created_at.strftime("%Y-%m-%dT%H:%M:%S") if post.created_at else None,
        "updated_at": post.updated_at.strftime("%Y-%m-%dT%H:%M:%S") if post.updated_at else None,
    }


def _build_feed_video_mp4_name(filename: str = "") -> str:
    original = Path(filename or "video").stem.strip() or "video"
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", original).strip("-") or "video"
    return f"{safe_name}.mp4"


def _transcode_feed_video_to_mp4(file_data: bytes, filename: str = ""):
    if not file_data:
        return None
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
    except ImportError:
        return None

    ffmpeg_exe = get_ffmpeg_exe()
    source_suffix = Path(filename or "video.mov").suffix or ".mov"
    target_name = _build_feed_video_mp4_name(filename)
    input_path = None
    output_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=source_suffix) as source_file:
            source_file.write(file_data)
            input_path = source_file.name
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as target_file:
            output_path = target_file.name

        command = [
            ffmpeg_exe,
            "-y",
            "-i",
            input_path,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            output_path,
        ]
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            timeout=240,
        )
        if completed.returncode != 0 or not os.path.exists(output_path):
            return None
        with open(output_path, "rb") as transcoded_file:
            transcoded_data = transcoded_file.read()
        if not transcoded_data:
            return None
        return transcoded_data, target_name
    except Exception:
        return None
    finally:
        for path in (input_path, output_path):
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass


def _ensure_feed_video_web_compatible(attachment, db: Session):
    if not attachment or attachment.attachment_type != "video" or not attachment.file_data:
        return attachment
    ext = Path(attachment.filename or "").suffix.lower()
    if ext == ".mp4":
        return attachment
    transcoded = _transcode_feed_video_to_mp4(attachment.file_data, attachment.filename or "")
    if not transcoded:
        return attachment
    transcoded_data, transcoded_name = transcoded
    attachment.file_data = transcoded_data
    attachment.filename = transcoded_name
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


_REACTION_EMOJIS = {
    "apoyo": "💙",
    "animo": "💪",
    "amor": "❤️",
    "gracias": "🙏",
    "alegra": "😊",
}


def _build_feed_notification_payload(
    actor_user,
    post,
    notification_type: str,
    recipient_user_id: int,
    extra: dict | None = None,
):
    extra = extra or {}
    actor_name = actor_user.name or "Alguien"
    profile_name = post.profile.full_name if post.profile else ""
    content_preview = (post.content or "")[:60]
    if len(post.content or "") > 60:
        content_preview += "…"

    if notification_type == "post":
        title = f"Nueva publicación de {actor_name}"
        body = content_preview if content_preview else f"Publicó en el feed de {profile_name}"
        tag = f"feed-post-{post.id}-{recipient_user_id}"
    elif notification_type == "comment":
        comment_content = extra.get("comment_content") or ""
        comment_text = comment_content[:60]
        if len(comment_content) > 60:
            comment_text += "…"
        mention_user_ids = set(extra.get("mention_user_ids") or [])
        parent_comment_user_id = extra.get("parent_comment_user_id")
        if recipient_user_id in mention_user_ids:
            title = f"{actor_name} te mencionó"
            body = comment_text if comment_text else f"Te mencionó en una publicación de {profile_name}"
        elif extra.get("is_reply") and recipient_user_id == parent_comment_user_id:
            title = f"{actor_name} respondió tu comentario"
            body = comment_text if comment_text else f"Respondió en una publicación de {profile_name}"
        elif recipient_user_id == post.user_id:
            title = f"{actor_name} comentó tu publicación"
            body = comment_text if comment_text else f"Hay actividad en una publicación de {profile_name}"
        else:
            title = f"{actor_name} comentó"
            body = comment_text if comment_text else f"Hay actividad en una publicación de {profile_name}"
        tag = f"feed-comment-{extra.get('comment_id', post.id)}-{recipient_user_id}"
    elif notification_type == "reaction":
        reaction_type = extra.get("reaction_type", "")
        emoji = _REACTION_EMOJIS.get(reaction_type, "👍")
        title = f"{actor_name} reaccionó {emoji}"
        body = f"Reaccionó a una publicación de {profile_name}"
        tag = f"feed-reaction-{post.id}-{actor_user.id}-{recipient_user_id}"
    else:
        return None

    return {
        "title": title,
        "body": body,
        "url": f"/feed?postId={post.id}",
        "tag": tag,
        "priority": "normal",
        "sound": "default",
        "kind": "feed",
        "postId": post.id,
        "commentId": extra.get("comment_id"),
        "parentCommentId": extra.get("parent_comment_id"),
        "userId": recipient_user_id,
        "actorUserId": actor_user.id,
    }


def _send_feed_notification_to_users(
    db,
    actor_user,
    post,
    notification_type: str,
    recipients,
    extra: dict | None = None,
):
    extra = extra or {}
    recipient_ids = {int(uid) for uid in (recipients or set()) if uid is not None}
    recipient_ids.discard(actor_user.id)
    if not recipient_ids:
        return
    for uid in recipient_ids:
        payload = _build_feed_notification_payload(actor_user, post, notification_type, uid, extra)
        if payload:
            _send_push_to_user(db, uid, payload)


def _send_feed_notification_to_family(
    db,
    actor_user,
    post,
    notification_type: str,
    extra: dict = None,
):
    try:
        family_ids = _get_family_user_ids(db, actor_user)
        recipients = family_ids - {actor_user.id}
        _send_feed_notification_to_users(
            db,
            actor_user,
            post,
            notification_type,
            recipients,
            extra,
        )
    except Exception as exc:
        print(f"WARNING feed push: error enviando notificacion feed: {exc}")


def _send_feed_comment_notifications(
    db: Session,
    actor_user,
    post: models.FeedPost,
    comment: models.PostComment,
    mention_user_ids: list[int],
    parent_comment: models.PostComment | None = None,
):
    try:
        family_ids = _get_family_user_ids(db, actor_user) | {post.user_id}
        participant_ids = _get_feed_comment_participants(db, post.id)
        recipients = ({post.user_id} | participant_ids | set(mention_user_ids or [])) & family_ids
        if parent_comment and parent_comment.user_id in family_ids:
            recipients.add(parent_comment.user_id)
        _send_feed_notification_to_users(
            db,
            actor_user,
            post,
            "comment",
            recipients,
            {
                "comment_id": comment.id,
                "comment_content": comment.content,
                "mention_user_ids": mention_user_ids or [],
                "parent_comment_id": comment.parent_comment_id,
                "parent_comment_user_id": parent_comment.user_id if parent_comment else None,
                "is_reply": bool(parent_comment),
            },
        )
    except Exception as exc:
        print(f"WARNING feed push: error enviando notificacion de comentario: {exc}")


def _get_feed_profile_with_access(db: Session, current_user, profile_id: int):
    profile = db.query(models.HealthProfile).filter(
        models.HealthProfile.id == profile_id
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil no encontrado")

    has_access = profile.owner_user_id == current_user.id or db.query(
        models.ProfileRelationship
    ).filter(
        models.ProfileRelationship.profile_id == profile_id,
        models.ProfileRelationship.user_id == current_user.id,
        models.ProfileRelationship.status == "accepted",
    ).first() is not None

    if not has_access:
        raise HTTPException(status_code=403, detail="Sin acceso a este perfil")
    return profile


@app.get("/feed/family")
def get_family_feed(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    family_ids = _get_family_user_ids(db, current_user)
    posts = (
        db.query(models.FeedPost)
        .filter(
            models.FeedPost.user_id.in_(family_ids),
            models.FeedPost.privacy == "family",
        )
        .order_by(models.FeedPost.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_serialize_post(p, db, current_user.id) for p in posts]


@app.post("/feed/posts", status_code=201)
def create_feed_post(
    payload: schemas.FeedPostCreate,
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    profile = _get_feed_profile_with_access(db, current_user, payload.profile_id)

    post = models.FeedPost(
        user_id=current_user.id,
        profile_id=payload.profile_id,
        content=payload.content,
        post_type=payload.post_type,
        privacy=payload.privacy,
        linked_document_id=payload.linked_document_id,
    )
    db.add(post)
    db.flush()

    for pid in (payload.mention_profile_ids or []):
        db.add(models.PostMention(post_id=post.id, tagged_profile_id=pid))

    db.commit()
    db.refresh(post)
    _send_feed_notification_to_family(db, current_user, post, "post")
    return _serialize_post(post, db, current_user.id)


@app.put("/feed/posts/{post_id}")
def update_feed_post(
    post_id: int,
    payload: schemas.FeedPostUpdate,
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    post = db.query(models.FeedPost).filter(models.FeedPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    if post.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes editar este post")

    _get_feed_profile_with_access(db, current_user, payload.profile_id)

    post.profile_id = payload.profile_id
    post.content = payload.content
    post.post_type = payload.post_type
    post.privacy = payload.privacy
    post.linked_document_id = payload.linked_document_id

    db.query(models.PostMention).filter(
        models.PostMention.post_id == post.id
    ).delete(synchronize_session=False)
    for pid in (payload.mention_profile_ids or []):
        db.add(models.PostMention(post_id=post.id, tagged_profile_id=pid))

    db.commit()
    db.refresh(post)
    return _serialize_post(post, db, current_user.id)


@app.post("/feed/posts/{post_id}/attachments", status_code=201)
async def add_post_attachment(
    post_id: int,
    file: UploadFile = File(...),
    attachment_type: str = Form("image"),
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    post = db.query(models.FeedPost).filter(models.FeedPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    if post.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes modificar este post")

    file_data = await file.read()
    normalized_filename = file.filename or ""
    if attachment_type == "video":
        transcoded = _transcode_feed_video_to_mp4(file_data, normalized_filename)
        if transcoded:
            file_data, normalized_filename = transcoded
    attachment = models.PostAttachment(
        post_id=post_id,
        attachment_type=attachment_type,
        filename=normalized_filename,
        file_data=file_data,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return {
        "id": attachment.id,
        "post_id": attachment.post_id,
        "attachment_type": attachment.attachment_type,
        "filename": attachment.filename,
        "created_at": attachment.created_at.strftime("%Y-%m-%dT%H:%M:%S"),
    }


@app.get("/feed/posts/{post_id}/attachments/{attachment_id}/file")
def get_attachment_file(
    post_id: int,
    attachment_id: int,
    request: Request,
    token: str = "",
    db: Session = Depends(auth.get_db),
):
    auth_header = request.headers.get("authorization", "")
    bearer_token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    resolved_token = (token or bearer_token or "").strip()
    if not resolved_token:
        raise HTTPException(status_code=401, detail="Token requerido")
    current_user = auth.get_current_user_from_token(resolved_token, db)
    attachment = db.query(models.PostAttachment).filter(
        models.PostAttachment.id == attachment_id,
        models.PostAttachment.post_id == post_id,
    ).first()
    if not attachment or not attachment.file_data:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    attachment = _ensure_feed_video_web_compatible(attachment, db)

    post = attachment.post
    family_ids = _get_family_user_ids(db, current_user)
    if post.user_id not in family_ids and post.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Sin acceso")

    filename = attachment.filename or "file.bin"
    file_bytes = attachment.file_data
    file_size = len(file_bytes)
    ext = Path(filename).suffix.lower()
    inline_mime_by_ext = {
        ".mov": "video/quicktime",
        ".mp4": "video/mp4",
        ".m4v": "video/mp4",
        ".webm": "video/webm",
        ".ogg": "video/ogg",
        ".ogv": "video/ogg",
    }
    mime_type = inline_mime_by_ext.get(ext) or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    base_headers = {
        "Content-Disposition": f'inline; filename="{filename}"',
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
    }
    range_header = request.headers.get("range", "").strip()
    if range_header:
        match = re.match(r"bytes=(\d*)-(\d*)", range_header)
        if not match:
            raise HTTPException(status_code=416, detail="Rango inválido")
        start_raw, end_raw = match.groups()
        if not start_raw and not end_raw:
            raise HTTPException(status_code=416, detail="Rango inválido")
        if start_raw:
            start = int(start_raw)
            end = int(end_raw) if end_raw else file_size - 1
        else:
            suffix_length = int(end_raw)
            if suffix_length <= 0:
                raise HTTPException(status_code=416, detail="Rango inválido")
            start = max(file_size - suffix_length, 0)
            end = file_size - 1
        end = min(end, file_size - 1)
        if start < 0 or start >= file_size or end < start:
            raise HTTPException(status_code=416, detail="Rango fuera de límites")
        chunk = file_bytes[start : end + 1]
        headers = {
            **base_headers,
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(len(chunk)),
        }
        return Response(
            content=chunk,
            status_code=206,
            media_type=mime_type,
            headers=headers,
        )
    return Response(
        content=file_bytes,
        media_type=mime_type,
        headers={
            **base_headers,
            "Content-Length": str(file_size),
        },
    )


@app.delete("/feed/posts/{post_id}", status_code=204)
def delete_feed_post(
    post_id: int,
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    post = db.query(models.FeedPost).filter(models.FeedPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    if post.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes eliminar este post")
    db.delete(post)
    db.commit()
    return None


@app.post("/feed/posts/{post_id}/reactions", status_code=201)
def react_to_post(
    post_id: int,
    payload: schemas.PostReactionCreate,
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    post = db.query(models.FeedPost).filter(models.FeedPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    _ensure_feed_post_access(db, current_user, post)

    existing = db.query(models.PostReaction).filter(
        models.PostReaction.post_id == post_id,
        models.PostReaction.user_id == current_user.id,
    ).first()
    if existing:
        existing.reaction_type = payload.reaction_type
        db.commit()
        return {"id": existing.id, "reaction_type": existing.reaction_type}

    reaction = models.PostReaction(
        post_id=post_id,
        user_id=current_user.id,
        reaction_type=payload.reaction_type,
    )
    db.add(reaction)
    db.commit()
    db.refresh(reaction)
    _send_feed_notification_to_family(db, current_user, post, "reaction", {
        "reaction_type": payload.reaction_type,
    })
    return {"id": reaction.id, "reaction_type": reaction.reaction_type}


@app.delete("/feed/posts/{post_id}/reactions", status_code=204)
def remove_reaction(
    post_id: int,
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    post = db.query(models.FeedPost).filter(models.FeedPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    _ensure_feed_post_access(db, current_user, post)
    reaction = db.query(models.PostReaction).filter(
        models.PostReaction.post_id == post_id,
        models.PostReaction.user_id == current_user.id,
    ).first()
    if reaction:
        db.delete(reaction)
        db.commit()
    return None


@app.get("/feed/posts/{post_id}/comments")
def get_post_comments(
    post_id: int,
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    post = db.query(models.FeedPost).filter(models.FeedPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    _ensure_feed_post_access(db, current_user, post)
    comments = (
        db.query(models.PostComment)
        .filter(models.PostComment.post_id == post_id)
        .order_by(models.PostComment.created_at, models.PostComment.id)
        .all()
    )
    return [_serialize_comment(c, current_user.id) for c in comments]


@app.post("/feed/posts/{post_id}/comments", status_code=201)
def add_comment(
    post_id: int,
    payload: schemas.PostCommentCreate,
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    post = db.query(models.FeedPost).filter(models.FeedPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    _ensure_feed_post_access(db, current_user, post)
    content = (payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="El comentario no puede estar vacío")
    parent_comment = None
    if payload.parent_comment_id is not None:
        parent_comment = db.query(models.PostComment).filter(
            models.PostComment.id == payload.parent_comment_id,
            models.PostComment.post_id == post_id,
        ).first()
        if not parent_comment:
            raise HTTPException(status_code=404, detail="Comentario padre no encontrado")

    mention_user_ids = _resolve_feed_comment_mentions(
        db,
        current_user,
        post,
        payload.mention_user_ids,
    )
    comment = models.PostComment(
        post_id=post_id,
        user_id=current_user.id,
        parent_comment_id=parent_comment.id if parent_comment else None,
        content=content,
        mentions_json=json.dumps(mention_user_ids),
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    _send_feed_comment_notifications(
        db,
        current_user,
        post,
        comment,
        mention_user_ids,
        parent_comment,
    )
    return _serialize_comment(comment, current_user.id)


@app.delete("/feed/posts/{post_id}/comments/{comment_id}", status_code=204)
def delete_comment(
    post_id: int,
    comment_id: int,
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    post = db.query(models.FeedPost).filter(models.FeedPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    _ensure_feed_post_access(db, current_user, post)
    comment = db.query(models.PostComment).filter(
        models.PostComment.id == comment_id,
        models.PostComment.post_id == post_id,
    ).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comentario no encontrado")
    if comment.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes eliminar este comentario")
    db.query(models.PostComment).filter(
        models.PostComment.parent_comment_id == comment.id,
        models.PostComment.post_id == post_id,
    ).update(
        {"parent_comment_id": None},
        synchronize_session=False,
    )
    db.delete(comment)
    db.commit()
    return None


@app.post("/feed/posts/{post_id}/comments/{comment_id}/like", status_code=201)
def like_comment(
    post_id: int,
    comment_id: int,
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    post = db.query(models.FeedPost).filter(models.FeedPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    _ensure_feed_post_access(db, current_user, post)
    comment = db.query(models.PostComment).filter(
        models.PostComment.id == comment_id,
        models.PostComment.post_id == post_id,
    ).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comentario no encontrado")

    existing = db.query(models.PostCommentLike).filter(
        models.PostCommentLike.comment_id == comment_id,
        models.PostCommentLike.user_id == current_user.id,
    ).first()
    if existing:
        likes_count = db.query(func.count(models.PostCommentLike.id)).filter(
            models.PostCommentLike.comment_id == comment_id
        ).scalar() or 0
        return {"likes_count": int(likes_count), "my_like": True}

    db.add(models.PostCommentLike(comment_id=comment_id, user_id=current_user.id))
    db.commit()
    likes_count = db.query(func.count(models.PostCommentLike.id)).filter(
        models.PostCommentLike.comment_id == comment_id
    ).scalar() or 0
    return {"likes_count": int(likes_count), "my_like": True}


@app.delete("/feed/posts/{post_id}/comments/{comment_id}/like", status_code=204)
def unlike_comment(
    post_id: int,
    comment_id: int,
    db: Session = Depends(auth.get_db),
    current_user=Depends(auth.get_current_user),
):
    post = db.query(models.FeedPost).filter(models.FeedPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    _ensure_feed_post_access(db, current_user, post)
    comment = db.query(models.PostComment).filter(
        models.PostComment.id == comment_id,
        models.PostComment.post_id == post_id,
    ).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comentario no encontrado")

    existing = db.query(models.PostCommentLike).filter(
        models.PostCommentLike.comment_id == comment_id,
        models.PostCommentLike.user_id == current_user.id,
    ).first()
    if existing:
        db.delete(existing)
        db.commit()
    return None


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
