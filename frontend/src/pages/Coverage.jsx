import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getCoverageDocuments,
  getCoveragePreferences,
  retryDocumentOcr,
  updateCoverageDocumentInfo,
  updateCoveragePreferences,
} from "../services/httpApi";
import {
  flattenCoverageDocument,
  getCoverageAmountTotals,
  getCoverageCategoryCounts,
} from "../components/coverage/coverageTaxonomy";
import CoveragePlanCard from "../components/coverage/CoveragePlanCard";
import CoverageSummary from "../components/coverage/CoverageSummary";
import CoverageFilters from "../components/coverage/CoverageFilters";
import CoverageDocumentList from "../components/coverage/CoverageDocumentList";
import CoverageEmptyState from "../components/coverage/CoverageEmptyState";
import CoverageGuide from "../components/coverage/CoverageGuide";
import DocumentUploadWizard from "../components/DocumentUploadWizard";
import { COVERAGE_UPLOAD_INTENT } from "../utils/coverageDocuments";

function getDocumentTime(doc) {
  const raw = doc?.date || doc?.created_at;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : Number(doc?.id || 0);
}

export default function Coverage({ profileId = null }) {
  const [coverageDocuments, setCoverageDocuments] = useState([]);
  const [preference, setPreference] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState("todos");
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  const [savingDocumentId, setSavingDocumentId] = useState(null);
  const [documentEditError, setDocumentEditError] = useState("");
  const [uploadWizardOpen, setUploadWizardOpen] = useState(false);
  const [retryingReadId, setRetryingReadId] = useState(null);

  const loadCoverage = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    setError("");
    const requestOptions = profileId ? { profileId } : {};
    try {
      const [docs, pref] = await Promise.all([
        getCoverageDocuments(requestOptions).catch(() => null),
        getCoveragePreferences(requestOptions).catch(() => null),
      ]);
      if (docs === null && pref === null) {
        setError("No se pudo cargar tu información de cobertura. Revisa tu conexión e inténtalo de nuevo.");
      }
      setCoverageDocuments(
        (Array.isArray(docs) ? docs : [])
          .map((item) => flattenCoverageDocument(item))
          .sort((a, b) => getDocumentTime(b) - getDocumentTime(a))
      );
      setPreference(pref || null);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    loadCoverage();
  }, [loadCoverage]);

  const readingCount = coverageDocuments.filter((doc) => {
    const status = String(doc?.ocr_status || "").trim().toLowerCase();
    return !status || status === "pending" || status === "processing";
  }).length;

  useEffect(() => {
    if (!readingCount) return undefined;
    const timer = window.setInterval(() => {
      loadCoverage({ showLoading: false });
    }, 6000);
    return () => window.clearInterval(timer);
  }, [loadCoverage, readingCount]);

  const handleSavePreference = async (payload) => {
    setSavingPreference(true);
    setPreferenceError("");
    try {
      const saved = await updateCoveragePreferences(payload, profileId ? { profileId } : {});
      setPreference(saved || payload);
      return true;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setPreferenceError(
        typeof detail === "string" && detail
          ? detail
          : "No se pudo guardar tu previsión. Inténtalo de nuevo."
      );
      return false;
    } finally {
      setSavingPreference(false);
    }
  };

  const handleSaveDocumentInfo = async (documentId, payload) => {
    setSavingDocumentId(documentId);
    setDocumentEditError("");
    try {
      const saved = await updateCoverageDocumentInfo(documentId, payload);
      const flattened = flattenCoverageDocument(saved);
      setCoverageDocuments((current) =>
        current
          .map((doc) => (doc.id === documentId ? flattened : doc))
          .sort((a, b) => getDocumentTime(b) - getDocumentTime(a))
      );
      return true;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setDocumentEditError(
        typeof detail === "string" && detail
          ? detail
          : "No se pudo guardar la corrección. Inténtalo de nuevo."
      );
      return false;
    } finally {
      setSavingDocumentId(null);
    }
  };

  const handleRetryRead = async (documentId) => {
    if (!documentId || retryingReadId === documentId) return;
    setRetryingReadId(documentId);
    setDocumentEditError("");
    try {
      await retryDocumentOcr(documentId);
      setCoverageDocuments((current) =>
        current.map((doc) => (doc.id === documentId ? { ...doc, ocr_status: "pending" } : doc))
      );
      await loadCoverage({ showLoading: false });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setDocumentEditError(
        typeof detail === "string" && detail
          ? detail
          : "No se pudo iniciar una nueva lectura. Inténtalo otra vez."
      );
    } finally {
      setRetryingReadId(null);
    }
  };

  const categoryCounts = useMemo(
    () => getCoverageCategoryCounts(coverageDocuments),
    [coverageDocuments]
  );
  const amountTotals = useMemo(
    () => getCoverageAmountTotals(coverageDocuments),
    [coverageDocuments]
  );
  const categoriesWithDocs = Object.values(categoryCounts).filter((count) => count > 0).length;
  const pendingCount = coverageDocuments.filter((doc) => doc.coverageStatus === "pendiente").length;

  const filteredDocuments =
    activeFilter === "todos"
      ? coverageDocuments
      : coverageDocuments.filter((doc) => doc.coverageCategory === activeFilter);

  return (
    <div className="page-container health-hub-page coverage-page">
      <section className="health-hub-hero coverage-hero">
        <div className="health-hub-hero-copy">
          <span className="health-hub-kicker">Klinip Cobertura</span>
          <h1>Tus bonos, reembolsos y licencias, en un solo lugar.</h1>
          <p>
            Sube los documentos de tu Isapre, Fonasa o seguro y Klinip los ordena por categoría para
            que los encuentres cuando los necesites.
          </p>
        </div>
        <div className="health-hub-hero-actions">
          <button
            type="button"
            className="health-hub-hero-action"
            onClick={() => setUploadWizardOpen(true)}
          >
            Subir licencia, bono o reembolso
          </button>
          <Link className="health-hub-hero-secondary" to="/ai">
            Preguntar a Klinip IA
          </Link>
        </div>
      </section>

      <section className="coverage-upload-note" aria-label="Lectura de documentos de cobertura">
        <strong>PDF, foto o imagen</strong>
        <span>
          Klinip los guarda como cobertura, lee el contenido con OCR/IA y los clasifica como bono,
          reembolso, licencia, copago, GES/CAEC o plan.
        </span>
      </section>

      <CoveragePlanCard
        preference={preference}
        saving={savingPreference}
        error={preferenceError}
        onSave={handleSavePreference}
      />

      <CoverageSummary
        total={coverageDocuments.length}
        pending={pendingCount}
        categoriesCount={categoriesWithDocs}
        amountTotals={amountTotals}
        loading={loading}
      />

      {error ? <div className="coverage-alert">{error}</div> : null}

      {readingCount ? (
        <div className="coverage-processing-banner" role="status">
          <strong>Leyendo {readingCount} documento{readingCount === 1 ? "" : "s"}</strong>
          <span>
            Estamos extrayendo datos desde la foto o PDF. La lista se actualizará automáticamente.
          </span>
        </div>
      ) : null}

      <section className="coverage-section">
        <div className="health-hub-section-head">
          <div>
            <h2>Tus documentos de cobertura</h2>
            <p>Toca una categoría para ver solo esos documentos.</p>
          </div>
        </div>

        <CoverageFilters
          counts={categoryCounts}
          total={coverageDocuments.length}
          active={activeFilter}
          onSelect={setActiveFilter}
        />

        {loading ? (
          <div className="coverage-empty">Cargando tu cobertura…</div>
        ) : filteredDocuments.length > 0 ? (
          <CoverageDocumentList
            documents={filteredDocuments}
            savingId={savingDocumentId}
            retryingReadId={retryingReadId}
            editError={documentEditError}
            onSave={handleSaveDocumentInfo}
            onRetryRead={handleRetryRead}
          />
        ) : (
          <CoverageEmptyState
            activeFilter={activeFilter}
            hasAnyCoverage={coverageDocuments.length > 0}
            onUpload={() => setUploadWizardOpen(true)}
          />
        )}
      </section>

      <CoverageGuide />

      <DocumentUploadWizard
        open={uploadWizardOpen}
        onClose={() => setUploadWizardOpen(false)}
        profileId={profileId}
        initialIntent={COVERAGE_UPLOAD_INTENT}
        onUploaded={() => loadCoverage({ showLoading: false })}
      />
    </div>
  );
}
