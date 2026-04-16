"""Token budgeter — Fase 2c del Clinical Orchestrator.

Aplica un presupuesto de tokens al ClinicalContext. Estrategia:

1. Estima el costo en tokens de cada item individualmente.
2. Si el total está bajo el budget → no toca nada.
3. Si se excede, descarta items no-protegidos en orden ascendente de
   `relevance_score`, registrando cada drop en `context.trace`.

Items protegidos (nunca se descartan):
- `primary_episode` (si fue incluido por la estrategia del intent).
- Alertas con `severity == "critical"`.

Items droppables:
- secondary_episodes
- pending_tasks
- active_medications
- upcoming_appointments
- recent_documents
- alertas `high` (no críticas)

Precede al Prompt Composer (Fase 2d) — cuando se implemente, recibirá un
`ClinicalContext` ya trimado y scoreado, listo para serializar al prompt.
"""

from __future__ import annotations

from dataclasses import dataclass

from .contracts import (
    AlertSummary,
    AppointmentSummary,
    ClinicalContext,
    DocumentRef,
    EpisodeSummary,
    MedicationSummary,
    TaskSummary,
)


DEFAULT_BUDGET_TOKENS = 2000
CHARS_PER_TOKEN = 3.5


@dataclass
class _Droppable:
    section: str
    index: int
    score: float
    token_cost: int
    item_id: int
    is_critical_alert: bool


def apply_token_budget(
    context: ClinicalContext,
    *,
    budget: int = DEFAULT_BUDGET_TOKENS,
) -> ClinicalContext:
    """Recorta el contexto si excede `budget`. Muta y retorna el mismo context."""
    if budget <= 0:
        return context

    candidates = _collect_droppable(context)
    current = context.token_estimate or _recompute_tokens(context)

    if current <= budget:
        if context.trace is not None:
            context.trace.notes.append(f"budget ok ({current} <= {budget})")
        context.token_estimate = current
        return context

    # Orden ascendente por score — los menos relevantes caen primero.
    candidates.sort(key=lambda c: (c.score, c.token_cost))
    drop_ids_by_section: dict[str, set[int]] = {}

    for cand in candidates:
        if cand.is_critical_alert:
            continue  # doble seguro — _collect_droppable ya los filtró
        if current <= budget:
            break
        drop_ids_by_section.setdefault(cand.section, set()).add(cand.item_id)
        current -= cand.token_cost
        _record_drop(context, cand)

    if drop_ids_by_section:
        _prune_sections(context, drop_ids_by_section)

    context.token_estimate = _recompute_tokens(context)
    if context.trace is not None:
        context.trace.notes.append(
            f"budget applied ({context.token_estimate} <= {budget}, target={budget})"
        )
    return context


# ─── Recolección de candidatos ───────────────────────────────────────────────


def _collect_droppable(ctx: ClinicalContext) -> list[_Droppable]:
    droppables: list[_Droppable] = []

    for i, ep in enumerate(ctx.secondary_episodes):
        droppables.append(
            _Droppable(
                section="secondary_episodes",
                index=i,
                score=ep.relevance_score,
                token_cost=_episode_cost(ep),
                item_id=ep.id,
                is_critical_alert=False,
            )
        )
    for i, t in enumerate(ctx.pending_tasks):
        droppables.append(
            _Droppable(
                section="pending_tasks",
                index=i,
                score=t.relevance_score,
                token_cost=_task_cost(t),
                item_id=t.id,
                is_critical_alert=False,
            )
        )
    for i, m in enumerate(ctx.active_medications):
        droppables.append(
            _Droppable(
                section="active_medications",
                index=i,
                score=m.relevance_score,
                token_cost=_medication_cost(m),
                item_id=m.id,
                is_critical_alert=False,
            )
        )
    for i, a in enumerate(ctx.upcoming_appointments):
        droppables.append(
            _Droppable(
                section="upcoming_appointments",
                index=i,
                score=a.relevance_score,
                token_cost=_appointment_cost(a),
                item_id=a.id,
                is_critical_alert=False,
            )
        )
    for i, d in enumerate(ctx.recent_documents):
        droppables.append(
            _Droppable(
                section="recent_documents",
                index=i,
                score=d.relevance_score,
                token_cost=_document_cost(d),
                item_id=d.id,
                is_critical_alert=False,
            )
        )
    for i, al in enumerate(ctx.critical_alerts):
        is_crit = (al.severity or "").lower() == "critical"
        if is_crit:
            continue  # nunca droppar criticas
        droppables.append(
            _Droppable(
                section="critical_alerts",
                index=i,
                score=al.relevance_score,
                token_cost=_alert_cost(al),
                item_id=al.id,
                is_critical_alert=False,
            )
        )
    return droppables


