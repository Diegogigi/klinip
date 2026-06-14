import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import useClickOutside from "../hooks/useClickOutside";
import {
  getActiveHealthProfile,
  getAiAdherence,
  getAiHealthRadar,
  getAppointments,
  getBiometricDashboard,
  createProfileNote,
  deleteProfileNote,
  getDocuments,
  getHealthProfiles,
  getMedications,
  getProfileNotes,
  updateProfileNote,
} from "../api";
import { parseDate, toLocalInputValue } from "../utils/dates";
import { subscribeClinicalDataChanged, notifyClinicalDataChanged } from "../utils/clinicalRefresh";
import { canWriteProfile, isViewerProfile } from "../utils/profileAccess";
import { isHandheldViewport } from "../utils/mobileViewport";
import { cleanUiText } from "../utils/textEncoding";
import {
  formatBiometricMeasuredAt,
  formatBiometricValue,
  getBiometricLatestMetric,
  getBiometricMetricConfig,
} from "../utils/biometrics";
import {
  getMedicationScheduleSummary,
  getMedicationScheduleTimes,
  getNextMedicationDose,
  isMedicationFinished,
} from "../utils/medicationSchedule";
import { ensureArray } from "../utils/arrays";
import BrandLogo from "../components/BrandLogo";
import DocumentUploadWizard from "../components/DocumentUploadWizard";

const RADAR_REFRESH_POLL_LIMIT = 8;

const typeLabels = {
  cita: "Cita",
  examen: "Examen",
  tramite: "TrÃ¡mite",
};

const kindToneMap = {
  appointment: "blue",
  document: "teal",
  medication: "amber",
  biometric: "violet",
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
  if (adherence >= 80) return `Muy bien Â· ${adherence}%`;
  if (adherence >= 45) return `Regular Â· ${adherence}%`;
  return `Bajo Â· ${adherence}%`;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function buildAdherenceRingStyle(progress) {
  return { "--health-progress": `${clampPercent(progress)}` };
}

function getAdherenceZone(value) {
  if (value >= 80) return "stable";
  if (value >= 45) return "attention";
  return "critical";
}

function getAdherenceZoneLabel(value) {
  const zone = getAdherenceZone(value);
  if (zone === "stable") return "Estable";
  if (zone === "attention") return "Necesita atencion";
  return "Baja";
}

function humanizeTimeSlot(slot) {
  const normalized = String(slot || "").trim().toLowerCase();
  if (normalized === "manana") return "Manana";
  if (normalized === "tarde") return "Tarde";
  if (normalized === "noche") return "Noche";
  return "Sin patron claro";
}

function buildAdherenceGuideData({
  adherence,
  expected,
  taken,
  activeCount,
  windowDays,
  weakestMedication,
  patternSummary,
  pendingRefresh,
}) {
  if (!activeCount) {
    return {
      summary:
        "Este grafico se activa cuando hay medicamentos en seguimiento. Cuando empieces a registrar tus dosis, aqui veras tu avance real y una explicacion simple de cada color.",
      legend: [
        {
          key: "remaining",
          tone: "remaining",
          title: "Claro",
          value: "Sin datos",
          description:
            "El anillo queda neutro hasta que existan dosis esperadas y registros para calcular tu adherencia.",
        },
      ],
      insights: [
        { key: "plan", label: "Plan activo", value: "Sin medicamentos activos" },
        { key: "window", label: "Periodo", value: `${windowDays} dias` },
      ],
    };
  }

  const safeAdherence = clampPercent(adherence);
  const remaining = Math.max(0, 100 - safeAdherence);
  const zone = getAdherenceZone(safeAdherence);
  const weakestLabel = cleanUiText(weakestMedication?.name || "Sin alertas");
  const weakestRate =
    weakestMedication?.adherence_rate === null || weakestMedication?.adherence_rate === undefined
      ? null
      : `${Math.round(Number(weakestMedication.adherence_rate) || 0)}%`;
  const weakestValue = weakestRate ? `${weakestLabel} - ${weakestRate}` : weakestLabel;
  const weakestDescription = weakestMedication
    ? `${weakestMedication.missed_count || 0} dosis quedaron sin registrar en los ultimos ${windowDays} dias.`
    : "No hay medicamentos por debajo del rango esperado.";
  const weakestSlot = humanizeTimeSlot(patternSummary?.lowest_recorded_time_slot);
  const zoneLabel = getAdherenceZoneLabel(safeAdherence);

  return {
    summary: pendingRefresh
      ? `Estamos actualizando tu resumen. Mientras tanto, este ${safeAdherence}% se calcula con ${taken} dosis registradas de ${expected} esperadas en los ultimos ${windowDays} dias.`
      : `Hoy tu adherencia a medicamentos es ${safeAdherence}%. Ese porcentaje se calcula con ${taken} dosis registradas de ${expected} esperadas en los ultimos ${windowDays} dias.`,
    legend: [
      {
        key: "current",
        tone: "current",
        title: "Celeste - Tu porcentaje de hoy",
        value: `${safeAdherence}% hoy`,
        description:
          `El punto celeste marca tu valor real de hoy. Con ese dato, hoy estas en nivel ${zoneLabel.toLowerCase()}.`,
      },
      {
        key: "stable",
        tone: "stable",
        title: "Verde - Adherencia estable",
        value: "80% a 100%",
        description:
          zone === "stable"
            ? "Tu porcentaje de hoy ya esta en la zona mas tranquila."
            : "Esta es la zona objetivo. Aqui el tratamiento se considera bien seguido.",
      },
      {
        key: "attention",
        tone: "attention",
        title: "Amarillo - Conviene revisar",
        value: "45% a 79%",
        description:
          zone === "attention"
            ? "Tu porcentaje de hoy esta en una zona intermedia y conviene revisarla."
            : "Aqui suele hacer falta ajustar horarios, recordatorios o apoyo para no olvidar dosis.",
      },
      {
        key: "critical",
        tone: "critical",
        title: "Rojo - Riesgo de baja adherencia",
        value: "0% a 44%",
        description:
          zone === "critical"
            ? "Tu porcentaje de hoy esta en la zona mas baja y conviene actuar pronto."
            : "Si tu porcentaje cae aqui, Klinip lo interpreta como riesgo de baja adherencia.",
      },
      {
        key: "remaining",
        tone: "remaining",
        title: "Claro - Lo que falta mejorar",
        value: `${remaining}% por recuperar`,
        description:
          remaining > 0
            ? "Es la parte que aun falta mejorar para acercarte a la zona verde."
            : "No queda tramo pendiente en este periodo.",
      },
    ],
    insights: [
      { key: "doses", label: "Dosis tomadas", value: `${taken} de ${expected}` },
      { key: "plan", label: "Medicamentos en seguimiento", value: `${activeCount}` },
      { key: "weakest", label: "Medicamento que mas afecto tu promedio", value: weakestValue, description: weakestDescription },
      { key: "slot", label: "Momento del dia donde mas cuesta recordar", value: weakestSlot },
    ],
  };
}

const friendlyAlertTitleMap = {
  medication_running_out: "Medicamento por terminarse",
  low_adherence: "Tienes dosis sin tomar",
  missed_appointment_followup: "Tienes una cita sin confirmar",
  missing_lab_result: "Faltan resultados de exÃ¡menes",
  incomplete_treatment: "Tratamiento sin cerrar",
};

function getFriendlyAlertTitle(alert) {
  if (!alert) return "";
  return friendlyAlertTitleMap[alert.alert_type] || alert.title || "";
}

const alertDetailMap = {
  medication_running_out:
    "Tu medicamento estÃ¡ prÃ³ximo a terminarse. Revisa si tienes stock suficiente para los prÃ³ximos dÃ­as. Si necesitas renovar la receta, agenda una consulta con tu mÃ©dico antes de que se acabe.",
  low_adherence:
    "EstÃ¡s tomando menos dosis de las que corresponden. Revisa tus recordatorios y asegÃºrate de que estÃ©n activos. Si tienes dificultades para seguir el tratamiento, comÃ©ntalo con tu mÃ©dico.",
  missed_appointment_followup:
    "Tienes una cita registrada que no fue marcada como realizada. Si ya la realizaste, actualiza su estado en tu agenda. Si no fue asÃ­, considera reagendarla.",
  missing_lab_result:
    "Hay Ã³rdenes mÃ©dicas sin resultados asociados. Sube los documentos de tus exÃ¡menes para que queden registrados en tu historial clÃ­nico.",
  incomplete_treatment:
    "Un tratamiento pasÃ³ su fecha estimada de tÃ©rmino y sigue marcado como activo. Revisa si aÃºn lo estÃ¡s tomando o si ya finalizÃ³ para actualizar tu historial.",
};

function getAlertDetail(alert) {
  if (!alert) return "";
  return alertDetailMap[alert.alert_type] || alert.recommended_action || "";
}

const TYPE_LABELS_SAFE = {
  cita: "Cita",
  examen: "Examen",
  tramite: "TrÃ¡mite",
};

function toRelativeDayLabelSafe(date) {
  if (!date) return "";
  const now = new Date();
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startDate - startNow) / 86400000);
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "MaÃ±ana";
  if (diffDays > 1) return `En ${diffDays} dÃ­as`;
  return "Reciente";
}

