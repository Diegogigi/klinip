from __future__ import annotations

import os
import signal
import threading
import time
from typing import Callable

from app.jobs.locking import default_job_lock_manager


def _safe_environment_label() -> str:
    raw = (
        os.getenv("RAILWAY_ENVIRONMENT_NAME")
        or os.getenv("RAILWAY_ENVIRONMENT")
        or os.getenv("APP_ENV")
        or "local"
    ).strip().lower()
    return raw if raw in {"production", "staging", "development", "test", "local"} else "unknown"


def _emit_worker_event(event: str, *, level: str = "INFO", **fields) -> None:
    safe_fields = []
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, bool):
            value = "yes" if value else "no"
        safe_fields.append(f"{key}={value}")
    suffix = f" {' '.join(safe_fields)}" if safe_fields else ""
    print(f"{level} worker event={event}{suffix}")


def _safe_metric_summary(metrics: dict) -> str:
    allowed = {
        "users",
        "appointments",
        "medications",
        "queued",
        "refreshed",
        "sent",
        "push_sent",
        "email_sent",
        "errors",
        "timed_out",
        "limit_hit",
        "rollback_count",
    }
    parts = []
    for key in sorted(allowed.intersection(metrics or {})):
        value = metrics[key]
        if isinstance(value, bool):
            value = "yes" if value else "no"
        if isinstance(value, (int, float, str)):
            parts.append(f"{key}:{value}")
    return ",".join(parts) or "none"


def start_embedded_scheduler(
    *,
    run_once,
    format_metrics,
    interval_seconds: int,
):
    def _scheduler_loop():
        while True:
            cycle_started = time.monotonic()
            try:
                summaries = run_once()
                print(
                    "INFO scheduler cycle: "
                    + " | ".join(format_metrics(item) for item in summaries if item)
                )
            except Exception as exc:
                print(f"WARNING scheduler: error_class={exc.__class__.__name__}")
            elapsed = time.monotonic() - cycle_started
            time.sleep(max(1.0, float(interval_seconds or 1) - elapsed))

    thread = threading.Thread(
        target=_scheduler_loop,
        daemon=True,
        name="klinip-embedded-scheduler",
    )
    thread.start()
    return thread


