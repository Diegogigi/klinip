import os
import time


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
        {"name": "send_appointment_reminders", "handler": main_module._job_send_appointment_reminders},
        {"name": "send_medication_reminders", "handler": main_module._job_send_medication_reminders},
        {"name": "send_refill_alerts", "handler": main_module._job_send_refill_alerts},
        {"name": "refresh_profile_ai", "handler": main_module._job_refresh_profile_ai},
        {"name": "refresh_family_ai", "handler": main_module._job_refresh_family_ai},
    ]


def run_scheduled_jobs_once() -> list[dict]:
    # Notification jobs MUST run within the schedule window or reminders are
    # permanently missed.  Enforce a cycle budget so that slow AI jobs cannot
    # starve appointment/medication reminder jobs.
    cycle_budget = float(os.getenv("WORKER_CYCLE_BUDGET_SECONDS") or "50")
    job_timeout = float(os.getenv("WORKER_JOB_TIMEOUT_SECONDS") or "25")
    cycle_start = time.time()
    summaries = []
    for spec in job_specs():
        elapsed = time.time() - cycle_start
        remaining = cycle_budget - elapsed
        if remaining <= 0:
            print(
                f"WARNING scheduler: cycle budget exhausted, skipping {spec['name']} "
                f"elapsed_s={elapsed:.1f} budget_s={cycle_budget}"
            )
            break
        deadline_at = time.time() + min(remaining, job_timeout)
        started = time.time()
        try:
            metrics = spec["handler"](deadline_at=deadline_at)
        except Exception as exc:
            metrics = {"job": spec["name"], "errors": 1}
            print(f"WARNING scheduler job {spec['name']}: {exc}")
        metrics["elapsed_ms"] = int((time.time() - started) * 1000)
        summaries.append(metrics)
    return summaries