# ─── Drop registrado en trace ────────────────────────────────────────────────


def _record_drop(ctx: ClinicalContext, cand: _Droppable) -> None:
    if ctx.trace is None:
        return
    key = f"{cand.section}[dropped]"
    existing = ctx.trace.excluded.get(key, "")
    entry = f"id={cand.item_id} score={round(cand.score, 2)} cost={cand.token_cost}"
    ctx.trace.excluded[key] = f"{existing}; {entry}" if existing else entry


# ─── Poda efectiva de las colecciones ────────────────────────────────────────


def _prune_sections(ctx: ClinicalContext, drops: dict[str, set[int]]) -> None:
    def _filter(section: str, items: list, id_attr: str = "id") -> list:
        ids_to_drop = drops.get(section, set())
        if not ids_to_drop:
            return items
        return [it for it in items if getattr(it, id_attr) not in ids_to_drop]

    ctx.secondary_episodes = _filter("secondary_episodes", ctx.secondary_episodes)
    ctx.pending_tasks = _filter("pending_tasks", ctx.pending_tasks)
    ctx.active_medications = _filter("active_medications", ctx.active_medications)
    ctx.upcoming_appointments = _filter("upcoming_appointments", ctx.upcoming_appointments)
    ctx.recent_documents = _filter("recent_documents", ctx.recent_documents)
    ctx.critical_alerts = _filter("critical_alerts", ctx.critical_alerts)


# ─── Costos por item (chars → tokens) ────────────────────────────────────────


def _chars_to_tokens(chars: int) -> int:
    return max(1, int(chars / CHARS_PER_TOKEN))


def _episode_cost(ep: EpisodeSummary) -> int:
    return _chars_to_tokens(len(ep.title) + len(ep.summary) + 30)


def _task_cost(t: TaskSummary) -> int:
    return _chars_to_tokens(len(t.title) + 20)


def _medication_cost(m: MedicationSummary) -> int:
    return _chars_to_tokens(len(m.name) + len(m.dose) + len(m.frequency) + 15)


def _appointment_cost(a: AppointmentSummary) -> int:
    return _chars_to_tokens(len(a.specialty) + len(a.center) + 30)


def _document_cost(d: DocumentRef) -> int:
    return _chars_to_tokens(len(d.filename) + len(d.doc_type) + 15)


def _alert_cost(al: AlertSummary) -> int:
    return _chars_to_tokens(len(al.title) + len(al.description) + 20)


# ─── Recomputo total ─────────────────────────────────────────────────────────


def _recompute_tokens(ctx: ClinicalContext) -> int:
    total = 0
    if ctx.primary_episode is not None:
        total += _episode_cost(ctx.primary_episode)
    total += sum(_episode_cost(e) for e in ctx.secondary_episodes)
    total += sum(_task_cost(t) for t in ctx.pending_tasks)
    total += sum(_medication_cost(m) for m in ctx.active_medications)
    total += sum(_appointment_cost(a) for a in ctx.upcoming_appointments)
    total += sum(_document_cost(d) for d in ctx.recent_documents)
    total += sum(_alert_cost(al) for al in ctx.critical_alerts)
    return total
