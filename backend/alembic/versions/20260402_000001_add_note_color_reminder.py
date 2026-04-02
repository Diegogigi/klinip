"""Add color, reminder_at, reminder_sent to profile_notes

Revision ID: 20260402_000001
Revises: 20260401_000001
Create Date: 2026-04-02
"""

from alembic import op
import sqlalchemy as sa

revision = "20260402_000001"
down_revision = "20260401_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "profile_notes",
        sa.Column("color", sa.String(), nullable=True, server_default="yellow"),
    )
    op.add_column(
        "profile_notes",
        sa.Column("reminder_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "profile_notes",
        sa.Column("reminder_sent", sa.Boolean(), nullable=True, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("profile_notes", "reminder_sent")
    op.drop_column("profile_notes", "reminder_at")
    op.drop_column("profile_notes", "color")
