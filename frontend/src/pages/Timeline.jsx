import { useEffect, useMemo, useState } from "react";
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

function getEpisodeStatusLabel(status) {
  return EPISODE_STATUS_LABELS[String(status || "").toLowerCase()] || "En curso";
}

function getEpisodeTypeLabel(type) {
  return EPISODE_TYPE_LABELS[String(type || "").toLowerCase()] || "Carpeta clínica";
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

function getEpisodePreview(episode) {
  const summary = cleanUiText(episode.care_summary || episode.summary, "");
  if (summary) return summary;
  return "Consulta el contenido clínico, sus documentos y los próximos pasos.";
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

function getAppointmentTypeLabel(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "examen") return "Examen";
  if (normalized === "tramite") return "Trámite";
  return "Cita";
}

function getDocumentTypeValue(item) {
  return String(item?.doc_type?.value || item?.doc_type || "").toLowerCase();
}

function getDocumentSectionId(item) {
  const normalized = getDocumentTypeValue(item);
  if (normalized === "receta") return "recipes";
  if (normalized === "informe") return "reports";
  if (normalized === "orden") return "orders";
  if (normalized === "resultado") return "results";
  return "other_documents";
}

function getDocumentKindLabel(item) {
  const normalized = getDocumentTypeValue(item);
  if (normalized === "receta") return "Receta";
  if (normalized === "informe") return "Informe";
  if (normalized === "orden") return "Orden";
  if (normalized === "resultado") return "Resultado";
  return "Documento";
}

function getExplorerSectionAction(sectionId) {
  if (sectionId === "appointments") return { label: "Abrir citas", to: "/appointments" };
  if (sectionId === "medications") return { label: "Abrir medicamentos", to: "/medications" };
  if (["recipes", "reports", "orders", "results", "other_documents"].includes(sectionId)) {
    return { label: "Abrir documentos", to: "/documents" };
  }
  return null;
}

function sortEntriesDesc(entries) {
  return entries.slice().sort((a, b) => {
    const left = a.when ? new Date(a.when).getTime() : 0;
    const right = b.when ? new Date(b.when).getTime() : 0;
    return right - left;
  });
}

function buildAppointmentExplorerEntry(item) {
  const kind = getAppointmentTypeLabel(item.type);
  return {
    key: `appointment-${item.id}`,
    sectionId: "appointments",
    tone: "appointment",
    kind,
    title: cleanUiText(item.specialty || `${kind} médica`, kind),
    subtitle: [cleanUiText(item.status), cleanUiText(item.center)].filter(Boolean).join(" · "),
    description: cleanUiText(item.notes, "Atención clínica vinculada a esta carpeta."),
    when: item.date_time || item.created_at || null,
    action: getExplorerSectionAction("appointments"),
    details: [
      { label: "Tipo", value: kind },
      { label: "Estado", value: cleanUiText(item.status, "Sin estado") },
      { label: "Centro", value: cleanUiText(item.center, "Sin centro informado") },
      { label: "Fecha", value: item.date_time ? toLocaleDateTimeOrEmpty(item.date_time) : "Fecha no informada" },
    ],
  };
}

function buildMedicationExplorerEntry(item) {
  return {
    key: `medication-${item.id}`,
    sectionId: "medications",
    tone: "medication",
    kind: "Medicamento",
    title: cleanUiText(item.name, "Medicamento"),
    subtitle: [cleanUiText(item.dose), cleanUiText(item.frequency)].filter(Boolean).join(" · "),
    description: cleanUiText(item.notes, "Tratamiento registrado dentro de esta atención."),
    when: item.start_at || item.created_at || null,
    action: getExplorerSectionAction("medications"),
    details: [
      { label: "Dosis", value: cleanUiText(item.dose, "Sin dosis informada") },
      { label: "Frecuencia", value: cleanUiText(item.frequency, "Sin frecuencia informada") },
      { label: "Inicio", value: item.start_at ? toLocaleDateOrEmpty(item.start_at) : "Fecha no informada" },
      { label: "Estado", value: item.completed ? "Finalizado" : "Activo" },
    ],
  };
}

function buildDocumentExplorerEntry(item) {
  const sectionId = getDocumentSectionId(item);
  const kind = getDocumentKindLabel(item);
  return {
    key: `document-${item.id}`,
    sectionId,
    tone: sectionId === "results" ? "result" : "document",
    kind,
    title: cleanUiText(item.filename, kind),
    subtitle: [kind, cleanUiText(item.center)].filter(Boolean).join(" · "),
    description: cleanUiText(item.notes, `${kind} vinculado a esta carpeta.`),
    when: item.date || item.created_at || null,
    action: getExplorerSectionAction(sectionId),
    details: [
      { label: "Tipo", value: kind },
      { label: "Centro", value: cleanUiText(item.center, "Sin centro informado") },
      { label: "Fecha", value: item.date ? toLocaleDateOrEmpty(item.date) : "Fecha no informada" },
      { label: "Archivo", value: cleanUiText(item.filename, "Documento clínico") },
    ],
  };
}

function buildExternalRecordExplorerEntry(item) {
  return {
    key: `external-${item.id}`,
    sectionId: "results",
    tone: "result",
    kind: "Resultado",
    title: cleanUiText(item.title, "Resultado externo"),
    subtitle: cleanUiText(item.record_type, "Interoperabilidad"),
    description: cleanUiText(item.summary, "Resultado externo asociado a esta atención."),
    when: item.event_at || item.created_at || null,
    action: getExplorerSectionAction("results"),
    details: [
      { label: "Origen", value: cleanUiText(item.title, "Resultado externo") },
      { label: "Tipo", value: cleanUiText(item.record_type, "Resultado") },
      { label: "Fecha", value: item.event_at ? toLocaleDateTimeOrEmpty(item.event_at) : "Fecha no informada" },
      { label: "Resumen", value: cleanUiText(item.summary, "Sin resumen informado") },
    ],
  };
}

function buildTimelineExplorerEntry(item) {
  const eventType = String(item?.event_type || "").toLowerCase();
  let kind = "Actividad";
  let tone = "activity";
  if (eventType.includes("appointment")) {
    kind = "Cita";
    tone = "appointment";
  } else if (eventType.includes("medication")) {
    kind = "Medicamento";
    tone = "medication";
  } else if (eventType.includes("document")) {
    kind = "Documento";
    tone = "document";
  } else if (eventType.includes("result") || eventType.includes("external")) {
    kind = "Resultado";
    tone = "result";
  }
  return {
    key: `timeline-${item.source_record_type || item.event_type}-${item.source_record_id || item.title}`,
    sectionId: "activity",
    tone,
    kind,
    title: cleanUiText(item.title, "Actividad clínica"),
    subtitle: cleanUiText(item.summary, "Movimiento registrado dentro de esta carpeta."),
    description: cleanUiText(item.summary, "Movimiento registrado dentro de esta carpeta."),
    when: item.event_at || null,
    action: null,
    details: [
      { label: "Evento", value: cleanUiText(item.event_type, "Actividad") },
      { label: "Módulo", value: cleanUiText(item.source_module, "Historial") },
      { label: "Fecha", value: item.event_at ? toLocaleDateTimeOrEmpty(item.event_at) : "Fecha no informada" },
      { label: "Detalle", value: cleanUiText(item.summary, "Sin detalle adicional") },
    ],
  };
}

function buildExplorerSections(detail) {
  const appointments = sortEntriesDesc(ensureArray(detail?.related_items?.appointments).map(buildAppointmentExplorerEntry));
  const medications = sortEntriesDesc(ensureArray(detail?.related_items?.medications).map(buildMedicationExplorerEntry));
  const documents = sortEntriesDesc([
    ...ensureArray(detail?.related_items?.documents).map(buildDocumentExplorerEntry),
    ...ensureArray(detail?.related_items?.external_records).map(buildExternalRecordExplorerEntry),
  ]);
  const activity = sortEntriesDesc(ensureArray(detail?.timeline).slice().reverse().map(buildTimelineExplorerEntry));

  return [
    {
      id: "appointments",
      label: "Citas",
      hint: "Consultas, controles y examenes",
      description: "Consultas, controles y exámenes vinculados a esta atención.",
      emptyText: "No hay citas relacionadas dentro de esta carpeta.",
      action: getExplorerSectionAction("appointments"),
      entries: appointments,
    },
    {
      id: "medications",
      label: "Medicamentos",
      hint: "Tratamientos activos o finalizados",
      description: "Tratamientos y fármacos indicados durante esta atención.",
      emptyText: "No hay medicamentos vinculados a esta carpeta.",
      action: getExplorerSectionAction("medications"),
      entries: medications,
    },
    {
      id: "documents",
      label: "Documentos",
      hint: "Informes, recetas y resultados",
      description: "Recetas, informes, órdenes, resultados y archivos clínicos.",
      emptyText: "No hay documentos dentro de esta carpeta.",
      action: { label: "Abrir documentos", to: "/documents" },
      entries: documents,
    },
    {
      id: "activity",
      label: "Actividad",
      hint: "Linea de tiempo de cambios",
      description: "Trazabilidad cronológica de todo lo que ocurrió en esta carpeta.",
      emptyText: "Todavía no hay actividad registrada para esta carpeta.",
      action: null,
      entries: activity,
    },
  ].map((section) => ({
    ...section,
    count: section.entries.length,
  }));
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.5 7.5a2 2 0 0 1 2-2h4l1.4 1.6H18.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
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
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [selectedEntryKey, setSelectedEntryKey] = useState("");
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
        setSelectedEpisodeId((current) => (safeEpisodes.some((item) => item.id === current) ? current : null));
        setSelectedSectionId("");
        setSelectedEntryKey("");
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
    if (selectedEpisodeId && !filteredEpisodes.some((item) => item.id === selectedEpisodeId)) {
      setSelectedEpisodeId(null);
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
  const explorerSections = useMemo(() => buildExplorerSections(selectedDetail), [selectedDetail]);

  const selectedPendingTasks = useMemo(
    () => ensureArray(selectedDetail?.tasks).filter((task) => task.status !== "completed").slice(0, 3),
    [selectedDetail]
  );

  useEffect(() => {
    if (!explorerSections.length) {
      setSelectedSectionId("");
      return;
    }
    if (!explorerSections.some((section) => section.id === selectedSectionId)) {
      const firstVisibleSection = explorerSections.find((section) => section.count > 0) || explorerSections[0];
      setSelectedSectionId(firstVisibleSection.id);
    }
  }, [explorerSections, selectedSectionId]);

  const activeExplorerSection = useMemo(
    () => explorerSections.find((section) => section.id === selectedSectionId) || explorerSections[0] || null,
    [explorerSections, selectedSectionId]
  );

  useEffect(() => {
    const entries = ensureArray(activeExplorerSection?.entries);
    if (!entries.length) {
      setSelectedEntryKey("");
      return;
    }
    if (!entries.some((entry) => entry.key === selectedEntryKey)) {
      setSelectedEntryKey(entries[0].key);
    }
  }, [activeExplorerSection, selectedEntryKey]);

  const selectedExplorerEntry = useMemo(
    () => ensureArray(activeExplorerSection?.entries).find((entry) => entry.key === selectedEntryKey) || null,
    [activeExplorerSection, selectedEntryKey]
  );

  const visibleManualItems = useMemo(
    () => ensureArray(manualLinker.items).filter((item) => item.type === manualLinker.type),
    [manualLinker.items, manualLinker.type]
  );

  const selectedManualItem = useMemo(
    () => visibleManualItems.find((item) => String(item.id) === String(manualLinker.itemId)) || null,
    [manualLinker.itemId, visibleManualItems]
  );

  const selectedEpisodeTone = selectedEpisode ? getEpisodeTone(selectedEpisode.status) : "active";

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

  if (selectedEpisode) {
    return (
      <>
        <div className="history-folder-back">
          <button
            type="button"
            className="secondary-btn history-folder-back-btn"
            onClick={() => setSelectedEpisodeId(null)}
          >
            <span aria-hidden="true">←</span> Volver a carpetas
          </button>
        </div>

        <section className={`history-explorer-main-head timeline-card tone-${selectedEpisodeTone}`}>
          <div className="history-explorer-main-copy">
            <span className="history-explorer-folder-type">{getEpisodeTypeLabel(selectedEpisode.episode_type)}</span>
            <h2>{cleanUiText(selectedEpisode.title, "Carpeta clínica")}</h2>
            <p>{getEpisodeLead(selectedEpisode, selectedDetail)}</p>
            <p className="history-explorer-guidance">
              Esta vista resume la atención en bloques breves. Elige una sección, revisa la lista y usa el panel derecho para
              entender rápido el contexto clínico más importante.
            </p>
          </div>

          <div className="history-explorer-main-meta">
            <span>{getEpisodeStatusLabel(selectedEpisode.status)}</span>
            <span>{getPendingLabel(selectedEpisode)}</span>
            <span>{getLastActivityLabel(selectedEpisode.last_activity_at)}</span>
          </div>
        </section>

        <div className="history-explorer-module-grid history-folder-module-grid">
          {explorerSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`history-explorer-module ${activeExplorerSection?.id === section.id ? "is-active" : ""} ${
                section.count ? "" : "is-empty"
              }`}
              onClick={() => setSelectedSectionId(section.id)}
            >
              <div className="history-explorer-module-head">
                <strong>{section.label}</strong>
                <span className="history-explorer-module-count">{section.count}</span>
              </div>
              <p className="history-explorer-module-hint">{section.hint}</p>
              <p>{section.count ? "Ver resumen" : "Sin registros"}</p>
            </button>
          ))}
        </div>

        {loadingDetailId === selectedEpisode.id && !selectedDetail ? (
          <div className="history-explorer-empty timeline-card">Cargando el contenido de esta carpeta...</div>
        ) : (
          <>
            <div className="history-explorer-stage">
              <section className="history-explorer-entry-list timeline-card">
                <div className="history-explorer-section-head">
                  <div>
                    <h3>{activeExplorerSection?.label || "Contenido"}</h3>
                    <p>{activeExplorerSection?.description || "Revisa el contenido clínico de esta carpeta."}</p>
                  </div>
                  <span>{activeExplorerSection?.count || 0}</span>
                </div>
                <p className="history-explorer-inline-help">
                  La lista muestra cada registro en formato breve. Al tocar uno, verás a la derecha sus datos clave y un resumen
                  orientativo.
                </p>

                {ensureArray(activeExplorerSection?.entries).length ? (
                  <div className="history-explorer-entry-stack">
                    {activeExplorerSection.entries.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        className={`history-explorer-entry ${selectedEntryKey === entry.key ? "is-selected" : ""}`}
                        onClick={() => setSelectedEntryKey(entry.key)}
                      >
                        <div className="history-explorer-entry-top">
                          <span className={`history-explorer-pill tone-${entry.tone}`}>{entry.kind}</span>
                          <span>{entry.when ? toLocaleDateTimeOrEmpty(entry.when) : "Fecha no informada"}</span>
                        </div>
                        <div className="history-explorer-entry-main">
                          <strong>{entry.title}</strong>
                          {entry.subtitle ? <p className="history-explorer-entry-meta">{entry.subtitle}</p> : null}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="history-explorer-empty-block">
                    <p>{activeExplorerSection?.emptyText || "No hay contenido para mostrar."}</p>
                    {activeExplorerSection?.action ? (
                      <button
                        type="button"
                        className="secondary-btn history-process-inline-btn"
                        onClick={() => navigate(activeExplorerSection.action.to)}
                      >
                        {activeExplorerSection.action.label}
                      </button>
                    ) : null}
                  </div>
                )}
              </section>

              <aside className="history-explorer-detail timeline-card">
                {selectedExplorerEntry ? (
                  <div className="history-explorer-detail-body">
                    <div className="history-explorer-detail-head">
                      <div className="history-explorer-detail-title-row">
                        <span className={`history-explorer-pill tone-${selectedExplorerEntry.tone}`}>{selectedExplorerEntry.kind}</span>
                        {selectedExplorerEntry.when ? (
                          <span className="history-explorer-detail-when">
                            {toLocaleDateTimeOrEmpty(selectedExplorerEntry.when)}
                          </span>
                        ) : null}
                      </div>
                      <strong>{selectedExplorerEntry.title}</strong>
                      {selectedExplorerEntry.subtitle ? (
                        <p className="history-explorer-detail-lead">{selectedExplorerEntry.subtitle}</p>
                      ) : null}
                      <p className="history-explorer-detail-summary">
                        {selectedExplorerEntry.description || "Sin detalle adicional."}
                      </p>
                      <p className="history-explorer-detail-note">
                        Este resumen ayuda a una lectura rápida. Si necesitas el registro completo, usa el acceso directo del
                        módulo correspondiente.
                      </p>
                    </div>

                    <div className="history-explorer-detail-grid">
                      {selectedExplorerEntry.details.map((row) => (
                        <div key={`${selectedExplorerEntry.key}-${row.label}`} className="history-explorer-detail-cell">
                          <span>{row.label}</span>
                          <strong>{row.value}</strong>
                        </div>
                      ))}
                    </div>

                    <div className="history-explorer-detail-actions">
                      {selectedExplorerEntry.action ? (
                        <button
                          type="button"
                          className="secondary-btn history-process-inline-btn"
                          onClick={() => navigate(selectedExplorerEntry.action.to)}
                        >
                          {selectedExplorerEntry.action.label}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="history-explorer-empty-block">
                    <p>Selecciona un elemento para ver un resumen claro, su fecha y los datos más relevantes.</p>
                  </div>
                )}
              </aside>
            </div>

            <div className="history-explorer-bottom-grid">
              <section className="history-explorer-support timeline-card">
                <div className="history-explorer-section-head">
                  <div>
                    <h3>Pendientes</h3>
                    <p>Acciones que aún requieren seguimiento.</p>
                  </div>
                  <span>{selectedPendingTasks.length}</span>
                </div>
                <p className="history-explorer-inline-help">
                  Úsalo como recordatorio de lo que sigue en esta atención: controles, documentos o tareas todavía abiertas.
                </p>

                {selectedPendingTasks.length ? (
                  <div className="history-explorer-support-list">
                    {selectedPendingTasks.map((task) => (
                      <div key={task.id} className="history-explorer-support-row">
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
                  <p className="history-explorer-note">No hay pendientes registrados para esta carpeta.</p>
                )}
              </section>

              <section className="history-explorer-support timeline-card">
                <div className="history-explorer-section-head">
                  <div>
                    <h3>Ajustar carpeta</h3>
                    <p>Corrige asociaciones si un elemento quedó en la carpeta incorrecta.</p>
                  </div>
                  <button
                    type="button"
                    className="secondary-btn history-process-inline-btn"
                    onClick={() => openManualLinker(selectedEpisode.id)}
                  >
                    {manualLinker.episodeId === selectedEpisode.id ? "Ocultar" : "Agregar o mover"}
                  </button>
                </div>

                {manualLinker.episodeId === selectedEpisode.id ? (
                  manualLinker.loading ? (
                    <div className="history-explorer-empty-block">
                      <p>Buscando citas, documentos y medicamentos disponibles...</p>
                    </div>
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
                          <span>Actualmente está en: {selectedManualItem.currentEpisodeLabel}</span>
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

                      {manualLinker.message ? <p className="history-explorer-note">{manualLinker.message}</p> : null}
                    </div>
                  )
                ) : (
                  <p className="history-explorer-note">
                    Usa esta acción solo si una cita, receta o medicamento quedó asociado a otra carpeta. El cambio mantiene la
                    trazabilidad del historial.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <section className="history-explorer-header timeline-overview-card">
        <div className="history-explorer-header-copy">
          <span className="history-explorer-kicker">Historial clínico</span>
          <h1 className="card-title">Carpetas clínicas</h1>
          <p className="muted">
            Cada carpeta reúne una atención médica y todo lo que pertenece a ella: citas, medicamentos, recetas, informes y
            resultados. Toca una carpeta para abrirla.
          </p>
        </div>

        <div className="history-explorer-header-stats" aria-label="Resumen del historial">
          <div className="history-explorer-stat">
            <strong>{filteredEpisodes.length}</strong>
            <span>Visibles</span>
          </div>
          <div className="history-explorer-stat">
            <strong>{summaryCounts.pending}</strong>
            <span>Pendientes</span>
          </div>
          <div className="history-explorer-stat">
            <strong>{summaryCounts.closed}</strong>
            <span>Cerradas</span>
          </div>
        </div>
      </section>

      <div className="history-explorer-toolbar timeline-filters-card">
        <div className="history-explorer-toolbar-grid">
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
            <label className="input-label">Buscar carpeta</label>
            <input
              type="text"
              className="input-field"
              placeholder="Ejemplo: control, receta o rodilla"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="history-explorer-toolbar-row">
          <p className="history-explorer-toolbar-note">{filteredEpisodes.length} carpetas visibles para {profileLabel}.</p>
          <div className="history-explorer-filter-list" role="tablist" aria-label="Filtrar carpetas">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`history-explorer-filter ${statusFilter === item.id ? "is-active" : ""}`}
                onClick={() => setStatusFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="history-explorer-empty timeline-card">Cargando carpetas clínicas...</div>
      ) : filteredEpisodes.length ? (
        <div className="history-folder-list timeline-card" role="list">
          {filteredEpisodes.map((episode) => {
            const tone = getEpisodeTone(episode.status);
            const pending = Number(episode.pending_tasks || 0);
            return (
              <button
                key={episode.id}
                type="button"
                className={`history-folder-item tone-${tone}`}
                onClick={() => setSelectedEpisodeId(episode.id)}
              >
                <span className="history-folder-item-icon" aria-hidden="true">
                  <FolderIcon />
                </span>
                <span className="history-folder-item-copy">
                  <span className="history-folder-item-head">
                    <strong>{cleanUiText(episode.title, "Carpeta clínica")}</strong>
                    <span className={`history-folder-item-state tone-${tone}`}>{getEpisodeStatusLabel(episode.status)}</span>
                  </span>
                  <small>{getEpisodeCountsLine(episode)}</small>
                  <span className="history-folder-item-preview">{getEpisodePreview(episode)}</span>
                  <span className="history-folder-item-meta">
                    <span className="history-folder-item-tag">{getEpisodeTypeLabel(episode.episode_type)}</span>
                    <span className="history-folder-item-tag is-muted">{getLastActivityLabel(episode.last_activity_at)}</span>
                  </span>
                </span>
                {pending > 0 ? (
                  <span className="history-folder-item-badge" aria-label={`${pending} pendiente${pending === 1 ? "" : "s"}`}>
                    {pending} pend.
                  </span>
                ) : null}
                <span className="history-folder-item-chevron" aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
      ) : episodes.length ? (
        <div className="history-explorer-empty-stack">
          <div className="history-explorer-empty timeline-card">
            No encontramos carpetas con este filtro. Prueba con otro criterio o limpia la búsqueda.
          </div>
          <div className="history-explorer-empty-actions">
            <button type="button" className="secondary-btn history-process-inline-btn" onClick={() => setStatusFilter("all")}>
              Ver todas
            </button>
            <button type="button" className="secondary-btn history-process-inline-btn" onClick={() => setSearchTerm("")}>
              Limpiar búsqueda
            </button>
          </div>
        </div>
      ) : (
        <div className="history-explorer-empty-stack">
          <div className="history-explorer-empty timeline-card">
            Aún no hay carpetas clínicas agrupadas para este perfil.
          </div>

          <div className="history-explorer-support timeline-card">
            <div className="history-explorer-section-head">
              <div>
                <h3>Actividad reciente</h3>
                <p>Mientras se consolidan las carpetas, aquí puedes revisar los últimos movimientos detectados.</p>
              </div>
              <span>{legacyTimeline.event_count || legacyEvents.length}</span>
            </div>

            {legacyEvents.length ? (
              <div className="history-explorer-support-list">
                {legacyEvents.map((item, index) => (
                  <div key={`${item.id || item.source_record_id || index}-${index}`} className="history-explorer-support-row">
                    <div>
                      <strong>{cleanUiText(item.title, "Evento clínico")}</strong>
                      <p>{cleanUiText(item.summary, "Sin detalle adicional")}</p>
                    </div>
                    <span>{item.event_at ? toLocaleDateTimeOrEmpty(item.event_at) : "Fecha no informada"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="history-explorer-note">Todavía no hay actividad clínica disponible para mostrar.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
