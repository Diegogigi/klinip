import React, { useEffect, useState } from "react";
import {
  getAppointments,
  createAppointment,
  updateAppointment,
  deleteAppointment,
} from "../api";

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
    checklist: [],
  });
  const [loading, setLoading] = useState(false);

  async function load() {
    const data = await getAppointments();
    setAppointments(
      data.sort((a, b) => {
        if (!a.date_time) return 1;
        if (!b.date_time) return -1;
        return new Date(a.date_time) - new Date(b.date_time);
      })
    );
  }

  useEffect(() => {
    load();
  }, []);

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
        date_time: form.date_time ? new Date(form.date_time).toISOString() : null,
        status: form.status,
        notes: form.notes,
        checklist: form.checklist || [],
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
      date_time: appt.date_time
        ? new Date(appt.date_time).toISOString().slice(0, 16)
        : "",
      status: appt.status,
      notes: appt.notes || "",
      checklist: appt.checklist || [],
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

  const toggleChecklistItem = (idx) => {
    const items = form.checklist || [];
    const updated = items.map((item, i) =>
      i === idx ? { ...item, done: !item.done } : item
    );
    setForm({ ...form, checklist: updated });
  };

 const addChecklistItem = () => {
    const items = form.checklist || [];
    setForm({
      ...form,
      checklist: [...items, { text: "Nuevo trámite", done: false }],
    });
  };

  const updateChecklistText = (idx, text) => {
    const items = form.checklist || [];
    const updated = items.map((item, i) => (i === idx ? { ...item, text } : item));
    setForm({ ...form, checklist: updated });
  };

  const checklistTemplate = [
    "Pedir hora SOME",
    "Retirar medicamentos",
    "Llevar documentos",
    "Llevar exámenes",
    "Ayuno previo",
  ];

  return (
    <>
      <div className="card">
        <h2 className="card-title">Citas, exámenes y trámites</h2>
        <p className="muted">
          Registra todo lo que tienes que hacer en salud. En modo demo guardamos la información en
          este navegador para que pruebes sin backend.
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

          <div className="input-group">
            <label className="input-label">Checklist de trámites</label>
            <div className="checklist">
              {(form.checklist || []).map((item, idx) => (
                <label key={idx} className="checklist-item">
                  <input
                    type="checkbox"
                    checked={!!item.done}
                    onChange={() => toggleChecklistItem(idx)}
                  />
                  <input
                    className="checklist-text"
                    value={item.text}
                    onChange={(e) => updateChecklistText(idx, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="secondary-btn" onClick={addChecklistItem}>
                + Ítem
              </button>
              {checklistTemplate.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="secondary-btn"
                  onClick={() =>
                    setForm({
                      ...form,
                      checklist: [...(form.checklist || []), { text: t, done: false }],
                    })
                  }
                >
                  {t}
                </button>
              ))}
            </div>
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
                        ? new Date(a.date_time).toLocaleString()
                        : "Por agendar"}
                    </td>
                    <td>
                      <span className={`chip-status-${a.status}`}>
                        {statusLabels[a.status] || a.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.3rem" }}>
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
