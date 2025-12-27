import React, { useEffect, useMemo, useState } from "react";
import { getAppointments, getDocuments, getMedications } from "../services/httpApi";
import { parseDate, toLocaleDateOrEmpty } from "../utils/dates";

const typeLabels = {
  cita: "Cita médica",
  examen: "Examen",
  tramite: "Trámite",
};

const docLabels = {
  receta: "Receta",
  orden: "Orden",
  resultado: "Resultado",
  informe: "Informe",
  otro: "Otro",
};

const statusLabels = {
  pendiente: "Pendiente",
  agendada: "Agendada",
  realizada: "Realizada"
};

export default function Timeline() {
  const [appointments, setAppointments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [medications, setMedications] = useState([]);
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [filter, setFilter] = useState("all"); // all, appointments, documents, medications
  const [searchTerm, setSearchTerm] = useState("");
  const [groupByTreatment, setGroupByTreatment] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [apptData, docData, medData] = await Promise.all([
          getAppointments(),
          getDocuments(),
          getMedications()
        ]);
        setAppointments(apptData || []);
        setDocuments(docData || []);
        setMedications(medData || []);
      } catch (err) {
        console.error("No se pudo cargar la ruta de salud", err);
      }
    }
    load();
  }, []);

  const toggleExpanded = (id) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };

  // Función para encontrar elementos relacionados
  const findRelated = (item) => {
    const related = {
      appointments: [],
      documents: [],
      medications: []
    };

    if (item.kind === "document") {
      // Buscar cita relacionada
      if (item.appointment_id) {
        const appt = appointments.find(a => a.id === item.appointment_id);
        if (appt) related.appointments.push(appt);
      }
      // Buscar medicamentos relacionados
      const relatedMeds = medications.filter(m => m.document_id === item.id);
      related.medications.push(...relatedMeds);
    }

    if (item.kind === "appointment") {
      // Buscar documentos relacionados
      const relatedDocs = documents.filter(d => d.appointment_id === item.id);
      related.documents.push(...relatedDocs);
    }

    if (item.kind === "medication") {
      // Buscar documento relacionado
      if (item.document_id) {
        const doc = documents.find(d => d.id === item.document_id);
        if (doc) {
          related.documents.push(doc);
          // Y si ese documento tiene una cita
          if (doc.appointment_id) {
            const appt = appointments.find(a => a.id === doc.appointment_id);
            if (appt) related.appointments.push(appt);
          }
        }
      }
    }

    return related;
  };

  const items = useMemo(() => {
    const apptItems = (appointments || [])
      .filter((a) => a.date_time)
      .map((a) => ({
        id: `appt-${a.id}`,
        originalId: a.id,
        date: a.date_time,
        label: typeLabels[a.type] || a.type || "Actividad",
        detail: `${a.specialty || "Sin especialidad"} · ${a.center || "Centro no definido"}`,
        notes: a.notes,
        kind: "appointment",
        status: a.status,
        type: a.type,
        specialty: a.specialty,
        center: a.center,
        checklist: a.checklist,
        appointment_id: null,
        document_id: null
      }));

    const docItems = (documents || []).map((d) => ({
      id: `doc-${d.id}`,
      originalId: d.id,
      date: d.date || d.created_at,
      label: docLabels[d.doc_type] || d.doc_type || "Documento",
      detail: d.center || "Sin centro",
      notes: d.notes,
      kind: "document",
      doc_type: d.doc_type,
      center: d.center,
      appointment_id: d.appointment_id,
      document_id: null,
      ocr_status: d.ocr_status
    }));

    const medItems = (medications || [])
      .filter((m) => m.created_at)
      .map((m) => ({
        id: `med-${m.id}`,
        originalId: m.id,
        date: m.created_at,
        label: "Medicamento",
        detail: m.name,
        notes: `${m.dose ? `Dosis: ${m.dose}` : ''}${m.frequency ? ` · ${m.frequency}` : ''}${m.duration ? ` · ${m.duration}` : ''}`,
        kind: "medication",
        name: m.name,
        dose: m.dose,
        frequency: m.frequency,
        duration: m.duration,
        end_date: m.end_date,
        appointment_id: null,
        document_id: m.document_id
      }));

    let allItems = [...apptItems, ...docItems, ...medItems]
      .filter((i) => parseDate(i.date))
      .sort((a, b) => {
        const aDate = parseDate(a.date);
        const bDate = parseDate(b.date);
        if (!aDate) return 1;
        if (!bDate) return -1;
        return bDate - aDate; // Más reciente primero
      });

    // Aplicar filtro
    if (filter !== "all") {
      if (filter === "appointments") {
        allItems = allItems.filter(i => i.kind === "appointment");
      } else if (filter === "documents") {
        allItems = allItems.filter(i => i.kind === "document");
      } else if (filter === "medications") {
        allItems = allItems.filter(i => i.kind === "medication");
      }
    }

    // Aplicar búsqueda
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      allItems = allItems.filter(i => 
        i.label.toLowerCase().includes(term) ||
        i.detail.toLowerCase().includes(term) ||
        (i.notes && i.notes.toLowerCase().includes(term)) ||
        (i.center && i.center.toLowerCase().includes(term)) ||
        (i.specialty && i.specialty.toLowerCase().includes(term))
      );
    }

    return allItems;
  }, [appointments, documents, medications, filter, searchTerm]);

  const getItemIcon = (kind) => {
    switch (kind) {
      case "appointment":
        return "📅";
      case "document":
        return "📄";
      case "medication":
        return "💊";
      default:
        return "📌";
    }
  };

  const getKindLabel = (kind) => {
    switch (kind) {
      case "appointment":
        return "Cita/Examen";
      case "document":
        return "Documento";
      case "medication":
        return "Medicamento";
      default:
        return "Evento";
    }
  };

  return (
    <>
      <div className="card">
        <h2 className="card-title">🏥 Mi Historia Clínica</h2>
        <p className="muted">
          Línea de tiempo cronológica completa de tus citas, exámenes, documentos y medicamentos. 
          Útil para seguir tratamientos y mostrar a tu médico tu historial de salud.
        </p>

        {/* Estadísticas rápidas */}
        <div className="stats-grid" style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.75rem" }}>
          <div style={{ background: "#f0f9ff", padding: "0.75rem", borderRadius: "8px", textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#0284c7" }}>
              {appointments.filter(a => a.date_time).length}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#666" }}>Citas</div>
          </div>
          <div style={{ background: "#fef3c7", padding: "0.75rem", borderRadius: "8px", textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#f59e0b" }}>
              {documents.length}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#666" }}>Documentos</div>
          </div>
          <div style={{ background: "#f0fdf4", padding: "0.75rem", borderRadius: "8px", textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#10b981" }}>
              {medications.length}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#666" }}>Medicamentos</div>
          </div>
          <div style={{ background: "#f5f3ff", padding: "0.75rem", borderRadius: "8px", textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#8b5cf6" }}>
              {items.length}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#666" }}>Total</div>
          </div>
        </div>
      </div>

      {/* Filtros y búsqueda */}
      <div className="card">
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Búsqueda */}
          <div>
            <input
              type="text"
              className="input-field"
              placeholder="🔍 Buscar en tu historia clínica..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          {/* Filtros */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              className={filter === "all" ? "primary-btn" : "secondary-btn"}
              onClick={() => setFilter("all")}
              style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
            >
              Todos ({appointments.filter(a => a.date_time).length + documents.length + medications.length})
            </button>
            <button
              className={filter === "appointments" ? "primary-btn" : "secondary-btn"}
              onClick={() => setFilter("appointments")}
              style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
            >
              📅 Citas ({appointments.filter(a => a.date_time).length})
            </button>
            <button
              className={filter === "documents" ? "primary-btn" : "secondary-btn"}
              onClick={() => setFilter("documents")}
              style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
            >
              📄 Documentos ({documents.length})
            </button>
            <button
              className={filter === "medications" ? "primary-btn" : "secondary-btn"}
              onClick={() => setFilter("medications")}
              style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
            >
              💊 Medicamentos ({medications.length})
            </button>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="card">
        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <p className="muted" style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
              {searchTerm ? "No se encontraron resultados" : "Aún no hay eventos en tu historia clínica"}
            </p>
            {searchTerm && (
              <button
                className="secondary-btn"
                onClick={() => setSearchTerm("")}
                style={{ marginTop: "1rem" }}
              >
                Limpiar búsqueda
              </button>
            )}
          </div>
        ) : (
          <ul className="timeline vertical">
            {items.map((item) => {
              const related = findRelated(item);
              const hasRelated = related.appointments.length > 0 || related.documents.length > 0 || related.medications.length > 0;
              const isExpanded = expandedItems.has(item.id);

              return (
                <li key={item.id} className="timeline-item" style={{ marginBottom: "1.5rem" }}>
                  <div style={{ background: "#f9fafb", padding: "1rem", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
                    {/* Header */}
                    <div className="timeline-main" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: "1.5rem" }}>{getItemIcon(item.kind)}</span>
                        <span className={`chip ${item.kind === "document" ? "doc" : item.kind}`}>
                          {item.label}
                        </span>
                        {item.status && (
                          <span className={`chip-status-${item.status}`}>
                            {statusLabels[item.status] || item.status}
                          </span>
                        )}
                        {hasRelated && (
                          <span style={{ 
                            background: "#e0f2fe", 
                            color: "#0369a1", 
                            padding: "0.25rem 0.5rem", 
                            borderRadius: "12px", 
                            fontSize: "0.75rem",
                            fontWeight: "600"
                          }}>
                            🔗 {related.appointments.length + related.documents.length + related.medications.length} vinculados
                          </span>
                        )}
                      </div>
                      <span className="timeline-meta" style={{ fontSize: "0.875rem", color: "#666", whiteSpace: "nowrap" }}>
                        {item.date ? toLocaleDateOrEmpty(item.date) : ""}
                      </span>
                    </div>

                    {/* Detalle */}
                    <p className="timeline-title" style={{ fontWeight: "600", marginBottom: "0.5rem", fontSize: "1rem" }}>
                      {item.detail}
                    </p>

                    {/* Notas */}
                    {item.notes && (
                      <p className="timeline-notes" style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.5rem" }}>
                        📝 {item.notes}
                      </p>
                    )}

                    {/* Botón expandir si hay elementos relacionados */}
                    {hasRelated && (
                      <button
                        className="secondary-btn"
                        onClick={() => toggleExpanded(item.id)}
                        style={{ 
                          padding: "0.5rem 0.75rem", 
                          fontSize: "0.875rem",
                          marginTop: "0.5rem",
                          width: "100%"
                        }}
                      >
                        {isExpanded ? "▼ Ocultar" : "▶ Ver"} elementos relacionados ({related.appointments.length + related.documents.length + related.medications.length})
                      </button>
                    )}

                    {/* Elementos relacionados expandidos */}
                    {isExpanded && hasRelated && (
                      <div style={{ 
                        marginTop: "1rem", 
                        paddingTop: "1rem", 
                        borderTop: "2px solid #e5e7eb",
                        background: "#ffffff",
                        padding: "1rem",
                        borderRadius: "6px"
                      }}>
                        <h4 style={{ fontSize: "0.875rem", fontWeight: "600", marginBottom: "0.75rem", color: "#374151" }}>
                          🔗 Elementos vinculados:
                        </h4>
                        
                        {/* Citas relacionadas */}
                        {related.appointments.length > 0 && (
                          <div style={{ marginBottom: "0.75rem" }}>
                            <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "#666", marginBottom: "0.25rem" }}>
                              📅 Citas:
                            </div>
                            {related.appointments.map(appt => (
                              <div key={appt.id} style={{ 
                                background: "#f0f9ff", 
                                padding: "0.5rem", 
                                borderRadius: "4px", 
                                fontSize: "0.875rem",
                                marginBottom: "0.25rem"
                              }}>
                                {appt.specialty || appt.type} · {appt.center} · {toLocaleDateOrEmpty(appt.date_time)}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Documentos relacionados */}
                        {related.documents.length > 0 && (
                          <div style={{ marginBottom: "0.75rem" }}>
                            <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "#666", marginBottom: "0.25rem" }}>
                              📄 Documentos:
                            </div>
                            {related.documents.map(doc => (
                              <div key={doc.id} style={{ 
                                background: "#fef3c7", 
                                padding: "0.5rem", 
                                borderRadius: "4px", 
                                fontSize: "0.875rem",
                                marginBottom: "0.25rem"
                              }}>
                                {docLabels[doc.doc_type] || doc.doc_type} · {doc.center || "Sin centro"} · {toLocaleDateOrEmpty(doc.date || doc.created_at)}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Medicamentos relacionados */}
                        {related.medications.length > 0 && (
                          <div>
                            <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "#666", marginBottom: "0.25rem" }}>
                              💊 Medicamentos:
                            </div>
                            {related.medications.map(med => (
                              <div key={med.id} style={{ 
                                background: "#f0fdf4", 
                                padding: "0.5rem", 
                                borderRadius: "4px", 
                                fontSize: "0.875rem",
                                marginBottom: "0.25rem"
                              }}>
                                {med.name} {med.dose ? `· ${med.dose}` : ''} {med.frequency ? `· ${med.frequency}` : ''}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
