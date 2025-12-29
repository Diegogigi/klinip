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

  const handleOpenAiAnalysis = () => {
    resetDocForm();
    setDocAutoFill(true);
    setShowDocForm(true);
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
    // DESACTIVADO: Las notificaciones ahora se envían desde el servidor vía push
    // Para evitar duplicados, solo confiamos en el sistema de push notifications
    // Si quieres reactivar notificaciones locales, descomenta las siguientes líneas:
    // if (!notificationsReady) return;
    // scheduleReminderNotifications(reminders);
    // scheduleMedicationNotifications(medications);
  }, [notificationsReady, reminders, medications]);
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

      <div className="ai-cta-row">
        <button
          className="ai-analysis-btn"
          type="button"
          onClick={handleOpenAiAnalysis}
        >
          <span className="ai-analysis-glow" aria-hidden="true" />
          <span className="ai-analysis-label">Analisis con IA</span>
          <span className="ai-analysis-sub">Interpretar documentos automaticamente</span>
        </button>
        <div className="ai-cta-message">
          <span className="ai-cta-dot" aria-hidden="true" />
          <div>
            <p className="ai-cta-kicker">Asistente IA</p>
            <p className="ai-cta-note">Klinip cuenta con un asistente de inteligencia artificial pensado para ayudarte a ahorrar tiempo y no olvidar nada importante de tus documentos medicos.</p>
          </div>
        </div>
      </div>

      {showDocForm && (
        <div className="floating-form-backdrop" onClick={() => setShowDocForm(false)}>
          <div className="floating-form-card ai-modal" onClick={(e) => e.stopPropagation()}>
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
                  <div className="ai-analyzing-card">
                    <div className="ai-analyzing-sphere" aria-hidden="true">
                      <span className="ai-sphere-glow" />
                    </div>
                    <div>
                      <p className="ai-analyzing-title">Analizando el documento</p>
                      <p className="ai-analyzing-text">Estamos extrayendo fechas, tipo y centro medico.</p>
                    </div>
                  </div>
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

      <div className="card upcoming-card">
        <div className="card-header">
          <div className="card-header-with-icon">
            <div className="card-icon upcoming-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div>
              <h2 className="card-title">Lo próximo</h2>
              <p className="muted">Máximo 5 actividades con fecha en tu agenda.</p>
            </div>
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

      <div className="card alerts-card">
        <div className="card-header">
          <div className="card-header-with-icon">
            <div className="card-icon alerts-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </div>
            <div>
              <h2 className="card-title">Recordatorios y alertas</h2>
              <p className="muted">
                Sistema de alertas automáticas según días de anticipación
              </p>
            </div>
          </div>
          <div className="alert-legend">
            <div className="alert-legend-item">
              <span className="dot red" /> <span>1 día</span>
            </div>
            <div className="alert-legend-item">
              <span className="dot yellow" /> <span>3 días</span>
            </div>
            <div className="alert-legend-item">
              <span className="dot green" /> <span>7+ días</span>
            </div>
          </div>
        </div>
        {reminders.length === 0 ? (
          <div className="alert-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
            <p>Sin recordatorios pendientes</p>
          </div>
        ) : (
          <>
            <ul className="reminder-list">
              {reminders.map((r) => (
                <li key={r.id} className={`reminder-item severity-${r.severity}`}>
                  <div className={`alert-indicator ${r.severity}`}>
                    {r.severity === "red" && (
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 8v4M12 16h.01" stroke="white" strokeWidth="2"/>
                      </svg>
                    )}
                    {r.severity === "yellow" && (
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L2 22h20L12 2z"/>
                        <path d="M12 10v4M12 18h.01" stroke="white" strokeWidth="2"/>
                      </svg>
                    )}
                    {r.severity === "green" && (
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" fill="none"/>
                      </svg>
                    )}
                  </div>
                  <div className="reminder-content">
                    <div className={`alert-badge ${r.severity}`}>
                      {r.label}
                    </div>
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
                      className="action-btn"
                      type="button"
                      onClick={() => sendEmailReminder(r)}
                      title="Enviar recordatorio por correo"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                        <polyline points="22,6 12,13 2,6"/>
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="alert-info">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <p>
                <strong>Tipos de aviso:</strong> Las alertas se activan automáticamente 
                <strong> 1 día</strong> (urgente), <strong>3 días</strong> (próximo) y 
                <strong> 7 días</strong> (planificado) antes de cada cita. 
                En PWA móvil se envían notificaciones push.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}






