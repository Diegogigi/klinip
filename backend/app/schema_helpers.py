"""
Helpers para migraciones ligeras de esquema (runtime schema mutations).
Centraliza la logica de ALTER TABLE adaptada a PostgreSQL y SQLite.
"""
from sqlalchemy import text, inspect


def _add_column_stmt(table: str, name: str, type_def: str, backend: str) -> str:
    """Genera un ALTER TABLE ADD COLUMN adaptado a PostgreSQL o SQLite."""
    if backend == "postgresql":
        return f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {type_def}"
    return f"ALTER TABLE {table} ADD COLUMN {name} {type_def}"


def ensure_columns(
    engine,
    table: str,
    column_defs: list,
    label: str = "",
    post_add_sql: list = None,
    extra_indexes: list = None,
) -> list:
    """
    Garantiza que una tabla tenga las columnas indicadas.

    column_defs: lista de tuplas (nombre, tipo_sql[, tipo_sqlite])
        Si se da tipo_sqlite, se usa para SQLite; si no, se usa el mismo tipo.
    post_add_sql: sentencias SQL a ejecutar despues de agregar columnas.
    extra_indexes: sentencias CREATE INDEX a intentar despues.

    Retorna la lista de columnas agregadas.
    """
    tag = label or f"ensure_columns({table})"
    try:
        inspector = inspect(engine)
        if not inspector.has_table(table):
            return []
        columns = {col["name"] for col in inspector.get_columns(table)}
        backend = engine.url.get_backend_name()
        statements = []
        added_columns = []

        for col_def in column_defs:
            name = col_def[0]
            pg_type = col_def[1]
            sqlite_type = col_def[2] if len(col_def) > 2 else pg_type
            if name not in columns:
                type_def = pg_type if backend == "postgresql" else sqlite_type
                statements.append(_add_column_stmt(table, name, type_def, backend))
                added_columns.append(name)

        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
                for idx_stmt in (extra_indexes or []):
                    try:
                        conn.execute(text(idx_stmt))
                    except Exception:
                        pass
                for post_stmt in (post_add_sql or []):
                    try:
                        conn.execute(text(post_stmt))
                    except Exception:
                        pass
            print(f"DEBUG {tag}: columnas agregadas: {', '.join(added_columns)}")
        else:
            print(f"DEBUG {tag}: tabla ya esta al dia")
        return added_columns
    except Exception as exc:
        print(f"WARNING {tag}: no se pudo ajustar la tabla: {exc}")
        return []
