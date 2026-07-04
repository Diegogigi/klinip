"""add coverage foundation

Revision ID: 20260704_000001
Revises: 20260416_000001
Create Date: 2026-07-04 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "20260704_000001"
down_revision = "20260416_000001"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_table("coverage_preferences"):
        op.create_table(
            "coverage_preferences",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("profile_id", sa.Integer(), sa.ForeignKey("health_profiles.id"), nullable=False),
            sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=True),
            sa.Column("payer_type", sa.String(), nullable=True),
            sa.Column("provider_name", sa.String(), nullable=True),
            sa.Column("plan_name", sa.String(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("configured_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("profile_id", name="uq_coverage_preferences_profile"),
        )

    if not _has_table("document_coverage_info"):
        op.create_table(
            "document_coverage_info",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("documents.id"), nullable=False),
            sa.Column("profile_id", sa.Integer(), sa.ForeignKey("health_profiles.id"), nullable=True),
            sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("category", sa.String(), nullable=True),
            sa.Column("payer_type", sa.String(), nullable=True),
            sa.Column("provider_name", sa.String(), nullable=True),
            sa.Column("entity_name", sa.String(), nullable=True),
            sa.Column("amount_total", sa.Float(), nullable=True),
            sa.Column("amount_covered", sa.Float(), nullable=True),
            sa.Column("amount_patient", sa.Float(), nullable=True),
            sa.Column("amount_reimbursed", sa.Float(), nullable=True),
            sa.Column("currency", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("document_id", name="uq_document_coverage_info_document"),
        )

    statements = [
        "CREATE INDEX IF NOT EXISTS ix_coverage_preferences_profile_id ON coverage_preferences (profile_id)",
        "CREATE INDEX IF NOT EXISTS ix_coverage_preferences_owner_user_id ON coverage_preferences (owner_user_id)",
        "CREATE INDEX IF NOT EXISTS ix_coverage_preferences_configured_by_user_id ON coverage_preferences (configured_by_user_id)",
        "CREATE INDEX IF NOT EXISTS ix_document_coverage_info_document_id ON document_coverage_info (document_id)",
        "CREATE INDEX IF NOT EXISTS ix_document_coverage_info_profile_id ON document_coverage_info (profile_id)",
        "CREATE INDEX IF NOT EXISTS ix_document_coverage_info_owner_user_id ON document_coverage_info (owner_user_id)",
        "CREATE INDEX IF NOT EXISTS ix_document_coverage_info_category ON document_coverage_info (category)",
    ]
    for stmt in statements:
        bind.execute(text(stmt))


def downgrade() -> None:
    pass
