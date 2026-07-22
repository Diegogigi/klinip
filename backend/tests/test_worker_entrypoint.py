from __future__ import annotations

import os
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

from app import worker
from app.jobs import registry


WORKER_ENV_NAMES = [
    "WORKER_INTERVAL_SECONDS",
    "WORKER_CYCLE_BUDGET_SECONDS",
    "WORKER_JOB_RETRIES",
    "WORKER_JOB_TIMEOUT_SECONDS",
    "APPOINTMENT_REMINDER_BATCH_SIZE",
    "APPOINTMENT_REMINDER_APPOINTMENT_LIMIT",
    "MEDICATION_REMINDER_BATCH_SIZE",
    "MEDICATION_REMINDER_MEDICATION_LIMIT",
    "REFILL_ALERT_BATCH_SIZE",
    "FAMILY_AI_REFRESH_BATCH_SIZE",
    "SCHEDULE_GRACE_SECONDS",
    "ENABLE_EMBEDDED_SCHEDULER",
]


class FakeManager:
    def __init__(self, backend_name):
        self.backend_name = backend_name

    @contextmanager
    def acquire(self, _name):
        yield True


def _clear_worker_env(monkeypatch):
    for name in WORKER_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)


def test_valid_worker_settings_use_safe_defaults(monkeypatch):
    _clear_worker_env(monkeypatch)

    settings = worker.load_worker_settings()

    assert settings.interval_seconds == 60
    assert settings.cycle_budget_seconds == 50


def test_valid_worker_settings_accept_explicit_values(monkeypatch):
    _clear_worker_env(monkeypatch)
    monkeypatch.setenv("WORKER_INTERVAL_SECONDS", "30")
    monkeypatch.setenv("WORKER_CYCLE_BUDGET_SECONDS", "20")

    settings = worker.load_worker_settings()

    assert settings.interval_seconds == 30
    assert settings.cycle_budget_seconds == 20


def test_invalid_integer_reports_variable_name_without_value(monkeypatch):
    _clear_worker_env(monkeypatch)
    monkeypatch.setenv("WORKER_INTERVAL_SECONDS", "secret-value")

    try:
        worker.load_worker_settings()
    except worker.WorkerConfigurationError as exc:
        assert str(exc) == "invalid_integer:WORKER_INTERVAL_SECONDS"
        assert "secret-value" not in str(exc)
    else:
        raise AssertionError("invalid integer should fail")


def test_embedded_scheduler_must_be_disabled(monkeypatch):
    _clear_worker_env(monkeypatch)
    monkeypatch.setenv("ENABLE_EMBEDDED_SCHEDULER", "true")

    try:
        worker.load_worker_settings()
    except worker.WorkerConfigurationError as exc:
        assert str(exc) == "embedded_scheduler_must_be_disabled"
    else:
        raise AssertionError("embedded scheduler should be rejected")


def test_missing_secret_key_is_reported_without_value(monkeypatch):
    _clear_worker_env(monkeypatch)
    monkeypatch.setenv("SECRET_KEY", "")

    try:
        worker.load_worker_settings()
    except worker.WorkerConfigurationError as exc:
        assert str(exc) == "missing_critical:SECRET_KEY"
    else:
        raise AssertionError("missing secret should fail")


def test_production_requires_postgresql(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")

    try:
        worker._validate_database_backend(FakeManager("sqlite"))
    except worker.WorkerConfigurationError as exc:
        assert str(exc) == "production_requires_postgresql"
    else:
        raise AssertionError("production SQLite should fail")


def test_production_accepts_postgresql(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")

    worker._validate_database_backend(FakeManager("postgresql"))


def test_railway_requires_postgresql_even_without_environment_name(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    monkeypatch.setenv("RAILWAY_PROJECT_ID", "project-id")

    try:
        worker._validate_database_backend(FakeManager("sqlite"))
    except worker.WorkerConfigurationError as exc:
        assert str(exc) == "production_requires_postgresql"
    else:
        raise AssertionError("Railway SQLite should fail")


def test_worker_main_returns_sanitized_configuration_error(monkeypatch, capsys):
    monkeypatch.setattr(
        worker,
        "run_worker_loop",
        lambda: (_ for _ in ()).throw(worker.WorkerConfigurationError("invalid:VARIABLE")),
    )

    assert worker.main() == 2
    assert capsys.readouterr().out.strip().endswith("reason=invalid:VARIABLE")


def test_worker_main_hides_unexpected_exception_message(monkeypatch, capsys):
    monkeypatch.setattr(
        worker,
        "run_worker_loop",
        lambda: (_ for _ in ()).throw(RuntimeError("sensitive-startup-detail")),
    )

    assert worker.main() == 1
    output = capsys.readouterr().out
    assert "sensitive-startup-detail" not in output
    assert "RuntimeError" in output


def test_python_module_worker_imports_without_starting_services():
    backend_root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(backend_root)

    result = subprocess.run(
        [sys.executable, "-c", "import app.worker; print('worker-import-ok')"],
        cwd=backend_root,
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )

    assert result.returncode == 0
    assert "worker-import-ok" in result.stdout


def test_nixpacks_keeps_web_scheduler_disabled():
    repo_root = Path(__file__).resolve().parents[2]
    content = (repo_root / "nixpacks.toml").read_text(encoding="utf-8")

    assert content.count("ENABLE_EMBEDDED_SCHEDULER=false") >= 2


def test_registry_job_order_and_retry_policy(monkeypatch):
    fake_main = SimpleNamespace()
    for name in [
        "_job_send_appointment_reminders",
        "_job_send_medication_reminders",
        "_job_send_refill_alerts",
        "_job_send_note_reminders",
        "_job_refresh_profile_ai",
        "_job_refresh_family_ai",
    ]:
        setattr(fake_main, name, lambda **_kwargs: {})
    monkeypatch.setattr(registry, "_main_module", lambda: fake_main)

    specs = registry.job_specs()

    assert [item["name"] for item in specs] == [
        "send_appointment_reminders",
        "send_medication_reminders",
        "send_refill_alerts",
        "send_note_reminders",
        "refresh_profile_ai",
        "refresh_family_ai",
    ]
    assert [item["retry_safe"] for item in specs] == [False, False, False, False, True, True]


def test_embedded_scheduler_path_skips_locked_job(monkeypatch):
    called = []
    monkeypatch.setattr(
        registry,
        "job_specs",
        lambda: [{"name": "locked", "handler": lambda **_kwargs: called.append(1) or {}}],
    )
    monkeypatch.setattr(registry, "default_job_lock_manager", lambda: FakeLockedManager())
    monkeypatch.setattr(registry, "job_timeout_seconds", lambda _name: 5)

    summaries = registry.run_scheduled_jobs_once()

    assert called == []
    assert summaries == [{"job": "locked", "skipped_lock": True}]


class FakeLockedManager:
    @contextmanager
    def acquire(self, _name):
        yield False
