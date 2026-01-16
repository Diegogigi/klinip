import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDocuments, uploadDocument, deleteDocument } from "../api";
import { getDocumentFile } from "../services/httpApi";
import { toIsoOrNull, toLocaleDateOrEmpty } from "../utils/dates";

const docLabels = {
  receta: "Receta",
  orden: "Orden",
  resultado: "Resultado",
  informe: "Informe",
  otro: "Otro",
};

const ocrLabels = {
  pending: "OCR pendiente",
  processing: "OCR en proceso",
  done: "OCR listo",
  skipped_size: "OCR omitido",
};

export default function Documents() {
  const navigate = useNavigate();
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

  const handleFormClose = () => {
    if (uploading) {
      alert("Espera a que termine la subida antes de cerrar.");
      return;
    }
    const hasChanges =
      file ||
      form.date ||
      form.center.trim() ||
      form.notes.trim() ||
      form.doc_type !== "receta";
    if (hasChanges) {
      const shouldClose = window.confirm(
        "¿Cerrar sin guardar? Se perderán los cambios."
      );
      if (!shouldClose) return;
    }
    setForm({
      doc_type: "receta",
      date: "",
      center: "",
      notes: "",
    });
    setFile(null);
    setShowForm(false);
  };

  async function load() {
    const data = await getDocuments();
    setDocs(data);
  }

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem("token");
    if (!token) {
      alert("Debes iniciar sesion para subir documentos.");
      navigate("/login");
      return;
    }
    if (!file) {
      alert("Debes seleccionar un archivo (foto o PDF)");
      return;
    }
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      alert("El archivo supera el limite de 10 MB. Reduce el tamanio e intenta de nuevo.");
      return;
    }

    setUploading(true);
    try {
      const timeoutId = setTimeout(() => {
        alert("La subida esta tardando mas de lo esperado. Mantente en esta pantalla.");
      }, 8000);
      await uploadDocument({
        doc_type: form.doc_type,
        date: toIsoOrNull(form.date),
        center: form.center,
        notes: form.notes,
        file,
      });
      clearTimeout(timeoutId);
      await load();
      handleFormClose();
    } catch (err) {
      console.error(err);
      if (err?.response?.status === 401) {
        alert("Tu sesion expiro. Inicia sesion nuevamente.");
        navigate("/login");
        return;
      }
      if (err?.response?.status === 524) {
        alert("El servidor demoro demasiado en responder. Intenta nuevamente.");
        return;
      }
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

  const handleView = async (doc) => {
    try {
      // Obtener el archivo con autenticaci?n
      const url = await getDocumentFile(doc.id);

      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      if (isMobile) {
        window.location.assign(url);
      } else {
        // Abrir en nueva pesta?a para no romper el estado de la PWA
        const newWindow = window.open(url, "_blank", "noopener");
        if (!newWindow) {
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          link.rel = "noopener";
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
      }

      // Liberar la URL temporal
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 2000);
    } catch (err) {
      console.error("Error al abrir documento:", err);
      alert("No se pudo abrir el documento. " + (err.response?.data?.detail || err.message));
    }
  };

  const handleDownload = async (doc) => {
    try {
      const url = await getDocumentFile(doc.id);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.filename || `documento-${doc.id}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 2000);
    } catch (err) {
      console.error("Error al descargar documento:", err);
      alert("No se pudo descargar el documento.");
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
          Guarda fotos o PDFs de recetas, ordenes, resultados e informes. Se almacenan seguros en el backend.
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
        <div className="floating-form-backdrop" onClick={handleFormClose}>
          <div
            className="floating-form-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header" style={{ marginBottom: "0.75rem" }}>
              <h3 className="card-title" style={{ marginBottom: 0 }}>Nuevo documento</h3>
              <button
                className="secondary-btn"
                type="button"
                onClick={handleFormClose}
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
                <span className="tiny-note">Ten en cuenta el tama?o soportado por tu navegador y conexi?n.</span>
              </div>

              <div className="floating-actions">
                <button className="primary-btn" type="submit" disabled={uploading}>
                  {uploading ? "Subiendo..." : "Guardar documento"}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={handleFormClose}
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
                  <th>OCR</th>
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
                      <span className="badge">
                        {ocrLabels[d.ocr_status] ||
                          (d.ocr_status ? "OCR con error" : "sin OCR")}
                      </span>
                    </td>
                    <td>
                      {d.date
                        ? toLocaleDateOrEmpty(d.date)
                        : toLocaleDateOrEmpty(d.created_at)}
                    </td>
                    <td>{d.center}</td>
                    <td style={{ maxWidth: "240px" }}>
                      <span style={{ fontSize: "0.85rem" }}>{d.notes}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        <button
                          onClick={() => handleView(d)}
                          className="secondary-btn"
                          style={{
                            padding: "0.25rem 0.5rem",
                            fontSize: "0.75rem",
                          }}
                        >
                          Ver
                        </button>
                        <button
                          onClick={() => handleDownload(d)}
                          className="secondary-btn"
                          style={{
                            padding: "0.25rem 0.5rem",
                            fontSize: "0.75rem",
                          }}
                        >
                          Descargar
                        </button>
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
