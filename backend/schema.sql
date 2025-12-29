-- Esquema para Postgres (Railway)
-- Ejecuta esto en tu instancia (psql -f schema.sql) antes de correr la app.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    timezone TEXT DEFAULT 'America/Santiago',
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
    file_path TEXT NOT NULL,
    date TIMESTAMPTZ,
    center TEXT DEFAULT '',
    notes TEXT,
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
    end_date TIMESTAMPTZ,
    notes TEXT,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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


ALTER TABLE users
    ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Santiago';
