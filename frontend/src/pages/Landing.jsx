import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLandingStats } from "../api";

const fallbackStats = {
  users: 1200,
  appointments: 15000,
  reminders: 50000,
  satisfaction: 98,
};

const formatCount = (value) =>
  `${new Intl.NumberFormat("en-US").format(value)}+`;
const formatPercent = (value) => `${value}%`;

const features = [
  {
    title: "Asistente IA en salud",
    desc: "Sugiere alertas para citas, documentos y medicacion con recordatorios claros.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3a7 7 0 0 0-4 12.9V19a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3.1A7 7 0 0 0 12 3z" />
        <path d="M9 22h6" />
      </svg>
    ),
  },
  {
    title: "Calendario unificado",
    desc: "Citas, examenes y medicamentos en una sola linea de tiempo.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="18" rx="3" />
        <path d="M8 2v4M16 2v4M3 10h18" />
      </svg>
    ),
  },
  {
    title: "Documentos siempre a mano",
    desc: "Resultados, recetas y ordenes seguras, con OCR y busqueda rapida.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
        <path d="M14 3v5h5" />
      </svg>
    ),
  },
  {
    title: "Seguimiento integral",
    desc: "Historial clinico y linea de tiempo para compartir con tu medico.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 12h4l2-4 4 8 2-4h4" />
      </svg>
    ),
  },
];

const modules = [
  {
    title: "Medicamentos y adherencia",
    desc: "Registra tomas, frecuencia y duracion para mejorar tu adherencia.",
  },
  {
    title: "Recordatorios inteligentes",
    desc: "Alertas en tiempo real para no olvidar citas y examenes.",
  },
  {
    title: "Documentos con OCR",
    desc: "Extrae fecha, centro y notas desde fotos o PDFs.",
  },
  {
    title: "Calendario familiar",
    desc: "Organiza la salud de tu familia en un solo panel.",
  },
  {
    title: "Notificaciones push",
    desc: "Avisos en movil y escritorio, incluso con la app cerrada.",
  },
  {
    title: "Control de privacidad",
    desc: "Tu informacion, tus reglas: consentimiento y exportacion.",
  },
];

const plans = [
  {
    name: "Basico",
    priceMonthly: "Gratis",
    priceYearly: "Gratis",
    note: "Ideal para comenzar",
    recommended: false,
    features: [
      "Citas, calendario y documentos",
      "OCR basico",
      "Recordatorios esenciales",
      "Acceso desde movil y escritorio",
    ],
    cta: "Empezar",
  },
  {
    name: "Plus",
    priceMonthly: "$3.990 / mes",
    priceYearly: "$39.990 / ano",
    note: "Para usuarios activos",
    recommended: true,
    features: [
      "Recordatorios avanzados",
      "OCR mejorado",
      "Historial completo y reportes",
      "Soporte prioritario",
    ],
    cta: "Probar Plus",
  },
  {
    name: "Familiar",
    priceMonthly: "$6.990 / mes",
    priceYearly: "$69.990 / ano",
    note: "Hasta 5 perfiles",
    recommended: false,
    features: [
      "Panel familiar",
      "Calendarios compartidos",
      "Recordatorios por perfil",
      "Historial y documentos por persona",
    ],
    cta: "Elegir Familiar",
  },
];

