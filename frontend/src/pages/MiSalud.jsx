import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getAppointments, getMedications, getDocuments } from "../services/httpApi";

/* ── helpers ───────────────────────────────────────────────── */
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function relativeDateLabel(date) {
  if (!date) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "Vencida";
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  if (diff < 7) return `En ${diff} días`;
  return date.toLocaleDateString("es", { day: "numeric", month: "short" });
}

function formatTime12h(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

/* ── icons (24px, stroke) ──────────────────────────────────── */
function IcoCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IcoPill() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m10.5 20.5-7-7a5 5 0 1 1 7-7l7 7a5 5 0 0 1-7 7Z" />
      <path d="m8.5 8.5 7 7" />
    </svg>
  );
}
function IcoDocument() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  );
}
function IcoTimeline() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20V10" />
      <path d="M18 20V4" />
      <path d="M6 20v-4" />
    </svg>
  );
}
function IcoReport() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11 12 14l4-4" />
      <path d="M20 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2Z" />
      <path d="M8 6V4a2 2 0 0 1 4 0v2" />
    </svg>
  );
}
function IcoGridCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </svg>
  );
}
function IcoStats() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  );
}
function IcoChevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
function IcoAlertCircle() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}
function IcoCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function clpIcon(key) {
  switch (key) {
    case "calendar":   return <IcoCalendar />;
    case "pill":       return <IcoPill />;
    case "document":   return <IcoDocument />;
    case "timeline":   return <IcoTimeline />;
    case "report":     return <IcoReport />;
    case "calendar2":  return <IcoGridCalendar />;
    case "stats":      return <IcoStats />;
    default:           return <IcoDocument />;
  }
}

