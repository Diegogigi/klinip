from __future__ import annotations

import signal
import threading
from contextlib import contextmanager

from app.jobs.locking import JobLockError
from app.jobs.runtime import WorkerRuntime


class FakeClock:
    def __init__(self):
        self.value = 100.0

    def monotonic(self):
        return self.value

    def wall_time(self):
        return 1_000.0 + self.value

    def advance(self, seconds):
        self.value += float(seconds)


class OpenLockManager:
    def __init__(self, acquired=True):
        self.acquired = acquired
        self.names = []

    @contextmanager
    def acquire(self, name):
        self.names.append(name)
        yield self.acquired


class FailingLockManager:
    @contextmanager
    def acquire(self, _name):
        raise JobLockError("database secret must not be logged")
        yield


class RecordingEvent:
    def __init__(self):
        self._set = False
        self.waits = []

    def is_set(self):
        return self._set

    def set(self):
        self._set = True

    def wait(self, seconds):
        self.waits.append(seconds)
        return self._set


def _runtime(
    specs,
    *,
    clock=None,
    lock_manager=None,
    retries=0,
    timeout=10,
    budget=50,
    stop_event=None,
    registrar=lambda *_args: None,
):
    clock = clock or FakeClock()
    return WorkerRuntime(
        job_specs_provider=lambda: specs,
        format_metrics=lambda metrics: str(metrics),
        retry_counter=lambda _name: retries,
        timeout_resolver=lambda _name: timeout,
        interval_seconds=60,
        cycle_budget_seconds=budget,
        lock_manager=lock_manager or OpenLockManager(),
        stop_event=stop_event or RecordingEvent(),
        monotonic_fn=clock.monotonic,
        wall_time_fn=clock.wall_time,
        signal_registrar=registrar,
        retry_delay_seconds=0,
    )


def _spec(name, handler, retry_safe=False):
    return {"name": name, "handler": handler, "retry_safe": retry_safe}


def test_cycle_runs_jobs_in_declared_order():
    order = []
    specs = [
        _spec("first", lambda **_kwargs: order.append("first") or {}),
        _spec("second", lambda **_kwargs: order.append("second") or {}),
    ]

    result = _runtime(specs).run_cycle()

    assert order == ["first", "second"]
    assert result["jobs_succeeded"] == 2


def test_failed_job_does_not_stop_following_job():
    order = []

    def fail(**_kwargs):
        order.append("failed")
        raise RuntimeError("provider failed")

    specs = [
        _spec("failed", fail),
        _spec("next", lambda **_kwargs: order.append("next") or {}),
    ]

    result = _runtime(specs).run_cycle()

    assert order == ["failed", "next"]
    assert result["jobs_failed"] == 1
    assert result["jobs_succeeded"] == 1


def test_job_elapsed_timeout_is_reported():
    clock = FakeClock()

    def slow(**_kwargs):
        clock.advance(6)
        return {}

    result = _runtime([_spec("slow", slow)], clock=clock, timeout=5).run_cycle()

    assert result["jobs_timed_out"] == 1
    assert result["jobs_succeeded"] == 0


def test_job_cooperative_timeout_is_reported():
    result = _runtime(
        [_spec("deadline", lambda **_kwargs: {"timed_out": True})]
    ).run_cycle()

    assert result["jobs_timed_out"] == 1


def test_retry_safe_job_respects_retry_limit():
    attempts = []

    def flaky(**_kwargs):
        attempts.append(1)
        if len(attempts) < 3:
            raise RuntimeError("temporary")
        return {}

    result = _runtime(
        [_spec("ai", flaky, retry_safe=True)], retries=2
    ).run_cycle()

    assert len(attempts) == 3
    assert result["jobs_succeeded"] == 1


def test_external_effect_job_is_not_retried():
    attempts = []

    def fail(**_kwargs):
        attempts.append(1)
        raise RuntimeError("partial delivery")

    result = _runtime([_spec("push", fail)], retries=3).run_cycle()

    assert len(attempts) == 1
    assert result["jobs_failed"] == 1


def test_cycle_budget_skips_remaining_jobs():
    clock = FakeClock()
    order = []

    def consume_budget(**_kwargs):
        order.append("first")
        clock.advance(6)
        return {}

    specs = [
        _spec("first", consume_budget),
        _spec("second", lambda **_kwargs: order.append("second") or {}),
    ]

    result = _runtime(specs, clock=clock, budget=5, timeout=10).run_cycle()

    assert order == ["first"]
    assert result["budget_exhausted"] is True


def test_overlapping_cycle_is_skipped():
    runtime = _runtime([])
    runtime._cycle_guard.acquire()
    try:
        result = runtime.run_cycle()
    finally:
        runtime._cycle_guard.release()

    assert result["status"] == "skipped_overlap"


def test_signal_handlers_register_sigterm_and_sigint():
    registered = {}
    runtime = _runtime([], registrar=lambda sig, callback: registered.setdefault(sig, callback))

    runtime.install_signal_handlers()

    assert set(registered) == {signal.SIGTERM, signal.SIGINT}


def test_sigterm_requests_shutdown():
    event = RecordingEvent()
    runtime = _runtime([], stop_event=event)

    runtime.request_stop(signal.SIGTERM)

    assert event.is_set()


def test_sigint_requests_shutdown():
    event = RecordingEvent()
    runtime = _runtime([], stop_event=event)

    runtime.request_stop(signal.SIGINT)

    assert event.is_set()


def test_locked_job_is_skipped_without_execution():
    called = []
    runtime = _runtime(
        [_spec("locked", lambda **_kwargs: called.append(True) or {})],
        lock_manager=OpenLockManager(acquired=False),
    )

    result = runtime.run_cycle()

    assert called == []
    assert result["jobs_skipped_lock"] == 1


def test_lock_failure_is_sanitized_and_next_job_runs(capsys):
    called = []
    runtime = _runtime(
        [_spec("locked", lambda **_kwargs: called.append(True) or {})],
        lock_manager=FailingLockManager(),
    )

    result = runtime.run_cycle()
    output = capsys.readouterr().out

    assert called == []
    assert result["jobs_failed"] == 1
    assert "database secret" not in output
    assert "JobLockError" in output


def test_exception_message_is_not_logged(capsys):
    def fail(**_kwargs):
        raise RuntimeError("token=super-secret")

    _runtime([_spec("safe", fail)]).run_cycle()
    output = capsys.readouterr().out

    assert "super-secret" not in output
    assert "RuntimeError" in output


def test_empty_worker_waits_between_cycles_without_busy_loop():
    event = RecordingEvent()
    runtime = _runtime([], stop_event=event)

    runtime.run(max_cycles=2, install_signals=False)

    assert len(event.waits) == 1
    assert event.waits[0] >= 1


def test_single_worker_executes_one_cycle_once():
    calls = []
    runtime = _runtime([_spec("once", lambda **_kwargs: calls.append(1) or {})])

    runtime.run(max_cycles=1, install_signals=False)

    assert calls == [1]


def test_fake_cycle_never_calls_real_external_providers():
    external_calls = {"email": 0, "push": 0, "openai": 0}
    runtime = _runtime([_spec("fake", lambda **_kwargs: {"sent": 0})])

    runtime.run(max_cycles=1, install_signals=False)

    assert external_calls == {"email": 0, "push": 0, "openai": 0}
