import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDocuments, uploadDocument, deleteDocument, getActiveHealthProfile } from "../api";
import { notifyClinicalDataChanged } from "../utils/clinicalRefresh";
import { getDocumentFile } from "../services/httpApi";
import { toIsoOrNull, toLocaleDateOrEmpty } from "../utils/dates";
import RowActionsMenu from "../components/RowActionsMenu";
import { canWriteProfile, isViewerProfile } from "../utils/profileAccess";

const docLabels = {
  receta: "Receta",
  orden: "Orden",
  resultado: "Resultado",
  informe: "Informe",
  otro: "Otro",
};

function getNewestDocumentRank(item) {
  const createdAt = new Date(item?.created_at || "");
  if (!Number.isNaN(createdAt.getTime())) return createdAt.getTime();
  const documentDate = new Date(item?.date || "");
  if (!Number.isNaN(documentDate.getTime())) return documentDate.getTime();
  return Number(item?.id || 0);
}

const ocrLabels = {
  pending: "OCR pendiente",
  processing: "OCR en proceso",
  done: "OCR listo",
  skipped_size: "OCR omitido",
};

const MOJIBAKE_FALLBACKS = [
  ["Ã¡", "á"],
  ["Ã©", "é"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ãº", "ú"],
  ["Ã±", "ñ"],
  ["Ã", "Á"],
  ["Ã‰", "É"],
  ["Ã", "Í"],
  ["Ã“", "Ó"],
  ["Ãš", "Ú"],
  ["Ã‘", "Ñ"],
  ["Â¿", "¿"],
  ["Â¡", "¡"],
  ["Â·", "·"],
  ["â€”", "—"],
  ["â€“", "–"],
  ["âˆ’", "-"],
  ["Ã—", "×"],
];

function cleanUiText(value, fallback = "") {
  const text = String(value ?? "");
  const cleaned = MOJIBAKE_FALLBACKS.reduce(
    (result, [search, replacement]) => result.split(search).join(replacement),
    text
  ).trim();
  return cleaned || fallback;
}

function inferViewerKind(doc) {
  const filename = String(doc?.filename || "").toLowerCase();
  if (filename.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(filename)) return "image";
  return "other";
}

const initialForm = {
  doc_type: "receta",
  date: "",
  center: "",
  notes: "",
  send_email_backup: false,
};

export default function Documents() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerTarget, setViewerTarget] = useState(null);
  const [viewerUrl, setViewerUrl] = useState("");
  const [viewerKind, setViewerKind] = useState("other");
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerZoom, setViewerZoom] = useState(1);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [form, setForm] = useState(initialForm);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const canEditActiveProfile = canWriteProfile(activeProfile);
  const isReadOnlyProfile = isViewerProfile(activeProfile);

  const resetForm = () => {
    setForm(initialForm);
    setFile(null);
  };

  const releaseViewerUrl = () => {
    if (viewerUrl) {
      window.URL.revokeObjectURL(viewerUrl);
    }
  };

  const closeViewer = () => {
    releaseViewerUrl();
    setViewerOpen(false);
    setViewerTarget(null);
    setViewerUrl("");
    setViewerKind("other");
    setViewerZoom(1);
    setViewerLoading(false);
  };

  const handleFormClose = () => {
    if (uploading) {
      window.alert("Espera a que termine la subida antes de cerrar.");
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
      const shouldClose = window.confirm("¿Cerrar sin guardar? Se perderán los cambios.");
      if (!shouldClose) return;
    }
    resetForm();
    setShowForm(false);
  };

  async function load() {
    const [data, profile] = await Promise.all([
      getDocuments(),
      getActiveHealthProfile().catch(() => null),
    ]);
    setActiveProfile(profile || null);
    setDocs(
      Array.isArray(data)
        ? [...data].sort((a, b) => getNewestDocumentRank(b) - getNewestDocumentRank(a))
        : []
    );
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => () => releaseViewerUrl(), [viewerUrl]);

  const filteredDocs = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return docs.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        cleanUiText(item.center).toLowerCase().includes(normalizedSearch) ||
        cleanUiText(item.notes).toLowerCase().includes(normalizedSearch) ||
        cleanUiText(item.filename).toLowerCase().includes(normalizedSearch);
      const matchesType = typeFilter === "all" || item.doc_type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [docs, search, typeFilter]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canEditActiveProfile) {
      window.alert("Este perfil está en modo solo lectura. No puedes subir documentos.");
      return;
    }
    const token = localStorage.getItem("token");
    if (!token) {
      window.alert("Debes iniciar sesión para subir documentos.");
      navigate("/login");
      return;
    }
    if (!file) {
      window.alert("Debes seleccionar un archivo, ya sea imagen o PDF.");
      return;
    }
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      window.alert("El archivo supera el límite de 10 MB. Reduce el tamaño e intenta de nuevo.");
      return;
    }

    setUploading(true);
    let timeoutId;
    try {
      timeoutId = window.setTimeout(() => {
        window.alert("La subida está tardando más de lo esperado. Mantente en esta pantalla.");
      }, 8000);
      await uploadDocument({
        doc_type: form.doc_type,
        date: toIsoOrNull(form.date),
        center: form.center,
        notes: form.notes,
        send_email_backup: form.send_email_backup,
        file,
      });
      window.clearTimeout(timeoutId);
      await load();
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["documents", "health-radar"],
      });
      resetForm();
      setShowForm(false);
    } catch (err) {
      console.error(err);
      window.clearTimeout(timeoutId);
      if (err?.response?.status === 401) {
        window.alert("Tu sesión expiró. Inicia sesión nuevamente.");
        navigate("/login");
        return;
      }
      if (err?.response?.status === 524) {
        window.alert("El servidor demoró demasiado en responder. Intenta nuevamente.");
        return;
      }
      window.alert("No se pudo subir el documento.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc) => {
    if (!canEditActiveProfile) {
      window.alert("Este perfil está en modo solo lectura. No puedes eliminar documentos.");
      return;
    }
    if (!window.confirm("¿Eliminar este documento?")) return;
    try {
      await deleteDocument(doc.id);
      await load();
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["documents", "health-radar"],
      });
      if (detailTarget?.id === doc.id) {
        setDetailOpen(false);
        setDetailTarget(null);
      }
      if (viewerTarget?.id === doc.id) {
        closeViewer();
      }
    } catch (err) {
      console.error(err);
      window.alert("No se pudo eliminar el documento.");
    }
  };

  const handleOpenViewer = async (doc) => {
    setViewerLoading(true);
    setViewerOpen(true);
    setViewerTarget(doc);
    setViewerKind(inferViewerKind(doc));
    setViewerZoom(1);
    try {
      const url = await getDocumentFile(doc.id);
      releaseViewerUrl();
      setViewerUrl(url);
    } catch (err) {
      console.error("Error al abrir documento:", err);
      closeViewer();
      window.alert(`No se pudo abrir el documento. ${err.response?.data?.detail || err.message}`);
    } finally {
      setViewerLoading(false);
    }
  };

  const handleDownload = async (doc) => {
    try {
      const url = await getDocumentFile(doc.id);
      const link = document.createElement("a");
      link.href = url;
      link.download = cleanUiText(doc.filename, `documento-${doc.id}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 2000);
    } catch (err) {
      console.error("Error al descargar documento:", err);
      window.alert("No se pudo descargar el documento.");
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

  const zoomLabel = `${Math.round(viewerZoom * 100)}%`;

  return (
    <>
      <div className="card documents-surface-free documents-intro">
        <h2 className="card-title">Documentos de salud</h2>
        <p className="muted">
          Guarda fotos o PDFs de recetas, órdenes, resultados e informes. Se almacenan de forma segura en Klinip.
        </p>
      </div>

      {isReadOnlyProfile ? (
        <div className="card">
          <div className="alert-info">
            <p>
              <strong>Perfil en modo lectura.</strong> Puedes revisar y descargar documentos, pero no subir ni eliminar archivos.
            </p>
          </div>
        </div>
      ) : null}

      {canEditActiveProfile ? (
        <div className="card documents-surface-free documents-create">
          <button className="primary-btn" type="button" style={{ width: "100%" }} onClick={() => setShowForm(true)}>
            Agregar documento
          </button>
        </div>
      ) : null}

      {showForm && canEditActiveProfile && (
        <div className="floating-form-backdrop" onClick={handleFormClose}>
          <div className="floating-form-card" onClick={(event) => event.stopPropagation()}>
            <div className="card-header" style={{ marginBottom: "0.75rem" }}>
              <h3 className="card-title" style={{ marginBottom: 0 }}>Nuevo documento</h3>
              <button className="secondary-btn" type="button" onClick={handleFormClose}>
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
                    onChange={(event) => setForm({ ...form, doc_type: event.target.value })}
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
                    onChange={(event) => setForm({ ...form, date: event.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="input-group">
                  <label className="input-label">Centro de salud</label>
                  <input
                    className="input-field"
                    value={form.center}
                    onChange={(event) => setForm({ ...form, center: event.target.value })}
                    placeholder="CESFAM, hospital, laboratorio..."
                  />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Notas</label>
                <textarea
                  className="textarea-field"
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  placeholder="Ej: Receta vence en 3 meses, control con médico tratante, etc."
                />
              </div>

              <div className="input-group">
                <label className="input-label">Archivo</label>
                <input
                  className="input-field"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
                <span className="tiny-note">Puedes cargar imágenes o PDF de hasta 10 MB.</span>
              </div>

              <label className="auth-consent-label" style={{ marginBottom: "0.75rem" }}>
                <input
                  type="checkbox"
                  checked={form.send_email_backup}
                  onChange={(event) =>
                    setForm({ ...form, send_email_backup: event.target.checked })
                  }
                />
                <span>Enviarme una copia de respaldo por correo.</span>
              </label>

              <div className="floating-actions">
                <button className="primary-btn" type="submit" disabled={uploading}>
                  {uploading ? "Subiendo..." : "Guardar documento"}
                </button>
                <button type="button" className="secondary-btn" onClick={handleFormClose}>
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
                <span className={`detail-chip detail-chip-type ${detailTarget.doc_type || "otro"}`}>
                  {docLabels[detailTarget.doc_type] || cleanUiText(detailTarget.doc_type, "Documento")}
                </span>
                <span className="detail-chip detail-chip-muted">
                  {ocrLabels[detailTarget.ocr_status] || (detailTarget.ocr_status ? "OCR con error" : "Sin OCR")}
                </span>
              </div>
              <div className="detail-grid">
                <div className="detail-field">
                  <div>
                    <span className="detail-label">Nombre del archivo</span>
                    <p>{cleanUiText(detailTarget.filename, `documento-${detailTarget.id}`)}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <div>
                    <span className="detail-label">Centro médico</span>
                    <p>{cleanUiText(detailTarget.center, "Sin centro registrado")}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <div>
                    <span className="detail-label">Fecha del documento</span>
                    <p>
                      {detailTarget.date
                        ? toLocaleDateOrEmpty(detailTarget.date)
                        : toLocaleDateOrEmpty(detailTarget.created_at)}
                    </p>
                  </div>
                </div>
                <div className="detail-field">
                  <div>
                    <span className="detail-label">Notas</span>
                    <p>{cleanUiText(detailTarget.notes, "Sin notas")}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" type="button" onClick={() => handleOpenViewer(detailTarget)}>
                Visualizar
              </button>
              <button className="primary-btn" type="button" onClick={() => handleDownload(detailTarget)}>
                Descargar
              </button>
            </div>
          </div>
        </div>
      )}

      {viewerOpen && viewerTarget && (
        <div className="modal-backdrop document-viewer-backdrop" onClick={closeViewer}>
          <div className="modal-card document-viewer-modal" onClick={(event) => event.stopPropagation()}>
            <div className="document-viewer-header">
              <div>
                <h3>Visualización de documento</h3>
                <p>{cleanUiText(viewerTarget.filename, `documento-${viewerTarget.id}`)}</p>
              </div>
              <button className="detail-close-btn" type="button" onClick={closeViewer} aria-label="Cerrar">
                ×
              </button>
            </div>

            <div className="document-viewer-stage">
              {viewerLoading ? (
                <div className="document-viewer-empty">Cargando documento...</div>
              ) : viewerUrl && viewerKind === "pdf" ? (
                <div className="document-viewer-canvas" style={{ "--viewer-scale": viewerZoom }}>
                  <iframe
                    className="document-viewer-frame"
                    src={`${viewerUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                    title={cleanUiText(viewerTarget.filename, "Documento PDF")}
                  />
                </div>
              ) : viewerUrl && viewerKind === "image" ? (
                <div className="document-viewer-canvas" style={{ "--viewer-scale": viewerZoom }}>
                  <img
                    className="document-viewer-image"
                    src={viewerUrl}
                    alt={cleanUiText(viewerTarget.filename, "Documento")}
                  />
                </div>
              ) : (
                <div className="document-viewer-empty">
                  <strong>No hay vista previa disponible</strong>
                  <span>Este tipo de archivo se puede descargar, pero no visualizar dentro de Klinip todavía.</span>
                </div>
              )}
            </div>

            <div className="document-viewer-toolbar">
              <button
                className="document-viewer-zoom-btn"
                type="button"
                onClick={() => setViewerZoom((current) => Math.max(0.75, Number((current - 0.1).toFixed(2))))}
                disabled={viewerKind === "other" || viewerLoading}
              >
                Zoom -
              </button>
              <span className="document-viewer-zoom-value">{zoomLabel}</span>
              <button
                className="document-viewer-zoom-btn"
                type="button"
                onClick={() => setViewerZoom((current) => Math.min(2, Number((current + 0.1).toFixed(2))))}
                disabled={viewerKind === "other" || viewerLoading}
              >
                Zoom +
              </button>
            </div>

            <div className="document-viewer-actions">
              <button className="primary-btn" type="button" onClick={() => handleDownload(viewerTarget)}>
                {viewerKind === "pdf" ? "Descargar PDF" : "Descargar archivo"}
              </button>
              <button className="secondary-btn" type="button" onClick={closeViewer}>
                Cerrar
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
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="input-group">
            <label className="input-label">Tipo</label>
            <select
              className="select-field documents-filter-field"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
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
          <>
          <div className="appointments-table-shell" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>OCR</th>
                  <th>Fecha</th>
                  <th>Centro</th>
                  <th>Notas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map((doc) => (
                  <tr
                    key={doc.id}
                    className="table-row-clickable"
                    onClick={() => handleOpenDetail(doc)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleOpenDetail(doc);
                      }
                    }}
                  >
                    <td>
                      <span className="badge">
                        {docLabels[doc.doc_type] || cleanUiText(doc.doc_type, "Documento")}
                      </span>
                    </td>
                    <td>
                      <span className="badge">
                        {ocrLabels[doc.ocr_status] || (doc.ocr_status ? "OCR con error" : "Sin OCR")}
                      </span>
                    </td>
                    <td>
                      {doc.date ? toLocaleDateOrEmpty(doc.date) : toLocaleDateOrEmpty(doc.created_at)}
                    </td>
                    <td>{cleanUiText(doc.center)}</td>
                    <td style={{ maxWidth: "240px" }}>
                      <span style={{ fontSize: "0.85rem" }}>{cleanUiText(doc.notes)}</span>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <RowActionsMenu
                        items={[
                          {
                            key: "preview",
                            label: "Visualizar",
                            onClick: () => handleOpenViewer(doc),
                          },
                          {
                            key: "download",
                            label: "Descargar",
                            onClick: () => handleDownload(doc),
                          },
                          canEditActiveProfile
                            ? {
                                key: "delete",
                                label: "Eliminar",
                                danger: true,
                                onClick: () => handleDelete(doc),
                              }
                            : null,
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="records-mobile-list documents-mobile-list">
            {filteredDocs.map((doc) => (
              <article
                key={`mobile-${doc.id}`}
                className="records-mobile-card documents-mobile-card"
                onClick={() => handleOpenDetail(doc)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleOpenDetail(doc);
                  }
                }}
              >
                <div className="records-mobile-head">
                  <div className="records-mobile-head-main">
                    <span className={`records-mobile-icon-badge is-${doc.doc_type || "document"}`}>
                      {cleanUiText(docLabels[doc.doc_type] || "Documento").slice(0, 1)}
                    </span>
                    <div className="records-mobile-title-group">
                      <strong>{cleanUiText(docLabels[doc.doc_type] || "Documento")}</strong>
                      <span>{cleanUiText(doc.filename || "Archivo sin nombre")}</span>
                    </div>
                  </div>
                  <div className="records-mobile-head-side">
                    <span className="badge">
                      {ocrLabels[doc.ocr_status] || (doc.ocr_status ? "OCR con error" : "Sin OCR")}
                    </span>
                    <div onClick={(event) => event.stopPropagation()}>
                      <RowActionsMenu
                        items={[
                          {
                            key: "preview",
                            label: "Visualizar",
                            onClick: () => handleOpenViewer(doc),
                          },
                          {
                            key: "download",
                            label: "Descargar",
                            onClick: () => handleDownload(doc),
                          },
                          canEditActiveProfile
                            ? {
                                key: "delete",
                                label: "Eliminar",
                                danger: true,
                                onClick: () => handleDelete(doc),
                              }
                            : null,
                        ]}
                      />
                    </div>
                  </div>
                </div>

                <div className="records-mobile-meta-grid">
                  <div className="records-mobile-meta-item">
                    <span className="records-mobile-meta-label">Fecha</span>
                    <span>{doc.date ? toLocaleDateOrEmpty(doc.date) : toLocaleDateOrEmpty(doc.created_at)}</span>
                  </div>
                  <div className="records-mobile-meta-item">
                    <span className="records-mobile-meta-label">Centro</span>
                    <span>{cleanUiText(doc.center, "Sin centro")}</span>
                  </div>
                </div>

                {cleanUiText(doc.notes) ? (
                  <div className="records-mobile-note">{cleanUiText(doc.notes)}</div>
                ) : null}

                <div className="records-mobile-footer">
                  <button
                    type="button"
                    className="records-mobile-link"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleOpenViewer(doc);
                    }}
                  >
                    Visualizar
                  </button>
                  <button
                    type="button"
                    className="records-mobile-link"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleOpenDetail(doc);
                    }}
                  >
                    Más detalle
                  </button>
                </div>
              </article>
            ))}
          </div>
          </>
        )}
      </div>
    </>
  );
}
