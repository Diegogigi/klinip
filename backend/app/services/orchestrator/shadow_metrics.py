"""Agregaciones sobre intent_shadow_logs para observabilidad del orquestador.

El objetivo es responder preguntas como:
- ¿Qué intents se están clasificando en producción y con qué distribución?
- ¿En cuántos casos el orquestador cambiaría la respuesta actual?
- ¿Qué % del tráfico cae al fallback LLM?
- ¿Cuál es la distribución de clinical_phase?
- ¿Cuál es la latencia del pipeline shadow?

Uso: se invoca desde el endpoint admin GET /admin/intent-shadow/metrics.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ... import models


DEFAULT_WINDOW_DAYS = 7
MAX_WINDOW_DAYS = 90


def _clamp_days(days: Optional[int]) -> int:
    if not days or days <= 0:
        return DEFAULT_WINDOW_DAYS
    return min(int(days), MAX_WINDOW_DAYS)


def _percent(part: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(100.0 * part / total, 2)


def compute_shadow_metrics(
    db: Session,
    *,
    days: Optional[int] = DEFAULT_WINDOW_DAYS,
    now: Optional[datetime] = None,
) -> dict:
    """Calcula métricas agregadas de intent_shadow_logs en una ventana temporal.

    Args:
        db: sesión SQLAlchemy.
        days: ventana hacia atrás en días (default 7, máx 90).
        now: punto de referencia (para tests determinísticos).
    """
    window_days = _clamp_days(days)
    reference = now or datetime.now()
    since = reference - timedelta(days=window_days)

    base_q = db.query(models.IntentShadowLog).filter(
        models.IntentShadowLog.created_at >= since
    )

    total = base_q.count()

    if total == 0:
        return {
            "window_days": window_days,
            "since": since.isoformat(),
            "total_logs": 0,
            "by_intent": [],
            "by_clinical_phase": [],
            "by_source": [],
            "llm_fallback_rate_pct": 0.0,
            "would_change_response_rate_pct": 0.0,
            "latency_ms": {"avg": 0.0, "p50": 0, "p95": 0},
        }

    by_intent = _aggregate_by_intent(db, since, total)
    by_phase = _aggregate_by_phase(db, since, total)
    by_source = _aggregate_by_source(db, since, total)
    llm_rate = _llm_fallback_rate(db, since, total)
    would_change_rate = _would_change_rate(db, since, total)
    latency = _latency_stats(db, since)

    return {
        "window_days": window_days,
        "since": since.isoformat(),
        "total_logs": total,
        "by_intent": by_intent,
        "by_clinical_phase": by_phase,
        "by_source": by_source,
        "llm_fallback_rate_pct": llm_rate,
        "would_change_response_rate_pct": would_change_rate,
        "latency_ms": latency,
    }


def _aggregate_by_intent(db: Session, since: datetime, total: int) -> list[dict]:
    rows = (
        db.query(
            models.IntentShadowLog.intent_predicted,
            func.count(models.IntentShadowLog.id).label("count"),
            func.avg(models.IntentShadowLog.confidence).label("avg_confidence"),
            func.avg(models.IntentShadowLog.latency_ms).label("avg_latency"),
        )
        .filter(models.IntentShadowLog.created_at >= since)
        .group_by(models.IntentShadowLog.intent_predicted)
        .all()
    )
    would_change_counts = dict(
        db.query(
            models.IntentShadowLog.intent_predicted,
            func.count(models.IntentShadowLog.id),
        )
        .filter(
            models.IntentShadowLog.created_at >= since,
            models.IntentShadowLog.would_change_response.is_(True),
        )
        .group_by(models.IntentShadowLog.intent_predicted)
        .all()
    )

    out: list[dict] = []
    for intent, count, avg_conf, avg_lat in rows:
        wc = int(would_change_counts.get(intent, 0) or 0)
        out.append(
            {
                "intent": intent or "unknown",
                "count": int(count or 0),
                "pct": _percent(int(count or 0), total),
                "avg_confidence": round(float(avg_conf or 0.0), 3),
                "avg_latency_ms": round(float(avg_lat or 0.0), 1),
                "would_change_count": wc,
                "would_change_pct": _percent(wc, int(count or 0)),
            }
        )
    out.sort(key=lambda r: r["count"], reverse=True)
    return out


def _aggregate_by_phase(db: Session, since: datetime, total: int) -> list[dict]:
    rows = (
        db.query(
            models.IntentShadowLog.clinical_phase,
            func.count(models.IntentShadowLog.id),
        )
        .filter(models.IntentShadowLog.created_at >= since)
        .group_by(models.IntentShadowLog.clinical_phase)
        .all()
    )
    out = [
        {
            "phase": (phase or "unknown"),
            "count": int(count or 0),
            "pct": _percent(int(count or 0), total),
        }
        for phase, count in rows
    ]
    out.sort(key=lambda r: r["count"], reverse=True)
    return out


def _aggregate_by_source(db: Session, since: datetime, total: int) -> list[dict]:
    rows = (
        db.query(
            models.IntentShadowLog.source,
            func.count(models.IntentShadowLog.id),
        )
        .filter(models.IntentShadowLog.created_at >= since)
        .group_by(models.IntentShadowLog.source)
        .all()
    )
    out = [
        {
            "source": (source or "unknown"),
            "count": int(count or 0),
            "pct": _percent(int(count or 0), total),
        }
        for source, count in rows
    ]
    out.sort(key=lambda r: r["count"], reverse=True)
    return out


def _llm_fallback_rate(db: Session, since: datetime, total: int) -> float:
    if total <= 0:
        return 0.0
    count = (
        db.query(func.count(models.IntentShadowLog.id))
        .filter(
            models.IntentShadowLog.created_at >= since,
            models.IntentShadowLog.used_llm_fallback.is_(True),
        )
        .scalar()
        or 0
    )
    return _percent(int(count), total)


def _would_change_rate(db: Session, since: datetime, total: int) -> float:
    if total <= 0:
        return 0.0
    count = (
        db.query(func.count(models.IntentShadowLog.id))
        .filter(
            models.IntentShadowLog.created_at >= since,
            models.IntentShadowLog.would_change_response.is_(True),
        )
        .scalar()
        or 0
    )
    return _percent(int(count), total)


def _latency_stats(db: Session, since: datetime) -> dict:
    """Percentiles aproximados calculados en Python — suficiente para shadow."""
    rows = (
        db.query(models.IntentShadowLog.latency_ms)
        .filter(models.IntentShadowLog.created_at >= since)
        .all()
    )
    values = sorted(int(r[0] or 0) for r in rows)
    if not values:
        return {"avg": 0.0, "p50": 0, "p95": 0}
    avg = round(sum(values) / len(values), 1)
    p50 = values[int(len(values) * 0.5)]
    p95 = values[min(len(values) - 1, int(len(values) * 0.95))]
    return {"avg": avg, "p50": int(p50), "p95": int(p95)}
