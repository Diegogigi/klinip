import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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

const FOLDER_ITEM_TYPE_LABELS = {
  appointment: "Cita",
  document: "Documento",
  medication: "Medicamento",
  external_record: "Resultado",
};

function getEpisodeStatusLabel(status) {
  return EPISODE_STATUS_LABELS[String(status || "").toLowerCase()] || "En curso";
}

function getEpisodeTypeLabel(type) {
  return EPISODE_TYPE_LABELS[String(type || "").toLowerCase()] || "Carpeta clínica";
}

function getFolderItemTypeLabel(type) {
  return FOLDER_ITEM_TYPE_LABELS[String(type || "").toLowerCase()] || "Elemento";
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
  if (pendingTask?.title) return cleanUiText(pendingTask.title, "Tienes una acción pendiente en esta carpeta.");
  const summary = cleanUiText(episode.care_summary || episode.summary, "");
  if (summary) return summary;
  return "Esta carpeta reúne la atención, sus documentos y los pasos siguientes.";
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

function getTaskAction(task) {
  const text = `${cleanUiText(task?.title)} ${cleanUiText(task?.description)}`.toLowerCase();
  if (!text) return null;
  if (/(medic|toma|tratamiento|pastilla|dosis|farmac)/.test(text)) {
    return { label: "Ir a medicamentos", to: "/medications" };
  }
  if (/(document|receta|informe|resultado|archivo|orden)/.test(text)) {
    return { label: "Ir a documentos", to: "/documents" };
  }
  if (/(examen|laboratorio|agenda|agendar|fecha)/.test(text)) {
    return { label: "Ir al calendario", to: "/calendar" };
  }
  if (/(cita|control|consulta|doctor|especial|medic[o|a])/i.test(text)) {
    return { label: "Ir a citas", to: "/appointments" };
  }
  return null;
}

function getFolderItemAction(itemType) {
  const normalized = String(itemType || "").toLowerCase();
  if (normalized === "appointment") return { label: "Ir a citas", to: "/appointments" };
  if (normalized === "document") return { label: "Ir a documentos", to: "/documents" };
  if (normalized === "medication") return { label: "Ir a medicamentos", to: "/medications" };
  if (normalized === "external_record") return { label: "Ir a documentos", to: "/documents" };
  return null;
}

function getFolderItemKey(item) {
  return `${item.item_type}-${item.item_id}`;
}

function findFolderRecord(detail, item) {
  if (!item || !detail?.related_items) return null;
  const itemId = Number(item.item_id);
  if (item.item_type === "appointment") {
    return ensureArray(detail.related_items.appointments).find((current) => Number(current.id) === itemId) || null;
  }
  if (item.item_type === "document") {
    return ensureArray(detail.related_items.documents).find((current) => Number(current.id) === itemId) || null;
  }
  if (item.item_type === "medication") {
    return ensureArray(detail.related_items.medications).find((current) => Number(current.id) === itemId) || null;
  }
  if (item.item_type === "external_record") {
    return ensureArray(detail.related_items.external_records).find((current) => Number(current.id) === itemId) || null;
  }
  return null;
}

function getFolderItemDescription(item, record) {
  if (item?.item_type === "appointment") {
    return cleanUiText(record?.notes || item?.subtitle, "Sin detalle adicional.");
  }
  if (item?.item_type === "document") {
    return cleanUiText(record?.notes || item?.subtitle, "Documento asociado a esta carpeta.");
  }
  if (item?.item_type === "medication") {
    return cleanUiText(record?.notes || item?.subtitle, "Tratamiento asociado a esta carpeta.");
  }
  if (item?.item_type === "external_record") {
    return cleanUiText(record?.summary || item?.subtitle, "Resultado asociado a esta carpeta.");
  }
  return cleanUiText(item?.subtitle, "Sin detalle adicional.");
}

function buildFolderItemDetails(item, record) {
  if (!item) return [];
  if (item.item_type === "appointment") {
    return [
      { label: "Tipo", value: cleanUiText(record?.specialty || record?.type, "Cita médica") },
      { label: "Fecha", value: record?.date_time ? toLocaleDateTimeOrEmpty(record.date_time) : "Fecha no informada" },
      { label: "Centro", value: cleanUiText(record?.center, "Sin centro informado") },
      { label: "Estado", value: cleanUiText(record?.status, cleanUiText(item.status_label, "Sin estado")) },
    ];
  }
  if (item.item_type === "document") {
    return [
      { label: "Tipo", value: cleanUiText(record?.doc_type, cleanUiText(item.status_label, "Documento clínico")) },
      { label: "Fecha", value: record?.date ? toLocaleDateOrEmpty(record.date) : "Fecha no informada" },
      { label: "Centro", value: cleanUiText(record?.center, "Sin centro informado") },
      { label: "Archivo", value: cleanUiText(record?.filename, cleanUiText(item.title, "Documento")) },
    ];
  }
  if (item.item_type === "medication") {
    return [
      { label: "Dosis", value: cleanUiText(record?.dose, "Sin dosis informada") },
      { label: "Frecuencia", value: cleanUiText(record?.frequency, "Sin frecuencia informada") },
      { label: "Inicio", value: record?.start_at ? toLocaleDateOrEmpty(record.start_at) : "Fecha no informada" },
      { label: "Estado", value: record?.completed ? "Finalizado" : "Activo" },
    ];
  }
  if (item.item_type === "external_record") {
    return [
      { label: "Tipo", value: cleanUiText(record?.record_type, cleanUiText(item.status_label, "Resultado")) },
      { label: "Fecha", value: record?.event_at ? toLocaleDateTimeOrEmpty(record.event_at) : "Fecha no informada" },
      { label: "Origen", value: cleanUiText(record?.title, cleanUiText(item.title, "Resultado")) },
      { label: "Resumen", value: cleanUiText(record?.summary, "Sin resumen informado") },
    ];
  }
  return [];
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
        ? cleanUiText(episodesById[item.currentEpisodeId]?.title, "Otra carpeta")
        : "Sin carpeta asignada",
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export default function Timeline() {
  const navigate = useNavigate();
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
  const [selectedFolderItemKey, setSelectedFolderItemKey] = useState("");
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
        setSelectedFolderItemKey("");
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

  const selectedEpisodeIndex = useMemo(
    () => filteredEpisodes.findIndex((item) => item.id === selectedEpisodeId),
    [filteredEpisodes, selectedEpisodeId]
  );

  const selectedFolderItems = useMemo(() => ensureArray(selectedDetail?.folder_items), [selectedDetail]);

  useEffect(() => {
    if (!selectedFolderItems.length) {
      setSelectedFolderItemKey("");
      return;
    }
    if (!selectedFolderItems.some((item) => getFolderItemKey(item) === selectedFolderItemKey)) {
      setSelectedFolderItemKey(getFolderItemKey(selectedFolderItems[0]));
    }
  }, [selectedFolderItemKey, selectedFolderItems]);

  const selectedFolderItem = useMemo(
    () => selectedFolderItems.find((item) => getFolderItemKey(item) === selectedFolderItemKey) || null,
    [selectedFolderItemKey, selectedFolderItems]
  );

  const selectedFolderRecord = useMemo(
    () => findFolderRecord(selectedDetail, selectedFolderItem),
    [selectedDetail, selectedFolderItem]
  );

  const selectedFolderItemDetails = useMemo(
    () => buildFolderItemDetails(selectedFolderItem, selectedFolderRecord),
    [selectedFolderItem, selectedFolderRecord]
  );

  const selectedFolderItemAction = useMemo(
    () => getFolderItemAction(selectedFolderItem?.item_type),
    [selectedFolderItem]
  );

  const selectedQuickActions = useMemo(() => {
    if (!selectedEpisode) return [];
    const primaryTask = selectedPendingTasks[0] || null;
    const primaryTaskAction = primaryTask ? getTaskAction(primaryTask) : null;
    const baseActions = [
      primaryTaskAction
        ? {
            id: "next",
            label: primaryTaskAction.label,
            to: primaryTaskAction.to,
            tone: "primary",
            kicker: "Siguiente paso",
            description: getTaskLabel(primaryTask),
          }
        : null,
      {
        id: "appointments",
        label: selectedEpisode.linked_appointments ? `Ver citas (${selectedEpisode.linked_appointments})` : "Ir a citas",
        to: "/appointments",
        kicker: "Citas",
        description: selectedEpisode.linked_appointments
          ? `Revisa las ${selectedEpisode.linked_appointments} cita${selectedEpisode.linked_appointments === 1 ? "" : "s"} vinculadas a esta carpeta.`
          : "Agenda controles o revisa atenciones relacionadas con esta carpeta.",
      },
      {
        id: "documents",
        label: selectedEpisode.linked_documents ? `Ver documentos (${selectedEpisode.linked_documents})` : "Ir a documentos",
        to: "/documents",
        kicker: "Documentos",
        description: selectedEpisode.linked_documents
          ? `Abre los ${selectedEpisode.linked_documents} documento${selectedEpisode.linked_documents === 1 ? "" : "s"} asociados a esta carpeta.`
          : "Consulta órdenes, informes o recetas vinculadas a esta carpeta.",
      },
      {
        id: "medications",
        label: selectedEpisode.linked_medications ? `Ver medicamentos (${selectedEpisode.linked_medications})` : "Ir a medicamentos",
        to: "/medications",
        kicker: "Medicamentos",
        description: selectedEpisode.linked_medications
          ? `Revisa los ${selectedEpisode.linked_medications} medicamento${selectedEpisode.linked_medications === 1 ? "" : "s"} relacionados.`
          : "Confirma tratamientos, dosis y seguimiento farmacológico.",
      },
      {
        id: "calendar",
        label: "Ver agenda",
        to: "/calendar",
        kicker: "Agenda",
        description: "Ordena próximas fechas, controles y recordatorios de esta carpeta.",
      },
    ].filter(Boolean);

    return baseActions.filter(
      (item, index, collection) => collection.findIndex((candidate) => candidate.to === item.to) === index
    );
  }, [selectedEpisode, selectedPendingTasks]);

  const visibleManualItems = useMemo(
    () => ensureArray(manualLinker.items).filter((item) => item.type === manualLinker.type),
    [manualLinker.items, manualLinker.type]
  );

  const selectedManualItem = useMemo(
    () => visibleManualItems.find((item) => String(item.id) === String(manualLinker.itemId)) || null,
    [manualLinker.itemId, visibleManualItems]
  );

  const selectedEpisodeTone = selectedEpisode ? getEpisodeTone(selectedEpisode.status) : "active";

  const heroPrimaryAction = useMemo(
    () => selectedQuickActions.find((item) => item.tone === "primary") || selectedQuickActions[0] || null,
    [selectedQuickActions]
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
      message: items.length ? "" : "No encontramos elementos disponibles para mover a esta carpeta.",
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

  function selectRelativeEpisode(direction) {
    if (!filteredEpisodes.length || selectedEpisodeIndex < 0) return;
    const nextIndex = selectedEpisodeIndex + direction;
    if (nextIndex < 0 || nextIndex >= filteredEpisodes.length) return;
    setSelectedEpisodeId(filteredEpisodes[nextIndex].id);
  }

  return (
    <>
      <section className={`history-process-header timeline-overview-card tone-${selectedEpisodeTone}`}>
        <div className="history-process-hero-main">
          <div className="history-process-hero-copy">
            <span className="history-process-kicker">Historia clínica</span>
            <h1 className="card-title history-process-title">Carpetas clínicas</h1>
            <p className="muted history-process-subtitle">
              Cada carpeta reúne una atención de salud y todo lo que se fue relacionando con ella en el tiempo.
            </p>
          </div>

          <div className="history-process-hero-actions">
            {heroPrimaryAction ? (
              <button type="button" className="primary-btn history-process-hero-btn" onClick={() => navigate(heroPrimaryAction.to)}>
                {heroPrimaryAction.label}
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-btn history-process-hero-btn"
              onClick={() => {
                if (selectedEpisode) {
                  openManualLinker(selectedEpisode.id);
                  return;
                }
                setStatusFilter("active");
              }}
            >
              {selectedEpisode ? "Organizar carpeta" : "Ver carpetas activas"}
            </button>
          </div>
        </div>

        <div className="history-process-hero-side">
          <div className={`history-process-hero-focus tone-${selectedEpisodeTone}`}>
            <span className={`history-process-hero-focus-pill tone-${selectedEpisodeTone}`}>
              {selectedEpisode ? getEpisodeStatusLabel(selectedEpisode.status) : `${filteredEpisodes.length} visibles`}
            </span>
            <strong>{selectedEpisode ? cleanUiText(selectedEpisode.title, "Carpeta clínica") : `Perfil: ${profileLabel}`}</strong>
            <p>
              {selectedEpisode
                ? getEpisodeLead(selectedEpisode, selectedDetail)
                : "Elige una carpeta para ver sus citas, documentos, medicamentos y resultados relacionados."}
            </p>
          </div>

          <div className="history-process-summarybar" aria-label="Resumen del historial">
            <div className="history-process-summaryitem">
              <strong>{summaryCounts.active}</strong>
              <span>Activos</span>
            </div>
            <div className="history-process-summaryitem">
              <strong>{summaryCounts.pending}</strong>
              <span>Pendientes</span>
            </div>
            <div className="history-process-summaryitem">
              <strong>{summaryCounts.closed}</strong>
              <span>Cerrados</span>
            </div>
          </div>
        </div>
      </section>

      <div className="history-process-toolbar-shell timeline-filters-card">
        <div className="history-process-toolbar-intro">
          <div>
            <h2>Filtra y ubica una carpeta</h2>
            <p>
              Busca por motivo, documento o control. Cambia el perfil y deja visibles solo las carpetas que necesitas revisar.
            </p>
          </div>
          <span className="history-process-toolbar-chip">{filteredEpisodes.length} visibles para {profileLabel}</span>
        </div>

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
                {filteredEpisodes.length} carpetas visibles para {profileLabel}.
              </p>
              <div className="history-process-filters" role="tablist" aria-label="Filtrar carpetas">
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

          {filteredEpisodes.length ? (
            <div className="history-process-mobile-nav">
              <div className="input-group">
                  <label className="input-label">Carpeta activa</label>
                <select
                  className="input-field"
                  value={selectedEpisodeId || ""}
                  onChange={(e) => setSelectedEpisodeId(Number(e.target.value) || null)}
                >
                  {filteredEpisodes.map((episode) => (
                    <option key={episode.id} value={episode.id}>
                      {cleanUiText(episode.title, "Carpeta clínica")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="history-process-mobile-nav-actions">
                <button
                  type="button"
                  className="secondary-btn history-process-inline-btn"
                  disabled={selectedEpisodeIndex <= 0}
                  onClick={() => selectRelativeEpisode(-1)}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="secondary-btn history-process-inline-btn"
                  disabled={selectedEpisodeIndex < 0 || selectedEpisodeIndex >= filteredEpisodes.length - 1}
                  onClick={() => selectRelativeEpisode(1)}
                >
                  Siguiente
                </button>
              </div>

              {selectedEpisode ? (
                <div className={`history-process-mobile-summary tone-${getEpisodeTone(selectedEpisode.status)}`}>
                  <div className="history-process-mobile-summary-head">
                    <strong>{cleanUiText(selectedEpisode.title, "Carpeta clínica")}</strong>
                    <span>{`${selectedEpisodeIndex + 1} de ${filteredEpisodes.length}`}</span>
                  </div>
                  <p>
                    {getEpisodeTypeLabel(selectedEpisode.episode_type)} · {getPendingLabel(selectedEpisode)} ·{" "}
                    {getLastActivityLabel(selectedEpisode.last_activity_at)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card history-process-shell">
        {loading ? (
          <div className="history-process-empty timeline-card">Estamos organizando tu historial por carpetas clínicas...</div>
        ) : filteredEpisodes.length ? (
          <div className="history-process-layout">
            <aside className="history-process-rail">
              <div className="history-process-rail-head">
                <strong>Carpetas</strong>
                <span>Selecciona una para ver todo lo relacionado en un solo lugar.</span>
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
                          {cleanUiText(episode.title, "Carpeta clínica")}
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
                      <h2>{cleanUiText(selectedEpisode.title, "Carpeta clínica")}</h2>
                      <p>{getEpisodeLead(selectedEpisode, selectedDetail)}</p>
                    </div>

                    <div className="history-process-panel-actions">
                      <button className="primary-btn history-process-inline-btn" onClick={() => openManualLinker(selectedEpisode.id)}>
                        {manualLinker.episodeId === selectedEpisode.id ? "Ocultar organización" : "Organizar carpeta"}
                      </button>
                    </div>
                  </div>

                  <div className="history-process-action-block timeline-card">
                    <div className="history-process-section-head history-process-action-head">
                      <div>
                        <h3>Qué puedes hacer ahora</h3>
                        <p className="history-process-note">
                          Abre el módulo correcto o corrige esta agrupación sin tener que salir a buscarla.
                        </p>
                      </div>
                      <span>{selectedQuickActions.length + 1} acción(es)</span>
                    </div>

                    <div className="history-process-commandbar">
                      {selectedQuickActions.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          className={`${action.tone === "primary" ? "primary-btn" : "secondary-btn"} history-process-command-btn history-process-command-card`}
                          onClick={() => navigate(action.to)}
                        >
                          <span className="history-process-command-kicker">{action.kicker}</span>
                          <strong className="history-process-command-title">{action.label}</strong>
                          <span className="history-process-command-copy">{action.description}</span>
                        </button>
                      ))}

                      <button
                        type="button"
                        className={`${manualLinker.episodeId === selectedEpisode.id ? "primary-btn" : "secondary-btn"} history-process-command-btn history-process-command-card`}
                        onClick={() => openManualLinker(selectedEpisode.id)}
                      >
                        <span className="history-process-command-kicker">Organización</span>
                        <strong className="history-process-command-title">
                          {manualLinker.episodeId === selectedEpisode.id ? "Seguir organizando carpeta" : "Agregar o mover elementos"}
                        </strong>
                        <span className="history-process-command-copy">
                          Reubica citas, documentos o medicamentos cuando esta carpeta quedó incompleta.
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="history-process-spotlight">
                    <div className="history-process-spotlight-item timeline-card">
                      <span>Próximo paso</span>
                      <strong>
                        {selectedPendingTasks[0]
                          ? cleanUiText(selectedPendingTasks[0].title, "Hay una acción pendiente.")
                          : "No hay pendientes por ahora"}
                      </strong>
                      <p>
                        {selectedPendingTasks[0]
                          ? getTaskLabel(selectedPendingTasks[0])
                          : "Esta carpeta está al día con la información registrada."}
                      </p>
                    </div>

                    <div className="history-process-spotlight-item timeline-card">
                      <span>Contenido</span>
                      <strong>{getEpisodeCountsLine(selectedEpisode)}</strong>
                      <p>{getPendingLabel(selectedEpisode)}</p>
                    </div>

                    <div className="history-process-spotlight-item timeline-card">
                      <span>Último movimiento</span>
                      <strong>{getLastActivityLabel(selectedEpisode.last_activity_at)}</strong>
                      <p>{cleanUiText(selectedEpisode.care_summary || selectedEpisode.summary, "Sin resumen adicional.")}</p>
                    </div>
                  </div>

                  {loadingDetailId === selectedEpisode.id && !selectedDetail ? (
                    <div className="history-process-empty">Cargando esta carpeta...</div>
                  ) : (
                    <>
                      <div className="history-folder-workspace">
                        <section className="history-folder-items timeline-card">
                          <div className="history-process-section-head">
                            <div>
                              <h3>Dentro de esta carpeta</h3>
                              <p className="history-process-note">
                                Aquí se ordena todo lo que quedó asociado a esta atención en el tiempo.
                              </p>
                            </div>
                            <span>{selectedFolderItems.length} {selectedFolderItems.length === 1 ? "elemento" : "elementos"}</span>
                          </div>

                          {selectedFolderItems.length ? (
                            <div className="history-folder-item-list">
                              {selectedFolderItems.map((item) => {
                                const isSelected = getFolderItemKey(item) === selectedFolderItemKey;
                                return (
                                  <button
                                    key={getFolderItemKey(item)}
                                    type="button"
                                    className={`history-folder-item ${isSelected ? "is-selected" : ""}`}
                                    onClick={() => setSelectedFolderItemKey(getFolderItemKey(item))}
                                  >
                                    <div className="history-folder-item-top">
                                      <span className={`history-folder-item-kind type-${item.item_type}`}>
                                        {getFolderItemTypeLabel(item.item_type)}
                                      </span>
                                      <span className="history-folder-item-date">
                                        {item.event_at ? toLocaleDateTimeOrEmpty(item.event_at) : "Fecha no informada"}
                                      </span>
                                    </div>
                                    <strong>{cleanUiText(item.title, "Elemento clínico")}</strong>
                                    <p>{cleanUiText(item.subtitle, "Sin detalle adicional.")}</p>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="history-process-note">Esta carpeta todavía no tiene elementos relacionados visibles.</p>
                          )}
                        </section>

                        <aside className="history-folder-detail timeline-card">
                          <div className="history-process-section-head">
                            <div>
                              <h3>Detalle del elemento</h3>
                              <p className="history-process-note">Selecciona una cita, documento, medicamento o resultado para revisar sus datos.</p>
                            </div>
                            <span>{selectedFolderItem ? getFolderItemTypeLabel(selectedFolderItem.item_type) : "Sin selección"}</span>
                          </div>

                          {selectedFolderItem ? (
                            <div className="history-folder-detail-body">
                              <div className="history-folder-detail-header">
                                <span className={`history-folder-item-kind type-${selectedFolderItem.item_type}`}>
                                  {getFolderItemTypeLabel(selectedFolderItem.item_type)}
                                </span>
                                <strong>{cleanUiText(selectedFolderItem.title, "Elemento clínico")}</strong>
                                <p>{getFolderItemDescription(selectedFolderItem, selectedFolderRecord)}</p>
                              </div>

                              <div className="history-folder-detail-grid">
                                {selectedFolderItemDetails.map((row) => (
                                  <div key={`${selectedFolderItem.item_type}-${row.label}`} className="history-folder-detail-cell">
                                    <span>{row.label}</span>
                                    <strong>{row.value}</strong>
                                  </div>
                                ))}
                              </div>

                              <div className="history-folder-detail-actions">
                                {selectedFolderItemAction ? (
                                  <button
                                    type="button"
                                    className="secondary-btn history-process-inline-btn"
                                    onClick={() => navigate(selectedFolderItemAction.to)}
                                  >
                                    {selectedFolderItemAction.label}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <div className="history-process-empty">Selecciona un elemento de la carpeta para ver su detalle.</div>
                          )}
                        </aside>
                      </div>

                      <div className="history-folder-support-grid">
                        <section className="history-process-section history-process-section-card timeline-card">
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
                                  {getTaskAction(task) ? (
                                    <button
                                      type="button"
                                      className="secondary-btn history-process-row-action"
                                      onClick={() => navigate(getTaskAction(task).to)}
                                    >
                                      {getTaskAction(task).label}
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="history-process-note">No hay pasos pendientes registrados para esta carpeta.</p>
                          )}
                        </section>

                        <section className="history-process-section history-process-section-card timeline-card">
                          <div className="history-process-section-head">
                            <h3>Corregir carpeta</h3>
                            <span>Ayuda a completar esta trazabilidad</span>
                          </div>

                          <div className="history-process-manual-intro">
                            <p>
                              Si una cita, un documento o un medicamento quedó fuera, puedes moverlo manualmente a esta
                              carpeta.
                            </p>
                            <button className="secondary-btn history-process-inline-btn" onClick={() => openManualLinker(selectedEpisode.id)}>
                              {manualLinker.episodeId === selectedEpisode.id ? "Ocultar formulario" : "Agregar o mover elemento"}
                            </button>
                          </div>

                          {manualLinker.episodeId === selectedEpisode.id ? (
                            manualLinker.loading ? (
                              <div className="history-process-empty">Buscando citas, documentos y medicamentos...</div>
                            ) : (
                              <div className="history-process-manual timeline-card">
                                <div className="history-process-manual-grid">
                                  <div className="input-group">
                                    <label className="input-label">Tipo</label>
                                    <select
                                      className="input-field"
                                      value={manualLinker.type}
                                      onChange={(e) =>
                                        setManualLinker((current) => {
                                          const nextType = e.target.value;
                                          const nextItem = ensureArray(current.items).find((currentItem) => currentItem.type === nextType);
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
                                    {manualLinker.saving ? "Guardando..." : "Asignar a esta carpeta"}
                                  </button>
                                </div>

                                {manualLinker.message ? <p className="history-process-note">{manualLinker.message}</p> : null}
                              </div>
                            )
                          ) : null}
                        </section>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="history-process-empty timeline-card">Selecciona una carpeta para ver su resumen y sus acciones.</div>
              )}
            </section>
          </div>
        ) : episodes.length ? (
          <div className="history-process-empty-zone">
            <div className="history-process-empty timeline-card">
              No encontramos carpetas con este filtro. Prueba cambiar el filtro o borrar la búsqueda.
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
            <div className="history-process-empty timeline-card">
              No encontramos carpetas agrupadas para este perfil. Seguimos conectando tus atenciones para que se entiendan mejor.
            </div>

            <div className="history-process-legacy timeline-card">
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
