"""Tests de shadow_metrics — agregaciones sobre intent_shadow_logs."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app import models
from app.services.orchestrator import compute_shadow_metrics
from app.services.orchestrator.shadow_metrics import (
    DEFAULT_WINDOW_DAYS,
    MAX_WINDOW_DAYS,
    _clamp_days,
)


NOW = datetime(2026, 4, 16, 12, 0, 0)


def _make_user(db, email="metrics@test.cl"):
    user = models.User(email=email, password_hash="x", name="Metrics")
    db.add(user)
    db.flush()
    return user


def _make_log(
    db,
    user,
    *,
    created_days_ago: float = 0.5,
    intent: str = "get_status",
    intent_source: str = "heuristic",
    confidence: float = 0.8,
    used_llm_fallback: bool = False,
    clinical_phase: str = "treatment",
    clinical_urgency: str = "low",
    would_change_response: bool = False,
    latency_ms: int = 10,
    source: str = "chat",
    profile_id: int | None = None,
):
    log = models.IntentShadowLog(
        user_id=user.id,
        profile_id=profile_id,
        conversation_id="c",
        source=source,
        message_preview="x",
        intent_predicted=intent,
        intent_source=intent_source,
        confidence=confidence,
        used_llm_fallback=used_llm_fallback,
        clinical_phase=clinical_phase,
        clinical_urgency=clinical_urgency,
        primary_episode_id=None,
        would_change_response=would_change_response,
        latency_ms=latency_ms,
        metadata_json={},
        created_at=NOW - timedelta(days=created_days_ago),
    )
    db.add(log)
    db.flush()
    return log


class TestClampDays:
    def test_default_cuando_es_none(self):
        assert _clamp_days(None) == DEFAULT_WINDOW_DAYS

    def test_default_cuando_es_cero(self):
        assert _clamp_days(0) == DEFAULT_WINDOW_DAYS

    def test_default_cuando_es_negativo(self):
        assert _clamp_days(-5) == DEFAULT_WINDOW_DAYS

    def test_respeta_valor_valido(self):
        assert _clamp_days(14) == 14

    def test_capea_en_maximo(self):
        assert _clamp_days(500) == MAX_WINDOW_DAYS


class TestSinLogs:
    def test_retorna_estructura_vacia(self, db_session):
        result = compute_shadow_metrics(db_session, days=7, now=NOW)
        assert result["total_logs"] == 0
        assert result["by_intent"] == []
        assert result["by_clinical_phase"] == []
        assert result["by_source"] == []
        assert result["llm_fallback_rate_pct"] == 0.0
        assert result["would_change_response_rate_pct"] == 0.0
        assert result["latency_ms"] == {"avg": 0.0, "p50": 0, "p95": 0}


class TestAgregacionPorIntent:
    def test_distribucion_correcta(self, db_session):
        user = _make_user(db_session)
        for _ in range(6):
            _make_log(db_session, user, intent="get_status", confidence=0.8, latency_ms=10)
        for _ in range(3):
            _make_log(db_session, user, intent="get_pending", confidence=0.6, latency_ms=20)
        _make_log(db_session, user, intent="unknown", confidence=0.0, latency_ms=5)
        db_session.commit()

        result = compute_shadow_metrics(db_session, days=7, now=NOW)
        assert result["total_logs"] == 10
        by_intent = {r["intent"]: r for r in result["by_intent"]}
        assert by_intent["get_status"]["count"] == 6
        assert by_intent["get_status"]["pct"] == 60.0
        assert by_intent["get_status"]["avg_confidence"] == 0.8
        assert by_intent["get_pending"]["count"] == 3
        assert by_intent["get_pending"]["pct"] == 30.0
        assert by_intent["unknown"]["count"] == 1
        # Ordenado descendente por count
        assert result["by_intent"][0]["intent"] == "get_status"

    def test_would_change_pct_por_intent(self, db_session):
        user = _make_user(db_session)
        # 4 get_status, 3 con would_change=True → 75%
        for i in range(4):
            _make_log(
                db_session,
                user,
                intent="get_status",
                would_change_response=(i < 3),
            )
        db_session.commit()

        result = compute_shadow_metrics(db_session, days=7, now=NOW)
        by_intent = {r["intent"]: r for r in result["by_intent"]}
        assert by_intent["get_status"]["would_change_count"] == 3
        assert by_intent["get_status"]["would_change_pct"] == 75.0


class TestVentanaTemporal:
    def test_excluye_logs_fuera_de_ventana(self, db_session):
        user = _make_user(db_session)
        _make_log(db_session, user, created_days_ago=0.5)   # dentro
        _make_log(db_session, user, created_days_ago=6.0)   # dentro (7 días)
        _make_log(db_session, user, created_days_ago=10.0)  # fuera
        _make_log(db_session, user, created_days_ago=60.0)  # fuera
        db_session.commit()

        result = compute_shadow_metrics(db_session, days=7, now=NOW)
        assert result["total_logs"] == 2

    def test_ventana_mayor_incluye_todo(self, db_session):
        user = _make_user(db_session)
        _make_log(db_session, user, created_days_ago=1)
        _make_log(db_session, user, created_days_ago=20)
        _make_log(db_session, user, created_days_ago=45)
        db_session.commit()

        result = compute_shadow_metrics(db_session, days=60, now=NOW)
        assert result["total_logs"] == 3
        assert result["window_days"] == 60


class TestLlmFallbackRate:
    def test_rate_correcto(self, db_session):
        user = _make_user(db_session)
        for _ in range(8):
            _make_log(db_session, user, used_llm_fallback=False)
        for _ in range(2):
            _make_log(db_session, user, used_llm_fallback=True, intent_source="llm")
        db_session.commit()

        result = compute_shadow_metrics(db_session, days=7, now=NOW)
        assert result["llm_fallback_rate_pct"] == 20.0


class TestWouldChangeRate:
    def test_rate_global(self, db_session):
        user = _make_user(db_session)
        for _ in range(7):
            _make_log(db_session, user, would_change_response=True)
        for _ in range(3):
            _make_log(db_session, user, would_change_response=False)
        db_session.commit()

        result = compute_shadow_metrics(db_session, days=7, now=NOW)
        assert result["would_change_response_rate_pct"] == 70.0


class TestPorPhaseYSource:
    def test_phase_distribucion(self, db_session):
        user = _make_user(db_session)
        for _ in range(5):
            _make_log(db_session, user, clinical_phase="treatment")
        for _ in range(3):
            _make_log(db_session, user, clinical_phase="no_context")
        for _ in range(2):
            _make_log(db_session, user, clinical_phase="diagnosis")
        db_session.commit()

        result = compute_shadow_metrics(db_session, days=7, now=NOW)
        by_phase = {r["phase"]: r for r in result["by_clinical_phase"]}
        assert by_phase["treatment"]["count"] == 5
        assert by_phase["treatment"]["pct"] == 50.0
        assert by_phase["no_context"]["count"] == 3

    def test_source_distribucion(self, db_session):
        user = _make_user(db_session)
        for _ in range(7):
            _make_log(db_session, user, source="chat")
        for _ in range(3):
            _make_log(db_session, user, source="voice")
        db_session.commit()

        result = compute_shadow_metrics(db_session, days=7, now=NOW)
        by_source = {r["source"]: r for r in result["by_source"]}
        assert by_source["chat"]["count"] == 7
        assert by_source["voice"]["count"] == 3


class TestLatencia:
    def test_avg_y_percentiles(self, db_session):
        user = _make_user(db_session)
        for ms in [5, 10, 15, 20, 25, 30, 35, 40, 45, 200]:
            _make_log(db_session, user, latency_ms=ms)
        db_session.commit()

        result = compute_shadow_metrics(db_session, days=7, now=NOW)
        lat = result["latency_ms"]
        assert lat["avg"] == round(sum([5, 10, 15, 20, 25, 30, 35, 40, 45, 200]) / 10, 1)
        assert lat["p50"] == 30  # valor en posición 5 de 10 (0-indexed)
        # p95 con 10 valores cae en posición min(9, int(9.5)) = 9 → último
        assert lat["p95"] == 200
