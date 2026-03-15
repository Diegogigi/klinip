import os

from app.jobs.registry import (
    format_job_metrics,
    job_retry_count,
    job_specs,
    job_timeout_seconds,
    schedule_interval_seconds,
)
from app.jobs.runtime import run_worker_loop as _run_worker_loop

WORKER_CYCLE_BUDGET_SECONDS = max(
    15,
    int(os.getenv("WORKER_CYCLE_BUDGET_SECONDS", "50") or "50"),
)


def run_worker_loop():
    interval_seconds = max(
        5,
        int(
            os.getenv("WORKER_INTERVAL_SECONDS", str(schedule_interval_seconds()))
            or schedule_interval_seconds()
        ),
    )
    _run_worker_loop(
        job_specs_provider=job_specs,
        format_metrics=format_job_metrics,
        retry_counter=job_retry_count,
        timeout_resolver=job_timeout_seconds,
        interval_seconds=interval_seconds,
        cycle_budget_seconds=WORKER_CYCLE_BUDGET_SECONDS,
        role_label="background",
    )


if __name__ == "__main__":
    run_worker_loop()
