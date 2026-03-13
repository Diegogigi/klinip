import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLandingStats, getPublicPlans } from "../api";
import { PLAN_CATALOG } from "../data/plans";

const fallbackStats = {
  users: 1200,
  appointments: 15000,
  reminders: 50000,
  satisfaction: 98,
};

const formatCount = (value) => `${new Intl.NumberFormat("es-CL").format(value)}+`;
const formatPercent = (value) => `${value}%`;

const features = [
  {
    title: "Asistente IA en salud",
    desc: "Sugiere alertas para citas, documentos y medicacion con recordatorios claros.",
    tone: "blue",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <circle cx="12" cy="16" r=".5" fill="currentColor" />
      </svg>
    ),
  },
  {
    title: "Calendario unificado",
    desc: "Citas, examenes y medicamentos en una sola linea de tiempo sincronizada.",
    tone: "teal",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    title: "Documentos siempre a mano",
    desc: "Resultados, recetas y ordenes seguras, con OCR y busqueda rapida integrada.",
    tone: "amber",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  {
    title: "Seguimiento integral",
    desc: "Historial clinico y linea de tiempo para compartir facilmente con tu medico.",
    tone: "violet",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
];

const moreFeatures = [
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
    desc: "Extrae fecha, centro y notas desde fotos o PDFs automaticamente.",
  },
  {
    title: "Calendario familiar",
    desc: "Organiza la salud de tu familia en un solo panel colaborativo.",
  },
  {
    title: "Notificaciones push",
    desc: "Avisos en movil y escritorio, incluso con la app cerrada.",
  },
  {
    title: "Control de privacidad",
    desc: "Tu informacion, tus reglas: consentimiento y exportacion total.",
  },
];

