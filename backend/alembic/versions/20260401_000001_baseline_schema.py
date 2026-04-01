"""baseline schema bootstrap

Revision ID: 20260401_000001
Revises:
Create Date: 2026-04-01 06:40:00
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

from app.database import Base
from app import models  # noqa: F401


# revision identifiers, used by Alembic.
revision = "20260401_000001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)

    backend = bind.dialect.name
    statements = [
        "CREATE INDEX IF NOT EXISTS ix_documents_profile_id ON documents (profile_id)",
        "CREATE INDEX IF NOT EXISTS ix_voice_sessions_profile_id ON voice_sessions (profile_id)",
        "CREATE INDEX IF NOT EXISTS ix_voice_sessions_user_id ON voice_sessions (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_medication_intakes_user_medication ON medication_intakes (user_id, medication_id)",
        "CREATE INDEX IF NOT EXISTS ix_medication_intakes_medication_taken_at ON medication_intakes (medication_id, taken_at)",
        "CREATE INDEX IF NOT EXISTS ix_medication_intakes_medication_scheduled_at ON medication_intakes (medication_id, scheduled_at)",
        "CREATE INDEX IF NOT EXISTS ix_adherence_summaries_profile_med_window ON adherence_summaries (profile_id, medication_id, window_days)",
    ]

    if backend == "postgresql":
        statements.insert(0, "CREATE EXTENSION IF NOT EXISTS vector")

    for stmt in statements:
        bind.execute(text(stmt))


def downgrade() -> None:
    # Baseline no destructivo: no se intenta eliminar el esquema existente.
    pass
