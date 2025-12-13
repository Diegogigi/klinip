import React, { useEffect, useMemo, useState } from "react";
import { getAppointments, getDocuments } from "../api";

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

export default function Timeline() {
  const [appointments, setAppointments] = useState([]);
  const [documents, setDocuments] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const [apptData, docData] = await Promise.all([getAppointments(), getDocuments()]);
        setAppointments(apptData || []);
        setDocuments(docData || []);
      } catch (err) {
        console.error("No se pudo cargar la ruta de salud", err);
      }
    }
    load();
  }, []);

  const items = useMemo(() => {
    const apptItems = (appointments || [])
      .filter((a) => a.date_time)
      .map((a) => ({
        date: a.date_time,
        label: typeLabels[a.type] || a.type || "Actividad",
        detail: `${a.specialty || "Sin especialidad"} · ${a.center || "Centro no definido"}`,
        notes: a.notes,
        kind: "appointment",
        status: a.status,
      }));

    const docItems = (documents || []).map((d) => ({
      date: d.date || d.created_at,
      label: docLabels[d.doc_type] || d.doc_type || "Documento",
      detail: d.center || "Sin centro",
      notes: d.notes,
      kind: "document",
    }));

    return [...apptItems, ...docItems]
      .filter((i) => i.date)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [appointments, documents]);

  return (
    <>
      <div className="card">
        <h2 className="card-title">Mi ruta de salud</h2>
        <p className="muted">
          Línea de tiempo cronológica de tus citas, exámenes, trámites y documentos. Útil para
          mostrar a tu médico lo que ha pasado y lo que viene.
        </p>
      </div>

      <div className="card">
        {items.length === 0 ? (
          <p className="muted">Aún no hay eventos en tu ruta de salud.</p>
        ) : (
          <ul className="timeline vertical">
            {items.map((item, idx) => (
              <li key={`${item.date}-${idx}`} className="timeline-item">
                <div className="timeline-main">
                  <span className={`chip ${item.kind === "document" ? "doc" : item.kind}`}>
                    {item.label}
                  </span>
                  {item.status && (
                    <span className={`chip-status-${item.status}`}>{item.status}</span>
                  )}
                </div>
                <p className="timeline-title">
                  {item.detail}
                </p>
                <p className="timeline-meta">
                  {item.date ? new Date(item.date).toLocaleDateString() : ""}
                </p>
                {item.notes && <p className="timeline-notes">Notas: {item.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