const aiFeatures = [
  {
    title: "Alertas proactivas",
    desc: "Detecta cuando un medicamento esta por terminarse o una cita por vencer.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    title: "Analisis de adherencia",
    desc: "Visualiza tu cumplimiento de tratamientos y recibe sugerencias para mejorar.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    title: "Respuestas en lenguaje natural",
    desc: "Pregunta sobre tu salud, tus medicamentos o tu historial en lenguaje cotidiano.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    title: "Privacidad garantizada",
    desc: "Tus datos de salud nunca se comparten ni se usan para entrenar modelos externos.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
];

export default function Landing() {
  const [stats, setStats] = useState(fallbackStats);
  const [billing, setBilling] = useState("monthly");
  const [plans, setPlans] = useState(PLAN_CATALOG);

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

  useEffect(() => {
    let mounted = true;
    getPublicPlans()
      .then((data) => {
        if (!mounted || !Array.isArray(data) || data.length === 0) return;
        setPlans(data);
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
    <div className="lp-page">
      <header className="lp-navbar">
        <div className="lp-navbar-inner">
          <Link className="lp-nav-logo" to="/">
            <span className="brand-wordmark responsive" aria-label="Klinip">
              <span className="brand-wordmark-full">Klinip</span>
              <span className="brand-wordmark-compact">K</span>
            </span>
          </Link>

          <nav className="lp-nav-links">
            <a className="lp-nav-link" href="#features">Funciones</a>
            <a className="lp-nav-link" href="#ia">IA en salud</a>
            <a className="lp-nav-link" href="#planes">Planes</a>
          </nav>

          <div className="lp-nav-right">
            <Link className="lp-btn-ghost" to="/login">Iniciar sesion</Link>
            <Link className="lp-btn-primary" to="/register">Crear cuenta</Link>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-hero-left">
            <div className="lp-hero-pill lp-anim lp-anim-d1">
              <span className="lp-hero-pill-dot">
                <svg viewBox="0 0 24 24">
                  <polyline points="13 2 13 9 20 9" />
                  <path d="M3 15a9 9 0 1 0 18 0 9 9 0 0 0-18 0" />
                </svg>
              </span>
              Asistente clinico con IA
            </div>

            <h1 className="lp-hero-title lp-anim lp-anim-d2">
              Tu salud organizada
              <span>en un solo lugar</span>
            </h1>

            <p className="lp-hero-desc lp-anim lp-anim-d3">
              Klinip es tu companero digital de salud. Organiza tus <strong>citas medicas</strong>,
              gestiona tu <strong>medicacion</strong>, almacena <strong>documentos</strong> importantes
              y manten un <strong>historial completo</strong> con IA que te ayuda a no olvidar nada.
            </p>

            <div className="lp-hero-actions lp-anim lp-anim-d4">
              <Link className="lp-btn-hero" to="/register">
                <span>Comenzar gratis</span>
                <svg viewBox="0 0 24 24">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
              <Link className="lp-btn-secondary" to="/login">Ya tengo cuenta</Link>
            </div>

            <div className="lp-hero-stats lp-anim lp-anim-d5">
              {statItems.map((item) => (
                <div key={item.label} className="lp-hero-stat">
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lp-hero-right lp-anim lp-anim-d3">
            <div className="lp-hero-mockup">
              <div className="lp-mockup-bar">
                <div className="lp-mockup-dots">
                  <span className="is-red" />
                  <span className="is-yellow" />
                  <span className="is-green" />
                </div>
                <span className="lp-mockup-title">Klinip Salud</span>
                <span className="lp-mockup-tag">Calendario · Hoy</span>
              </div>
              <div className="lp-mockup-body">
                <div className="lp-mockup-row">
                  <div>
                    <strong>Consulta cardiologia</strong>
                    <small>12:00 · Centro Salud Norte</small>
                  </div>
                  <span className="lp-tag is-blue">Agendada</span>
                </div>
                <div className="lp-mockup-row">
                  <div>
                    <strong>Tomar medicacion</strong>
                    <small>08:00 · Amlodipino 5mg</small>
                  </div>
                  <span className="lp-tag is-red">Recordar</span>
                </div>
                <div className="lp-mockup-row">
                  <div>
                    <strong>Subir examen</strong>
                    <small>Resultados laboratorio</small>
                  </div>
                  <span className="lp-tag is-gray">Documento</span>
                </div>
                <div className="lp-mockup-row">
                  <div>
                    <strong>Control diabetes</strong>
                    <small>Seguimiento adherencia: 85%</small>
                  </div>
                  <span className="lp-tag is-green">Al dia</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="lp-section lp-section-surface">
        <div className="lp-section-inner">
          <div className="lp-section-eyebrow"><span />Funciones<span /></div>
          <h2 className="lp-section-title">Todo lo que necesitas para <em>cuidar tu salud</em></h2>
          <p className="lp-section-sub">Funciones disenadas para simplificar la gestion de tu salud y la de tu familia.</p>

          <div className="lp-feature-grid">
            {features.map((feature) => (
              <article key={feature.title} className="lp-feature-card">
                <div className={`lp-feature-line tone-${feature.tone}`} />
                <div className={`lp-feature-icon tone-${feature.tone}`}>{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.desc}</p>
              </article>
            ))}
          </div>

          <div className="lp-more-block">
            <p className="lp-more-kicker">Mas cosas que hace Klinip</p>
            <div className="lp-more-grid">
              {moreFeatures.map((item) => (
                <article key={item.title} className="lp-more-card">
                  <h3>{item.title}</h3>
                  <p>{item.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="ia" className="lp-ai-section">
        <div className="lp-ai-inner">
          <div className="lp-ai-left">
            <div className="lp-ai-eyebrow"><span />Inteligencia artificial</div>
            <h2 className="lp-ai-title">Tu copiloto de <em>salud personal</em></h2>
            <p className="lp-ai-desc">
              Klinip no es solo un organizador. Es un asistente que aprende tu rutina de salud,
              detecta patrones y te avisa antes de que algo se escape.
            </p>

            <div className="lp-ai-feature-list">
              {aiFeatures.map((item) => (
                <div key={item.title} className="lp-ai-feature">
                  <div className="lp-ai-feature-icon">{item.icon}</div>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lp-ai-right">
            <div className="lp-ai-chat">
              <div className="lp-ai-chat-bar">
                <div className="lp-ai-chat-dots">
                  <span className="is-red" />
                  <span className="is-yellow" />
                  <span className="is-green" />
                </div>
                <span className="lp-ai-chat-title">Klinip IA · Copiloto de salud</span>
                <span className="lp-ai-chat-tag">IA activa</span>
              </div>

              <div className="lp-ai-messages">
                <div className="lp-ai-msg is-ai">Hola. Revise tu agenda de hoy. Tienes una cita de cardiologia a las 12:00. Quieres que te prepare un resumen de documentos relevantes?</div>
                <div className="lp-ai-msg is-user">Si, muestrame que debo llevar</div>
                <div className="lp-ai-msg is-ai">Perfecto. Segun tu historial, te recomiendo llevar tu ultimo ECG, la lista de medicamentos actuales y resultados de examen de sangre. Quieres que genere un PDF con este resumen?</div>
                <div className="lp-ai-msg is-user">Genera el PDF</div>
                <div className="lp-ai-msg is-ai">Listo. El PDF ya esta preparado y active un recordatorio 1 hora antes de tu cita.</div>
              </div>

              <div className="lp-ai-chip-row">
                <button type="button" className="lp-ai-chip">Cuando tome mi ultima dosis?</button>
                <button type="button" className="lp-ai-chip">Ver mis citas de marzo</button>
                <button type="button" className="lp-ai-chip">Adherencia esta semana</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="planes" className="lp-pricing-section">
        <div className="lp-section-inner">
          <div className="lp-section-eyebrow"><span />Planes<span /></div>
          <h2 className="lp-section-title">Pensados para <em>cada necesidad</em></h2>
          <p className="lp-section-sub">Empieza gratis y escala cuando lo necesites.</p>

          <div className="lp-billing-toggle">
            <span className={billing === "monthly" ? "is-active" : ""}>Mensual</span>
            <button
              type="button"
              className={`lp-billing-switch ${billing === "yearly" ? "is-yearly" : ""}`}
              onClick={() => setBilling((prev) => (prev === "monthly" ? "yearly" : "monthly"))}
              aria-label="Cambiar facturacion"
            >
              <span className="lp-billing-thumb" />
            </button>
            <span className={billing === "yearly" ? "is-active" : ""}>Anual</span>
            <span className="lp-billing-badge">Ahorra 2 meses</span>
          </div>

          <div className="lp-pricing-grid">
            {plans.map((plan) => (
              <article key={plan.slug} className={`lp-price-card ${plan.recommended ? "is-featured" : ""}`}>
                {plan.recommended ? <span className="lp-price-rec">Recomendado</span> : null}
                <div className="lp-price-plan">{plan.name}</div>
                <div className={`lp-price-amount ${plan.slug === "basico" ? "is-free" : ""}`}>
                  {billing === "monthly" ? plan.priceMonthly : plan.priceYearly}
                </div>
                <div className="lp-price-period">{billing === "monthly" ? "Facturacion mensual" : "Facturacion anual"}</div>
                <div className="lp-price-subtitle">{plan.note}</div>
                <div className="lp-price-divider" />
                <ul className="lp-price-features">
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <span className="lp-price-check">
                        <svg viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link className="lp-price-btn-primary" to={`/planes/${plan.slug}`}>Ver detalle</Link>
                <Link className="lp-price-btn-ghost" to="/register">{plan.cta}</Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-cta-section">
        <div className="lp-cta-inner">
          <div className="lp-cta-eyebrow">Empieza hoy</div>
          <h2>Comienza a organizar tu <em>salud hoy</em></h2>
          <p>Unete a miles de personas que ya confian en Klinip para gestionar su salud y la de su familia.</p>
          <Link className="lp-cta-btn" to="/register">
            <span>Crear cuenta gratis</span>
            <svg viewBox="0 0 24 24">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <div>
              <strong className="brand-wordmark responsive" aria-label="Klinip">
                <span className="brand-wordmark-full">Klinip</span>
                <span className="brand-wordmark-compact">K</span>
              </strong>
              <span>Tu ruta de salud, simplificada</span>
            </div>
          </div>
          <div className="lp-footer-copy">© 2026 Klinip. Todos los derechos reservados.</div>
        </div>
      </footer>
    </div>
  );
}
