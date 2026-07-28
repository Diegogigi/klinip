"""Add non-clinical device messages, recipients, and delivery events.

Revision ID: 20260727_000001
Revises: 20260722_000001
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260727_000001"
down_revision = "20260722_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The historical baseline creates current metadata on a fresh database.
    # Accept that complete schema, but never continue from a partial creation.
    required_tables = {
        "device_messages",
        "device_message_recipients",
        "device_message_events",
    }
    existing_tables = set(inspect(op.get_bind()).get_table_names())
    existing_message_tables = required_tables.intersection(existing_tables)
    if existing_message_tables == required_tables:
        return
    if existing_message_tables:
        raise RuntimeError(
            "Partial device message schema detected; refusing unsafe migration"
        )

    op.create_table(
        "device_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("health_profile_id", sa.Integer(), nullable=False),
        sa.Column("sender_user_id", sa.Integer(), nullable=False),
        sa.Column("message_type", sa.String(length=40), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("priority", sa.String(length=20), nullable=False),
        sa.Column("requires_acknowledgement", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("available_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_by_user_id", sa.Integer(), nullable=True),
        sa.Column("revocation_reason_code", sa.String(length=80), nullable=True),
        sa.Column("idempotency_key_hash", sa.String(length=64), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("protocol_version", sa.Integer(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "message_type IN ('family_non_clinical')", name="ck_device_messages_type"
        ),
        sa.CheckConstraint(
            "priority IN ('normal')", name="ck_device_messages_priority"
        ),
        sa.CheckConstraint(
            "protocol_version > 0", name="ck_device_messages_protocol_version"
        ),
        sa.ForeignKeyConstraint(
            ["health_profile_id"], ["health_profiles.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["sender_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["revoked_by_user_id"], ["users.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "sender_user_id",
            "health_profile_id",
            "idempotency_key_hash",
            name="uq_device_messages_idempotency",
        ),
    )
    op.create_index(
        "ix_device_messages_public_id", "device_messages", ["public_id"], unique=True
    )
    op.create_index(
        "ix_device_messages_health_profile_id", "device_messages", ["health_profile_id"]
    )
    op.create_index(
        "ix_device_messages_sender_user_id", "device_messages", ["sender_user_id"]
    )
    op.create_index(
        "ix_device_messages_revoked_by_user_id",
        "device_messages",
        ["revoked_by_user_id"],
    )
    op.create_index(
        "ix_device_messages_profile_created",
        "device_messages",
        ["health_profile_id", "created_at"],
    )
    op.create_index("ix_device_messages_expires_at", "device_messages", ["expires_at"])

    op.create_table(
        "device_message_recipients",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("current_state", sa.String(length=20), nullable=False),
        sa.Column("current_state_at", sa.DateTime(), nullable=False),
        sa.Column("delivery_attempts", sa.Integer(), nullable=False),
        sa.Column("last_event_public_id", sa.String(length=64), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "current_state IN ('queued', 'delivered', 'announced', 'heard', "
            "'acknowledged', 'failed', 'expired', 'revoked')",
            name="ck_device_message_recipients_state",
        ),
        sa.ForeignKeyConstraint(
            ["message_id"], ["device_messages.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "message_id",
            "device_id",
            name="uq_device_message_recipients_message_device",
        ),
    )
    op.create_index(
        "ix_device_message_recipients_public_id",
        "device_message_recipients",
        ["public_id"],
        unique=True,
    )
    op.create_index(
        "ix_device_message_recipients_message_id",
        "device_message_recipients",
        ["message_id"],
    )
    op.create_index(
        "ix_device_message_recipients_device_id",
        "device_message_recipients",
        ["device_id"],
    )
    op.create_index(
        "ix_device_message_recipients_current_state",
        "device_message_recipients",
        ["current_state"],
    )
    op.create_index(
        "ix_device_message_recipients_device_state_created",
        "device_message_recipients",
        ["device_id", "current_state", "created_at"],
    )

    op.create_table(
        "device_message_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("recipient_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("client_event_id", sa.String(length=64), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("resulting_state", sa.String(length=20), nullable=False),
        sa.Column("server_timestamp", sa.DateTime(), nullable=False),
        sa.Column("client_timestamp", sa.DateTime(), nullable=True),
        sa.Column("protocol_version", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "event_type IN ('delivered', 'announced', 'heard', 'acknowledged', 'failed')",
            name="ck_device_message_events_type",
        ),
        sa.CheckConstraint(
            "protocol_version > 0", name="ck_device_message_events_protocol_version"
        ),
        sa.ForeignKeyConstraint(
            ["message_id"], ["device_messages.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["recipient_id"], ["device_message_recipients.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "recipient_id",
            "client_event_id",
            name="uq_device_message_events_recipient_client",
        ),
    )
    op.create_index(
        "ix_device_message_events_public_id",
        "device_message_events",
        ["public_id"],
        unique=True,
    )
    op.create_index(
        "ix_device_message_events_message_id", "device_message_events", ["message_id"]
    )
    op.create_index(
        "ix_device_message_events_recipient_id",
        "device_message_events",
        ["recipient_id"],
    )
    op.create_index(
        "ix_device_message_events_device_id", "device_message_events", ["device_id"]
    )
    op.create_index(
        "ix_device_message_events_message_server",
        "device_message_events",
        ["message_id", "server_timestamp"],
    )


def downgrade() -> None:
    op.drop_table("device_message_events")
    op.drop_table("device_message_recipients")
    op.drop_table("device_messages")
