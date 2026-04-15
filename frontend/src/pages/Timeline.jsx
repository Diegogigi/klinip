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

function getEpisodeLead(episode, detail) {
  const pendingTask = ensureArray(detail?.tasks).find((task) => task.status !== "completed");
  if (pendingTask?.title) return cleanUiText(pendingTask.title, "Tienes una acción pendiente en este proceso.");
  const summary = cleanUiText(episode.care_summary || episode.summary, "");
  if (summary) return summary;
  return "Este proceso reúne la atención, sus documentos y los pasos siguientes.";
}

function getEpisodeCountsLine(episode) {
  const parts = [];
  if (episode.linked_appointments) parts.push(`${episode.linked_appointments} cita${episode.linked_appointments === 1 ? "" : "s"}`);
  if (episode.linked_documents) parts.push(`${episode.linked_documents} documento${episode.linked_documents === 1 ? "" : "s"}`);
  if (episode.linked_medications) {
    parts.push(`${episode.linked_medications} medicamento${episode.linked_medications === 1 ? "" : "s"}`);
  }
  if (episode.linked_external_records) {
    parts.push(`${episode.linked_external_records} resultado${episode.linked_external_records === 1 ? "" : "s"}`);
  }
  return parts.length ? parts.join(" / ") : "Todavía no hay elementos agrupados";
}

function getPendingLabel(episode) {
  if (!episode.pending_tasks) return "Sin pendientes";
  return `${episode.pending_tasks} pendiente${episode.pending_tasks === 1 ? "" : "s"}`;
}

function getTaskLabel(task) {
  if (task?.description) return cleanUiText(task.description);
  if (task?.due_at) return `Resolver antes del ${toLocaleDateOrEmpty(task.due_at)}`;
  return "Sin detalle adicional";
}

function getLastActivityLabel(value) {
  if (!value) return "Sin fecha registrada";
  return `Último cambio ${toLocaleDateOrEmpty(value)}`;
}

function getPreviewItem(kind, item) {
  if (kind === "appointments") {
    return {
      title: cleanUiText(item.specialty || item.type, "Cita médica"),
      meta: [cleanUiText(item.status), toLocaleDateTimeOrEmpty(item.date_time)].filter(Boolean).join(" / "),
    };
  }
  if (kind === "documents") {
    return {
      title: cleanUiText(item.filename, "Documento clínico"),
      meta: [cleanUiText(item.doc_type), toLocaleDateOrEmpty(item.date)].filter(Boolean).join(" / "),
    };
  }
  if (kind === "medications") {
    return {
      title: cleanUiText(item.name, "Medicamento"),
      meta: [cleanUiText(item.dose), cleanUiText(item.frequency)].filter(Boolean).join(" / "),
    };
  }
  return {
    title: cleanUiText(item.title, "Resultado"),
    meta: toLocaleDateTimeOrEmpty(item.event_at),
  };
}

function buildRelatedPreview(label, count, items, kind) {
  const previewItems = ensureArray(items).slice(0, 2).map((item) => getPreviewItem(kind, item));
  return {
    label,
    count,
    preview:
      previewItems.length > 0
        ? previewItems.map((item) => `${item.title}${item.meta ? ` (${item.meta})` : ""}`).join(" · ")
        : "Nada vinculado todavía.",
  };
}

