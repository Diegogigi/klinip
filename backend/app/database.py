import logging
import os

from sqlalchemy import create_engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import declarative_base, sessionmaker

from .env_loader import load_project_env

load_project_env()

logger = logging.getLogger(__name__)
_DEFAULT_DATABASE_URL = "sqlite:///./mirutasalud.db"


def _prepare_database_url(raw_url: str | None) -> tuple[str, URL]:
    value = (raw_url or "").strip() or _DEFAULT_DATABASE_URL
    if value.startswith("postgres://"):
        value = value.replace("postgres://", "postgresql://", 1)
    try:
        parsed = make_url(value)
        backend = parsed.get_backend_name()
    except Exception:
        raise RuntimeError("Invalid DATABASE_URL configuration") from None
    if backend not in {"postgresql", "sqlite"}:
        raise RuntimeError("Unsupported DATABASE_URL configuration")
    if backend == "postgresql" and "sslmode" not in parsed.query:
        parsed = parsed.update_query_dict({"sslmode": "require"})
    return parsed.render_as_string(hide_password=False), parsed


def _database_log_summary(parsed: URL) -> str:
    if parsed.get_backend_name() == "sqlite":
        storage = "memory" if parsed.database in {None, "", ":memory:"} else "file"
        return f"sqlite ({storage})"
    return "postgresql on configured host"


def _log_database_configuration(parsed: URL) -> None:
    logger.info("Database configured: %s", _database_log_summary(parsed))


DATABASE_URL, _PARSED_DATABASE_URL = _prepare_database_url(os.getenv("DATABASE_URL"))
_log_database_configuration(_PARSED_DATABASE_URL)

connect_args = {}
if _PARSED_DATABASE_URL.get_backend_name() == "sqlite":
    connect_args = {"check_same_thread": False}

engine_kwargs = {"connect_args": connect_args}
if _PARSED_DATABASE_URL.get_backend_name() == "postgresql":
    # Keep stale connections from surviving Railway restarts or network blips.
    engine_kwargs.update(
        {
            "pool_pre_ping": True,
            "pool_recycle": int(os.getenv("DB_POOL_RECYCLE", "1800")),
            "pool_size": int(os.getenv("DB_POOL_SIZE", "10")),
            "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "20")),
            "pool_timeout": int(os.getenv("DB_POOL_TIMEOUT", "30")),
        }
    )

engine = create_engine(DATABASE_URL, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
