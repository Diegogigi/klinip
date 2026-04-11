import React from "react";
import { Link } from "react-router-dom";

const healthQuickCards = [
  {
    to: "/appointments",
    title: "Citas",
    highlight: "AGENDA ACTIVA",
    subtitle: "Proximos controles",
    tone: "blue",
    icon: "appointments",
  },
  {
    to: "/documents",
    title: "Documentos",
    highlight: "ARCHIVO CLINICO",
    subtitle: "Examenes y recetas",
    tone: "teal",
    icon: "documents",
  },
  {
    to: "/timeline",
    title: "Historia clinica",
    highlight: "LINEA DE TIEMPO",
    subtitle: "Eventos y diagnosticos",
    tone: "sky",
    icon: "history",
  },
  {
    to: "/medications",
    title: "Medicamentos",
    highlight: "TRATAMIENTO",
    subtitle: "Dosis y alertas",
    tone: "amber",
    icon: "medications",
  },
  {
    to: "/clinical-reports",
    title: "Reportes",
    highlight: "IA CLINICA",
    subtitle: "Resumen para control",
    tone: "violet",
    icon: "reports",
  },
  {
    to: "/calendar",
    title: "Calendario",
    highlight: "PLAN DEL MES",
    subtitle: "Orden diario",
    tone: "green",
    icon: "calendar",
  },
  {
    to: "/stats",
    title: "Indicadores",
    highlight: "SEGUIMIENTO",
    subtitle: "Metricas clave",
    tone: "blue",
    icon: "stats",
  },
];

function HealthQuickCard({ item }) {
  return (
    <Link className={`health-hub-quick-card tone-${item.tone}`} to={item.to} aria-label={`${item.title}. ${item.subtitle}`}>
      <span className="health-hub-quick-icon">{renderHealthIcon(item.icon)}</span>
      <strong className="health-hub-quick-title">{item.title}</strong>
      <span className="health-hub-quick-highlight">{item.highlight}</span>
      <span className="health-hub-quick-subtitle">{item.subtitle}</span>
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

  if (icon === "appointments") {
    return (
      <svg {...commonProps}>
        <rect x="11" y="14" width="42" height="38" rx="8" fill="currentColor" opacity="0.16" />
        <rect x="11" y="14" width="42" height="38" rx="8" stroke="currentColor" strokeWidth="4" />
        <path d="M21 10v10M43 10v10M11 26h42" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <path d="M24 36h8M32 36h8M24 44h20" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === "calendar") {
    return (
      <svg {...commonProps}>
        <rect x="12" y="14" width="40" height="38" rx="8" fill="currentColor" opacity="0.16" />
        <rect x="12" y="14" width="40" height="38" rx="8" stroke="currentColor" strokeWidth="4" />
        <path d="M20 10v8M44 10v8M12 24h40" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <path d="M24 32h8v8h-8z" fill="currentColor" opacity="0.26" />
        <path d="M24 32h8v8h-8z" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
        <path d="M38 34h6M38 42h6M18 42h6" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === "stats") {
    return (
      <svg {...commonProps}>
        <path d="M14 50h36" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <path d="M18 44V30" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        <path d="M32 44V22" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        <path d="M46 44V16" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        <circle cx="18" cy="24" r="4" fill="currentColor" opacity="0.18" />
        <circle cx="32" cy="18" r="4" fill="currentColor" opacity="0.24" />
        <circle cx="46" cy="12" r="4" fill="currentColor" opacity="0.28" />
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
    <div className="health-hub-page health-hub-page-quick">
      <header className="health-hub-native-header" aria-label="Encabezado de Mi salud">
        <Link className="health-hub-native-icon" to="/" aria-label="Volver a Inicio">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <h1>Mi salud</h1>
        <Link className="health-hub-native-icon" to="/settings" aria-label="Abrir ajustes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v3" />
            <path d="M12 18v3" />
            <path d="M3 12h3" />
            <path d="M18 12h3" />
            <path d="m5.64 5.64 2.12 2.12" />
            <path d="m16.24 16.24 2.12 2.12" />
            <path d="m5.64 18.36 2.12-2.12" />
            <path d="m16.24 7.76 2.12-2.12" />
            <circle cx="12" cy="12" r="3.2" />
          </svg>
        </Link>
      </header>

      <section className="health-hub-quick-shell" aria-labelledby="health-hub-quick-title">
        <div className="health-hub-quick-head">
          <div>
            <span className="health-hub-quick-kicker">Mi salud</span>
            <h2 id="health-hub-quick-title">Acceso rapido</h2>
          </div>
          <span className="health-hub-quick-count">{healthQuickCards.length} modulos</span>
        </div>

        <div className="health-hub-quick-grid" role="list" aria-label="Accesos rapidos de salud">
          {healthQuickCards.map((item) => (
            <HealthQuickCard key={item.to} item={item} />
          ))}
        </div>
      </section>
    </div>
  );
}
