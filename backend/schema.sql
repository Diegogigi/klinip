-- Esquema para Postgres (Railway)
-- Ejecuta esto en tu instancia (psql -f schema.sql) antes de correr la app.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    timezone TEXT DEFAULT 'America/Santiago',
    notifications_consent TEXT DEFAULT '',
    notifications_last_prompt TIMESTAMPTZ,
    token_version INTEGER DEFAULT 0,
    data_consent_revoked BOOLEAN DEFAULT FALSE,
    deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE appointment_type AS ENUM ('cita', 'examen', 'tramite');
CREATE TYPE appointment_status AS ENUM ('pendiente', 'agendada', 'realizada');
CREATE TYPE document_type AS ENUM ('receta', 'orden', 'resultado', 'informe', 'otro');

CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type appointment_type NOT NULL,
    specialty TEXT DEFAULT '',
    center TEXT DEFAULT '',
    date_time TIMESTAMPTZ,
    status appointment_status DEFAULT 'pendiente',
    notes TEXT,
    checklist JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    doc_type document_type NOT NULL,
    file_path TEXT,
    file_data BYTEA,
    filename TEXT,
    date TIMESTAMPTZ,
    center TEXT DEFAULT '',
    notes TEXT,
    ocr_text TEXT,
    ocr_status TEXT DEFAULT 'pending',
    ocr_lang TEXT DEFAULT 'spa',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    dose TEXT DEFAULT '',
    frequency TEXT DEFAULT '',
    duration TEXT DEFAULT '',
    schedule_time TEXT DEFAULT '',
    completed BOOLEAN DEFAULT FALSE,
    end_date TIMESTAMPTZ,
    notes TEXT,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medication_intakes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    taken_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);


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
    ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Santiago';

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS notifications_consent TEXT DEFAULT '';

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS notifications_last_prompt TIMESTAMPTZ;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS data_consent_revoked BOOLEAN DEFAULT FALSE;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE;

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
