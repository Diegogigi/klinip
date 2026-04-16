"""Tests de relevance_scorer — Fase 2b."""

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
    Intent,
    IntentKind,
    IntentSource,
    MedicationSummary,
    TaskSummary,
    UrgencyLevel,
    score_context,
)


NOW = datetime(2026, 4, 16, 12, 0, 0)


def _ctx(**kwargs) -> ClinicalContext:
    ctx = ClinicalContext(profile_id=1, intent_focus=IntentKind.GET_STATUS)
    ctx.trace = ContextTrace(build_reason="test", intent_focus=IntentKind.GET_STATUS)
    for k, v in kwargs.items():
        setattr(ctx, k, v)
    return ctx


def _state(urgency=UrgencyLevel.LOW):
    return ClinicalState(phase=ClinicalPhase.TREATMENT, urgency=urgency)


def _intent(kind=IntentKind.GET_STATUS):
    return Intent(kind=kind, confidence=0.8, source=IntentSource.HEURISTIC)


def _task(id, *, episode_id=None, is_overdue=False):
    return TaskSummary(
        id=id,
        episode_id=episode_id,
        title="t",
        task_type="follow_up",
        status="pending",
        is_overdue=is_overdue,
    )


def _appt(id, *, episode_id=None, hours_until=None):
    return AppointmentSummary(
        id=id,
        specialty="trauma",
        center="clinica",
        date_time=None,
        status="pendiente",
        episode_id=episode_id,
        hours_until=hours_until,
    )


def _med(id, *, episode_id=None):
    return MedicationSummary(
        id=id, name="med", dose="1", frequency="diaria", episode_id=episode_id
    )


def _alert(id, *, severity="high"):
    return AlertSummary(
        id=id,
        alert_type="x",
        severity=severity,
        title="t",
        description="d",
    )


def _episode(id, *, days_ago=1, pending_count=0):
    return EpisodeSummary(
        id=id,
        title="ep",
        status="active",
        episode_type="general",
        phase=ClinicalPhase.TREATMENT,
        last_activity_at=NOW - timedelta(days=days_ago),
        pending_task_count=pending_count,
    )


def _doc(id, *, episode_id=None, days_ago=1):
    return DocumentRef(
        id=id,
        doc_type="receta",
        filename="f.pdf",
        date=NOW - timedelta(days=days_ago),
        episode_id=episode_id,
    )


# ─── Primary episode siempre 1.0 ─────────────────────────────────────────────


class TestPrimaryEpisodeScore:
    def test_primary_episode_score_es_1(self):
        ctx = _ctx(primary_episode=_episode(5))
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.primary_episode.relevance_score == 1.0


# ─── Task scoring ─────────────────────────────────────────────────────────────


class TestTaskScoring:
    def test_base_score_solo(self):
        ctx = _ctx(
            primary_episode=_episode(1),
            pending_tasks=[_task(10, episode_id=99)],
        )
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.pending_tasks[0].relevance_score == pytest.approx(0.5)

    def test_overdue_suma_0_3(self):
        ctx = _ctx(
            primary_episode=_episode(1),
            pending_tasks=[_task(10, is_overdue=True, episode_id=99)],
        )
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.pending_tasks[0].relevance_score == pytest.approx(0.8)

    def test_primary_episode_task_suma_0_2(self):
        ctx = _ctx(
            primary_episode=_episode(7),
            pending_tasks=[_task(10, episode_id=7)],
        )
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.pending_tasks[0].relevance_score == pytest.approx(0.7)

    def test_urgencia_alta_suma_0_15(self):
        ctx = _ctx(
            primary_episode=_episode(1),
            pending_tasks=[_task(10, episode_id=99)],
        )
        score_context(
            ctx, state=_state(urgency=UrgencyLevel.HIGH), intent=_intent(), now=NOW
        )
        assert ctx.pending_tasks[0].relevance_score == pytest.approx(0.65)

    def test_todos_los_bonos_se_capean_en_1(self):
        ctx = _ctx(
            primary_episode=_episode(7),
            pending_tasks=[_task(10, episode_id=7, is_overdue=True)],
        )
        score_context(
            ctx, state=_state(urgency=UrgencyLevel.CRITICAL), intent=_intent(), now=NOW
        )
        # 0.5 + 0.3 + 0.2 + 0.15 = 1.15 → clampeado a 1.0
        assert ctx.pending_tasks[0].relevance_score == 1.0


