"""Add personal non-clinical reminder domain persistence.

Revision ID: 20260802_000001
Revises: 20260727_000001
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260802_000001"
down_revision = "20260727_000001"
branch_labels = None
depends_on = None


REMINDER_TABLES = {
    "reminder_profile_settings",
    "reminders",
    "reminder_occurrences",
    "reminder_deliveries",
    "reminder_events",
}


def upgrade() -> None:
    existing_tables = set(inspect(op.get_bind()).get_table_names())
    existing_reminder_tables = REMINDER_TABLES.intersection(existing_tables)
    if existing_reminder_tables == REMINDER_TABLES:
        return
    if existing_reminder_tables:
        raise RuntimeError(
            "Partial reminder schema detected; refusing unsafe migration"
        )

    op.create_table(
        "reminder_profile_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("health_profile_id", sa.Integer(), nullable=False),
        sa.Column("timezone_iana", sa.String(length=80), nullable=False),
        sa.Column("preferred_device_id", sa.Integer(), nullable=True),
        sa.Column("active_hours_enabled", sa.Boolean(), nullable=False),
        sa.Column("active_hours_start_local", sa.Time(), nullable=True),
        sa.Column("active_hours_end_local", sa.Time(), nullable=True),
        sa.Column("active_weekdays_json", sa.JSON(), nullable=False),
        sa.Column("settings_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "NOT active_hours_enabled OR "
            "(active_hours_start_local IS NOT NULL AND "
            "active_hours_end_local IS NOT NULL)",
            name="ck_reminder_profile_settings_active_hours",
        ),
        sa.CheckConstraint(
            "settings_version > 0",
            name="ck_reminder_profile_settings_version",
        ),
        sa.ForeignKeyConstraint(
            ["health_profile_id"],
            ["health_profiles.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["preferred_device_id"],
            ["devices.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "health_profile_id",
            name="uq_reminder_profile_settings_profile",
        ),
    )
    op.create_index(
        "ix_reminder_profile_settings_id",
        "reminder_profile_settings",
        ["id"],
    )
    op.create_index(
        "ix_reminder_profile_settings_preferred_device",
        "reminder_profile_settings",
        ["preferred_device_id"],
    )

    op.create_table(
        "reminders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("health_profile_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_by_device_id", sa.Integer(), nullable=True),
        sa.Column("idempotency_key_hash", sa.String(length=64), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("origin", sa.String(length=32), nullable=False),
        sa.Column("reminder_type", sa.String(length=32), nullable=False),
        sa.Column("title_ciphertext", sa.Text(), nullable=False),
        sa.Column("body_ciphertext", sa.Text(), nullable=True),
        sa.Column("content_nonce", sa.String(length=64), nullable=False),
        sa.Column("content_key_version", sa.Integer(), nullable=False),
        sa.Column("schedule_mode", sa.String(length=24), nullable=False),
        sa.Column("original_local_date", sa.Date(), nullable=True),
        sa.Column("original_local_time", sa.Time(), nullable=False),
        sa.Column("timezone_iana", sa.String(length=80), nullable=False),
        sa.Column("recurrence_json", sa.JSON(), nullable=False),
        sa.Column("dst_gap_policy", sa.String(length=32), nullable=False),
        sa.Column("dst_fold_policy", sa.String(length=16), nullable=False),
        sa.Column("target_mode", sa.String(length=24), nullable=False),
        sa.Column("target_device_id", sa.Integer(), nullable=False),
        sa.Column("next_occurrence_at_utc", sa.DateTime(), nullable=True),
        sa.Column("next_logical_key", sa.String(length=120), nullable=True),
        sa.Column("state", sa.String(length=20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "((created_by_user_id IS NOT NULL AND created_by_device_id IS NULL) OR "
            "(created_by_user_id IS NULL AND created_by_device_id IS NOT NULL))",
            name="ck_reminders_single_creator",
        ),
        sa.CheckConstraint(
            "content_key_version > 0",
            name="ck_reminders_content_key_version",
        ),
        sa.CheckConstraint(
            "dst_fold_policy IN ('earlier')",
            name="ck_reminders_dst_fold_policy",
        ),
        sa.CheckConstraint(
            "dst_gap_policy IN ('shift_forward_by_gap')",
            name="ck_reminders_dst_gap_policy",
        ),
        sa.CheckConstraint(
            "length(idempotency_key_hash) = 64",
            name="ck_reminders_idempotency_hash_length",
        ),
        sa.CheckConstraint(
            "length(request_fingerprint) = 64",
            name="ck_reminders_fingerprint_length",
        ),
        sa.CheckConstraint(
            "origin IN ('web', 'voice', 'authorized_caregiver')",
            name="ck_reminders_origin",
        ),
        sa.CheckConstraint(
            "reminder_type IN ('personal_non_clinical')",
            name="ck_reminders_type",
        ),
        sa.CheckConstraint(
            "schedule_mode IN ('wall_clock')",
            name="ck_reminders_schedule_mode",
        ),
        sa.CheckConstraint(
            "state IN ('active', 'awaiting_device', 'completed', 'cancelled', "
            "'expired', 'failed')",
            name="ck_reminders_state",
        ),
        sa.CheckConstraint(
            "target_mode IN ('selected_device')",
            name="ck_reminders_target_mode",
        ),
        sa.CheckConstraint("version > 0", name="ck_reminders_version"),
        sa.ForeignKeyConstraint(
            ["created_by_device_id"],
            ["devices.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["health_profile_id"],
            ["health_profiles.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["target_device_id"],
            ["devices.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reminders_id", "reminders", ["id"])
    op.create_index("ix_reminders_public_id", "reminders", ["public_id"], unique=True)
    op.create_index(
        "ix_reminders_health_profile_id",
        "reminders",
        ["health_profile_id"],
    )
    op.create_index(
        "ix_reminders_created_by_user_id",
        "reminders",
        ["created_by_user_id"],
    )
    op.create_index(
        "ix_reminders_created_by_device_id",
        "reminders",
        ["created_by_device_id"],
    )
    op.create_index(
        "ix_reminders_target_device_id",
        "reminders",
        ["target_device_id"],
    )
    op.create_index(
        "ix_reminders_next_occurrence_at_utc",
        "reminders",
        ["next_occurrence_at_utc"],
    )
    op.create_index("ix_reminders_expires_at", "reminders", ["expires_at"])
    op.create_index(
        "uq_reminders_user_idempotency",
        "reminders",
        ["created_by_user_id", "health_profile_id", "idempotency_key_hash"],
        unique=True,
        postgresql_where=sa.text("created_by_user_id IS NOT NULL"),
        sqlite_where=sa.text("created_by_user_id IS NOT NULL"),
    )
    op.create_index(
        "uq_reminders_device_idempotency",
        "reminders",
        ["created_by_device_id", "health_profile_id", "idempotency_key_hash"],
        unique=True,
        postgresql_where=sa.text("created_by_device_id IS NOT NULL"),
        sqlite_where=sa.text("created_by_device_id IS NOT NULL"),
    )
    op.create_index(
        "ix_reminders_profile_state_next",
        "reminders",
        ["health_profile_id", "state", "next_occurrence_at_utc"],
    )
    op.create_index(
        "ix_reminders_target_state",
        "reminders",
        ["target_device_id", "state"],
    )
    op.create_index(
        "ix_reminders_profile_created_public",
        "reminders",
        ["health_profile_id", "created_at", "public_id"],
    )

    op.create_table(
        "reminder_occurrences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("reminder_id", sa.Integer(), nullable=False),
        sa.Column("health_profile_id", sa.Integer(), nullable=False),
        sa.Column("schedule_version", sa.Integer(), nullable=False),
        sa.Column("logical_occurrence_key", sa.String(length=120), nullable=False),
        sa.Column("original_scheduled_for_utc", sa.DateTime(), nullable=False),
        sa.Column("scheduled_for_utc", sa.DateTime(), nullable=False),
        sa.Column("original_local_date", sa.Date(), nullable=False),
        sa.Column("original_local_time", sa.Time(), nullable=False),
        sa.Column("timezone_iana", sa.String(length=80), nullable=False),
        sa.Column("tzdb_version", sa.String(length=40), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("snooze_count", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(length=20), nullable=False),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("terminal_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "revision > 0",
            name="ck_reminder_occurrences_revision",
        ),
        sa.CheckConstraint(
            "schedule_version > 0",
            name="ck_reminder_occurrences_schedule_version",
        ),
        sa.CheckConstraint(
            "snooze_count >= 0",
            name="ck_reminder_occurrences_snooze_count",
        ),
        sa.CheckConstraint(
            "state IN ('scheduled', 'due', 'snoozed', 'completed', 'dismissed', "
            "'cancelled', 'expired', 'failed')",
            name="ck_reminder_occurrences_state",
        ),
        sa.ForeignKeyConstraint(
            ["health_profile_id"],
            ["health_profiles.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reminder_id"],
            ["reminders.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "reminder_id",
            "schedule_version",
            "logical_occurrence_key",
            name="uq_reminder_occurrences_logical",
        ),
    )
    op.create_index("ix_reminder_occurrences_id", "reminder_occurrences", ["id"])
    op.create_index(
        "ix_reminder_occurrences_public_id",
        "reminder_occurrences",
        ["public_id"],
        unique=True,
    )
    op.create_index(
        "ix_reminder_occurrences_reminder_id",
        "reminder_occurrences",
        ["reminder_id"],
    )
    op.create_index(
        "ix_reminder_occurrences_health_profile_id",
        "reminder_occurrences",
        ["health_profile_id"],
    )
    op.create_index(
        "ix_reminder_occurrences_scheduled_for_utc",
        "reminder_occurrences",
        ["scheduled_for_utc"],
    )
    op.create_index(
        "ix_reminder_occurrences_due_at",
        "reminder_occurrences",
        ["due_at"],
    )
    op.create_index(
        "ix_reminder_occurrences_state_scheduled",
        "reminder_occurrences",
        ["state", "scheduled_for_utc", "id"],
    )
    op.create_index(
        "ix_reminder_occurrences_profile_scheduled",
        "reminder_occurrences",
        ["health_profile_id", "scheduled_for_utc", "public_id"],
    )
    op.create_index(
        "ix_reminder_occurrences_reminder_created",
        "reminder_occurrences",
        ["reminder_id", "created_at"],
    )
    op.create_index(
        "ix_reminder_occurrences_state_updated",
        "reminder_occurrences",
        ["state", "updated_at"],
    )

    op.create_table(
        "reminder_deliveries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("occurrence_id", sa.Integer(), nullable=False),
        sa.Column("health_profile_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("delivery_revision", sa.Integer(), nullable=False),
        sa.Column("occurrence_version", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(length=20), nullable=False),
        sa.Column("available_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("delivery_attempts", sa.Integer(), nullable=False),
        sa.Column("last_event_public_id", sa.String(length=64), nullable=True),
        sa.Column("state_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "delivery_attempts >= 0",
            name="ck_reminder_deliveries_attempts",
        ),
        sa.CheckConstraint(
            "expires_at > available_at",
            name="ck_reminder_deliveries_expiry",
        ),
        sa.CheckConstraint(
            "occurrence_version > 0",
            name="ck_reminder_deliveries_occurrence_version",
        ),
        sa.CheckConstraint(
            "delivery_revision > 0",
            name="ck_reminder_deliveries_revision",
        ),
        sa.CheckConstraint(
            "state IN ('queued', 'delivered', 'announced', 'superseded', "
            "'failed', 'expired', 'cancelled')",
            name="ck_reminder_deliveries_state",
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["health_profile_id"],
            ["health_profiles.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["occurrence_id"],
            ["reminder_occurrences.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "occurrence_id",
            "device_id",
            "delivery_revision",
            name="uq_reminder_deliveries_occurrence_device_revision",
        ),
    )
    op.create_index("ix_reminder_deliveries_id", "reminder_deliveries", ["id"])
    op.create_index(
        "ix_reminder_deliveries_public_id",
        "reminder_deliveries",
        ["public_id"],
        unique=True,
    )
    op.create_index(
        "ix_reminder_deliveries_occurrence_id",
        "reminder_deliveries",
        ["occurrence_id"],
    )
    op.create_index(
        "ix_reminder_deliveries_health_profile_id",
        "reminder_deliveries",
        ["health_profile_id"],
    )
    op.create_index(
        "ix_reminder_deliveries_device_id",
        "reminder_deliveries",
        ["device_id"],
    )
    op.create_index(
        "ix_reminder_deliveries_expires_at",
        "reminder_deliveries",
        ["expires_at"],
    )
    op.create_index(
        "ix_reminder_deliveries_device_state_available",
        "reminder_deliveries",
        ["device_id", "state", "available_at", "public_id"],
    )
    op.create_index(
        "ix_reminder_deliveries_occurrence_revision",
        "reminder_deliveries",
        ["occurrence_id", "delivery_revision"],
    )
    op.create_index(
        "ix_reminder_deliveries_device_expires",
        "reminder_deliveries",
        ["device_id", "expires_at"],
    )
    op.create_index(
        "ix_reminder_deliveries_profile_state_at",
        "reminder_deliveries",
        ["health_profile_id", "state_at"],
    )

    op.create_table(
        "reminder_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("reminder_id", sa.Integer(), nullable=False),
        sa.Column("occurrence_id", sa.Integer(), nullable=True),
        sa.Column("delivery_id", sa.Integer(), nullable=True),
        sa.Column("health_profile_id", sa.Integer(), nullable=False),
        sa.Column("actor_kind", sa.String(length=16), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("actor_device_id", sa.Integer(), nullable=True),
        sa.Column("event_scope", sa.String(length=16), nullable=False),
        sa.Column("event_type", sa.String(length=24), nullable=False),
        sa.Column("client_event_id", sa.String(length=64), nullable=True),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("expected_version", sa.Integer(), nullable=True),
        sa.Column("resulting_state", sa.String(length=20), nullable=False),
        sa.Column("resulting_version", sa.Integer(), nullable=False),
        sa.Column("client_timestamp", sa.DateTime(), nullable=True),
        sa.Column("server_timestamp", sa.DateTime(), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "((actor_kind = 'user' AND actor_user_id IS NOT NULL AND "
            "actor_device_id IS NULL AND client_event_id IS NOT NULL) OR "
            "(actor_kind = 'device' AND actor_user_id IS NULL AND "
            "actor_device_id IS NOT NULL AND client_event_id IS NOT NULL) OR "
            "(actor_kind = 'worker' AND actor_user_id IS NULL AND "
            "actor_device_id IS NULL))",
            name="ck_reminder_events_actor",
        ),
        sa.CheckConstraint(
            "actor_kind IN ('user', 'device', 'worker')",
            name="ck_reminder_events_actor_kind",
        ),
        sa.CheckConstraint(
            "length(request_fingerprint) = 64",
            name="ck_reminder_events_fingerprint_length",
        ),
        sa.CheckConstraint(
            "resulting_version > 0",
            name="ck_reminder_events_resulting_version",
        ),
        sa.CheckConstraint(
            "event_scope IN ('reminder', 'delivery', 'occurrence', 'system')",
            name="ck_reminder_events_scope",
        ),
        sa.CheckConstraint(
            "((event_scope = 'reminder' AND occurrence_id IS NULL AND "
            "delivery_id IS NULL) OR "
            "(event_scope = 'occurrence' AND occurrence_id IS NOT NULL AND "
            "delivery_id IS NULL) OR "
            "(event_scope = 'delivery' AND occurrence_id IS NOT NULL AND "
            "delivery_id IS NOT NULL) OR event_scope = 'system')",
            name="ck_reminder_events_scope_target",
        ),
        sa.CheckConstraint(
            "((event_scope = 'reminder' AND event_type IN ('updated', 'cancelled')) OR "
            "(event_scope = 'delivery' AND event_type IN "
            "('delivered', 'announced', 'failed')) OR "
            "(event_scope = 'occurrence' AND event_type IN "
            "('completed', 'snoozed', 'dismissed')) OR "
            "(event_scope = 'system' AND event_type IN "
            "('materialized', 'due', 'expired', 'cancelled', 'superseded')))",
            name="ck_reminder_events_scope_type",
        ),
        sa.ForeignKeyConstraint(
            ["actor_device_id"],
            ["devices.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["delivery_id"],
            ["reminder_deliveries.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["health_profile_id"],
            ["health_profiles.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["occurrence_id"],
            ["reminder_occurrences.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reminder_id"],
            ["reminders.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reminder_events_id", "reminder_events", ["id"])
    op.create_index(
        "ix_reminder_events_public_id",
        "reminder_events",
        ["public_id"],
        unique=True,
    )
    for column_name in (
        "reminder_id",
        "occurrence_id",
        "delivery_id",
        "health_profile_id",
        "actor_user_id",
        "actor_device_id",
    ):
        op.create_index(
            f"ix_reminder_events_{column_name}",
            "reminder_events",
            [column_name],
        )
    op.create_index(
        "uq_reminder_events_reminder_user_client",
        "reminder_events",
        ["reminder_id", "actor_user_id", "client_event_id"],
        unique=True,
        postgresql_where=sa.text(
            "event_scope = 'reminder' AND actor_user_id IS NOT NULL "
            "AND client_event_id IS NOT NULL"
        ),
        sqlite_where=sa.text(
            "event_scope = 'reminder' AND actor_user_id IS NOT NULL "
            "AND client_event_id IS NOT NULL"
        ),
    )
    op.create_index(
        "uq_reminder_events_delivery_device_client",
        "reminder_events",
        ["delivery_id", "actor_device_id", "client_event_id"],
        unique=True,
        postgresql_where=sa.text(
            "event_scope = 'delivery' AND actor_device_id IS NOT NULL "
            "AND client_event_id IS NOT NULL"
        ),
        sqlite_where=sa.text(
            "event_scope = 'delivery' AND actor_device_id IS NOT NULL "
            "AND client_event_id IS NOT NULL"
        ),
    )
    op.create_index(
        "uq_reminder_events_occurrence_user_client",
        "reminder_events",
        ["occurrence_id", "actor_user_id", "client_event_id"],
        unique=True,
        postgresql_where=sa.text(
            "event_scope = 'occurrence' AND actor_user_id IS NOT NULL "
            "AND client_event_id IS NOT NULL"
        ),
        sqlite_where=sa.text(
            "event_scope = 'occurrence' AND actor_user_id IS NOT NULL "
            "AND client_event_id IS NOT NULL"
        ),
    )
    op.create_index(
        "uq_reminder_events_occurrence_device_client",
        "reminder_events",
        ["occurrence_id", "actor_device_id", "client_event_id"],
        unique=True,
        postgresql_where=sa.text(
            "event_scope = 'occurrence' AND actor_device_id IS NOT NULL "
            "AND client_event_id IS NOT NULL"
        ),
        sqlite_where=sa.text(
            "event_scope = 'occurrence' AND actor_device_id IS NOT NULL "
            "AND client_event_id IS NOT NULL"
        ),
    )
    op.create_index(
        "ix_reminder_events_occurrence_server",
        "reminder_events",
        ["occurrence_id", "server_timestamp", "id"],
    )
    op.create_index(
        "ix_reminder_events_delivery_server",
        "reminder_events",
        ["delivery_id", "server_timestamp", "id"],
    )
    op.create_index(
        "ix_reminder_events_profile_server",
        "reminder_events",
        ["health_profile_id", "server_timestamp", "id"],
    )
    op.create_index(
        "ix_reminder_events_actor_device_server",
        "reminder_events",
        ["actor_device_id", "server_timestamp"],
    )


def downgrade() -> None:
    op.drop_table("reminder_events")
    op.drop_table("reminder_deliveries")
    op.drop_table("reminder_occurrences")
    op.drop_table("reminders")
    op.drop_table("reminder_profile_settings")
