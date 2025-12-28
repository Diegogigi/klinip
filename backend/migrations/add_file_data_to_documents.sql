-- Migración: Agregar campos file_data y filename a la tabla documents
-- Ejecutar este script en la base de datos PostgreSQL de Railway

-- Agregar columna file_data (LargeBinary/BYTEA)
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS file_data BYTEA;

-- Agregar columna filename (String)
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS filename VARCHAR;

-- Hacer file_path nullable (ya no es requerido para archivos nuevos)
ALTER TABLE documents 
ALTER COLUMN file_path DROP NOT NULL;

-- Comentarios para documentación
COMMENT ON COLUMN documents.file_data IS 'Datos del archivo almacenados en la base de datos (BLOB)';
COMMENT ON COLUMN documents.filename IS 'Nombre original del archivo';
COMMENT ON COLUMN documents.file_path IS 'Ruta del archivo en sistema de archivos (legacy, nullable para compatibilidad)';











