import React from "react";
import { Link } from "react-router-dom";

const healthSections = [
  {
    to: "/timeline",
    eyebrow: "Historia clínica",
    title: "Mi historia",
    text: "Consulta eventos, diagnósticos, tratamientos y relaciones entre registros.",
  },
  {
    to: "/documents",
    eyebrow: "Documentos médicos",
    title: "Documentos",
    text: "Guarda exámenes, recetas, informes y archivos importantes.",
  },
  {
    to: "/medications",
    eyebrow: "Tratamientos",
    title: "Medicamentos",
    text: "Revisa dosis, horarios, adherencia y compras asociadas.",
  },
  {
    to: "/clinical-reports",
    eyebrow: "Resumen clínico",
    title: "Reportes",
    text: "Genera reportes claros para revisar o compartir con profesionales.",
  },
];

const supportSections = [
  {
    to: "/appointments",
    title: "Citas y exámenes",
    text: "Agenda controles, trámites y actividades médicas.",
  },
  {
    to: "/calendar",
    title: "Calendario",
    text: "Ve tus actividades de salud por día y por mes.",
  },
  {
    to: "/stats",
    title: "Estadísticas",
    text: "Revisa indicadores generales sin perder el foco en lo importante.",
  },
];

function HealthHubCard({ item, compact = false }) {
  return (
    <Link className={`health-hub-card${compact ? " health-hub-card-compact" : ""}`} to={item.to}>
      {item.eyebrow ? <span className="health-hub-card-eyebrow">{item.eyebrow}</span> : null}
      <strong>{item.title}</strong>
      <span>{item.text}</span>
    </Link>
  );
}

export default function MiSalud() {
  return (
    <div className="health-hub-page">
      <section className="health-hub-hero" aria-labelledby="health-hub-title">
        <div>
          <p className="health-hub-kicker">Mi salud</p>
          <h1 id="health-hub-title">Toda tu información de salud, ordenada</h1>
          <p>
            Encuentra tu historia clínica, documentos, medicamentos y reportes en un solo lugar.
          </p>
        </div>
        <Link className="health-hub-hero-action" to="/timeline">
          Ver historia clínica
        </Link>
      </section>

      <section className="health-hub-section" aria-labelledby="health-hub-main-title">
        <div className="health-hub-section-head">
          <h2 id="health-hub-main-title">Información principal</h2>
          <p>Lo que ayuda a entender tu salud y tus cuidados.</p>
        </div>
        <div className="health-hub-grid">
          {healthSections.map((item) => (
            <HealthHubCard key={item.to} item={item} />
          ))}
        </div>
      </section>

      <section className="health-hub-section" aria-labelledby="health-hub-support-title">
        <div className="health-hub-section-head">
          <h2 id="health-hub-support-title">Agenda y seguimiento</h2>
          <p>Accesos secundarios que siguen disponibles sin saturar la navegación principal.</p>
        </div>
        <div className="health-hub-support-grid">
          {supportSections.map((item) => (
            <HealthHubCard key={item.to} item={item} compact />
          ))}
        </div>
      </section>
    </div>
  );
}
