import React from "react";
import { Link } from "react-router-dom";

const heroHighlights = [
  {
    label: "Historia clínica",
    text: "Todo en un solo recorrido.",
  },
  {
    label: "Documentos",
    text: "Exámenes y archivos a mano.",
  },
  {
    label: "Seguimiento",
    text: "Citas y medicamentos visibles.",
  },
];

const healthSections = [
  {
    to: "/timeline",
    eyebrow: "Panel clínico",
    badge: "Prioridad",
    title: "Historia clínica",
    text: "Eventos, diagnósticos y tratamientos clave.",
    meta: "Ve tu evolución",
    tone: "blue",
    icon: "history",
  },
  {
    to: "/documents",
    eyebrow: "Archivos médicos",
    badge: "Exámenes",
    title: "Documentos",
    text: "Exámenes, recetas y archivos en un solo lugar.",
    meta: "Acceso rápido",
    tone: "teal",
    icon: "documents",
  },
  {
    to: "/medications",
    eyebrow: "Tratamientos activos",
    badge: "Alertas",
    title: "Medicamentos",
    text: "Dosis y recordatorios del tratamiento activo.",
    meta: "Evita olvidos",
    tone: "rose",
    icon: "medications",
  },
  {
    to: "/clinical-reports",
    eyebrow: "Vista resumida",
    badge: "IA clínica",
    title: "Reportes",
    text: "Resúmenes clínicos listos para compartir.",
    meta: "Útiles en control",
    tone: "amber",
    icon: "reports",
  },
];

const supportSections = [
  {
    to: "/appointments",
    eyebrow: "Próximos pasos",
    badge: "Agenda",
    title: "Citas",
    text: "Tus próximos controles y exámenes.",
    meta: "Fechas a la vista",
    tone: "blue",
    icon: "appointments",
  },
  {
    to: "/calendar",
    eyebrow: "Vista temporal",
    badge: "Planificación",
    title: "Calendario",
    text: "Ordena tu salud por día o por mes.",
    meta: "Organiza seguimientos",
    tone: "teal",
    icon: "calendar",
  },
  {
    to: "/stats",
    eyebrow: "Lectura rápida",
    badge: "Indicadores",
    title: "Estadísticas",
    text: "Métricas simples para seguir tu progreso.",
    meta: "Lectura rápida",
    tone: "lavender",
    icon: "stats",
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
    <Link className={className} to={item.to} aria-label={`${item.title}. ${item.text}`}>
      <span className="health-hub-card-top">
        {item.icon ? <span className="health-hub-card-visual">{renderHealthIcon(item.icon)}</span> : null}
        {item.badge ? <span className="health-hub-card-badge">{item.badge}</span> : null}
      </span>

      <span className="health-hub-card-copy">
        {item.eyebrow ? <span className="health-hub-card-eyebrow">{item.eyebrow}</span> : null}
        <strong>{item.title}</strong>
        <span>{item.text}</span>
      </span>

      <span className="health-hub-card-footer">
        <span className="health-hub-card-meta">{item.meta}</span>
        <span className="health-hub-card-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </span>
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
    <div className="health-hub-page">
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

      <section className="health-hub-hero" aria-labelledby="health-hub-title">
        <div className="health-hub-hero-copy">
          <span className="health-hub-kicker">Tu panel clínico personal</span>
          <h1 id="health-hub-title">Toda tu información de salud, clara y fácil de recorrer</h1>
          <p>Encuentra historia clínica, documentos, medicamentos y reportes sin perderte en textos largos.</p>
        </div>

        <div className="health-hub-hero-highlights" aria-label="Resumen de Mi salud">
          {heroHighlights.map((item) => (
            <div key={item.label} className="health-hub-highlight">
              <strong>{item.label}</strong>
              <span>{item.text}</span>
            </div>
          ))}
        </div>

        <div className="health-hub-hero-actions">
          <Link className="health-hub-hero-action" to="/timeline">
            Ver historia clínica
          </Link>
          <Link className="health-hub-hero-secondary" to="/documents">
            Abrir documentos
          </Link>
        </div>
      </section>

      <section className="health-hub-section" aria-labelledby="health-hub-main-title">
        <div className="health-hub-section-head">
          <div>
            <h2 id="health-hub-main-title">Información principal</h2>
            <p>Los módulos esenciales para entender tu salud.</p>
          </div>
          <span className="health-hub-section-chip">4 módulos centrales</span>
        </div>
        <div className="health-hub-grid">
          {healthSections.map((item) => (
            <HealthHubCard key={item.to} item={item} />
          ))}
        </div>
      </section>

      <section className="health-hub-section" aria-labelledby="health-hub-support-title">
        <div className="health-hub-section-head">
          <div>
            <h2 id="health-hub-support-title">Agenda y seguimiento</h2>
            <p>Accesos rápidos para revisar agenda e indicadores.</p>
          </div>
          <span className="health-hub-section-chip">Seguimiento diario</span>
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
