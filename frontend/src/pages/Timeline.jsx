import React, { useEffect, useMemo, useState } from "react";
import {
  getActiveHealthProfile,
  getAiLifeTimeline,
  getAppointments,
  getClinicalEpisodeDetail,
  getClinicalEpisodes,
  getDocuments,
  getHealthProfiles,
  getMedications,
  relinkClinicalEpisodeItem,
} from "../api";
import { ensureArray } from "../utils/arrays";
import { toLocaleDateOrEmpty, toLocaleDateTimeOrEmpty } from "../utils/dates";
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
  clinical_follow_up: "Seguimiento clínico",
  diagnostic_workup: "Estudio clínico",
  treatment_cycle: "Tratamiento",
  interoperability: "Resultado externo",
};

const STATUS_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "active", label: "Activos" },
  { id: "pending", label: "Con pendiente" },
  { id: "closed", label: "Cerrados" },
];

const MANUAL_ITEM_TYPES = [
  { id: "appointment", label: "Citas" },
  { id: "document", label: "Documentos" },
  { id: "medication", label: "Medicamentos" },
];

function getEpisodeStatusLabel(status) {
  return EPISODE_STATUS_LABELS[String(status || "").toLowerCase()] || "En curso";
}

function getEpisodeTypeLabel(type) {
  return EPISODE_TYPE_LABELS[String(type || "").toLowerCase()] || "Proceso de salud";
}

function getEpisodeTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "completed" || normalized === "closed" || normalized === "resolved") return "closed";
  if (normalized === "pending" || normalized === "paused") return "attention";
  return "active";
}

