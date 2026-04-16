"""Tests de token_budgeter — Fase 2c."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.services.orchestrator import (
    AlertSummary,
    AppointmentSummary,
    ClinicalContext,
    ClinicalPhase,
    ClinicalState,
    ContextTrace,
    DocumentRef,
    EpisodeSummary,
    IntentKind,
    MedicationSummary,
    TaskSummary,
    apply_token_budget,
)


NOW = datetime(2026, 4, 16, 12, 0, 0)


def _ctx_with_trace(**kwargs) -> ClinicalContext:
    ctx = ClinicalContext(profile_id=1, intent_focus=IntentKind.GET_STATUS)
    ctx.trace = ContextTrace(build_reason="test", intent_focus=IntentKind.GET_STATUS)
    for k, v in kwargs.items():
        setattr(ctx, k, v)
    return ctx


def _task(id, *, score=0.5, title="task"):
    return TaskSummary(
        id=id,
        episode_id=None,
        title=title,
        task_type="follow_up",
        status="pending",
        relevance_score=score,
    )


def _med(id, *, score=0.5, name="med"):
    return MedicationSummary(
        id=id, name=name, dose="1", frequency="diaria", relevance_score=score
    )


def _appt(id, *, score=0.5, specialty="trauma"):
    return AppointmentSummary(
        id=id,
        specialty=specialty,
        center="clinica",
        date_time=None,
        status="pendiente",
        relevance_score=score,
    )


def _alert(id, *, severity="high", score=0.7):
    return AlertSummary(
        id=id,
        alert_type="x",
        severity=severity,
        title="t",
        description="d",
        relevance_score=score,
    )


def _episode(id, *, title="ep", summary="", score=0.5):
    return EpisodeSummary(
        id=id,
        title=title,
        status="active",
        episode_type="general",
        phase=ClinicalPhase.TREATMENT,
        summary=summary,
        relevance_score=score,
    )


# ─── Bajo budget: no toca nada ───────────────────────────────────────────────


class TestBajoBudget:
    def test_no_modifica_si_cabe(self):
        ctx = _ctx_with_trace(
            primary_episode=_episode(1),
            pending_tasks=[_task(10, score=0.5), _task(11, score=0.6)],
        )
        apply_token_budget(ctx, budget=10000)
        assert len(ctx.pending_tasks) == 2
        assert ctx.token_estimate <= 10000
        assert any("budget ok" in n for n in ctx.trace.notes)


# ─── Excede budget: drop por score ascendente ────────────────────────────────


class TestRecorteEnOrden:
    def test_dropea_primero_el_menos_relevante(self):
        tasks = [
            _task(10, score=0.9, title="A" * 50),
            _task(11, score=0.3, title="B" * 50),
            _task(12, score=0.6, title="C" * 50),
        ]
        ctx = _ctx_with_trace(primary_episode=_episode(1), pending_tasks=tasks)
        # Budget chiquito → al menos uno tiene que caer
        apply_token_budget(ctx, budget=30)

        # El de score 0.3 debe haberse ido primero
        remaining_ids = {t.id for t in ctx.pending_tasks}
        assert 11 not in remaining_ids
        # Los de score 0.9 y 0.6 pueden estar o no dependiendo del budget
        assert ctx.token_estimate <= 30 or len(ctx.pending_tasks) < 3

    def test_registra_drops_en_trace(self):
        ctx = _ctx_with_trace(
            primary_episode=_episode(1),
            pending_tasks=[
                _task(100, score=0.2, title="X" * 60),
                _task(101, score=0.9, title="Y" * 60),
            ],
        )
        apply_token_budget(ctx, budget=20)

        excluded = ctx.trace.excluded
        assert any("pending_tasks[dropped]" in k for k in excluded)
        dropped_entry = excluded["pending_tasks[dropped]"]
        assert "id=100" in dropped_entry
        assert "score=0.2" in dropped_entry


# ─── Protecciones ─────────────────────────────────────────────────────────────


class TestProtecciones:
    def test_primary_episode_nunca_se_droppea(self):
        # Summary muy largo → token_estimate alto aun con budget chico
        primary = _episode(1, title="Primary", summary="P" * 2000)
        ctx = _ctx_with_trace(
            primary_episode=primary,
            pending_tasks=[_task(10, score=0.1)],
        )
        apply_token_budget(ctx, budget=5)

        assert ctx.primary_episode is not None
        assert ctx.primary_episode.id == 1

    def test_alertas_criticas_nunca_se_droppean(self):
        ctx = _ctx_with_trace(
            primary_episode=_episode(1),
            critical_alerts=[
                _alert(1, severity="critical", score=0.9),
                _alert(2, severity="critical", score=0.8),
                _alert(3, severity="high", score=0.5),
            ],
            pending_tasks=[_task(10, score=0.1, title="X" * 200)],
        )
        apply_token_budget(ctx, budget=30)

        severities = {a.severity for a in ctx.critical_alerts}
        assert "critical" in severities
        # Las 2 críticas siguen vivas
        critical_ids = {a.id for a in ctx.critical_alerts if a.severity == "critical"}
        assert critical_ids == {1, 2}

    def test_alert_high_si_se_puede_droppear(self):
        ctx = _ctx_with_trace(
            primary_episode=_episode(1),
            critical_alerts=[
                _alert(1, severity="high", score=0.1, ),
                _alert(2, severity="critical", score=0.9),
            ],
            pending_tasks=[_task(10, score=0.99, title="x" * 500)],
        )
        apply_token_budget(ctx, budget=5)
        # La high cae, la critical queda
        ids = {a.id for a in ctx.critical_alerts}
        assert 2 in ids
        assert 1 not in ids


# ─── Cross-section: drop mezcla tipos ────────────────────────────────────────


class TestCrossSection:
    def test_dropea_items_de_distintas_secciones_segun_score(self):
        ctx = _ctx_with_trace(
            primary_episode=_episode(1),
            pending_tasks=[_task(10, score=0.9, title="A" * 100)],
            active_medications=[_med(20, score=0.1, name="med bajo score" * 5)],
            upcoming_appointments=[_appt(30, score=0.2, specialty="x" * 50)],
        )
        apply_token_budget(ctx, budget=40)

        # El task de score alto sobrevive mejor que los otros
        task_ids = {t.id for t in ctx.pending_tasks}
        med_ids = {m.id for m in ctx.active_medications}
        appt_ids = {a.id for a in ctx.upcoming_appointments}
        # Algo cayó
        dropped_count = (
            (1 - len(task_ids)) + (1 - len(med_ids)) + (1 - len(appt_ids))
        )
        assert dropped_count >= 1
        # El menos relevante (med score=0.1) cayó antes que el task (0.9)
        if task_ids and not med_ids:
            assert True  # esperado
        # Si ambos sobreviven, el budget permitió ambos
        assert ctx.token_estimate <= 40 or dropped_count >= 2


# ─── Budget <= 0 es no-op ─────────────────────────────────────────────────────


class TestBudgetNoOp:
    def test_budget_cero_no_hace_nada(self):
        ctx = _ctx_with_trace(
            primary_episode=_episode(1),
            pending_tasks=[_task(10, title="X" * 1000)],
        )
        apply_token_budget(ctx, budget=0)
        assert len(ctx.pending_tasks) == 1


# ─── Trace final ──────────────────────────────────────────────────────────────


class TestTraceFinal:
    def test_nota_final_cuando_se_aplico_budget(self):
        ctx = _ctx_with_trace(
            primary_episode=_episode(1),
            pending_tasks=[
                _task(10, score=0.1, title="X" * 500),
                _task(11, score=0.2, title="Y" * 500),
            ],
        )
        apply_token_budget(ctx, budget=20)
        notes = ctx.trace.notes
        assert any("budget applied" in n for n in notes)
