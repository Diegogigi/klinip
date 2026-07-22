import os
import time

from app.jobs.locking import JobLockError, default_job_lock_manager


def _main_module():
    from app import main as main_module

    return main_module


def embedded_scheduler_enabled() -> bool:
    raw = (os.getenv("ENABLE_EMBEDDED_SCHEDULER") or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def schedule_interval_seconds() -> int:
    return int(_main_module().SCHEDULE_INTERVAL_SECONDS)


def format_job_metrics(metrics: dict) -> str:
    return _main_module()._format_job_metrics(metrics)


def job_retry_count(job_name: str) -> int:
    return int(_main_module()._job_retry_count(job_name))


def job_timeout_seconds(job_name: str) -> int:
    return int(_main_module()._job_timeout_seconds(job_name))


def job_specs() -> list[dict]:
    main_module = _main_module()
    return [
        {
            "name": "send_appointment_reminders",
            "handler": main_module._job_send_appointment_reminders,
            "retry_safe": False,
        },
        {
            "name": "send_medication_reminders",
            "handler": main_module._job_send_medication_reminders,
            "retry_safe": False,
        },
        {
            "name": "send_refill_alerts",
            "handler": main_module._job_send_refill_alerts,
            "retry_safe": False,
        },
        {
            "name": "send_note_reminders",
            "handler": main_module._job_send_note_reminders,
            "retry_safe": False,
        },
        {
            "name": "refresh_profile_ai",
            "handler": main_module._job_refresh_profile_ai,
            "retry_safe": True,
        },
        {
            "name": "refresh_family_ai",
            "handler": main_module._job_refresh_family_ai,
            "retry_safe": True,
        },
    ]


def run_scheduled_jobs_once() -> list[dict]:
    # Notification jobs MUST run within the schedule window or reminders are
    # permanently missed.  Enforce a cycle budget so that slow AI jobs cannot
    # starve appointment/medication reminder jobs.
    cycle_budget = float(os.getenv("WORKER_CYCLE_BUDGET_SECONDS") or "50")
    job_timeout = float(os.getenv("WORKER_JOB_TIMEOUT_SECONDS") or "25")
    cycle_start = time.monotonic()
    summaries = []
    lock_manager = default_job_lock_manager()
    for spec in job_specs():
        elapsed = time.monotonic() - cycle_start
        remaining = cycle_budget - elapsed
        if remaining <= 0:
            print(
                f"WARNING scheduler: cycle budget exhausted, skipping {spec['name']} "
                f"elapsed_s={elapsed:.1f} budget_s={cycle_budget}"
            )
            break
        deadline_at = time.time() + min(
            remaining,
            float(job_timeout_seconds(spec["name"]) or job_timeout),
        )
        started = time.monotonic()
        try:
            with lock_manager.acquire(spec["name"]) as acquired:
                if not acquired:
                    print(f"INFO scheduler job {spec['name']}: skipped_lock=yes")
                    summaries.append({"job": spec["name"], "skipped_lock": True})
                    continue
                metrics = spec["handler"](deadline_at=deadline_at)
        except Exception as exc:
            metrics = {"job": spec["name"], "errors": 1}
            phase = "lock" if isinstance(exc, JobLockError) else "execution"
            print(
                f"WARNING scheduler job {spec['name']}: phase={phase} "
                f"error_class={exc.__class__.__name__}"
            )
        metrics["elapsed_ms"] = int((time.monotonic() - started) * 1000)
        summaries.append(metrics)
    return summaries
