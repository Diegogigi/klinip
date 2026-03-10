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
import RowActionsMenu from "../components/RowActionsMenu";

const MED_ALERT_POLL_MS = 15000;

function parseScheduleTimeValue(value) {
  if (!value || typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildDosePromptKey(med, date) {
  const day = date.toISOString().slice(0, 10);
  const slot = med.schedule_time || "manual";
  return `klinip_med_prompt_${med.id}_${day}_${slot}`;
}

function isMedicationActiveToday(med, now) {
  if (med?.completed) return false;
  if (!med?.end_date) return true;
  const end = new Date(med.end_date);
  if (Number.isNaN(end.getTime())) return true;
  end.setHours(23, 59, 59, 999);
  return now.getTime() <= end.getTime();
}

function formatAlertDay(date) {
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(date);
}

export default function Medications() {
  const location = useLocation();
  const navigate = useNavigate();
  const [meds, setMeds] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notifyQueue, setNotifyQueue] = useState([]);
  const [notifyPromptKey, setNotifyPromptKey] = useState("");
  const [notifyTriggeredAt, setNotifyTriggeredAt] = useState(null);
  const [notifyActionLoading, setNotifyActionLoading] = useState(false);
  const [missingFrequency, setMissingFrequency] = useState(null);
  const [intakeFeedback, setIntakeFeedback] = useState("");
  const feedbackTimer = useRef(null);
  const doseCheckRef = useRef(Date.now() - MED_ALERT_POLL_MS);
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
    scheduleMedicationNotifications(data || []);
  };

  useEffect(() => {
    load();
    requestNotificationPermission();
    return () => scheduleMedicationNotifications([]);
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
    const now = new Date();
    const key = buildDosePromptKey(target, now);
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, "prompted");
    }
    setNotifyQueue((prev) => {
      if (prev.some((item) => item.key === key)) return prev;
      return [...prev, { med: target, key, triggeredAt: now }];
    });
    navigate("/medications", { replace: true });
  }, [location.search, meds, navigate]);

  useEffect(() => {
    const checkDueMedicationPrompt = () => {
      const now = new Date();
      const lastCheckedAt = doseCheckRef.current;
      const nowTs = now.getTime();

      const dueMeds = (meds || []).filter((med) => {
        if (!med?.schedule_time) return false;
        if (!isMedicationActiveToday(med, now)) return false;
        const slot = parseScheduleTimeValue(med.schedule_time);
        if (!slot) return false;
        const trigger = new Date(now);
        trigger.setHours(slot.hour, slot.minute, 0, 0);
        const triggerTs = trigger.getTime();
        if (triggerTs <= lastCheckedAt || triggerTs > nowTs) return false;
        const key = buildDosePromptKey(med, now);
        return !localStorage.getItem(key);
      });

      if (!dueMeds.length) {
        doseCheckRef.current = nowTs;
        return;
      }

      dueMeds.forEach((med) => {
        const key = buildDosePromptKey(med, now);
        localStorage.setItem(key, "prompted");
        setNotifyQueue((prev) => {
          if (prev.some((item) => item.key === key)) return prev;
          return [...prev, { med, key, triggeredAt: now }];
        });
      });
      doseCheckRef.current = nowTs;
    };

    checkDueMedicationPrompt();
    const intervalId = setInterval(checkDueMedicationPrompt, MED_ALERT_POLL_MS);
    return () => clearInterval(intervalId);
  }, [meds]);

  useEffect(() => {
    if (notifyOpen || notifyTarget || notifyQueue.length === 0) return;
    const [nextPrompt, ...rest] = notifyQueue;
    setNotifyQueue(rest);
    setNotifyPromptKey(nextPrompt.key);
    setNotifyTriggeredAt(nextPrompt.triggeredAt);
    setNotifyTarget(nextPrompt.med);
    setNotifyOpen(true);
  }, [notifyOpen, notifyQueue, notifyTarget]);

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

  const handleOpenDetail = (med) => {
    setDetailTarget(med);
    setDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setDetailTarget(null);
  };

  const closeNotifyModal = () => {
    if (notifyActionLoading) return;
    if (notifyPromptKey) {
      localStorage.setItem(notifyPromptKey, "skipped");
    }
    notifyQueue.forEach((item) => {
      if (item.key) {
        localStorage.setItem(item.key, "skipped");
      }
    });
    setNotifyQueue([]);
    setNotifyOpen(false);
    setNotifyTarget(null);
    setNotifyPromptKey("");
    setNotifyTriggeredAt(null);
    navigate("/medications", { replace: true });
  };

  const handleTakenFromAlert = async () => {
    if (!notifyTarget) return;
    setNotifyActionLoading(true);
    try {
      await recordMedicationIntake(notifyTarget.id);
      if (notifyPromptKey) {
        localStorage.setItem(notifyPromptKey, "taken");
      }
      await load();
      setIntakeFeedback(`success:Toma registrada: ${notifyTarget.name}`);
      if (feedbackTimer.current) {
        clearTimeout(feedbackTimer.current);
      }
      feedbackTimer.current = setTimeout(() => {
        setIntakeFeedback("");
      }, 2600);
      setNotifyOpen(false);
      setNotifyTarget(null);
      setNotifyPromptKey("");
      setNotifyTriggeredAt(null);
      navigate("/medications", { replace: true });
    } catch (err) {
      console.error(err);
      alert("No se pudo registrar la toma.");
    } finally {
      setNotifyActionLoading(false);
    }
  };

  const handleTakenAllFromAlert = async () => {
    if (!notifyTarget) return;
    const batch = [
      { med: notifyTarget, key: notifyPromptKey },
      ...notifyQueue.map((item) => ({ med: item.med, key: item.key })),
    ];
    setNotifyActionLoading(true);
    try {
      for (const item of batch) {
        await recordMedicationIntake(item.med.id);
        if (item.key) {
          localStorage.setItem(item.key, "taken");
        }
      }
      await load();
      setNotifyQueue([]);
      setIntakeFeedback(
        `success:Tomas registradas: ${batch.length}`
      );
      if (feedbackTimer.current) {
        clearTimeout(feedbackTimer.current);
      }
      feedbackTimer.current = setTimeout(() => {
        setIntakeFeedback("");
      }, 2600);
      setNotifyOpen(false);
      setNotifyTarget(null);
      setNotifyPromptKey("");
      setNotifyTriggeredAt(null);
      navigate("/medications", { replace: true });
    } catch (err) {
      console.error(err);
      alert("No se pudieron registrar todas las tomas.");
    } finally {
      setNotifyActionLoading(false);
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
  const adherenceTotals = (meds || []).reduce(
    (acc, med) => {
      acc.expected += Number(med.expected_doses || 0);
      acc.taken += Number(med.taken_doses || 0);
      return acc;
    },
    { expected: 0, taken: 0 }
  );
  const globalAdherence =
    adherenceTotals.expected > 0
      ? Math.round((adherenceTotals.taken / adherenceTotals.expected) * 100)
      : null;
  const filteredMeds = (meds || []).filter((med) => {
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      (med.name || "").toLowerCase().includes(term) ||
      (med.dose || "").toLowerCase().includes(term) ||
      (med.frequency || "").toLowerCase().includes(term) ||
      (med.notes || "").toLowerCase().includes(term);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && !med.completed) ||
      (statusFilter === "completed" && Boolean(med.completed)) ||
      (statusFilter === "scheduled" && Boolean(med.schedule_time));
    return matchesSearch && matchesStatus;
  });

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
        <div className="med-dose-alert-backdrop" onClick={closeNotifyModal}>
          <div
            className="med-dose-alert"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="med-dose-alert-close"
              onClick={closeNotifyModal}
              aria-label="Cerrar alerta"
            >
              ×
            </button>
            <p className="med-dose-alert-day">
              {formatAlertDay(notifyTriggeredAt || new Date())}
            </p>
            <div className="med-dose-alert-icon" aria-hidden="true">
              💊
            </div>
            <h3 className="med-dose-alert-title">
              Medicamento de las{" "}
              {notifyTarget.schedule_time || new Date().toTimeString().slice(0, 5)}
            </h3>
            {notifyQueue.length > 0 && (
              <button
                type="button"
                className="med-dose-batch-btn"
                onClick={handleTakenAllFromAlert}
                disabled={notifyActionLoading}
              >
                {notifyActionLoading
                  ? "Registrando..."
                  : `Registrar todos como tomados (${notifyQueue.length + 1})`}
              </button>
            )}
            <div className="med-dose-alert-card">
              <p className="med-dose-alert-name">{notifyTarget.name}</p>
              <p className="med-dose-alert-meta">
                {notifyTarget.dose || "Sin dosis definida"}
              </p>
              {notifyTarget.notes && (
                <p className="med-dose-alert-notes">{notifyTarget.notes}</p>
              )}
              <div className="med-dose-alert-actions">
                <button
                  className="med-dose-btn is-primary"
                  type="button"
                  onClick={handleTakenFromAlert}
                  disabled={notifyActionLoading}
                >
                  {notifyActionLoading ? "Registrando..." : "Tomado"}
                </button>
              </div>
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

      {detailOpen && detailTarget && (
        <div className="modal-backdrop" onClick={handleCloseDetail}>
          <div className="modal-card detail-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="detail-modal-header">
              <h3>Detalle del medicamento</h3>
              <button className="detail-close-btn" type="button" onClick={handleCloseDetail} aria-label="Cerrar">
                ×
              </button>
            </div>
            <div className="detail-modal-content">
              <div className="detail-highlight">
                <span className="detail-chip detail-chip-type medicamento">
                  {detailTarget.name || "Medicamento"}
                </span>
                <span className={`detail-chip detail-chip-status ${detailTarget.completed ? "realizada" : "pendiente"}`}>
                  {detailTarget.completed ? "Realizado" : "Activo"}
                </span>
              </div>
              <div className="detail-grid">
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>💊</span>
                  <div>
                    <span className="detail-label">Dosis</span>
                    <p>{detailTarget.dose || "Sin dosis"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>⏱️</span>
                  <div>
                    <span className="detail-label">Frecuencia</span>
                    <p>{detailTarget.frequency || "Sin frecuencia"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>🕒</span>
                  <div>
                    <span className="detail-label">Horario</span>
                    <p>{detailTarget.schedule_time || "Sin horario"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>📆</span>
                  <div>
                    <span className="detail-label">Duración</span>
                    <p>{detailTarget.duration || "Sin duración"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>🏁</span>
                  <div>
                    <span className="detail-label">Fecha término</span>
                    <p>{detailTarget.end_date ? toLocaleDateOrEmpty(detailTarget.end_date) : "Sin término"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>📝</span>
                  <div>
                    <span className="detail-label">Notas</span>
                    <p>{detailTarget.notes || "Sin notas"}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => {
                  handleEdit(detailTarget);
                  handleCloseDetail();
                }}
              >
                Editar
              </button>
              {!detailTarget.completed && (
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => {
                    handleRecordIntake(detailTarget).finally(handleCloseDetail);
                  }}
                >
                  Marcar toma
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card medications-filters-card">
        <h3 className="card-title">Filtros</h3>
        <div className="form-row medications-filters-row" style={{ marginBottom: "0.35rem" }}>
          <div className="input-group">
            <label className="input-label">Búsqueda</label>
            <input
              className="input-field medications-filter-field"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, dosis o notas"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Estado</label>
            <select
              className="select-field medications-filter-field"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="completed">Realizados</option>
              <option value="scheduled">Con horario</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card medications-list-card">
        <h3 className="card-title">Tratamientos activos</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Adherencia global:{" "}
          <strong>
            {globalAdherence === null ? "Sin datos suficientes" : `${globalAdherence}%`}
          </strong>{" "}
          ({adherenceTotals.taken}/{adherenceTotals.expected} tomas)
        </p>
        {meds.length === 0 ? (
          <p className="muted">Aún no has registrado medicamentos.</p>
        ) : filteredMeds.length === 0 ? (
          <p className="muted">No hay medicamentos que coincidan con los filtros.</p>
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
                  <th>Tomas</th>
                  <th>Adherencia</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredMeds.map((m) => (
                  <tr
                    key={m.id}
                    className="table-row-clickable"
                    onClick={() => handleOpenDetail(m)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleOpenDetail(m);
                      }
                    }}
                  >
                    <td>{m.name}</td>
                    <td>{m.dose}</td>
                    <td>{m.frequency}</td>
                    <td>{m.duration}</td>
                    <td>{m.schedule_time || "-"}</td>
                    <td>{m.completed ? "Realizado" : "Activo"}</td>
                    <td>{m.end_date ? toLocaleDateOrEmpty(m.end_date) : "—"}</td>
                    <td>
                      {(m.taken_doses || 0)}/{(m.expected_doses || 0)}
                    </td>
                    <td>
                      {(() => {
                        const taken = Number(m.taken_doses || 0);
                        const expected = Number(m.expected_doses || 0);
                        const apiRate = Number(m.adherence_rate);
                        if (Number.isFinite(apiRate)) {
                          return `${Math.max(0, Math.min(100, Math.round(apiRate)))}%`;
                        }
                        if (expected > 0) {
                          return `${Math.round((taken / expected) * 100)}%`;
                        }
                        return "0%";
                      })()}
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <RowActionsMenu
                        items={[
                          {
                            key: "edit",
                            label: "Editar",
                            onClick: () => handleEdit(m),
                          },
                          {
                            key: "delete",
                            label: "Eliminar",
                            danger: true,
                            onClick: () => handleDelete(m),
                          },
                        ]}
                      />
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

