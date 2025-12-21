import React, { useEffect, useMemo, useState } from "react";
import { getAppointments, getDocuments } from "../api";
import {
  requestNotificationPermission,
  scheduleReminderNotifications,
  sendEmailReminder,
  clearScheduledNotifications,
} from "../services/notifications";
import {
  parseDate,
  toIsoOrNull,
  toLocaleDateOrEmpty,
  toLocaleDateTimeOrEmpty,
} from "../utils/dates";

const typeLabels = {
  cita: "Cita médica",
  examen: "Examen",
  tramite: "Trámite",
};

const statusLabels = {
  pendiente: "Pendiente",
  agendada: "Agendada",
  realizada: "Realizada",
};

export default function Dashboard({ user }) {
  const [appointments, setAppointments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    async function load() {
      const [apptData, docData] = await Promise.all([
        getAppointments(),
        getDocuments(),
      ]);
      setAppointments(apptData || []);
      setDocuments(docData || []);
    }
    load();
  }, []);

  useEffect(() => {
    requestNotificationPermission().then(setNotificationsReady);
    return () => clearScheduledNotifications();
  }, []);

  const upcoming = useMemo(() => {
    const withDate = appointments.filter((a) => parseDate(a.date_time));
    return withDate
      .filter((a) => a.status !== "realizada")
      .sort((a, b) => {
        const aDate = parseDate(a.date_time);
        const bDate = parseDate(b.date_time);
        if (!aDate) return 1;
        if (!bDate) return -1;
        return aDate - bDate;
      })
      .slice(0, 5);
  }, [appointments]);

  const kpis = useMemo(() => {
    const pendiente = appointments.filter((a) => a.status === "pendiente").length;
    const agendada = appointments.filter((a) => a.status === "agendada").length;
    return [
      { label: "Pendientes", value: pendiente },
      { label: "Agendadas", value: agendada },
      { label: "Documentos", value: documents.length },
    ];
  }, [appointments, documents]);

  const alert = useMemo(() => {
    if (!upcoming.length) return { label: "Sin actividades próximas", color: "#6b7280", dot: "gray" };
    const first = parseDate(upcoming[0].date_time);
    if (!first) return { label: "Sin actividades próximas", color: "#6b7280", dot: "gray" };
    const now = new Date();
    const diffDays = (first - now) / (1000 * 60 * 60 * 24);
    if (diffDays <= 2) return { label: "Atención: actividad muy próxima", color: "#b91c1c", dot: "red" };
    if (diffDays <= 7) return { label: "Tienes actividades en la próxima semana", color: "#f59e0b", dot: "yellow" };
    return { label: "Próximas actividades programadas", color: "#16a34a", dot: "green" };
  }, [upcoming]);

  const reminders = useMemo(() => {
    const now = new Date();
    return (appointments || [])
      .filter((a) => parseDate(a.date_time))
      .map((a) => {
        const when = parseDate(a.date_time);
        if (!when) return null;
        const diff = (when - now) / (1000 * 60 * 60 * 24);
        let severity = "green";
        let label = "En orden";
        if (diff <= 1) {
          severity = "red";
          label = "Hoy / Mañana (1 día)";
        } else if (diff <= 3) {
          severity = "yellow";
          label = "Próximos 3 días";
        } else if (diff <= 7) {
          severity = "yellow";
          label = "Próximos 7 días";
        }
        return {
          ...a,
          diff,
          severity,
          label,
        };
      })
      .filter((r) => r && r.diff >= 0)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 8);
  }, [appointments]);

  useEffect(() => {
    if (!notificationsReady) return;
    scheduleReminderNotifications(reminders);
  }, [notificationsReady, reminders]);

  const exportCsv = () => {
    if (!appointments?.length) return;
    const header = ["id", "tipo", "especialidad", "centro", "fecha", "estado", "notas"];
    const rows = appointments.map((a) => [
      a.id,
      a.type,
      a.specialty || "",
      a.center || "",
      a.date_time ? toIsoOrNull(a.date_time) || "" : "",
      a.status,
      (a.notes || "").replace(/"/g, '""'),
    ]);
    const csv = [header.join(","), ...rows.map((r) => r.map((x) => `"${x}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "citas.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const html = `
      <html>
        <head>
          <title>Klinip - Resumen</title>
          <style>
            body { font-family: Poppins, Arial, sans-serif; padding: 16px; }
            h1 { font-size: 20px; margin: 0 0 12px; }
            h2 { font-size: 16px; margin: 12px 0 6px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #e5e7eb; padding: 6px; text-align: left; }
            th { background: #f8fafc; }
          </style>
        </head>
        <body>
          <h1>Klinip - Resumen</h1>
          <h2>Citas</h2>
          <table>
            <thead><tr><th>Tipo</th><th>Especialidad</th><th>Centro</th><th>Fecha</th><th>Estado</th></tr></thead>
            <tbody>
              ${appointments
                .map(
                  (a) =>
                    `<tr><td>${a.type}</td><td>${a.specialty || ""}</td><td>${a.center || ""}</td><td>${
                      a.date_time ? toLocaleDateTimeOrEmpty(a.date_time) : ""
                    }</td><td>${a.status}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
          <h2>Documentos</h2>
          <table>
            <thead><tr><th>Tipo</th><th>Centro</th><th>Fecha</th></tr></thead>
            <tbody>
              ${documents
                .map(
                  (d) =>
                    `<tr><td>${d.doc_type}</td><td>${d.center || ""}</td><td>${
                      d.date ? toLocaleDateOrEmpty(d.date) : ""
                    }</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
        </body>
      </html>
    `;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const shareLink = async () => {
    try {
      setExporting(true);
      const payload = {
        appointments,
        documents,
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const link = `${window.location.origin}/#share=${encoded}`;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        alert("Link de compartición copiado al portapapeles.");
      } else {
        prompt("Copia este link", link);
      }
    } catch (err) {
      console.error("No se pudo generar link", err);
      alert("No se pudo generar el link.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="summary-bar">
        <div>
          <p className="summary-eyebrow">Resumen</p>
          <h1 className="summary-title">Hola {user?.name || "invitado"}</h1>
          <p className="summary-subtitle">Citas, recordatorios y documentos en un solo lugar.</p>
        </div>
        <div className="summary-status">
          <span className={`dot ${alert.dot}`} />
          <div>
            <p className="summary-label">Radar</p>
            <p className="summary-value">{alert.label}</p>
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        {kpis.map((k) => (
          <div key={k.label} className="card kpi">
            <p className="kpi-label">{k.label}</p>
            <p className="kpi-value">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Lo próximo</h2>
            <p className="muted">Máximo 5 actividades con fecha en tu agenda.</p>
          </div>
          <div className="traffic">
            <span className={`dot ${alert.dot}`} />
            <span style={{ color: alert.color }}>{alert.label}</span>
          </div>
        </div>
        {upcoming.length === 0 ? (
          <p className="muted">
            Aún no registras fechas. Agrega tu próxima atención para verla aquí.
          </p>
        ) : (
          <ul className="timeline">
            {upcoming.map((a) => (
              <li key={a.id} className="timeline-item">
                <div className="timeline-main">
                  <span className={`chip ${a.type}`}>{typeLabels[a.type] || a.type}</span>
                  <span className={`chip-status-${a.status}`}>
                    {statusLabels[a.status] || a.status}
                  </span>
                </div>
                <p className="timeline-title">
                  {a.specialty || "Sin especialidad"} · {a.center || "Centro no definido"}
                </p>
                <p className="timeline-meta">
                  {a.date_time
                    ? toLocaleDateTimeOrEmpty(a.date_time) || "Por agendar"
                    : "Por agendar"}
                </p>
                {a.notes && <p className="timeline-notes">Notas: {a.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Recordatorios y alertas</h2>
            <p className="muted">
              Alertas del navegador. Activa push si tu navegador lo permite.
            </p>
          </div>
          <div className="traffic">
            <span className="dot red" /> <span className="dot yellow" /> <span className="dot green" />
          </div>
        </div>
        {reminders.length === 0 ? (
          <p className="muted">Sin recordatorios pendientes.</p>
        ) : (
          <ul className="reminder-list">
            {reminders.map((r) => (
              <li key={r.id} className="reminder-item">
                <div className={`alert-pill ${r.severity}`}>
                  {r.severity === "red" && "🔴"}
                  {r.severity === "yellow" && "🟡"}
                  {r.severity === "green" && "🟢"}
                  <span>{r.label}</span>
                </div>
                <div className="reminder-body">
                  <div className="reminder-title">
                    {typeLabels[r.type] || r.type} · {r.center || "Centro no definido"}
                  </div>
                  <div className="reminder-meta">
                    {r.date_time
                      ? toLocaleDateTimeOrEmpty(r.date_time) || "Por agendar"
                      : "Por agendar"}
                    {r.notes ? ` · ${r.notes}` : ""}
                  </div>
                </div>
                <div className="reminder-actions">
                  <button
                    className="secondary-btn ghost"
                    type="button"
                    onClick={() => sendEmailReminder(r)}
                  >
                    Correo
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
          <p className="tiny-note" style={{ marginTop: "0.75rem" }}>
            Tipos de aviso: 1 día, 3 días y 7 días antes. Para el backend real se podrán activar
            correos o WhatsApp; en móvil PWA se usarán notificaciones push.
          </p>
        </div>

      <div className="card">
        <div className="card-header" style={{ alignItems: "center" }}>
          <div>
            <h2 className="card-title">Exportar y compartir</h2>
            <p className="muted">Lleva tus citas y documentos a PDF/CSV o comparte un link temporal.</p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="secondary-btn" type="button" onClick={exportCsv}>
              CSV citas
            </button>
            <button className="secondary-btn" type="button" onClick={exportPdf}>
              PDF resumen
            </button>
            <button className="primary-btn" type="button" onClick={shareLink} disabled={exporting}>
              {exporting ? "Generando..." : "Compartir link"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
