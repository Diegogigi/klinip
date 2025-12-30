import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getAppointments,
  createAppointment,
  updateAppointment,
  deleteAppointment,
} from "../api";
import {
  parseDate,
  toIsoOrNull,
  toLocaleDateTimeOrEmpty,
  toLocalInputValue,
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

export default function Appointments() {
  const location = useLocation();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState({
    id: null,
    type: "cita",
    specialty: "",
    center: "",
    date_time: "",
    status: "pendiente",
    notes: "",
  });
  const [loading, setLoading] = useState(false);

  async function load() {
    const data = await getAppointments();
    setAppointments(
      data.sort((a, b) => {
        const aDate = parseDate(a.date_time);
        const bDate = parseDate(b.date_time);
        if (!aDate) return 1;
        if (!bDate) return -1;
        return aDate - bDate;
      })
    );
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!location.search) return;
    const params = new URLSearchParams(location.search);
    const id = params.get("complete");
    if (!id) return;
    const target = appointments.find((a) => String(a.id) === String(id));
    if (!target || target.status === "realizada") return;
    updateAppointment(target.id, {
      type: target.type,
      specialty: target.specialty || "",
      center: target.center || "",
      date_time: target.date_time || null,
      status: "realizada",
      notes: target.notes || "",
      checklist: target.checklist || []
    })
      .then(load)
      .finally(() => {
        navigate("/appointments", { replace: true });
      });
  }, [location.search, appointments, navigate]);

  const resetForm = () => {
    setForm({
      id: null,
      type: "cita",
      specialty: "",
      center: "",
      date_time: "",
      status: "pendiente",
      notes: "",
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        type: form.type,
        specialty: form.specialty,
        center: form.center,
        date_time: toIsoOrNull(form.date_time),
        status: form.status,
        notes: form.notes,
      };
      if (form.id) {
        await updateAppointment(form.id, payload);
      } else {
        await createAppointment(payload);
      }
      await load();
      resetForm();
      setShowForm(false);
    } catch (err) {
      console.error(err);
      alert("No se pudo guardar la cita");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (appt) => {
    setShowForm(true);
    setForm({
      id: appt.id,
      type: appt.type,
      specialty: appt.specialty || "",
      center: appt.center || "",
      date_time: appt.date_time ? toLocalInputValue(appt.date_time) : "",
      status: appt.status,
      notes: appt.notes || "",
    });
  };

  const handleDelete = async (appt) => {
    if (!window.confirm("¿Eliminar esta cita/examen?")) return;
    try {
      await deleteAppointment(appt.id);
      await load();
    } catch (err) {
      console.error(err);
      alert("No se pudo eliminar");
    }
  };

  const handleMarkCompleted = async (appt) => {
    try {
      await updateAppointment(appt.id, {
        type: appt.type,
        specialty: appt.specialty || "",
        center: appt.center || "",
        date_time: appt.date_time || null,
        status: "realizada",
        notes: appt.notes || "",
        checklist: appt.checklist || []
      });
      await load();
    } catch (err) {
      console.error(err);
      alert("No se pudo marcar como realizada");
    }
  };

  const filteredAppointments = appointments.filter((a) => {
    const matchesSearch =
      !search ||
      (a.specialty || "").toLowerCase().includes(search.toLowerCase()) ||
      (a.center || "").toLowerCase().includes(search.toLowerCase()) ||
      (a.notes || "").toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || a.type === typeFilter;
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    return matchesSearch && matchesType && matchesStatus;
  });

  return (
    <>
      <div className="card">
        <h2 className="card-title">Citas, exámenes y trámites</h2>
        <p className="muted">
          Organiza tus citas, examenes y tramites. Todo queda guardado.
        </p>
      </div>

      <div className="card">
        <button
          className="primary-btn"
          type="button"
          style={{ width: "100%" }}
          onClick={() => setShowForm(true)}
        >
          {form.id ? "Editar actividad" : "Nueva actividad"}
        </button>
      </div>

      {showForm && (
        <div className="floating-form-backdrop" onClick={() => setShowForm(false)}>
          <div
            className="floating-form-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header" style={{ marginBottom: "0.75rem" }}>
              <h3 className="card-title" style={{ marginBottom: 0 }}>
                {form.id ? "Editar actividad" : "Nueva actividad"}
              </h3>
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setShowForm(false)}
              >
                Cerrar
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="input-group">
                  <label className="input-label">Tipo</label>
                  <select
                    className="select-field"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                    <option value="cita">Cita médica</option>
                    <option value="examen">Examen</option>
                    <option value="tramite">Trámite</option>
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Especialidad</label>
                  <input
                    className="input-field"
                    value={form.specialty}
                    onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                    placeholder="Medicina general, odontología, oftalmología..."
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="input-group">
                  <label className="input-label">Centro de salud</label>
                  <input
                    className="input-field"
                    value={form.center}
                    onChange={(e) => setForm({ ...form, center: e.target.value })}
                    placeholder="CESFAM, hospital, clínica..."
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Fecha y hora</label>
                  <input
                    className="input-field"
                    type="datetime-local"
                    value={form.date_time}
                    onChange={(e) => setForm({ ...form, date_time: e.target.value })}
                  />
                  <span className="tiny-note">
                    Puedes dejarlo vacío si aún no tienes la hora exacta.
                  </span>
                </div>
              </div>

          <div className="form-row">
            <div className="input-group">
              <label className="input-label">Estado</label>
              <select
                className="select-field"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="pendiente">Pendiente</option>
                <option value="agendada">Agendada</option>
                <option value="realizada">Realizada</option>
              </select>
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Notas</label>
            <textarea
              className="textarea-field"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Ej: Traer exámenes, venir en ayunas, pedir interconsulta, etc."
            />
          </div>
              <div className="floating-actions">
                <button className="primary-btn" type="submit" disabled={loading}>
                  {loading ? "Guardando..." : form.id ? "Actualizar" : "Agregar"}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="card-title">Listado de actividades</h3>
        <div className="form-row" style={{ marginBottom: "0.75rem" }}>
          <div className="input-group">
            <label className="input-label">Búsqueda</label>
            <input
              className="input-field"
              placeholder="Especialidad, centro o notas"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label className="input-label">Tipo</label>
            <select
              className="select-field"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="cita">Cita</option>
              <option value="examen">Examen</option>
              <option value="tramite">Trámite</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Estado</label>
            <select
              className="select-field"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="agendada">Agendada</option>
              <option value="realizada">Realizada</option>
            </select>
          </div>
        </div>
        {appointments.length === 0 ? (
          <p className="muted">Aún no has registrado actividades.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Especialidad</th>
                  <th>Centro</th>
                  <th>Fecha y hora</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredAppointments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className={`chip ${a.type}`}>
                        {typeLabels[a.type] || a.type}
                      </span>
                    </td>
                    <td>{a.specialty}</td>
                    <td>{a.center}</td>
                    <td>
                      {a.date_time
                        ? toLocaleDateTimeOrEmpty(a.date_time) || "Por agendar"
                        : "Por agendar"}
                    </td>
                    <td>
                      <span className={`chip-status-${a.status}`}>
                        {statusLabels[a.status] || a.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.3rem" }}>
                        {a.status !== "realizada" && (
                          <button
                            className="secondary-btn"
                            style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                            onClick={() => handleMarkCompleted(a)}
                          >
                            Marcar realizada
                          </button>
                        )}
                        <button
                          className="secondary-btn"
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                          onClick={() => handleEdit(a)}
                        >
                          Editar
                        </button>
                        <button
                          className="secondary-btn"
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                          onClick={() => handleDelete(a)}
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