export default function Landing() {
  const [stats, setStats] = useState(fallbackStats);
  const [billing, setBilling] = useState("monthly");

  useEffect(() => {
    let mounted = true;
    getLandingStats()
      .then((data) => {
        if (!mounted || !data) return;
        setStats({
          users: data.users ?? fallbackStats.users,
          appointments: data.appointments ?? fallbackStats.appointments,
          reminders: data.reminders ?? fallbackStats.reminders,
          satisfaction: data.satisfaction ?? fallbackStats.satisfaction,
        });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const statItems = [
    { value: formatCount(stats.users), label: "Usuarios registrados" },
    { value: formatCount(stats.appointments), label: "Citas gestionadas" },
    { value: formatCount(stats.reminders), label: "Recordatorios enviados" },
    { value: formatPercent(stats.satisfaction), label: "Satisfaccion" },
  ];

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-logo">
          <div className="landing-logo-mark">K</div>
          <span>Klinip</span>
        </div>
        <div className="landing-nav-actions">
          <Link to="/login" className="landing-btn-ghost">
            Iniciar sesion
          </Link>
          <Link to="/register" className="landing-btn-primary">
            Crear cuenta
          </Link>
        </div>
      </header>

      <div className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            Asistente clinico inteligente
          </div>
          <h1>
            Tu salud organizada
            <br />
            <span className="landing-hero-gradient">en un solo lugar</span>
          </h1>
          <p className="landing-hero-description">
            Klinip es tu companero digital de salud. Organiza tus <strong>citas medicas</strong>,
            gestiona tu <strong>medicacion</strong>, almacena <strong>documentos</strong> importantes
            y manten un <strong>historial completo</strong> de tu salud. Todo sincronizado,
            seguro y siempre disponible.
          </p>
          <div className="landing-actions">
            <Link className="landing-btn-cta" to="/register">
              <span>Comenzar gratis</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <Link className="landing-btn-secondary" to="/login">
              Ya tengo cuenta
            </Link>
          </div>
          <div className="landing-stats">
            {statItems.map((s) => (
              <div key={s.label} className="landing-stat">
                <span className="landing-stat-value">{s.value}</span>
                <span className="landing-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="landing-hero-visual">
          <div className="landing-glow" />
          <div className="landing-screen">
            <div className="landing-screen-header">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
              <span className="landing-screen-title">Klinip Salud</span>
            </div>
            <div className="landing-screen-body">
              <div className="landing-chip">Calendario | Hoy</div>
              <div className="landing-tile">
                <div>
                  <p className="landing-tile-title">Consulta cardiologia</p>
                  <p className="landing-tile-meta">12:00 - Centro Salud Norte</p>
                </div>
                <span className="chip-status-agendada">Agendada</span>
              </div>
              <div className="landing-tile">
                <div>
                  <p className="landing-tile-title">Tomar medicacion</p>
                  <p className="landing-tile-meta">08:00 | Amlodipino 5mg</p>
                </div>
                <span className="chip-status-pendiente">Recordar</span>
              </div>
              <div className="landing-tile ghost">
                <div>
                  <p className="landing-tile-title">Subir examen</p>
                  <p className="landing-tile-meta">Resultados laboratorio</p>
                </div>
                <span className="chip">Documento</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="landing-section">
        <div className="landing-section-header">
          <h2>Todo lo que necesitas para cuidar tu salud</h2>
          <p>Funciones disenadas para simplificar la gestion de tu salud y la de tu familia.</p>
        </div>
        <div className="landing-cards">
          {features.map((f) => (
            <div key={f.title} className="landing-card">
              <div className="landing-card-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section-alt">
        <div className="landing-section-header">
          <h2>Mas cosas que hace Klinip</h2>
          <p>Una plataforma completa para tu salud diaria.</p>
        </div>
        <div className="landing-modules">
          {modules.map((m) => (
            <div key={m.title} className="landing-module-card">
              <h3>{m.title}</h3>
              <p>{m.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-plans">
        <div className="landing-section-header">
          <h2>Planes pensados para cada necesidad</h2>
          <p>Empieza gratis y escala cuando lo necesites.</p>
        </div>
        <div className="landing-plan-toggle">
          <span className={billing === "monthly" ? "toggle-active" : ""}>
            Mensual
          </span>
          <button
            type="button"
            className={`toggle-switch ${billing === "yearly" ? "is-yearly" : ""}`}
            onClick={() =>
              setBilling((prev) => (prev === "monthly" ? "yearly" : "monthly"))
            }
            aria-label="Cambiar plan mensual o anual"
          >
            <span className="toggle-knob" />
          </button>
          <span className={billing === "yearly" ? "toggle-active" : ""}>
            Anual
          </span>
          <span className="toggle-badge">Ahorra 2 meses</span>
        </div>
        <div className="landing-plan-grid">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`landing-plan-card ${plan.recommended ? "is-recommended" : ""}`}
            >
              {plan.recommended ? (
                <span className="plan-highlight">Recomendado</span>
              ) : null}
              <div className="plan-header">
                <h3>{plan.name}</h3>
                <p className="plan-price">
                  {billing === "monthly" ? plan.priceMonthly : plan.priceYearly}
                </p>
                <span className="plan-note">{plan.note}</span>
              </div>
              <ul className="plan-features">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link className="landing-btn-primary" to="/register">
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta-section">
        <div className="landing-cta-content">
          <h2>Comienza a organizar tu salud hoy</h2>
          <p>Unete a miles de personas que ya confian en Klinip para gestionar su salud.</p>
          <div className="landing-cta-actions">
            <Link to="/register" className="landing-btn-cta">
              <span>Crear cuenta gratis</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-content">
          <div className="landing-footer-brand">
            <div className="landing-logo">
              <div className="landing-logo-mark">K</div>
              <span>Klinip</span>
            </div>
            <p>Tu ruta de salud, simplificada</p>
          </div>
          <div className="landing-footer-copy">
            (c) 2024 Klinip. Todos los derechos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}
