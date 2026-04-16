"""Tipos y dataclasses compartidos por el clinical orchestrator."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class ClinicalPhase(str, Enum):
    NO_CONTEXT = "no_context"
    DIAGNOSIS = "diagnosis"
    TREATMENT = "treatment"
    FOLLOW_UP = "follow_up"
    MIXED = "mixed"


class UrgencyLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class ClinicalState:
    phase: ClinicalPhase
    urgency: UrgencyLevel
    primary_episode_id: Optional[int] = None
    active_episode_count: int = 0
    phase_per_episode: dict[int, ClinicalPhase] = field(default_factory=dict)
    overdue_tasks: int = 0
    pending_tasks: int = 0
    days_since_last_activity: Optional[int] = None
    has_critical_alert: bool = False
    upcoming_appointment_hours: Optional[float] = None
    confidence: float = 1.0


class IntentKind(str, Enum):
    GET_STATUS = "get_status"                    # "¿cómo estoy?"
    GET_PENDING = "get_pending"                  # "¿qué tengo pendiente?"
    GET_EPISODE_DETAIL = "get_episode_detail"    # "¿qué pasó con mi rodilla?"
    UPLOAD_INFO = "upload_info"                  # "quiero subir un examen"
    MEDICATION_INFO = "medication_info"          # "¿qué remedio tomo?"
    APPOINTMENT_ACTION = "appointment_action"    # "agenda una cita"
    GENERAL_QUESTION = "general_question"        # pregunta genérica de salud
    VOICE_INPUT = "voice_input"                  # viene de pipeline de voz
    UNKNOWN = "unknown"


class IntentSource(str, Enum):
    HEURISTIC = "heuristic"
    LLM = "llm"
    METADATA = "metadata"                        # derivado del source=voice


@dataclass
class Intent:
    kind: IntentKind
    confidence: float
    source: IntentSource
    matched_patterns: list[str] = field(default_factory=list)
    entities: dict = field(default_factory=dict)
    raw_scores: dict[str, float] = field(default_factory=dict)


# ─── Clinical Context — Fase 2a ──────────────────────────────────────────────
#
# Dataclasses que representan "lo que el orquestador sabe" de un perfil en un
# instante dado. El Prompt Composer las consume para armar el prompt final.
# Son snapshots livianos (no ORM) — desacoplados de SQLAlchemy para tests y
# trazabilidad.


@dataclass
class EpisodeSummary:
    id: int
    title: str
    status: str
    episode_type: str
    phase: ClinicalPhase
    started_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = None
    summary: str = ""
    pending_task_count: int = 0
    active_medication_count: int = 0
    relevance_score: float = 0.0


@dataclass
class TaskSummary:
    id: int
    episode_id: Optional[int]
    title: str
    task_type: str
    status: str
    due_at: Optional[datetime] = None
    is_overdue: bool = False
    relevance_score: float = 0.0


@dataclass
class MedicationSummary:
    id: int
    name: str
    dose: str
    frequency: str
    episode_id: Optional[int] = None
    completed: bool = False
    relevance_score: float = 0.0


@dataclass
class AppointmentSummary:
    id: int
    specialty: str
    center: str
    date_time: Optional[datetime]
    status: str
    episode_id: Optional[int] = None
    hours_until: Optional[float] = None
    relevance_score: float = 0.0


@dataclass
class DocumentRef:
    id: int
    doc_type: str
    filename: str
    date: Optional[datetime]
    episode_id: Optional[int] = None
    relevance_score: float = 0.0


@dataclass
class AlertSummary:
    id: int
    alert_type: str
    severity: str
    title: str
    description: str
    detected_at: Optional[datetime] = None
    relevance_score: float = 0.0


@dataclass
class ContextTrace:
    """Trazabilidad interna — qué se incluyó, qué se excluyó y por qué.

    Diseñado para observabilidad y tests: permite afirmar en un test que un
    intent no trajo secundarios, o que una sección fue skippeada por falta
    de datos sin tener que inspeccionar colecciones vacías.
    """

    build_reason: str
    intent_focus: "IntentKind"
    included: dict[str, int] = field(default_factory=dict)
    excluded: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


@dataclass
class ClinicalContext:
    profile_id: int
    intent_focus: "IntentKind"
    primary_episode: Optional[EpisodeSummary] = None
    secondary_episodes: list[EpisodeSummary] = field(default_factory=list)
    pending_tasks: list[TaskSummary] = field(default_factory=list)
    active_medications: list[MedicationSummary] = field(default_factory=list)
    upcoming_appointments: list[AppointmentSummary] = field(default_factory=list)
    recent_documents: list[DocumentRef] = field(default_factory=list)
    critical_alerts: list[AlertSummary] = field(default_factory=list)
    token_estimate: int = 0
    trace: Optional[ContextTrace] = None
