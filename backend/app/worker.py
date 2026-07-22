from __future__ import annotations

import os
import sys
from dataclasses import dataclass

from app.env_loader import load_project_env
from app.jobs.locking import JobLockManager, default_job_lock_manager
from app.jobs.registry import (
    format_job_metrics,
    job_retry_count,
    job_specs,
    job_timeout_seconds,
)
from app.jobs.runtime import WorkerRuntime


class WorkerConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class WorkerSettings:
    interval_seconds: int
    cycle_budget_seconds: int


def _parse_int(name: str, default: int, minimum: int) -> int:
    raw = (os.getenv(name) or str(default)).strip()
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise WorkerConfigurationError(f"invalid_integer:{name}") from None
    if value < minimum:
        raise WorkerConfigurationError(f"below_minimum:{name}")
    return value


def _is_truthy(name: str) -> bool:
    return (os.getenv(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def load_worker_settings() -> WorkerSettings:
    load_project_env()
    if _is_truthy("ENABLE_EMBEDDED_SCHEDULER"):
        raise WorkerConfigurationError("embedded_scheduler_must_be_disabled")
    secret_key = (os.getenv("SECRET_KEY") or "").strip()
    if secret_key in {"", "supersecretkey_change_me_in_production", "<genera_una_clave_segura>"}:
        raise WorkerConfigurationError("missing_critical:SECRET_KEY")

    values = {
        "WORKER_INTERVAL_SECONDS": (60, 5),
        "WORKER_CYCLE_BUDGET_SECONDS": (50, 15),
        "WORKER_JOB_RETRIES": (1, 0),
        "WORKER_JOB_TIMEOUT_SECONDS": (25, 5),
        "APPOINTMENT_REMINDER_BATCH_SIZE": (12, 1),
        "APPOINTMENT_REMINDER_APPOINTMENT_LIMIT": (48, 1),
        "MEDICATION_REMINDER_BATCH_SIZE": (10, 1),
        "MEDICATION_REMINDER_MEDICATION_LIMIT": (40, 1),
        "REFILL_ALERT_BATCH_SIZE": (12, 1),
        "FAMILY_AI_REFRESH_BATCH_SIZE": (4, 1),
        "SCHEDULE_GRACE_SECONDS": (150, 1),
    }
    parsed = {
        name: _parse_int(name, default, minimum)
        for name, (default, minimum) in values.items()
    }
    return WorkerSettings(
        interval_seconds=parsed["WORKER_INTERVAL_SECONDS"],
        cycle_budget_seconds=parsed["WORKER_CYCLE_BUDGET_SECONDS"],
    )


def _validate_database_backend(lock_manager: JobLockManager) -> None:
    environment = (
        os.getenv("RAILWAY_ENVIRONMENT_NAME")
        or os.getenv("RAILWAY_ENVIRONMENT")
        or os.getenv("APP_ENV")
        or "local"
    ).strip().lower()
    is_railway = bool((os.getenv("RAILWAY_PROJECT_ID") or "").strip())
    if (environment == "production" or is_railway) and lock_manager.backend_name != "postgresql":
        raise WorkerConfigurationError("production_requires_postgresql")
    if lock_manager.backend_name not in {"postgresql", "sqlite"}:
        raise WorkerConfigurationError("unsupported_database_backend")


def build_worker_runtime(
    *,
    settings: WorkerSettings | None = None,
    lock_manager: JobLockManager | None = None,
) -> WorkerRuntime:
    resolved_settings = settings or load_worker_settings()
    resolved_lock_manager = lock_manager or default_job_lock_manager()
    _validate_database_backend(resolved_lock_manager)
    return WorkerRuntime(
        job_specs_provider=job_specs,
        format_metrics=format_job_metrics,
        retry_counter=job_retry_count,
        timeout_resolver=job_timeout_seconds,
        interval_seconds=resolved_settings.interval_seconds,
        cycle_budget_seconds=resolved_settings.cycle_budget_seconds,
        role_label="background",
        lock_manager=resolved_lock_manager,
    )


def run_worker_loop() -> None:
    build_worker_runtime().run()


def main() -> int:
    try:
        run_worker_loop()
        return 0
    except WorkerConfigurationError as exc:
        print(f"ERROR worker event=startup_failed reason={exc}")
        return 2
    except Exception as exc:
        print(f"ERROR worker event=startup_failed error_class={exc.__class__.__name__}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
