import React, { useEffect, useMemo, useState } from "react";
import { getActiveHealthProfile, getAiLifeTimeline, getHealthProfiles } from "../api";
import { toLocaleDateOrEmpty } from "../utils/dates";
import { cleanUiText } from "../utils/textEncoding";
import { ensureArray } from "../utils/arrays";

const SUMMARY_TOKEN_LABELS = [
  [/health_alerts?/gi, "alertas de salud"],
  [/diagnostic_results?/gi, "resultados cl\u00ednicos"],
  [/external_records?/gi, "registros externos"],
  [/appointments?/gi, "citas"],
  [/documents?/gi, "documentos"],
  [/medications?/gi, "medicamentos"],
  [/treatments?/gi, "tratamientos"],
  [/results?/gi, "resultados"],
];

const typeLabels = {
  appointment: "Cita",
  document: "Documento",
  medication: "Medicamento",
  treatment: "Tratamiento",
  diagnostic_result: "Resultado",
  external_record: "Registro externo",
  health_alert: "Alerta",
};

const filterMap = {
  all: null,
  appointments: "appointment",
  documents: "document",
  medications: "medication",
  treatments: "treatment",
  results: "diagnostic_result",
};

function getTimelineIcon(eventType) {
  if (eventType === "appointment") return "\u{1F4C5}";
  if (eventType === "document") return "\u{1F4C4}";
  if (eventType === "medication" || eventType === "treatment") return "\u{1F48A}";
  if (eventType === "diagnostic_result") return "\u{1F9EA}";
  if (eventType === "external_record") return "\u{1F517}";
  if (eventType === "health_alert") return "\u26A0\uFE0F";
  return "\u{1F4CC}";
}
function humanizeTimelineSummary(summary) {
  let text = cleanUiText(summary, "");
  if (!text) return { lead: "", detail: "", highlights: [] };

  SUMMARY_TOKEN_LABELS.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  text = text
    .replace(/\bEvolucion\b/g, "Evoluci\u00f3n")
    .replace(/\bclinicos\b/g, "cl\u00ednicos")
    .replace(/\bUltimos\b/g, "\u00daltimos")
    .replace(/\bmedica\b/g, "m\u00e9dica")
    .replace(/\bcronologico\b/g, "cronol\u00f3gico");

  const [leadPart = "", detailPart = ""] = text.split(/\u00daltimos hitos:\s*/i);
  const lead = leadPart.trim().replace(/\s+/g, " ");
  const highlights = detailPart
    .split(/\s*,\s*/)
    .map((item) => cleanUiText(item))
    .filter(Boolean)
    .slice(0, 4);

  const leadSentences = lead
    .split(/(?<=\.)\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    lead: leadSentences[0] || lead,
    detail: leadSentences.slice(1).join(" "),
    highlights,
  };
}

