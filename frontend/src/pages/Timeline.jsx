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
  const documents = ensureArray(detail?.related_items?.documents).map(buildDocumentExplorerEntry);
  const results = sortEntriesDesc([
    ...documents.filter((item) => item.sectionId === "results"),
    ...ensureArray(detail?.related_items?.external_records).map(buildExternalRecordExplorerEntry),
  ]);
  const recipes = sortEntriesDesc(documents.filter((item) => item.sectionId === "recipes"));
  const reports = sortEntriesDesc(documents.filter((item) => item.sectionId === "reports"));
  const orders = sortEntriesDesc(documents.filter((item) => item.sectionId === "orders"));
  const otherDocuments = sortEntriesDesc(documents.filter((item) => item.sectionId === "other_documents"));
  const activity = sortEntriesDesc(ensureArray(detail?.timeline).slice().reverse().map(buildTimelineExplorerEntry));

  return [
    {
      id: "appointments",
      label: "Citas",
      description: "Consultas, controles y exámenes vinculados a esta atención.",
      emptyText: "No hay citas relacionadas dentro de esta carpeta.",
      action: getExplorerSectionAction("appointments"),
      entries: appointments,
    },
    {
      id: "medications",
      label: "Medicamentos",
      description: "Tratamientos y fármacos indicados durante esta atención.",
      emptyText: "No hay medicamentos vinculados a esta carpeta.",
      action: getExplorerSectionAction("medications"),
      entries: medications,
    },
    {
      id: "recipes",
      label: "Recetas",
      description: "Recetas e indicaciones farmacológicas asociadas.",
      emptyText: "No hay recetas cargadas en esta carpeta.",
      action: getExplorerSectionAction("recipes"),
      entries: recipes,
    },
    {
      id: "reports",
      label: "Informes",
      description: "Informes clínicos, evoluciones y reportes médicos.",
      emptyText: "No hay informes dentro de esta carpeta.",
      action: getExplorerSectionAction("reports"),
      entries: reports,
    },
    {
      id: "orders",
      label: "Órdenes",
      description: "Órdenes médicas y solicitudes relacionadas con la atención.",
      emptyText: "No hay órdenes asociadas a esta carpeta.",
      action: getExplorerSectionAction("orders"),
      entries: orders,
    },
    {
      id: "results",
      label: "Resultados",
      description: "Resultados de documentos e interoperabilidad externa.",
      emptyText: "No hay resultados clínicos visibles en esta carpeta.",
      action: getExplorerSectionAction("results"),
      entries: results,
    },
    {
      id: "other_documents",
      label: "Otros documentos",
      description: "Archivos clínicos adicionales que también forman parte de esta atención.",
      emptyText: "No hay otros documentos vinculados a esta carpeta.",
      action: getExplorerSectionAction("other_documents"),
      entries: otherDocuments,
    },
    {
      id: "activity",
      label: "Actividad",
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
        setSelectedSectionId("");
        setSelectedEntryKey("");
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
  const explorerSections = useMemo(() => buildExplorerSections(selectedDetail), [selectedDetail]);

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
      <section className={`history-explorer-header timeline-overview-card tone-${selectedEpisodeTone}`}>
        <div className="history-explorer-header-copy">
          <span className="history-explorer-kicker">Historial clínico</span>
          <h1 className="card-title">Carpetas clínicas</h1>
          <p className="muted">
            Cada carpeta representa una atención y reúne citas, medicamentos, recetas, informes, resultados y toda la
            trazabilidad relacionada.
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

      <div className="history-explorer-shell">
        {loading ? (
          <div className="history-explorer-empty timeline-card">Cargando carpetas clínicas...</div>
        ) : filteredEpisodes.length ? (
          <>
            <aside className="history-explorer-sidebar timeline-card">
              <div className="history-explorer-sidebar-head">
                <strong>Carpetas</strong>
                <span>Selecciona una atención para abrir su ecosistema clínico.</span>
              </div>

              <div className="history-explorer-folder-list" role="list">
                {filteredEpisodes.map((episode) => {
                  const detail = episodeDetails[episode.id];
                  const isSelected = selectedEpisodeId === episode.id;
                  return (
                    <button
                      key={episode.id}
                      type="button"
                      className={`history-explorer-folder-row ${isSelected ? "is-selected" : ""}`}
                      onClick={() => setSelectedEpisodeId(episode.id)}
                    >
                      <span className="history-explorer-folder-icon">
                        <FolderIcon />
                      </span>
                      <span className="history-explorer-folder-copy">
                        <strong>{cleanUiText(episode.title, "Carpeta clínica")}</strong>
                        <span>{getEpisodeLead(episode, detail)}</span>
                        <small>{getEpisodeCountsLine(episode)}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="history-explorer-main">
              {selectedEpisode ? (
                <>
                  <div className="history-explorer-main-head timeline-card">
                    <div className="history-explorer-main-copy">
                      <span className="history-explorer-folder-type">{getEpisodeTypeLabel(selectedEpisode.episode_type)}</span>
                      <h2>{cleanUiText(selectedEpisode.title, "Carpeta clínica")}</h2>
                      <p>{getEpisodeLead(selectedEpisode, selectedDetail)}</p>
                    </div>

                    <div className="history-explorer-main-meta">
                      <span>{getEpisodeStatusLabel(selectedEpisode.status)}</span>
                      <span>{getPendingLabel(selectedEpisode)}</span>
                      <span>{getLastActivityLabel(selectedEpisode.last_activity_at)}</span>
                    </div>
                  </div>

                  <div className="history-explorer-module-grid">
                    {explorerSections.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        className={`history-explorer-module ${activeExplorerSection?.id === section.id ? "is-active" : ""} ${
                          section.count ? "" : "is-empty"
                        }`}
                        onClick={() => setSelectedSectionId(section.id)}
                      >
                        <span className="history-explorer-module-count">{section.count}</span>
                        <strong>{section.label}</strong>
                        <p>{section.description}</p>
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
                              <p>{activeExplorerSection?.description || "Explora el contenido clínico de esta carpeta."}</p>
                            </div>
                            <span>{activeExplorerSection?.count || 0}</span>
                          </div>

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
                                  <strong>{entry.title}</strong>
                                  <p>{entry.subtitle || entry.description}</p>
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
                                <span className={`history-explorer-pill tone-${selectedExplorerEntry.tone}`}>{selectedExplorerEntry.kind}</span>
                                <strong>{selectedExplorerEntry.title}</strong>
                                <p>{selectedExplorerEntry.description || "Sin detalle adicional."}</p>
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
                              <p>Selecciona un elemento para revisar su detalle clínico.</p>
                            </div>
                          )}
                        </aside>
                      </div>

                      <div className="history-explorer-bottom-grid">
                        <section className="history-explorer-support timeline-card">
                          <div className="history-explorer-section-head">
                            <div>
                              <h3>Pendientes de esta atención</h3>
                              <p>Acciones clínicas que todavía requieren seguimiento.</p>
                            </div>
                            <span>{selectedPendingTasks.length}</span>
                          </div>

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
                              <h3>Corregir carpeta</h3>
                              <p>Si algo quedó fuera, puedes moverlo manualmente y mantener la trazabilidad.</p>
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
                            <p className="history-explorer-note">Usa esta acción cuando una cita, receta o medicamento quedó asociado a otra carpeta.</p>
                          )}
                        </section>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="history-explorer-empty timeline-card">Selecciona una carpeta para abrir su ecosistema clínico.</div>
              )}
            </section>
          </>
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
      </div>
    </>
  );
}
