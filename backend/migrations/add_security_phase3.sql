-- Migración: Seguridad Fase 3 — índices de rendimiento y auditoría de documentos
-- Cambios de aplicación incluidos en esta fase (sin nuevas tablas):
--   • Validación MIME con magic bytes en upload de documentos
--   • Detección de burst de descargas (in-memory, no requiere columnas)
--   • Step-up re-authentication via JWT (no requiere tabla, token en header X-StepUp-Token)
--   • Cifrado de mfa_secret en reposo (formato "enc:<fernet>" en columna existente)
--   • Permiso granular download_documents aplicado en GET /documents/{id}/file
--   • Auditoría de uso de documentos en contexto IA
--
-- Aplicar: psql $DATABASE_URL -f migrations/add_security_phase3.sql

-- ─── Índices de rendimiento para auditoría de documentos ──────────────────────
-- Acelera búsquedas de eventos de descarga por recurso específico
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
    ON audit_logs (resource_type, resource_id)
    WHERE resource_type <> '';

-- Acelera consultas del historial de auditoría filtradas por acción + usuario
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action
    ON audit_logs (user_id, action, created_at DESC);

-- ─── Índice en profile_relationships para permission checks rápidos ───────────
-- _check_permission() filtra por profile_id + user_id; este índice compuesto lo acelera
CREATE INDEX IF NOT EXISTS idx_profile_relationships_profile_user
    ON profile_relationships (profile_id, user_id)
    WHERE permissions_json IS NOT NULL;

-- ─── Verificación: columna permissions_json debe existir (Fase 2) ─────────────
-- Si este ALTER falla significa que la migración add_mfa_sessions_audit.sql
-- no se aplicó previamente. Aplicarla primero.
ALTER TABLE profile_relationships
    ADD COLUMN IF NOT EXISTS permissions_json TEXT;
