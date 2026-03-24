-- Klinip Voice: tabla de sesiones de voz
-- Creada: 2026-03-24

CREATE TABLE IF NOT EXISTS voice_sessions (
    id              SERIAL PRIMARY KEY,
    profile_id      INTEGER NOT NULL REFERENCES health_profiles(id),
    user_id         INTEGER NOT NULL REFERENCES users(id),
    created_at      TIMESTAMP DEFAULT NOW(),
    audio_consent   TEXT,
    audio_session   TEXT,
    audio_session_hash TEXT,
    transcripcion_tecnica TEXT,
    version_simple  TEXT,
    indicaciones    JSONB DEFAULT '[]',
    compartido_en   TIMESTAMP,
    link_seguro     TEXT,
    link_expira_en  TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_voice_sessions_profile_id ON voice_sessions(profile_id);
CREATE INDEX IF NOT EXISTS ix_voice_sessions_user_id ON voice_sessions(user_id);
