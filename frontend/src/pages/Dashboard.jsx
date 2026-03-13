import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getActiveHealthProfile,
  getAiAdherence,
  getAiHealthRadar,
  getAppointments,
  getDocuments,
  getHealthProfiles,
  getMedications,
} from "../api";
import { parseDate } from "../utils/dates";

const typeLabels = {
  cita: "Cita",
  examen: "Examen",
  tramite: "Tramite",
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
  if (diffDays === 1) return "Manana";
  if (diffDays > 1) return `En ${diffDays} dias`;
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
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 15" />
        </svg>
      );
  }
}

export default function Dashboard({ user }) {
  const navigate = useNavigate();
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

  useEffect(() => {
    let cancelled = false;
    async function loadHome() {
      try {
        const [
          activeProfileResponse,
          profilesResponse,
          appointmentsResponse,
          documentsResponse,
          medicationsResponse,
          radarResponse,
          adherenceResponse,
        ] = await Promise.all([
          getActiveHealthProfile().catch(() => null),
          getHealthProfiles().catch(() => []),
          getAppointments().catch(() => []),
          getDocuments().catch(() => []),
          getMedications().catch(() => []),
          getAiHealthRadar().catch(() => []),
          getAiAdherence().catch(() => ({})),
        ]);
        if (cancelled) return;
        setActiveProfile(activeProfileResponse || null);
        setHealthProfiles(Array.isArray(profilesResponse) ? profilesResponse : []);
        setAppointments(Array.isArray(appointmentsResponse) ? appointmentsResponse : []);
        setDocuments(Array.isArray(documentsResponse) ? documentsResponse : []);
        setMedications(Array.isArray(medicationsResponse) ? medicationsResponse : []);
        setHealthRadar(Array.isArray(radarResponse) ? radarResponse : []);
        setAdherenceSummary(adherenceResponse || {});
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadHome();
    return () => {
      cancelled = true;
    };
  }, []);

  const notesStorageKey = `klinip:home-notes:${activeProfile?.id || user?.id || "guest"}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(notesStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setQuickNotes(Array.isArray(parsed) ? parsed : []);
    } catch {
      setQuickNotes([]);
    }
  }, [notesStorageKey]);

  useEffect(() => {
    localStorage.setItem(notesStorageKey, JSON.stringify(quickNotes.slice(0, 6)));
  }, [notesStorageKey, quickNotes]);

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
        : "sin citas proximas",
    },
    {
      key: "documents",
      icon: "document",
      tone: pendingDocuments > 0 ? "alert" : "ok",
      label: "Documentos",
      value: pendingDocuments > 0 ? `${pendingDocuments} pendientes` : "al dia",
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
      tag: typeLabels[item.type] || "Cita",
      title: item.specialty || typeLabels[item.type] || "Actividad",
      meta: [item.center, item.notes].filter(Boolean).join(" - ") || "Sin detalle adicional",
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
      subtitle: item.center || item.type || "Documento de salud",
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
        `${typeLabels[item.type] || "Actividad"}${item.specialty ? ` - ${item.specialty}` : ""}` ||
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
      text: "No tienes citas proximas registradas. Agenda tu proximo control.",
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

  const handleSaveNote = () => {
    const value = noteDraft.trim();
    if (!value) return;
    const entry = {
      id: `${Date.now()}`,
      text: value,
      created_at: new Date().toISOString(),
    };
    setQuickNotes((prev) => [entry, ...prev].slice(0, 6));
    setNoteDraft("");
    setComposerOpen(false);
  };

  const userName = user?.name || activeProfile?.full_name || "tu cuenta";
  const activeProfileName = activeProfile?.full_name || "Mi perfil";

  return (
    <section className="home-editorial">
      <div className="home-editorial-layout">
        <div className="home-editorial-left">
          <article className="home-greeting-card">
            <div className="home-greeting-copy">
              <p className="home-greeting-eyebrow">Resumen personal</p>
              <h1 className="home-greeting-title">
                Hola, <em>{userName}</em>
              </h1>
              <p className="home-greeting-subtitle">Este es tu resumen de salud para hoy.</p>
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

          <article className="home-panel-card">
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
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
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
                    {lowAdherenceItems
                      .slice(0, 2)
                      .map((item) => `${item.name}: ${item.adherence_rate}%`)
                      .join(" · ")}
                  </span>
                </div>
              ) : null}
            </div>
          </article>

          <article className="home-panel-card">
            <div className="home-panel-head">
              <div>
                <h2 className="home-panel-title">Actividad proxima</h2>
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
                      <strong>{item.title}</strong>
                      <span>{[toTimeLabel(item.date), item.meta].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className={`home-upcoming-tag tone-${item.kind === "medication" ? "amber" : item.kind === "exam" ? "teal" : "blue"}`}>
                      {item.tag}
                    </span>
                  </button>
                ))
              ) : (
                <div className="home-empty-state">Sin actividad proxima registrada.</div>
              )}
            </div>
          </article>

          <article className="home-panel-card">
            <div className="home-panel-head">
              <div>
                <h2 className="home-panel-title">Acciones rapidas</h2>
                <p className="home-panel-subtitle">Ejecuta tareas comunes sin navegar por menus.</p>
              </div>
            </div>
            <div className="home-actions-grid">
              {quickActions.map((item) => (
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
          <article className="home-panel-card">
            <div className="home-panel-head">
              <div>
                <h2 className="home-panel-title">Notas rapidas</h2>
                <p className="home-panel-subtitle">Pendientes e ideas de tu cuidado.</p>
              </div>
              <button
                type="button"
                className="home-panel-link"
                onClick={() => setComposerOpen((prev) => !prev)}
              >
                {composerOpen ? "Cerrar" : "Nueva nota"}
              </button>
            </div>
            {composerOpen && (
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
                    onClick={() => {
                      setComposerOpen(false);
                      setNoteDraft("");
                    }}
                  >
                    Cancelar
                  </button>
                  <button type="button" className="home-note-primary" onClick={handleSaveNote}>
                    Guardar nota
                  </button>
                </div>
              </div>
            )}
            <div className="home-notes-list">
              {quickNotes.length ? (
                quickNotes.map((item, index) => (
                  <button key={item.id} type="button" className="home-note-row">
                    <span className={`home-note-dot tone-${["blue", "violet", "green", "amber"][index % 4]}`} />
                    <span className="home-note-copy">
                      <strong>{item.text}</strong>
                      <small>
                        {parseDate(item.created_at)?.toLocaleString("es-CL", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }) || "Reciente"}
                      </small>
                    </span>
                  </button>
                ))
              ) : (
                <div className="home-empty-state">Todavia no guardas notas rapidas.</div>
              )}
            </div>
          </article>

          <article className="home-panel-card">
            <div className="home-panel-head">
              <div>
                <h2 className="home-panel-title">Actividad reciente</h2>
                <p className="home-panel-subtitle">Ultimas acciones en la aplicacion.</p>
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
                      <strong>{item.title}</strong>
                      <small>{item.subtitle}</small>
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
                <div className="home-empty-state">Aun no hay actividad reciente.</div>
              )}
            </div>
          </article>

          <article className="home-panel-card">
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
                    <span>{item.text}</span>
                  </button>
                ))
              ) : (
                <div className="home-empty-state">Tu resumen esta al dia por ahora.</div>
              )}
            </div>
          </article>
        </div>
      </div>

      {loading ? <div className="home-loading">Actualizando tu resumen de salud...</div> : null}
    </section>
  );
}