# ─── Appointment scoring ─────────────────────────────────────────────────────


class TestAppointmentScoring:
    def test_cita_muy_proxima_suma_0_3(self):
        ctx = _ctx(
            primary_episode=_episode(1),
            upcoming_appointments=[_appt(10, hours_until=5.0, episode_id=99)],
        )
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.upcoming_appointments[0].relevance_score == pytest.approx(0.8)

    def test_cita_en_ventana_media_suma_0_15(self):
        ctx = _ctx(
            primary_episode=_episode(1),
            upcoming_appointments=[_appt(10, hours_until=48.0, episode_id=99)],
        )
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.upcoming_appointments[0].relevance_score == pytest.approx(0.65)

    def test_cita_lejana_sin_bonus(self):
        ctx = _ctx(
            primary_episode=_episode(1),
            upcoming_appointments=[_appt(10, hours_until=200.0, episode_id=99)],
        )
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.upcoming_appointments[0].relevance_score == pytest.approx(0.5)

    def test_cita_del_primary_suma_0_1(self):
        ctx = _ctx(
            primary_episode=_episode(7),
            upcoming_appointments=[_appt(10, hours_until=100.0, episode_id=7)],
        )
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.upcoming_appointments[0].relevance_score == pytest.approx(0.6)


# ─── Alert scoring ────────────────────────────────────────────────────────────


class TestAlertScoring:
    def test_alert_high_base_0_7(self):
        ctx = _ctx(critical_alerts=[_alert(1, severity="high")])
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.critical_alerts[0].relevance_score == pytest.approx(0.7)

    def test_alert_critical_suma_0_2(self):
        ctx = _ctx(critical_alerts=[_alert(1, severity="critical")])
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.critical_alerts[0].relevance_score == pytest.approx(0.9)


# ─── Episode secundario scoring ──────────────────────────────────────────────


class TestSecondaryEpisodeScoring:
    def test_reciente_con_pendings_sube(self):
        ctx = _ctx(secondary_episodes=[_episode(2, days_ago=2, pending_count=3)])
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.secondary_episodes[0].relevance_score == pytest.approx(0.8)

    def test_viejo_sin_pendings_base(self):
        ctx = _ctx(secondary_episodes=[_episode(2, days_ago=30, pending_count=0)])
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        assert ctx.secondary_episodes[0].relevance_score == pytest.approx(0.5)


# ─── Medication & Document ───────────────────────────────────────────────────


class TestMedicationAndDoc:
    def test_med_del_primary_con_urgencia(self):
        ctx = _ctx(
            primary_episode=_episode(7),
            active_medications=[_med(1, episode_id=7)],
        )
        score_context(
            ctx, state=_state(urgency=UrgencyLevel.HIGH), intent=_intent(), now=NOW
        )
        # 0.5 + 0.25 + 0.15 = 0.9
        assert ctx.active_medications[0].relevance_score == pytest.approx(0.9)

    def test_doc_reciente_del_primary(self):
        ctx = _ctx(
            primary_episode=_episode(7),
            recent_documents=[_doc(1, episode_id=7, days_ago=2)],
        )
        score_context(ctx, state=_state(), intent=_intent(), now=NOW)
        # 0.4 + 0.2 + 0.1 = 0.7
        assert ctx.recent_documents[0].relevance_score == pytest.approx(0.7)


# ─── Trace ────────────────────────────────────────────────────────────────────


class TestTrace:
    def test_agrega_nota_con_primary_y_urgencia(self):
        ctx = _ctx(primary_episode=_episode(5))
        score_context(
            ctx, state=_state(urgency=UrgencyLevel.CRITICAL), intent=_intent(), now=NOW
        )
        notes = ctx.trace.notes
        assert any("scored items" in n and "primary=5" in n for n in notes)
