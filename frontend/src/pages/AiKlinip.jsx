import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  getActiveHealthProfile,
  generateAiClinicalReport,
  getAiAdherence,
  getAiClinicalReportPdf,
  getAiClinicalReports,
  getAiConversations,
  getAiDocumentIntelligence,
  getAiHealthRadar,
  getAiHistory,
  getAppointments,
  deleteAiConversation,
  getDocuments,
  getHealthProfiles,
  getMedications,
  renameAiConversation,
  runAiHealthRadar,
  sendAiChat,
} from "../api";
import { parseDate } from "../utils/dates";

const QUICK_ACTIONS = [
  { id: "document", prompt: "Explícame mi último documento", title: "Último documento", subtitle: "Analizar y explicar", token: "DOC" },
  { id: "meds", prompt: "¿Qué medicamentos estoy tomando?", title: "Mis medicamentos", subtitle: "Ver plan activo", token: "MED" },
  { id: "next", prompt: "¿Cuándo es mi próxima cita?", title: "Próxima cita", subtitle: "Fecha y detalles", token: "CIT" },
  { id: "timeline", prompt: "Resume mi historial clínico", title: "Historial clínico", subtitle: "Resumen general", token: "HIS" },
];

const DOC_LABELS = { receta: "Receta", orden: "Orden", resultado: "Resultado", informe: "Informe", otro: "Documento" };
const APPOINTMENT_TYPE_LABELS = { cita: "Cita", examen: "Examen", tramite: "Trámite" };
const RADAR_PERIOD_OPTIONS = [
  { value: "7", label: "7 días" },
  { value: "30", label: "30 días" },
  { value: "90", label: "90 días" },
  { value: "all", label: "Todo" },
];

const PINNED_CONVERSATIONS_KEY = "klinip_ai_pinned_conversations";

const INITIAL_MESSAGE = {
  id: "welcome",
  role: "assistant",
  content: "Hola, soy Klinip IA. Puedo revisar contigo documentos, medicamentos, citas e historial del perfil activo. Hazme una pregunta y partimos.",
  references: [],
  createdAt: null,
};

