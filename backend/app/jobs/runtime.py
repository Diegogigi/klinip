import signal
import threading
import time


def start_embedded_scheduler(
    *,
    run_once,
    format_metrics,
    interval_seconds: int,
):
    def _scheduler_loop():
        while True:
            cycle_started = time.time()
            try:
                summaries = run_once()
                print(
                    "INFO scheduler cycle: "
                    + " | ".join(format_metrics(item) for item in summaries if item)
                )
            except Exception as exc:
                print(f"WARNING scheduler: {exc}")
            elapsed = time.time() - cycle_started
            sleep_seconds = max(1, int(interval_seconds or 1) - int(elapsed))
            time.sleep(sleep_seconds)

    thread = threading.Thread(
        target=_scheduler_loop,
        daemon=True,
        name="klinip-embedded-scheduler",
    )
    thread.start()
    return thread


def run_worker_loop(
    *,
    job_specs_provider,
    format_metrics,
    retry_counter,
    timeout_resolver,
    interval_seconds: int,
    cycle_budget_seconds: int,
    role_label: str = "background",
):
    keep_running = True

    def _handle_signal(signum, _frame):
        nonlocal keep_running
        print(f"INFO worker: stopping on signal {signum}")
        keep_running = False

    print(
        f"INFO worker: starting background loop interval={interval_seconds}s "
        f"cycle_budget_s={cycle_budget_seconds} role={role_label}"
    )
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    while keep_running:
        cycle_started = time.time()
        job_specs = job_specs_provider()
        jobs_ran = 0
        skipped_remaining_jobs = False
        for spec in job_specs:
            if not keep_running:
                break
            cycle_elapsed = time.time() - cycle_started
            cycle_remaining = cycle_budget_seconds - cycle_elapsed
            if cycle_remaining <= 0:
                skipped_remaining_jobs = True
                print(
                    f"WARNING worker: cycle budget reached elapsed_ms={int(cycle_elapsed * 1000)} "
                    "skipped_remaining_jobs=yes"
                )
                break
            job_name = spec["name"]
            handler = spec["handler"]
            retries = retry_counter(job_name)
            timeout_seconds = max(
                1,
                min(
                    timeout_resolver(job_name),
                    max(1, int(cycle_remaining)),
                ),
            )
            attempt = 0
            while attempt <= retries and keep_running:
                attempt += 1
                started = time.time()
                try:
                    metrics = handler(deadline_at=(started + timeout_seconds))
                    elapsed_ms = int((time.time() - started) * 1000)
                    metrics["elapsed_ms"] = elapsed_ms
                    metrics["attempt"] = attempt
                    print(f"INFO worker job {job_name}: {format_metrics(metrics)}")
                    jobs_ran += 1
                    break
                except Exception as exc:
                    elapsed_ms = int((time.time() - started) * 1000)
                    if attempt > retries:
                        print(
                            f"WARNING worker job {job_name}: failed elapsed_ms={elapsed_ms} "
                            f"attempts={attempt} error={exc}"
                        )
                        break
                    print(
                        f"WARNING worker job {job_name}: retrying attempt={attempt} "
                        f"elapsed_ms={elapsed_ms} error={exc}"
                    )
                    time.sleep(1)

        elapsed = time.time() - cycle_started
        sleep_seconds = max(1, int(interval_seconds) - int(elapsed))
        print(
            f"INFO worker: cycle_complete elapsed_ms={int(elapsed * 1000)} jobs_ran={jobs_ran} "
            f"jobs_planned={len(job_specs)} skipped_remaining_jobs={'yes' if skipped_remaining_jobs else 'no'} "
            f"next_in_s={sleep_seconds}"
        )
        for _ in range(sleep_seconds):
            if not keep_running:
                break
            time.sleep(1)

    print("INFO worker: stopped")