/* ── component ─────────────────────────────────────────────── */
export default function MiSalud() {
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState([]);
  const [medications, setMedications] = useState([]);
  const [documents, setDocuments] = useState([]);

  useEffect(() => {
    Promise.allSettled([
      getAppointments(),
      getMedications(),
      getDocuments(),
    ]).then(([apptRes, medRes, docRes]) => {
      if (apptRes.status === "fulfilled") setAppointments(apptRes.value || []);
      if (medRes.status === "fulfilled") setMedications(medRes.value || []);
      if (docRes.status === "fulfilled") setDocuments(docRes.value || []);
      setLoading(false);
    });
  }, []);

  const now = new Date();

  /* — derived — */
  const upcomingAppts = appointments
    .filter((a) => a.status !== "realizada" && a.date_time && parseDate(a.date_time) > now)
    .sort((a, b) => parseDate(a.date_time) - parseDate(b.date_time));
  const nextAppt = upcomingAppts[0] || null;
  const pendingAppts = appointments.filter((a) => a.status !== "realizada");

  const activeMeds = medications.filter((m) => !m.completed);
  const medsScheduled = activeMeds.filter((m) => m.schedule_time);

  /* — today alerts (within 2 days or med with schedule) — */
  const alerts = [];
  const urgentAppts = upcomingAppts.filter((a) => {
    const d = parseDate(a.date_time);
    return d && d - now < 2 * 24 * 60 * 60 * 1000;
  });
  if (urgentAppts.length > 0) {
    alerts.push({
      icon: "calendar",
      name: urgentAppts[0].specialty || urgentAppts[0].title || "Cita médica",
      detail: relativeDateLabel(parseDate(urgentAppts[0].date_time)),
      tag: "Cita próxima",
      link: "/appointments",
      tone: "blue",
    });
  }
  if (medsScheduled.length > 0) {
    alerts.push({
      icon: "pill",
      name: medsScheduled[0].name,
      detail: `${formatTime12h(medsScheduled[0].schedule_time)}${medsScheduled[0].dose ? " · " + medsScheduled[0].dose : ""}`,
      tag: "Medicamento",
      link: "/medications",
      tone: "green",
    });
  }

  /* — health status — */
  const statusItems = [];
  if (!loading) {
    if (nextAppt) {
      statusItems.push({ ok: true, text: `Próxima cita: ${relativeDateLabel(parseDate(nextAppt.date_time))}` });
    } else if (pendingAppts.length > 0) {
      statusItems.push({ ok: false, text: `${pendingAppts.length} cita${pendingAppts.length > 1 ? "s" : ""} sin fecha` });
    }
    if (activeMeds.length > 0) {
      statusItems.push({ ok: true, text: `${activeMeds.length} tratamiento${activeMeds.length > 1 ? "s" : ""} activo${activeMeds.length > 1 ? "s" : ""}` });
    }
    if (documents.length > 0) {
      statusItems.push({ ok: true, text: `${documents.length} documento${documents.length > 1 ? "s" : ""} en archivo` });
    }
  }
  const hasAlerts = !loading && alerts.length > 0;
  const overallOk = statusItems.length > 0 && statusItems.every((s) => s.ok);

  /* — modules — */
  const modules = [
    {
      to: "/appointments",
      icon: "calendar",
      label: "Citas y exámenes",
      sub: loading
        ? "Cargando…"
        : nextAppt
        ? `Próxima: ${nextAppt.specialty || nextAppt.title || "Consulta"} · ${relativeDateLabel(parseDate(nextAppt.date_time))}`
        : pendingAppts.length > 0
        ? `${pendingAppts.length} pendiente${pendingAppts.length > 1 ? "s" : ""} por agendar`
        : "Sin citas próximas",
      badge: pendingAppts.length > 0 ? pendingAppts.length : null,
    },
    {
      to: "/medications",
      icon: "pill",
      label: "Medicamentos",
      sub: loading
        ? "Cargando…"
        : activeMeds.length > 0
        ? `${activeMeds.length} activo${activeMeds.length > 1 ? "s" : ""}${medsScheduled.length > 0 ? " · Hoy " + formatTime12h(medsScheduled[0].schedule_time) : ""}`
        : "Sin tratamientos activos",
      badge: activeMeds.length > 0 ? activeMeds.length : null,
    },
    {
      to: "/documents",
      icon: "document",
      label: "Documentos",
      sub: loading
        ? "Cargando…"
        : documents.length > 0
        ? `${documents.length} archivo${documents.length > 1 ? "s" : ""} · Exámenes y recetas`
        : "Sin documentos",
      badge: null,
    },
    {
      to: "/timeline",
      icon: "timeline",
      label: "Historia clínica",
      sub: "Línea de tiempo de eventos y diagnósticos",
      badge: null,
    },
    {
      to: "/clinical-reports",
      icon: "report",
      label: "Reportes IA",
      sub: "Resumen clínico para tu próximo control",
      badge: null,
    },
    {
      to: "/calendar",
      icon: "calendar2",
      label: "Calendario",
      sub: "Plan mensual de salud",
      badge: null,
    },
    {
      to: "/stats",
      icon: "stats",
      label: "Indicadores",
      sub: "Métricas de citas, documentos y medicamentos",
      badge: null,
    },
  ];

  return (
    <div className="clp-page">

      {/* ── KPI row ── */}
      <div className="clp-kpi-row" aria-label="Resumen de salud">
        <Link to="/appointments" className="clp-kpi-card">
          <span className="clp-kpi-eyebrow">Próxima cita</span>
          <strong className="clp-kpi-value">
            {loading ? "—" : nextAppt ? relativeDateLabel(parseDate(nextAppt.date_time)) : "—"}
          </strong>
          <span className="clp-kpi-meta">
            {loading ? "" : nextAppt ? (nextAppt.specialty || nextAppt.title || "Consulta") : "Sin agendar"}
          </span>
        </Link>

        <Link to="/medications" className="clp-kpi-card">
          <span className="clp-kpi-eyebrow">Tratamientos</span>
          <strong className="clp-kpi-value">
            {loading ? "—" : `${activeMeds.length}`}
          </strong>
          <span className="clp-kpi-meta">
            {loading ? "" : activeMeds.length > 0 ? `activo${activeMeds.length > 1 ? "s" : ""}` : "ninguno"}
          </span>
        </Link>

        <Link to="/documents" className="clp-kpi-card">
          <span className="clp-kpi-eyebrow">Documentos</span>
          <strong className="clp-kpi-value">
            {loading ? "—" : `${documents.length}`}
          </strong>
          <span className="clp-kpi-meta">
            {loading ? "" : documents.length === 1 ? "archivo" : "archivos"}
          </span>
        </Link>
      </div>

      {/* ── Status bar ── */}
      {!loading && statusItems.length > 0 && (
        <div className={`clp-status-bar ${overallOk ? "is-ok" : "is-warn"}`} aria-label="Estado general">
          <span className="clp-status-icon">
            {overallOk ? <IcoCheck /> : <IcoAlertCircle />}
          </span>
          <div className="clp-status-list">
            {statusItems.map((s, i) => (
              <span key={i} className={`clp-status-item ${s.ok ? "ok" : "warn"}`}>{s.text}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── Para hoy ── */}
      {hasAlerts && (
        <section className="clp-section" aria-labelledby="clp-today-title">
          <h2 className="clp-section-heading" id="clp-today-title">Para hoy</h2>
          <div className="clp-alert-list">
            {alerts.map((alert, i) => (
              <Link key={i} to={alert.link} className={`clp-alert-item tone-${alert.tone}`}>
                <span className="clp-alert-icon">{clpIcon(alert.icon)}</span>
                <div className="clp-alert-copy">
                  <span className="clp-alert-tag">{alert.tag}</span>
                  <p className="clp-alert-name">{alert.name}</p>
                  <p className="clp-alert-detail">{alert.detail}</p>
                </div>
                <span className="clp-alert-chevron"><IcoChevron /></span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Module list ── */}
      <section className="clp-section" aria-labelledby="clp-modules-title">
        <h2 className="clp-section-heading" id="clp-modules-title">Tu sistema clínico</h2>
        <div className="clp-module-list" role="list">
          {modules.map((mod) => (
            <Link key={mod.to} to={mod.to} className="clp-module-item" role="listitem">
              <span className="clp-module-icon">{clpIcon(mod.icon)}</span>
              <div className="clp-module-copy">
                <p className="clp-module-label">{mod.label}</p>
                <p className="clp-module-sub">{mod.sub}</p>
              </div>
              {mod.badge ? (
                <span className="clp-module-badge">{mod.badge}</span>
              ) : null}
              <span className="clp-module-chevron"><IcoChevron /></span>
            </Link>
          ))}
        </div>
      </section>

    </div>
  );
}