const MOJIBAKE_PATTERN = /(?:Ã.|Â.|â.|�)/;
const MOJIBAKE_FALLBACKS = [
  ["Ã¡", "á"],
  ["Ã©", "é"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ãº", "ú"],
  ["Ã±", "ñ"],
  ["Ã", "Á"],
  ["Ã‰", "É"],
  ["Ã", "Í"],
  ["Ã“", "Ó"],
  ["Ãš", "Ú"],
  ["Ã‘", "Ñ"],
  ["Â¿", "¿"],
  ["Â¡", "¡"],
  ["â", "'"],
  ["â", '"'],
  ["â", '"'],
  ["â", "-"],
  ["â", "-"],
];

function repairMojibakeText(value) {
  const text = String(value ?? "");
  if (!text || !MOJIBAKE_PATTERN.test(text)) return text;

  if (typeof TextDecoder !== "undefined") {
    try {
      const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
      const decoded = new TextDecoder("utf-8").decode(bytes);
      if (decoded && !decoded.includes("\u0000")) {
        return decoded;
      }
    } catch {
      // Fallback replacements handle the common browser-side mojibake cases.
    }
  }

  return MOJIBAKE_FALLBACKS.reduce(
    (result, [search, replacement]) => result.split(search).join(replacement),
    text
  );
}

function cleanUiText(value, fallback = "") {
  const cleaned = repairMojibakeText(value).trim();
  return cleaned || fallback;
}

function cleanAssistantText(value) {
  return repairMojibakeText(String(value || ""))
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .trim();
}

function formatMessageTime(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Ahora";
  return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function formatShortDate(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" }).format(parsed);
}

function formatConversationStamp(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatConversationListDate(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function getPinnedConversationStorageKey(profileId) {
  return `${PINNED_CONVERSATIONS_KEY}:${profileId || "global"}`;
}

function formatDateTime(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return cleanUiText(new Intl.DateTimeFormat("es-CL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed));
}

function getPeriodCutoff(periodKey) {
  if (periodKey === "all") return null;
  const days = Number(periodKey);
  if (!Number.isFinite(days) || days <= 0) return null;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

function formatReportLabel(value) {
  if (!value) return "Reporte clínico";
  return String(value)
    .split("_")
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(" ");
}

function getSeverityLabel(value) {
  if (value === "high") return "Alta";
  if (value === "medium") return "Media";
  return "Baja";
}

function daysUntil(value) {
  const parsed = parseDate(value);
  if (!parsed) return null;
  return Math.ceil((parsed.getTime() - Date.now()) / 86400000);
}

function sourceCount(sources, key) {
  return Number((sources || []).find((item) => item.key === key)?.count || 0);
}

function sourceLabel(sources, key, fallback) {
  return (sources || []).find((item) => item.key === key)?.label || fallback;
}

function getUpcomingAppointments(items) {
  const now = Date.now();
  const validItems = [...(items || [])]
    .filter((item) => {
      const date = parseDate(item.date_time);
      return date && item.status !== "realizada";
    })
    .sort((a, b) => parseDate(a.date_time) - parseDate(b.date_time));

  const futureItems = validItems.filter((item) => parseDate(item.date_time).getTime() >= now);
  if (futureItems.length) return futureItems;

  return validItems
    .slice()
    .sort((a, b) => Math.abs(parseDate(a.date_time).getTime() - now) - Math.abs(parseDate(b.date_time).getTime() - now));
}

function getActiveMedications(items) {
  return [...(items || [])].filter((item) => !item.completed);
}

function Ring({ value }) {
  const safeValue = Math.max(0, Math.min(100, value));
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (circumference * safeValue) / 100;

  return (
    <div className="ai-score-ring">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="ai-score-ring-track" cx="32" cy="32" r={radius} />
        <circle
          className="ai-score-ring-fill"
          cx="32"
          cy="32"
          r={radius}
          style={{ strokeDasharray: circumference, strokeDashoffset: dashOffset }}
        />
      </svg>
      <div className="ai-score-ring-inner">
        <strong>{safeValue}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

export default function AiKlinip() {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState("");
  const [conversationTitle, setConversationTitle] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [rightTab, setRightTab] = useState("chat");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [scanVisible, setScanVisible] = useState(false);
  const [isAtLatest, setIsAtLatest] = useState(true);
  const [clinicalReports, setClinicalReports] = useState([]);
  const [healthRadar, setHealthRadar] = useState([]);
  const [documentIntelligence, setDocumentIntelligence] = useState([]);
  const [adherenceSummary, setAdherenceSummary] = useState({});
  const [reportBusy, setReportBusy] = useState(false);
  const [radarRefreshing, setRadarRefreshing] = useState(false);
  const [radarProfiles, setRadarProfiles] = useState([]);
  const [radarProfileId, setRadarProfileId] = useState("active");
  const [radarPeriod, setRadarPeriod] = useState("30");
  const [resources, setResources] = useState({ profile: null, appointments: [], documents: [], medications: [] });
  const [pinnedConversationIds, setPinnedConversationIds] = useState([]);
  const [openConversationMenuId, setOpenConversationMenuId] = useState("");
  const [meta, setMeta] = useState({
    disclaimer: "Klinip IA entrega información orientativa y no reemplaza la evaluación de un profesional de salud.",
    model: "context-fallback",
    mode: "fallback",
    activeProfileName: "",
    sources: [],
  });
  const scrollRef = useRef(null);
  const inputZoneRef = useRef(null);
  const inputFieldRef = useRef(null);
  const fileTimerRef = useRef(null);
  const resourcesRequestRef = useRef(null);
  const conversationsRequestRef = useRef(null);
  const insightsRequestRef = useRef(null);
  const conversationMenuRef = useRef(null);

  const mapHistoryToMessages = (items) => {
    if (!Array.isArray(items) || !items.length) return [INITIAL_MESSAGE];
    return items.map((item) => ({
      id: item.id,
      role: item.role === "user" ? "user" : "assistant",
      content: item.content,
      references: Array.isArray(item?.metadata_json?.references) ? item.metadata_json.references : [],
      createdAt: item.created_at || null,
      conversationId: item.conversation_id || "",
      conversationTitle: item.conversation_title || "",
    }));
  };

  const persistPinnedConversations = (nextIds) => {
    const storageKey = getPinnedConversationStorageKey(resources.profile?.id);
    const uniqueIds = Array.from(new Set((nextIds || []).filter(Boolean)));
    setPinnedConversationIds(uniqueIds);
    try {
      localStorage.setItem(storageKey, JSON.stringify(uniqueIds));
    } catch {
      // noop
    }
  };

  const loadConversation = async (targetConversationId, summaryItems = conversations) => {
    if (!targetConversationId) {
      setConversationId("");
      setConversationTitle("");
      setMessages([INITIAL_MESSAGE]);
      return;
    }

    const historyItems = await getAiHistory(targetConversationId).catch(() => []);
    setMessages(mapHistoryToMessages(historyItems));
    setConversationId(targetConversationId);
    setConversationTitle(
      historyItems?.[0]?.conversation_title ||
      summaryItems.find((item) => item.conversation_id === targetConversationId)?.title ||
      ""
    );
  };

  const loadInsights = async (resolvedProfileId, mountedRef = () => true) => {
    if (insightsRequestRef.current) {
      return insightsRequestRef.current;
    }
    insightsRequestRef.current = (async () => {
      const [radar, adherence, docIntel, reports] = await Promise.all([
        getAiHealthRadar(resolvedProfileId || undefined).catch(() => []),
        getAiAdherence().catch(() => ({})),
        getAiDocumentIntelligence().catch(() => []),
        getAiClinicalReports().catch(() => []),
      ]);

      if (!mountedRef()) return;

      setHealthRadar(Array.isArray(radar) ? radar : []);
      setAdherenceSummary(adherence || {});
      setDocumentIntelligence(Array.isArray(docIntel) ? docIntel : []);
      setClinicalReports(Array.isArray(reports) ? reports : []);
    })();

    try {
      await insightsRequestRef.current;
    } finally {
      insightsRequestRef.current = null;
    }
  };

  useEffect(() => {
    let mounted = true;
    const loadResources = async () => {
      if (resourcesRequestRef.current) {
        return resourcesRequestRef.current;
      }
      resourcesRequestRef.current = (async () => {
        const [profile, profiles] = await Promise.all([
          getActiveHealthProfile().catch(() => null),
          getHealthProfiles().catch(() => []),
        ]);
        const [appointments, documents, medications] = await Promise.all([
          getAppointments().catch(() => []),
          getDocuments().catch(() => []),
          getMedications().catch(() => []),
        ]);
        if (!mounted) return;

        setResources({
          profile,
          appointments: Array.isArray(appointments) ? appointments : [],
          documents: Array.isArray(documents) ? documents : [],
          medications: Array.isArray(medications) ? medications : [],
        });
        setRadarProfiles(Array.isArray(profiles) ? profiles : []);

        if (profile?.full_name) {
          setMeta((prev) => ({ ...prev, activeProfileName: profile.full_name }));
        }

        const resolvedRadarProfileId = radarProfileId === "active" ? profile?.id : Number(radarProfileId);
        window.setTimeout(() => {
          loadInsights(resolvedRadarProfileId, () => mounted).catch((error) => {
            console.error("No se pudieron cargar insights IA", error);
          });
        }, 150);
      })();

      try {
        await resourcesRequestRef.current;
      } finally {
        resourcesRequestRef.current = null;
      }
    };

    const refreshConversations = async () => {
      if (conversationsRequestRef.current) {
        return conversationsRequestRef.current;
      }
      conversationsRequestRef.current = (async () => {
        const items = await getAiConversations().catch(() => []);
        if (!mounted) return [];
        const safeItems = Array.isArray(items) ? items : [];
        setConversations(safeItems);
        return safeItems;
      })();

      try {
        return await conversationsRequestRef.current;
      } finally {
        conversationsRequestRef.current = null;
      }
    };

    const loadAll = async () => {
      setHistoryLoading(true);
      try {
        const safeConversations = await refreshConversations();
        if (!mounted) return;

        if (safeConversations.length) {
          const targetConversationId = safeConversations[0].conversation_id;
          const historyItems = await getAiHistory(targetConversationId).catch(() => []);
          if (!mounted) return;
          setConversationId(targetConversationId);
          setConversationTitle(safeConversations[0].title || "");
          setMessages(mapHistoryToMessages(historyItems));
        } else {
          setConversationId("");
          setConversationTitle("");
          setMessages([INITIAL_MESSAGE]);
        }

        await loadResources();
      } catch (error) {
        if (!mounted) return;
        console.error("No se pudo cargar Klinip IA", error);
        setMessages([INITIAL_MESSAGE]);
      } finally {
        if (mounted) setHistoryLoading(false);
      }
    };

    const handleWindowSync = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadResources().catch((error) => {
        console.error("No se pudieron refrescar recursos IA", error);
      });
      refreshConversations()
        .catch((error) => {
          console.error("No se pudieron refrescar conversaciones IA", error);
        });
    };

    loadAll();
    window.addEventListener("focus", handleWindowSync);
    document.addEventListener("visibilitychange", handleWindowSync);

    return () => {
      mounted = false;
      window.removeEventListener("focus", handleWindowSync);
      document.removeEventListener("visibilitychange", handleWindowSync);
      if (fileTimerRef.current) clearTimeout(fileTimerRef.current);
    };
  }, [radarProfileId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setIsAtLatest(true);
  }, [messages, loading, historyLoading]);

  const hasConversation = useMemo(() => messages.some((message) => String(message.id) !== "welcome"), [messages]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !hasConversation) {
      setIsAtLatest(true);
      return undefined;
    }

    const updateScrollState = () => {
      const distanceToBottom = scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
      setIsAtLatest(distanceToBottom <= 56);
    };

    updateScrollState();
    scrollElement.addEventListener("scroll", updateScrollState, { passive: true });
    return () => scrollElement.removeEventListener("scroll", updateScrollState);
  }, [hasConversation, messages.length, historyLoading]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 980) {
        setMobilePanelOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const storageKey = getPinnedConversationStorageKey(resources.profile?.id);
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setPinnedConversationIds(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
    } catch {
      setPinnedConversationIds([]);
    }
  }, [resources.profile?.id]);

  useEffect(() => {
    if (!openConversationMenuId) return undefined;
    const handlePointerDown = (event) => {
      if (conversationMenuRef.current?.contains(event.target)) return;
      setOpenConversationMenuId("");
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpenConversationMenuId("");
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openConversationMenuId]);

  const upcomingAppointments = useMemo(() => getUpcomingAppointments(resources.appointments), [resources.appointments]);
  const nextAppointment = upcomingAppointments[0] || null;
  const activeMedications = useMemo(() => getActiveMedications(resources.medications), [resources.medications]);
  const activeRadarAlerts = useMemo(
    () => (Array.isArray(healthRadar) ? healthRadar.filter((item) => item.status === "active") : []),
    [healthRadar]
  );
  const filteredRadarAlerts = useMemo(() => {
    const cutoff = getPeriodCutoff(radarPeriod);
    return activeRadarAlerts.filter((item) => {
      if (!cutoff) return true;
      const stamp = parseDate(item.detected_at || item.updated_at);
      return stamp ? stamp >= cutoff : false;
    });
  }, [activeRadarAlerts, radarPeriod]);
  const topDocumentInsights = useMemo(() => documentIntelligence.slice(0, 4), [documentIntelligence]);
  const lowAdherenceItems = Array.isArray(adherenceSummary?.low_adherence_items)
    ? adherenceSummary.low_adherence_items
    : [];
  const overallAdherenceRate =
    adherenceSummary?.overall_adherence_rate === null || adherenceSummary?.overall_adherence_rate === undefined
      ? null
      : Math.round(Number(adherenceSummary.overall_adherence_rate) || 0);

  const inferredSources = useMemo(() => {
    if (Array.isArray(meta.sources) && meta.sources.length) return meta.sources;
    return [
      { key: "documents", label: "Documentos", count: resources.documents.length, enabled: true },
      { key: "medications", label: "Medicamentos", count: resources.medications.length, enabled: true },
      { key: "appointments", label: "Citas y actividades", count: resources.appointments.length, enabled: true },
      {
        key: "timeline",
        label: "Historial clínico",
        count: resources.appointments.length + resources.documents.length + resources.medications.length,
        enabled: true,
      },
        {
          key: "reminders",
          label: "Recordatorios",
          count: upcomingAppointments.length + activeMedications.length,
          enabled: true,
        },
        { key: "radar", label: "Radar de salud", count: activeRadarAlerts.length, enabled: true },
      ];
  }, [meta.sources, resources.documents.length, resources.medications.length, resources.appointments.length, upcomingAppointments.length, activeMedications.length, activeRadarAlerts.length]);

  const contextTags = useMemo(
    () => [
      { key: "documents", label: `${sourceCount(inferredSources, "documents")} ${sourceLabel(inferredSources, "documents", "Documentos").toLowerCase()}`, tone: "blue" },
      { key: "medications", label: `${sourceCount(inferredSources, "medications")} ${sourceLabel(inferredSources, "medications", "Medicamentos").toLowerCase()}`, tone: "teal" },
      { key: "appointments", label: `${sourceCount(inferredSources, "appointments")} citas próximas`, tone: "violet" },
      { key: "timeline", label: `${sourceCount(inferredSources, "timeline")} registros clínicos`, tone: "amber" },
    ],
    [inferredSources]
  );

  const scoreData = useMemo(() => {
    const medicationScore = overallAdherenceRate ?? (activeMedications.length ? 100 : 35);
    const documentScore = Math.min(100, resources.documents.length * 20);
    const appointmentScore = nextAppointment ? 100 : 25;
    return {
      medicationScore,
      documentScore,
      appointmentScore,
      total: Math.round((medicationScore + documentScore + appointmentScore) / 3),
    };
  }, [activeMedications.length, resources.documents.length, nextAppointment, overallAdherenceRate]);

  const sortedConversations = useMemo(() => {
    const pinnedOrder = new Map(pinnedConversationIds.map((id, index) => [id, index]));
    return [...conversations].sort((left, right) => {
      const leftPinned = pinnedOrder.has(left.conversation_id);
      const rightPinned = pinnedOrder.has(right.conversation_id);
      if (leftPinned && rightPinned) {
        return pinnedOrder.get(left.conversation_id) - pinnedOrder.get(right.conversation_id);
      }
      if (leftPinned) return -1;
      if (rightPinned) return 1;
      const leftStamp = parseDate(left.updated_at || left.created_at)?.getTime() || 0;
      const rightStamp = parseDate(right.updated_at || right.created_at)?.getTime() || 0;
      return rightStamp - leftStamp;
    });
  }, [conversations, pinnedConversationIds]);

  const submitPrompt = async (promptValue) => {
    const prompt = (promptValue || "").trim();
    if (!prompt || loading) return;

    const attachmentName = attachedFile?.name || "";
    const finalPrompt = attachmentName ? `${prompt}\n\nReferencia local preparada: ${attachmentName}.` : prompt;

    const userMessageId = `user-${Date.now()}`;
    const nextUserMessage = {
      id: userMessageId,
      role: "user",
      content: prompt,
      references: [],
      createdAt: new Date().toISOString(),
      attachmentName,
      conversationId,
      conversationTitle,
    };

    const historyForApi = messages
      .filter((item) => (item.role === "user" || item.role === "assistant") && String(item.id) !== "welcome")
      .map((item) => ({ role: item.role, content: item.content }));

    setMessages((prev) => [...prev, nextUserMessage]);
    setInput("");
    setAttachedFile(null);
    setScanVisible(false);
    setLoading(true);

    try {
      const response = await sendAiChat({
        message: finalPrompt,
        history: historyForApi,
        conversation_id: conversationId || undefined,
      });
      const nextConversationId = response?.conversation_id || conversationId || "";
      const nextConversationTitle = response?.conversation_title || conversationTitle || prompt;
      setMeta((prev) => ({
        disclaimer: response?.disclaimer || prev.disclaimer,
        model: response?.model || "context-fallback",
        mode: response?.mode || "fallback",
        activeProfileName: response?.active_profile_name || prev.activeProfileName || resources.profile?.full_name || "",
        sources: Array.isArray(response?.sources) ? response.sources : prev.sources,
      }));
      setConversationId(nextConversationId);
      setConversationTitle(nextConversationTitle);
      setMessages((prev) => [
        ...prev.map((item) => (
          item.id === userMessageId && response?.user_message_created_at
            ? {
                ...item,
                createdAt: response.user_message_created_at,
                conversationId: nextConversationId,
                conversationTitle: nextConversationTitle,
              }
            : item
        )),
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: cleanAssistantText(response?.reply || "No pude generar una respuesta en este momento. Intenta reformular tu consulta."),
          references: Array.isArray(response?.references) ? response.references : [],
          createdAt: response?.assistant_message_created_at || new Date().toISOString(),
          conversationId: nextConversationId,
          conversationTitle: nextConversationTitle,
        },
      ]);
      const nextConversations = await getAiConversations().catch(() => []);
      setConversations(Array.isArray(nextConversations) ? nextConversations : []);
      const profile = await getActiveHealthProfile().catch(() => null);
      const [appointments, documents, medications] = await Promise.all([
        getAppointments().catch(() => []),
        getDocuments().catch(() => []),
        getMedications().catch(() => []),
      ]);
      setResources({
        profile,
        appointments: Array.isArray(appointments) ? appointments : [],
        documents: Array.isArray(documents) ? documents : [],
        medications: Array.isArray(medications) ? medications : [],
      });
      const resolvedRadarProfileId = radarProfileId === "active" ? profile?.id : Number(radarProfileId);
      loadInsights(resolvedRadarProfileId).catch((refreshError) => {
        console.error("No se pudieron refrescar insights IA", refreshError);
      });
    } catch (error) {
      console.error("No se pudo consultar Klinip IA", error);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content:
              error?.code === "ECONNABORTED"
                ? "Klinip IA está tardando más de lo normal en responder. Intenta de nuevo en unos segundos."
                : "No pude consultar Klinip IA en este momento. Revisa tu conexión o intenta nuevamente.",
          references: [],
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (event) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setAttachedFile(selected);
    setScanVisible(true);
    if (fileTimerRef.current) clearTimeout(fileTimerRef.current);
    fileTimerRef.current = setTimeout(() => setScanVisible(false), 2800);
  };

  const nextAppointmentPrompt = nextAppointment
    ? `Prepara un resumen para mi cita de ${formatDateTime(nextAppointment.date_time)}`
    : "¿Cuándo es mi próxima cita?";
  const medsAlertPrompt = activeMedications.length > 1
    ? "Revisa si tengo interacciones entre mis medicamentos actuales"
    : "Resume mis medicamentos activos";

  const jumpToComposer = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
    setTimeout(() => {
      inputFieldRef.current?.focus();
    }, 180);
  };

  const handleGenerateReport = async (reportType = "consulta_medica", periodDays = 30) => {
    if (reportBusy) return;
    setReportBusy(true);
    try {
      const report = await generateAiClinicalReport({ report_type: reportType, period_days: periodDays });
      setClinicalReports((prev) => [report, ...prev.filter((item) => item.id !== report.id)].slice(0, 10));
    } catch (error) {
      console.error("No se pudo generar el reporte clínico", error);
    } finally {
      setReportBusy(false);
    }
  };

  const handleDownloadReport = async (reportId, filename) => {
    try {
      const blob = await getAiClinicalReportPdf(reportId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || `klinip-reporte-${reportId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("No se pudo descargar el reporte clínico", error);
    }
  };

  const handleRefreshRadar = async () => {
    if (radarRefreshing) return;
    setRadarRefreshing(true);
    try {
      const resolvedProfileId = radarProfileId === "active" ? resources.profile?.id : Number(radarProfileId);
      const items = await runAiHealthRadar(resolvedProfileId || undefined);
      setHealthRadar(Array.isArray(items) ? items : []);
    } catch (error) {
      console.error("No se pudo recalcular el radar de salud", error);
    } finally {
      setRadarRefreshing(false);
    }
  };

  const handleSelectConversation = async (targetConversationId) => {
    if (!targetConversationId || loading || historyLoading) return;
    setOpenConversationMenuId("");
    setHistoryLoading(true);
    try {
      await loadConversation(targetConversationId);
      setRightTab("chat");
      setMobilePanelOpen(false);
    } catch (error) {
      console.error("No se pudo abrir la conversación", error);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleDeleteConversation = async (event, targetConversationId) => {
    event.stopPropagation();
    if (!targetConversationId || loading) return;
    setOpenConversationMenuId("");
    try {
      await deleteAiConversation(targetConversationId);
      persistPinnedConversations(pinnedConversationIds.filter((item) => item !== targetConversationId));
      const nextConversations = await getAiConversations().catch(() => []);
      const safeConversations = Array.isArray(nextConversations) ? nextConversations : [];
      setConversations(safeConversations);
      if (targetConversationId === conversationId) {
        if (safeConversations.length) {
          await loadConversation(safeConversations[0].conversation_id, safeConversations);
        } else {
          setConversationId("");
          setConversationTitle("");
          setMessages([INITIAL_MESSAGE]);
        }
      }
    } catch (error) {
      console.error("No se pudo eliminar la conversación", error);
    }
  };

  const handleToggleConversationMenu = (event, targetConversationId) => {
    event.stopPropagation();
    setOpenConversationMenuId((prev) => (prev === targetConversationId ? "" : targetConversationId));
  };

  const handlePinConversation = (event, targetConversationId) => {
    event.stopPropagation();
    const isPinned = pinnedConversationIds.includes(targetConversationId);
    if (isPinned) {
      persistPinnedConversations(pinnedConversationIds.filter((item) => item !== targetConversationId));
    } else {
      persistPinnedConversations([targetConversationId, ...pinnedConversationIds]);
    }
    setOpenConversationMenuId("");
  };

  const handleRenameConversation = async (event, targetConversationId, currentTitle) => {
    event.stopPropagation();
    const nextTitle = window.prompt(
      "Nuevo nombre de la conversación",
      cleanUiText(currentTitle, "Nueva conversación")
    );
    const normalizedTitle = cleanUiText(nextTitle);
    if (!normalizedTitle || normalizedTitle === cleanUiText(currentTitle, "Nueva conversación")) {
      setOpenConversationMenuId("");
      return;
    }
    try {
      const updated = await renameAiConversation(targetConversationId, { title: normalizedTitle });
      setConversations((prev) => prev.map((item) => (
        item.conversation_id === targetConversationId
          ? { ...item, title: updated?.title || normalizedTitle }
          : item
      )));
      if (conversationId === targetConversationId) {
        setConversationTitle(updated?.title || normalizedTitle);
        setMessages((prev) => prev.map((item) => (
          item.conversationId === targetConversationId
            ? { ...item, conversationTitle: updated?.title || normalizedTitle }
            : item
        )));
      }
    } catch (error) {
      console.error("No se pudo renombrar la conversación", error);
    } finally {
      setOpenConversationMenuId("");
    }
  };

  const handleExportConversation = async (event, targetConversationId, currentTitle) => {
    event.stopPropagation();
    try {
      const resolvedHistoryItems = targetConversationId === conversationId
        ? messages.filter((item) => String(item.id) !== "welcome")
        : await (async () => {
            const rawItems = await getAiHistory(targetConversationId).catch(() => []);
            return Array.isArray(rawItems) && rawItems.length ? mapHistoryToMessages(rawItems) : [];
          })();
      if (!resolvedHistoryItems.length) return;

      const title = cleanUiText(currentTitle, "Nueva conversación");
      const content = [
        `Klinip IA - ${title}`,
        `Exportado: ${new Date().toLocaleString("es-CL")}`,
        "",
        ...resolvedHistoryItems.map((item) => {
          const author = item.role === "user" ? "Tú" : "Klinip IA";
          const body = item.role === "assistant" ? cleanAssistantText(item.content) : cleanUiText(item.content);
          return `[${formatConversationStamp(item.createdAt)}] ${author}: ${body}`;
        }),
      ].join("\n");

      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "klinip-chat"}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("No se pudo exportar la conversación", error);
    } finally {
      setOpenConversationMenuId("");
    }
  };

  const handleStartNewConversation = () => {
    setConversationId("");
    setConversationTitle("");
    setMessages([INITIAL_MESSAGE]);
    setRightTab("chat");
    setMobilePanelOpen(false);
    setOpenConversationMenuId("");
    setTimeout(() => inputFieldRef.current?.focus(), 50);
  };

  return (
    <div className="ai-page ai-copilot-page">
      <section className="ai-copilot-shell">
        <div className="ai-copilot-main">
          <div className="ai-copilot-stage">
            <div className="ai-mobile-topbar">
              <div className="ai-mobile-topbar-copy">
                <span>IA Klinip</span>
                <strong>{meta.activeProfileName || resources.profile?.full_name || "Perfil activo"}</strong>
              </div>
              <button
                type="button"
                className="ai-mobile-panel-btn"
                onClick={() => setMobilePanelOpen(true)}
                aria-label="Abrir contexto actual"
              >
                <svg fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24">
                  <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            {!hasConversation ? (
              <div className="ai-landing">
                <div className="ai-landing-center">
                  <h2 className="ai-landing-title">¿En qué te ayudo hoy?</h2>
                  <p className="ai-landing-subtitle">
                    Consulta sobre tus medicamentos, documentos, citas o historial. Soy tu copiloto de salud.
                  </p>
                  <div className="ai-landing-safe">
                    <span className="ai-safe-dot" />
                    <span>{cleanUiText(meta.disclaimer)}</span>
                  </div>
                </div>

                <div className="ai-context-strip">
                  {contextTags.map((tag) => (
                    <button key={tag.key} type="button" className={`ai-context-tag tone-${tag.tone}`} onClick={() => submitPrompt(`Resume mi ${tag.label}`)}>
                      <span className="ai-context-dot" />
                      <span>{tag.label}</span>
                    </button>
                  ))}
                </div>

                <section className="ai-quick-section">
                  <p className="ai-section-kicker">Acciones rápidas</p>
                  <div className="ai-quick-grid">
                    {QUICK_ACTIONS.map((item) => (
                      <button key={item.id} type="button" className="ai-quick-card" onClick={() => submitPrompt(item.prompt)}>
                        <span className="ai-quick-icon">{item.token}</span>
                        <span className="ai-quick-copy">
                          <strong>{item.title}</strong>
                          <small>{item.subtitle}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="ai-info-row">
                  <button type="button" className="ai-info-card" onClick={() => submitPrompt(nextAppointmentPrompt)}>
                    <span className="ai-info-label tone-violet">Próxima cita</span>
                    <strong>{nextAppointment ? cleanUiText(nextAppointment.specialty, "Atención agendada") : "Sin cita próxima"}</strong>
                    <small>{nextAppointment ? formatDateTime(nextAppointment.date_time) : "Puedo ayudarte a revisar tu agenda clínica."}</small>
                    <em>
                      {nextAppointment && daysUntil(nextAppointment.date_time) !== null
                        ? `En ${Math.max(daysUntil(nextAppointment.date_time), 0)} días`
                        : "Preparar con IA"}
                    </em>
                  </button>

                  <button type="button" className="ai-info-card" onClick={() => submitPrompt(medsAlertPrompt)}>
                    <span className="ai-info-label tone-amber">Revisión sugerida</span>
                    <strong>{activeMedications.length > 1 ? "Interacciones y adherencia" : "Plan de medicamentos"}</strong>
                    <small>
                      {activeMedications.length > 1
                        ? `${activeMedications.length} medicamentos activos para revisar`
                        : "Puedo resumir tu tratamiento actual"}
                    </small>
                    <em>{activeMedications.length > 1 ? "Ver con IA" : "Generar resumen"}</em>
                  </button>

                  <button type="button" className="ai-info-card" onClick={() => handleGenerateReport("consulta_medica", 30)}>
                    <span className="ai-info-label tone-blue">Reporte clínico</span>
                    <strong>{clinicalReports[0] ? "Actualizar reporte" : "Generar primer reporte"}</strong>
                    <small>
                      {clinicalReports[0]
                        ? `Último: ${formatShortDate(clinicalReports[0].created_at)}`
                        : "Genera un PDF para llevar a consulta"}
                    </small>
                    <em>{reportBusy ? "Generando..." : "Crear PDF"}</em>
                  </button>
                </section>
              </div>
            ) : (
              <div className="ai-chat" ref={scrollRef}>
                <div className="ai-chat-inner">
                  {messages.map((message) => (
                    <article key={message.id} className={`ai-message ${message.role === "user" ? "is-user" : "is-assistant"}`}>
                      <div className={`ai-message-avatar ${message.role === "user" ? "is-user" : "is-ai"}`}>{message.role === "user" ? "TU" : "KI"}</div>
                      <div className="ai-message-column">
                        <div className={`ai-message-bubble ${message.role === "user" ? "is-user" : "is-ai"}`}>
                          <p>{message.role === "assistant" ? cleanAssistantText(message.content) : cleanUiText(message.content)}</p>
                          {message.attachmentName ? <div className="ai-inline-attachment">{message.attachmentName}</div> : null}
                          {message.role === "assistant" && Array.isArray(message.references) && message.references.length > 0 ? (
                            <div className="ai-reference-list">
                              {message.references.map((reference, index) => (
                                <div key={`${message.id}-${reference.kind}-${index}`} className="ai-reference-chip">
                                  <strong>{reference.label}</strong>
                                  {reference.detail ? <span>{reference.detail}</span> : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="ai-message-time">
                          {message.role === "user" ? "Tu" : "Klinip IA"} - {formatMessageTime(message.createdAt)}
                        </div>
                      </div>
                    </article>
                  ))}

                  {loading ? (
                    <article className="ai-message is-assistant">
                      <div className="ai-message-avatar is-ai">KI</div>
                      <div className="ai-message-column">
                        <div className="ai-message-bubble is-ai is-loading">
                          <span />
                          <span />
                          <span />
                        </div>
                      </div>
                    </article>
                  ) : null}
                </div>
                {!isAtLatest ? (
                  <div className="ai-chat-jump-slot">
                    <button
                      type="button"
                      className="ai-jump-composer-btn"
                      onClick={jumpToComposer}
                      aria-label="Bajar a la parte mas reciente del chat"
                      title="Bajar a la parte mas reciente del chat"
                    >
                      <svg fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            <div className="ai-input-zone" ref={inputZoneRef}>
              <form className="ai-input-shell" onSubmit={(event) => { event.preventDefault(); submitPrompt(input); }}>
                {(attachedFile || scanVisible) ? (
                  <div className={`ai-upload-strip ${attachedFile ? "has-file" : ""}`}>
                    {attachedFile ? (
                      <div className="ai-upload-chip">
                        <span>DOC</span>
                        <strong>{attachedFile.name}</strong>
                        <button type="button" onClick={() => setAttachedFile(null)}>x</button>
                      </div>
                    ) : null}
                    {scanVisible ? (
                      <div className="ai-scan-badge">
                        <span className="ai-scan-dot" />
                        <span>Preparando contexto local</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="ai-input-row">
                  <textarea
                    ref={inputFieldRef}
                    className="ai-input-field"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Escribe una pregunta o prepara un documento para consultar..."
                    rows={1}
                    onInput={(event) => {
                      const target = event.currentTarget;
                      target.style.height = "auto";
                      target.style.height = `${Math.min(target.scrollHeight, 92)}px`;
                    }}
                  />

                  <div className="ai-input-actions">
                    <label className="ai-icon-btn" title="Preparar documento">
                      <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" strokeLinecap="round" /></svg>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange} />
                    </label>
                    <button type="button" className="ai-icon-btn is-disabled" title="Nota de voz disponible pronto">
                      <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" strokeLinecap="round" /></svg>
                    </button>
                    <button className="ai-send-btn" type="submit" disabled={loading || !input.trim()}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </div>
                </div>
              </form>

              <div className="ai-input-footer">
                <span className="ai-safe-dot" />
                <span>La respuesta usa documentos, medicamentos, citas e historial según permisos del plan.</span>
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          className={`ai-mobile-panel-backdrop ${mobilePanelOpen ? "is-visible" : ""}`}
          aria-label="Cerrar contexto actual"
          onClick={() => setMobilePanelOpen(false)}
        />

        <aside className={`ai-right-panel ${mobilePanelOpen ? "is-mobile-open" : ""}`}>
          <div className="ai-right-profile">
            <div className="ai-right-avatar">{(meta.activeProfileName || resources.profile?.full_name || "KP").slice(0, 2).toUpperCase()}</div>
            <div className="ai-right-profile-copy">
              <strong>{meta.activeProfileName || resources.profile?.full_name || "Perfil activo"}</strong>
              <span>Contexto actual de Klinip IA</span>
            </div>
            <button
              type="button"
              className="ai-right-close"
              aria-label="Cerrar contexto actual"
              onClick={() => setMobilePanelOpen(false)}
            >
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="ai-right-tabs">
            <button type="button" className={rightTab === "chat" ? "is-active" : ""} onClick={() => setRightTab("chat")}>Chat</button>
            <button type="button" className={rightTab === "today" ? "is-active" : ""} onClick={() => setRightTab("today")}>Hoy</button>
            <button type="button" className={rightTab === "meds" ? "is-active" : ""} onClick={() => setRightTab("meds")}>Meds</button>
            <button type="button" className={rightTab === "docs" ? "is-active" : ""} onClick={() => setRightTab("docs")}>Docs</button>
          </div>

          {rightTab === "today" ? (
            <div className="ai-right-body">
              <section className="ai-widget ai-score-widget">
                <div className="ai-widget-head"><span>Estado del perfil</span></div>
                <div className="ai-score-row">
                  <Ring value={scoreData.total} />
                  <div className="ai-score-copy">
                    <strong>{scoreData.total >= 70 ? "Buen seguimiento" : "Seguimiento parcial"}</strong>
                    <p>Resumen estimado usando medicamentos, documentos y agenda registrados.</p>
                  </div>
                </div>
                <div className="ai-progress-list">
                  <div className="ai-progress-row"><span>Medicacion</span><div className="ai-progress-track"><div className="ai-progress-fill tone-teal" style={{ width: `${scoreData.medicationScore}%` }} /></div><strong>{scoreData.medicationScore}%</strong></div>
                  <div className="ai-progress-row"><span>Documentos</span><div className="ai-progress-track"><div className="ai-progress-fill tone-blue" style={{ width: `${scoreData.documentScore}%` }} /></div><strong>{scoreData.documentScore}%</strong></div>
                  <div className="ai-progress-row"><span>Citas</span><div className="ai-progress-track"><div className="ai-progress-fill tone-violet" style={{ width: `${scoreData.appointmentScore}%` }} /></div><strong>{scoreData.appointmentScore}%</strong></div>
                </div>
              </section>

              <section className="ai-widget">
                <div className="ai-widget-head">
                  <span>Radar inteligente</span>
                  <button type="button" onClick={handleRefreshRadar}>{radarRefreshing ? "Actualizando" : "Recalcular"}</button>
                </div>
                <div className="ai-radar-filters">
                  <select
                    className="ai-filter-select"
                    value={radarProfileId}
                    onChange={(event) => setRadarProfileId(event.target.value)}
                  >
                    <option value="active">Perfil activo</option>
                    {radarProfiles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.full_name || `Perfil ${item.id}`}
                      </option>
                    ))}
                  </select>
                  <select
                    className="ai-filter-select"
                    value={radarPeriod}
                    onChange={(event) => setRadarPeriod(event.target.value)}
                  >
                    {RADAR_PERIOD_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                {filteredRadarAlerts.length ? (
                  <div className="ai-radar-list">
                    {filteredRadarAlerts.slice(0, 3).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`ai-radar-card severity-${item.severity || "low"}`}
                          onClick={() => submitPrompt(`Explícame la alerta ${cleanUiText(item.title)}`)}
                        >
                          <div className="ai-radar-card-head">
                            <strong>{cleanUiText(item.title)}</strong>
                            <span>{getSeverityLabel(item.severity)}</span>
                          </div>
                          <p>{cleanUiText(item.description)}</p>
                          <small>{formatConversationStamp(item.detected_at || item.updated_at)}</small>
                          {item.recommended_action ? <em>{cleanUiText(item.recommended_action)}</em> : null}
                        </button>
                      ))}
                    </div>
                ) : <div className="ai-empty-note">No hay alertas activas en el radar de salud para esos filtros.</div>}
              </section>

              <section className="ai-widget">
                <div className="ai-widget-head">
                  <span>Próxima cita</span>
                  <button type="button" onClick={() => submitPrompt(nextAppointmentPrompt)}>Ver con IA</button>
                </div>
                {nextAppointment ? (
                  <div className="ai-next-card">
                    <em>{Math.max(daysUntil(nextAppointment.date_time) || 0, 0)} días</em>
                    <strong>{cleanUiText(nextAppointment.specialty, APPOINTMENT_TYPE_LABELS[nextAppointment.type] || "Atención")}</strong>
                    <p>{cleanUiText(nextAppointment.center, "Centro por confirmar")}</p>
                    <span>{formatDateTime(nextAppointment.date_time)}</span>
                  </div>
                ) : <div className="ai-empty-note">No hay citas próximas registradas.</div>}
              </section>

              <section className="ai-widget">
                <div className="ai-widget-head">
                  <span>Medicamentos hoy</span>
                  <button type="button" onClick={() => submitPrompt("Resume mi plan de medicamentos activo")}>Plan</button>
                </div>
                <div className="ai-resource-list">
                  {activeMedications.slice(0, 3).map((medication) => (
                    <div key={medication.id} className="ai-resource-item">
                      <div className="ai-resource-badge tone-teal">MED</div>
                      <div className="ai-resource-copy">
                        <strong>{medication.name}</strong>
                        <span>{medication.dose || medication.frequency || "Seguimiento activo"}</span>
                      </div>
                    </div>
                  ))}
                  {!activeMedications.length ? <div className="ai-empty-note">No hay medicamentos activos en el perfil.</div> : null}
                </div>
                {activeMedications.length > 1 ? (
                  <button type="button" className="ai-alert-card" onClick={() => submitPrompt(medsAlertPrompt)}>
                    <strong>Revisión sugerida</strong>
                    <span>Verifica interacciones y orden del tratamiento con IA.</span>
                  </button>
                ) : null}
              </section>

              <section className="ai-widget">
                <div className="ai-widget-head">
                  <span>Reportes clínicos</span>
                  <button type="button" onClick={() => handleGenerateReport("consulta_medica", 30)}>
                    {reportBusy ? "Generando" : "Nuevo"}
                  </button>
                </div>
                <div className="ai-report-list">
                  {clinicalReports.slice(0, 4).map((report) => (
                    <div key={report.id} className="ai-report-item">
                      <div className="ai-report-copy">
                        <strong>{formatReportLabel(report.report_type)}</strong>
                        <span>{formatConversationStamp(report.created_at)}</span>
                      </div>
                      <button
                        type="button"
                        className="ai-report-download"
                        onClick={() => handleDownloadReport(report.id, report.pdf_filename)}
                      >
                        PDF
                      </button>
                    </div>
                  ))}
                  {!clinicalReports.length ? <div className="ai-empty-note">Todavía no generas reportes clínicos.</div> : null}
                </div>
              </section>
            </div>
          ) : null}

          {rightTab === "meds" ? (
            <div className="ai-right-body">
              <section className="ai-widget">
                <div className="ai-widget-head">
                  <span>Adherencia</span>
                  <button type="button" onClick={() => submitPrompt("¿Cómo va mi tratamiento y adherencia?")}>Analizar</button>
                </div>
                <div className="ai-adherence-summary">
                  <div className={`ai-adherence-pill ${overallAdherenceRate !== null && overallAdherenceRate < 80 ? "is-warning" : ""}`}>
                    <strong>{overallAdherenceRate !== null ? `${overallAdherenceRate}%` : "Sin datos"}</strong>
                    <span>Últimos {adherenceSummary?.window_days || 30} días</span>
                  </div>
                  <div className="ai-adherence-copy">
                    <strong>
                      {lowAdherenceItems.length ? "Se detectaron brechas de adherencia" : "Seguimiento sin alertas principales"}
                    </strong>
                    <span>
                      {lowAdherenceItems.length
                        ? lowAdherenceItems.slice(0, 2).map((item) => `${item.name}: ${item.adherence_rate}%`).join(" - ")
                        : "Puedo revisar patrones por horario, frecuencia y continuidad del tratamiento."}
                    </span>
                  </div>
                </div>
              </section>
              <section className="ai-widget">
                <div className="ai-widget-head">
                  <span>Activos ({activeMedications.length})</span>
                  <button type="button" onClick={() => submitPrompt("Resume mis medicamentos activos")}>Resumir</button>
                </div>
                <div className="ai-resource-list">
                  {activeMedications.slice(0, 6).map((medication) => (
                    <div key={medication.id} className="ai-resource-item">
                      <div className="ai-resource-badge tone-teal">MED</div>
                      <div className="ai-resource-copy">
                        <strong>{medication.name}</strong>
                        <span>{medication.dose || "Sin dosis"} - {medication.frequency || "Sin frecuencia"}</span>
                      </div>
                    </div>
                  ))}
                  {!activeMedications.length ? <div className="ai-empty-note">No hay medicamentos activos para mostrar.</div> : null}
                </div>
              </section>
            </div>
          ) : null}

          {rightTab === "docs" ? (
            <div className="ai-right-body">
              <section className="ai-widget">
                <div className="ai-widget-head">
                  <span>Inteligencia documental</span>
                  <button type="button" onClick={() => submitPrompt("Resume mis documentos recientes")}>Resumir</button>
                </div>
                <div className="ai-resource-list">
                  {topDocumentInsights.map((document) => (
                    <button
                      key={document.id}
                      type="button"
                      className="ai-resource-item ai-resource-item-button"
                      onClick={() => submitPrompt(`Explícame mi documento ${document.document_type_inferred || "clínico"} más reciente`)}
                    >
                      <div className="ai-resource-badge tone-blue">DOC</div>
                      <div className="ai-resource-copy">
                        <strong>{cleanUiText(DOC_LABELS[document.document_type_inferred] || "Documento")}</strong>
                        <span>{cleanUiText(document.summary_plain, "Resumen no disponible")}</span>
                      </div>
                    </button>
                  ))}
                  {!topDocumentInsights.length ? <div className="ai-empty-note">Todavía no hay documentos procesados por IA.</div> : null}
                </div>
                {topDocumentInsights[0]?.abnormal_values_json?.length ? (
                  <div className="ai-doc-abnormal">
                    <strong>Valores a revisar</strong>
                    <span>
                      {topDocumentInsights[0].abnormal_values_json
                        .slice(0, 3)
                        .map((item) => `${cleanUiText(item.entity_name)}: ${cleanUiText(item.entity_value)}${item.unit ? ` ${cleanUiText(item.unit)}` : ""}`)
                        .join(" · ")}
                    </span>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {rightTab === "chat" ? (
            <div className="ai-right-body ai-right-body-chat">
              <div className="ai-chat-sidebar-head">
                <div className="ai-chat-sidebar-copy">
                  <strong>Tus chats</strong>
                  <span>{cleanUiText(conversationTitle, "Conversaciones guardadas de Klinip IA")}</span>
                </div>
                <div className="ai-chat-sidebar-actions">
                  <button type="button" className="ai-chat-sidebar-new" onClick={() => handleGenerateReport("consulta_medica", 30)}>
                    Reporte
                  </button>
                  <button type="button" className="ai-chat-sidebar-new" onClick={handleStartNewConversation}>Nuevo</button>
                </div>
              </div>

              {clinicalReports.length ? (
                <div className="ai-chat-report-strip">
                  <strong>Último reporte</strong>
                  <button type="button" onClick={() => handleDownloadReport(clinicalReports[0].id, clinicalReports[0].pdf_filename)}>
                    {formatReportLabel(clinicalReports[0].report_type)}
                  </button>
                </div>
              ) : null}

              <div className="ai-conversation-list simple">
                {sortedConversations.map((item) => (
                  <div
                    key={item.conversation_id}
                    className={`ai-conversation-item simple ${conversationId === item.conversation_id ? "is-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="ai-conversation-open simple"
                      onClick={() => handleSelectConversation(item.conversation_id)}
                      title={cleanUiText(item.title, "Nueva conversación")}
                    >
                      <span className="ai-conversation-summary">
                        <strong>
                          {pinnedConversationIds.includes(item.conversation_id) ? (
                            <span className="ai-conversation-pinned-mark" aria-hidden="true">Fijado</span>
                          ) : null}
                          <span className="ai-conversation-title-text">
                            {cleanUiText(item.title, "Nueva conversación")}
                          </span>
                        </strong>
                        <small>{formatConversationListDate(item.updated_at || item.created_at)}</small>
                      </span>
                    </button>
                    <div
                      className="ai-conversation-actions"
                      ref={openConversationMenuId === item.conversation_id ? conversationMenuRef : null}
                    >
                      <button
                        type="button"
                        className="ai-conversation-delete simple"
                        aria-label="Más acciones de conversación"
                        title={`Más acciones para ${cleanUiText(item.title, "conversación")}`}
                        onClick={(event) => handleToggleConversationMenu(event, item.conversation_id)}
                      >
                        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 6h.01M12 12h.01M12 18h.01" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      {openConversationMenuId === item.conversation_id ? (
                        <div className="ai-conversation-menu" role="menu" aria-label="Acciones de conversación">
                          <button type="button" className="ai-conversation-menu-item" onClick={() => handleSelectConversation(item.conversation_id)}>
                            Abrir
                          </button>
                          <button
                            type="button"
                            className="ai-conversation-menu-item"
                            onClick={(event) => handleRenameConversation(event, item.conversation_id, item.title)}
                          >
                            Renombrar
                          </button>
                          <button
                            type="button"
                            className="ai-conversation-menu-item"
                            onClick={(event) => handlePinConversation(event, item.conversation_id)}
                          >
                            {pinnedConversationIds.includes(item.conversation_id) ? "Quitar fijado" : "Fijar arriba"}
                          </button>
                          <button
                            type="button"
                            className="ai-conversation-menu-item"
                            onClick={(event) => handleExportConversation(event, item.conversation_id, item.title)}
                          >
                            Exportar
                          </button>
                          <button
                            type="button"
                            className="ai-conversation-menu-item is-danger"
                            onClick={(event) => handleDeleteConversation(event, item.conversation_id)}
                          >
                            Eliminar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                {!sortedConversations.length ? (
                  <div className="ai-empty-note">
                    No hay conversaciones guardadas todavía. Tu próximo mensaje iniciará un nuevo chat.
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

        </aside>
      </section>
    </div>
  );
}

