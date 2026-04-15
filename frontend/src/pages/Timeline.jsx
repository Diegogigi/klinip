import React, { useEffect, useMemo, useState } from "react";
import {
  getActiveHealthProfile,
  getAiLifeTimeline,
  getClinicalEpisodeDetail,
  getClinicalEpisodes,
  getHealthProfiles,
} from "../api";
import { ensureArray } from "../utils/arrays";
import { parseDate, toLocaleDateOrEmpty, toLocaleDateTimeOrEmpty } from "../utils/dates";
import { cleanUiText } from "../utils/textEncoding";

const EPISODE_STATUS_LABELS = {
  active: "Activo",
  monitoring: "En seguimiento",
  pending: "Pendiente",
  paused: "En pausa",
  resolved: "Resuelto",
  completed: "Cerrado",
  closed: "Cerrado",
};

const EPISODE_TYPE_LABELS = {
  general: "Proceso general",
  consultation: "Consulta médica",
  exam: "Exámenes",
  treatment: "Tratamiento",
  surgery: "Cirugía",
  rehabilitation: "Rehabilitación",
  chronic: "Control crónico",
};

const EVENT_TYPE_LABELS = {
  appointment: "Cita",
  document: "Documento",
  medication: "Medicamento",
  medication_intake: "Dosis registrada",
  external_record: "Resultado",
};

const STATUS_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "active", label: "Activos" },
  { id: "pending", label: "Con pendiente" },
  { id: "closed", label: "Cerrados" },
];

function getEpisodeStatusLabel(status) {
  return EPISODE_STATUS_LABELS[String(status || "").toLowerCase()] || "En curso";
}

function getEpisodeTypeLabel(type) {
  return EPISODE_TYPE_LABELS[String(type || "").toLowerCase()] || "Proceso de salud";
}

function getEventTypeLabel(type) {
  return EVENT_TYPE_LABELS[String(type || "").toLowerCase()] || "Evento";
}

function getEpisodeTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "completed" || normalized === "closed" || normalized === "resolved") return "closed";
  if (normalized === "pending" || normalized === "paused") return "attention";
  return "active";
}

