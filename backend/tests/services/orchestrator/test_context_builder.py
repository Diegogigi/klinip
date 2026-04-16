"""Tests del Context Builder — Fase 2a.

Validan que (intent, state) produce el contexto esperado en cada caso:
- secciones incluidas / excluidas correctas por intent
- trace refleja las decisiones de build
- scoping a episodio primario cuando corresponde
- token_estimate crece con más datos
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

import pytest

from app import models
from app.services.orchestrator import (
    ClinicalPhase,
    ClinicalState,
    Intent,
    IntentKind,
    IntentSource,
    UrgencyLevel,
    build_clinical_context,
)


NOW = datetime(2026, 4, 16, 12, 0, 0)


# ─── Factories ────────────────────────────────────────────────────────────────


def _make_user(db, email="ctx@test.cl"):
    user = models.User(email=email, password_hash="x", name="Ctx")
    db.add(user)
    db.flush()
    return user


def _make_profile(db, user):
    profile = models.HealthProfile(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        full_name="Ctx Profile",
    )
    db.add(profile)
    db.flush()
    return profile


def _make_episode(
    db,
    profile,
    *,
    title="Episodio",
    status=models.ClinicalEpisodeStatus.active,
    last_activity_days_ago: float = 1,
    episode_type="general",
    summary: str = "",
):
    ep = models.ClinicalEpisode(
        profile_id=profile.id,
        owner_user_id=profile.owner_user_id,
        title=title,
        episode_type=episode_type,
        status=status,
        started_at=NOW - timedelta(days=last_activity_days_ago + 3),
        last_activity_at=NOW - timedelta(days=last_activity_days_ago),
        summary=summary,
    )
    db.add(ep)
    db.flush()
    return ep


def _make_task(
    db,
    episode,
    *,
    title="task",
    status="pending",
    task_type="follow_up",
    due_in_days: Optional[float] = None,
):
    due_at = None
    if due_in_days is not None:
        due_at = NOW + timedelta(days=due_in_days)
    t = models.ClinicalTask(
        episode_id=episode.id,
        profile_id=episode.profile_id,
        owner_user_id=episode.owner_user_id,
        title=title,
        task_type=task_type,
        status=status,
        due_at=due_at,
    )
    db.add(t)
    db.flush()
    return t


def _make_med(db, profile, *, episode=None, name="Ibuprofeno", completed=False):
    med = models.Medication(
        user_id=profile.owner_user_id,
        profile_id=profile.id,
        episode_id=episode.id if episode else None,
        name=name,
        dose="400mg",
        frequency="cada 8h",
        completed=completed,
    )
    db.add(med)
    db.flush()
    return med


def _make_appointment(db, profile, *, episode=None, in_hours: Optional[float] = 24):
    date_time = None
    if in_hours is not None:
        date_time = NOW + timedelta(hours=in_hours)
    ap = models.Appointment(
        user_id=profile.owner_user_id,
        profile_id=profile.id,
        episode_id=episode.id if episode else None,
        type=models.AppointmentType.cita,
        status=models.AppointmentStatus.pendiente,
        specialty="Traumatología",
        center="Clínica Alemana",
        date_time=date_time,
    )
    db.add(ap)
    db.flush()
    return ap


def _make_document(db, profile, *, episode=None, doc_type=models.DocumentType.resultado):
    doc = models.Document(
        user_id=profile.owner_user_id,
        profile_id=profile.id,
        episode_id=episode.id if episode else None,
        doc_type=doc_type,
        filename="doc.pdf",
        date=NOW - timedelta(days=1),
    )
    db.add(doc)
    db.flush()
    return doc


def _make_alert(
    db, profile, *, severity="high", status="active", title="Alerta", alert_type="adherence"
):
    al = models.HealthAlert(
        profile_id=profile.id,
        alert_type=alert_type,
        severity=severity,
        status=status,
        title=title,
        description="desc",
    )
    db.add(al)
    db.flush()
    return al


def _intent(kind, confidence=0.8):
    return Intent(kind=kind, confidence=confidence, source=IntentSource.HEURISTIC)


def _state(
    *,
    phase=ClinicalPhase.TREATMENT,
    urgency=UrgencyLevel.LOW,
    primary_episode_id=None,
    active_episode_count=1,
    pending_tasks=0,
    phase_per_episode=None,
):
    return ClinicalState(
        phase=phase,
        urgency=urgency,
        primary_episode_id=primary_episode_id,
        active_episode_count=active_episode_count,
        pending_tasks=pending_tasks,
        phase_per_episode=phase_per_episode or {},
    )


# ─── GET_STATUS ──────────────────────────────────────────────────────────────


class TestGetStatus:
    def test_incluye_secundarios_tasks_meds_citas_y_alertas(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        primary = _make_episode(db_session, profile, title="Rodilla")
        secondary = _make_episode(db_session, profile, title="Cardio", last_activity_days_ago=5)
        _make_task(db_session, primary, due_in_days=1)
        _make_med(db_session, profile, episode=primary)
        _make_appointment(db_session, profile, episode=primary, in_hours=48)
        _make_alert(db_session, profile, severity="high")
        db_session.commit()

        state = _state(primary_episode_id=primary.id, active_episode_count=2)
        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=state,
            intent=_intent(IntentKind.GET_STATUS),
            now=NOW,
        )

        assert ctx.primary_episode is not None
        assert ctx.primary_episode.id == primary.id
        assert len(ctx.secondary_episodes) == 1
        assert ctx.secondary_episodes[0].id == secondary.id
        assert len(ctx.pending_tasks) == 1
        assert len(ctx.active_medications) == 1
        assert len(ctx.upcoming_appointments) == 1
        assert len(ctx.critical_alerts) == 1
        assert ctx.trace.build_reason == "full_status_summary"
        assert ctx.trace.included["primary_episode"] == 1
        assert ctx.trace.included["secondary_episodes"] == 1


# ─── GET_PENDING ─────────────────────────────────────────────────────────────


class TestGetPending:
    def test_no_incluye_secundarios_ni_medicamentos(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        primary = _make_episode(db_session, profile)
        _make_episode(db_session, profile, title="Otro", last_activity_days_ago=5)
        _make_task(db_session, primary, title="t1", due_in_days=1)
        _make_task(db_session, primary, title="t2", due_in_days=-2)  # vencida
        _make_med(db_session, profile, episode=primary)
        db_session.commit()

        state = _state(primary_episode_id=primary.id, pending_tasks=2)
        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=state,
            intent=_intent(IntentKind.GET_PENDING),
            now=NOW,
        )

        assert ctx.primary_episode is not None
        assert ctx.secondary_episodes == []
        assert len(ctx.pending_tasks) == 2
        assert ctx.active_medications == []
        assert "secondary_episodes" in ctx.trace.excluded
        assert "active_medications" in ctx.trace.excluded
        assert ctx.trace.build_reason == "pending_focus"

    def test_marca_tareas_vencidas(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        ep = _make_episode(db_session, profile)
        _make_task(db_session, ep, title="futuro", due_in_days=2)
        _make_task(db_session, ep, title="vencida", due_in_days=-3)
        db_session.commit()

        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=_state(primary_episode_id=ep.id),
            intent=_intent(IntentKind.GET_PENDING),
            now=NOW,
        )
        tasks_by_title = {t.title: t for t in ctx.pending_tasks}
        assert tasks_by_title["vencida"].is_overdue is True
        assert tasks_by_title["futuro"].is_overdue is False


# ─── GET_EPISODE_DETAIL ──────────────────────────────────────────────────────


class TestGetEpisodeDetail:
    def test_scopea_al_episodio_primario(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        primary = _make_episode(db_session, profile, title="Rodilla")
        otro = _make_episode(db_session, profile, title="Otro", last_activity_days_ago=3)

        _make_task(db_session, primary, title="task-primary")
        _make_task(db_session, otro, title="task-otro")
        _make_med(db_session, profile, episode=primary, name="Primary med")
        _make_med(db_session, profile, episode=otro, name="Otro med")
        _make_appointment(db_session, profile, episode=primary, in_hours=24)
        _make_appointment(db_session, profile, episode=otro, in_hours=48)
        _make_document(db_session, profile, episode=primary)
        _make_document(db_session, profile, episode=otro)
        db_session.commit()

        state = _state(primary_episode_id=primary.id)
        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=state,
            intent=_intent(IntentKind.GET_EPISODE_DETAIL),
            now=NOW,
        )

        assert ctx.primary_episode.id == primary.id
        assert ctx.secondary_episodes == []
        assert {t.title for t in ctx.pending_tasks} == {"task-primary"}
        assert [m.name for m in ctx.active_medications] == ["Primary med"]
        assert len(ctx.upcoming_appointments) == 1
        assert ctx.upcoming_appointments[0].episode_id == primary.id
        assert len(ctx.recent_documents) == 1
        assert ctx.recent_documents[0].episode_id == primary.id
        assert any("scoped to episode" in n for n in ctx.trace.notes)


# ─── MEDICATION_INFO ─────────────────────────────────────────────────────────


class TestMedicationInfo:
    def test_trae_todas_las_medicaciones_sin_scope(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        ep1 = _make_episode(db_session, profile, title="E1")
        ep2 = _make_episode(db_session, profile, title="E2", last_activity_days_ago=4)
        _make_med(db_session, profile, episode=ep1, name="med1")
        _make_med(db_session, profile, episode=ep2, name="med2")
        _make_med(db_session, profile, episode=ep1, name="completed", completed=True)
        db_session.commit()

        state = _state(primary_episode_id=ep1.id)
        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=state,
            intent=_intent(IntentKind.MEDICATION_INFO),
            now=NOW,
        )

        names = {m.name for m in ctx.active_medications}
        assert names == {"med1", "med2"}  # completada excluida, sin scope
        assert ctx.upcoming_appointments == []
        assert ctx.recent_documents == []


# ─── APPOINTMENT_ACTION ──────────────────────────────────────────────────────


class TestAppointmentAction:
    def test_solo_citas_futuras_y_calcula_hours_until(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        ep = _make_episode(db_session, profile)
        _make_appointment(db_session, profile, episode=ep, in_hours=5)
        _make_appointment(db_session, profile, episode=ep, in_hours=48)
        _make_appointment(db_session, profile, episode=ep, in_hours=-10)  # pasada
        _make_appointment(db_session, profile, episode=ep, in_hours=None)  # sin fecha
        db_session.commit()

        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=_state(primary_episode_id=ep.id),
            intent=_intent(IntentKind.APPOINTMENT_ACTION),
            now=NOW,
        )

        assert len(ctx.upcoming_appointments) == 2
        hours = sorted(a.hours_until for a in ctx.upcoming_appointments)
        assert hours == [5.0, 48.0]


# ─── UPLOAD_INFO / VOICE_INPUT / UNKNOWN — minimales ─────────────────────────


class TestMinimalIntents:
    @pytest.mark.parametrize(
        "intent_kind,reason",
        [
            (IntentKind.UPLOAD_INFO, "upload_minimal"),
            (IntentKind.VOICE_INPUT, "voice_minimal"),
            (IntentKind.GENERAL_QUESTION, "general_light"),
            (IntentKind.UNKNOWN, "unknown_light"),
        ],
    )
    def test_no_trae_tasks_meds_ni_citas(self, db_session, intent_kind, reason):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        ep = _make_episode(db_session, profile)
        _make_task(db_session, ep)
        _make_med(db_session, profile, episode=ep)
        _make_appointment(db_session, profile, episode=ep, in_hours=12)
        db_session.commit()

        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=_state(primary_episode_id=ep.id),
            intent=_intent(intent_kind),
            now=NOW,
        )

        assert ctx.pending_tasks == []
        assert ctx.active_medications == []
        assert ctx.upcoming_appointments == []
        assert ctx.trace.build_reason == reason


# ─── Resolución de episodio primario ─────────────────────────────────────────


class TestPrimaryEpisodeResolution:
    def test_usa_primary_del_state(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        ep1 = _make_episode(db_session, profile, title="Viejo", last_activity_days_ago=10)
        ep2 = _make_episode(db_session, profile, title="Nuevo", last_activity_days_ago=1)
        db_session.commit()

        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=_state(primary_episode_id=ep1.id),
            intent=_intent(IntentKind.GET_STATUS),
            now=NOW,
        )
        assert ctx.primary_episode.id == ep1.id

    def test_fallback_a_activo_mas_reciente(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        _make_episode(db_session, profile, title="Viejo", last_activity_days_ago=10)
        nuevo = _make_episode(db_session, profile, title="Nuevo", last_activity_days_ago=1)
        db_session.commit()

        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=_state(primary_episode_id=None),
            intent=_intent(IntentKind.GET_STATUS),
            now=NOW,
        )
        assert ctx.primary_episode.id == nuevo.id

    def test_sin_episodios_primary_es_none(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        db_session.commit()

        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=_state(phase=ClinicalPhase.NO_CONTEXT, active_episode_count=0),
            intent=_intent(IntentKind.GET_STATUS),
            now=NOW,
        )
        assert ctx.primary_episode is None
        assert ctx.secondary_episodes == []
        assert "primary_episode" in ctx.trace.excluded


# ─── Secundarios — solo en GET_STATUS ────────────────────────────────────────


class TestSecondaryEpisodes:
    def test_no_aparecen_en_intents_distintos_de_status(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        primary = _make_episode(db_session, profile, title="P")
        _make_episode(db_session, profile, title="S1", last_activity_days_ago=3)
        db_session.commit()

        for intent_kind in [
            IntentKind.GET_PENDING,
            IntentKind.GET_EPISODE_DETAIL,
            IntentKind.MEDICATION_INFO,
            IntentKind.APPOINTMENT_ACTION,
        ]:
            ctx = build_clinical_context(
                db_session,
                profile_id=profile.id,
                state=_state(primary_episode_id=primary.id),
                intent=_intent(intent_kind),
                now=NOW,
            )
            assert ctx.secondary_episodes == [], f"secundarios en {intent_kind}"

    def test_excluye_episodio_primario_de_secundarios(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        primary = _make_episode(db_session, profile, title="P")
        sec = _make_episode(db_session, profile, title="S", last_activity_days_ago=5)
        db_session.commit()

        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=_state(primary_episode_id=primary.id),
            intent=_intent(IntentKind.GET_STATUS),
            now=NOW,
        )
        sec_ids = {e.id for e in ctx.secondary_episodes}
        assert primary.id not in sec_ids
        assert sec.id in sec_ids


# ─── Alertas — filtrar por severidad y estado ────────────────────────────────


class TestAlerts:
    def test_solo_high_o_critical_activas(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        _make_alert(db_session, profile, severity="high", title="h1")
        _make_alert(db_session, profile, severity="critical", title="c1")
        _make_alert(db_session, profile, severity="low", title="l1")
        _make_alert(db_session, profile, severity="high", title="resuelta", status="resolved")
        db_session.commit()

        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=_state(primary_episode_id=None, active_episode_count=0),
            intent=_intent(IntentKind.GET_STATUS),
            now=NOW,
        )
        titles = {a.title for a in ctx.critical_alerts}
        assert titles == {"h1", "c1"}


# ─── Trace ───────────────────────────────────────────────────────────────────


class TestTrace:
    def test_trace_registra_intent_y_reason(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        db_session.commit()

        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=_state(),
            intent=_intent(IntentKind.UPLOAD_INFO),
            now=NOW,
        )
        assert ctx.trace.intent_focus == IntentKind.UPLOAD_INFO
        assert ctx.trace.build_reason == "upload_minimal"

    def test_excluded_reasons_son_strings_legibles(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        db_session.commit()

        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=_state(active_episode_count=0),
            intent=_intent(IntentKind.GET_PENDING),
            now=NOW,
        )
        for reason in ctx.trace.excluded.values():
            assert isinstance(reason, str)
            assert len(reason) > 5


# ─── Token estimate ──────────────────────────────────────────────────────────


class TestTokenEstimate:
    def test_crece_con_mas_datos(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        ep = _make_episode(
            db_session, profile, title="Rodilla izquierda", summary="Resumen largo " * 20
        )
        for i in range(5):
            _make_task(db_session, ep, title=f"task número {i}")
        _make_med(db_session, profile, episode=ep, name="Medicamento largo")
        db_session.commit()

        ctx = build_clinical_context(
            db_session,
            profile_id=profile.id,
            state=_state(primary_episode_id=ep.id),
            intent=_intent(IntentKind.GET_STATUS),
            now=NOW,
        )
        assert ctx.token_estimate > 50
