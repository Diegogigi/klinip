import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getDocuments } from "../services/httpApi";
import { cleanUiText } from "../utils/textEncoding";
import { getCoverageSignals, getDetectedInsurer, isCoverageDocument } from "../utils/coverageDocuments";

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return "Sin fecha";
  return date.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getDocumentTime(doc) {
  const date = parseDate(doc?.date) || parseDate(doc?.created_at);
  return date ? date.getTime() : Number(doc?.id || 0);
}

function getOcrLabel(status) {
  const key = String(status || "").toLowerCase();
  if (key === "done") return "Leído por IA";
  if (key === "pending" || key === "processing") return "Leyendo";
  if (key.startsWith("error")) return "Revisar";
  return "Sin lectura";
}

function CoverageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
      <path d="M4 9h16" />
      <path d="M7.5 14h4" />
      <path d="M16 13.2h.01" />
    </svg>
  );
}

function CoverageStat({ label, value, helper }) {
  return (
    <article className="coverage-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

export default function Coverage() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
          setError("No se pudo cargar la información de cobertura.");
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

  const coverageDocuments = useMemo(() => {
    return documents
      .map((doc) => {
        const signals = getCoverageSignals(doc);
        return {
          ...doc,
          coverageSignals: signals,
          detectedInsurer: getDetectedInsurer(doc),
        };
      })
      .filter((doc) => isCoverageDocument(doc))
      .sort((a, b) => getDocumentTime(b) - getDocumentTime(a));
  }, [documents]);

  const pendingCoverageDocs = coverageDocuments.filter((doc) =>
    ["pending", "processing"].includes(String(doc.ocr_status || "").toLowerCase())
  );
  const readCoverageDocs = coverageDocuments.filter((doc) => String(doc.ocr_status || "").toLowerCase() === "done");
  const insurerCount = new Set(coverageDocuments.map((doc) => doc.detectedInsurer).filter(Boolean)).size;
  const latestDocs = coverageDocuments.slice(0, 5);

  return (
    <div className="page-container health-hub-page coverage-page">
      <section className="health-hub-hero coverage-hero">
        <div className="health-hub-hero-copy">
          <span className="health-hub-kicker">Klinip Cobertura</span>
          <h1>Cobertura, bonos y reembolsos junto a tu salud.</h1>
          <p>
            Reúne documentos de Isapre, Fonasa, seguros, licencias y copagos para entender mejor la parte
            financiera de tu cuidado sin depender de un solo portal.
          </p>
        </div>
        <div className="health-hub-hero-highlights">
          <div className="health-hub-highlight">
            <strong>Capa neutral</strong>
            <span>Ordena información aunque venga de clínicas, laboratorios, Isapre o Fonasa.</span>
          </div>
          <div className="health-hub-highlight">
            <strong>IA como apoyo</strong>
            <span>Los documentos leídos por Klinip pueden transformarse en contexto fácil de revisar.</span>
          </div>
          <div className="health-hub-highlight">
            <strong>Familia autorizada</strong>
            <span>La cobertura se entiende mejor cuando quien cuida también tiene contexto permitido.</span>
          </div>
        </div>
        <div className="health-hub-hero-actions">
          <Link className="health-hub-hero-action" to="/documents">
            Subir documento
          </Link>
          <Link className="health-hub-hero-secondary" to="/ai">
            Preguntar a Klinip IA
          </Link>
        </div>
      </section>

      <section className="coverage-stats-grid" aria-label="Resumen de cobertura">
        <CoverageStat
          label="Documentos detectados"
          value={loading ? "..." : coverageDocuments.length}
          helper="Bonos, seguros, licencias o copagos"
        />
        <CoverageStat
          label="Leídos por IA"
          value={loading ? "..." : readCoverageDocs.length}
          helper="Listos para revisar con más contexto"
        />
        <CoverageStat
          label="Pendientes"
          value={loading ? "..." : pendingCoverageDocs.length}
          helper="Aún en lectura o clasificación"
        />
        <CoverageStat
          label="Entidades detectadas"
          value={loading ? "..." : insurerCount}
          helper="Isapre, Fonasa o seguros en documentos"
        />
      </section>

      {error ? <div className="coverage-alert">{error}</div> : null}

      <section className="health-hub-section coverage-section">
        <div className="health-hub-section-head">
          <div>
            <span className="health-hub-section-chip">Primer MVP</span>
            <h2>Documentos de cobertura encontrados</h2>
            <p>
              Esta vista detecta documentos relacionados con cobertura a partir de nombre, centro, notas y tipo de
              documento. La siguiente etapa será clasificarlos de forma dedicada.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="coverage-empty">Cargando cobertura...</div>
        ) : latestDocs.length > 0 ? (
          <div className="coverage-document-list">
            {latestDocs.map((doc) => (
              <article className="coverage-document-row" key={doc.id}>
                <span className="coverage-document-icon">
                  <CoverageIcon />
                </span>
                <div className="coverage-document-copy">
                  <h3>{cleanUiText(doc.filename, "Documento de cobertura")}</h3>
                  <p>
                    {[doc.detectedInsurer, ...doc.coverageSignals].filter(Boolean).join(" · ") ||
                      "Cobertura detectada"}
                  </p>
                  <small>
                    {formatDate(doc.date || doc.created_at)}
                    {doc.center ? ` · ${cleanUiText(doc.center)}` : ""}
                  </small>
                </div>
                <span className="coverage-document-status">{getOcrLabel(doc.ocr_status)}</span>
              </article>
            ))}
          </div>
        ) : (
          <div className="coverage-empty">
            <strong>Aún no hay documentos de cobertura detectados.</strong>
            <span>
              Sube bonos, reembolsos, licencias médicas, cartas GES/CAEC o documentos de tu plan. Si el nombre o las
              notas incluyen Isapre, Fonasa, bono, reembolso o licencia, aparecerán aquí.
            </span>
            <Link className="health-hub-hero-secondary" to="/documents">
              Ir a documentos
            </Link>
          </div>
        )}
      </section>

      <section className="health-hub-section coverage-section">
        <div className="health-hub-section-head">
          <div>
            <span className="health-hub-section-chip">Próximos pasos</span>
            <h2>Qué podrá ordenar Klinip Cobertura</h2>
          </div>
        </div>
        <div className="health-hub-support-grid coverage-next-grid">
          <article className="health-hub-card health-hub-card-teal health-hub-card-compact">
            <div className="health-hub-card-copy">
              <span className="health-hub-card-eyebrow">Plan</span>
              <strong>Isapre, Fonasa o seguro</strong>
              <span>Resumen del plan, beneficiarios y red preferente cuando exista información cargada.</span>
            </div>
          </article>
          <article className="health-hub-card health-hub-card-amber health-hub-card-compact">
            <div className="health-hub-card-copy">
              <span className="health-hub-card-eyebrow">Costos</span>
              <strong>Bonos, copagos y reembolsos</strong>
              <span>Base para explicar cuánto se pagó, cuánto se bonificó y qué falta cobrar o reclamar.</span>
            </div>
          </article>
          <article className="health-hub-card health-hub-card-lavender health-hub-card-compact">
            <div className="health-hub-card-copy">
              <span className="health-hub-card-eyebrow">Protección</span>
              <strong>GES, CAEC y licencias</strong>
              <span>Orden inicial para documentos que suelen quedar repartidos entre correos y portales.</span>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
