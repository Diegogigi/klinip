from __future__ import annotations

from sqlalchemy import create_engine

from app.jobs.locking import JobLockError, JobLockManager, advisory_lock_key


class ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar(self):
        return self.value


class FakeConnection:
    def __init__(self, *, acquired=True, fail_acquire=False, fail_release=False):
        self.acquired = acquired
        self.fail_acquire = fail_acquire
        self.fail_release = fail_release
        self.closed = False
        self.invalidated = False
        self.queries = []

    def execute(self, statement, params):
        query = str(statement)
        self.queries.append((query, params))
        if "pg_try_advisory_lock" in query:
            if self.fail_acquire:
                raise RuntimeError("credential must remain private")
            return ScalarResult(self.acquired)
        if self.fail_release:
            raise RuntimeError("release failed")
        return ScalarResult(True)

    def invalidate(self):
        self.invalidated = True

    def close(self):
        self.closed = True


class FakeEngine:
    class Dialect:
        name = "postgresql"

    dialect = Dialect()

    def __init__(self, connection=None, fail_connect=False):
        self.connection = connection or FakeConnection()
        self.fail_connect = fail_connect

    def connect(self):
        if self.fail_connect:
            raise RuntimeError("database URL must remain private")
        return self.connection


def test_advisory_lock_key_is_deterministic_and_signed_int64():
    key = advisory_lock_key("send_appointment_reminders")

    assert key == advisory_lock_key("send_appointment_reminders")
    assert -(2**63) <= key < 2**63


def test_advisory_lock_keys_differ_by_job():
    assert advisory_lock_key("job-a") != advisory_lock_key("job-b")


def test_empty_job_name_is_rejected():
    try:
        advisory_lock_key("  ")
    except JobLockError as exc:
        assert "required" in str(exc).lower()
    else:
        raise AssertionError("empty lock name should fail")


def test_sqlite_fallback_acquires_and_releases_lock():
    engine = create_engine("sqlite:///:memory:")
    manager = JobLockManager(engine)

    with manager.acquire("job") as first:
        assert first is True
    with manager.acquire("job") as second:
        assert second is True

    engine.dispose()


def test_second_sqlite_worker_skips_same_job_while_locked():
    engine = create_engine("sqlite:///:memory:")
    first = JobLockManager(engine)
    second = JobLockManager(engine)

    with first.acquire("job") as first_acquired:
        with second.acquire("job") as second_acquired:
            assert first_acquired is True
            assert second_acquired is False

    engine.dispose()


def test_sqlite_lock_releases_after_job_exception():
    engine = create_engine("sqlite:///:memory:")
    manager = JobLockManager(engine)

    try:
        with manager.acquire("job") as acquired:
            assert acquired is True
            raise RuntimeError("job failed")
    except RuntimeError:
        pass

    with manager.acquire("job") as acquired_again:
        assert acquired_again is True
    engine.dispose()


def test_different_sqlite_jobs_can_hold_locks_together():
    engine = create_engine("sqlite:///:memory:")
    manager = JobLockManager(engine)

    with manager.acquire("job-a") as first:
        with manager.acquire("job-b") as second:
            assert first is True
            assert second is True

    engine.dispose()


def test_postgres_lock_uses_try_lock_and_explicit_unlock():
    connection = FakeConnection()
    manager = JobLockManager(FakeEngine(connection))

    with manager.acquire("job") as acquired:
        assert acquired is True

    assert "pg_try_advisory_lock" in connection.queries[0][0]
    assert "pg_advisory_unlock" in connection.queries[1][0]
    assert connection.closed is True


def test_postgres_lock_connection_closes_when_not_acquired():
    connection = FakeConnection(acquired=False)
    manager = JobLockManager(FakeEngine(connection))

    with manager.acquire("job") as acquired:
        assert acquired is False

    assert len(connection.queries) == 1
    assert connection.closed is True


def test_postgres_lock_releases_when_job_raises():
    connection = FakeConnection()
    manager = JobLockManager(FakeEngine(connection))

    try:
        with manager.acquire("job"):
            raise ValueError("job error")
    except ValueError:
        pass

    assert "pg_advisory_unlock" in connection.queries[-1][0]
    assert connection.closed is True


def test_postgres_acquire_failure_is_wrapped_and_connection_closes():
    connection = FakeConnection(fail_acquire=True)
    manager = JobLockManager(FakeEngine(connection))

    try:
        with manager.acquire("job"):
            pass
    except JobLockError as exc:
        assert "credential" not in str(exc)
    else:
        raise AssertionError("acquire failure should be wrapped")

    assert connection.closed is True


def test_postgres_release_failure_invalidates_connection():
    connection = FakeConnection(fail_release=True)
    manager = JobLockManager(FakeEngine(connection))

    with manager.acquire("job") as acquired:
        assert acquired is True

    assert connection.invalidated is True
    assert connection.closed is True


def test_postgres_connection_failure_is_sanitized():
    manager = JobLockManager(FakeEngine(fail_connect=True))

    try:
        with manager.acquire("job"):
            pass
    except JobLockError as exc:
        assert "database URL" not in str(exc)
    else:
        raise AssertionError("connection failure should be wrapped")


def test_unsupported_database_backend_is_rejected():
    engine = create_engine("sqlite:///:memory:")
    engine.dialect.name = "unsupported"
    manager = JobLockManager(engine)

    try:
        with manager.acquire("job"):
            pass
    except JobLockError:
        pass
    else:
        raise AssertionError("unsupported backend should fail")
    finally:
        engine.dispose()
