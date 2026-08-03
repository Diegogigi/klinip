from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


BACKEND_ROOT = Path(__file__).resolve().parent.parent
REMINDER_TABLES = {
    "reminder_profile_settings",
    "reminders",
    "reminder_occurrences",
    "reminder_deliveries",
    "reminder_events",
}


def _alembic(tmp_path: Path, *arguments: str, check: bool = True):
    database_path = tmp_path / "reminder-migration.db"
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{database_path.as_posix()}",
        "ENABLE_EMBEDDED_SCHEDULER": "false",
    }
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", *arguments],
        cwd=BACKEND_ROOT,
        env=env,
        check=check,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def _inspector(tmp_path: Path):
    database_path = tmp_path / "reminder-migration.db"
    return inspect(create_engine(f"sqlite:///{database_path.as_posix()}"))


def test_reminder_migration_is_the_only_alembic_head():
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["20260802_000001"]
    revision = script.get_revision("20260802_000001")
    assert revision.down_revision == "20260727_000001"


def test_upgrade_downgrade_and_reupgrade_reminder_schema(tmp_path):
    _alembic(tmp_path, "upgrade", "head")
    inspector = _inspector(tmp_path)
    assert REMINDER_TABLES <= set(inspector.get_table_names())
    assert {
        "uq_reminders_user_idempotency",
        "uq_reminders_device_idempotency",
        "ix_reminders_profile_state_next",
    } <= {item["name"] for item in inspector.get_indexes("reminders")}
    reminder_columns = {
        item["name"]: item for item in inspector.get_columns("reminders")
    }
    assert {
        "content_ciphertext",
        "content_nonce",
        "content_key_version",
        "content_algorithm_version",
    } <= set(reminder_columns)
    assert {
        "title",
        "body",
        "title_ciphertext",
        "body_ciphertext",
    }.isdisjoint(reminder_columns)
    assert all(
        reminder_columns[field]["nullable"] is False
        for field in (
            "content_ciphertext",
            "content_nonce",
            "content_key_version",
            "content_algorithm_version",
        )
    )
    reminder_checks = {
        item["name"] for item in inspector.get_check_constraints("reminders")
    }
    assert {
        "ck_reminders_content_algorithm_version",
        "ck_reminders_content_ciphertext_not_empty",
        "ck_reminders_content_key_version",
        "ck_reminders_content_nonce_length",
    } <= reminder_checks
    delivery_columns = {
        item["name"]: item for item in inspector.get_columns("reminder_deliveries")
    }
    assert delivery_columns["occurrence_id"]["nullable"] is False
    event_columns = {
        item["name"]: item for item in inspector.get_columns("reminder_events")
    }
    assert event_columns["occurrence_id"]["nullable"] is True
    assert {
        "uq_reminder_events_reminder_user_client",
        "uq_reminder_events_delivery_device_client",
        "uq_reminder_events_occurrence_user_client",
        "uq_reminder_events_occurrence_device_client",
        "uq_reminder_events_system_occurrence_version",
        "uq_reminder_events_system_delivery_version",
        "ix_reminder_events_profile_server",
    } <= {item["name"] for item in inspector.get_indexes("reminder_events")}
    event_checks = {
        item["name"] for item in inspector.get_check_constraints("reminder_events")
    }
    assert {
        "ck_reminder_events_actor",
        "ck_reminder_events_scope_actor",
        "ck_reminder_events_scope_target",
        "ck_reminder_events_scope_type",
    } <= event_checks

    _alembic(tmp_path, "downgrade", "20260727_000001")
    assert not (
        REMINDER_TABLES.intersection(set(_inspector(tmp_path).get_table_names()))
    )

    _alembic(tmp_path, "upgrade", "head")
    assert REMINDER_TABLES <= set(_inspector(tmp_path).get_table_names())


def test_upgrade_refuses_partial_reminder_schema(tmp_path):
    _alembic(tmp_path, "upgrade", "20260727_000001")
    database_path = tmp_path / "reminder-migration.db"
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE reminder_events"))

    result = _alembic(tmp_path, "upgrade", "head", check=False)

    assert result.returncode != 0
    assert "Partial reminder schema detected" in (result.stdout + result.stderr)
