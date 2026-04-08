import React, { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  getActiveHealthProfile,
  getAiAdherence,
  getAiHealthRadar,
  getAppointments,
  createProfileNote,
  deleteProfileNote,
  getDocuments,
  getHealthProfiles,
  getMedications,
  getProfileNotes,
  updateProfileNote,
} from "../api";
import { parseDate, toLocalInputValue } from "../utils/dates";
import { subscribeClinicalDataChanged } from "../utils/clinicalRefresh";
import { canWriteProfile, isViewerProfile } from "../utils/profileAccess";
import { cleanUiText } from "../utils/textEncoding";
import {
  getMedicationScheduleSummary,
  getMedicationScheduleTimes,
  getNextMedicationDose,
} from "../utils/medicationSchedule";

const RADAR_REFRESH_POLL_LIMIT = 8;

const typeLabels = {
  cita: "Cita",
  examen: "Examen",
  tramite: "Trámite",
};

const kindToneMap = {
  appointment: "blue",
  document: "teal",
  medication: "amber",
};

function toDayLabel(date) {
  if (!date) return "";
  return date.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
  });
}

function toTimeLabel(date) {
  if (!date) return "";
  return date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toRelativeDayLabel(date) {
  if (!date) return "";
  const now = new Date();
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startDate - startNow) / 86400000);
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Mañana";
  if (diffDays > 1) return `En ${diffDays} días`;
  return "Reciente";
}

function getHealthProfileAccessLabel(item, userId) {
  if (!item) return "";
  const isOwnProfile = Number(item.owner_user_id) === Number(userId);
  if (isOwnProfile) return "propio";
  if (item.is_primary_profile) return "titular";
  const role = (item.access_role || "").toLowerCase();
  if (role === "admin") return "admin";
  return "invitado";
}

function profileInitials(name) {
  return (name || "KP")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function getMedicationReminderDate(medication) {
  return getNextMedicationDose(medication, new Date());
}

function getStatusTone(level) {
  if (level === "alert") return "alert";
  if (level === "warn") return "warn";
  return "ok";
}

function getRadarToneFromAdherence(value) {
  if (value >= 80) return "ok";
  if (value >= 45) return "warn";
  return "alert";
}

function getAlertTone(severity) {
  if (severity === "high") return "alert";
  if (severity === "medium") return "warn";
  return "ok";
}

function getAdherenceFriendlyValue(adherence, hasMedications) {
  if (!hasMedications) return "sin datos";
  if (adherence >= 80) return `Muy bien · ${adherence}%`;
  if (adherence >= 45) return `Regular · ${adherence}%`;
  return `Bajo · ${adherence}%`;
}

const friendlyAlertTitleMap = {
  medication_running_out: "Medicamento por terminarse",
  low_adherence: "Tienes dosis sin tomar",
  missed_appointment_followup: "Tienes una cita sin confirmar",
  missing_lab_result: "Faltan resultados de exámenes",
  incomplete_treatment: "Tratamiento sin cerrar",
};

function getFriendlyAlertTitle(alert) {
  return friendlyAlertTitleMap[alert.alert_type] || alert.title;
}

const alertDetailMap = {
  medication_running_out:
    "Tu medicamento está próximo a terminarse. Revisa si tienes stock suficiente para los próximos días. Si necesitas renovar la receta, agenda una consulta con tu médico antes de que se acabe.",
  low_adherence:
    "Estás tomando menos dosis de las que corresponden. Revisa tus recordatorios y asegúrate de que estén activos. Si tienes dificultades para seguir el tratamiento, coméntalo con tu médico.",
  missed_appointment_followup:
    "Tienes una cita registrada que no fue marcada como realizada. Si ya la realizaste, actualiza su estado en tu agenda. Si no fue así, considera reagendarla.",
  missing_lab_result:
    "Hay órdenes médicas sin resultados asociados. Sube los documentos de tus exámenes para que queden registrados en tu historial clínico.",
  incomplete_treatment:
    "Un tratamiento pasó su fecha estimada de término y sigue marcado como activo. Revisa si aún lo estás tomando o si ya finalizó para actualizar tu historial.",
};

function getAlertDetail(alert) {
  return alertDetailMap[alert.alert_type] || alert.recommended_action || "";
}

function getOverallHealthStatus(activeHealthAlerts, adherence, activeMedications) {
  const highAlerts = activeHealthAlerts.filter((a) => a.severity === "high");
  if (highAlerts.length > 0 || (activeMedications.length > 0 && adherence < 45)) {
    return {
      level: "alert",
      title: "Necesita tu atención hoy",
      message: "Revisa las alertas a continuación y toca cualquiera para recibir orientación de Klinip IA.",
    };
  }
  if (activeHealthAlerts.length > 0 || (activeMedications.length > 0 && adherence < 80)) {
    return {
      level: "warn",
      title: "Hay cosas para revisar",
      message: "Toca cualquier alerta para ver qué hacer. Klinip IA puede ayudarte.",
    };
  }
  if (activeMedications.length === 0) {
    return {
      level: "neutral",
      title: "Sin plan activo",
      message: "Registra tus medicamentos para comenzar el seguimiento de tu salud.",
    };
  }
  return {
    level: "ok",
    title: "¡Tu salud está al día!",
    message: "No hay alertas activas y estás tomando tus medicamentos correctamente.",
  };
}

function renderIcon(name) {
  switch (name) {
    case "medication":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
        </svg>
      );
    case "appointment":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "document":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    case "adherence":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "family":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "upload":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      );
    case "plus":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case "ai":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2a10 10 0 1 1 0 20A10 10 0 0 1 12 2z" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      );
    case "microphone":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M19 11a7 7 0 0 1-14 0" />
          <line x1="12" y1="18" x2="12" y2="21" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 15" />
        </svg>
      );
  }
}

function useTypewriter(text, { speed = 32, startDelay = 0 } = {}) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed("");
    setDone(false);
    if (!text) {
      setDone(true);
      return;
    }
    let i = 0;
    let typeId;
    const step = () => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i < text.length) {
        typeId = window.setTimeout(step, speed);
      } else {
        setDone(true);
      }
    };
    const delayId = window.setTimeout(step, startDelay);
    return () => {
      window.clearTimeout(typeId);
      window.clearTimeout(delayId);
    };
  }, [text, speed, startDelay]);
  return { displayed, done };
}

function buildContextualMessages({ firstName, activeMedications, adherence, nextAppointment, activeHealthAlerts, lowAdherenceItems, pendingDocuments }) {
  const hour = new Date().getHours();
  const msgs = [];

  if (activeMedications.length > 0 && adherence > 0) {
    if (adherence >= 80) {
      msgs.push(`Estás tomando el ${adherence}% de tus medicamentos a tiempo — ¡excelente seguimiento!`);
    } else if (adherence >= 50) {
      msgs.push(`Estás tomando el ${adherence}% de tus medicamentos. Puedes mejorar un poco más.`);
    } else {
      msgs.push(`Solo estás tomando el ${adherence}% de tus medicamentos. ¡No olvides tus dosis de hoy!`);
    }
  }

  if (nextAppointment) {
    const apptDate = parseDate(nextAppointment.date_time);
    if (apptDate) {
      const rel = toRelativeDayLabel(apptDate);
      const specialty = cleanUiText(nextAppointment.specialty || typeLabels[nextAppointment.type] || "Cita médica");
      msgs.push(`Tienes una cita próxima: ${specialty} — ${rel}.`);
    }
  }

  if (activeHealthAlerts.length > 0) {
    const n = activeHealthAlerts.length;
    msgs.push(`Hay ${n} cosa${n > 1 ? "s" : ""} importante${n > 1 ? "s" : ""} para revisar en tu salud. Toca para ver el detalle.`);
  }

  if (lowAdherenceItems.length > 0) {
    const med = cleanUiText(lowAdherenceItems[0]?.name || "");
    if (med) msgs.push(`${med} tiene dosis sin tomar. ¿Necesitas ajustar el recordatorio?`);
  }

  if (pendingDocuments > 0) {
    msgs.push(`Tienes ${pendingDocuments} documento${pendingDocuments > 1 ? "s" : ""} pendiente${pendingDocuments > 1 ? "s" : ""} de revisión.`);
  }

  if (activeMedications.length === 0) {
    msgs.push("Registra tus medicamentos para comenzar el seguimiento de tu plan de salud.");
  }

  if (msgs.length === 0) {
    const timeGreet = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
    msgs.push(`${timeGreet}, ${firstName}. Tu historial de salud está al día.`);
  }

  return msgs;
}