function buildEpisodeSearchValue(episode) {
  return [
    cleanUiText(episode.title),
    cleanUiText(episode.summary),
    cleanUiText(episode.care_summary),
    ensureArray(episode.tags_json).join(" "),
    cleanUiText(episode.episode_type),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getEpisodeLead(episode) {
  const summary = cleanUiText(episode.care_summary || episode.summary, "");
  if (summary) return summary;
  return "Aquí reunimos citas, documentos, resultados y tratamientos de este proceso.";
}

function getProfileLabel(selectedProfileId, profiles, activeProfile) {
  if (selectedProfileId === "active") {
    return cleanUiText(activeProfile?.full_name || activeProfile?.name, "perfil activo");
  }
  const found = ensureArray(profiles).find((item) => String(item.id) === String(selectedProfileId));
  return cleanUiText(found?.full_name || found?.name, "perfil");
}

function getEpisodeNextStep(episode, detail) {
  const pendingTasks = ensureArray(detail?.tasks).filter((task) => task.status !== "completed");
  const firstPendingTask = pendingTasks[0];
  if (firstPendingTask?.title) {
    const dueText = firstPendingTask.due_at ? ` antes del ${toLocaleDateOrEmpty(firstPendingTask.due_at)}` : "";
    return `${cleanUiText(firstPendingTask.title)}${dueText}`.trim();
  }
  if (episode.next_due_at) {
    return `Revisar este proceso el ${toLocaleDateOrEmpty(episode.next_due_at)}.`;
  }
  return "No hay un próximo paso pendiente registrado.";
}

function getEpisodeCountSummary(episode) {
  const parts = [];
  if (episode.linked_appointments) parts.push(`${episode.linked_appointments} cita${episode.linked_appointments === 1 ? "" : "s"}`);
  if (episode.linked_documents) parts.push(`${episode.linked_documents} documento${episode.linked_documents === 1 ? "" : "s"}`);
  if (episode.linked_medications) parts.push(`${episode.linked_medications} medicamento${episode.linked_medications === 1 ? "" : "s"}`);
  if (episode.linked_external_records) {
    parts.push(`${episode.linked_external_records} resultado${episode.linked_external_records === 1 ? "" : "s"}`);
  }
  if (!parts.length) return "Aún no hay elementos vinculados.";
  return `Incluye ${parts.join(", ")}.`;
}

function getTaskTone(task) {
  if (String(task?.status || "").toLowerCase() === "completed") return "done";
  const dueDate = parseDate(task?.due_at);
  if (dueDate && dueDate.getTime() < Date.now()) return "overdue";
  return "pending";
}

function getTaskStatusLabel(task) {
  const normalized = String(task?.status || "").toLowerCase();
  if (normalized === "completed") return "Listo";
  if (getTaskTone(task) === "overdue") return "Atrasado";
  return "Pendiente";
}

function getTaskDateLabel(task) {
  if (task.completed_at) return `Completado el ${toLocaleDateOrEmpty(task.completed_at)}`;
  if (task.due_at) return `Hacer antes del ${toLocaleDateOrEmpty(task.due_at)}`;
  return "Sin fecha límite";
}

function getTimelineEventDate(event) {
  return event?.event_at ? toLocaleDateTimeOrEmpty(event.event_at) : "Fecha no informada";
}

function getLegacyLeadText(item) {
  const typeLabel = getEventTypeLabel(item.event_type);
  const title = cleanUiText(item.title, "Evento clínico");
  return `${typeLabel}: ${title}`;
}

function renderRelatedItem(item, kind) {
  if (kind === "appointments") {
    return {
      title: cleanUiText(item.specialty || item.type, "Cita médica"),
      detail: [cleanUiText(item.status), cleanUiText(item.center), toLocaleDateTimeOrEmpty(item.date_time)]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (kind === "documents") {
    return {
      title: cleanUiText(item.filename, "Documento clínico"),
      detail: [cleanUiText(item.doc_type), cleanUiText(item.center), toLocaleDateOrEmpty(item.date)]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (kind === "medications") {
    return {
      title: cleanUiText(item.name, "Medicamento"),
      detail: [cleanUiText(item.dose), cleanUiText(item.frequency), item.completed ? "Finalizado" : "Activo"]
        .filter(Boolean)
        .join(" · "),
    };
  }
  return {
    title: cleanUiText(item.title, "Resultado"),
    detail: [cleanUiText(item.record_type), toLocaleDateTimeOrEmpty(item.event_at)].filter(Boolean).join(" · "),
  };
}

function EpisodeSection({ title, count, emptyText, items, kind }) {
  const safeItems = ensureArray(items);
  return (
    <section className="history-episode-panel">
      <div className="history-episode-panel-head">
        <h4>{title}</h4>
        <span>{count}</span>
      </div>
      {safeItems.length ? (
        <div className="history-episode-mini-list">
          {safeItems.slice(0, 3).map((item) => {
            const view = renderRelatedItem(item, kind);
            return (
              <article key={`${kind}-${item.id}`} className="history-episode-mini-item">
                <strong>{view.title}</strong>
                <p>{view.detail || "Sin detalle adicional"}</p>
              </article>
            );
          })}
          {safeItems.length > 3 ? (
            <p className="history-episode-more">+ {safeItems.length - 3} elemento(s) más dentro de este proceso.</p>
          ) : null}
        </div>
      ) : (
        <p className="history-episode-empty">{emptyText}</p>
      )}
    </section>
  );
}

export default function Timeline() {
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [selectedProfileId, setSelectedProfileId] = useState("active");
  const [resolvedProfileId, setResolvedProfileId] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [episodeDetails, setEpisodeDetails] = useState({});
  const [legacyTimeline, setLegacyTimeline] = useState({ summary: "", events: [], event_count: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingDetailId, setLoadingDetailId] = useState(null);
  const [expandedEpisodeId, setExpandedEpisodeId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [activeProfileData, profilesData] = await Promise.all([
          getActiveHealthProfile().catch(() => null),
          getHealthProfiles().catch(() => []),
        ]);
        if (cancelled) return;

        const safeProfiles = ensureArray(profilesData);
        const fallbackProfileId = activeProfileData?.id || safeProfiles[0]?.id || null;
        const nextResolvedProfileId =
          selectedProfileId === "active" ? fallbackProfileId : Number(selectedProfileId) || fallbackProfileId;

        setActiveProfile(activeProfileData || null);
        setProfiles(safeProfiles);
        setResolvedProfileId(nextResolvedProfileId || null);

        const [episodesData, legacyData] = await Promise.all([
          nextResolvedProfileId ? getClinicalEpisodes(nextResolvedProfileId).catch(() => []) : Promise.resolve([]),
          getAiLifeTimeline({
            profile_id: nextResolvedProfileId || undefined,
            days: 365,
            include_family: false,
          }).catch(() => ({ summary: "", events: [], event_count: 0 })),
        ]);
        if (cancelled) return;

        const safeEpisodes = ensureArray(episodesData);
        setEpisodes(safeEpisodes);
        setLegacyTimeline(legacyData || { summary: "", events: [], event_count: 0 });
        setEpisodeDetails({});
        setExpandedEpisodeId(safeEpisodes[0]?.id || null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [selectedProfileId]);

  useEffect(() => {
    let cancelled = false;
    const loadDetail = async () => {
      if (!resolvedProfileId || !expandedEpisodeId || episodeDetails[expandedEpisodeId]) return;
      setLoadingDetailId(expandedEpisodeId);
      try {
        const detail = await getClinicalEpisodeDetail(resolvedProfileId, expandedEpisodeId).catch(() => null);
        if (cancelled || !detail) return;
        setEpisodeDetails((current) => ({
          ...current,
          [expandedEpisodeId]: detail,
        }));
      } finally {
        if (!cancelled) setLoadingDetailId(null);
      }
    };
    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [episodeDetails, expandedEpisodeId, resolvedProfileId]);

  const filteredEpisodes = useMemo(() => {
    const searchValue = searchTerm.trim().toLowerCase();
    return ensureArray(episodes).filter((episode) => {
      const tone = getEpisodeTone(episode.status);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && tone === "active") ||
        (statusFilter === "pending" && episode.pending_tasks > 0) ||
        (statusFilter === "closed" && tone === "closed");
      const matchesSearch = !searchValue || buildEpisodeSearchValue(episode).includes(searchValue);
      return matchesStatus && matchesSearch;
    });
  }, [episodes, searchTerm, statusFilter]);

  const stats = useMemo(() => {
    const safeEpisodes = ensureArray(episodes);
    return {
      total: safeEpisodes.length,
      active: safeEpisodes.filter((item) => getEpisodeTone(item.status) === "active").length,
      pending: safeEpisodes.reduce((sum, item) => sum + Number(item.pending_tasks || 0), 0),
      medications: safeEpisodes.reduce((sum, item) => sum + Number(item.linked_medications || 0), 0),
    };
  }, [episodes]);

  const profileLabel = useMemo(
    () => getProfileLabel(selectedProfileId, profiles, activeProfile),
    [activeProfile, profiles, selectedProfileId]
  );

  const legacyEvents = useMemo(() => ensureArray(legacyTimeline.events).slice(0, 6), [legacyTimeline.events]);

  return (
    <>
      <div className="card history-episodes-hero">
        <div className="history-episodes-hero-copy">
          <span className="history-episodes-kicker">Historial</span>
          <h2 className="card-title">Procesos de salud conectados</h2>
          <p className="muted">
            Aquí cada atención se entiende como un proceso completo: consulta, exámenes, documentos, resultados y
            tratamiento en un mismo lugar.
          </p>
          <p className="history-episodes-hero-note">
            Perfil actual: <strong>{profileLabel}</strong>
          </p>
        </div>

        <div className="history-episodes-stats">
          <article className="history-episodes-stat">
            <strong>{stats.total}</strong>
            <span>Procesos</span>
          </article>
          <article className="history-episodes-stat">
            <strong>{stats.active}</strong>
            <span>Activos</span>
          </article>
          <article className="history-episodes-stat">
            <strong>{stats.pending}</strong>
            <span>Pendientes</span>
          </article>
          <article className="history-episodes-stat">
            <strong>{stats.medications}</strong>
            <span>Medicamentos</span>
          </article>
        </div>
      </div>

      <div className="card history-episodes-controls">
        <div className="history-episodes-controls-grid">
          <div className="input-group">
            <label className="input-label">Perfil</label>
            <select className="input-field" value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
              <option value="active">Perfil activo</option>
              {profiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {cleanUiText(item.full_name, `Perfil ${item.id}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="input-group">
            <label className="input-label">Buscar proceso</label>
            <input
              type="text"
              className="input-field"
              placeholder="Ejemplo: traumatología, rodilla, receta"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="history-episodes-filter-row" role="tablist" aria-label="Filtrar procesos">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.id}
              className={`${statusFilter === item.id ? "primary-btn" : "secondary-btn"} history-episodes-filter-btn`}
              onClick={() => setStatusFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card history-episodes-empty">Estamos organizando tu historial por procesos de salud...</div>
      ) : filteredEpisodes.length ? (
        <div className="history-episodes-stack">
          {filteredEpisodes.map((episode) => {
            const detail = episodeDetails[episode.id];
            const isExpanded = expandedEpisodeId === episode.id;
            const tone = getEpisodeTone(episode.status);
            const pendingTasks = ensureArray(detail?.tasks).filter((task) => task.status !== "completed");
            const recentTimeline = ensureArray(detail?.timeline).slice().reverse().slice(0, 6);
            const tags = ensureArray(episode.tags_json).filter(Boolean).slice(0, 4);

            return (
              <article key={episode.id} className={`card history-episode-card tone-${tone}`}>
                <div className="history-episode-card-head">
                  <div className="history-episode-eyebrow">
                    <span className="history-episode-type">{getEpisodeTypeLabel(episode.episode_type)}</span>
                    <span className={`history-episode-status tone-${tone}`}>{getEpisodeStatusLabel(episode.status)}</span>
                  </div>
                  <button
                    className="secondary-btn history-episode-toggle"
                    onClick={() => setExpandedEpisodeId(isExpanded ? null : episode.id)}
                  >
                    {isExpanded ? "Ocultar detalle" : "Ver proceso"}
                  </button>
                </div>

                <h3 className="history-episode-title">{cleanUiText(episode.title, "Proceso de salud")}</h3>
                <p className="history-episode-summary">{getEpisodeLead(episode)}</p>

                <div className="history-episode-highlights">
                  <article className="history-episode-highlight">
                    <span>Próximo paso</span>
                    <strong>{getEpisodeNextStep(episode, detail)}</strong>
                  </article>
                  <article className="history-episode-highlight">
                    <span>Qué incluye</span>
                    <strong>{getEpisodeCountSummary(episode)}</strong>
                  </article>
                  <article className="history-episode-highlight">
                    <span>Último movimiento</span>
                    <strong>{episode.last_activity_at ? toLocaleDateOrEmpty(episode.last_activity_at) : "Sin fecha registrada"}</strong>
                  </article>
                </div>

                {tags.length ? (
                  <div className="history-episode-tags">
                    {tags.map((tag) => (
                      <span key={`${episode.id}-${tag}`} className="history-episode-tag">
                        {cleanUiText(tag)}
                      </span>
                    ))}
                  </div>
                ) : null}

                {isExpanded ? (
                  <div className="history-episode-detail">
                    {loadingDetailId === episode.id && !detail ? (
                      <div className="history-episode-empty">Cargando este proceso...</div>
                    ) : (
                      <>
                        <div className="history-episode-detail-grid">
                          <section className="history-episode-panel">
                            <div className="history-episode-panel-head">
                              <h4>Lo que falta</h4>
                              <span>{episode.pending_tasks || 0}</span>
                            </div>
                            {pendingTasks.length ? (
                              <div className="history-episode-task-list">
                                {pendingTasks.map((task) => (
                                  <article key={task.id} className={`history-episode-task tone-${getTaskTone(task)}`}>
                                    <div>
                                      <strong>{cleanUiText(task.title, "Pendiente clínico")}</strong>
                                      <p>{cleanUiText(task.description, getTaskDateLabel(task))}</p>
                                    </div>
                                    <span>{getTaskStatusLabel(task)}</span>
                                  </article>
                                ))}
                              </div>
                            ) : (
                              <p className="history-episode-empty">No hay tareas pendientes en este proceso.</p>
                            )}
                          </section>

                          <section className="history-episode-panel">
                            <div className="history-episode-panel-head">
                              <h4>Qué pasó hasta ahora</h4>
                              <span>{ensureArray(detail?.timeline).length}</span>
                            </div>
                            {recentTimeline.length ? (
                              <div className="history-episode-timeline">
                                {recentTimeline.map((event, index) => (
                                  <article key={`${episode.id}-${event.source_record_type}-${event.source_record_id}-${index}`} className="history-episode-timeline-item">
                                    <div className="history-episode-timeline-dot" />
                                    <div>
                                      <strong>{getLegacyLeadText(event)}</strong>
                                      <p>{cleanUiText(event.summary, "Sin detalle adicional")}</p>
                                      <span>{getTimelineEventDate(event)}</span>
                                    </div>
                                  </article>
                                ))}
                              </div>
                            ) : (
                              <p className="history-episode-empty">Aún no hay eventos visibles dentro de este proceso.</p>
                            )}
                          </section>
                        </div>

                        <div className="history-episode-related-grid">
                          <EpisodeSection
                            title="Citas vinculadas"
                            count={episode.linked_appointments || 0}
                            emptyText="No hay citas vinculadas todavía."
                            items={detail?.related_items?.appointments}
                            kind="appointments"
                          />
                          <EpisodeSection
                            title="Documentos"
                            count={episode.linked_documents || 0}
                            emptyText="No hay documentos vinculados todavía."
                            items={detail?.related_items?.documents}
                            kind="documents"
                          />
                          <EpisodeSection
                            title="Medicamentos"
                            count={episode.linked_medications || 0}
                            emptyText="No hay medicamentos vinculados todavía."
                            items={detail?.related_items?.medications}
                            kind="medications"
                          />
                          <EpisodeSection
                            title="Resultados e informes"
                            count={episode.linked_external_records || 0}
                            emptyText="No hay resultados vinculados todavía."
                            items={detail?.related_items?.external_records}
                            kind="external_records"
                          />
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="history-episodes-stack">
          <div className="card history-episodes-empty history-episodes-transition">
            <h3>No encontramos procesos agrupados para este perfil</h3>
            <p>
              Estamos conectando tus atenciones para que se entiendan como un solo proceso. Mientras eso termina, abajo
              verás la actividad reciente de la forma tradicional.
            </p>
          </div>

          <div className="card history-legacy-card">
            <div className="history-legacy-head">
              <div>
                <span className="history-episodes-kicker">Vista temporal</span>
                <h3>Actividad reciente aún sin agrupar</h3>
              </div>
              <span>{legacyTimeline.event_count || legacyEvents.length} evento(s)</span>
            </div>

            {legacyEvents.length ? (
              <div className="history-legacy-list">
                {legacyEvents.map((item, index) => (
                  <article key={`${item.id || item.source_record_id || index}-${index}`} className="history-legacy-item">
                    <strong>{getLegacyLeadText(item)}</strong>
                    <p>{cleanUiText(item.summary, "Sin detalle adicional")}</p>
                    <span>{item.event_at ? toLocaleDateTimeOrEmpty(item.event_at) : "Fecha no informada"}</span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="history-episodes-empty">Todavía no hay eventos clínicos para mostrar.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
