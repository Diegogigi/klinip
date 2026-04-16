"""Unit tests para clinical_state_engine.

Usa SQLite in-memory con el schema real de Klinip. Cada test construye el
escenario mínimo necesario con factories locales.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

import pytest

from app import models
from app.services.orchestrator import (
    ClinicalPhase,
    UrgencyLevel,
    compute_clinical_state,
)


NOW = datetime(2026, 4, 15, 12, 0, 0)


# ─── Factories ────────────────────────────────────────────────────────────────


def _make_user(db, email="u@test.cl"):
    user = models.User(email=email, password_hash="x", name="Test")
    db.add(user)
    db.flush()
    return user


def _make_profile(db, user):
    profile = models.HealthProfile(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        full_name="Test Profile",
    )
    db.add(profile)
    db.flush()
    return profile


def _make_episode(
    db,
    profile,
    *,
    status=models.ClinicalEpisodeStatus.active,
    last_activity_days_ago=2,
    title="Episodio",
):
    episode = models.ClinicalEpisode(
        profile_id=profile.id,
        owner_user_id=profile.owner_user_id,
        title=title,
        status=status,
        started_at=NOW - timedelta(days=last_activity_days_ago + 5),
        last_activity_at=NOW - timedelta(days=last_activity_days_ago),
    )
    db.add(episode)
    db.flush()
    return episode


def _make_task(
    db,
    episode,
    *,
    status="pending",
    due_in_days: Optional[int] = None,
    task_type="follow_up",
):
    due_at = None
    if due_in_days is not None:
        due_at = NOW + timedelta(days=due_in_days)
    task = models.ClinicalTask(
        episode_id=episode.id,
        profile_id=episode.profile_id,
        owner_user_id=episode.owner_user_id,
        task_type=task_type,
        title="task",
        status=status,
        due_at=due_at,
    )
    db.add(task)
    db.flush()
    return task


def _make_medication(
    db, episode, *, completed=False, end_days_ahead: Optional[int] = None, name="Ibuprofeno"
):
    med = models.Medication(
        user_id=episode.owner_user_id,
        profile_id=episode.profile_id,
        episode_id=episode.id,
        name=name,
        completed=completed,
        end_date=(NOW + timedelta(days=end_days_ahead)) if end_days_ahead else None,
    )
    db.add(med)
    db.flush()
    return med


def _make_document(db, episode, *, doc_type: models.DocumentType):
    doc = models.Document(
        user_id=episode.owner_user_id,
        profile_id=episode.profile_id,
        episode_id=episode.id,
        doc_type=doc_type,
        filename="doc.pdf",
    )
    db.add(doc)
    db.flush()
    return doc


def _make_appointment(
    db,
    profile,
    *,
    appt_type=models.AppointmentType.cita,
    status=models.AppointmentStatus.pendiente,
    in_hours: Optional[float] = None,
    episode=None,
):
    date_time = None
    if in_hours is not None:
        date_time = NOW + timedelta(hours=in_hours)
    appt = models.Appointment(
        user_id=profile.owner_user_id,
        profile_id=profile.id,
        episode_id=episode.id if episode else None,
        type=appt_type,
        status=status,
        date_time=date_time,
    )
    db.add(appt)
    db.flush()
    return appt


def _make_alert(db, profile, *, severity="high", status="active"):
    alert = models.HealthAlert(
        profile_id=profile.id,
        alert_type="adherence",
        severity=severity,
        status=status,
        title="Alerta",
        description="desc",
    )
    db.add(alert)
    db.flush()
    return alert


# ─── NO_CONTEXT ──────────────────────────────────────────────────────────────


class TestNoContext:
    def test_sin_episodios_retorna_no_context(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)

        state = compute_clinical_state(db_session, profile.id, now=NOW)

        assert state.phase == ClinicalPhase.NO_CONTEXT
        assert state.urgency == UrgencyLevel.LOW
        assert state.active_episode_count == 0
        assert state.primary_episode_id is None

    def test_episodios_archivados_cuentan_como_no_context(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        _make_episode(
            db_session, profile, status=models.ClinicalEpisodeStatus.archived
        )

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase == ClinicalPhase.NO_CONTEXT

    def test_episodios_muy_antiguos_cuentan_como_no_context(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        _make_episode(db_session, profile, last_activity_days_ago=120)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase == ClinicalPhase.NO_CONTEXT

    def test_no_context_escala_urgencia_si_alerta_critica(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        _make_alert(db_session, profile, severity="high")

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase == ClinicalPhase.NO_CONTEXT
        assert state.urgency == UrgencyLevel.HIGH
        assert state.has_critical_alert is True


# ─── DIAGNOSIS ───────────────────────────────────────────────────────────────


class TestDiagnosisPhase:
    def test_orden_sin_resultado_es_diagnosis(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile, title="Dolor rodilla")
        _make_document(db_session, episode, doc_type=models.DocumentType.orden)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase == ClinicalPhase.DIAGNOSIS
        assert state.primary_episode_id == episode.id

    def test_examen_pendiente_es_diagnosis(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile)
        _make_appointment(
            db_session,
            profile,
            episode=episode,
            appt_type=models.AppointmentType.examen,
            status=models.AppointmentStatus.agendada,
            in_hours=72,
        )

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase == ClinicalPhase.DIAGNOSIS

    def test_orden_con_resultado_no_es_diagnosis(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile)
        _make_document(db_session, episode, doc_type=models.DocumentType.orden)
        _make_document(db_session, episode, doc_type=models.DocumentType.resultado)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase != ClinicalPhase.DIAGNOSIS


# ─── TREATMENT ───────────────────────────────────────────────────────────────


class TestTreatmentPhase:
    def test_medicacion_activa_es_treatment(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile)
        _make_medication(db_session, episode)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase == ClinicalPhase.TREATMENT

    def test_medicacion_completada_no_es_treatment(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile)
        _make_medication(db_session, episode, completed=True)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase != ClinicalPhase.TREATMENT

    def test_diagnosis_tiene_prioridad_sobre_treatment(self, db_session):
        """Si hay orden sin resultado Y medicación activa → DIAGNOSIS."""
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile)
        _make_document(db_session, episode, doc_type=models.DocumentType.orden)
        _make_medication(db_session, episode)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase == ClinicalPhase.DIAGNOSIS


# ─── FOLLOW_UP ───────────────────────────────────────────────────────────────


class TestFollowUpPhase:
    def test_monitoring_sin_pendientes_es_follow_up(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        _make_episode(
            db_session,
            profile,
            status=models.ClinicalEpisodeStatus.monitoring,
        )

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase == ClinicalPhase.FOLLOW_UP
        assert state.urgency == UrgencyLevel.LOW

    def test_resultado_sin_pendientes_es_follow_up(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile)
        _make_document(db_session, episode, doc_type=models.DocumentType.resultado)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase == ClinicalPhase.FOLLOW_UP


# ─── MIXED ───────────────────────────────────────────────────────────────────


class TestMixedPhase:
    def test_dos_episodios_en_fases_distintas(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)

        ep_diag = _make_episode(db_session, profile, title="Rodilla")
        _make_document(
            db_session, ep_diag, doc_type=models.DocumentType.orden
        )

        ep_treat = _make_episode(db_session, profile, title="HTA")
        _make_medication(db_session, ep_treat, name="Losartán")

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.phase == ClinicalPhase.MIXED
        assert state.active_episode_count == 2
        assert state.phase_per_episode[ep_diag.id] == ClinicalPhase.DIAGNOSIS
        assert state.phase_per_episode[ep_treat.id] == ClinicalPhase.TREATMENT
        # primary debe ser el de DIAGNOSIS (prioridad más alta con mismos tasks)
        assert state.primary_episode_id == ep_diag.id


# ─── URGENCY ─────────────────────────────────────────────────────────────────


class TestUrgency:
    def test_low_cuando_todo_al_dia(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        _make_episode(
            db_session, profile, status=models.ClinicalEpisodeStatus.monitoring
        )

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.urgency == UrgencyLevel.LOW

    def test_medium_con_tareas_pendientes(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile)
        _make_medication(db_session, episode)
        _make_task(db_session, episode, due_in_days=5)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.urgency == UrgencyLevel.MEDIUM
        assert state.pending_tasks == 1

    def test_high_con_cita_en_menos_de_48h(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile)
        _make_medication(db_session, episode)
        _make_appointment(
            db_session,
            profile,
            episode=episode,
            status=models.AppointmentStatus.agendada,
            in_hours=12,
        )

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.urgency == UrgencyLevel.HIGH
        assert state.upcoming_appointment_hours == pytest.approx(12.0)

    def test_high_con_tarea_criticamente_vencida(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile)
        _make_medication(db_session, episode)
        _make_task(db_session, episode, due_in_days=-10)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.urgency == UrgencyLevel.HIGH
        assert state.overdue_tasks == 1

    def test_high_con_alerta_critica_sin_overdue(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile)
        _make_medication(db_session, episode)
        _make_alert(db_session, profile, severity="high")

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.urgency == UrgencyLevel.HIGH
        assert state.has_critical_alert is True

    def test_critical_con_alerta_y_task_overdue(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile)
        _make_medication(db_session, episode)
        _make_alert(db_session, profile, severity="high")
        _make_task(db_session, episode, due_in_days=-10)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.urgency == UrgencyLevel.CRITICAL


# ─── PRIMARY EPISODE + CONFIDENCE ────────────────────────────────────────────


class TestPrimaryAndConfidence:
    def test_primary_episode_prioriza_por_overdue(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)

        ep_low = _make_episode(db_session, profile, title="Low")
        _make_medication(db_session, ep_low)

        ep_high = _make_episode(db_session, profile, title="High")
        _make_medication(db_session, ep_high)
        _make_task(db_session, ep_high, due_in_days=-3)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.primary_episode_id == ep_high.id

    def test_confidence_disminuye_con_fases_distintas(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)

        ep1 = _make_episode(db_session, profile, title="A")
        _make_document(db_session, ep1, doc_type=models.DocumentType.orden)

        ep2 = _make_episode(db_session, profile, title="B")
        _make_medication(db_session, ep2)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.confidence < 1.0
        assert state.confidence >= 0.7  # penalización leve (2 fases distintas)

    def test_confidence_alta_con_episodio_unico_y_reciente(self, db_session):
        user = _make_user(db_session)
        profile = _make_profile(db_session, user)
        episode = _make_episode(db_session, profile, last_activity_days_ago=1)
        _make_medication(db_session, episode)

        state = compute_clinical_state(db_session, profile.id, now=NOW)
        assert state.confidence == pytest.approx(1.0)


# ─── Aislamiento por perfil ──────────────────────────────────────────────────


class TestIsolation:
    def test_datos_de_otro_perfil_no_afectan_el_estado(self, db_session):
        user = _make_user(db_session, email="a@test.cl")
        profile_a = _make_profile(db_session, user)
        profile_b = _make_profile(db_session, user)

        episode_b = _make_episode(db_session, profile_b)
        _make_medication(db_session, episode_b)
        _make_alert(db_session, profile_b, severity="high")

        state_a = compute_clinical_state(db_session, profile_a.id, now=NOW)
        assert state_a.phase == ClinicalPhase.NO_CONTEXT
        assert state_a.has_critical_alert is False