function getOverallHealthStatus(activeHealthAlerts, adherence, activeMedications) {
  const highAlerts = activeHealthAlerts.filter((a) => a.severity === "high");
  if (highAlerts.length > 0 || (activeMedications.length > 0 && adherence < 45)) {
    return {
      level: "alert",
      title: "Necesita tu atenciÃ³n hoy",
      message: "Revisa las alertas a continuaciÃ³n y toca cualquiera para recibir orientaciÃ³n de Klinip IA.",
    };
  }
  if (activeHealthAlerts.length > 0 || (activeMedications.length > 0 && adherence < 80)) {
    return {
      level: "warn",
      title: "Hay cosas para revisar",
      message: "Toca cualquier alerta para ver quÃ© hacer. Klinip IA puede ayudarte.",
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
    title: "Â¡Tu salud estÃ¡ al dÃ­a!",
    message: "No hay alertas activas y estÃ¡s tomando tus medicamentos correctamente.",
  };
}

function renderIcon(name) {
  const iconProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };
  switch (name) {
    case "medication":
      return (
        <svg {...iconProps}>
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
        </svg>
      );
    case "appointment":
      return (
        <svg {...iconProps}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "document":
      return (
        <svg {...iconProps}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    case "adherence":
      return (
        <svg {...iconProps}>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "family":
      return (
        <svg {...iconProps}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "upload":
      return (
        <svg {...iconProps}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      );
    case "plus":
      return (
        <svg {...iconProps}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case "ai":
      return (
        <svg {...iconProps}>
          <path d="M12 2a10 10 0 1 1 0 20A10 10 0 0 1 12 2z" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      );
    case "microphone":
      return (
        <svg {...iconProps}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M19 11a7 7 0 0 1-14 0" />
          <line x1="12" y1="18" x2="12" y2="21" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
      );
    case "biometric":
      return (
        <svg {...iconProps}>
          <polyline points="2 12 6.5 12 9 7 13.5 18 16 12 22 12" />
        </svg>
      );
    case "camera":
      return (
        <svg {...iconProps}>
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      );
    default:
      return (
        <svg {...iconProps}>
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
      msgs.push(`Est?s tomando el ${adherence}% de tus medicamentos a tiempo - excelente seguimiento.`);
    } else if (adherence >= 50) {
      msgs.push(`EstÃ¡s tomando el ${adherence}% de tus medicamentos. Puedes mejorar un poco mÃ¡s.`);
    } else {
      msgs.push(`Solo estÃ¡s tomando el ${adherence}% de tus medicamentos. Â¡No olvides tus dosis de hoy!`);
    }
  }

  if (nextAppointment) {
    const apptDate = parseDate(nextAppointment.date_time);
    if (apptDate) {
      const rel = toRelativeDayLabel(apptDate);
      const specialty = cleanUiText(nextAppointment.specialty || typeLabels[nextAppointment.type] || "Cita mÃ©dica");
      msgs.push(`Tienes una cita pr?xima: ${specialty} - ${rel}.`);
    }
  }

  if (activeHealthAlerts.length > 0) {
    const n = activeHealthAlerts.length;
    msgs.push(`Hay ${n} cosa${n > 1 ? "s" : ""} importante${n > 1 ? "s" : ""} para revisar en tu salud. Toca para ver el detalle.`);
  }

  if (lowAdherenceItems.length > 0) {
    const med = cleanUiText(lowAdherenceItems[0]?.name || "");
    if (med) msgs.push(`${med} tiene dosis sin tomar. Â¿Necesitas ajustar el recordatorio?`);
  }

  if (pendingDocuments > 0) {
    msgs.push(`Tienes ${pendingDocuments} documento${pendingDocuments > 1 ? "s" : ""} pendiente${pendingDocuments > 1 ? "s" : ""} de revisiÃ³n.`);
  }

  if (activeMedications.length === 0) {
    msgs.push("Registra tus medicamentos para comenzar el seguimiento de tu plan de salud.");
  }

  if (msgs.length === 0) {
    const timeGreet = hour < 12 ? "Buenos dÃ­as" : hour < 19 ? "Buenas tardes" : "Buenas noches";
    msgs.push(`${timeGreet}, ${firstName}. Tu historial de salud estÃ¡ al dÃ­a.`);
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
  const profileMenuOverlayRef = useRef(null);
  const quickCarouselRef = useRef(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => isHandheldViewport(768));
  const [appointments, setAppointments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [medications, setMedications] = useState([]);
  const [biometricDashboard, setBiometricDashboard] = useState(null);
  const [healthProfiles, setHealthProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [healthRadar, setHealthRadar] = useState([]);
  const [adherenceSummary, setAdherenceSummary] = useState(null);
  const [expandedAlertId, setExpandedAlertId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteColor, setNoteColor] = useState("yellow");
  const [noteReminder, setNoteReminder] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [notesHubOpen, setNotesHubOpen] = useState(false);
  const [quickNotes, setQuickNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteMenuOpenId, setNoteMenuOpenId] = useState(null);
  const [activeQuickActionIndex, setActiveQuickActionIndex] = useState(0);
  const [adherenceGuideOpen, setAdherenceGuideOpen] = useState(false);
  const notesStorageKey = activeProfile?.id ? `klinip:home-notes:${activeProfile.id}` : null;
  const canEditActiveProfile = canWriteProfile(activeProfile);
  const isReadOnlyProfile = isViewerProfile(activeProfile);
  const [greetStarted, setGreetStarted] = useState(false);
  const [greetPhase, setGreetPhase] = useState(0);
  const [aiMsgIndex, setAiMsgIndex] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileMenuStyle, setProfileMenuStyle] = useState({
    top: 0,
    left: 0,
    width: Math.min(320, window.innerWidth - 16),
  });

  const syncProfileMenuPosition = () => {
    if (!profileMenuRef.current || !isMobile) return;
    const rect = profileMenuRef.current.getBoundingClientRect();
    const viewportPad = 8;
    const nextWidth = Math.min(320, window.innerWidth - viewportPad * 2);
    const nextLeft = Math.max(
      viewportPad,
      Math.min(rect.left, window.innerWidth - nextWidth - viewportPad)
    );
    const measuredHeight = profileMenuOverlayRef.current?.offsetHeight || 360;
    let nextTop = rect.bottom + 8;
    if (nextTop + measuredHeight > window.innerHeight - viewportPad) {
      nextTop = Math.max(viewportPad, rect.top - measuredHeight - 8);
    }
    setProfileMenuStyle({
      top: Math.round(nextTop),
      left: Math.round(nextLeft),
      width: Math.round(nextWidth),
    });
  };

  useEffect(() => {
    activeProfileIdRef.current = activeProfile?.id ? Number(activeProfile.id) : null;
  }, [activeProfile?.id]);

  useEffect(() => {
    setNotificationsOpen(false);
    setProfileMenuOpen(false);
  }, [isMobile]);

  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);
  const closeProfileMenu = useCallback(() => setProfileMenuOpen(false), []);
  useClickOutside(notificationsOpen, closeNotifications, notificationsRef);
  useClickOutside(profileMenuOpen, closeProfileMenu, [profileMenuRef, profileMenuOverlayRef]);

  useEffect(() => {
    if (!profileMenuOpen || !isMobile) return undefined;
    syncProfileMenuPosition();
    const frameId = window.requestAnimationFrame(() => {
      syncProfileMenuPosition();
    });
    const handleViewportChange = () => {
      syncProfileMenuPosition();
    };
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, [profileMenuOpen, isMobile]);

  async function loadHealthInsights(profileId) {
    const resolvedProfileId = profileId ? Number(profileId) : undefined;
    const [radarResponse, adherenceResponse] = await Promise.all([
      getAiHealthRadar(resolvedProfileId).catch(() => []),
      getAiAdherence(resolvedProfileId).catch(() => ({})),
    ]);
    if (!isMountedRef.current) {
      return adherenceResponse || {};
    }
    setHealthRadar(ensureArray(radarResponse));
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
        biometricsResponse,
      ] = await Promise.all([
        getActiveHealthProfile().catch(() => null),
        getHealthProfiles().catch(() => []),
        getAppointments().catch(() => []),
        getDocuments().catch(() => []),
        getMedications().catch(() => []),
        getBiometricDashboard().catch(() => null),
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
      setHealthProfiles(ensureArray(profilesResponse));
      setAppointments(ensureArray(appointmentsResponse));
      setDocuments(ensureArray(documentsResponse));
      setMedications(ensureArray(medicationsResponse));
      setBiometricDashboard(biometricsResponse || null);
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
    const handleResize = () => setIsMobile(isHandheldViewport(768));
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
        let nextNotes = ensureArray(response).filter((n) => n.visibility !== "done").slice(0, 6);
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

  useEffect(() => {
    if (!adherenceGuideOpen) return undefined;
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setAdherenceGuideOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [adherenceGuideOpen]);

  const appointmentItems = ensureArray(appointments).filter((item) => item && typeof item === "object");
  const documentItems = ensureArray(documents).filter((item) => item && typeof item === "object");
  const medicationItems = ensureArray(medications).filter((item) => item && typeof item === "object");
  const healthProfileItems = ensureArray(healthProfiles).filter((item) => item && typeof item === "object");
  const healthRadarItems = ensureArray(healthRadar).filter((item) => item && typeof item === "object");
  const safeQuickNotes = ensureArray(quickNotes).filter((item) => item && typeof item === "object");
  const safeNotifications = ensureArray(notifications).filter((item) => item && typeof item === "object");
  const safeMenuHealthProfiles = ensureArray(menuHealthProfiles).filter(
    (item) => item && typeof item === "object"
  );
  const biometricMetrics = ensureArray(biometricDashboard?.metrics).filter(
    (item) => item && typeof item === "object"
  );
  const biometricRecentReadings = ensureArray(biometricDashboard?.recent_readings).filter(
    (item) => item && typeof item === "object"
  );

  const now = Date.now();
  const validAppointments = [...appointmentItems]
    .filter((item) => parseDate(item.date_time))
    .sort((a, b) => parseDate(a.date_time) - parseDate(b.date_time));
  const openAppointments = validAppointments.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status !== "realizada" && status !== "cancelada";
  });
  const futureAppointments = openAppointments.filter(
    (item) => parseDate(item.date_time).getTime() >= now - 15 * 60 * 1000
  );
  const nextAppointment = futureAppointments[0] || null;
  const nextAppointmentDate = nextAppointment ? parseDate(nextAppointment.date_time) : null;
  const nextAppointmentHero = nextAppointmentDate
    ? {
        label: toRelativeDayLabelSafe(nextAppointmentDate) || "En agenda",
        title: cleanUiText(
          nextAppointment.specialty || TYPE_LABELS_SAFE[nextAppointment.type] || "Actividad de salud",
          "Actividad de salud"
        ),
        detail: cleanUiText(
          [
            nextAppointmentDate.toLocaleDateString("es-CL", {
              weekday: "short",
              day: "2-digit",
              month: "short",
            }),
            toTimeLabel(nextAppointmentDate),
            nextAppointment.center || "",
          ]
            .filter(Boolean)
            .join(" Â· "),
          "Revisa el detalle de tu agenda."
        ),
        urgent: nextAppointmentDate.toDateString() === new Date().toDateString(),
      }
    : null;

  const activeMedications = medicationItems.filter((item) => !isMedicationFinished(item));
  const adherenceTotals = activeMedications.reduce(
    (acc, item) => {
      acc.expected += Number(item.expected_doses || 0);
      acc.taken += Number(item.taken_doses || 0);
      return acc;
    },
    { expected: 0, taken: 0 }
  );
  const numericSummaryAdherence = Number(adherenceSummary?.overall_adherence_rate);
  const hasSummaryAdherence =
    adherenceSummary?.overall_adherence_rate !== null &&
    adherenceSummary?.overall_adherence_rate !== undefined &&
    Number.isFinite(numericSummaryAdherence);
  const liveAdherence =
    adherenceTotals.expected > 0
      ? Math.round((adherenceTotals.taken / adherenceTotals.expected) * 100)
      : activeMedications.length
      ? 100
      : 0;
  const adherence =
    hasSummaryAdherence && !adherenceSummary?.pending_refresh
      ? Math.round(numericSummaryAdherence)
      : liveAdherence;
  const lowAdherenceItems = ensureArray(adherenceSummary?.low_adherence_items);
  const adherenceMedicationItems = ensureArray(adherenceSummary?.medication_items);
  const adherencePatternSummary = adherenceSummary?.pattern_summary || {};
  const activeHealthAlerts = healthRadarItems.filter((item) => item.status === "active");
  const overallStatus = getOverallHealthStatus(activeHealthAlerts, adherence, activeMedications);
  const pendingDocuments = documentItems.filter((item) => {
    const status = String(item.ocr_status || "").toLowerCase();
    return !status || status === "pending" || status === "processing" || status === "error";
  }).length;
  const latestBiometricMetric = getBiometricLatestMetric(biometricMetrics);
  const latestBiometricReading = latestBiometricMetric?.latest_reading || null;
  const activeBiometricMetricsCount = Number(biometricDashboard?.active_metrics_count || 0);
  const biometricsMonitoringActive = Boolean(biometricDashboard?.monitoring_active);
  const latestBiometricConfig = latestBiometricReading
    ? getBiometricMetricConfig(latestBiometricMetric.metric_type)
    : getBiometricMetricConfig("glucose");
  const linkedProfiles = Math.max(healthProfileItems.length - 1, 0);
  const adherenceWindowDays = Math.max(1, Number(adherenceSummary?.window_days || 30));
  const adherenceWindowLabel = `${adherenceWindowDays} dia${adherenceWindowDays === 1 ? "" : "s"}`;
  const adherencePercentValue = activeMedications.length ? clampPercent(adherence) : 0;
  const adherencePercentLabel = activeMedications.length ? `${adherencePercentValue}%` : "--";
  const adherenceRingProgress = activeMedications.length ? adherencePercentValue : 0;
  const weakestMedication =
    lowAdherenceItems[0] ||
    [...adherenceMedicationItems].sort(
      (left, right) => Number(left?.adherence_rate || 0) - Number(right?.adherence_rate || 0)
    )[0] ||
    null;
  const adherenceGuide = buildAdherenceGuideData({
    adherence: adherencePercentValue,
    expected: adherenceTotals.expected,
    taken: adherenceTotals.taken,
    activeCount: activeMedications.length,
    windowDays: adherenceWindowDays,
    weakestMedication,
    patternSummary: adherencePatternSummary,
    pendingRefresh: Boolean(adherenceSummary?.pending_refresh),
  });
  const adherenceLeadMedicationName = cleanUiText(weakestMedication?.name || "");
  const lowAdherenceHeroMessage = activeMedications.length
    ? `Tu adherencia a medicamentos es ${adherencePercentValue}% en los ultimos ${adherenceWindowLabel}.${adherenceLeadMedicationName ? ` ${adherenceLeadMedicationName} es el medicamento que necesita mas apoyo.` : ""}`
    : "Activa tu seguimiento para empezar a ver tu adherencia.";
  const adherenceRingTitle = activeMedications.length
    ? `Adherencia ${adherenceWindowLabel}`
    : "Adherencia a medicamentos";
  const mobileAdherenceWindowBadge = activeMedications.length ? adherenceWindowLabel : "";
  const adherenceRingStyle = buildAdherenceRingStyle(adherenceRingProgress);
  const openAdherenceGuide = useCallback(() => {
    setAdherenceGuideOpen(true);
  }, []);
  const adherenceGuidePortal = adherenceGuideOpen
    ? createPortal(
        <div
          className="native-sheet-backdrop"
          role="presentation"
          onClick={() => setAdherenceGuideOpen(false)}
        >
          <div
            className="native-sheet adherence-guide-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="adherence-guide-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="native-sheet-grabber" />
            <div className="adherence-guide-hero">
              <button
                type="button"
                className="adherence-guide-close"
                onClick={() => setAdherenceGuideOpen(false)}
                aria-label="Cerrar explicaciÃ³n del grÃ¡fico"
              >
                x
              </button>
              <span className="adherence-guide-kicker">Adherencia a medicamentos</span>
              <div className="adherence-guide-head">
                <div
                  className="adherence-guide-ring"
                  style={adherenceRingStyle}
                  aria-hidden="true"
                >
                  <span className="adherence-ring-marker" aria-hidden="true" />
                  <span>{adherencePercentLabel}</span>
                </div>
                <div className="adherence-guide-copy">
                  <h3 id="adherence-guide-title">QuÃ© significa este grÃ¡fico</h3>
                  <p>{adherenceGuide.summary}</p>
                </div>
              </div>
            </div>
            <div className="native-sheet-body adherence-guide-body">
              <div className="adherence-guide-legend">
                {adherenceGuide.legend.map((item) => (
                  <div key={item.key} className="adherence-guide-legend-item">
                    <span className={`adherence-guide-swatch tone-${item.tone}`} aria-hidden="true" />
                    <div>
                      <strong>
                        {item.title}
                        {" - "}
                        {item.value}
                      </strong>
                      <p>{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="adherence-guide-insights">
                {adherenceGuide.insights.map((item) => (
                  <div key={item.key} className="adherence-guide-insight-card">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    {item.description ? <p>{item.description}</p> : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="native-sheet-footer adherence-guide-footer">
              {activeMedications.length > 0 ? (
                <button
                  type="button"
                  className="native-btn secondary-btn"
                  onClick={() => {
                    setAdherenceGuideOpen(false);
                    navigate("/medications");
                  }}
                >
                  Ver medicamentos
                </button>
              ) : null}
              <button
                type="button"
                className="native-btn primary-btn"
                onClick={() => setAdherenceGuideOpen(false)}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

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
        : "sin citas prÃ³ximas",
      onClick: () => navigate("/appointments"),
    },
    {
      key: "documents",
      icon: "document",
      tone: pendingDocuments > 0 ? "alert" : "ok",
      label: "Documentos",
      value: pendingDocuments > 0 ? `${pendingDocuments} por subir` : "al dÃ­a",
      onClick: () => navigate("/documents"),
    },
    {
      key: "adherence",
      icon: "adherence",
      tone: activeMedications.length > 0 ? getRadarToneFromAdherence(adherence) : "warn",
      label: "Â¿Tomas a tiempo?",
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
      itemId: item.id,
      date: parseDate(item.date_time),
      kind: item.type === "examen" ? "exam" : "appointment",
      tag: cleanUiText(TYPE_LABELS_SAFE[item.type] || "Cita"),
      title: cleanUiText(item.specialty, TYPE_LABELS_SAFE[item.type] || "Actividad"),
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
          itemId: item.id,
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
    ...biometricRecentReadings.slice(0, 4).map((item) => ({
      id: `biometric-${item.id}`,
      date: parseDate(item.measured_at || item.created_at),
      kind: "biometric",
      title: "BiomÃ©trico registrado",
      subtitle: cleanUiText(
        `${getBiometricMetricConfig(item.metric_type).label} Â· ${formatBiometricValue(item)}`,
        "Registro biomÃ©trico"
      ),
      time: item.measured_at || item.created_at,
    })),
    ...documentItems.map((item) => ({
      id: `document-${item.id}`,
      date: parseDate(item.date || item.created_at),
      kind: "document",
      title: "Documento agregado",
      subtitle: cleanUiText(item.center, item.type || "Documento de salud"),
      time: item.date || item.created_at,
    })),
    ...medicationItems.map((item) => ({
      id: `medication-${item.id}`,
      date: parseDate(item.created_at || item.end_date),
      kind: "medication",
      title: "Medicamento registrado",
      subtitle: `${item.name || "Medicamento"}${item.dose ? ` - ${item.dose}` : ""}`,
      time: item.created_at || item.end_date,
    })),
    ...appointmentItems.map((item) => ({
      id: `appointment-${item.id}`,
      date: parseDate(item.date_time),
      kind: "appointment",
      title: "Actividad agendada",
      subtitle:
        cleanUiText(`${TYPE_LABELS_SAFE[item.type] || "Actividad"}${item.specialty ? ` - ${item.specialty}` : ""}`) ||
        "Actividad",
      time: item.date_time,
    })),
  ]
    .filter((item) => item.date)
    .sort((a, b) => b.date - a.date)
    .slice(0, 4);

  const nextMedicationEvent = upcomingEvents.find((item) => item.kind === "medication") || null;
  const nextAppointmentEvent =
    upcomingEvents.find((item) => item.kind === "appointment" || item.kind === "exam") || null;

  const openNotesHub = useCallback(() => {
    setNotificationsOpen(false);
    setProfileMenuOpen(false);
    setNotesHubOpen(true);
  }, []);

  const closeNotesHub = useCallback(() => {
    setNotesHubOpen(false);
    setNoteMenuOpenId(null);
  }, []);

  const openMedicationFocus = useCallback(() => {
    navigate("/medications");
  }, [navigate]);

  const openAppointmentFocus = useCallback(() => {
    navigate(nextAppointmentEvent ? "/appointments" : "/calendar");
  }, [navigate, nextAppointmentEvent]);

  const openDocumentsFocus = useCallback(() => {
    navigate("/documents");
  }, [navigate]);

  const openBiometricsFocus = useCallback(() => {
    navigate("/mi-salud/biometricos");
  }, [navigate]);

  const openAlertAssistant = useCallback(
    (alert) => {
      if (!alert) {
        navigate("/ai", {
          state: {
            autoPrompt: "AyÃºdame a revisar mis alertas y pendientes de salud de hoy.",
          },
        });
        return;
      }
      navigate("/ai", {
        state: {
          autoPrompt: `Tengo una alerta en mi Radar de Salud: "${cleanUiText(
            getFriendlyAlertTitle(alert)
          )}". ${cleanUiText(alert.description)} Â¿QuÃ© debo hacer hoy paso a paso?`,
        },
      });
    },
    [navigate]
  );

  const topHighAlert = activeHealthAlerts.find((item) => item.severity === "high") || null;
  const topAlert = topHighAlert || activeHealthAlerts[0] || null;
  const topLowAdherenceItem = lowAdherenceItems[0] || null;
  const biometricsSummaryText = latestBiometricReading
    ? cleanUiText(
        `${latestBiometricMetric.label}: ${formatBiometricValue(latestBiometricReading)} Â· ${formatBiometricMeasuredAt(
          latestBiometricReading.measured_at || latestBiometricReading.created_at
        )}`,
        "Revisa tu monitoreo reciente."
      )
    : "Empieza a registrar glucosa, presiÃ³n, frecuencia cardiaca o temperatura.";
  const topHighAlertType = String(topHighAlert?.alert_type || "").toLowerCase();
  const highAlertHeroState =
    topHighAlertType === "low_adherence"
      ? {
          tone: "alert",
          badge: "Urgente",
          title: "Adherencia baja",
          message: lowAdherenceHeroMessage,
          actionLabel: "Revisar tratamiento",
          onAction: () => openAlertAssistant(topHighAlert),
        }
      : {
          tone: "alert",
          badge: "Urgente",
          title: cleanUiText(getFriendlyAlertTitle(topHighAlert)),
          message: cleanUiText(
            topHighAlert?.description,
            "Tienes una alerta clinica que conviene revisar hoy."
          ),
          actionLabel: "Revisar alerta",
          onAction: () => openAlertAssistant(topHighAlert),
        };

  const heroState = topHighAlert
    ? {
        tone: "alert",
        badge: "Urgente",
        title: cleanUiText(getFriendlyAlertTitle(topHighAlert)),
        message: cleanUiText(
          topHighAlert.description,
          "Tienes una alerta clÃ­nica que conviene revisar hoy."
        ),
        actionLabel: "Revisar alerta",
        onAction: () => openAlertAssistant(topHighAlert),
      }
    : nextMedicationEvent?.urgent || topLowAdherenceItem
    ? {
        tone: "warn",
        badge: "Pendiente",
        title: nextMedicationEvent?.urgent
          ? "Tienes una toma pendiente hoy"
          : "Conviene revisar tu adherencia",
        message: nextMedicationEvent?.urgent
          ? cleanUiText(
              `${nextMedicationEvent.title}${nextMedicationEvent.meta ? ` Â· ${nextMedicationEvent.meta}` : ""}`,
              "Revisa tu dosis pendiente."
            )
          : cleanUiText(
              `${topLowAdherenceItem?.name || "Un medicamento"} necesita mÃ¡s constancia esta semana.`,
              "Revisa tus recordatorios."
            ),
        actionLabel: "Tomar medicamento",
        onAction: openMedicationFocus,
      }
    : nextAppointment
    ? {
        tone: "warn",
        badge: "PrÃ³xima cita",
        title: "Tu siguiente cita ya estÃ¡ en agenda",
        message: cleanUiText(
          `${nextAppointment.specialty || TYPE_LABELS_SAFE[nextAppointment.type] || "Actividad"} Â· ${
            toRelativeDayLabelSafe(parseDate(nextAppointment.date_time)) || "PrÃ³ximamente"
          }`,
          "Revisa el detalle de tu prÃ³xima cita."
        ),
        actionLabel: "Ver prÃ³xima cita",
        onAction: openAppointmentFocus,
      }
    : pendingDocuments > 0
    ? {
        tone: "warn",
        badge: "Documentos",
        title: "Tienes documentos por revisar",
        message: `${pendingDocuments} documento${pendingDocuments > 1 ? "s" : ""} necesita${
          pendingDocuments > 1 ? "n" : ""
        } tu atenciÃ³n.`,
        actionLabel: "Subir documento",
        onAction: openDocumentsFocus,
      }
    : {
        tone: "ok",
        badge: "Todo en orden",
        title: "Tu control diario estÃ¡ al dÃ­a",
        message: activeMedications.length
          ? "No hay alertas crÃ­ticas. Klinip dejÃ³ listos tus prÃ³ximos pasos."
          : "Activa tu seguimiento para empezar a ver recordatorios y prioridades clÃ­nicas.",
        actionLabel: activeMedications.length ? "Ver medicamentos" : "Agregar medicamento",
        onAction: openMedicationFocus,
      };

  const displayHeroState =
    topHighAlertType === "low_adherence"
      ? highAlertHeroState
      : !topHighAlert && topLowAdherenceItem && !nextMedicationEvent?.urgent
      ? {
          ...heroState,
          message: lowAdherenceHeroMessage,
        }
      : heroState;

  const heroHighlights = [
    {
      id: "status",
      label: "Estado de hoy",
      value: displayHeroState.badge,
      tone: displayHeroState.tone,
    },
    {
      id: "adherence",
      label: "Adherencia",
      value: activeMedications.length ? `${adherence}%` : "Sin datos",
      tone:
        activeMedications.length > 0
          ? getRadarToneFromAdherence(adherence)
          : pendingDocuments > 0
          ? "warn"
          : "ok",
    },
    {
      id: "next",
      label: nextAppointmentEvent ? "PrÃ³ximo paso" : "Documentos",
      value: nextAppointmentEvent
        ? toRelativeDayLabelSafe(nextAppointmentEvent.date) || "En agenda"
        : pendingDocuments > 0
        ? `${pendingDocuments} pendiente${pendingDocuments > 1 ? "s" : ""}`
        : "Sin pendientes",
      tone:
        nextAppointmentEvent?.urgent || pendingDocuments > 0
          ? "warn"
          : nextAppointmentEvent
          ? "ok"
          : "ok",
    },
  ];

  const attentionItems = [
    topAlert
      ? {
          id: `alert-${topAlert.id}`,
          tone: getAlertTone(topAlert.severity),
          eyebrow: "Radar de salud",
          title: cleanUiText(getFriendlyAlertTitle(topAlert)),
          detail: cleanUiText(
            topAlert.description,
            "Toca para ver quÃ© hacer con Klinip IA."
          ),
          actionLabel: "Abrir IA",
          onClick: () => openAlertAssistant(topAlert),
        }
      : null,
    nextMedicationEvent
      ? {
          id: nextMedicationEvent.id,
          tone: nextMedicationEvent.urgent ? "alert" : "warn",
          eyebrow: nextMedicationEvent.urgent ? "Dosis de hoy" : "Medicamento",
          title: cleanUiText(nextMedicationEvent.title),
          detail: cleanUiText(
            `${toRelativeDayLabelSafe(nextMedicationEvent.date)}${nextMedicationEvent.meta ? ` Â· ${nextMedicationEvent.meta}` : ""}`,
            "Revisa tu recordatorio."
          ),
          actionLabel: "Tomar medicamento",
          onClick: openMedicationFocus,
        }
      : null,
    nextAppointmentEvent
      ? {
          id: nextAppointmentEvent.id,
          tone: nextAppointmentEvent.urgent ? "alert" : "warn",
          eyebrow: "Agenda",
          title: cleanUiText(nextAppointmentEvent.title),
          detail: cleanUiText(
            `${toRelativeDayLabelSafe(nextAppointmentEvent.date)}${nextAppointmentEvent.meta ? ` Â· ${nextAppointmentEvent.meta}` : ""}`,
            "Revisa el detalle de tu agenda."
          ),
          actionLabel: "Ver cita",
          onClick: openAppointmentFocus,
        }
      : null,
    pendingDocuments > 0
      ? {
          id: "documents-pending",
          tone: pendingDocuments > 1 ? "warn" : "ok",
          eyebrow: "Documentos",
          title: `${pendingDocuments} documento${pendingDocuments > 1 ? "s" : ""} pendiente${
            pendingDocuments > 1 ? "s" : ""
          }`,
          detail: "Sube resultados, recetas o informes para mantener tu historial completo.",
          actionLabel: "Subir ahora",
          onClick: openDocumentsFocus,
        }
      : null,
  ].filter(Boolean);

  const quickActions = [
    {
      id: "photo",
      icon: "camera",
      label: "Tomar foto",
      subtitle: "Registra un documento con una foto",
      hint: "Rápido",
      tone: "blue",
      onClick: () => setWizardOpen(true),
    },
    {
      id: "medication",
      icon: "medication",
      label: "Tomar medicamento",
      subtitle: nextMedicationEvent
        ? cleanUiText(nextMedicationEvent.title, "Revisa tus tomas activas")
        : activeMedications.length
        ? "Revisa tus tomas activas"
        : "Activa un tratamiento",
      hint: nextMedicationEvent?.urgent ? "Ahora" : activeMedications.length ? "Pendiente" : "Ver",
      tone: "amber",
      onClick: openMedicationFocus,
    },
    {
      id: "appointment",
      icon: "appointment",
      label: "Ver prÃ³xima cita",
      subtitle: nextAppointmentEvent
        ? cleanUiText(nextAppointmentEvent.title, "Revisa tu agenda")
        : "Agenda tu prÃ³ximo control",
      hint: nextAppointmentEvent ? toRelativeDayLabelSafe(nextAppointmentEvent.date) : "Sin cita",
      tone: "blue",
      onClick: openAppointmentFocus,
    },
    {
      id: "document",
      icon: "upload",
      label: "Subir documento",
      subtitle:
        pendingDocuments > 0
          ? `${pendingDocuments} pendiente${pendingDocuments > 1 ? "s" : ""} por revisar`
          : "Guarda exÃ¡menes e informes",
      hint: pendingDocuments > 0 ? "Pendiente" : "Nuevo",
      tone: "teal",
      onClick: openDocumentsFocus,
    },
    {
      id: "biometric",
      icon: "biometric",
      label: "Ver biomÃ©tricos",
      subtitle: latestBiometricReading
        ? cleanUiText(
            `${latestBiometricMetric.label} Â· ${formatBiometricValue(latestBiometricReading)}`,
            "Monitoreo activo"
          )
        : "Activa tu monitoreo clÃ­nico",
      hint: latestBiometricReading
        ? `${activeBiometricMetricsCount} activo${activeBiometricMetricsCount === 1 ? "" : "s"}`
        : "Nuevo",
      tone: latestBiometricConfig.tone || "violet",
      onClick: openBiometricsFocus,
    },
  ];

  const mobileQuickActions = quickActions;

  const suggestionItems = [];
  if (!futureAppointments.length) {
    suggestionItems.push({
      id: "suggestion-appointment",
      text: "No tienes citas prÃ³ximas registradas. Agenda tu prÃ³ximo control.",
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
      text: `${activeHealthAlerts.length} alerta${activeHealthAlerts.length > 1 ? "s" : ""} detectada${activeHealthAlerts.length > 1 ? "s" : ""} por el radar de salud. RevÃ­salas con Klinip IA.`,
    });
  }

  if (!biometricsMonitoringActive) {
    suggestionItems.push({
      id: "suggestion-biometric",
      text: "Si estÃ¡s controlando exÃ¡menes o signos frecuentes, activa el panel de biomÃ©tricos para seguirlos en un solo lugar.",
    });
  }

  const visibleQuickActions = quickActions;

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
  const canSwitchProfiles = safeMenuHealthProfiles.length > 1;
  const activeMenuProfile =
    safeMenuHealthProfiles.find((item) => Number(item.id) === Number(activeProfileId)) ||
    activeProfile ||
    safeMenuHealthProfiles[0] ||
    null;
  const planLabel =
    normalizedPlan === "familiar"
      ? "Plan Familiar"
      : normalizedPlan === "plus"
      ? "Plan Plus"
      : "Plan BÃ¡sico";
  const quickNotesActionLabel = canEditActiveProfile ? (composerOpen ? "Cerrar" : "Nueva nota") : "Solo lectura";
  const openQuickNotesPanel = () => {
    if (composerOpen) {
      handleCancelNote();
    } else if (canEditActiveProfile) {
      setComposerOpen(true);
    }
  };
  const syncQuickCarouselIndex = (container) => {
    if (!container || !mobileQuickActions.length) {
      setActiveQuickActionIndex(0);
      return;
    }
    const firstSlide = container.querySelector(".mobile-quick-slide");
    if (!firstSlide) {
      setActiveQuickActionIndex(0);
      return;
    }
    const styles = window.getComputedStyle(container);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
    const step = firstSlide.offsetWidth + gap;
    if (!step) {
      setActiveQuickActionIndex(0);
      return;
    }
    const nextIndex = Math.round(container.scrollLeft / step);
    setActiveQuickActionIndex(Math.max(0, Math.min(nextIndex, mobileQuickActions.length - 1)));
  };
  const renderQuickNotesPanel = (panelClassName = "") => (
    <article className={`home-panel-card home-notes-card ${panelClassName}`.trim()}>
      <div className="home-panel-head">
        <div>
          <h2 className="home-panel-title">{"Notas r\u00e1pidas"}</h2>
          <p className="home-panel-subtitle">Pendientes e ideas de tu cuidado.</p>
        </div>
        <button
          type="button"
          className="home-panel-link"
          onClick={openQuickNotesPanel}
        >
          {quickNotesActionLabel}
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
          <div className="home-loading">{"Cargando notas r\u00e1pidas..."}</div>
        ) : safeQuickNotes.length ? (
          safeQuickNotes.map((item) => (
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
                        onClick={() => {
                          handleStartEditNote(item);
                          setNoteMenuOpenId(null);
                        }}
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
                        onClick={() => {
                          handleDeleteNote(item.id);
                          setNoteMenuOpenId(null);
                        }}
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
          <div className="home-empty-state">{"Todav\u00eda no guardas notas r\u00e1pidas."}</div>
        )}
      </div>
    </article>
  );
  useEffect(() => {
    if (!notesHubOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeNotesHub();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [notesHubOpen, closeNotesHub]);

  const notesHubPortal = notesHubOpen
    ? createPortal(
        <div className="home-notes-dialog-backdrop" onClick={closeNotesHub}>
          <div
            className={`home-notes-dialog${isMobile ? " is-mobile" : ""}`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Notas rápidas"
          >
            <button
              type="button"
              className="home-notes-dialog-close"
              onClick={closeNotesHub}
              aria-label="Cerrar notas rápidas"
            >
              x
            </button>
            {renderQuickNotesPanel("home-notes-dialog-card")}
          </div>
        </div>,
        document.getElementById("overlay-root") || document.body
      )
    : null;
  const planLabelSafe =
    normalizedPlan === "familiar"
      ? "Plan Familiar"
      : normalizedPlan === "plus"
      ? "Plan Plus"
      : "Plan BÃ¡sico";

  const renderAttentionContent = (itemClassName, tagClassName = "") =>
    attentionItems.length ? (
      attentionItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${itemClassName} tone-${item.tone}`.trim()}
          onClick={item.onClick}
        >
          <span className={`home-attention-icon tone-${item.tone}`}>
            {renderIcon(
              cleanUiText(item.eyebrow) === "Documentos"
                ? "document"
                : cleanUiText(item.eyebrow) === "Agenda"
                ? "appointment"
                : cleanUiText(item.eyebrow) === "Medicamento" || cleanUiText(item.eyebrow) === "Dosis de hoy"
                ? "medication"
                : "ai"
            )}
          </span>
          <span className="home-attention-copy">
            <small className="home-attention-eyebrow">{cleanUiText(item.eyebrow)}</small>
            <strong>{cleanUiText(item.title)}</strong>
            <span>{cleanUiText(item.detail)}</span>
          </span>
          <span className={`home-attention-action ${tagClassName}`.trim()}>{cleanUiText(item.actionLabel)}</span>
        </button>
      ))
    ) : (
      <div className="home-empty-state">
        Tu día está ordenado. Usa las acciones rápidas para registrar nuevos movimientos.
      </div>
    );

  const renderQuickActionsContent = (itemClassName, hintClassName = "") =>
    visibleQuickActions.map((item) => (
      <button
        key={item.id}
        type="button"
        className={`${itemClassName} tone-${item.tone}`.trim()}
        onClick={item.onClick}
      >
        <span className="home-action-icon">{renderIcon(item.icon)}</span>
        <span className="home-action-copy">
          <strong>{cleanUiText(item.label)}</strong>
          <small>{cleanUiText(item.subtitle)}</small>
        </span>
        <span className={`home-action-hint ${hintClassName}`.trim()}>{cleanUiText(item.hint)}</span>
      </button>
    ));

  const newMobileHome = (() => {
    const greetingIntro =
      new Date().getHours() < 12
        ? "Buenos días"
        : new Date().getHours() < 18
        ? "Buenas tardes"
        : "Buenas noches";
    const mobileProfileMenu = profileMenuOpen
      ? createPortal(
          <div
            ref={profileMenuOverlayRef}
            className="topbar-user-menu mobile-hero-profile-overlay"
            role="menu"
            style={{
              position: "fixed",
              top: `${profileMenuStyle.top}px`,
              left: `${profileMenuStyle.left}px`,
              right: "auto",
              width: `${profileMenuStyle.width}px`,
            }}
          >
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
                <span className="topbar-user-menu-plan">{planLabelSafe}</span>
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
                  {safeMenuHealthProfiles.map((item) => (
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
              <button type="button" className="topbar-user-menu-item" role="menuitem">
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
                  <input type="checkbox" checked={theme === "dark"} onChange={() => onToggleTheme?.()} />
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
              <span>Cerrar sesiÃ³n</span>
            </button>
          </div>,
          document.getElementById("overlay-root") || document.body
        )
      : null;

    return (
      <>
        <div className="mobile-dashboard native-mobile-scene">
          <div className="mobile-hero native-surface native-surface-hero">
            <div className="mobile-hero-topbar">
              <div className="mobile-hero-user">
                <div className="topbar-user-wrap mobile-hero-avatar-wrap" ref={profileMenuRef}>
                  <button
                    type="button"
                    className="mobile-hero-avatar"
                    aria-label="Abrir menÃº de usuario"
                    aria-expanded={profileMenuOpen}
                    aria-haspopup="menu"
                    onClick={() => {
                      setNotificationsOpen(false);
                      setProfileMenuOpen((prev) => !prev);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M6 20a6 6 0 0 1 12 0" />
                    </svg>
                  </button>
                  {mobileProfileMenu}
                </div>
                <div className="mobile-hero-user-info">
                  <p className="mobile-hero-greeting-sub">{greetingIntro}</p>
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
                    {safeNotifications.length > 0 ? (
                      <span className="notification-badge">{safeNotifications.length}</span>
                    ) : null}
                  </button>
                  {notificationsOpen ? (
                    <div className="notifications-dropdown">
                      <div className="notifications-header">
                        <span className="notifications-heading">Notificaciones</span>
                        {safeNotifications.length > 0 ? (
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
                        ) : null}
                      </div>
                      {safeNotifications.length ? (
                        <ul className="notifications-list">
                          {safeNotifications.slice(0, 6).map((item) => (
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
                  ) : null}
                </div>
              </div>
            </div>

            <div className={`mobile-hero-health-card home-mobile-clinical-card tone-${displayHeroState.tone}`}>
              <div className="mobile-hero-stat-label">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2">
                  {displayHeroState.tone === "ok" ? (
                    <polyline points="20 6 9 17 4 12" />
                  ) : (
                    <path d="M12 9v4m0 4h.01M12 3L2 21h20L12 3z" />
                  )}
                </svg>
                Centro de control diario
              </div>
              <div className="mobile-hero-health-main">
                <div>
                  <div className="mobile-hero-stat-row">
                    <span className="mobile-hero-stat-value">{displayHeroState.badge}</span>
                    {mobileAdherenceWindowBadge ? (
                      <span className={`mobile-hero-stat-badge is-${displayHeroState.tone}`}>
                        {mobileAdherenceWindowBadge}
                      </span>
                    ) : null}
                  </div>
                  <p className="home-mobile-clinical-title">{cleanUiText(displayHeroState.title)}</p>
                  <p className="mobile-hero-health-copy home-mobile-clinical-copy">{cleanUiText(displayHeroState.message)}</p>
                  {nextAppointmentHero ? (
                    <button
                      type="button"
                      className="mobile-hero-appointment-card"
                      onClick={openAppointmentFocus}
                    >
                      <span className={`mobile-hero-appointment-day${nextAppointmentHero.urgent ? " is-urgent" : ""}`}>
                        Próxima cita · {cleanUiText(nextAppointmentHero.label)}
                      </span>
                      <strong>{cleanUiText(nextAppointmentHero.title)}</strong>
                      <span>{cleanUiText(nextAppointmentHero.detail)}</span>
                    </button>
                  ) : null}
                </div>
                <div className="mobile-hero-progress-wrap">
                    <button
                      type="button"
                      className="mobile-hero-progress"
                      style={adherenceRingStyle}
                      aria-label={`${adherenceRingTitle} ${adherencePercentLabel}. Presiona para ver el detalle.`}
                      title="Presiona el aro para ver el detalle"
                      onClick={openAdherenceGuide}
                  >
                    <span className="adherence-ring-marker" aria-hidden="true" />
                    <span>{adherencePercentLabel}</span>
                  </button>
                  <span className="mobile-hero-progress-title">{adherenceRingTitle}</span>
                  <span className="mobile-hero-progress-hint">Ver detalle</span>
                </div>
              </div>
              <div className="mobile-hero-badges home-mobile-badges">
                <span className="mobile-hero-profile-badge">
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="8" r="3" />
                    <path d="M6 19.5a6 6 0 0 1 12 0" />
                  </svg>
                  {activeProfileName}
                </span>
                {nextAppointmentEvent ? (
                  <span className="mobile-hero-profile-badge">
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    {toRelativeDayLabelSafe(nextAppointmentEvent.date)}
                  </span>
                ) : null}
              </div>
              <div className="home-mobile-hero-actions">
                <button type="button" className="mobile-hero-recommendation-btn" onClick={displayHeroState.onAction}>
                  {cleanUiText(displayHeroState.actionLabel)}
                </button>
                <button type="button" className="home-mobile-notes-btn" onClick={openNotesHub}>
                  Notas rápidas
                </button>
              </div>
            </div>
          </div>

          <div className="mobile-sheet">
            <div className="mobile-sheet-handle" />

            {isReadOnlyProfile ? (
              <div className="mobile-section native-section native-section-delay-1">
                <div className="card home-readonly-card">
                  <div className="alert-info">
                    <p>
                      <strong>Perfil en modo lectura.</strong> Puedes revisar prioridades y registros, pero no editar
                      desde Inicio.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mobile-section native-section native-section-delay-1">
              <div className="mobile-section-header">
                <h2 className="mobile-section-title">Atención de hoy</h2>
                <button type="button" className="mobile-section-link" onClick={() => openAlertAssistant(topAlert)}>
                  Abrir IA
                </button>
              </div>
              <div className="home-mobile-attention-list">
                {renderAttentionContent("mobile-activity-item home-mobile-focus-item", "is-mobile")}
              </div>
            </div>

            <div className="mobile-section native-section native-section-delay-2">
              <div className="mobile-section-header">
                <h2 className="mobile-section-title">Acciones rápidas</h2>
                <button type="button" className="mobile-section-link" onClick={openNotesHub}>
                  Notas
                </button>
              </div>
              <div className="home-mobile-action-stack">
                {renderQuickActionsContent("home-mobile-action-item", "is-mobile")}
              </div>
            </div>
          </div>
        </div>
        {notesHubPortal}
        {adherenceGuidePortal}
      </>
    );
  })();
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

  // Phase 0 -> 1: after title finishes typing
  useEffect(() => {
    if (!titleTyper.done || greetPhase !== 0 || !greetStarted) return;
    const t = window.setTimeout(() => setGreetPhase(1), 350);
    return () => window.clearTimeout(t);
  }, [titleTyper.done, greetPhase, greetStarted]);

  // Phase 1 -> 2: after subtitle finishes typing
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

  useEffect(() => {
    if (!isMobile) return;
    setActiveQuickActionIndex(0);
    if (quickCarouselRef.current) {
      quickCarouselRef.current.scrollLeft = 0;
    }
  }, [isMobile]);

  if (isMobile) {
    return newMobileHome;
  }


  return (
    <>
      <section className="home-editorial">
        <div className="home-editorial-layout home-editorial-layout-clinical">
          <div className="home-editorial-top">
            <article className={`home-greeting-card home-summary-card home-clinical-hero tone-${displayHeroState.tone}`}>
              <div className="home-greeting-copy home-clinical-copy-wrap">
                <div className="home-clinical-status-row">
                  <span className={`home-clinical-pill tone-${displayHeroState.tone}`}>{displayHeroState.badge}</span>
                  <span className="status-badge status-badge-green">
                    <span className="status-badge-label">Perfil activo</span>
                    <span className="status-badge-value">{activeProfileName}</span>
                  </span>
                </div>
                <h1 className="home-greeting-title">
                  Hola, <em>{userName}</em>
                </h1>
                <p className="home-clinical-headline">{cleanUiText(displayHeroState.title)}</p>
                <p className="home-greeting-subtitle home-clinical-summary">{cleanUiText(displayHeroState.message)}</p>
                {nextAppointmentHero ? (
                  <button
                    type="button"
                    className="home-clinical-appointment-card"
                    onClick={openAppointmentFocus}
                  >
                    <span className={`home-clinical-appointment-day${nextAppointmentHero.urgent ? " is-urgent" : ""}`}>
                      Próxima cita · {cleanUiText(nextAppointmentHero.label)}
                    </span>
                    <strong>{cleanUiText(nextAppointmentHero.title)}</strong>
                    <span>{cleanUiText(nextAppointmentHero.detail)}</span>
                  </button>
                ) : null}
                <div className="home-clinical-actions">
                  <button type="button" className="home-note-primary home-clinical-primary" onClick={displayHeroState.onAction}>
                    {cleanUiText(displayHeroState.actionLabel)}
                  </button>
                  <button type="button" className="home-panel-link home-clinical-secondary" onClick={openNotesHub}>
                    Notas rápidas
                  </button>
                </div>
              </div>
              <div className="home-greeting-side home-clinical-side">
                <button
                  type="button"
                  className="home-clinical-ring-button"
                  onClick={openAdherenceGuide}
                  title="Presiona el aro para ver el detalle"
                  aria-label={`${adherenceRingTitle} ${adherencePercentLabel}. Presiona para ver el detalle.`}
                >
                  <span
                    className="home-clinical-ring-meter"
                    style={adherenceRingStyle}
                  >
                    <span className="adherence-ring-marker" aria-hidden="true" />
                    <strong>{adherencePercentLabel}</strong>
                  </span>
                  <small>{adherenceRingTitle}</small>
                  <span className="home-clinical-ring-link">Ver detalle</span>
                </button>
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
                <div className="home-clinical-meta">
                  {heroHighlights.map((item) => (
                    <div key={item.id} className={`home-clinical-metric tone-${item.tone}`}>
                          <small>{cleanUiText(item.label)}</small>
                          <strong>{cleanUiText(item.value)}</strong>
                        </div>
                      ))}
                </div>
                <button type="button" className="home-greeting-profile" onClick={() => navigate("/settings")}>
                  <span className="home-greeting-profile-dot">{profileInitials(activeProfileName)}</span>
                  {planLabelSafe}
                </button>
              </div>
            </article>
          </div>

          <div className="home-editorial-left">
            {isReadOnlyProfile ? (
              <div className="card home-readonly-card">
                <div className="alert-info">
                  <p>
                    <strong>Perfil en modo lectura.</strong> Puedes revisar prioridades y registros, pero no editar
                    desde Inicio.
                  </p>
                </div>
              </div>
            ) : null}

            <article className="home-panel-card home-attention-card">
              <div className="home-panel-head">
                <div>
                  <h2 className="home-panel-title">Atención de hoy</h2>
                  <p className="home-panel-subtitle">Lo que realmente importa resolver primero.</p>
                </div>
                <button type="button" className="home-panel-link" onClick={() => openAlertAssistant(topAlert)}>
                  Abrir IA
                </button>
              </div>
              <div className="home-attention-list">
                {renderAttentionContent("home-attention-item")}
              </div>
            </article>
          </div>

          <div className="home-editorial-right">
            <article className="home-panel-card home-actions-card home-actions-card-compact">
              <div className="home-panel-head">
                <div>
                  <h2 className="home-panel-title">Acciones rápidas</h2>
                  <p className="home-panel-subtitle">Tres atajos para resolver tu día de salud.</p>
                </div>
                <button type="button" className="home-panel-link home-notes-trigger" onClick={openNotesHub}>
                  Abrir notas
                </button>
              </div>
              <div className="home-actions-grid home-actions-grid-compact">
                {renderQuickActionsContent("home-action-item home-action-item-rich")}
              </div>
            </article>
          </div>
        </div>

        {loading ? <div className="home-loading">Actualizando tu resumen de salud...</div> : null}
      </section>
      {notesHubPortal}
    </>
  );

  return (
    <>
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
                <h2 className="home-panel-title">Voz</h2>
                <p className="home-panel-subtitle">Graba tu prÃ³xima consulta mÃ©dica.</p>
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
                <span className="home-voice-btn-label">Iniciar grabaciÃ³n</span>
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
                <p className="home-panel-subtitle">Estado general de tu perfil</p>
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
                          {expandedAlertId === item.id ? "Presiona para cerrar" : "Presiona aquÃ­ para ver quÃ© hacer"}
                        </span>
                      </button>
                      {expandedAlertId === item.id ? (
                        <div className="home-radar-alert-detail">
                          <strong>Â¿QuÃ© puedo hacer?</strong>
                          <p>{cleanUiText(getAlertDetail(item))}</p>
                          <button
                            type="button"
                            className="home-radar-alert-ai-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate("/ai", {
                                state: {
                                  autoPrompt: `Tengo una alerta en mi Radar de Salud: "${cleanUiText(getFriendlyAlertTitle(item))}". ${cleanUiText(item.description)} Â¿QuÃ© debo hacer paso a paso?`,
                                },
                              });
                            }}
                          >
                            Consultar con IA
                          </button>
                        </div>
                      ) : null}
                    </React.Fragment>
                  ))
                ) : (
                  <div className="home-empty-state">No hay alertas activas. Â¡Tu salud estÃ¡ al dÃ­a!</div>
                )}
              </div>
              {lowAdherenceItems.length ? (
                <div className="home-radar-pattern">
                  <strong>Estos medicamentos necesitan atenciÃ³n</strong>
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
                  <p className="home-panel-subtitle">Acciones frecuentes al alcance de tu mano.</p>
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

            <DocumentUploadWizard
              open={wizardOpen}
              onClose={() => setWizardOpen(false)}
              profileId={activeProfile?.id}
              onUploaded={() =>
                notifyClinicalDataChanged({
                  profileId: activeProfile?.id,
                  sources: ["documents", "health-radar"],
                })
              }
            />

            <article className="home-panel-card home-biometrics-card">
              <div className="home-panel-head">
                <div>
                  <h2 className="home-panel-title">BiomÃ©tricos</h2>
                  <p className="home-panel-subtitle">Resumen permanente de tu monitoreo clÃ­nico.</p>
                </div>
                <button type="button" className="home-panel-link" onClick={openBiometricsFocus}>
                  Ver panel
                </button>
              </div>
              <button type="button" className="home-biometrics-summary" onClick={openBiometricsFocus}>
                <span className={`home-biometrics-icon tone-${latestBiometricConfig.tone || "violet"}`}>
                  {renderIcon("biometric")}
                </span>
                <span className="home-biometrics-copy">
                  <strong>
                    {latestBiometricReading
                      ? `${latestBiometricMetric.label}: ${formatBiometricValue(latestBiometricReading)}`
                      : "Comienza tu monitoreo"}
                  </strong>
                  <span>{biometricsSummaryText}</span>
                </span>
                <span className="home-biometrics-status">
                  {activeBiometricMetricsCount > 0
                    ? `${activeBiometricMetricsCount} activo${activeBiometricMetricsCount === 1 ? "" : "s"}`
                    : "Nuevo"}
                </span>
              </button>
              <div className="home-biometrics-metrics">
                {biometricMetrics.filter((item) => item.readings_count > 0).slice(0, 3).map((item) => {
                  const metricConfig = getBiometricMetricConfig(item.metric_type);
                  return (
                    <div key={item.metric_type} className={`home-biometrics-metric tone-${metricConfig.tone}`}>
                      <small>{item.label}</small>
                      <strong>
                        {item.latest_reading ? formatBiometricValue(item.latest_reading) : "Sin datos"}
                      </strong>
                    </div>
                  );
                })}
                {!biometricMetrics.some((item) => item.readings_count > 0) ? (
                  <div className="home-empty-state">
                    Registra glucosa, presiÃ³n, frecuencia cardiaca o temperatura para ver tu evoluciÃ³n aquÃ­.
                  </div>
                ) : null}
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

          {renderQuickNotesPanel()}
        </div>
      </div>

        {loading ? <div className="home-loading">Actualizando tu resumen de salud...</div> : null}
      </section>
      {adherenceGuidePortal}
    </>
  );
}
