import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDocuments, uploadDocument, deleteDocument } from "../api";
import { getDocumentFile } from "../services/httpApi";
import { toIsoOrNull, toLocaleDateOrEmpty } from "../utils/dates";
import RowActionsMenu from "../components/RowActionsMenu";

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
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [form, setForm] = useState({
    doc_type: "receta",
    date: "",
    center: "",
    notes: "",
    send_email_backup: false,
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
      form.send_email_backup ||
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
      send_email_backup: false,
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
        send_email_backup: form.send_email_backup,
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

  const handleOpenDetail = (doc) => {
    setDetailTarget(doc);
    setDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setDetailTarget(null);
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
      <div className="card documents-surface-free documents-intro">
        <h2 className="card-title">Documentos de salud</h2>
        <p className="muted">
          Guarda fotos o PDFs de recetas, ordenes, resultados e informes. Se almacenan seguros en el backend.
        </p>
      </div>

      <div className="card documents-surface-free documents-create">
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

              <label className="auth-consent-label" style={{ marginBottom: "0.75rem" }}>
                <input
                  type="checkbox"
                  checked={form.send_email_backup}
                  onChange={(e) =>
                    setForm({ ...form, send_email_backup: e.target.checked })
                  }
                />
                <span>
                  Enviarme una copia de respaldo por correo (documento adjunto)
                </span>
              </label>

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

      {detailOpen && detailTarget && (
        <div className="modal-backdrop" onClick={handleCloseDetail}>
          <div className="modal-card detail-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="detail-modal-header">
              <h3>Detalle del documento</h3>
              <button className="detail-close-btn" type="button" onClick={handleCloseDetail} aria-label="Cerrar">
                ×
              </button>
            </div>
            <div className="detail-modal-content">
              <div className="detail-highlight">
                <span className="detail-chip detail-chip-type resultado">
                  {docLabels[detailTarget.doc_type] || detailTarget.doc_type}
                </span>
                <span className="detail-chip detail-chip-muted">
                  {ocrLabels[detailTarget.ocr_status] ||
                    (detailTarget.ocr_status ? "OCR con error" : "Sin OCR")}
                </span>
              </div>
              <div className="detail-grid">
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>📄</span>
                  <div>
                    <span className="detail-label">Nombre archivo</span>
                    <p>{detailTarget.filename || `documento-${detailTarget.id}`}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>🏥</span>
                  <div>
                    <span className="detail-label">Centro médico</span>
                    <p>{detailTarget.center || "Sin centro"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>🗓️</span>
                  <div>
                    <span className="detail-label">Fecha documento</span>
                    <p>
                      {detailTarget.date
                        ? toLocaleDateOrEmpty(detailTarget.date)
                        : toLocaleDateOrEmpty(detailTarget.created_at)}
                    </p>
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
              <button className="secondary-btn" type="button" onClick={() => handleView(detailTarget)}>
                Ver documento
              </button>
              <button className="primary-btn" type="button" onClick={() => handleDownload(detailTarget)}>
                Descargar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card documents-surface-free documents-list-card documents-filters-card">
        <h3 className="card-title">Documentos guardados</h3>
        <div className="form-row documents-filters-row" style={{ marginBottom: "0.75rem" }}>
          <div className="input-group">
            <label className="input-label">Búsqueda</label>
            <input
              className="input-field documents-filter-field"
              placeholder="Centro, notas o nombre de archivo"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label className="input-label">Tipo</label>
            <select
              className="select-field documents-filter-field"
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
          <div className="appointments-table-shell" style={{ overflowX: "auto" }}>
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
                  <tr
                    key={d.id}
                    className="table-row-clickable"
                    onClick={() => handleOpenDetail(d)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleOpenDetail(d);
                      }
                    }}
                  >
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
                    <td onClick={(event) => event.stopPropagation()}>
                      <RowActionsMenu
                        items={[
                          {
                            key: "view",
                            label: "Ver",
                            onClick: () => handleView(d),
                          },
                          {
                            key: "download",
                            label: "Descargar",
                            onClick: () => handleDownload(d),
                          },
                          {
                            key: "delete",
                            label: "Eliminar",
                            danger: true,
                            onClick: () => handleDelete(d),
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
