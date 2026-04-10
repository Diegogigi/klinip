import React from "react";
import { Link } from "react-router-dom";

const healthSections = [
  {
    to: "/timeline",
    eyebrow: "Historia clínica",
    title: "Historia clínica",
    text: "Eventos, diagnósticos y tratamientos",
    tone: "blue",
    icon: "history",
  },
  {
    to: "/documents",
    eyebrow: "Documentos médicos",
    title: "Documentos",
    text: "Tus exámenes y archivos importantes",
    tone: "teal",
    icon: "documents",
  },
  {
    to: "/medications",
    eyebrow: "Tratamientos",
    title: "Medicamentos",
    text: "Dosis, horarios y alertas",
    tone: "lavender",
    icon: "medications",
  },
  {
    to: "/clinical-reports",
    eyebrow: "Resumen clínico",
    title: "Reportes",
    text: "Resúmenes clínicos claros",
    tone: "amber",
    icon: "reports",
  },
];

const supportSections = [
  {
    to: "/appointments",
    title: "Citas",
    text: "Controles y exámenes próximos.",
  },
  {
    to: "/calendar",
    title: "Calendario",
    text: "Tu salud por día y por mes.",
  },
  {
    to: "/stats",
    title: "Estadísticas",
    text: "Indicadores generales de seguimiento.",
  },
];

function HealthHubCard({ item, compact = false }) {
  const className = [
    "health-hub-card",
    compact ? "health-hub-card-compact" : "",
    item.tone ? `health-hub-card-${item.tone}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link className={className} to={item.to}>
      {item.icon ? <span className="health-hub-card-visual">{renderHealthIcon(item.icon)}</span> : null}
      <span className="health-hub-card-copy">
        {item.eyebrow ? <span className="health-hub-card-eyebrow">{item.eyebrow}</span> : null}
        <strong>{item.title}</strong>
        <span>{item.text}</span>
      </span>
    </Link>
  );
}

function renderHealthIcon(icon) {
  const commonProps = {
    viewBox: "0 0 64 64",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
  };

  if (icon === "history") {
    return (
      <svg {...commonProps}>
        <circle cx="25" cy="25" r="16" fill="currentColor" opacity="0.18" />
        <circle cx="25" cy="25" r="13" stroke="currentColor" strokeWidth="4" />
        <path d="M25 16v10l8 5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 42h9l5-8 7 16 6-10h19" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (icon === "documents") {
    return (
      <svg {...commonProps}>
        <path d="M12 23h40v27a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V23Z" fill="currentColor" opacity="0.16" />
        <path d="M12 23h40v27a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V23Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
        <path d="M20 23v-7a4 4 0 0 1 4-4h12l8 8v3" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
        <path d="M29 34v14M22 41h14" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === "medications") {
    return (
      <svg {...commonProps}>
        <rect x="12" y="28" width="20" height="24" rx="5" fill="currentColor" opacity="0.18" />
        <rect x="12" y="28" width="20" height="24" rx="5" stroke="currentColor" strokeWidth="4" />
        <path d="M16 20h12v8H16z" fill="currentColor" opacity="0.28" />
        <path d="M16 20h12v8H16z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
        <path d="M35 33 49 47M49 33 35 47" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M16 12h26l8 8v32H16V12Z" fill="currentColor" opacity="0.16" />
      <path d="M16 12h26l8 8v32H16V12Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M42 12v10h10" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M24 42V30M34 42V25M44 42V34" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M22 46h24" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export default function MiSalud() {
  return (
    <div className="health-hub-page">
      <header className="health-hub-native-header" aria-label="Encabezado de Mi salud">
        <Link className="health-hub-native-icon" to="/" aria-label="Volver a Inicio">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <h1>Mi salud</h1>
        <Link className="health-hub-native-icon" to="/settings" aria-label="Abrir notificaciones">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </Link>
      </header>

      <section className="health-hub-hero" aria-labelledby="health-hub-title">
        <div>
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
