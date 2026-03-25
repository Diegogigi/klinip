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
import { parseDate } from "../utils/dates";
import { subscribeClinicalDataChanged } from "../utils/clinicalRefresh";
import { canWriteProfile, isViewerProfile } from "../utils/profileAccess";

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

const MOJIBAKE_FALLBACKS = [
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡", "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡"],
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©", "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©"],
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­", "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­"],
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³", "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³"],
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âº", "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âº"],
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â±", "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â±"],
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â", "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â"],
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â°", "ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°"],
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â", "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â"],
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“", "ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ"],
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡", "ÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â¡"],
  ["ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¹Ã…â€œ", "ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“"],
  ["ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¿", "ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¿"],
  ["ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡", "ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡"],
  ["ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·", "ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·"],
];

function cleanUiText(value, fallback = "") {
  const text = String(value ?? "");
  const cleaned = MOJIBAKE_FALLBACKS.reduce(
    (result, [search, replacement]) => result.split(search).join(replacement),
    text
  ).trim();
  return cleaned || fallback;
}

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

function profileInitials(name) {
  return (name || "KP")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function getMedicationReminderDate(medication) {
  if (!medication?.schedule_time) return null;
  const [hourText, minuteText] = String(medication.schedule_time).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText || 0);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  const now = new Date();
  const candidate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
    0,
    0
  );
  if (candidate.getTime() < now.getTime() - 10 * 60 * 1000) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
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
      msgs.push(`Adherencia al ${adherence}% — excelente seguimiento de tu plan de medicación.`);
    } else if (adherence >= 50) {
      msgs.push(`Tu adherencia es del ${adherence}%. Puedes mejorar el seguimiento de tus medicamentos.`);
    } else {
      msgs.push(`Adherencia al ${adherence}%. Tus medicamentos necesitan atención hoy.`);
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
    msgs.push(`El radar detectó ${n} alerta${n > 1 ? "s" : ""} activa${n > 1 ? "s" : ""}. Revisa tu resumen.`);
  }

  if (lowAdherenceItems.length > 0) {
    const med = cleanUiText(lowAdherenceItems[0]?.name || "");
    if (med) msgs.push(`${med} tiene baja adherencia. ¿Necesitas ajustar el recordatorio?`);
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

export default function Dashboard({ user }) {
  const navigate = useNavigate();
  const isMountedRef = useRef(false);
  const activeProfileIdRef = useRef(null);
  const radarPollTimeoutRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [medications, setMedications] = useState([]);
  const [healthProfiles, setHealthProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [healthRadar, setHealthRadar] = useState([]);
  const [adherenceSummary, setAdherenceSummary] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [quickNotes, setQuickNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const notesStorageKey = activeProfile?.id ? `klinip:home-notes:${activeProfile.id}` : null;
  const canEditActiveProfile = canWriteProfile(activeProfile);
  const isReadOnlyProfile = isViewerProfile(activeProfile);
  const [greetStarted, setGreetStarted] = useState(false);
  const [greetPhase, setGreetPhase] = useState(0);
  const [aiMsgIndex, setAiMsgIndex] = useState(0);

  useEffect(() => {
    activeProfileIdRef.current = activeProfile?.id ? Number(activeProfile.id) : null;
  }, [activeProfile?.id]);

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
    let cancelled = false;
    async function loadNotes() {
      if (!activeProfile?.id) {
        setQuickNotes([]);
        return;
      }
      setNotesLoading(true);
      try {
        const response = await getProfileNotes(activeProfile.id).catch(() => []);
        let nextNotes = Array.isArray(response) ? response.slice(0, 6) : [];
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
  const topHealthAlerts = activeHealthAlerts.slice(0, 3);
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
    },
    {
      key: "appointments",
      icon: "appointment",
      tone: nextAppointment ? "warn" : "alert",
      label: "Citas",
      value: nextAppointment
        ? `${toRelativeDayLabel(parseDate(nextAppointment.date_time)).toLowerCase()}`
        : "sin citas próximas",
    },
    {
      key: "documents",
      icon: "document",
      tone: pendingDocuments > 0 ? "alert" : "ok",
      label: "Documentos",
      value: pendingDocuments > 0 ? `${pendingDocuments} pendientes` : "al día",
    },
    {
      key: "adherence",
      icon: "adherence",
      tone: getRadarToneFromAdherence(adherence),
      label: "Adherencia",
      value: activeMedications.length ? `${adherence}%` : "sin datos",
    },
    {
      key: "family",
      icon: "family",
      tone: activeHealthAlerts.length ? "warn" : linkedProfiles > 0 ? "warn" : "ok",
      label: "Familia",
      value: activeHealthAlerts.length
        ? `${activeHealthAlerts.length} alerta${activeHealthAlerts.length > 1 ? "s" : ""}`
        : linkedProfiles > 0
        ? `${linkedProfiles} vinculados`
        : "sin alertas",
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
          meta: item.schedule_time ? `${item.schedule_time} - Recordatorio` : "Sin horario definido",
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
  if (activeMedications.some((item) => !item.schedule_time)) {
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

  const handleCancelNote = () => {
    setComposerOpen(false);
    setNoteDraft("");
    setEditingNoteId(null);
  };

  const handleStartEditNote = (item) => {
    if (!canEditActiveProfile) return;
    setComposerOpen(true);
    setEditingNoteId(item.id);
    setNoteDraft(item.note || item.text || "");
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
    try {
      if (editingNoteId) {
        const updated = await updateProfileNote(activeProfile.id, editingNoteId, {
          note: value,
          visibility: "shared",
        });
        setQuickNotes((prev) =>
          prev.map((item) => (item.id === editingNoteId ? updated : item)).slice(0, 6)
        );
      } else {
        const created = await createProfileNote(activeProfile.id, {
          note: value,
          visibility: "shared",
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
                <div key={item.key} className={`home-radar-item tone-${getStatusTone(item.tone)}`}>
                  <div className="home-radar-icon">{renderIcon(item.icon)}</div>
                  <div className="home-radar-label">{item.label}</div>
                  <div className="home-radar-value">{item.value}</div>
                </div>
              ))}
            </div>
            <div className="home-radar-insights">
              <div className="home-radar-summary">
                <div className="home-radar-summary-chip tone-teal">
                  <span>Adherencia</span>
                  <strong>{activeMedications.length ? `${adherence}%` : "Sin datos"}</strong>
                </div>
                <div className={`home-radar-summary-chip tone-${activeHealthAlerts.length ? "alert" : "ok"}`}>
                  <span>Alertas activas</span>
                  <strong>{activeHealthAlerts.length}</strong>
                </div>
              </div>
              <div className="home-radar-alert-list">
                {topHealthAlerts.length ? (
                  topHealthAlerts.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`home-radar-alert tone-${getAlertTone(item.severity)}`}
                      onClick={() => navigate("/ai")}
                    >
                      <strong>{cleanUiText(item.title)}</strong>
                      <span>{cleanUiText(item.description)}</span>
                    </button>
                  ))
                ) : (
                  <div className="home-empty-state">No hay alertas activas detectadas por el radar inteligente.</div>
                )}
              </div>
              {lowAdherenceItems.length ? (
                <div className="home-radar-pattern">
                  <strong>Medicamentos a revisar</strong>
                    <span>
                      {cleanUiText(
                        lowAdherenceItems
                          .slice(0, 2)
                          .map((item) => `${item.name}: ${item.adherence_rate}%`)
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
              <div className="home-note-composer">
                <textarea
                  className="home-note-textarea"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Guardar pendiente o idea clave."
                  rows={3}
                />
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
                quickNotes.map((item, index) => (
                  <article key={item.id} className="home-note-row">
                    <div className="home-note-row-main">
                      <span className={`home-note-dot tone-${["blue", "violet", "green", "amber"][index % 4]}`} />
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
                      </span>
                    </div>
                    <div className="home-note-row-actions">
                      {canEditActiveProfile ? (
                        <>
                          <button
                            type="button"
                            className="home-note-action-btn"
                            onClick={() => handleStartEditNote(item)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="home-note-action-btn is-danger"
                            onClick={() => handleDeleteNote(item.id)}
                          >
                            Eliminar
                          </button>
                        </>
                      ) : null}
                    </div>
                  </article>
                ))
              ) : (
                <div className="home-empty-state">{"Todav\u00EDa no guardas notas r\u00E1pidas."}</div>
              )}
            </div>
          </article>
        </div>

        <div className="home-editorial-recent">
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
        </div>
      </div>

      {loading ? <div className="home-loading">Actualizando tu resumen de salud...</div> : null}
    </section>
  );
}
