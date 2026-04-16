"""Clinical orchestrator — coordina las capas de IA de Klinip.

Fase 1a: solo Clinical State Engine. Las demás capas (intent classifier,
context builder, prompt composer, response policy, action dispatcher) se
añaden en fases siguientes.
"""

from .contracts import (
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
)
from .clinical_state_engine import compute_clinical_state
from .context_builder import build_clinical_context
from .intent_classifier import classify_intent
from .intent_shadow_logger import (
    estimate_would_change_response,
    log_intent_shadow,
    run_intent_shadow_pipeline,
)
from .relevance_scorer import score_context
from .shadow_metrics import compute_shadow_metrics
from .token_budgeter import DEFAULT_BUDGET_TOKENS, apply_token_budget

__all__ = [
    "AlertSummary",
    "AppointmentSummary",
    "ClinicalContext",
    "ClinicalPhase",
    "ClinicalState",
    "ContextTrace",
    "DEFAULT_BUDGET_TOKENS",
    "DocumentRef",
    "EpisodeSummary",
    "Intent",
    "IntentKind",
    "IntentSource",
    "MedicationSummary",
    "TaskSummary",
    "UrgencyLevel",
    "apply_token_budget",
    "build_clinical_context",
    "classify_intent",
    "compute_clinical_state",
    "compute_shadow_metrics",
    "estimate_would_change_response",
    "log_intent_shadow",
    "run_intent_shadow_pipeline",
    "score_context",
]