class WorkerRuntime:
    def __init__(
        self,
        *,
        job_specs_provider,
        format_metrics,
        retry_counter,
        timeout_resolver,
        interval_seconds: int,
        cycle_budget_seconds: int,
        role_label: str = "background",
        lock_manager=None,
        stop_event: threading.Event | None = None,
        monotonic_fn: Callable[[], float] = time.monotonic,
        wall_time_fn: Callable[[], float] = time.time,
        signal_registrar=signal.signal,
        retry_delay_seconds: float = 1.0,
    ):
        self.job_specs_provider = job_specs_provider
        self.format_metrics = format_metrics
        self.retry_counter = retry_counter
        self.timeout_resolver = timeout_resolver
        self.interval_seconds = max(1, int(interval_seconds))
        self.cycle_budget_seconds = max(1, int(cycle_budget_seconds))
        self.role_label = role_label
        self.lock_manager = lock_manager or default_job_lock_manager()
        self.stop_event = stop_event or threading.Event()
        self.monotonic_fn = monotonic_fn
        self.wall_time_fn = wall_time_fn
        self.signal_registrar = signal_registrar
        self.retry_delay_seconds = max(0.0, float(retry_delay_seconds))
        self._cycle_guard = threading.Lock()

    def request_stop(self, signum=None, _frame=None) -> None:
        if not self.stop_event.is_set():
            _emit_worker_event("worker_stopping", signal=signum)
        self.stop_event.set()

    def install_signal_handlers(self) -> None:
        self.signal_registrar(signal.SIGTERM, self.request_stop)
        self.signal_registrar(signal.SIGINT, self.request_stop)

    def run_cycle(self, job_specs: list[dict] | None = None) -> dict:
        if not self._cycle_guard.acquire(blocking=False):
            _emit_worker_event("cycle_skipped", reason="already_running")
            return {"status": "skipped_overlap", "jobs_planned": 0, "jobs_succeeded": 0}

        cycle_started = self.monotonic_fn()
        specs = list(job_specs if job_specs is not None else self.job_specs_provider())
        jobs_succeeded = 0
        jobs_failed = 0
        jobs_timed_out = 0
        jobs_skipped_lock = 0
        budget_exhausted = False
        _emit_worker_event("cycle_started", jobs_planned=len(specs))
        try:
            for spec in specs:
                if self.stop_event.is_set():
                    break
                cycle_elapsed = self.monotonic_fn() - cycle_started
                cycle_remaining = self.cycle_budget_seconds - cycle_elapsed
                if cycle_remaining <= 0:
                    budget_exhausted = True
                    break

                job_name = spec["name"]
                handler = spec["handler"]
                configured_retries = max(0, int(self.retry_counter(job_name)))
                retries = configured_retries if bool(spec.get("retry_safe", False)) else 0
                timeout_seconds = max(
                    1.0,
                    min(float(self.timeout_resolver(job_name)), float(cycle_remaining)),
                )

                try:
                    with self.lock_manager.acquire(job_name) as acquired:
                        if not acquired:
                            jobs_skipped_lock += 1
                            _emit_worker_event("job_skipped_lock", job=job_name)
                            continue

                        attempt = 0
                        while attempt <= retries and not self.stop_event.is_set():
                            attempt += 1
                            started = self.monotonic_fn()
                            deadline_at = self.wall_time_fn() + timeout_seconds
                            _emit_worker_event("job_started", job=job_name, attempt=attempt)
                            try:
                                metrics = handler(deadline_at=deadline_at) or {"job": job_name}
                                elapsed = self.monotonic_fn() - started
                                timed_out = bool(metrics.get("timed_out")) or elapsed >= timeout_seconds
                                metrics["elapsed_ms"] = int(elapsed * 1000)
                                metrics["attempt"] = attempt
                                if timed_out:
                                    jobs_timed_out += 1
                                    _emit_worker_event(
                                        "job_timed_out",
                                        level="WARNING",
                                        job=job_name,
                                        elapsed_ms=metrics["elapsed_ms"],
                                        attempt=attempt,
                                    )
                                else:
                                    jobs_succeeded += 1
                                    _emit_worker_event(
                                        "job_succeeded",
                                        job=job_name,
                                        elapsed_ms=metrics["elapsed_ms"],
                                        attempt=attempt,
                                        metrics=_safe_metric_summary(metrics),
                                    )
                                break
                            except Exception as exc:
                                elapsed_ms = int((self.monotonic_fn() - started) * 1000)
                                will_retry = attempt <= retries and not self.stop_event.is_set()
                                _emit_worker_event(
                                    "job_failed",
                                    level="WARNING",
                                    job=job_name,
                                    elapsed_ms=elapsed_ms,
                                    attempt=attempt,
                                    error_class=exc.__class__.__name__,
                                    will_retry=will_retry,
                                )
                                if not will_retry:
                                    jobs_failed += 1
                                    break
                                self.stop_event.wait(self.retry_delay_seconds)
                except Exception as exc:
                    jobs_failed += 1
                    _emit_worker_event(
                        "job_failed",
                        level="WARNING",
                        job=job_name,
                        error_class=exc.__class__.__name__,
                        phase="lock",
                    )

            elapsed = self.monotonic_fn() - cycle_started
            result = {
                "status": "completed",
                "elapsed_ms": int(elapsed * 1000),
                "jobs_planned": len(specs),
                "jobs_succeeded": jobs_succeeded,
                "jobs_failed": jobs_failed,
                "jobs_timed_out": jobs_timed_out,
                "jobs_skipped_lock": jobs_skipped_lock,
                "budget_exhausted": budget_exhausted,
            }
            _emit_worker_event("cycle_completed", **result)
            return result
        finally:
            self._cycle_guard.release()

    def run(self, *, max_cycles: int | None = None, install_signals: bool = True) -> None:
        if install_signals:
            self.install_signal_handlers()
        specs = list(self.job_specs_provider())
        _emit_worker_event(
            "worker_started",
            version="v0.7.1c",
            environment=_safe_environment_label(),
            interval_s=self.interval_seconds,
            cycle_budget_s=self.cycle_budget_seconds,
            jobs=",".join(spec["name"] for spec in specs) or "none",
            role=self.role_label,
            embedded_scheduler="disabled_expected",
        )
        cycles = 0
        try:
            while not self.stop_event.is_set():
                cycle_started = self.monotonic_fn()
                self.run_cycle(specs)
                cycles += 1
                if max_cycles is not None and cycles >= max(0, int(max_cycles)):
                    break
                elapsed = self.monotonic_fn() - cycle_started
                self.stop_event.wait(max(1.0, float(self.interval_seconds) - elapsed))
        finally:
            _emit_worker_event("worker_stopped", cycles=cycles)


def run_worker_loop(
    *,
    job_specs_provider,
    format_metrics,
    retry_counter,
    timeout_resolver,
    interval_seconds: int,
    cycle_budget_seconds: int,
    role_label: str = "background",
    **runtime_options,
):
    runtime = WorkerRuntime(
        job_specs_provider=job_specs_provider,
        format_metrics=format_metrics,
        retry_counter=retry_counter,
        timeout_resolver=timeout_resolver,
        interval_seconds=interval_seconds,
        cycle_budget_seconds=cycle_budget_seconds,
        role_label=role_label,
        **runtime_options,
    )
    runtime.run()
