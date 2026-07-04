import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getDocuments } from "../services/httpApi";
import { isCoverageDocument } from "../utils/coverageDocuments";
import {
  decorateCoverageDocument,
  getCoverageCategoryCounts,
} from "../components/coverage/coverageTaxonomy";
import CoveragePlanCard from "../components/coverage/CoveragePlanCard";
import CoverageSummary from "../components/coverage/CoverageSummary";
import CoverageFilters from "../components/coverage/CoverageFilters";
import CoverageDocumentList from "../components/coverage/CoverageDocumentList";
import CoverageEmptyState from "../components/coverage/CoverageEmptyState";
import CoverageGuide from "../components/coverage/CoverageGuide";

function getDocumentTime(doc) {
  const raw = doc?.date || doc?.created_at;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : Number(doc?.id || 0);
}

export default function Coverage() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState("todos");

  useEffect(() => {
    let cancelled = false;
    async function loadCoverage() {
      setLoading(true);
      setError("");
      try {
        const data = await getDocuments();
        if (!cancelled) setDocuments(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) {
          setError("No se pudo cargar tu información de cobertura. Revisa tu conexión e inténtalo de nuevo.");
          setDocuments([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadCoverage();
    return () => {
      cancelled = true;
    };
  }, []);

  const coverageDocuments = useMemo(
    () =>
      documents
        .filter((doc) => isCoverageDocument(doc))
        .map((doc) => decorateCoverageDocument(doc))
        .sort((a, b) => getDocumentTime(b) - getDocumentTime(a)),
    [documents]
  );

  const categoryCounts = useMemo(
    () => getCoverageCategoryCounts(coverageDocuments),
    [coverageDocuments]
  );
  const categoriesWithDocs = Object.values(categoryCounts).filter((count) => count > 0).length;
  const pendingCount = coverageDocuments.filter((doc) =>
    ["pending", "processing"].includes(String(doc.ocr_status || "").toLowerCase())
  ).length;
  const detectedInsurers = useMemo(
    () => Array.from(new Set(coverageDocuments.map((doc) => doc.coverageInsurer).filter(Boolean))),
    [coverageDocuments]
  );

  const filteredDocuments =
    activeFilter === "todos"
      ? coverageDocuments
      : coverageDocuments.filter((doc) => (doc.coverageCategories || []).includes(activeFilter));

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
          <Link className="health-hub-hero-action" to="/documents">
            Subir documento de cobertura
          </Link>
          <Link className="health-hub-hero-secondary" to="/ai">
            Preguntar a Klinip IA
          </Link>
        </div>
      </section>

      <CoveragePlanCard detectedInsurers={detectedInsurers} />

      <CoverageSummary
        total={coverageDocuments.length}
        pending={pendingCount}
        categoriesCount={categoriesWithDocs}
        loading={loading}
      />

      {error ? <div className="coverage-alert">{error}</div> : null}

      <section className="coverage-section">
        <div className="health-hub-section-head">
          <div>
            <h2>Tus documentos de cobertura</h2>
            <p>Toca una categoría para filtrar. Un documento puede estar en más de una.</p>
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
          <CoverageDocumentList documents={filteredDocuments} />
        ) : (
          <CoverageEmptyState
            activeFilter={activeFilter}
            hasAnyCoverage={coverageDocuments.length > 0}
          />
        )}
      </section>

      <CoverageGuide />
    </div>
  );
}