function getEpisodeSearchValue(episode) {
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

function getProfileLabel(selectedProfileId, profiles, activeProfile) {
  if (selectedProfileId === "active") {
    return cleanUiText(activeProfile?.full_name || activeProfile?.name, "perfil activo");
  }
  const found = ensureArray(profiles).find((item) => String(item.id) === String(selectedProfileId));
  return cleanUiText(found?.full_name || found?.name, "perfil");
}

function getEpisodeNextStep(episode, detail) {
  const pendingTasks = ensureArray(detail?.tasks).filter((task) => task.status !== "completed");
  if (pendingTasks[0]?.title) {
    return cleanUiText(pendingTasks[0].title, "Tienes una acción pendiente en este proceso.");
  }
  if (episode.next_due_at) {
    return `Revisar antes del ${toLocaleDateOrEmpty(episode.next_due_at)}.`;
  }
  if (episode.linked_medications) {
    return "El tratamiento ya quedó vinculado a este proceso.";
  }
  return "No hay un próximo paso pendiente registrado.";
}

function getEpisodeCountsLine(episode) {
  const parts = [];
  if (episode.linked_appointments) parts.push(`${episode.linked_appointments} cita${episode.linked_appointments === 1 ? "" : "s"}`);
  if (episode.linked_documents) parts.push(`${episode.linked_documents} documento${episode.linked_documents === 1 ? "" : "s"}`);
  if (episode.linked_medications) parts.push(`${episode.linked_medications} tratamiento${episode.linked_medications === 1 ? "" : "s"}`);
  if (episode.linked_external_records) {
    parts.push(`${episode.linked_external_records} resultado${episode.linked_external_records === 1 ? "" : "s"}`);
  }
  return parts.length ? parts.join(" · ") : "Sin elementos relacionados todavía.";
}

function getEpisodePendingLabel(episode) {
  if (!episode.pending_tasks) return "Sin pendientes";
  return `${episode.pending_tasks} pendiente${episode.pending_tasks === 1 ? "" : "s"}`;
}

function getTaskTone(task) {
  if (String(task?.status || "").toLowerCase() === "completed") return "done";
  return "pending";
}

function getTaskLine(task) {
  if (task?.description) return cleanUiText(task.description);
  if (task?.due_at) return `Hacer antes del ${toLocaleDateOrEmpty(task.due_at)}`;
  return "Sin detalle adicional.";
}

function getTimelineLabel(event) {
  return cleanUiText(event.title, "Evento clínico");
}

function getTimelineMeta(event) {
  return event?.event_at ? toLocaleDateTimeOrEmpty(event.event_at) : "Fecha no informada";
}

function getItemPreview(kind, item) {
  if (kind === "appointments") {
    return {
      title: cleanUiText(item.specialty || item.type, "Cita médica"),
      meta: [cleanUiText(item.status), toLocaleDateTimeOrEmpty(item.date_time)].filter(Boolean).join(" · "),
    };
  }
  if (kind === "documents") {
    return {
      title: cleanUiText(item.filename, "Documento clínico"),
      meta: [cleanUiText(item.doc_type), toLocaleDateOrEmpty(item.date)].filter(Boolean).join(" · "),
    };
  }
  if (kind === "medications") {
    return {
      title: cleanUiText(item.name, "Medicamento"),
      meta: [cleanUiText(item.dose), cleanUiText(item.frequency)].filter(Boolean).join(" · "),
    };
  }
  return {
    title: cleanUiText(item.title, "Resultado"),
    meta: toLocaleDateTimeOrEmpty(item.event_at),
  };
}

function RelatedGroup({ label, count, items, kind }) {
  const safeItems = ensureArray(items);
  const preview = safeItems.slice(0, 2);
  return (
    <div className="history-episode-related-group">
      <div className="history-episode-related-head">
        <strong>{label}</strong>
        <span>{count}</span>
      </div>
      {preview.length ? (
        <div className="history-episode-related-items">
          {preview.map((item) => {
            const view = getItemPreview(kind, item);
            return (
              <div key={`${kind}-${item.id}`} className="history-episode-related-item">
                <strong>{view.title}</strong>
                <p>{view.meta || "Sin detalle adicional"}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="history-episode-empty-note">Nada vinculado todavía.</p>
      )}
    </div>
  );
}

function buildManualCandidates({ appointments, documents, medications, currentEpisodeId, episodesById }) {
  const appointmentItems = ensureArray(appointments)
    .filter((item) => item.episode_id !== currentEpisodeId)
    .map((item) => ({
      id: item.id,
      type: "appointment",
      currentEpisodeId: item.episode_id || null,
      label: cleanUiText(item.specialty || item.type, "Cita médica"),
      meta: [cleanUiText(item.status), toLocaleDateTimeOrEmpty(item.date_time)].filter(Boolean).join(" · "),
    }));

  const documentItems = ensureArray(documents)
    .filter((item) => item.episode_id !== currentEpisodeId)
    .map((item) => ({
      id: item.id,
      type: "document",
      currentEpisodeId: item.episode_id || null,
      label: cleanUiText(item.filename, "Documento clínico"),
      meta: [cleanUiText(item.doc_type), toLocaleDateOrEmpty(item.date)].filter(Boolean).join(" · "),
    }));

  const medicationItems = ensureArray(medications)
    .filter((item) => item.episode_id !== currentEpisodeId)
    .map((item) => ({
      id: item.id,
      type: "medication",
      currentEpisodeId: item.episode_id || null,
      label: cleanUiText(item.name, "Medicamento"),
      meta: [cleanUiText(item.dose), cleanUiText(item.frequency)].filter(Boolean).join(" · "),
    }));

  return [...appointmentItems, ...documentItems, ...medicationItems]
    .map((item) => ({
      ...item,
      currentEpisodeLabel: item.currentEpisodeId
        ? cleanUiText(episodesById[item.currentEpisodeId]?.title, "Otro proceso")
        : "Sin proceso asignado",
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
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
  const [refreshTick, setRefreshTick] = useState(0);
  const [manualLinker, setManualLinker] = useState({
    episodeId: null,
    loading: false,
    saving: false,
    type: "appointment",
    itemId: "",
    items: [],
    message: "",
  });

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
        setEpisodeDetails({});
        setLegacyTimeline(legacyData || { summary: "", events: [], event_count: 0 });
        setExpandedEpisodeId((current) => (safeEpisodes.some((item) => item.id === current) ? current : null));
        setManualLinker({
          episodeId: null,
          loading: false,
          saving: false,
          type: "appointment",
          itemId: "",
          items: [],
          message: "",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, selectedProfileId]);

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

  const episodesById = useMemo(
    () =>
      ensureArray(episodes).reduce((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {}),
    [episodes]
  );

  const filteredEpisodes = useMemo(() => {
    const searchValue = searchTerm.trim().toLowerCase();
    return ensureArray(episodes).filter((episode) => {
      const tone = getEpisodeTone(episode.status);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && tone === "active") ||
        (statusFilter === "pending" && episode.pending_tasks > 0) ||
        (statusFilter === "closed" && tone === "closed");
      const matchesSearch = !searchValue || getEpisodeSearchValue(episode).includes(searchValue);
      return matchesStatus && matchesSearch;
    });
  }, [episodes, searchTerm, statusFilter]);

  const stats = useMemo(() => {
    const safeEpisodes = ensureArray(episodes);
    return {
      total: safeEpisodes.length,
      active: safeEpisodes.filter((item) => getEpisodeTone(item.status) === "active").length,
      pending: safeEpisodes.reduce((sum, item) => sum + Number(item.pending_tasks || 0), 0),
    };
  }, [episodes]);

  const profileLabel = useMemo(
    () => getProfileLabel(selectedProfileId, profiles, activeProfile),
    [activeProfile, profiles, selectedProfileId]
  );

  const legacyEvents = useMemo(() => ensureArray(legacyTimeline.events).slice(0, 4), [legacyTimeline.events]);

  const visibleManualItems = useMemo(
    () => ensureArray(manualLinker.items).filter((item) => item.type === manualLinker.type),
    [manualLinker.items, manualLinker.type]
  );

  async function openManualLinker(episodeId) {
    if (!resolvedProfileId) return;
    if (manualLinker.episodeId === episodeId) {
      setManualLinker((current) => ({
        ...current,
        episodeId: current.episodeId === episodeId ? null : episodeId,
      }));
      return;
    }

    setManualLinker({
      episodeId,
      loading: true,
      saving: false,
      type: "appointment",
      itemId: "",
      items: [],
      message: "",
    });

    const [appointments, documents, medications] = await Promise.all([
      getAppointments({ profileId: resolvedProfileId }).catch(() => []),
      getDocuments({ profileId: resolvedProfileId }).catch(() => []),
      getMedications({ profileId: resolvedProfileId }).catch(() => []),
    ]);

    const items = buildManualCandidates({
      appointments,
      documents,
      medications,
      currentEpisodeId: episodeId,
      episodesById,
    });

    const firstType = MANUAL_ITEM_TYPES.find((group) => items.some((item) => item.type === group.id))?.id || "appointment";
    const firstItem = items.find((item) => item.type === firstType);

    setManualLinker({
      episodeId,
      loading: false,
      saving: false,
      type: firstType,
      itemId: firstItem ? String(firstItem.id) : "",
      items,
      message: items.length ? "" : "No encontramos elementos para agregar o mover a este proceso.",
    });
  }

  async function handleManualAttach(episodeId) {
    if (!resolvedProfileId || !manualLinker.itemId) return;
    setManualLinker((current) => ({ ...current, saving: true, message: "" }));
    try {
      await relinkClinicalEpisodeItem(resolvedProfileId, {
        item_type: manualLinker.type,
        item_id: Number(manualLinker.itemId),
        episode_id: episodeId,
      });
      setExpandedEpisodeId(episodeId);
      setRefreshTick((value) => value + 1);
    } catch {
      setManualLinker((current) => ({
        ...current,
        saving: false,
        message: "No pudimos mover este elemento. Intenta otra vez.",
      }));
    }
  }

  return (
    <>
      <div className="card history-episodes-hero">
        <div className="history-episodes-hero-copy">
          <span className="history-episodes-kicker">Historial</span>
          <h2 className="card-title">Procesos de salud</h2>
          <p className="muted">
            Cada tarjeta resume un mismo motivo de salud, aunque haya pasado por varias citas, documentos o tratamientos.
          </p>
          <p className="history-episodes-hero-note">
            Perfil actual: <strong>{profileLabel}</strong>
          </p>
        </div>

        <div className="history-episodes-stats is-compact">
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
              placeholder="Ejemplo: rodilla, receta, control"
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
            const pendingTasks = ensureArray(detail?.tasks).filter((task) => task.status !== "completed").slice(0, 3);
            const timelineItems = ensureArray(detail?.timeline).slice().reverse().slice(0, 4);
            const manualOpen = manualLinker.episodeId === episode.id;

            return (
              <article key={episode.id} className={`card history-episode-card is-compact tone-${tone}`}>
                <div className="history-episode-card-head">
                  <div className="history-episode-eyebrow">
                    <span className="history-episode-type">{getEpisodeTypeLabel(episode.episode_type)}</span>
                    <span className={`history-episode-status tone-${tone}`}>{getEpisodeStatusLabel(episode.status)}</span>
                  </div>
                  <button
                    className="secondary-btn history-episode-toggle"
                    onClick={() => setExpandedEpisodeId(isExpanded ? null : episode.id)}
                  >
                    {isExpanded ? "Ocultar" : "Ver"}
                  </button>
                </div>

                <h3 className="history-episode-title">{cleanUiText(episode.title, "Proceso de salud")}</h3>
                <p className="history-episode-nextline">{getEpisodeNextStep(episode, detail)}</p>

                <div className="history-episode-inline-meta">
                  <span>{getEpisodeCountsLine(episode)}</span>
                  <span>{getEpisodePendingLabel(episode)}</span>
                  <span>{episode.last_activity_at ? `Último cambio ${toLocaleDateOrEmpty(episode.last_activity_at)}` : "Sin fecha registrada"}</span>
                </div>

                {isExpanded ? (
                  <div className="history-episode-detail">
                    {loadingDetailId === episode.id && !detail ? (
                      <div className="history-episode-empty">Cargando este proceso...</div>
                    ) : (
                      <>
                        <div className="history-episode-summary-band">
                          <strong>Resumen simple</strong>
                          <p>
                            {cleanUiText(
                              episode.care_summary || episode.summary,
                              "Este proceso reúne la atención, sus documentos y los pasos pendientes."
                            )}
                          </p>
                        </div>

                        <div className="history-episode-detail-grid compact-grid">
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
                                      <p>{getTaskLine(task)}</p>
                                    </div>
                                  </article>
                                ))}
                              </div>
                            ) : (
                              <p className="history-episode-empty-note">No hay tareas pendientes en este proceso.</p>
                            )}
                          </section>

                          <section className="history-episode-panel">
                            <div className="history-episode-panel-head">
                              <h4>Actividad reciente</h4>
                              <span>{ensureArray(detail?.timeline).length}</span>
                            </div>
                            {timelineItems.length ? (
                              <div className="history-episode-timeline">
                                {timelineItems.map((event, index) => (
                                  <article
                                    key={`${episode.id}-${event.source_record_type}-${event.source_record_id}-${index}`}
                                    className="history-episode-timeline-item"
                                  >
                                    <div className="history-episode-timeline-dot" />
                                    <div>
                                      <strong>{getTimelineLabel(event)}</strong>
                                      <p>{cleanUiText(event.summary, "Sin detalle adicional")}</p>
                                      <span>{getTimelineMeta(event)}</span>
                                    </div>
                                  </article>
                                ))}
                              </div>
                            ) : (
                              <p className="history-episode-empty-note">Aún no hay eventos visibles dentro de este proceso.</p>
                            )}
                          </section>

                          <section className="history-episode-panel history-episode-panel-wide">
                            <div className="history-episode-panel-head">
                              <h4>Elementos del proceso</h4>
                              <span>{getEpisodePendingLabel(episode)}</span>
                            </div>
                            <div className="history-episode-related-grid compact-related">
                              <RelatedGroup
                                label="Citas"
                                count={episode.linked_appointments || 0}
                                items={detail?.related_items?.appointments}
                                kind="appointments"
                              />
                              <RelatedGroup
                                label="Documentos"
                                count={episode.linked_documents || 0}
                                items={detail?.related_items?.documents}
                                kind="documents"
                              />
                              <RelatedGroup
                                label="Medicamentos"
                                count={episode.linked_medications || 0}
                                items={detail?.related_items?.medications}
                                kind="medications"
                              />
                              <RelatedGroup
                                label="Resultados"
                                count={episode.linked_external_records || 0}
                                items={detail?.related_items?.external_records}
                                kind="external_records"
                              />
                            </div>
                          </section>

                          <section className="history-episode-panel history-episode-panel-wide">
                            <div className="history-episode-panel-head">
                              <h4>Ajustar manualmente</h4>
                              <button className="secondary-btn history-manual-toggle" onClick={() => openManualLinker(episode.id)}>
                                {manualOpen ? "Ocultar" : "Agregar o mover"}
                              </button>
                            </div>
                            <p className="history-episode-helper">
                              Si algo quedó fuera o en otro proceso, puedes corregirlo aquí sin depender solo de la IA.
                            </p>

                            {manualOpen ? (
                              manualLinker.loading ? (
                                <div className="history-episode-empty">Buscando citas, documentos y medicamentos...</div>
                              ) : (
                                <div className="history-manual-linker">
                                  <div className="history-manual-linker-grid">
                                    <div className="input-group">
                                      <label className="input-label">Tipo</label>
                                      <select
                                        className="input-field"
                                        value={manualLinker.type}
                                        onChange={(e) =>
                                          setManualLinker((current) => {
                                            const nextType = e.target.value;
                                            const nextItem = ensureArray(current.items).find((item) => item.type === nextType);
                                            return {
                                              ...current,
                                              type: nextType,
                                              itemId: nextItem ? String(nextItem.id) : "",
                                              message: "",
                                            };
                                          })
                                        }
                                      >
                                        {MANUAL_ITEM_TYPES.map((item) => (
                                          <option key={item.id} value={item.id}>
                                            {item.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    <div className="input-group">
                                      <label className="input-label">Elemento</label>
                                      <select
                                        className="input-field"
                                        value={manualLinker.itemId}
                                        onChange={(e) =>
                                          setManualLinker((current) => ({ ...current, itemId: e.target.value, message: "" }))
                                        }
                                      >
                                        {!visibleManualItems.length ? <option value="">No hay elementos disponibles</option> : null}
                                        {visibleManualItems.map((item) => (
                                          <option key={`${item.type}-${item.id}`} value={item.id}>
                                            {item.label} · {item.currentEpisodeLabel}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>

                                  {manualLinker.itemId ? (
                                    <div className="history-manual-preview">
                                      {(() => {
                                        const selectedItem = visibleManualItems.find(
                                          (item) => String(item.id) === String(manualLinker.itemId)
                                        );
                                        if (!selectedItem) return null;
                                        return (
                                          <>
                                            <strong>{selectedItem.label}</strong>
                                            <p>{selectedItem.meta || "Sin detalle adicional"}</p>
                                            <span>Estado actual: {selectedItem.currentEpisodeLabel}</span>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  ) : null}

                                  <div className="history-manual-actions">
                                    <button
                                      className="primary-btn"
                                      disabled={!manualLinker.itemId || manualLinker.saving}
                                      onClick={() => handleManualAttach(episode.id)}
                                    >
                                      {manualLinker.saving ? "Guardando..." : "Asignar a este proceso"}
                                    </button>
                                  </div>

                                  {manualLinker.message ? <p className="history-manual-message">{manualLinker.message}</p> : null}
                                </div>
                              )
                            ) : null}
                          </section>
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
              Seguimos conectando las atenciones que pertenecen al mismo motivo de salud. Mientras tanto, abajo verás la
              actividad reciente.
            </p>
          </div>

          <div className="card history-legacy-card is-compact">
            <div className="history-legacy-head">
              <div>
                <span className="history-episodes-kicker">Vista temporal</span>
                <h3>Actividad reciente</h3>
              </div>
              <span>{legacyTimeline.event_count || legacyEvents.length} evento(s)</span>
            </div>

            {legacyEvents.length ? (
              <div className="history-legacy-list">
                {legacyEvents.map((item, index) => (
                  <article key={`${item.id || item.source_record_id || index}-${index}`} className="history-legacy-item">
                    <strong>{cleanUiText(item.title, "Evento clínico")}</strong>
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