function buildManualCandidates({ appointments, documents, medications, currentEpisodeId, episodesById }) {
  const appointmentItems = ensureArray(appointments)
    .filter((item) => item.episode_id !== currentEpisodeId)
    .map((item) => ({
      id: item.id,
      type: "appointment",
      currentEpisodeId: item.episode_id || null,
      label: cleanUiText(item.specialty || item.type, "Cita médica"),
      meta: [cleanUiText(item.status), toLocaleDateTimeOrEmpty(item.date_time)].filter(Boolean).join(" / "),
    }));

  const documentItems = ensureArray(documents)
    .filter((item) => item.episode_id !== currentEpisodeId)
    .map((item) => ({
      id: item.id,
      type: "document",
      currentEpisodeId: item.episode_id || null,
      label: cleanUiText(item.filename, "Documento clínico"),
      meta: [cleanUiText(item.doc_type), toLocaleDateOrEmpty(item.date)].filter(Boolean).join(" / "),
    }));

  const medicationItems = ensureArray(medications)
    .filter((item) => item.episode_id !== currentEpisodeId)
    .map((item) => ({
      id: item.id,
      type: "medication",
      currentEpisodeId: item.episode_id || null,
      label: cleanUiText(item.name, "Medicamento"),
      meta: [cleanUiText(item.dose), cleanUiText(item.frequency)].filter(Boolean).join(" / "),
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
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(null);
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
        setSelectedEpisodeId((current) => (safeEpisodes.some((item) => item.id === current) ? current : safeEpisodes[0]?.id || null));
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

  useEffect(() => {
    if (!filteredEpisodes.length) {
      setSelectedEpisodeId(null);
      return;
    }
    if (!filteredEpisodes.some((item) => item.id === selectedEpisodeId)) {
      setSelectedEpisodeId(filteredEpisodes[0].id);
    }
  }, [filteredEpisodes, selectedEpisodeId]);

  useEffect(() => {
    let cancelled = false;
    const loadDetail = async () => {
      if (!resolvedProfileId || !selectedEpisodeId || episodeDetails[selectedEpisodeId]) return;
      setLoadingDetailId(selectedEpisodeId);
      try {
        const detail = await getClinicalEpisodeDetail(resolvedProfileId, selectedEpisodeId).catch(() => null);
        if (cancelled || !detail) return;
        setEpisodeDetails((current) => ({
          ...current,
          [selectedEpisodeId]: detail,
        }));
      } finally {
        if (!cancelled) setLoadingDetailId(null);
      }
    };
    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [episodeDetails, resolvedProfileId, selectedEpisodeId]);

  const summaryCounts = useMemo(() => {
    const safeEpisodes = ensureArray(episodes);
    return {
      total: safeEpisodes.length,
      active: safeEpisodes.filter((item) => getEpisodeTone(item.status) === "active").length,
      pending: safeEpisodes.reduce((sum, item) => sum + Number(item.pending_tasks || 0), 0),
      closed: safeEpisodes.filter((item) => getEpisodeTone(item.status) === "closed").length,
    };
  }, [episodes]);

  const profileLabel = useMemo(
    () => getProfileLabel(selectedProfileId, profiles, activeProfile),
    [activeProfile, profiles, selectedProfileId]
  );

  const legacyEvents = useMemo(() => ensureArray(legacyTimeline.events).slice(0, 4), [legacyTimeline.events]);

  const selectedEpisode = useMemo(
    () => filteredEpisodes.find((item) => item.id === selectedEpisodeId) || null,
    [filteredEpisodes, selectedEpisodeId]
  );

  const selectedDetail = selectedEpisode ? episodeDetails[selectedEpisode.id] : null;

  const selectedPendingTasks = useMemo(
    () => ensureArray(selectedDetail?.tasks).filter((task) => task.status !== "completed").slice(0, 3),
    [selectedDetail]
  );

  const selectedTimelineItems = useMemo(
    () => ensureArray(selectedDetail?.timeline).slice().reverse().slice(0, 4),
    [selectedDetail]
  );

  const selectedRelatedItems = useMemo(() => {
    if (!selectedEpisode) return [];
    return [
      buildRelatedPreview("Citas", selectedEpisode.linked_appointments || 0, selectedDetail?.related_items?.appointments, "appointments"),
      buildRelatedPreview("Documentos", selectedEpisode.linked_documents || 0, selectedDetail?.related_items?.documents, "documents"),
      buildRelatedPreview(
        "Medicamentos",
        selectedEpisode.linked_medications || 0,
        selectedDetail?.related_items?.medications,
        "medications"
      ),
      buildRelatedPreview(
        "Resultados",
        selectedEpisode.linked_external_records || 0,
        selectedDetail?.related_items?.external_records,
        "external_records"
      ),
    ];
  }, [selectedDetail, selectedEpisode]);

  const visibleManualItems = useMemo(
    () => ensureArray(manualLinker.items).filter((item) => item.type === manualLinker.type),
    [manualLinker.items, manualLinker.type]
  );

  const selectedManualItem = useMemo(
    () => visibleManualItems.find((item) => String(item.id) === String(manualLinker.itemId)) || null,
    [manualLinker.itemId, visibleManualItems]
  );

  async function openManualLinker(episodeId) {
    if (!resolvedProfileId) return;
    if (manualLinker.episodeId === episodeId) {
      setManualLinker((current) => ({ ...current, episodeId: null, message: "" }));
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
      message: items.length ? "" : "No encontramos elementos disponibles para mover a este proceso.",
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
      <section className="history-process-header">
        <div>
          <span className="history-process-kicker">Historial</span>
          <h1 className="history-process-title">Procesos de salud</h1>
          <p className="history-process-subtitle">
            Tu historial se ordena por motivo de salud para que entiendas qué pasó, qué falta y qué se relaciona entre sí.
          </p>
        </div>

        <div className="history-process-summarybar" aria-label="Resumen del historial">
          <div className="history-process-summaryitem">
            <strong>{summaryCounts.active}</strong>
            <span>activos</span>
          </div>
          <div className="history-process-summaryitem">
            <strong>{summaryCounts.pending}</strong>
            <span>pendientes</span>
          </div>
          <div className="history-process-summaryitem">
            <strong>{summaryCounts.closed}</strong>
            <span>cerrados</span>
          </div>
        </div>
      </section>

      <div className="card history-process-shell">
        <div className="history-process-toolbar">
          <div className="history-process-toolbar-grid">
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
              <label className="input-label">Buscar</label>
              <input
                type="text"
                className="input-field"
                placeholder="Ejemplo: rodilla, receta o control"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="history-process-toolbar-bottom">
            <p className="history-process-toolbar-note">
              {filteredEpisodes.length} procesos visibles para {profileLabel}.
            </p>
            <div className="history-process-filters" role="tablist" aria-label="Filtrar procesos">
              {STATUS_FILTERS.map((item) => (
                <button
                  key={item.id}
                  className={`${statusFilter === item.id ? "primary-btn" : "secondary-btn"} history-process-filter-btn`}
                  onClick={() => setStatusFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="history-process-empty">Estamos organizando tu historial por procesos de salud...</div>
        ) : filteredEpisodes.length ? (
          <div className="history-process-layout">
            <aside className="history-process-rail">
              <div className="history-process-rail-head">
                <strong>Procesos</strong>
                <span>Selecciona uno para revisar solo lo importante.</span>
              </div>

              <div className="history-process-list" role="list">
                {filteredEpisodes.map((episode) => {
                  const detail = episodeDetails[episode.id];
                  const tone = getEpisodeTone(episode.status);
                  const isSelected = selectedEpisodeId === episode.id;
                  return (
                    <button
                      key={episode.id}
                      type="button"
                      className={`history-process-item tone-${tone} ${isSelected ? "is-selected" : ""}`}
                      onClick={() => setSelectedEpisodeId(episode.id)}
                    >
                      <span className={`history-process-item-bar tone-${tone}`} />
                      <div className="history-process-item-body">
                        <div className="history-process-item-head">
                          <span className="history-process-item-type">{getEpisodeTypeLabel(episode.episode_type)}</span>
                          <span className={`history-process-item-status tone-${tone}`}>{getEpisodeStatusLabel(episode.status)}</span>
                        </div>
                        <strong className="history-process-item-title">
                          {cleanUiText(episode.title, "Proceso de salud")}
                        </strong>
                        <p className="history-process-item-next">{getEpisodeLead(episode, detail)}</p>
                        <div className="history-process-item-meta">
                          <span>{getPendingLabel(episode)}</span>
                          <span>{getLastActivityLabel(episode.last_activity_at)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="history-process-panel">
              {selectedEpisode ? (
                <>
                  <div className="history-process-panel-head">
                    <div className="history-process-panel-copy">
                      <span className="history-process-panel-kicker">{getEpisodeTypeLabel(selectedEpisode.episode_type)}</span>
                      <h2>{cleanUiText(selectedEpisode.title, "Proceso de salud")}</h2>
                      <p>{getEpisodeLead(selectedEpisode, selectedDetail)}</p>
                    </div>

                    <div className="history-process-panel-actions">
                      <button className="primary-btn history-process-inline-btn" onClick={() => openManualLinker(selectedEpisode.id)}>
                        {manualLinker.episodeId === selectedEpisode.id ? "Ocultar organización" : "Organizar proceso"}
                      </button>
                    </div>
                  </div>

                  <div className="history-process-spotlight">
                    <div className="history-process-spotlight-item">
                      <span>Próximo paso</span>
                      <strong>
                        {selectedPendingTasks[0]
                          ? cleanUiText(selectedPendingTasks[0].title, "Hay una acción pendiente.")
                          : "No hay pendientes por ahora"}
                      </strong>
                      <p>
                        {selectedPendingTasks[0]
                          ? getTaskLabel(selectedPendingTasks[0])
                          : "Este proceso está al día con la información registrada."}
                      </p>
                    </div>

                    <div className="history-process-spotlight-item">
                      <span>Incluye</span>
                      <strong>{getEpisodeCountsLine(selectedEpisode)}</strong>
                      <p>{getPendingLabel(selectedEpisode)}</p>
                    </div>

                    <div className="history-process-spotlight-item">
                      <span>Último movimiento</span>
                      <strong>{getLastActivityLabel(selectedEpisode.last_activity_at)}</strong>
                      <p>{cleanUiText(selectedEpisode.care_summary || selectedEpisode.summary, "Sin resumen adicional.")}</p>
                    </div>
                  </div>

                  {loadingDetailId === selectedEpisode.id && !selectedDetail ? (
                    <div className="history-process-empty">Cargando este proceso...</div>
                  ) : (
                    <>
                      <section className="history-process-section">
                        <div className="history-process-section-head">
                          <h3>Qué falta ahora</h3>
                          <span>{selectedPendingTasks.length ? `${selectedPendingTasks.length} pendiente(s)` : "Al día"}</span>
                        </div>

                        {selectedPendingTasks.length ? (
                          <div className="history-process-line-list">
                            {selectedPendingTasks.map((task) => (
                              <div key={task.id} className="history-process-line-row">
                                <div>
                                  <strong>{cleanUiText(task.title, "Pendiente clínico")}</strong>
                                  <p>{getTaskLabel(task)}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="history-process-note">No hay pasos pendientes registrados para este proceso.</p>
                        )}
                      </section>

                      <section className="history-process-section">
                        <div className="history-process-section-head">
                          <h3>Qué ya está dentro</h3>
                          <span>Resumen rápido</span>
                        </div>

                        <div className="history-process-related-list">
                          {selectedRelatedItems.map((item) => (
                            <div key={item.label} className="history-process-related-row">
                              <div className="history-process-related-head">
                                <strong>{item.label}</strong>
                                <span>{item.count}</span>
                              </div>
                              <p>{item.preview}</p>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="history-process-section">
                        <div className="history-process-section-head">
                          <h3>Últimos movimientos</h3>
                          <span>{selectedTimelineItems.length} evento(s)</span>
                        </div>

                        {selectedTimelineItems.length ? (
                          <div className="history-process-line-list">
                            {selectedTimelineItems.map((event, index) => (
                              <div
                                key={`${selectedEpisode.id}-${event.source_record_type}-${event.source_record_id}-${index}`}
                                className="history-process-line-row"
                              >
                                <div>
                                  <strong>{cleanUiText(event.title, "Evento clínico")}</strong>
                                  <p>{cleanUiText(event.summary, "Sin detalle adicional")}</p>
                                </div>
                                <span>{event.event_at ? toLocaleDateTimeOrEmpty(event.event_at) : "Fecha no informada"}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="history-process-note">Todavía no hay movimientos visibles en este proceso.</p>
                        )}
                      </section>

                      <section className="history-process-section">
                        <div className="history-process-section-head">
                          <h3>Corregir agrupación</h3>
                          <span>Ayuda a completar este proceso</span>
                        </div>

                        <div className="history-process-manual-intro">
                          <p>
                            Si una cita, un documento o un medicamento quedó fuera, puedes moverlo manualmente a este
                            proceso.
                          </p>
                          <button className="secondary-btn history-process-inline-btn" onClick={() => openManualLinker(selectedEpisode.id)}>
                            {manualLinker.episodeId === selectedEpisode.id ? "Ocultar formulario" : "Agregar o mover elemento"}
                          </button>
                        </div>

                        {manualLinker.episodeId === selectedEpisode.id ? (
                          manualLinker.loading ? (
                            <div className="history-process-empty">Buscando citas, documentos y medicamentos...</div>
                          ) : (
                            <div className="history-process-manual">
                              <div className="history-process-manual-grid">
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
                                    onChange={(e) => setManualLinker((current) => ({ ...current, itemId: e.target.value, message: "" }))}
                                  >
                                    {!visibleManualItems.length ? <option value="">No hay elementos disponibles</option> : null}
                                    {visibleManualItems.map((item) => (
                                      <option key={`${item.type}-${item.id}`} value={item.id}>
                                        {item.label} / {item.currentEpisodeLabel}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              {selectedManualItem ? (
                                <div className="history-process-manual-preview">
                                  <strong>{selectedManualItem.label}</strong>
                                  <p>{selectedManualItem.meta || "Sin detalle adicional"}</p>
                                  <span>Ahora está en: {selectedManualItem.currentEpisodeLabel}</span>
                                </div>
                              ) : null}

                              <div className="history-process-manual-actions">
                                <button
                                  className="primary-btn"
                                  disabled={!manualLinker.itemId || manualLinker.saving}
                                  onClick={() => handleManualAttach(selectedEpisode.id)}
                                >
                                  {manualLinker.saving ? "Guardando..." : "Asignar a este proceso"}
                                </button>
                              </div>

                              {manualLinker.message ? <p className="history-process-note">{manualLinker.message}</p> : null}
                            </div>
                          )
                        ) : null}
                      </section>
                    </>
                  )}
                </>
              ) : (
                <div className="history-process-empty">Selecciona un proceso para ver su resumen y sus acciones.</div>
              )}
            </section>
          </div>
        ) : episodes.length ? (
          <div className="history-process-empty-zone">
            <div className="history-process-empty">
              No encontramos procesos con este filtro. Prueba cambiar el filtro o borrar la búsqueda.
            </div>

            <div className="history-process-empty-actions">
              <button className="secondary-btn history-process-inline-btn" onClick={() => setStatusFilter("all")}>
                Ver todos
              </button>
              <button className="secondary-btn history-process-inline-btn" onClick={() => setSearchTerm("")}>
                Limpiar búsqueda
              </button>
            </div>
          </div>
        ) : (
          <div className="history-process-empty-zone">
            <div className="history-process-empty">
              No encontramos procesos agrupados para este perfil. Seguimos conectando tus atenciones para que se entiendan mejor.
            </div>

            <div className="history-process-legacy">
              <div className="history-process-legacy-head">
                <strong>Actividad reciente</strong>
                <span>{legacyTimeline.event_count || legacyEvents.length} evento(s)</span>
              </div>
              {legacyEvents.length ? (
                <div className="history-process-line-list">
                  {legacyEvents.map((item, index) => (
                    <div key={`${item.id || item.source_record_id || index}-${index}`} className="history-process-line-row">
                      <div>
                        <strong>{cleanUiText(item.title, "Evento clínico")}</strong>
                        <p>{cleanUiText(item.summary, "Sin detalle adicional")}</p>
                      </div>
                      <span>{item.event_at ? toLocaleDateTimeOrEmpty(item.event_at) : "Fecha no informada"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="history-process-note">Todavía no hay eventos clínicos para mostrar.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
