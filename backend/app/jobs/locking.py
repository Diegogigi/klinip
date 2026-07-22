from __future__ import annotations

import hashlib
import threading
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import text
from sqlalchemy.engine import Engine


_LOCK_NAMESPACE = "klinip-background-job-v1"
_LOCAL_LOCKS_GUARD = threading.Lock()
_LOCAL_LOCKS: dict[int, threading.Lock] = {}


class JobLockError(RuntimeError):
    """Raised when a job cannot be protected by the configured database."""


def advisory_lock_key(job_name: str) -> int:
    normalized = (job_name or "").strip()
    if not normalized:
        raise JobLockError("Job lock name is required")
    digest = hashlib.sha256(f"{_LOCK_NAMESPACE}:{normalized}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


def _local_lock(lock_key: int) -> threading.Lock:
    with _LOCAL_LOCKS_GUARD:
        return _LOCAL_LOCKS.setdefault(lock_key, threading.Lock())


class JobLockManager:
    def __init__(self, engine: Engine):
        self._engine = engine

    @property
    def backend_name(self) -> str:
        return str(self._engine.dialect.name or "").lower()

    @contextmanager
    def acquire(self, job_name: str) -> Iterator[bool]:
        lock_key = advisory_lock_key(job_name)
        if self.backend_name == "postgresql":
            with self._postgres_lock(lock_key) as acquired:
                yield acquired
            return
        if self.backend_name == "sqlite":
            lock = _local_lock(lock_key)
            acquired = lock.acquire(blocking=False)
            try:
                yield acquired
            finally:
                if acquired:
                    lock.release()
            return
        raise JobLockError("Unsupported database backend for worker locks")

    @contextmanager
    def _postgres_lock(self, lock_key: int) -> Iterator[bool]:
        try:
            connection = self._engine.connect()
        except Exception as exc:
            raise JobLockError("PostgreSQL advisory lock connection failed") from exc
        acquired = False
        try:
            try:
                acquired = bool(
                    connection.execute(
                        text("SELECT pg_try_advisory_lock(:lock_key)"),
                        {"lock_key": lock_key},
                    ).scalar()
                )
            except Exception as exc:
                raise JobLockError("PostgreSQL advisory lock acquisition failed") from exc

            yield acquired
        finally:
            if acquired:
                try:
                    released = bool(
                        connection.execute(
                            text("SELECT pg_advisory_unlock(:lock_key)"),
                            {"lock_key": lock_key},
                        ).scalar()
                    )
                    if not released:
                        connection.invalidate()
                except Exception:
                    connection.invalidate()
            connection.close()


def default_job_lock_manager() -> JobLockManager:
    from app.database import engine

    return JobLockManager(engine)
