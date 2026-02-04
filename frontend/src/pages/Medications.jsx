import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  deleteMedication,
  getMedications,
  recordMedicationIntake,
  saveMedication,
} from "../api";
import {
  requestNotificationPermission,
  scheduleMedicationNotifications,
} from "../services/notifications";
import { toIsoOrNull, toLocaleDateOrEmpty } from "../utils/dates";

export default function Medications() {
  const location = useLocation();
  const navigate = useNavigate();
  const [meds, setMeds] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState(null);
  const [missingFrequency, setMissingFrequency] = useState(null);
  const [intakeFeedback, setIntakeFeedback] = useState("");
  const feedbackTimer = useRef(null);
  const [form, setForm] = useState({
    id: null,
    name: "",
    dose: "",
    frequency: "",
    frequency_initial: "",
    duration: "",
    schedule_time: "",
    completed: false,
    end_date: "",
    notes: "",
    document_id: "",
  });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const data = await getMedications();
    setMeds(data || []);
    const missing = (data || []).find(
      (m) => !m.frequency || m.frequency.trim() === ""
    );
    if (missing) {
      const dismissedKey = `klinip_missing_freq_dismissed_${missing.id}`;
      const dismissed = localStorage.getItem(dismissedKey) === "1";
      setMissingFrequency(dismissed ? null : missing);
    } else {
      setMissingFrequency(null);
    }
    // DESACTIVADO: Las notificaciones ahora se envían desde el servidor vía push
    // scheduleMedicationNotifications(data || []);
  };

  useEffect(() => {
    load();
    requestNotificationPermission();
    // DESACTIVADO: No programar notificaciones locales para evitar duplicados
    // return () => scheduleMedicationNotifications([]);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) {
        clearTimeout(feedbackTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!location.search) return;
    const params = new URLSearchParams(location.search);
    const intakeId = params.get("intake") || params.get("complete");
    if (!intakeId) return;
    const target = meds.find((m) => String(m.id) === String(intakeId));
    if (!target) return;
    handleRecordIntake(target).finally(() => {
      navigate("/medications", { replace: true });
    });
  }, [location.search, meds, navigate]);

  useEffect(() => {
    if (!location.search) return;
    const params = new URLSearchParams(location.search);
    const notify = params.get("notify") === "1";
    const notifyId = params.get("medicationId");
    if (!notify || !notifyId) return;
    const target = meds.find((m) => String(m.id) === String(notifyId));
    if (!target) return;
    setNotifyTarget(target);
    setNotifyOpen(true);
  }, [location.search, meds]);

  const resetForm = () => {
      setForm({
        id: null,
        name: "",
        dose: "",
        frequency: "",
        frequency_initial: "",
        duration: "",
        schedule_time: "",
        completed: false,
        end_date: "",
        notes: "",
        document_id: "",
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Preparar datos: convertir strings vacíos a null y document_id a número o null
      const payload = {
        name: form.name,
        dose: form.dose || "",
        frequency: form.frequency || "",
        duration: form.duration || "",
        schedule_time: form.schedule_time || "",
        completed: Boolean(form.completed),
        end_date: toIsoOrNull(form.end_date),
        notes: form.notes || "",
        document_id: form.document_id ? parseInt(form.document_id) : null,
      };
      
      // Si es edición, incluir el id
      if (form.id) {
        payload.id = form.id;
      }

      await saveMedication(payload);
      if (payload.id && payload.frequency) {
        localStorage.removeItem(
          `klinip_missing_freq_dismissed_${payload.id}`
        );
      }
      if (payload.frequency && !form.frequency_initial) {
        setIntakeFeedback("success:Frecuencia guardada. Recordatorios activados.");
        if (feedbackTimer.current) {
          clearTimeout(feedbackTimer.current);
        }
        feedbackTimer.current = setTimeout(() => {
          setIntakeFeedback("");
        }, 2600);
      }
      await load();
      resetForm();
      setShowForm(false);
    } catch (err) {
      console.error("Error al guardar medicamento:", err);
      console.error("Detalles del error:", err.response?.data);
      alert("No se pudo guardar el medicamento: " + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (med) => {
    setShowForm(true);
    setForm({
      id: med.id,
      name: med.name,
      dose: med.dose,
      frequency: med.frequency,
      frequency_initial: med.frequency || "",
      duration: med.duration,
      schedule_time: med.schedule_time || "",
      completed: Boolean(med.completed),
      end_date: med.end_date ? med.end_date.slice(0, 10) : "",
      notes: med.notes || "",
      document_id: med.document_id || "",
    });
  };

  const handleRecordIntake = async (med) => {
    try {
      await recordMedicationIntake(med.id);
      await load();
      setIntakeFeedback(`info:Toma registrada: ${med.name}`);
      if (feedbackTimer.current) {
        clearTimeout(feedbackTimer.current);
      }
      feedbackTimer.current = setTimeout(() => {
        setIntakeFeedback("");
      }, 2600);
    } catch (err) {
      console.error(err);
      alert("No se pudo marcar como realizado");
    }
  };

  const handleDelete = async (med) => {
    if (!window.confirm("¿Eliminar este medicamento?")) return;
    try {
      await deleteMedication(med.id);
      await load();
    } catch (err) {
      console.error(err);
      alert("No se pudo eliminar");
    }
  };

  const medsMissingFrequency = (meds || []).filter(
    (m) => !m.frequency || m.frequency.trim() === ""
  );

  return (
    <>
      {intakeFeedback && (
        <div
          className={`med-intake-toast ${
            intakeFeedback.startsWith("success:")
              ? "is-success"
              : "is-info"
          }`}
          role="status"
        >
          {intakeFeedback.replace(/^(success:|info:)/, "")}
        </div>
      )}
      <div className="card">
        <h2 className="card-title">Medicamentos y tratamientos</h2>
        <p className="muted">
          Registra fármacos, dosis y frecuencia. Añade duración y notas para no perder la trazabilidad.
        </p>
      </div>

      <div className="card">
        <button
          className="primary-btn"
          type="button"
          style={{ width: "100%" }}
          onClick={() => setShowForm(true)}
        >
          Agregar medicamento
        </button>
      </div>

      {medsMissingFrequency.length > 0 && (
        <div className="card">
          <h3 className="card-title">Faltan indicaciones</h3>
          <p className="muted">
            {medsMissingFrequency.length} medicamento(s) no tienen frecuencia.
            Completa la indicacion para activar recordatorios.
          </p>
          <button
            className="primary-btn"
            type="button"
            onClick={() => handleEdit(medsMissingFrequency[0])}
          >
            Completar ahora
          </button>
        </div>
      )}

      {notifyOpen && notifyTarget && (
        <div className="modal-backdrop" onClick={() => {
          setNotifyOpen(false);
          setNotifyTarget(null);
          navigate("/medications", { replace: true });
        }}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Medicamento desde notificacion</h3>
            <p className="muted">
              {notifyTarget.name}
              {notifyTarget.dose ? ` · ${notifyTarget.dose}` : ""}
              {notifyTarget.schedule_time ? ` · ${notifyTarget.schedule_time}` : ""}
              {notifyTarget.end_date ? ` · ${toLocaleDateOrEmpty(notifyTarget.end_date)}` : ""}
            </p>
            <div className="modal-actions">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => {
                  handleEdit(notifyTarget);
                  setNotifyOpen(false);
                  setNotifyTarget(null);
                  navigate("/medications", { replace: true });
                }}
              >
                Ver detalle
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => {
                  handleRecordIntake(notifyTarget).finally(() => {
                    setNotifyOpen(false);
                    setNotifyTarget(null);
                    navigate("/medications", { replace: true });
                  });
                }}
              >
                Marcar realizado
              </button>
            </div>
          </div>
        </div>
      )}

      {missingFrequency && !showForm && (
        <div
          className="modal-backdrop"
          onClick={() => setMissingFrequency(null)}
        >
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Falta frecuencia</h3>
            <p className="muted">
              Se detecto el medicamento <strong>{missingFrequency.name}</strong>
              {missingFrequency.dose ? ` (${missingFrequency.dose})` : ""} pero no
              se pudo leer la frecuencia. Indicala para activar recordatorios.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => {
                  localStorage.setItem(
                    `klinip_missing_freq_dismissed_${missingFrequency.id}`,
                    "1"
                  );
                  setMissingFrequency(null);
                }}
              >
                Luego
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => {
                  handleEdit(missingFrequency);
                  setMissingFrequency(null);
                }}
              >
                Completar ahora
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="floating-form-backdrop" onClick={() => setShowForm(false)}>
          <div className="floating-form-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-header" style={{ marginBottom: "0.5rem" }}>
              <h3 className="card-title" style={{ margin: 0 }}>
                {form.id ? "Editar medicamento" : "Nuevo medicamento"}
              </h3>
              <button className="secondary-btn" type="button" onClick={() => setShowForm(false)}>
                Cerrar
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="input-group">
                  <label className="input-label">Nombre</label>
                  <input
                    className="input-field"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    placeholder="Ej: Paracetamol"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Dosis</label>
                  <input
                    className="input-field"
                    value={form.dose}
                    onChange={(e) => setForm({ ...form, dose: e.target.value })}
                    placeholder="500 mg"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="input-group">
                  <label className="input-label">Frecuencia</label>
                  <input
                    className="input-field"
                    value={form.frequency}
                    onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                    placeholder="Cada 8 horas"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Duración</label>
                  <input
                    className="input-field"
                    value={form.duration}
                    onChange={(e) => setForm({ ...form, duration: e.target.value })}
                    placeholder="Por 5 días"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="input-group">
                  <label className="input-label">Fecha término</label>
                  <input
                    className="input-field"
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Horario</label>
                  <input
                    className="input-field"
                    type="time"
                    value={form.schedule_time}
                    onChange={(e) => setForm({ ...form, schedule_time: e.target.value })}
                  />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Notas</label>
                <textarea
                  className="textarea-field"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Instrucciones especiales, efectos, etc."
                />
              </div>

              <div className="floating-actions">
                <button className="primary-btn" type="submit" disabled={loading}>
                  {loading ? "Guardando..." : form.id ? "Actualizar" : "Agregar"}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowForm(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="card-title">Tratamientos activos</h3>
        {meds.length === 0 ? (
          <p className="muted">Aún no has registrado medicamentos.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Dosis</th>
                  <th>Frecuencia</th>
                  <th>Duración</th>
                  <th>Horario</th>
                  <th>Estado</th>
                  <th>Término</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {meds.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.dose}</td>
                    <td>{m.frequency}</td>
                    <td>{m.duration}</td>
                    <td>{m.schedule_time || "-"}</td>
                    <td>{m.completed ? "Realizado" : "Activo"}</td>
                    <td>{m.end_date ? toLocaleDateOrEmpty(m.end_date) : "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        <button
                          className="secondary-btn"
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                          onClick={() => handleRecordIntake(m)}
                        >
                          Marcar realizado
                        </button>
                        <button
                          className="secondary-btn"
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                          onClick={() => handleEdit(m)}
                        >
                          Editar
                        </button>
                        <button
                          className="secondary-btn"
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                          onClick={() => handleDelete(m)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
