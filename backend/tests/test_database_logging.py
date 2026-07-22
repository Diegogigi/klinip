import logging

import pytest
from sqlalchemy import create_engine

from app.database import (
    _database_log_summary,
    _log_database_configuration,
    _prepare_database_url,
)


SENSITIVE_VALUES = {
    "db_user_sensitive",
    "db_password_sensitive",
    "token_query_sensitive",
}


def _assert_no_sensitive_value(value: str) -> None:
    for sensitive in SENSITIVE_VALUES:
        assert sensitive not in value


@pytest.mark.parametrize(
    "raw_url",
    [
        (
            "postgresql://db_user_sensitive:db_password_sensitive@db.example.test:5433/klinip"
            "?application_name=worker&token=token_query_sensitive"
        ),
        (
            "postgres://db_user_sensitive:db_password_sensitive%40escaped@db.example.test/klinip"
            "?password=token_query_sensitive"
        ),
        "postgresql://db.example.test/klinip?sslmode=verify-full&token=token_query_sensitive",
        "postgresql:///klinip?token=token_query_sensitive",
    ],
)
def test_postgresql_log_never_exposes_credentials_or_query_values(raw_url, caplog):
    normalized_url, parsed = _prepare_database_url(raw_url)

    caplog.set_level(logging.INFO, logger="app.database")
    _log_database_configuration(parsed)

    assert _database_log_summary(parsed) == "postgresql on configured host"
    assert "Database configured: postgresql on configured host" in caplog.text
    assert raw_url not in caplog.text
    _assert_no_sensitive_value(caplog.text)

    engine = create_engine(normalized_url)
    try:
        assert engine.url.get_backend_name() == "postgresql"
        assert "sslmode" in engine.url.query
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    ("raw_url", "expected_summary"),
    [
        (None, "sqlite (file)"),
        ("sqlite:///:memory:", "sqlite (memory)"),
        ("sqlite:///C:/private/path/klinip.db", "sqlite (file)"),
    ],
)
def test_sqlite_log_identifies_storage_without_exposing_paths(raw_url, expected_summary, caplog):
    normalized_url, parsed = _prepare_database_url(raw_url)

    caplog.set_level(logging.INFO, logger="app.database")
    _log_database_configuration(parsed)

    assert _database_log_summary(parsed) == expected_summary
    assert f"Database configured: {expected_summary}" in caplog.text
    assert "private/path" not in caplog.text
    assert "mirutasalud.db" not in caplog.text

    engine = create_engine(normalized_url, connect_args={"check_same_thread": False})
    engine.dispose()


@pytest.mark.parametrize(
    "raw_url",
    [
        "not a database URL db_user_sensitive db_password_sensitive",
        "unknown://db_user_sensitive:db_password_sensitive@host/db?token=token_query_sensitive",
    ],
)
def test_invalid_database_url_raises_sanitized_error(raw_url):
    with pytest.raises(RuntimeError) as exc_info:
        _prepare_database_url(raw_url)

    message = str(exc_info.value)
    assert message in {
        "Invalid DATABASE_URL configuration",
        "Unsupported DATABASE_URL configuration",
    }
    assert raw_url not in message
    _assert_no_sensitive_value(message)
