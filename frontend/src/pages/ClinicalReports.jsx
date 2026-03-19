import React, { useEffect, useMemo, useState } from "react";
import {
  generateAiClinicalReport,
  getActiveHealthProfile,
  getAiAdherence,
  getAiClinicalReportPdf,
  getAiClinicalReports,
  getAiHealthRadar,
  getHealthProfiles,
} from "../api";
import { parseDate } from "../utils/dates";

function formatStamp(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatTypeLabel(value) {
  if (!value) return "Reporte clínico";
  return String(value)
    .split("_")
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(" ");
}

function getPeriodCutoff(periodKey) {
  if (periodKey === "all") return null;
  const days = Number(periodKey);
  if (!Number.isFinite(days) || days <= 0) return null;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

const REPORT_TYPES = [
  {
    type: "consulta_medica",
    title: "Consulta médica",
    description: "Resumen para llevar a una consulta con medicamentos, adherencia, citas y eventos relevantes.",
    periodDays: 30,
  },
  {
    type: "seguimiento_tratamiento",
    title: "Seguimiento de tratamiento",
    description: "Enfoque en cumplimiento, brechas de adherencia y continuidad de medicamentos.",
    periodDays: 30,
  },
  {
    type: "resumen_mensual",
    title: "Resumen mensual",
    description: "Vista general del último mes con citas, documentos, resultados y alertas detectadas.",
    periodDays: 30,
  },
];

const PERIOD_OPTIONS = [
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "180", label: "Últimos 180 días" },
  { value: "all", label: "Todo el historial" },
];

export default function ClinicalReports() {
  const [loading, setLoading] = useState(true);
  const [creatingType, setCreatingType] = useState("");
  const [reports, setReports] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [profile, setProfile] = useState(null);
  const [adherence, setAdherence] = useState({});
  const [radar, setRadar] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState("active");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedPeriod, setSelectedPeriod] = useState("30");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [activeProfile, profilesData] = await Promise.all([
          getActiveHealthProfile().catch(() => null),
          getHealthProfiles().catch(() => []),
        ]);
        if (cancelled) return;

        const availableProfiles = Array.isArray(profilesData) ? profilesData : [];
        setProfiles(availableProfiles);

        const resolvedProfileId =
          selectedProfileId === "active" ? activeProfile?.id : Number(selectedProfileId);

        const [reportsData, adherenceData, radarData] = await Promise.all([
          getAiClinicalReports(resolvedProfileId || undefined).catch(() => []),
          getAiAdherence(resolvedProfileId || undefined).catch(() => ({})),
          getAiHealthRadar(resolvedProfileId || undefined).catch(() => []),
        ]);
        if (cancelled) return;

        const currentProfile =
          selectedProfileId === "active"
            ? activeProfile || null
            : availableProfiles.find((item) => Number(item.id) === Number(selectedProfileId)) || activeProfile || null;

        setProfile(currentProfile);
        setReports(Array.isArray(reportsData) ? reportsData : []);
        setAdherence(adherenceData || {});
        setRadar(Array.isArray(radarData) ? radarData : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [selectedProfileId]);

  const activeAlerts = useMemo(
    () => (Array.isArray(radar) ? radar.filter((item) => item.status === "active") : []),
    [radar]
  );

  const filteredReports = useMemo(() => {
    const cutoff = getPeriodCutoff(selectedPeriod);
    return (Array.isArray(reports) ? reports : []).filter((report) => {
      const matchesType = selectedType === "all" || report.report_type === selectedType;
      if (!matchesType) return false;
      if (!cutoff) return true;
      const reportDate = parseDate(report.created_at);
      return reportDate ? reportDate >= cutoff : false;
    });
  }, [reports, selectedPeriod, selectedType]);

  const latestReport = filteredReports[0] || null;
  const adherenceValue =
    adherence?.overall_adherence_rate === null || adherence?.overall_adherence_rate === undefined
      ? null
      : Math.round(Number(adherence.overall_adherence_rate) || 0);

  const handleGenerate = async (reportType, fallbackPeriodDays) => {
    if (creatingType) return;
    setCreatingType(reportType);
    try {
      const targetProfileId = selectedProfileId === "active" ? profile?.id : Number(selectedProfileId);
      const numericPeriod = Number(selectedPeriod);
      const report = await generateAiClinicalReport(
        {
          report_type: reportType,
          period_days: Number.isFinite(numericPeriod) ? numericPeriod : fallbackPeriodDays,
        },
        targetProfileId || undefined
      );
      setReports((prev) => [report, ...prev.filter((item) => item.id !== report.id)]);
    } catch (error) {
      console.error("No se pudo generar el reporte clinico", error);
    } finally {
      setCreatingType("");
    }
  };

  const handleDownload = async (report) => {
    try {
      const blob = await getAiClinicalReportPdf(report.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = report.pdf_filename || `klinip-reporte-${report.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("No se pudo descargar el reporte", error);
    }
  };

  return (
    <section className="clinical-reports-page">
      <div className="clinical-reports-hero">
        <div>
          <h2 className="card-title">Reportes clinicos</h2>
          <p className="muted">
            Genera PDFs estructurados con contexto real por perfil, periodo y tipo de seguimiento.
          </p>
        </div>
        <div className="clinical-reports-hero-summary">
          <div className="clinical-summary-chip">
            <span>Perfil</span>
            <strong>{profile?.full_name || "Sin perfil"}</strong>
          </div>
          <div className="clinical-summary-chip">
            <span>Adherencia</span>
            <strong>{adherenceValue !== null ? `${adherenceValue}%` : "Sin datos"}</strong>
          </div>
          <div className="clinical-summary-chip">
            <span>Alertas activas</span>
            <strong>{activeAlerts.length}</strong>
          </div>
        </div>
      </div>

      <div className="card clinical-reports-filters-card">
        <div className="clinical-reports-filter-grid">
          <div className="input-group">
            <label className="input-label">Perfil</label>
            <select
              className="input-field"
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
            >
              <option value="active">Perfil activo actual</option>
              {profiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name || `Perfil ${item.id}`}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Tipo de reporte</label>
            <select
              className="input-field"
              value={selectedType}
              onChange={(event) => setSelectedType(event.target.value)}
            >
              <option value="all">Todos</option>
              {REPORT_TYPES.map((item) => (
                <option key={item.type} value={item.type}>
                  {item.title}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Periodo</label>
            <select
              className="input-field"
              value={selectedPeriod}
              onChange={(event) => setSelectedPeriod(event.target.value)}
            >
              {PERIOD_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="clinical-report-grid">
        {REPORT_TYPES.map((item) => (
          <article key={item.type} className="clinical-report-card">
            <div className="clinical-report-card-copy">
              <strong>{item.title}</strong>
              <p>{item.description}</p>
              <span>
                Generacion actual:{" "}
                {selectedPeriod === "all" ? `Base ${item.periodDays} dias` : `${selectedPeriod} dias`}
              </span>
            </div>
            <button
              type="button"
              className="primary-btn"
              onClick={() => handleGenerate(item.type, item.periodDays)}
              disabled={creatingType === item.type}
            >
              {creatingType === item.type ? "Generando..." : "Generar"}
            </button>
          </article>
        ))}
      </div>

      <div className="card clinical-reports-list-card">
        <div className="clinical-reports-list-head">
          <div>
            <h3 className="card-title">Reportes generados</h3>
            <p className="muted">
              Historial filtrado por tipo, periodo y perfil. El PDF conserva la fuente exacta del perfil consultado.
            </p>
          </div>
          {latestReport ? (
            <button type="button" className="secondary-btn" onClick={() => handleDownload(latestReport)}>
              Descargar ultimo PDF
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="home-empty-state">Cargando reportes clinicos...</div>
        ) : filteredReports.length ? (
          <div className="clinical-report-list">
            {filteredReports.map((report) => (
              <article key={report.id} className="clinical-report-row">
                <div className="clinical-report-row-copy">
                  <strong>{formatTypeLabel(report.report_type)}</strong>
                  <span>{formatStamp(report.created_at)}</span>
                </div>
                <div className="clinical-report-row-actions">
                  <span className="clinical-report-tag">
                    {report.report_json?.alerts?.length || 0} alertas
                  </span>
                  <button type="button" className="secondary-btn" onClick={() => handleDownload(report)}>
                    Descargar PDF
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="home-empty-state">
            No hay reportes que coincidan con los filtros actuales.
          </div>
        )}
      </div>
    </section>
  );
}
