import React, { useEffect, useMemo, useState } from "react";
import {
  getAppointments,
  getDocuments,
  getMedications,
  uploadDocument,
  updateDocument,
} from "../api";
import {
  requestNotificationPermission,
  scheduleReminderNotifications,
  scheduleMedicationNotifications,
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
  const [medications, setMedications] = useState([]);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const [docForm, setDocForm] = useState({
    doc_type: "otro",
    date: "",
    center: "",
    notes: "",
  });
  const [docFile, setDocFile] = useState(null);
  const [docUploading, setDocUploading] = useState(false);
  const [docAutoFill, setDocAutoFill] = useState(true);
  const [ocrDocId, setOcrDocId] = useState(null);
  const [ocrStatus, setOcrStatus] = useState("");
  const [ocrResult, setOcrResult] = useState(null);
  const [ocrEdit, setOcrEdit] = useState(null);
  const [ocrSaving, setOcrSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const [apptData, docData, medData] = await Promise.all([
        getAppointments(),
        getDocuments(),
        getMedications(),
      ]);
      setAppointments(apptData || []);
      setDocuments(docData || []);
      setMedications(medData || []);
    }
    load();
  }, []);

  useEffect(() => {
    if (!ocrDocId) return;
    let attempts = 0;
    let stopped = false;

    const poll = async () => {
      if (stopped) return;
      attempts += 1;
      try {
        const docData = await getDocuments();
        const current = (docData || []).find((d) => d.id === ocrDocId);
        if (current) {
          setOcrStatus(current.ocr_status || "pending");
          if (
            current.ocr_status === "done" ||
            (current.ocr_status || "").startsWith("error") ||
            current.ocr_status === "skipped_size"
          ) {
            setOcrResult(current);
            return;
          }
        }
      } catch (err) {
        console.error("No se pudo actualizar OCR", err);
      }
      if (attempts >= 15) return;
      setTimeout(poll, 2000);
    };

    poll();
    return () => {
      stopped = true;
    };
  }, [ocrDocId]);

  useEffect(() => {
    if (!ocrResult) return;
    const parsedDate = parseDate(ocrResult.date);
    setOcrEdit({
      doc_type: ocrResult.doc_type || "otro",
      date: parsedDate ? parsedDate.toISOString().slice(0, 10) : "",
      center: ocrResult.center || "",
      notes: ocrResult.notes || "",
    });
  }, [ocrResult]);

  const handleOcrSave = async () => {
    if (!ocrDocId || !ocrEdit) return;
    setOcrSaving(true);
    try {
      await updateDocument(ocrDocId, {
        doc_type: ocrEdit.doc_type,
        date: toIsoOrNull(ocrEdit.date),
        center: ocrEdit.center,
        notes: ocrEdit.notes,
      });
      const docData = await getDocuments();
      setDocuments(docData || []);
      window.alert("Documento actualizado.");
      resetDocForm();
      setShowDocForm(false);
    } catch (err) {
      console.error(err);
      window.alert("No se pudo actualizar el documento.");
    } finally {
      setOcrSaving(false);
    }
  };

  const resetDocForm = () => {
    setDocForm({
      doc_type: "otro",
      date: "",
      center: "",
      notes: "",
    });
    setDocFile(null);
    setDocAutoFill(true);
    setOcrDocId(null);
    setOcrStatus("");
    setOcrResult(null);
    setOcrEdit(null);
    setOcrSaving(false);
  };

  const handleDocSubmit = async (e) => {
    e.preventDefault();
    if (!docFile) {
      window.alert("Debes seleccionar una foto o PDF.");
      return;
    }
    setDocUploading(true);
    try {
      const payload = docAutoFill
        ? {
            doc_type: "otro",
            date: "",
            center: "",
            notes: "",
            file: docFile,
          }
        : {
            doc_type: docForm.doc_type,
            date: toIsoOrNull(docForm.date),
            center: docForm.center,
            notes: docForm.notes,
            file: docFile,
          };
      const uploaded = await uploadDocument({
        ...payload,
      });
      if (uploaded?.id) {
        setOcrDocId(uploaded.id);
        setOcrStatus(uploaded.ocr_status || "pending");
      }
      const docData = await getDocuments();
      setDocuments(docData || []);
      if (!docAutoFill) {
        resetDocForm();
        setShowDocForm(false);
      }
      window.alert("Documento subido. La IA está analizando el contenido.");
    } catch (err) {
      console.error(err);
      window.alert("No se pudo subir el documento.");
    } finally {
      setDocUploading(false);
    }
  };

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
    scheduleMedicationNotifications(medications);
  }, [notificationsReady, reminders, medications]);

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
        window.alert("Link de compartición copiado al portapapeles.");
      } else {
        prompt("Copia este link", link);
      }
    } catch (err) {
      console.error("No se pudo generar link", err);
      window.alert("No se pudo generar el link.");
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
            <h2 className="card-title">Subir documento o foto</h2>
            <p className="muted">
              Sube una foto o PDF y la IA intentará completar la información.
            </p>
          </div>
          <button
            className="primary-btn"
            type="button"
            onClick={() => setShowDocForm(true)}
          >
            Subir archivo
          </button>
        </div>
      </div>

      {showDocForm && (
        <div className="floating-form-backdrop" onClick={() => setShowDocForm(false)}>
          <div className="floating-form-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-header" style={{ marginBottom: "0.75rem" }}>
              <h3 className="card-title" style={{ marginBottom: 0 }}>
                Nuevo documento
              </h3>
              <button
                className="secondary-btn"
                type="button"
                onClick={() => {
                  resetDocForm();
                  setShowDocForm(false);
                }}
              >
                Cerrar
              </button>
            </div>
            {ocrDocId ? (
              <div>
                <p className="muted" style={{ marginBottom: "0.5rem" }}>
                  Estado OCR: {ocrStatus || "pendiente"}
                </p>
                {ocrResult && ocrEdit ? (
                  <>
                    {!ocrEdit.date ? (
                      <p className="muted" style={{ marginBottom: "0.75rem" }}>
                        Falta fecha u hora. Puedes agregarla manualmente en Citas.
                      </p>
                    ) : null}
                    <div className="form-row">
                      <div className="input-group">
                        <label className="input-label">Tipo</label>
                        <select
                          className="select-field"
                          value={ocrEdit.doc_type}
                          onChange={(e) =>
                            setOcrEdit({ ...ocrEdit, doc_type: e.target.value })
                          }
                        >
                          <option value="receta">Receta</option>
                          <option value="orden">Orden</option>
                          <option value="resultado">Resultado</option>
                          <option value="informe">Informe</option>
                          <option value="otro">Otro</option>
                        </select>
                      </div>
                      <div className="input-group">
                        <label className="input-label">Fecha</label>
                        <input
                          className="input-field"
                          type="date"
                          value={ocrEdit.date}
                          onChange={(e) =>
                            setOcrEdit({ ...ocrEdit, date: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="input-group">
                        <label className="input-label">Centro de salud</label>
                        <input
                          className="input-field"
                          value={ocrEdit.center}
                          onChange={(e) =>
                            setOcrEdit({ ...ocrEdit, center: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="input-group">
                      <label className="input-label">Notas</label>
                      <textarea
                        className="textarea-field"
                        value={ocrEdit.notes}
                        onChange={(e) =>
                          setOcrEdit({ ...ocrEdit, notes: e.target.value })
                        }
                      />
                    </div>
                  </>
                ) : (
                  <p className="muted">Analizando el documento...</p>
                )}
                <div className="floating-actions">
                  {ocrResult ? (
                    <button
                      className="primary-btn"
                      type="button"
                      onClick={handleOcrSave}
                      disabled={ocrSaving}
                    >
                      {ocrSaving ? "Guardando..." : "Guardar ajustes"}
                    </button>
                  ) : null}
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => {
                      resetDocForm();
                      setShowDocForm(false);
                    }}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleDocSubmit}>
                <div className="input-group">
                  <label className="input-label">Archivo (foto o PDF)</label>
                <input
                  className="input-field"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setDocFile(e.target.files[0] || null)}
                />
                  <span className="tiny-note">
                    Puedes tomar una foto o subir un PDF. Límite recomendado: 4 MB.
                  </span>
                </div>

                <div className="input-group">
                  <label className="input-label">Autocompletar con IA</label>
                  <select
                    className="select-field"
                    value={docAutoFill ? "yes" : "no"}
                    onChange={(e) => setDocAutoFill(e.target.value === "yes")}
                  >
                    <option value="yes">Sí, completar automáticamente</option>
                    <option value="no">No, editar manualmente</option>
                  </select>
                </div>

                {!docAutoFill && (
                  <>
                    <div className="form-row">
                      <div className="input-group">
                        <label className="input-label">Tipo de documento</label>
                        <select
                          className="select-field"
                          value={docForm.doc_type}
                          onChange={(e) =>
                            setDocForm({ ...docForm, doc_type: e.target.value })
                          }
                        >
                          <option value="receta">Receta</option>
                          <option value="orden">Orden</option>
                          <option value="resultado">Resultado</option>
                          <option value="informe">Informe</option>
                          <option value="otro">Otro</option>
                        </select>
                      </div>
                      <div className="input-group">
                        <label className="input-label">Fecha del documento</label>
                        <input
                          className="input-field"
                          type="date"
                          value={docForm.date}
                          onChange={(e) =>
                            setDocForm({ ...docForm, date: e.target.value })
                          }
                        />
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="input-group">
                        <label className="input-label">Centro de salud</label>
                        <input
                          className="input-field"
                          value={docForm.center}
                          onChange={(e) =>
                            setDocForm({ ...docForm, center: e.target.value })
                          }
                          placeholder="CESFAM, hospital, laboratorio..."
                        />
                      </div>
                    </div>

                    <div className="input-group">
                      <label className="input-label">Notas</label>
                      <textarea
                        className="textarea-field"
                        value={docForm.notes}
                        onChange={(e) =>
                          setDocForm({ ...docForm, notes: e.target.value })
                        }
                        placeholder="Ej: Receta vence en 3 meses, control con médico X."
                      />
                    </div>
                  </>
                )}

                <div className="floating-actions">
                  <button className="primary-btn" type="submit" disabled={docUploading}>
                    {docUploading ? "Subiendo..." : "Subir documento"}
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      resetDocForm();
                      setShowDocForm(false);
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

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