export default function Timeline() {
  const [profiles, setProfiles] = useState([]);
  const [timeline, setTimeline] = useState({ summary: "", events: [], event_count: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("active");
  const [periodDays, setPeriodDays] = useState("365");
  const [includeFamily, setIncludeFamily] = useState(false);

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
        setProfiles(ensureArray(profilesData));
        const resolvedProfileId = selectedProfileId === "active" ? activeProfile?.id : Number(selectedProfileId);
        const response = await getAiLifeTimeline({
          profile_id: resolvedProfileId || undefined,
          days: Number(periodDays) || 365,
          include_family: includeFamily,
        }).catch(() => ({ summary: "", events: [], event_count: 0 }));
        if (cancelled) return;
        setTimeline(response || { summary: "", events: [], event_count: 0 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedProfileId, periodDays, includeFamily]);

  const events = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return ensureArray(timeline.events).filter((item) => {
      const matchesType = !filterMap[filter] || item.event_type === filterMap[filter];
      const haystack = [
        cleanUiText(item.title),
        cleanUiText(item.summary),
        cleanUiText(item.category),
        cleanUiText(item.profile_name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !search || haystack.includes(search);
      return matchesType && matchesSearch;
    });
  }, [timeline.events, filter, searchTerm]);

  const stats = useMemo(() => {
    const base = { appointments: 0, documents: 0, medications: 0, total: events.length };
    events.forEach((item) => {
      if (item.event_type === "appointment") base.appointments += 1;
      if (item.event_type === "document" || item.event_type === "diagnostic_result") base.documents += 1;
      if (item.event_type === "medication" || item.event_type === "treatment") base.medications += 1;
    });
    return base;
  }, [events]);

  const summaryView = useMemo(
    () => humanizeTimelineSummary(timeline.summary || ""),
    [timeline.summary]
  );

  return (
    <>
      <div className="card timeline-overview-card">
        <h2 className="card-title">{"Mi Historia Clínica"}</h2>
        <p className="muted">
          {
            "Línea de vida médica construida desde tu contexto clínico real. Resume citas, documentos, tratamientos, resultados y eventos relevantes en orden cronológico."
          }
        </p>
        <div className="timeline-ai-summary">
          {summaryView.lead ? (
            <>
              <p className="timeline-ai-summary-lead">{summaryView.lead}</p>
              {summaryView.detail ? <p className="timeline-ai-summary-detail">{summaryView.detail}</p> : null}
              {summaryView.highlights.length ? (
                <div className="timeline-ai-summary-highlights">
                  {summaryView.highlights.map((item) => (
                    <span key={item} className="timeline-ai-summary-pill">
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="timeline-ai-summary-lead">{"Cargando resumen evolutivo..."}</p>
          )}
        </div>
        <div className="timeline-stats">
          <div className="timeline-stat-card is-appointments">
            <div className="timeline-stat-number">{stats.appointments}</div>
            <div className="timeline-stat-label">Citas</div>
          </div>
          <div className="timeline-stat-card is-documents">
            <div className="timeline-stat-number">{stats.documents}</div>
            <div className="timeline-stat-label">Documentos</div>
          </div>
          <div className="timeline-stat-card is-medications">
            <div className="timeline-stat-number">{stats.medications}</div>
            <div className="timeline-stat-label">Tratamientos</div>
          </div>
          <div className="timeline-stat-card is-total">
            <div className="timeline-stat-number">{timeline.event_count || 0}</div>
            <div className="timeline-stat-label">Total</div>
          </div>
        </div>
      </div>

      <div className="card timeline-filters-card">
        <div className="timeline-filters-shell">
          <div className="timeline-advanced-filters">
            <div className="input-group">
              <label className="input-label">Perfil</label>
              <select className="input-field" value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
                <option value="active">Perfil activo</option>
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {cleanUiText(item.full_name, `Perfil ${item.id}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">{"Período"}</label>
              <select className="input-field" value={periodDays} onChange={(e) => setPeriodDays(e.target.value)}>
                <option value="30">30 días</option>
                <option value="90">90 días</option>
                <option value="180">180 días</option>
                <option value="365">12 meses</option>
              </select>
            </div>
            <label className="timeline-family-toggle">
              <input type="checkbox" checked={includeFamily} onChange={(e) => setIncludeFamily(e.target.checked)} />
              <span>Incluir familia</span>
            </label>
          </div>

          <div>
            <input
              type="text"
              className="input-field timeline-search-input"
              placeholder={"Buscar en la línea de vida médica..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="timeline-filter-row">
            <button className={`${filter === "all" ? "primary-btn" : "secondary-btn"} timeline-filter-btn`} onClick={() => setFilter("all")}>
              Todos ({events.length})
            </button>
            <button className={`${filter === "appointments" ? "primary-btn" : "secondary-btn"} timeline-filter-btn`} onClick={() => setFilter("appointments")}>
              Citas
            </button>
            <button className={`${filter === "documents" ? "primary-btn" : "secondary-btn"} timeline-filter-btn`} onClick={() => setFilter("documents")}>
              Documentos
            </button>
            <button className={`${filter === "medications" ? "primary-btn" : "secondary-btn"} timeline-filter-btn`} onClick={() => setFilter("medications")}>
              Medicamentos
            </button>
            <button className={`${filter === "results" ? "primary-btn" : "secondary-btn"} timeline-filter-btn`} onClick={() => setFilter("results")}>
              Resultados
            </button>
          </div>
        </div>
      </div>

      <div className="card timeline-list-card">
        {loading ? (
          <div className="home-empty-state">{"Cargando línea de vida médica..."}</div>
        ) : events.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <p className="muted" style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
              {searchTerm ? "No se encontraron resultados" : "Aún no hay eventos en tu línea de vida médica"}
            </p>
          </div>
        ) : (
          <ul className="timeline vertical">
            {events.map((item) => (
              <li key={item.id} className={`timeline-item type-${item.event_type}`}>
                <span className="timeline-node">{getTimelineIcon(item.event_type)}</span>
                <div className="timeline-card">
                  <div className="timeline-main">
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                      <span className={`chip ${item.event_type === "document" ? "doc" : item.event_type}`}>
                        {typeLabels[item.event_type] || cleanUiText(item.event_type, "Evento")}
                      </span>
                      {includeFamily ? (
                        <span className="timeline-related-pill">
                          {cleanUiText(item.profile_name, "Perfil relacionado")}
                        </span>
                      ) : null}
                    </div>
                    <span className="timeline-meta">{item.event_at ? toLocaleDateOrEmpty(item.event_at) : ""}</span>
                  </div>
                  <p className="timeline-title">{cleanUiText(item.title, "Evento clínico")}</p>
                  {item.summary ? (
                    <p className="timeline-notes">{cleanUiText(item.summary)}</p>
                  ) : null}
                  {item.category ? (
                    <div className="timeline-related-panel">
                      <div className="timeline-related-title">Categoría</div>
                      <div className="timeline-related-item is-document">{cleanUiText(item.category)}</div>
                      {item.metadata_json?.status ? (
                        <div className="timeline-related-item is-appointment">
                          Estado: {cleanUiText(item.metadata_json.status)}
                        </div>
                      ) : null}
                      {item.metadata_json?.filename ? (
                        <div className="timeline-related-item is-medication">
                          Archivo: {cleanUiText(item.metadata_json.filename)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
