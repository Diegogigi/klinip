import React, { useEffect, useMemo, useState } from "react";
import { getActiveHealthProfile, getAiLifeTimeline, getHealthProfiles } from "../api";
import { toLocaleDateOrEmpty } from "../utils/dates";

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
  if (eventType === "appointment") return "📅";
  if (eventType === "document") return "📄";
  if (eventType === "medication" || eventType === "treatment") return "💊";
  if (eventType === "diagnostic_result") return "🧪";
  if (eventType === "external_record") return "🔗";
  if (eventType === "health_alert") return "⚠️";
  return "📌";
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
        setProfiles(Array.isArray(profilesData) ? profilesData : []);
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
    return (Array.isArray(timeline.events) ? timeline.events : []).filter((item) => {
      const matchesType = !filterMap[filter] || item.event_type === filterMap[filter];
      const haystack = [
        item.title,
        item.summary,
        item.category,
        item.profile_name,
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

  return (
    <>
      <div className="card timeline-overview-card">
        <h2 className="card-title">Mi Historia Clinica</h2>
        <p className="muted">
          Linea de vida medica construida desde tu contexto clinico real. Resume citas, documentos, tratamientos,
          resultados y eventos relevantes en orden cronologico.
        </p>
        <p className="timeline-ai-summary">{timeline.summary || "Cargando resumen evolutivo..."}</p>
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
                    {item.full_name || `Perfil ${item.id}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Periodo</label>
              <select className="input-field" value={periodDays} onChange={(e) => setPeriodDays(e.target.value)}>
                <option value="30">30 dias</option>
                <option value="90">90 dias</option>
                <option value="180">180 dias</option>
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
              placeholder="Buscar en la linea de vida medica..."
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
          <div className="home-empty-state">Cargando linea de vida medica...</div>
        ) : events.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <p className="muted" style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
              {searchTerm ? "No se encontraron resultados" : "Aun no hay eventos en tu linea de vida medica"}
            </p>
          </div>
        ) : (
          <ul className="timeline vertical">
            {events.map((item) => (
              <li key={item.id} className="timeline-item">
                <div className="timeline-main" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: "1.4rem" }}>{getTimelineIcon(item.event_type)}</span>
                    <span className={`chip ${item.event_type === "document" ? "doc" : item.event_type}`}>
                      {typeLabels[item.event_type] || item.event_type}
                    </span>
                    {includeFamily ? <span className="timeline-related-pill">{item.profile_name}</span> : null}
                  </div>
                  <span className="timeline-meta" style={{ fontSize: "0.875rem", whiteSpace: "nowrap" }}>
                    {item.event_at ? toLocaleDateOrEmpty(item.event_at) : ""}
                  </span>
                </div>
                <p className="timeline-title" style={{ fontWeight: "600", marginBottom: "0.5rem", fontSize: "1rem" }}>
                  {item.title}
                </p>
                {item.summary ? (
                  <p className="timeline-notes" style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                    {item.summary}
                  </p>
                ) : null}
                {item.category ? (
                  <div className="timeline-related-panel">
                    <div className="timeline-related-title">Categoria</div>
                    <div className="timeline-related-item is-document">{item.category}</div>
                    {item.metadata_json?.status ? (
                      <div className="timeline-related-item is-appointment">
                        Estado: {item.metadata_json.status}
                      </div>
                    ) : null}
                    {item.metadata_json?.filename ? (
                      <div className="timeline-related-item is-medication">
                        Archivo: {item.metadata_json.filename}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
