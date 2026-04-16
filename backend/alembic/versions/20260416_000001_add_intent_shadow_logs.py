"""add intent shadow logs

Revision ID: 20260416_000001
Revises: 20260415_000001
Create Date: 2026-04-16 12:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "20260416_000001"
down_revision = "20260415_000001"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_table("intent_shadow_logs"):
        op.create_table(
            "intent_shadow_logs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id"),
                nullable=False,
            ),
            sa.Column(
                "profile_id",
                sa.Integer(),
                sa.ForeignKey("health_profiles.id"),
                nullable=True,
            ),
            sa.Column("conversation_id", sa.String(), nullable=True),
            sa.Column("source", sa.String(), nullable=True),
            sa.Column("message_preview", sa.String(), nullable=True),
            sa.Column("intent_predicted", sa.String(), nullable=True),
            sa.Column("intent_source", sa.String(), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=True),
            sa.Column("used_llm_fallback", sa.Boolean(), nullable=True),
            sa.Column("clinical_phase", sa.String(), nullable=True),
            sa.Column("clinical_urgency", sa.String(), nullable=True),
            sa.Column("primary_episode_id", sa.Integer(), nullable=True),
            sa.Column("would_change_response", sa.Boolean(), nullable=True),
            sa.Column("latency_ms", sa.Integer(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )

    statements = [
        "CREATE INDEX IF NOT EXISTS ix_intent_shadow_logs_user_id ON intent_shadow_logs (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_intent_shadow_logs_profile_id ON intent_shadow_logs (profile_id)",
        "CREATE INDEX IF NOT EXISTS ix_intent_shadow_logs_conversation_id ON intent_shadow_logs (conversation_id)",
        "CREATE INDEX IF NOT EXISTS ix_intent_shadow_logs_source ON intent_shadow_logs (source)",
        "CREATE INDEX IF NOT EXISTS ix_intent_shadow_logs_intent_predicted ON intent_shadow_logs (intent_predicted)",
        "CREATE INDEX IF NOT EXISTS ix_intent_shadow_logs_clinical_phase ON intent_shadow_logs (clinical_phase)",
        "CREATE INDEX IF NOT EXISTS ix_intent_shadow_logs_would_change_response ON intent_shadow_logs (would_change_response)",
        "CREATE INDEX IF NOT EXISTS ix_intent_shadow_logs_created_at ON intent_shadow_logs (created_at)",
    ]
    for stmt in statements:
        bind.execute(text(stmt))


def downgrade() -> None:
    pass
