from __future__ import annotations

from types import SimpleNamespace

from sqlalchemy.exc import StatementError

from app import main


def _json_statement_error():
    return StatementError(
        "json bind failed",
        "UPDATE protected_table SET payload=:payload",
        {"payload": "sensitive-value"},
        TypeError("Object of type datetime is not JSON serializable"),
    )


class FakeSession:
    def __init__(self, *, commit_error=None):
        self.commit_error = commit_error
        self.commit_calls = 0
        self.rollback_calls = 0
        self.closed = False
        self.added = []

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commit_calls += 1
        if self.commit_error is not None:
            error = self.commit_error
            self.commit_error = None
            raise error

    def rollback(self):
        self.rollback_calls += 1

    def close(self):
        self.closed = True


def test_profile_ai_job_rolls_back_bind_error_and_continues(monkeypatch, capsys):
    session = FakeSession()
    bad_profile = SimpleNamespace(id=1)
    good_profile = SimpleNamespace(id=2)
    refreshed = []

    monkeypatch.setattr(main, "SessionLocal", lambda: session)
    monkeypatch.setattr(
        main,
        "_load_dirty_profiles_for_refresh",
        lambda _db, _limit: [bad_profile, good_profile],
    )

    def refresh(_db, profile):
        if profile is bad_profile:
            raise _json_statement_error()
        refreshed.append(profile.id)

    monkeypatch.setattr(main, "_refresh_profile_ai_analytics", refresh)

    metrics = main._job_refresh_profile_ai(batch_limit=2)
    output = capsys.readouterr().out

    assert metrics["errors"] == 1
    assert metrics["rollback_count"] == 1
    assert metrics["refreshed"] == 1
    assert refreshed == [2]
    assert session.rollback_calls == 1
    assert session.commit_calls == 1
    assert session.closed is True
    assert "phase=bind reason=json_serialization" in output
    assert "sensitive-value" not in output


def test_profile_ai_job_rolls_back_commit_error_and_continues(monkeypatch):
    session = FakeSession(commit_error=RuntimeError("commit unavailable"))
    profiles = [SimpleNamespace(id=1), SimpleNamespace(id=2)]
    refreshed = []

    monkeypatch.setattr(main, "SessionLocal", lambda: session)
    monkeypatch.setattr(
        main,
        "_load_dirty_profiles_for_refresh",
        lambda _db, _limit: profiles,
    )
    monkeypatch.setattr(
        main,
        "_refresh_profile_ai_analytics",
        lambda _db, profile: refreshed.append(profile.id),
    )

    metrics = main._job_refresh_profile_ai(batch_limit=2)

    assert metrics["errors"] == 1
    assert metrics["rollback_count"] == 1
    assert metrics["refreshed"] == 1
    assert refreshed == [1, 2]
    assert session.commit_calls == 2
    assert session.rollback_calls == 1


def test_profile_ai_job_uses_clean_session_on_next_cycle(monkeypatch):
    sessions = [FakeSession(), FakeSession()]
    profiles_by_session = {
        id(sessions[0]): [SimpleNamespace(id=1)],
        id(sessions[1]): [SimpleNamespace(id=2)],
    }
    created_sessions = []

    def session_factory():
        session = sessions[len(created_sessions)]
        created_sessions.append(session)
        return session

    monkeypatch.setattr(main, "SessionLocal", session_factory)
    monkeypatch.setattr(
        main,
        "_load_dirty_profiles_for_refresh",
        lambda db, _limit: profiles_by_session[id(db)],
    )

    def refresh(_db, profile):
        if profile.id == 1:
            raise _json_statement_error()

    monkeypatch.setattr(main, "_refresh_profile_ai_analytics", refresh)

    first = main._job_refresh_profile_ai(batch_limit=1)
    second = main._job_refresh_profile_ai(batch_limit=1)

    assert first["errors"] == 1
    assert second["errors"] == 0
    assert second["refreshed"] == 1
    assert sessions[0].closed is True
    assert sessions[1].closed is True


def test_profile_ai_job_rolls_back_query_error_and_recovers_next_cycle(
    monkeypatch,
    capsys,
):
    sessions = [FakeSession(), FakeSession()]
    calls = 0

    def session_factory():
        nonlocal calls
        session = sessions[calls]
        calls += 1
        return session

    def load_profiles(db, _limit):
        if db is sessions[0]:
            raise StatementError(
                "query bind failed",
                "SELECT protected_table.id FROM protected_table",
                {},
                ValueError("invalid query value"),
            )
        return []

    monkeypatch.setattr(main, "SessionLocal", session_factory)
    monkeypatch.setattr(main, "_load_dirty_profiles_for_refresh", load_profiles)

    first = main._job_refresh_profile_ai(batch_limit=1)
    second = main._job_refresh_profile_ai(batch_limit=1)
    output = capsys.readouterr().out

    assert first["errors"] == 1
    assert first["rollback_count"] == 1
    assert second["errors"] == 0
    assert sessions[0].rollback_calls == 1
    assert sessions[0].closed is True
    assert sessions[1].closed is True
    assert "phase=query reason=database_statement" in output


def test_family_ai_job_remains_enabled_and_completes(monkeypatch):
    session = FakeSession()
    user = SimpleNamespace(
        id=10,
        family_ai_needs_refresh=True,
        family_ai_refresh_requested_at=object(),
        family_ai_last_refreshed_at=None,
    )
    refreshed_windows = []

    monkeypatch.setattr(main, "SessionLocal", lambda: session)
    monkeypatch.setattr(
        main,
        "_load_dirty_family_users_for_refresh",
        lambda _db, _limit: [user],
    )
    monkeypatch.setattr(main, "_user_has_pending_profile_refresh", lambda *_args: False)
    monkeypatch.setattr(main, "_family_ai_should_refresh_now", lambda *_args: True)
    monkeypatch.setattr(main, "_family_ai_eligible", lambda *_args: True)
    monkeypatch.setattr(
        main,
        "_refresh_family_ai_summary",
        lambda _db, _user, days: refreshed_windows.append(days),
    )

    metrics = main._job_refresh_family_ai(batch_limit=1)

    assert refreshed_windows == [7, 30]
    assert metrics["refreshed"] == 1
    assert metrics["errors"] == 0
    assert user.family_ai_needs_refresh is False
    assert session.closed is True
