-- Migration de respaldo para entornos antiguos.
-- Crea tablas faltantes y agrega columnas nuevas usadas por la app.

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_notification_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    trigger_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS privacy_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    message TEXT NOT NULL,
    include_tech BOOLEAN DEFAULT FALSE,
    user_email TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS privacy_export_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT DEFAULT 'export',
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS file_data BYTEA;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS filename TEXT;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS ocr_text TEXT;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS ocr_status TEXT DEFAULT 'pending';

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS ocr_lang TEXT DEFAULT 'spa';