export default function Dashboard({
  user,
  notifications = [],
  onClearNotifications,
  onOpenNotification,
  onLogout,
  theme = "light",
  onToggleTheme,
  planInfo,
  healthProfiles: menuHealthProfiles = [],
  activeProfileId,
  onSwitchProfile,
  switchingProfile,
}) {
  const navigate = useNavigate();
  const isMountedRef = useRef(false);
  const activeProfileIdRef = useRef(null);
  const radarPollTimeoutRef = useRef(null);
  const notificationsRef = useRef(null);
  const profileMenuRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [appointments, setAppointments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [medications, setMedications] = useState([]);
  const [healthProfiles, setHealthProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [healthRadar, setHealthRadar] = useState([]);
  const [adherenceSummary, setAdherenceSummary] = useState(null);
  const [expandedAlertId, setExpandedAlertId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteColor, setNoteColor] = useState("yellow");
  const [noteReminder, setNoteReminder] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [quickNotes, setQuickNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteMenuOpenId, setNoteMenuOpenId] = useState(null);
  const notesStorageKey = activeProfile?.id ? `klinip:home-notes:${activeProfile.id}` : null;
  const canEditActiveProfile = canWriteProfile(activeProfile);
  const isReadOnlyProfile = isViewerProfile(activeProfile);
  const [greetStarted, setGreetStarted] = useState(false);
  const [greetPhase, setGreetPhase] = useState(0);
  const [aiMsgIndex, setAiMsgIndex] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  useEffect(() => {
    activeProfileIdRef.current = activeProfile?.id ? Number(activeProfile.id) : null;
  }, [activeProfile?.id]);

  useEffect(() => {
    setNotificationsOpen(false);
    setProfileMenuOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!notificationsRef.current) return;
      if (!notificationsRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    if (!profileMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!profileMenuRef.current) return;
      if (!profileMenuRef.current.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [profileMenuOpen]);

  async function loadHealthInsights(profileId) {
    const resolvedProfileId = profileId ? Number(profileId) : undefined;
    const [radarResponse, adherenceResponse] = await Promise.all([
      getAiHealthRadar(resolvedProfileId).catch(() => []),
      getAiAdherence(resolvedProfileId).catch(() => ({})),
    ]);
    if (!isMountedRef.current) {
      return adherenceResponse || {};
    }
    setHealthRadar(Array.isArray(radarResponse) ? radarResponse : []);
    setAdherenceSummary(adherenceResponse || {});
    return adherenceResponse || {};
  }

  function queueHealthInsightsRefresh(profileId, attempt = 1) {
    if (!profileId || attempt > RADAR_REFRESH_POLL_LIMIT) {
      return;
    }
    if (radarPollTimeoutRef.current) {
      window.clearTimeout(radarPollTimeoutRef.current);
    }
    const delayMs = attempt <= 3 ? 1800 : 3200;
    radarPollTimeoutRef.current = window.setTimeout(async () => {
      const summary = await loadHealthInsights(profileId);
      if (summary?.pending_refresh) {
        queueHealthInsightsRefresh(profileId, attempt + 1);
      }
    }, delayMs);
  }

  async function loadHomeSnapshot({ silent = false } = {}) {
    if (!silent && isMountedRef.current) {
      setLoading(true);
    }
    try {
      const [
        activeProfileResponse,
        profilesResponse,
        appointmentsResponse,
        documentsResponse,
        medicationsResponse,
      ] = await Promise.all([
        getActiveHealthProfile().catch(() => null),
        getHealthProfiles().catch(() => []),
        getAppointments().catch(() => []),
        getDocuments().catch(() => []),
        getMedications().catch(() => []),
      ]);
      const resolvedProfileId = activeProfileResponse?.id ? Number(activeProfileResponse.id) : null;
      const adherenceResponse = await loadHealthInsights(resolvedProfileId);
      if (!isMountedRef.current) {
        return {
          profileId: resolvedProfileId,
          pendingRefresh: Boolean(adherenceResponse?.pending_refresh),
        };
      }
      setActiveProfile(activeProfileResponse || null);
      setHealthProfiles(Array.isArray(profilesResponse) ? profilesResponse : []);
      setAppointments(Array.isArray(appointmentsResponse) ? appointmentsResponse : []);
      setDocuments(Array.isArray(documentsResponse) ? documentsResponse : []);
      setMedications(Array.isArray(medicationsResponse) ? medicationsResponse : []);
      return {
        profileId: resolvedProfileId,
        pendingRefresh: Boolean(adherenceResponse?.pending_refresh),
      };
    } finally {
      if (!silent && isMountedRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    isMountedRef.current = true;
    loadHomeSnapshot().then((result) => {
      if (result?.pendingRefresh) {
        queueHealthInsightsRefresh(result.profileId, 1);
      }
    });

    const unsubscribe = subscribeClinicalDataChanged(async (detail) => {
      const currentProfileId = activeProfileIdRef.current;
      const eventProfileId = detail?.profileId ? Number(detail.profileId) : null;
      if (currentProfileId && eventProfileId && currentProfileId !== eventProfileId) {
        return;
      }
      const result = await loadHomeSnapshot({ silent: true });
      if (result?.pendingRefresh) {
        queueHealthInsightsRefresh(result.profileId || currentProfileId || eventProfileId, 1);
      }
    });

    const handleWindowSync = async () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      const result = await loadHomeSnapshot({ silent: true });
      if (result?.pendingRefresh) {
        queueHealthInsightsRefresh(result.profileId || activeProfileIdRef.current, 1);
      }
    };

    window.addEventListener("focus", handleWindowSync);
    document.addEventListener("visibilitychange", handleWindowSync);

    return () => {
      isMountedRef.current = false;
      unsubscribe();
      window.removeEventListener("focus", handleWindowSync);
      document.removeEventListener("visibilitychange", handleWindowSync);
      if (radarPollTimeoutRef.current) {
        window.clearTimeout(radarPollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadNotes() {
      if (!activeProfile?.id) {
        setQuickNotes([]);
        return;
      }
      setNotesLoading(true);
      try {
        const response = await getProfileNotes(activeProfile.id).catch(() => []);
        let nextNotes = Array.isArray(response) ? response.filter((n) => n.visibility !== "done").slice(0, 6) : [];
        if (canEditActiveProfile && !nextNotes.length && notesStorageKey) {
          try {
            const raw = localStorage.getItem(notesStorageKey);
            const legacyNotes = raw ? JSON.parse(raw) : [];
            if (Array.isArray(legacyNotes) && legacyNotes.length) {
              const migrated = [];
              for (const legacyItem of legacyNotes.slice(0, 6)) {
                const noteText = String(legacyItem?.text || legacyItem?.note || "").trim();
                if (!noteText) continue;
                const created = await createProfileNote(activeProfile.id, {
                  note: noteText,
                  visibility: "shared",
                });
                migrated.push(created);
              }
              nextNotes = migrated;
              localStorage.removeItem(notesStorageKey);
            }
          } catch {
            // Ignore legacy migration failures and keep server state.
          }
        }
        if (cancelled) return;
        setQuickNotes(nextNotes);
      } catch {
        if (!cancelled) setQuickNotes([]);
      } finally {
        if (!cancelled) setNotesLoading(false);
      }
    }
    loadNotes();
    return () => {
      cancelled = true;
    };
  }, [activeProfile?.id, notesStorageKey, canEditActiveProfile]);

  const now = Date.now();
  const validAppointments = [...appointments]
    .filter((item) => parseDate(item.date_time))
    .sort((a, b) => parseDate(a.date_time) - parseDate(b.date_time));
  const openAppointments = validAppointments.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status !== "realizada" && status !== "cancelada";
  });
  const futureAppointments = openAppointments.filter(
    (item) => parseDate(item.date_time).getTime() >= now - 15 * 60 * 1000
  );
  const nextAppointment = futureAppointments[0] || openAppointments[0] || null;

  const activeMedications = medications.filter((item) => !item.completed);
  const adherenceTotals = activeMedications.reduce(
    (acc, item) => {
      acc.expected += Number(item.expected_doses || 0);
      acc.taken += Number(item.taken_doses || 0);
      return acc;
    },
    { expected: 0, taken: 0 }
  );
  const adherence =
    Number(adherenceSummary?.overall_adherence_rate) > 0
      ? Math.round(Number(adherenceSummary?.overall_adherence_rate))
      : adherenceTotals.expected > 0
      ? Math.round((adherenceTotals.taken / adherenceTotals.expected) * 100)
      : activeMedications.length
      ? 100
      : 0;
  const lowAdherenceItems = Array.isArray(adherenceSummary?.low_adherence_items)
    ? adherenceSummary.low_adherence_items
    : [];
  const activeHealthAlerts = Array.isArray(healthRadar) ? healthRadar.filter((item) => item.status === "active") : [];
  const overallStatus = getOverallHealthStatus(activeHealthAlerts, adherence, activeMedications);
  const pendingDocuments = documents.filter((item) => {
    const status = String(item.ocr_status || "").toLowerCase();
    return !status || status === "pending" || status === "processing" || status === "error";
  }).length;
  const linkedProfiles = Math.max((healthProfiles || []).length - 1, 0);

  const radarItems = [
    {
      key: "medications",
      icon: "medication",
      tone: activeMedications.length ? "ok" : "warn",
      label: "Medicamentos",
      value: activeMedications.length ? `${activeMedications.length} activos` : "sin plan activo",
      onClick: () => navigate("/medications"),
    },
    {
      key: "appointments",
      icon: "appointment",
      tone: nextAppointment ? "warn" : "alert",
      label: "Citas",
      value: nextAppointment
        ? `${toRelativeDayLabel(parseDate(nextAppointment.date_time)).toLowerCase()}`
        : "sin citas próximas",
      onClick: () => navigate("/appointments"),
    },
    {
      key: "documents",
      icon: "document",
      tone: pendingDocuments > 0 ? "alert" : "ok",
      label: "Documentos",
      value: pendingDocuments > 0 ? `${pendingDocuments} por subir` : "al día",
      onClick: () => navigate("/documents"),
    },
    {
      key: "adherence",
      icon: "adherence",
      tone: activeMedications.length > 0 ? getRadarToneFromAdherence(adherence) : "warn",
      label: "¿Tomas a tiempo?",
      value: getAdherenceFriendlyValue(adherence, activeMedications.length > 0),
      onClick: () => navigate("/medications"),
    },
    {
      key: "family",
      icon: "family",
      tone: activeHealthAlerts.length ? "warn" : linkedProfiles > 0 ? "warn" : "ok",
      label: "Familia",
      value: activeHealthAlerts.length
        ? `${activeHealthAlerts.length} por atender`
        : linkedProfiles > 0
        ? `${linkedProfiles} familiar${linkedProfiles > 1 ? "es" : ""}`
        : "sin alertas",
      onClick: () => navigate("/family"),
    },
  ];

  const upcomingEvents = [
    ...futureAppointments.slice(0, 4).map((item) => ({
      id: `appointment-${item.id}`,
      date: parseDate(item.date_time),
      kind: item.type === "examen" ? "exam" : "appointment",
      tag: cleanUiText(typeLabels[item.type] || "Cita"),
      title: cleanUiText(item.specialty, typeLabels[item.type] || "Actividad"),
      meta: cleanUiText([item.center, item.notes].filter(Boolean).join(" \u00B7 "), "Sin detalle adicional"),
      urgent:
        parseDate(item.date_time) &&
        new Date(parseDate(item.date_time)).toDateString() === new Date().toDateString(),
    })),
    ...activeMedications
      .map((item) => {
        const date = getMedicationReminderDate(item);
        if (!date) return null;
        return {
          id: `medication-${item.id}`,
          date,
          kind: "medication",
          tag: "Med.",
          title: `${item.name || "Medicamento"}${item.dose ? ` - ${item.dose}` : ""}`,
          meta: getMedicationScheduleSummary(item)
            ? `${getMedicationScheduleSummary(item)} - Recordatorio`
            : "Sin horario definido",
          urgent: date.toDateString() === new Date().toDateString(),
        };
      })
      .filter(Boolean),
  ]
    .sort((a, b) => a.date - b.date)
    .slice(0, 3);

  const recentActivity = [
    ...documents.map((item) => ({
      id: `document-${item.id}`,
      date: parseDate(item.date || item.created_at),
      kind: "document",
      title: "Documento agregado",
      subtitle: cleanUiText(item.center, item.type || "Documento de salud"),
      time: item.date || item.created_at,
    })),
    ...medications.map((item) => ({
      id: `medication-${item.id}`,
      date: parseDate(item.created_at || item.end_date),
      kind: "medication",
      title: "Medicamento registrado",
      subtitle: `${item.name || "Medicamento"}${item.dose ? ` - ${item.dose}` : ""}`,
      time: item.created_at || item.end_date,
    })),
    ...appointments.map((item) => ({
      id: `appointment-${item.id}`,
      date: parseDate(item.date_time),
      kind: "appointment",
      title: "Actividad agendada",
      subtitle:
        cleanUiText(`${typeLabels[item.type] || "Actividad"}${item.specialty ? ` - ${item.specialty}` : ""}`) ||
        "Actividad",
      time: item.date_time,
    })),
  ]
    .filter((item) => item.date)
    .sort((a, b) => b.date - a.date)
    .slice(0, 4);

  const suggestionItems = [];
  if (!futureAppointments.length) {
    suggestionItems.push({
      id: "suggestion-appointment",
      text: "No tienes citas próximas registradas. Agenda tu próximo control.",
    });
  }
  if (pendingDocuments > 0) {
    suggestionItems.push({
      id: "suggestion-docs",
      text: `Tienes ${pendingDocuments} documento${pendingDocuments > 1 ? "s" : ""} pendiente${pendingDocuments > 1 ? "s" : ""} de revisar.`,
    });
  }
  if (activeMedications.some((item) => getMedicationScheduleTimes(item).length === 0)) {
    suggestionItems.push({
      id: "suggestion-meds",
      text: "Hay medicamentos sin horario definido. Completa su recordatorio para no olvidarlos.",
    });
  }
  if (activeHealthAlerts.length) {
    suggestionItems.unshift({
      id: "suggestion-radar",
      text: `${activeHealthAlerts.length} alerta${activeHealthAlerts.length > 1 ? "s" : ""} detectada${activeHealthAlerts.length > 1 ? "s" : ""} por el radar de salud. Revísalas con Klinip IA.`,
    });
  }

  const quickActions = [
    {
      id: "medication",
      icon: "medication",
      label: "Agregar medicamento",
      tone: "amber",
      onClick: () => navigate("/medications"),
    },
    {
      id: "document",
      icon: "upload",
      label: "Subir documento",
      tone: "teal",
      onClick: () => navigate("/documents"),
    },
    {
      id: "appointment",
      icon: "appointment",
      label: "Crear cita",
      tone: "blue",
      onClick: () => navigate("/appointments"),
    },
    {
      id: "family",
      icon: "family",
      label: "Agregar familiar",
      tone: "violet",
      onClick: () => navigate("/family"),
    },
    {
      id: "ai",
      icon: "ai",
      label: "Preguntar a IA",
      tone: "green",
      onClick: () => navigate("/ai"),
    },
  ];
  const visibleQuickActions = canEditActiveProfile
    ? quickActions
    : quickActions.filter((item) => item.id === "ai");

  useEffect(() => {
    if (!noteMenuOpenId) return;
    const handleClickOutside = () => setNoteMenuOpenId(null);
    const timer = window.setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [noteMenuOpenId]);

  const handleMarkNoteDone = async (noteId) => {
    if (!canEditActiveProfile || !activeProfile?.id) return;
    try {
      await updateProfileNote(activeProfile.id, noteId, { visibility: "done" });
      setQuickNotes((prev) => prev.filter((n) => n.id !== noteId));
      setNoteMenuOpenId(null);
    } catch {
      window.alert("No pudimos marcar la nota. Intenta nuevamente.");
    }
  };

  const handleCancelNote = () => {
    setComposerOpen(false);
    setNoteDraft("");
    setNoteColor("yellow");
    setNoteReminder("");
    setEditingNoteId(null);
  };

  const handleStartEditNote = (item) => {
    if (!canEditActiveProfile) return;
    setComposerOpen(true);
    setEditingNoteId(item.id);
    setNoteDraft(item.note || item.text || "");
    setNoteColor(item.color || "yellow");
    setNoteReminder(item.reminder_at ? toLocalInputValue(item.reminder_at) : "");
  };

  const handleDeleteNote = async (noteId) => {
    if (!canEditActiveProfile || !activeProfile?.id || !noteId) return;
    const confirmed = window.confirm("\u00BFEliminar esta nota r\u00E1pida?");
    if (!confirmed) return;
    try {
      await deleteProfileNote(activeProfile.id, noteId);
      setQuickNotes((prev) => prev.filter((item) => item.id !== noteId));
      if (editingNoteId === noteId) {
        handleCancelNote();
      }
    } catch {
      window.alert("No pudimos eliminar la nota. Intenta nuevamente.");
    }
  };

  const handleSaveNote = async () => {
    if (!canEditActiveProfile) return;
    const value = noteDraft.trim();
    if (!value || !activeProfile?.id || noteSubmitting) return;
    setNoteSubmitting(true);
    // Convert datetime-local (local time) to UTC ISO string so the scheduler
    // can compare against datetime.utcnow() correctly.
    const reminderUtc = noteReminder
      ? new Date(noteReminder).toISOString()
      : null;
    try {
      if (editingNoteId) {
        const updated = await updateProfileNote(activeProfile.id, editingNoteId, {
          note: value,
          visibility: "shared",
          color: noteColor,
          reminder_at: reminderUtc,
        });
        setQuickNotes((prev) =>
          prev.map((item) => (item.id === editingNoteId ? updated : item)).slice(0, 6)
        );
      } else {
        const created = await createProfileNote(activeProfile.id, {
          note: value,
          visibility: "shared",
          color: noteColor,
          reminder_at: reminderUtc,
        });
        setQuickNotes((prev) => [created, ...prev].slice(0, 6));
      }
      handleCancelNote();
    } catch {
      window.alert("No pudimos guardar la nota. Intenta nuevamente.");
    } finally {
      setNoteSubmitting(false);
    }
  };

  const userName = user?.name || activeProfile?.full_name || "tu cuenta";
  const activeProfileName = activeProfile?.full_name || "Mi perfil";
  const firstName = (user?.name || activeProfile?.full_name || "").split(" ")[0] || userName;
  const userInitial = (user?.name || userName).trim().slice(0, 1).toUpperCase() || "K";
  const normalizedPlan = (planInfo?.plan_type || "basico").toLowerCase();
  const canSwitchProfiles = Array.isArray(menuHealthProfiles) && menuHealthProfiles.length > 1;
  const activeMenuProfile =
    menuHealthProfiles.find((item) => Number(item.id) === Number(activeProfileId)) ||
    activeProfile ||
    menuHealthProfiles[0] ||
    null;
  const planLabel =
    normalizedPlan === "familiar"
      ? "Plan Familiar"
      : normalizedPlan === "plus"
      ? "Plan Plus"
      : "Plan Básico";
  const greetText = greetStarted ? `Hola, ${firstName}` : "";
  const contextMessages = useMemo(
    () =>
      greetStarted
        ? buildContextualMessages({
            firstName,
            activeMedications,
            adherence,
            nextAppointment,
            activeHealthAlerts,
            lowAdherenceItems,
            pendingDocuments,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [greetStarted, activeMedications.length, adherence, nextAppointment?.id, activeHealthAlerts.length, lowAdherenceItems.length, pendingDocuments]
  );
  const titleTyper = useTypewriter(greetText, { speed: 55, startDelay: 300 });
  const subtitleTyper = useTypewriter(greetPhase >= 1 ? "Este es tu resumen de salud para hoy." : "", { speed: 32 });
  const contextTyper = useTypewriter(greetPhase >= 2 ? (contextMessages[aiMsgIndex] || "") : "", { speed: 28 });

  // Start greeting when initial data load completes
  useEffect(() => {
    if (!loading && !greetStarted) {
      setGreetStarted(true);
      setGreetPhase(0);
      setAiMsgIndex(0);
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 0 → 1: after title finishes typing
  useEffect(() => {
    if (!titleTyper.done || greetPhase !== 0 || !greetStarted) return;
    const t = window.setTimeout(() => setGreetPhase(1), 350);
    return () => window.clearTimeout(t);
  }, [titleTyper.done, greetPhase, greetStarted]);

  // Phase 1 → 2: after subtitle finishes typing
  useEffect(() => {
    if (!subtitleTyper.done || greetPhase !== 1 || !contextMessages.length) return;
    const t = window.setTimeout(() => setGreetPhase(2), 900);
    return () => window.clearTimeout(t);
  }, [subtitleTyper.done, greetPhase, contextMessages.length]);

  // Phase 2: cycle through context messages
  useEffect(() => {
    if (!contextTyper.done || greetPhase !== 2 || contextMessages.length < 2) return;
    const t = window.setTimeout(() => setAiMsgIndex((prev) => (prev + 1) % contextMessages.length), 4500);
    return () => window.clearTimeout(t);
  }, [contextTyper.done, greetPhase, contextMessages.length]);

  if (isMobile) {
    const adherenceTone = overallStatus.level === "ok" || overallStatus.level === "neutral" ? "" : overallStatus.level === "warn" ? "is-warn" : "is-alert";
    const adherenceBadgeLabel = overallStatus.level === "ok" ? "Todo al día" : overallStatus.level === "neutral" ? "Sin datos" : overallStatus.level === "warn" ? "Revisar" : "Atención";

    return (
      <div className="mobile-dashboard native-mobile-scene">
        {/* ── HERO ── */}
        <div className="mobile-hero native-surface native-surface-hero">
          <div className="mobile-hero-topbar">
            <div className="mobile-hero-user">
              <div className="mobile-hero-avatar" onClick={() => navigate("/settings")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M6 20a6 6 0 0 1 12 0"/>
                </svg>
              </div>
              <div className="mobile-hero-user-info">
                <p className="mobile-hero-greeting-sub">
                  {(() => {
                    const h = new Date().getHours();
                    if (h < 12) return "Buenos días";
                    if (h < 18) return "Buenas tardes";
                    return "Buenas noches";
                  })()}
                </p>
                <h1 className="mobile-hero-greeting-name">
                  Hola, <em>{firstName}</em>
                </h1>
              </div>
            </div>
            <div className="mobile-hero-tools">
              <div className="mobile-hero-notifications" ref={notificationsRef}>
                <button
                  type="button"
                  className="mobile-hero-action-btn"
                  aria-label="Ver notificaciones"
                  aria-expanded={notificationsOpen}
                  onClick={() => {
                    setProfileMenuOpen(false);
                    setNotificationsOpen((prev) => !prev);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  {notifications.length > 0 && (
                    <span className="notification-badge">{notifications.length}</span>
                  )}
                </button>
                {notificationsOpen && (
                  <div className="notifications-dropdown">
                    <div className="notifications-header">
                      <span className="notifications-heading">Notificaciones</span>
                      {notifications.length > 0 && (
                        <button
                          className="secondary-btn notifications-clear-btn"
                          type="button"
                          onClick={() => {
                            onClearNotifications?.();
                            setNotificationsOpen(false);
                          }}
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                    {notifications.length ? (
                      <ul className="notifications-list">
                        {notifications.slice(0, 6).map((item) => (
                          <li
                            key={item.id}
                            className="notifications-item"
                            onClick={() => {
                              onOpenNotification?.(item);
                              setNotificationsOpen(false);
                            }}
                          >
                            <div className="notifications-title">{item.title || "Recordatorio"}</div>
                            <div className="notifications-body">{item.body || ""}</div>
                            <div className="notifications-meta">
                              {item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="notifications-empty">Sin notificaciones recientes</div>
                    )}
                  </div>
                )}
              </div>
              <div className="topbar-user-wrap mobile-hero-user-wrap" ref={profileMenuRef}>
                <button
                  type="button"
                  className="mobile-hero-profile-chip"
                  aria-label="Abrir menú de usuario"
                  aria-expanded={profileMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setNotificationsOpen(false);
                    setProfileMenuOpen((prev) => !prev);
                  }}
                >
                  <span className="mobile-hero-profile-initial">{userInitial}</span>
                  <span className="mobile-hero-profile-name">{userName}</span>
                </button>
                {profileMenuOpen && (
                  <div className="topbar-user-menu" role="menu">
                    <div className="topbar-user-menu-head">
                      <span className="topbar-user-menu-avatar">{userInitial}</span>
                      <div>
                        <p className="topbar-user-menu-name">{user?.name || "Invitado"}</p>
                        <p className="topbar-user-menu-email">{user?.email || "sin-correo"}</p>
                      </div>
                    </div>
                    <div className="topbar-user-menu-profile-card">
                      <div className="topbar-user-menu-profile-head">
                        <span className="topbar-user-menu-profile-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <circle cx="12" cy="8" r="3.2" />
                            <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
                          </svg>
                        </span>
                        <span className="topbar-user-menu-plan">{planLabel}</span>
                      </div>
                      <p className="topbar-user-menu-profile-name">
                        {activeMenuProfile
                          ? `${activeMenuProfile.full_name} (${getHealthProfileAccessLabel(activeMenuProfile, user?.id)})`
                          : user?.name || "Perfil personal"}
                      </p>
                      {canSwitchProfiles ? (
                        <select
                          className="topbar-user-menu-profile-select"
                          value={activeProfileId || ""}
                          onChange={(event) => onSwitchProfile?.(event.target.value)}
                          disabled={!!switchingProfile}
                        >
                          {menuHealthProfiles.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.full_name}
                              {` (${getHealthProfileAccessLabel(item, user?.id)})`}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                    <div className="topbar-user-menu-actions">
                      <button
                        type="button"
                        className="topbar-user-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          navigate("/settings");
                        }}
                      >
                        <span className="topbar-user-menu-item-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <circle cx="12" cy="8" r="3.2" />
                            <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
                          </svg>
                        </span>
                        <span>Mi perfil</span>
                      </button>
                      <button
                        type="button"
                        className="topbar-user-menu-item"
                        role="menuitem"
                      >
                        <span className="topbar-user-menu-item-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <circle cx="12" cy="12" r="4" />
                            <path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
                          </svg>
                        </span>
                        <span className="topbar-user-theme-text">
                          {theme === "dark" ? "Modo oscuro" : "Modo claro"}
                        </span>
                        <label className="switch topbar-user-theme-switch">
                          <input
                            type="checkbox"
                            checked={theme === "dark"}
                            onChange={() => onToggleTheme?.()}
                          />
                          <span className="switch-slider" />
                        </label>
                      </button>
                    </div>
                    <div className="topbar-user-menu-divider" />
                    <button
                      type="button"
                      className="topbar-user-menu-item is-danger"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onLogout?.();
                      }}
                    >
                      <span className="topbar-user-menu-item-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <path d="M16 17l5-5-5-5" />
                          <path d="M21 12H9" />
                        </svg>
                      </span>
                      <span>Cerrar sesión</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mobile-hero-greeting" style={{ display: "none" }}></div>

          <div>
            <div className="mobile-hero-stat-label">
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
              Adherencia de medicamentos
            </div>
            <div className="mobile-hero-stat-row">
              <span className="mobile-hero-stat-value">
                {activeMedications.length ? adherence : "--"}
                {activeMedications.length ? <span className="stat-decimal">%</span> : null}
              </span>
              <span className={`mobile-hero-stat-badge ${adherenceTone}`}>
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5">
                  {overallStatus.level === "ok" || overallStatus.level === "neutral" ? (
                    <polyline points="20 6 9 17 4 12"/>
                  ) : (
                    <path d="M12 9v4m0 4h.01M12 3L2 21h20L12 3z"/>
                  )}
                </svg>
                {adherenceBadgeLabel}
              </span>
            </div>
            <div className="mobile-hero-badges">
              <span className="mobile-hero-profile-badge">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="3"/>
                  <path d="M6 19.5a6 6 0 0 1 12 0"/>
                </svg>
                {activeProfileName}
              </span>
              {nextAppointment && (
                <span className="mobile-hero-profile-badge">
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  {toRelativeDayLabel(parseDate(nextAppointment.date_time))}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── ACTION BAR ── */}
        <div className="mobile-action-bar">
          <button type="button" className="mobile-action-btn" onClick={() => navigate("/appointments")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Agenda
          </button>
          <button type="button" className="mobile-action-btn is-center" onClick={() => navigate("/ai")} aria-label="IA Klinip">
            <span className="mobile-ai-k">K</span>
            <span className="mobile-ai-label">IA</span>
          </button>
          <button type="button" className="mobile-action-btn" onClick={() => navigate("/medications")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <g transform="rotate(-35 12 12)">
                <rect x="5" y="8" width="14" height="8" rx="4"/>
                <path d="M12 8v8"/>
              </g>
            </svg>
            Medicamentos
          </button>
        </div>

        {/* ── WHITE SHEET ── */}
        <div className="mobile-sheet">
          <div className="mobile-sheet-handle" />

          {/* Acceso rápido */}
          <div className="mobile-section native-section native-section-delay-1">
            <div className="mobile-section-header">
              <h2 className="mobile-section-title">Acceso rápido</h2>
            </div>
            <div className="mobile-quick-grid">
              <button type="button" className="mobile-quick-item tone-blue is-featured is-glow" onClick={() => navigate("/appointments")}>
                <span className="mobile-card-orb" aria-hidden />
                <span className="mobile-quick-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="3" y="4" width="18" height="18" rx="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </span>
                <p className="mobile-quick-label">Citas</p>
                <span className="mobile-quick-highlight">Agenda activa</span>
                <p className="mobile-quick-sub">
                  {futureAppointments.length > 0 ? `${futureAppointments.length} próxima${futureAppointments.length > 1 ? "s" : ""}` : "Sin citas"}
                </p>
              </button>
              <button type="button" className="mobile-quick-item tone-teal is-spotlight" onClick={() => navigate("/documents")}>
                <span className="mobile-card-orb is-secondary" aria-hidden />
                <span className="mobile-quick-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </span>
                <p className="mobile-quick-label">Documentos</p>
                <p className="mobile-quick-sub">{documents.length} registros</p>
              </button>
              <button type="button" className="mobile-quick-item tone-sky" onClick={() => navigate("/voice")}>
                <span className="mobile-quick-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="9" y="2" width="6" height="11" rx="3"/>
                    <path d="M5 10a7 7 0 0 0 14 0"/>
                    <path d="M12 17v4M8 21h8"/>
                  </svg>
                </span>
                <p className="mobile-quick-label">Klinip Voice</p>
                <p className="mobile-quick-sub">Grabar consulta</p>
              </button>
              <button type="button" className="mobile-quick-item tone-violet" onClick={() => navigate("/family")}>
                <span className="mobile-quick-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="8" cy="9" r="2.5"/>
                    <circle cx="16" cy="9" r="2.5"/>
                    <path d="M3.5 19a4.5 4.5 0 0 1 9 0"/>
                    <path d="M11.5 19a4.5 4.5 0 0 1 9 0"/>
                  </svg>
                </span>
                <p className="mobile-quick-label">Mi familia</p>
                <p className="mobile-quick-sub">
                  {linkedProfiles > 0 ? `${linkedProfiles} familiar${linkedProfiles > 1 ? "es" : ""}` : "Gestionar perfiles"}
                </p>
              </button>
            </div>
          </div>

          {/* Alertas de salud */}
          {activeHealthAlerts.length > 0 && (
            <div className="mobile-section native-section native-section-delay-2">
              <div className="mobile-section-header">
                <h2 className="mobile-section-title">Alertas de salud</h2>
                <button type="button" className="mobile-section-link" onClick={() => navigate("/ai")}>
                  Abrir IA
                </button>
              </div>
              {activeHealthAlerts.slice(0, 2).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`mobile-activity-item ${item.severity === "high" ? "is-critical" : "is-elevated"}`}
                  onClick={() => navigate("/ai")}
                  style={{ borderLeft: `3px solid ${item.severity === "high" ? "#ef4444" : "#f59e0b"}` }}
                >
                  <span
                    className="mobile-activity-icon"
                    style={{
                      background: item.severity === "high" ? "#fef2f2" : "#fffbeb",
                      color: item.severity === "high" ? "#ef4444" : "#d97706",
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M12 9v4m0 4h.01M12 3L2 21h20L12 3z"/>
                    </svg>
                  </span>
                  <div className="mobile-activity-info">
                    <p className="mobile-activity-title">{getFriendlyAlertTitle(item)}</p>
                    <p className="mobile-activity-sub">Toca para orientación con Klinip IA</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Próxima actividad */}
          {upcomingEvents.length > 0 && (
            <div className="mobile-section native-section native-section-delay-3">
              <div className="mobile-section-header">
                <h2 className="mobile-section-title">Próxima actividad</h2>
                <button type="button" className="mobile-section-link" onClick={() => navigate("/calendar")}>
                  Ver todo
                </button>
              </div>
              {upcomingEvents.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`mobile-activity-item ${item.urgent ? "is-critical" : "is-elevated"}`}
                  onClick={() => navigate(item.kind === "medication" ? "/medications" : "/appointments")}
                >
                  <span className={`mobile-activity-icon tone-${item.kind === "medication" ? "amber" : item.kind === "exam" ? "teal" : "blue"}`}>
                    {item.kind === "medication" ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <g transform="rotate(-35 12 12)">
                          <rect x="5" y="8" width="14" height="8" rx="4"/>
                          <path d="M12 8v8"/>
                        </g>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <rect x="3" y="4" width="18" height="18" rx="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                    )}
                  </span>
                  <div className="mobile-activity-info">
                    <p className="mobile-activity-title">{item.title}</p>
                    <p className="mobile-activity-sub">
                      {item.urgent ? "Hoy" : toDayLabel(item.date)}{item.meta ? ` · ${item.meta}` : ""}
                    </p>
                  </div>
                  <span className={`mobile-activity-tag tone-${item.kind === "medication" ? "amber" : "blue"}`}>
                    {item.urgent ? "HOY" : item.tag}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Actividad reciente */}
          {recentActivity.length > 0 && (
            <div className="mobile-section native-section native-section-delay-4">
              <div className="mobile-section-header">
                <h2 className="mobile-section-title">Actividad reciente</h2>
                <button type="button" className="mobile-section-link" onClick={() => navigate("/timeline")}>
                  Ver todo
                </button>
              </div>
              {recentActivity.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="mobile-activity-item"
                  onClick={() => navigate(
                    item.kind === "document" ? "/documents" :
                    item.kind === "medication" ? "/medications" : "/appointments"
                  )}
                >
                  <span className={`mobile-activity-icon tone-${item.kind === "document" ? "teal" : item.kind === "medication" ? "amber" : "blue"}`}>
                    {item.kind === "document" ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                    ) : item.kind === "medication" ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <g transform="rotate(-35 12 12)">
                          <rect x="5" y="8" width="14" height="8" rx="4"/>
                          <path d="M12 8v8"/>
                        </g>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <rect x="3" y="4" width="18" height="18" rx="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                    )}
                  </span>
                  <div className="mobile-activity-info">
                    <p className="mobile-activity-title">{item.title}</p>
                    <p className="mobile-activity-sub">{item.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {upcomingEvents.length === 0 && recentActivity.length === 0 && !loading && (
            <div className="mobile-empty-state">
              Registra citas y medicamentos para ver tu actividad aquí.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="home-editorial">
      <div className="home-editorial-layout">
        <div className="home-editorial-top">
          <article className="home-greeting-card home-summary-card">
            <div className="home-greeting-copy">
              <p className="home-greeting-eyebrow">Resumen personal</p>
              <h1 className="home-greeting-title">
                {greetStarted ? (
                  <>
                    {titleTyper.displayed.length <= 6
                      ? titleTyper.displayed
                      : <>Hola, <em>{titleTyper.displayed.slice(6)}</em></>
                    }
                    {!titleTyper.done && <span className="greeting-cursor" aria-hidden="true" />}
                  </>
                ) : (
                  <>Hola, <em>{userName}</em></>
                )}
              </h1>
              <p className="home-greeting-subtitle">
                {!greetStarted && "Este es tu resumen de salud para hoy."}
                {greetStarted && greetPhase === 0 && "\u00A0"}
                {greetPhase === 1 && (
                  <>
                    {subtitleTyper.displayed}
                    {!subtitleTyper.done && <span className="greeting-cursor" aria-hidden="true" />}
                  </>
                )}
                {greetPhase >= 2 && (
                  <>
                    {contextTyper.displayed}
                    {!contextTyper.done && <span className="greeting-cursor" aria-hidden="true" />}
                  </>
                )}
              </p>
              <div className="home-greeting-context">
                <span className="status-badge status-badge-green">
                  <span className="status-badge-label">Perfil activo</span>
                  <span className="status-badge-value">{activeProfileName}</span>
                </span>
              </div>
            </div>
            <div className="home-greeting-side">
              <div className="home-greeting-date">
                <strong>{new Date().toLocaleDateString("es-CL", { day: "2-digit" })}</strong>
                <span>
                  {new Date().toLocaleDateString("es-CL", {
                    month: "short",
                    year: "numeric",
                    weekday: "long",
                  })}
                </span>
              </div>
              <button
                type="button"
                className="home-greeting-profile"
                onClick={() => navigate("/settings")}
              >
                <span className="home-greeting-profile-dot">{profileInitials(activeProfileName)}</span>
                Cambiar perfil
              </button>
            </div>
          </article>
        </div>

        <div className="home-editorial-voice">
          <article className="home-panel-card home-voice-card">
            <div className="home-panel-head">
              <div>
                <h2 className="home-panel-title">Klinip Voice</h2>
                <p className="home-panel-subtitle">Graba tu próxima consulta médica.</p>
              </div>
            </div>
            <div className="voice-body">
              <button
                type="button"
                className="home-note-primary home-voice-btn"
                disabled={!canEditActiveProfile}
                onClick={() => navigate("/voice?record=1")}
              >
                <span className="home-voice-btn-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-4a3.5 3.5 0 1 0-7 0v4A3.5 3.5 0 0 0 12 15Z" />
                    <path d="M18 11.5a6 6 0 0 1-12 0" />
                    <path d="M12 17.5v3" />
                    <path d="M9.5 20.5h5" />
                  </svg>
                </span>
                <span className="home-voice-btn-label">Iniciar grabación</span>
              </button>
            </div>
          </article>
        </div>

        <div className="home-editorial-left">
          {isReadOnlyProfile ? (
            <div className="card home-readonly-card">
              <div className="alert-info">
                <p>
                  <strong>Perfil en modo lectura.</strong> Puedes revisar el resumen y los registros, pero no crear ni editar elementos desde Inicio.
                </p>
              </div>
            </div>
          ) : null}

          <article className="home-panel-card home-radar-card">
            <div className="home-panel-head">
              <div>
                <h2 className="home-panel-title">Radar de salud</h2>
                <p className="home-panel-subtitle">Estado general registrado en Klinip</p>
              </div>
              <button type="button" className="home-panel-link" onClick={() => navigate("/stats")}>
                Ver detalle
              </button>
            </div>
            <div className="home-radar-grid">
              {radarItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`home-radar-item tone-${getStatusTone(item.tone)}`}
                  onClick={item.onClick}
                  aria-label={`${item.label}: ${item.value}`}
                >
                  <div className="home-radar-icon">{renderIcon(item.icon)}</div>
                  <div className="home-radar-label">{item.label}</div>
                  <div className="home-radar-value">{item.value}</div>
                </button>
              ))}
            </div>
            <div className="home-radar-insights">
              <div className={`home-radar-status home-radar-status-${overallStatus.level}`}>
                <strong>{overallStatus.title}</strong>
                <span>{overallStatus.message}</span>
              </div>
              <div className="home-radar-summary">
                <div className={`home-radar-summary-chip tone-${activeMedications.length > 0 ? getRadarToneFromAdherence(adherence) : "teal"}`}>
                  <span>Cumplimiento general</span>
                  <strong>{activeMedications.length ? `${adherence}%` : "Sin datos"}</strong>
                </div>
                <div className={`home-radar-summary-chip tone-${activeHealthAlerts.length ? "alert" : "ok"}`}>
                  <span>Por atender</span>
                  <strong>
                    {activeHealthAlerts.length
                      ? `${activeHealthAlerts.length} alerta${activeHealthAlerts.length > 1 ? "s" : ""}`
                      : "Todo bien"}
                  </strong>
                </div>
              </div>
              <div className="home-radar-alert-list">
                {activeHealthAlerts.length ? (
                  activeHealthAlerts.map((item) => (
                    <React.Fragment key={item.id}>
                      <button
                        type="button"
                        className={`home-radar-alert tone-${getAlertTone(item.severity)}${expandedAlertId === item.id ? " is-expanded" : ""}`}
                        onClick={() => setExpandedAlertId(expandedAlertId === item.id ? null : item.id)}
                      >
                        <strong>{cleanUiText(getFriendlyAlertTitle(item))}</strong>
                        <span>{cleanUiText(item.description)}</span>
                        <span className="home-radar-alert-nav">
                          {expandedAlertId === item.id ? "Presiona para cerrar" : "Presiona aquí para ver qué hacer"}
                        </span>
                      </button>
                      {expandedAlertId === item.id ? (
                        <div className="home-radar-alert-detail">
                          <strong>¿Qué puedo hacer?</strong>
                          <p>{cleanUiText(getAlertDetail(item))}</p>
                          <button
                            type="button"
                            className="home-radar-alert-ai-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate("/ai", {
                                state: {
                                  autoPrompt: `Tengo una alerta en mi Radar de Salud: "${cleanUiText(getFriendlyAlertTitle(item))}". ${cleanUiText(item.description)} ¿Qué debo hacer paso a paso?`,
                                },
                              });
                            }}
                          >
                            Consultar con Klinip IA
                          </button>
                        </div>
                      ) : null}
                    </React.Fragment>
                  ))
                ) : (
                  <div className="home-empty-state">No hay alertas activas. ¡Tu salud está al día!</div>
                )}
              </div>
              {lowAdherenceItems.length ? (
                <div className="home-radar-pattern">
                  <strong>Estos medicamentos necesitan atención</strong>
                  <span>
                    {cleanUiText(
                      lowAdherenceItems
                        .slice(0, 2)
                        .map((item) => `${item.name}: ${item.adherence_rate}% de dosis tomadas`)
                        .join(" \u00B7 ")
                    )}
                  </span>
                </div>
              ) : null}
            </div>
          </article>

          <article className="home-panel-card home-suggestions-card">
            <div className="home-panel-head">
              <div>
                <h2 className="home-panel-title">Sugerencias</h2>
                <p className="home-panel-subtitle">Basadas en tu actividad reciente.</p>
              </div>
            </div>
            <div className="home-suggestions-list">
              {suggestionItems.length ? (
                suggestionItems.map((item) => (
                  <button key={item.id} type="button" className="home-suggestion-item">
                    <span className="home-suggestion-icon">{renderIcon("ai")}</span>
                    <span>{cleanUiText(item.text)}</span>
                  </button>
                ))
              ) : (
                <div className="home-empty-state">{"Tu resumen est\u00E1 al d\u00EDa por ahora."}</div>
              )}
            </div>
          </article>

          <article className="home-panel-card home-upcoming-card">
            <div className="home-panel-head">
              <div>
                <h2 className="home-panel-title">{"Actividad pr\u00F3xima"}</h2>
                <p className="home-panel-subtitle">Lo que viene en tu agenda</p>
              </div>
              <button type="button" className="home-panel-link" onClick={() => navigate("/calendar")}>
                Ver agenda
              </button>
            </div>
            <div className="home-upcoming-list">
              {upcomingEvents.length ? (
                upcomingEvents.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`home-upcoming-item ${item.urgent ? "is-urgent" : ""}`}
                    onClick={() =>
                      navigate(item.kind === "medication" ? "/medications" : "/appointments")
                    }
                  >
                    <span className="home-upcoming-date">
                      {item.urgent ? (
                        <span className="home-upcoming-flag">HOY</span>
                      ) : (
                        <span className="home-upcoming-day">{toDayLabel(item.date)}</span>
                      )}
                      <strong>{item.date?.getDate?.() || "--"}</strong>
                      <small>{item.date?.toLocaleDateString("es-CL", { month: "short" }) || ""}</small>
                    </span>
                    <span className="home-upcoming-divider" />
                    <span className="home-upcoming-copy">
                      <strong>{cleanUiText(item.title)}</strong>
                      <span>{cleanUiText([toTimeLabel(item.date), item.meta].filter(Boolean).join(" \u00B7 "))}</span>
                    </span>
                    <span className={`home-upcoming-tag tone-${item.kind === "medication" ? "amber" : item.kind === "exam" ? "teal" : "blue"}`}>
                      {item.tag}
                    </span>
                  </button>
                ))
              ) : (
                <div className="home-empty-state">{"Sin actividad pr\u00F3xima registrada."}</div>
              )}
            </div>
          </article>

          <article className="home-panel-card home-actions-card">
            <div className="home-panel-head">
              <div>
                <h2 className="home-panel-title">{"Accesos r\u00E1pidos"}</h2>
                <p className="home-panel-subtitle">Acciones frecuentes de Klinip al alcance de tu mano.</p>
              </div>
            </div>
            <div className="home-actions-grid">
              {visibleQuickActions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`home-action-item tone-${item.tone}`}
                  onClick={item.onClick}
                >
                  <span className="home-action-icon">{renderIcon(item.icon)}</span>
                  <span className="home-action-label">{item.label}</span>
                </button>
              ))}
            </div>
          </article>
        </div>

        <div className="home-editorial-right">
          <article className="home-panel-card home-recent-card">
            <div className="home-panel-head">
              <div>
                <h2 className="home-panel-title">Actividad reciente</h2>
                <p className="home-panel-subtitle">{"\u00DAltimas acciones en la aplicaci\u00F3n."}</p>
              </div>
              <button type="button" className="home-panel-link" onClick={() => navigate("/timeline")}>
                Ver historial
              </button>
            </div>
            <div className="home-recent-list">
              {recentActivity.length ? (
                recentActivity.map((item) => (
                  <div key={item.id} className="home-recent-row">
                    <span className={`home-recent-icon tone-${kindToneMap[item.kind] || "blue"}`}>
                      {renderIcon(item.kind)}
                    </span>
                    <span className="home-recent-copy">
                      <strong>{cleanUiText(item.title)}</strong>
                      <small>{cleanUiText(item.subtitle)}</small>
                    </span>
                    <span className="home-recent-time">
                      {parseDate(item.time)?.toLocaleDateString("es-CL", {
                        day: "2-digit",
                        month: "short",
                      }) || ""}
                    </span>
                  </div>
                ))
              ) : (
                <div className="home-empty-state">{"A\u00FAn no hay actividad reciente."}</div>
              )}
            </div>
          </article>

          <article className="home-panel-card home-notes-card">
            <div className="home-panel-head">
              <div>
                <h2 className="home-panel-title">{"Notas r\u00E1pidas"}</h2>
                <p className="home-panel-subtitle">Pendientes e ideas de tu cuidado.</p>
              </div>
              <button
                type="button"
                className="home-panel-link"
                onClick={() => {
                  if (composerOpen) {
                    handleCancelNote();
                  } else if (canEditActiveProfile) {
                    setComposerOpen(true);
                  }
                }}
              >
                {canEditActiveProfile ? (composerOpen ? "Cerrar" : "Nueva nota") : "Solo lectura"}
              </button>
            </div>
            {composerOpen && canEditActiveProfile && (
              <div className={`home-note-composer note-color-${noteColor}`}>
                <div className="home-note-color-picker" role="group" aria-label="Color de nota">
                  {["yellow", "pink", "mint", "lavender", "peach"].map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`home-note-color-swatch home-note-color-swatch-${c}${noteColor === c ? " is-selected" : ""}`}
                      onClick={() => setNoteColor(c)}
                      aria-label={c}
                      aria-pressed={noteColor === c}
                    />
                  ))}
                </div>
                <textarea
                  className="home-note-textarea"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Guardar pendiente o idea clave."
                  rows={3}
                />
                <div className="home-note-reminder-row">
                  <label className="home-note-reminder-label">
                    Recordarme el:
                    <input
                      type="datetime-local"
                      className="home-note-reminder-input"
                      value={noteReminder}
                      onChange={(e) => setNoteReminder(e.target.value)}
                      min={toLocalInputValue(new Date())}
                    />
                  </label>
                  {noteReminder && (
                    <button
                      type="button"
                      className="home-note-reminder-clear"
                      onClick={() => setNoteReminder("")}
                    >
                      Quitar recordatorio
                    </button>
                  )}
                </div>
                <div className="home-note-actions">
                  <button
                    type="button"
                    className="home-note-secondary"
                    onClick={handleCancelNote}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="home-note-primary"
                    onClick={handleSaveNote}
                    disabled={noteSubmitting}
                  >
                    {noteSubmitting ? "Guardando..." : editingNoteId ? "Guardar cambios" : "Guardar nota"}
                  </button>
                </div>
              </div>
            )}
            <div className="home-notes-list">
              {notesLoading ? (
                <div className="home-loading">{"Cargando notas r\u00E1pidas..."}</div>
              ) : quickNotes.length ? (
                quickNotes.map((item) => (
                  <article key={item.id} className={`home-note-row note-color-${item.color || "yellow"}`}>
                    <div className="home-note-row-main">
                      <span className={`home-note-dot note-color-dot-${item.color || "yellow"}`} />
                      <span className="home-note-copy">
                        <strong>{cleanUiText(item.note || item.text)}</strong>
                        <small>
                          {parseDate(item.updated_at || item.created_at)?.toLocaleString("es-CL", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          }) || "Reciente"}
                        </small>
                        {item.reminder_at ? (
                          <small className={`home-note-reminder-badge${item.reminder_sent ? " is-sent" : ""}`}>
                            {item.reminder_sent
                              ? "Recordatorio enviado"
                              : `Recordatorio: ${parseDate(item.reminder_at)?.toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) || item.reminder_at}`}
                          </small>
                        ) : null}
                      </span>
                    </div>
                    {canEditActiveProfile ? (
                      <div className="home-note-menu-wrap">
                        <button
                          type="button"
                          className="home-note-menu-trigger"
                          aria-label="Opciones de nota"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNoteMenuOpenId((prev) => (prev === item.id ? null : item.id));
                          }}
                        >
                          &#8942;
                        </button>
                        {noteMenuOpenId === item.id && (
                          <div className="home-note-menu-popup" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="home-note-menu-item"
                              onClick={() => { handleStartEditNote(item); setNoteMenuOpenId(null); }}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="home-note-menu-item"
                              onClick={() => handleMarkNoteDone(item.id)}
                            >
                              Marcar como listo
                            </button>
                            <button
                              type="button"
                              className="home-note-menu-item is-danger"
                              onClick={() => { handleDeleteNote(item.id); setNoteMenuOpenId(null); }}
                            >
                              Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="home-empty-state">{"Todav\u00EDa no guardas notas r\u00E1pidas."}</div>
              )}
            </div>
          </article>
        </div>
      </div>

      {loading ? <div className="home-loading">Actualizando tu resumen de salud...</div> : null}
    </section>
  );
}
