-- Migración: campos de seguridad para bloqueo de cuenta y rate limiting
-- Aplicar manualmente o al desplegar: psql $DATABASE_URL -f migrations/add_security_fields.sql

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Índice para consultas de desbloqueo en bulk si fuera necesario
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users (locked_until)
    WHERE locked_until IS NOT NULL;
