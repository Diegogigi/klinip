-- Migración: MFA, refresh tokens, audit log y permisos granulares
-- Aplicar: psql $DATABASE_URL -f migrations/add_mfa_sessions_audit.sql

-- ─── MFA en tabla users ───────────────────────────────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS mfa_enabled         BOOLEAN       NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS mfa_secret          VARCHAR,
    ADD COLUMN IF NOT EXISTS mfa_backup_codes_json TEXT;

-- ─── Permisos granulares en profile_relationships ────────────────────────────
ALTER TABLE profile_relationships
    ADD COLUMN IF NOT EXISTS permissions_json TEXT;

-- ─── Refresh tokens ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   VARCHAR NOT NULL UNIQUE,
    device_label VARCHAR NOT NULL DEFAULT '',
    ip_address   VARCHAR NOT NULL DEFAULT '',
    expires_at   TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ,
    revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id   ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash      ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active    ON refresh_tokens (user_id, revoked, expires_at)
    WHERE revoked = FALSE;

-- ─── Audit log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action        VARCHAR NOT NULL,
    resource_type VARCHAR NOT NULL DEFAULT '',
    resource_id   INTEGER,
    ip_address    VARCHAR NOT NULL DEFAULT '',
    user_agent    VARCHAR NOT NULL DEFAULT '',
    metadata_json JSONB   NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id    ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action     ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
