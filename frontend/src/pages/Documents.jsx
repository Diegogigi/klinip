import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { getDocuments, uploadDocument, deleteDocument, updateDocument, getActiveHealthProfile, getMfaStatus, isAuthSessionError } from "../api";
import { notifyClinicalDataChanged } from "../utils/clinicalRefresh";
import { getDocumentFile, getDocumentFileWithStepUp } from "../services/httpApi";
import { toIsoOrNull, toLocaleDateOrEmpty } from "../utils/dates";
import RowActionsMenu from "../components/RowActionsMenu";
import { canWriteProfile, isViewerProfile } from "../utils/profileAccess";
import StepUpModal from "../components/StepUpModal";
import { cleanUiText } from "../utils/textEncoding";
import useMobileOverlayLock from "../hooks/useMobileOverlayLock";

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

function getDocumentFilename(doc) {
  return cleanUiText(doc?.filename, doc?.id ? `documento-${doc.id}` : "documento");
}

function inferDocumentMimeType(filename, fallbackType = "") {
  const normalized = String(filename || "").toLowerCase();
  if (fallbackType) return fallbackType;
  if (normalized.endsWith(".pdf")) return "application/pdf";
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".bmp")) return "image/bmp";
  if (normalized.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function buildDocumentShareMessage(doc) {
  const filename = getDocumentFilename(doc);
  const typeLabel = cleanUiText(docLabels[doc?.doc_type] || doc?.doc_type || "Documento", "Documento");
  const center = cleanUiText(doc?.center);
  const dateLabel = doc?.date ? toLocaleDateOrEmpty(doc.date) : "";
  const messageParts = [`Te comparto ${typeLabel.toLowerCase()} "${filename}" desde Klinip.`];
  if (center) messageParts.push(`Centro: ${center}.`);
  if (dateLabel) messageParts.push(`Fecha: ${dateLabel}.`);
  messageParts.push("Para adjuntar el archivo real, usa la opci\u00f3n Compartir archivo o desc\u00e1rgalo primero desde Klinip.");
  return messageParts.join(" ");
}

function inferViewerKind(doc) {
  const filename = String(doc?.filename || "").toLowerCase();
  if (filename.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(filename)) return "image";
  return "other";
}

function inferViewerKindFromBlob(doc, blob) {
  const filenameKind = inferViewerKind(doc);
  if (filenameKind !== "other") return filenameKind;
  const mime = String(blob?.type || "").toLowerCase();
  if (mime.includes("pdf")) return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "other";
}

function getPreviewActionLabel(doc) {
  return inferViewerKind(doc) === "pdf" ? "Abrir PDF" : "Visualizar";
}

function getErrorDetail(err, fallback) {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (detail?.message) return detail.message;
  return fallback;
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
  const [viewerBlob, setViewerBlob] = useState(null);
  const [viewerStepUpToken, setViewerStepUpToken] = useState("");
  const [viewerSharing, setViewerSharing] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [form, setForm] = useState(initialForm);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPending, setStepUpPending] = useState(null); // { action: "view"|"download", doc }
  const [hasMfa, setHasMfa] = useState(false);
  const [detailRenameOpen, setDetailRenameOpen] = useState(false);
  const [detailFilenameDraft, setDetailFilenameDraft] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);

  const canEditActiveProfile = canWriteProfile(activeProfile);
  const isReadOnlyProfile = isViewerProfile(activeProfile);
  const hasOverlayOpen = showForm || detailOpen || viewerOpen || stepUpOpen;

  useMobileOverlayLock(hasOverlayOpen);

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
    setViewerBlob(null);
    setViewerStepUpToken("");
    setViewerLoading(false);
    setViewerSharing(false);
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
    try {
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
    } catch (error) {
      if (!isAuthSessionError(error)) {
        console.error("No se pudieron cargar los documentos", error);
      }
      setActiveProfile(null);
      setDocs([]);
    }
  }

  useEffect(() => {
    load();
    getMfaStatus().then((s) => setHasMfa(!!s?.mfa_enabled)).catch(() => {});
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

  const handleOpenViewer = async (doc, stepUpToken) => {
    setDetailOpen(false);
    setDetailTarget(null);
    const initialKind = inferViewerKind(doc);
    releaseViewerUrl();
    setViewerTarget(doc);
    setViewerKind(initialKind);
    setViewerZoom(1);
    setViewerBlob(null);
    setViewerStepUpToken(stepUpToken || "");
    setViewerUrl("");
    setViewerSharing(false);
    setViewerOpen(true);
    setViewerLoading(true);
    try {
      const blob = stepUpToken
        ? await getDocumentFileWithStepUp(doc.id, stepUpToken)
        : await getDocumentFile(doc.id);
      const url = window.URL.createObjectURL(blob);
      const resolvedKind = inferViewerKindFromBlob(doc, blob);
      setViewerBlob(blob);
      setViewerStepUpToken(stepUpToken || "");
      setViewerKind(resolvedKind);
      setViewerUrl(url);
    } catch (err) {
      if (err.stepUpRequired) {
        closeViewer();
        setStepUpPending({ action: "view", doc });
        setStepUpOpen(true);
        return;
      }
      console.error("Error al abrir documento:", err);
      closeViewer();
      window.alert(`No se pudo abrir el documento. ${getErrorDetail(err, err.message)}`);
    } finally {
      setViewerLoading(false);
    }
  };

  const handleDownload = async (doc, stepUpToken) => {
    try {
      const blob = stepUpToken
        ? await getDocumentFileWithStepUp(doc.id, stepUpToken)
        : await getDocumentFile(doc.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getDocumentFilename(doc);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 2000);
    } catch (err) {
      if (err.stepUpRequired) {
        setStepUpPending({ action: "download", doc });
        setStepUpOpen(true);
        return;
      }
      console.error("Error al descargar documento:", err);
      window.alert(getErrorDetail(err, "No se pudo descargar el documento."));
    }
  };

  const handleStepUpVerified = (token) => {
    setStepUpOpen(false);
    const pending = stepUpPending;
    setStepUpPending(null);
    if (!pending) return;
    if (pending.action === "view") handleOpenViewer(pending.doc, token);
    else if (pending.action === "download") handleDownload(pending.doc, token);
  };

  const handleOpenDetail = (doc) => {
    setDetailTarget(doc);
    setDetailRenameOpen(false);
    setDetailFilenameDraft(getDocumentFilename(doc));
    setDetailOpen(true);
  };

  const handleCloseDetail = () => {
    if (detailSaving) return;
    setDetailOpen(false);
    setDetailTarget(null);
    setDetailRenameOpen(false);
    setDetailFilenameDraft("");
  };

  const syncDocumentState = (updatedDoc) => {
    if (!updatedDoc?.id) return;
    setDocs((current) =>
      current.map((item) => (String(item.id) === String(updatedDoc.id) ? updatedDoc : item))
    );
    setDetailTarget((current) =>
      current && String(current.id) === String(updatedDoc.id) ? updatedDoc : current
    );
    setViewerTarget((current) =>
      current && String(current.id) === String(updatedDoc.id) ? updatedDoc : current
    );
  };

  const handleSaveDocumentFilename = async () => {
    if (!detailTarget?.id || !canEditActiveProfile || detailSaving) return;
    const nextFilename = detailFilenameDraft.trim();
    if (!nextFilename) {
      window.alert("Ingresa un nombre para identificar el archivo.");
      return;
    }
    setDetailSaving(true);
    try {
      const updatedDoc = await updateDocument(detailTarget.id, { filename: nextFilename });
      syncDocumentState(updatedDoc);
      setDetailFilenameDraft(getDocumentFilename(updatedDoc));
      setDetailRenameOpen(false);
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["documents", "health-radar"],
      });
    } catch (err) {
      console.error("No se pudo renombrar el documento:", err);
      window.alert(getErrorDetail(err, "No se pudo actualizar el nombre del archivo."));
    } finally {
      setDetailSaving(false);
    }
  };

  const viewerFilename = useMemo(
    () => (viewerTarget ? getDocumentFilename(viewerTarget) : ""),
    [viewerTarget]
  );

  const viewerShareTitle = useMemo(
    () => (viewerFilename ? `Klinip | ${viewerFilename}` : "Klinip"),
    [viewerFilename]
  );

  const viewerShareMessage = useMemo(
    () => (viewerTarget ? buildDocumentShareMessage(viewerTarget) : ""),
    [viewerTarget]
  );

  const viewerShareFile = useMemo(() => {
    if (!viewerTarget || !viewerBlob || typeof File === "undefined") return null;
    return new File([viewerBlob], viewerFilename || `documento-${viewerTarget.id}`, {
      type: inferDocumentMimeType(viewerFilename, viewerBlob.type),
      lastModified: Date.now(),
    });
  }, [viewerBlob, viewerFilename, viewerTarget]);

  const canShareViewerFile = useMemo(() => {
    if (
      !viewerShareFile ||
      typeof navigator === "undefined" ||
      typeof navigator.share !== "function" ||
      typeof navigator.canShare !== "function"
    ) {
      return false;
    }
    try {
      return navigator.canShare({ files: [viewerShareFile] });
    } catch (_) {
      return false;
    }
  }, [viewerShareFile]);

  const handleNativeShare = async () => {
    if (!viewerTarget || !canShareViewerFile || !viewerShareFile) return;
    setViewerSharing(true);
    try {
      await navigator.share({
        title: viewerShareTitle,
        text: viewerShareMessage,
        files: [viewerShareFile],
      });
    } catch (err) {
      if (err?.name !== "AbortError") {
        console.error("No se pudo compartir el documento:", err);
        window.alert("No se pudo abrir el menú de compartir en este dispositivo.");
      }
    } finally {
      setViewerSharing(false);
    }
  };

  const handleOpenPdfInNewTab = () => {
    if (!viewerUrl) return;
    try {
      const opened = window.open(viewerUrl, "_blank", "noopener,noreferrer");
      if (opened) {
        opened.opener = null;
        return;
      }
    } catch (_) {
      // Fallback below.
    }
    try {
      const link = document.createElement("a");
      link.href = viewerUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("No se pudo abrir el PDF en una pestaña nueva:", err);
      window.alert("No se pudo abrir el PDF en una pestaña nueva. Puedes descargarlo.");
    }
  };

  const zoomLabel = `${Math.round(viewerZoom * 100)}%`;
  const viewerImageWidth = `${Math.round(viewerZoom * 100)}%`;
  const viewerIsPdf = viewerKind === "pdf";

  return (
    <>
      <div className="card documents-surface-free documents-intro">
        <h2 className="card-title">Documentos de salud</h2>
        <p className="muted">
          Guarda fotos o PDF de recetas, órdenes, resultados e informes. Se almacenan de forma segura en Klinip.
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

      {showForm && canEditActiveProfile && createPortal(
        <div className="floating-form-backdrop" onClick={handleFormClose}>
          <div
            key={form.id ?? "new-document"}
            className="floating-form-card"
            onClick={(event) => event.stopPropagation()}
          >
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
      , document.getElementById("overlay-root") || document.body)}

      {detailOpen && detailTarget && createPortal(
        <div className="modal-backdrop" onClick={handleCloseDetail}>
          <div
            key={`document-detail-${detailTarget.id ?? "item"}`}
            className="modal-card detail-modal-card"
            onClick={(event) => event.stopPropagation()}
          >
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
                    <div className="docs-detail-file-head">
                      <span className="detail-label">Nombre del archivo</span>
                      {canEditActiveProfile && !detailRenameOpen ? (
                        <button
                          type="button"
                          className="docs-detail-inline-btn"
                          onClick={() => {
                            setDetailFilenameDraft(getDocumentFilename(detailTarget));
                            setDetailRenameOpen(true);
                          }}
                        >
                          Renombrar
                        </button>
                      ) : null}
                    </div>
                    {detailRenameOpen ? (
                      <div className="docs-detail-filename-editor">
                        <input
                          className="input-field docs-detail-filename-input"
                          value={detailFilenameDraft}
                          onChange={(event) => setDetailFilenameDraft(event.target.value)}
                          placeholder="Ej: Resultado resonancia rodilla izquierda"
                          maxLength={200}
                          autoFocus
                        />
                        <span className="docs-detail-help">
                          La extensión original se conserva al guardar.
                        </span>
                        <div className="docs-detail-inline-actions">
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => {
                              setDetailRenameOpen(false);
                              setDetailFilenameDraft(getDocumentFilename(detailTarget));
                            }}
                            disabled={detailSaving}
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            className="primary-btn"
                            onClick={handleSaveDocumentFilename}
                            disabled={detailSaving}
                          >
                            {detailSaving ? "Guardando..." : "Guardar nombre"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p>{cleanUiText(detailTarget.filename, `documento-${detailTarget.id}`)}</p>
                    )}
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
            <div className="modal-actions docs-detail-actions">
              <button className="secondary-btn" type="button" onClick={() => handleOpenViewer(detailTarget)}>
                {getPreviewActionLabel(detailTarget)}
              </button>
              <button className="primary-btn" type="button" onClick={() => handleDownload(detailTarget)}>
                Descargar
              </button>
            </div>
          </div>
        </div>
      , document.getElementById("overlay-root") || document.body)}

      {viewerOpen && viewerTarget && createPortal(
        <div className="modal-backdrop document-viewer-backdrop" onClick={closeViewer}>
          <div
            key={`document-viewer-${viewerTarget.id ?? "item"}`}
            className="modal-card document-viewer-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="document-viewer-header">
              <div>
                <h3>Visualización de documento</h3>
                <p>{viewerFilename}</p>
              </div>
              <button className="detail-close-btn" type="button" onClick={closeViewer} aria-label="Cerrar">
                ×
              </button>
            </div>

            <div className="document-viewer-stage">
              {viewerLoading ? (
                <div className="document-viewer-empty">Cargando documento...</div>
              ) : viewerIsPdf && viewerTarget ? (
                <div className="document-viewer-empty document-viewer-pdf-safe">
                  <strong>Vista segura para PDF</strong>
                  <span>
                    Puedes abrir el PDF en una pestaña nueva o descargarlo sin salir de esta pantalla.
                  </span>
                  <div className="document-viewer-pdf-actions">
                    <button
                      className="secondary-btn"
                      type="button"
                      onClick={handleOpenPdfInNewTab}
                      disabled={viewerLoading || !viewerUrl}
                    >
                      Abrir PDF
                    </button>
                    <button
                      className="primary-btn"
                      type="button"
                      onClick={() => handleDownload(viewerTarget, viewerStepUpToken)}
                    >
                      Descargar PDF
                    </button>
                  </div>
                </div>
              ) : viewerUrl && viewerKind === "image" ? (
                <div className="document-viewer-canvas">
                  <img
                    className="document-viewer-image"
                    src={viewerUrl}
                    alt={cleanUiText(viewerTarget.filename, "Documento")}
                    style={{ width: viewerImageWidth, maxWidth: "none" }}
                  />
                </div>
              ) : (
                <div className="document-viewer-empty">
                  <strong>No hay vista previa disponible</strong>
                  <span>Este tipo de archivo se puede descargar, pero no visualizar dentro de Klinip todavía.</span>
                </div>
              )}
            </div>

            {!viewerIsPdf ? (
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
            ) : null}

            {!viewerIsPdf ? (
              <div className="document-viewer-share">
              <div className="document-viewer-share-copy">
                <span className="document-viewer-share-kicker">Salida segura</span>
                <strong>Compartir archivo</strong>
                <span>
                  {canShareViewerFile
                    ? "Abre el menú nativo de tu dispositivo para enviar este archivo directamente."
                    : "Este navegador no permite compartir el archivo desde el visor. Puedes descargarlo y enviarlo manualmente."}
                </span>
              </div>
              <div className="document-viewer-share-actions">
                <button
                  className="secondary-btn document-viewer-share-btn document-viewer-share-cta"
                  type="button"
                  onClick={handleNativeShare}
                  disabled={viewerLoading || viewerSharing || !canShareViewerFile}
                >
                  <span className="document-viewer-share-cta-copy">
                    <strong>{viewerSharing ? "Compartiendo..." : "Compartir archivo"}</strong>
                    <span>{canShareViewerFile ? "Usar menú del dispositivo" : "No disponible en este navegador"}</span>
                  </span>
                  <span className="document-viewer-share-cta-mark" aria-hidden="true">
                    +
                  </span>
                </button>
              </div>
              </div>
            ) : null}

            <div className="document-viewer-actions">
              <button className="primary-btn" type="button" onClick={() => handleDownload(viewerTarget, viewerStepUpToken)}>
                {viewerKind === "pdf" ? "Descargar PDF" : "Descargar archivo"}
              </button>
              <button className="secondary-btn" type="button" onClick={closeViewer}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      , document.getElementById("overlay-root") || document.body)}

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
                            label: getPreviewActionLabel(doc),
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
                            label: getPreviewActionLabel(doc),
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
                    {getPreviewActionLabel(doc)}
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

      <StepUpModal
        open={stepUpOpen}
        onClose={() => { setStepUpOpen(false); setStepUpPending(null); }}
        onVerified={handleStepUpVerified}
        hasMfa={hasMfa}
        actionLabel="acceder al documento"
      />
    </>
  );
}
