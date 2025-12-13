import React, { useEffect, useState } from "react";
import { getDocuments, uploadDocument, deleteDocument } from "../api";

const docLabels = {
  receta: "Receta",
  orden: "Orden",
  resultado: "Resultado",
  informe: "Informe",
  otro: "Otro",
};

export default function Documents() {
  const [docs, setDocs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [form, setForm] = useState({
    doc_type: "receta",
    date: "",
    center: "",
    notes: "",
  });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  async function load() {
    const data = await getDocuments();
    setDocs(data);
  }

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      alert("Debes seleccionar un archivo (foto o PDF)");
      return;
    }

    setUploading(true);
    try {
      await uploadDocument({
        doc_type: form.doc_type,
        date: form.date ? new Date(form.date).toISOString() : null,
        center: form.center,
        notes: form.notes,
        file,
      });
      await load();
      setForm({
        doc_type: "receta",
        date: "",
        center: "",
        notes: "",
      });
      setFile(null);
      setShowForm(false);
    } catch (err) {
      console.error(err);
      alert("No se pudo subir el documento");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc) => {
    if (!window.confirm("¿Eliminar este documento?")) return;
    try {
      await deleteDocument(doc.id);
      await load();
    } catch (err) {
      console.error(err);
      alert("No se pudo eliminar");
    }
  };

  const filteredDocs = docs.filter((d) => {
    const matchesSearch =
      !search ||
      (d.center || "").toLowerCase().includes(search.toLowerCase()) ||
      (d.notes || "").toLowerCase().includes(search.toLowerCase()) ||
      (d.filename || "").toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || d.doc_type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <>
      <div className="card">
        <h2 className="card-title">Documentos de salud</h2>
        <p className="muted">
          Guarda fotos o PDFs de recetas, órdenes, resultados e informes. Para el demo, los
          archivos se convierten a dataURL y viven en este navegador (tamaño limitado).
        </p>
      </div>

      <div className="card">
        <button
          className="primary-btn"
          type="button"
          style={{ width: "100%" }}
          onClick={() => setShowForm(true)}
        >
          Agregar documento
        </button>
      </div>

      {showForm && (
        <div className="floating-form-backdrop" onClick={() => setShowForm(false)}>
          <div
            className="floating-form-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header" style={{ marginBottom: "0.75rem" }}>
              <h3 className="card-title" style={{ marginBottom: 0 }}>Nuevo documento</h3>
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
                  <label className="input-label">Tipo de documento</label>
                  <select
                    className="select-field"
                    value={form.doc_type}
                    onChange={(e) => setForm({ ...form, doc_type: e.target.value })}
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
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
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
                    placeholder="CESFAM, hospital, laboratorio..."
                  />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Notas</label>
                <textarea
                  className="textarea-field"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Ej: Receta vence en 3 meses, control con médico X, etc."
                />
              </div>

              <div className="input-group">
                <label className="input-label">Archivo (foto o PDF)</label>
                <input
                  className="input-field"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFile(e.target.files[0] || null)}
                />
                <span className="tiny-note">Advertencia: archivos muy pesados pueden no caber en el demo.</span>
              </div>

              <div className="floating-actions">
                <button className="primary-btn" type="submit" disabled={uploading}>
                  {uploading ? "Subiendo..." : "Guardar documento"}
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
        <h3 className="card-title">Documentos guardados</h3>
        <div className="form-row" style={{ marginBottom: "0.75rem" }}>
          <div className="input-group">
            <label className="input-label">Búsqueda</label>
            <input
              className="input-field"
              placeholder="Centro, notas o nombre de archivo"
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
              <option value="receta">Receta</option>
              <option value="orden">Orden</option>
              <option value="resultado">Resultado</option>
              <option value="informe">Informe</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        </div>
        {docs.length === 0 ? (
          <p className="muted">Aún no has guardado documentos.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Fecha</th>
                  <th>Centro</th>
                  <th>Notas</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className="badge">
                        {docLabels[d.doc_type] || d.doc_type}
                      </span>
                    </td>
                    <td>
                      {d.date
                        ? new Date(d.date).toLocaleDateString()
                        : new Date(d.created_at).toLocaleDateString()}
                    </td>
                    <td>{d.center}</td>
                    <td style={{ maxWidth: "240px" }}>
                      <span style={{ fontSize: "0.85rem" }}>{d.notes}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        <a
                          href={d.data_url || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="secondary-btn"
                          style={{
                            padding: "0.25rem 0.5rem",
                            fontSize: "0.75rem",
                            textDecoration: "none",
                          }}
                        >
                          Ver
                        </a>
                        <button
                          className="secondary-btn"
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                          onClick={() => handleDelete(d)}
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
