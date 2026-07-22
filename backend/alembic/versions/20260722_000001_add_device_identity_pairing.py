"""add device identity and pairing foundation

Revision ID: 20260722_000001
Revises: 20260704_000001
Create Date: 2026-07-22 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260722_000001"
down_revision = "20260704_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The historical baseline calls current Base.metadata.create_all(). On a
    # brand-new database that legacy behavior may have created this complete
    # revision already; production databases at the previous head have not.
    required_tables = {
        "devices",
        "device_pairings",
        "device_credentials",
        "device_grants",
    }
    existing_tables = set(inspect(op.get_bind()).get_table_names())
    existing_device_tables = required_tables.intersection(existing_tables)
    if existing_device_tables == required_tables:
        return
    if existing_device_tables:
        raise RuntimeError(
            "Partial device identity schema detected; refusing unsafe migration"
        )

    op.create_table(
        "devices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("platform", sa.String(length=40), nullable=False),
        sa.Column("device_type", sa.String(length=40), nullable=False),
        sa.Column("protocol_version", sa.Integer(), nullable=False),
        sa.Column("app_version", sa.String(length=40), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("token_version", sa.Integer(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_by_user_id", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "status IN ('active', 'revoked', 'disabled')",
            name="ck_devices_status",
        ),
        sa.CheckConstraint("protocol_version > 0", name="ck_devices_protocol_version"),
        sa.ForeignKeyConstraint(
            ["revoked_by_user_id"],
            ["users.id"],
            name="fk_devices_revoked_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("public_id", name="uq_devices_public_id"),
    )
    op.create_index("ix_devices_public_id", "devices", ["public_id"], unique=True)
    op.create_index("ix_devices_status", "devices", ["status"])
    op.create_index("ix_devices_last_seen_at", "devices", ["last_seen_at"])
    op.create_index("ix_devices_revoked_by_user_id", "devices", ["revoked_by_user_id"])

    op.create_table(
        "device_pairings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=False),
        sa.Column("health_profile_id", sa.Integer(), nullable=False),
        sa.Column("claimed_device_id", sa.Integer(), nullable=True),
        sa.Column("requested_label", sa.String(length=120), nullable=True),
        sa.Column("requested_scopes", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("pairing_status", sa.String(length=20), nullable=False),
        sa.Column("protocol_version", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "pairing_status IN ('pending', 'claimed', 'expired', 'cancelled', 'locked')",
            name="ck_device_pairings_status",
        ),
        sa.CheckConstraint("max_attempts > 0", name="ck_device_pairings_max_attempts"),
        sa.CheckConstraint("attempts >= 0", name="ck_device_pairings_attempts"),
        sa.CheckConstraint(
            "protocol_version > 0",
            name="ck_device_pairings_protocol_version",
        ),
        sa.ForeignKeyConstraint(
            ["requested_by_user_id"],
            ["users.id"],
            name="fk_device_pairings_requested_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["health_profile_id"],
            ["health_profiles.id"],
            name="fk_device_pairings_health_profile_id_health_profiles",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["claimed_device_id"],
            ["devices.id"],
            name="fk_device_pairings_claimed_device_id_devices",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("public_id", name="uq_device_pairings_public_id"),
        sa.UniqueConstraint("code_hash", name="uq_device_pairings_code_hash"),
        sa.UniqueConstraint(
            "claimed_device_id", name="uq_device_pairings_claimed_device_id"
        ),
    )
    op.create_index(
        "ix_device_pairings_public_id", "device_pairings", ["public_id"], unique=True
    )
    op.create_index(
        "ix_device_pairings_code_hash", "device_pairings", ["code_hash"], unique=True
    )
    op.create_index(
        "ix_device_pairings_requested_by_user_id",
        "device_pairings",
        ["requested_by_user_id"],
    )
    op.create_index(
        "ix_device_pairings_health_profile_id",
        "device_pairings",
        ["health_profile_id"],
    )
    op.create_index("ix_device_pairings_expires_at", "device_pairings", ["expires_at"])
    op.create_index(
        "ix_device_pairings_pairing_status", "device_pairings", ["pairing_status"]
    )
    op.create_index(
        "ix_device_pairings_status_expires",
        "device_pairings",
        ["pairing_status", "expires_at"],
    )

    op.create_table(
        "device_credentials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("refresh_token_hash", sa.String(length=64), nullable=False),
        sa.Column("token_family_id", sa.String(length=64), nullable=False),
        sa.Column("issued_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("rotated_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("replaced_by_id", sa.Integer(), nullable=True),
        sa.Column("reuse_detected_at", sa.DateTime(), nullable=True),
        sa.Column("created_from_pairing_id", sa.Integer(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            name="fk_device_credentials_device_id_devices",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["replaced_by_id"],
            ["device_credentials.id"],
            name="fk_device_credentials_replaced_by_id_device_credentials",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_from_pairing_id"],
            ["device_pairings.id"],
            name="fk_device_credentials_pairing_id_device_pairings",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "refresh_token_hash", name="uq_device_credentials_token_hash"
        ),
        sa.UniqueConstraint(
            "replaced_by_id", name="uq_device_credentials_replaced_by_id"
        ),
    )
    op.create_index(
        "ix_device_credentials_device_id", "device_credentials", ["device_id"]
    )
    op.create_index(
        "ix_device_credentials_refresh_token_hash",
        "device_credentials",
        ["refresh_token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_device_credentials_token_family_id",
        "device_credentials",
        ["token_family_id"],
    )
    op.create_index(
        "ix_device_credentials_expires_at", "device_credentials", ["expires_at"]
    )
    op.create_index(
        "ix_device_credentials_revoked_at", "device_credentials", ["revoked_at"]
    )
    op.create_index(
        "ix_device_credentials_created_from_pairing_id",
        "device_credentials",
        ["created_from_pairing_id"],
    )
    op.create_index(
        "ix_device_credentials_expires_revoked",
        "device_credentials",
        ["expires_at", "revoked_at"],
    )

    op.create_table(
        "device_grants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("health_profile_id", sa.Integer(), nullable=False),
        sa.Column("granted_by_user_id", sa.Integer(), nullable=False),
        sa.Column("scopes_json", sa.JSON(), nullable=False),
        sa.Column("protocol_version", sa.Integer(), nullable=False),
        sa.Column("granted_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(length=120), nullable=True),
        sa.CheckConstraint(
            "protocol_version > 0",
            name="ck_device_grants_protocol_version",
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            name="fk_device_grants_device_id_devices",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["health_profile_id"],
            ["health_profiles.id"],
            name="fk_device_grants_health_profile_id_health_profiles",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["granted_by_user_id"],
            ["users.id"],
            name="fk_device_grants_granted_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["revoked_by_user_id"],
            ["users.id"],
            name="fk_device_grants_revoked_by_user_id_users",
            ondelete="RESTRICT",
        ),
    )
    op.create_index("ix_device_grants_device_id", "device_grants", ["device_id"])
    op.create_index(
        "ix_device_grants_health_profile_id", "device_grants", ["health_profile_id"]
    )
    op.create_index(
        "ix_device_grants_granted_by_user_id",
        "device_grants",
        ["granted_by_user_id"],
    )
    op.create_index("ix_device_grants_revoked_at", "device_grants", ["revoked_at"])
    op.create_index(
        "ix_device_grants_revoked_by_user_id",
        "device_grants",
        ["revoked_by_user_id"],
    )
    op.create_index(
        "ix_device_grants_device_profile",
        "device_grants",
        ["device_id", "health_profile_id"],
    )
    op.create_index(
        "uq_device_grants_active",
        "device_grants",
        ["device_id", "health_profile_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
        sqlite_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_table("device_grants")
    op.drop_table("device_credentials")
    op.drop_table("device_pairings")
    op.drop_table("devices")
