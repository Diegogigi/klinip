import React, { useEffect, useState } from "react";
import { deleteMedication, getMedications, saveMedication } from "../api";
import {
  requestNotificationPermission,
  scheduleMedicationNotifications,
} from "../services/notifications";

export default function Medications() {
  const [meds, setMeds] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    id: null,
    name: "",
    dose: "",
    frequency: "",
    duration: "",
    end_date: "",
    notes: "",
    document_id: "",
  });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const data = await getMedications();
    setMeds(data || []);
    scheduleMedicationNotifications(data || []);
  };

  useEffect(() => {
    load();
    requestNotificationPermission();
    return () => scheduleMedicationNotifications([]);
  }, []);

  const resetForm = () => {
    setForm({
      id: null,
      name: "",
      dose: "",
      frequency: "",
      duration: "",
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
        end_date: form.end_date ? new Date(form.end_date).toISOString() : null,
        notes: form.notes || "",
        document_id: form.document_id ? parseInt(form.document_id) : null,
      };
      
      // Si es edición, incluir el id
      if (form.id) {
        payload.id = form.id;
      }

      await saveMedication(payload);
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
      duration: med.duration,
      end_date: med.end_date ? med.end_date.slice(0, 10) : "",
      notes: med.notes || "",
      document_id: med.document_id || "",
    });
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

  return (
    <>
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
                    <td>{m.end_date ? new Date(m.end_date).toLocaleDateString() : "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
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
