"""add clinical episodes foundation

Revision ID: 20260415_000001
Revises: 20260402_000001
Create Date: 2026-04-15 12:20:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "20260415_000001"
down_revision = "20260402_000001"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return inspect(op.get_bind()).has_table(name)


def _has_column(table: str, column: str) -> bool:
    inspector = inspect(op.get_bind())
    if not inspector.has_table(table):
        return False
    return any(item["name"] == column for item in inspector.get_columns(table))


def _add_column_if_missing(table: str, column, sqlite_sql: str | None = None) -> None:
    if _has_column(table, column.name):
        return
    bind = op.get_bind()
    backend = bind.dialect.name
    if backend == "sqlite" and sqlite_sql:
        bind.execute(text(sqlite_sql))
        return
    op.add_column(table, column)


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_table("clinical_episodes"):
        op.create_table(
            "clinical_episodes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("profile_id", sa.Integer(), sa.ForeignKey("health_profiles.id"), nullable=False),
            sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("episode_type", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("source", sa.String(), nullable=True),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("last_activity_at", sa.DateTime(), nullable=True),
            sa.Column("closed_at", sa.DateTime(), nullable=True),
            sa.Column("summary", sa.Text(), nullable=True),
            sa.Column("care_summary", sa.Text(), nullable=True),
            sa.Column("tags_json", sa.JSON(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )

    if not _has_table("clinical_tasks"):
        op.create_table(
            "clinical_tasks",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("episode_id", sa.Integer(), sa.ForeignKey("clinical_episodes.id"), nullable=False),
            sa.Column("profile_id", sa.Integer(), sa.ForeignKey("health_profiles.id"), nullable=False),
            sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("task_type", sa.String(), nullable=True),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("due_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("source_module", sa.String(), nullable=True),
            sa.Column("source_record_type", sa.String(), nullable=True),
            sa.Column("source_record_id", sa.Integer(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint(
                "episode_id",
                "source_record_type",
                "source_record_id",
                "task_type",
                name="uq_clinical_task_source",
            ),
        )

    _add_column_if_missing(
        "appointments",
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("health_profiles.id"), nullable=True),
        "ALTER TABLE appointments ADD COLUMN profile_id INTEGER",
    )
    _add_column_if_missing(
        "appointments",
        sa.Column("episode_id", sa.Integer(), sa.ForeignKey("clinical_episodes.id"), nullable=True),
        "ALTER TABLE appointments ADD COLUMN episode_id INTEGER",
    )
    _add_column_if_missing(
        "documents",
        sa.Column("episode_id", sa.Integer(), sa.ForeignKey("clinical_episodes.id"), nullable=True),
        "ALTER TABLE documents ADD COLUMN episode_id INTEGER",
    )
    _add_column_if_missing(
        "medications",
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("health_profiles.id"), nullable=True),
        "ALTER TABLE medications ADD COLUMN profile_id INTEGER",
    )
    _add_column_if_missing(
        "medications",
        sa.Column("episode_id", sa.Integer(), sa.ForeignKey("clinical_episodes.id"), nullable=True),
        "ALTER TABLE medications ADD COLUMN episode_id INTEGER",
    )
    _add_column_if_missing(
        "medication_purchases",
        sa.Column("episode_id", sa.Integer(), sa.ForeignKey("clinical_episodes.id"), nullable=True),
        "ALTER TABLE medication_purchases ADD COLUMN episode_id INTEGER",
    )
    _add_column_if_missing(
        "external_clinical_records",
        sa.Column("episode_id", sa.Integer(), sa.ForeignKey("clinical_episodes.id"), nullable=True),
        "ALTER TABLE external_clinical_records ADD COLUMN episode_id INTEGER",
    )

    statements = [
        "CREATE INDEX IF NOT EXISTS ix_appointments_profile_id ON appointments (profile_id)",
        "CREATE INDEX IF NOT EXISTS ix_appointments_episode_id ON appointments (episode_id)",
        "CREATE INDEX IF NOT EXISTS ix_documents_episode_id ON documents (episode_id)",
        "CREATE INDEX IF NOT EXISTS ix_medications_profile_id ON medications (profile_id)",
        "CREATE INDEX IF NOT EXISTS ix_medications_episode_id ON medications (episode_id)",
        "CREATE INDEX IF NOT EXISTS ix_medication_purchases_episode_id ON medication_purchases (episode_id)",
        "CREATE INDEX IF NOT EXISTS ix_external_clinical_records_episode_id ON external_clinical_records (episode_id)",
        "CREATE INDEX IF NOT EXISTS ix_clinical_episodes_profile_status ON clinical_episodes (profile_id, status)",
        "CREATE INDEX IF NOT EXISTS ix_clinical_tasks_episode_status ON clinical_tasks (episode_id, status)",
    ]
    for stmt in statements:
        bind.execute(text(stmt))


def downgrade() -> None:
    pass
