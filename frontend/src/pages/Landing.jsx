import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLandingStats, getPublicPlans } from "../api";
import BrandLogo from "../components/BrandLogo";
import { PLAN_CATALOG } from "../data/plans";
import { cleanUiText } from "../utils/textEncoding";

const LANDING_NAV_ITEMS = [
  { id: "features", label: "Funciones" },
  { id: "ia", label: "IA en salud" },
  { id: "planes", label: "Planes" },
];

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
    desc: "Sugiere alertas para citas, documentos y medicaci\u00f3n con recordatorios claros.",
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
    desc: "Citas, ex\u00e1menes y medicamentos en una sola l\u00ednea de tiempo sincronizada.",
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
    desc: "Resultados, recetas y \u00f3rdenes seguras, con lectura autom\u00e1tica y b\u00fasqueda r\u00e1pida integrada.",
    tone: "amber",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  {
    title: "Red familiar",
    desc: "Comparte avances, resultados y actualizaciones de salud en un espacio privado para tu hogar; el alcance crece seg\u00fan tu plan.",
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
    desc: "Registra tomas, frecuencia y duraci\u00f3n para mejorar tu adherencia.",
  },
  {
    title: "Recordatorios inteligentes",
    desc: "Alertas en tiempo real para no olvidar citas y ex\u00e1menes.",
  },
  {
    title: "Documentos con lectura inteligente",
    desc: "Detecta fecha, centro y texto clave desde fotos o PDFs autom\u00e1ticamente.",
  },
  {
    title: "Actualizaciones familiares",
    desc: "Ve publicaciones, avances y contexto reciente del hogar en un espacio privado de seguimiento.",
  },
  {
    title: "Notificaciones push",
    desc: "Avisos en m\u00f3vil y escritorio, incluso con la app cerrada.",
  },
  {
    title: "Control de privacidad",
    desc: "Tu informaci\u00f3n, tus reglas: consentimiento y exportaci\u00f3n total.",
  },
];

const aiFeatures = [
  {
    title: "Alertas proactivas",
    desc: "Detecta cuando un medicamento est\u00e1 por terminarse o una cita por vencer.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    title: "An\u00e1lisis de adherencia",
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

export default function Landing({ theme = "light", onToggleTheme }) {
  const [stats, setStats] = useState(fallbackStats);
  const [billing, setBilling] = useState("monthly");
  const [plans, setPlans] = useState(PLAN_CATALOG);
  const [activeNavSection, setActiveNavSection] = useState("features");

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

  useEffect(() => {
    const sections = LANDING_NAV_ITEMS.map((item) => document.getElementById(item.id)).filter(Boolean);
    if (!sections.length || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visibleEntry?.target?.id) {
          setActiveNavSection(visibleEntry.target.id);
        }
      },
      {
        rootMargin: "-28% 0px -52% 0px",
        threshold: [0.2, 0.35, 0.55],
      }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const handleLandingNav = (sectionId) => {
    const target = document.getElementById(sectionId);
    if (!target) return;
    setActiveNavSection(sectionId);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const statItems = [
    { value: formatCount(stats.users), label: "Usuarios registrados" },
    { value: formatCount(stats.appointments), label: "Citas gestionadas" },
    { value: formatCount(stats.reminders), label: "Recordatorios enviados" },
    { value: formatPercent(stats.satisfaction), label: "Satisfacci\u00f3n" },
  ];

  return (
    <div className="lp-page">
      <header className="lp-navbar">
        <div className="lp-navbar-inner">
          <Link className="lp-nav-logo" to="/">
            <BrandLogo
              className="brand-logo-landing brand-logo-keep-name-mobile"
              markClassName="landing-logo-mark"
              imgClassName="landing-logo-mark-img"
              nameClassName="lp-nav-logo-name"
              responsive
            />
          </Link>

          <nav className="lp-nav-links">
            {LANDING_NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`lp-nav-link ${activeNavSection === item.id ? "active" : ""}`}
                onClick={() => handleLandingNav(item.id)}
                aria-current={activeNavSection === item.id ? "page" : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="lp-nav-right">
            <button
              type="button"
              className="theme-toggle lp-theme-toggle"
              onClick={() => onToggleTheme?.()}
              aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              aria-pressed={theme === "dark"}
            >
              <span className="theme-toggle-label">
                {theme === "dark" ? "Modo oscuro" : "Modo claro"}
              </span>
              <span className={`theme-switch ${theme === "dark" ? "is-dark" : ""}`}>
                <span className="theme-switch-thumb" />
              </span>
            </button>
            <Link className="lp-btn-ghost" to="/login">Iniciar sesi&oacute;n</Link>
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
              Asistente cl&iacute;nico con IA
            </div>

            <h1 className="lp-hero-title lp-anim lp-anim-d2">
              Tu salud organizada
              <span>en un solo lugar</span>
            </h1>

            <p className="lp-hero-desc lp-anim lp-anim-d3">
              Klinip es tu compa&ntilde;ero digital de salud. Organiza tus <strong>citas m&eacute;dicas</strong>,
              gestiona tu <strong>medicaci&oacute;n</strong>, almacena <strong>documentos</strong> importantes
              y mant&eacute;n un <strong>historial completo</strong> con IA que te ayuda a no olvidar nada. Ahora
              tambi&eacute;n puedes compartir avances privados con tu hogar desde <strong>Familia</strong>.
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
                <span className="lp-mockup-tag">Calendario &middot; Hoy</span>
              </div>
              <div className="lp-mockup-body">
                <div className="lp-mockup-row">
                  <div>
                    <strong>Consulta cardiolog&iacute;a</strong>
                    <small>12:00 &middot; Centro Salud Norte</small>
                  </div>
                  <span className="lp-tag is-blue">Agendada</span>
                </div>
                <div className="lp-mockup-row">
                  <div>
                    <strong>Tomar medicaci&oacute;n</strong>
                    <small>08:00 &middot; Amlodipino 5 mg</small>
                  </div>
                  <span className="lp-tag is-red">Recordar</span>
                </div>
                <div className="lp-mockup-row">
                  <div>
                    <strong>Subir examen</strong>
                    <small>Resultados de laboratorio</small>
                  </div>
                  <span className="lp-tag is-gray">Documento</span>
                </div>
                <div className="lp-mockup-row">
                  <div>
                    <strong>Control de diabetes</strong>
                    <small>Seguimiento de adherencia: 85%</small>
                  </div>
                  <span className="lp-tag is-green">Al d&iacute;a</span>
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
          <p className="lp-section-sub">Funciones dise&ntilde;adas para simplificar la gesti&oacute;n de tu salud y la de tu familia.</p>

          <div className="lp-feature-grid">
            {features.map((feature) => (
              <article key={feature.title} className="lp-feature-card">
                <div className={`lp-feature-line tone-${feature.tone}`} />
                <div className={`lp-feature-icon tone-${feature.tone}`}>{feature.icon}</div>
                <h3>{cleanUiText(feature.title)}</h3>
                <p>{cleanUiText(feature.desc)}</p>
              </article>
            ))}
          </div>

          <div className="lp-more-block">
            <p className="lp-more-kicker">M&aacute;s cosas que hace Klinip</p>
            <div className="lp-more-grid">
              {moreFeatures.map((item) => (
                <article key={item.title} className="lp-more-card">
                  <h3>{cleanUiText(item.title)}</h3>
                  <p>{cleanUiText(item.desc)}</p>
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
                    <strong>{cleanUiText(item.title)}</strong>
                    <p>{cleanUiText(item.desc)}</p>
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
                <span className="lp-ai-chat-title">Klinip IA &middot; Copiloto de salud</span>
                <span className="lp-ai-chat-tag">IA activa</span>
              </div>

              <div className="lp-ai-messages">
                <div className="lp-ai-msg is-ai">Hola. Revis&eacute; tu agenda de hoy. Tienes una cita de cardiolog&iacute;a a las 12:00. &iquest;Quieres que te prepare un resumen de documentos relevantes?</div>
                <div className="lp-ai-msg is-user">S&iacute;, mu&eacute;strame qu&eacute; debo llevar</div>
                <div className="lp-ai-msg is-ai">Perfecto. Seg&uacute;n tu historial, te recomiendo llevar tu &uacute;ltimo ECG, la lista de medicamentos actuales y resultados de examen de sangre. &iquest;Quieres que genere un PDF con este resumen?</div>
                <div className="lp-ai-msg is-user">Genera el PDF</div>
                <div className="lp-ai-msg is-ai">Listo. El PDF ya est&aacute; preparado y activ&eacute; un recordatorio 1 hora antes de tu cita.</div>
              </div>

              <div className="lp-ai-chip-row">
                <button type="button" className="lp-ai-chip">&iquest;Cu&aacute;ndo tom&eacute; mi &uacute;ltima dosis?</button>
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
          <p className="lp-section-sub">Empieza gratis y escala cuando necesites m&aacute;s perfiles, m&aacute;s colaboraci&oacute;n o una red familiar m&aacute;s compartida.</p>

          <div className="lp-billing-toggle">
            <span className={billing === "monthly" ? "is-active" : ""}>Mensual</span>
            <button
              type="button"
              className={`lp-billing-switch ${billing === "yearly" ? "is-yearly" : ""}`}
              onClick={() => setBilling((prev) => (prev === "monthly" ? "yearly" : "monthly"))}
              aria-label={"Cambiar facturaci\u00f3n"}
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
                <div className="lp-price-plan">{cleanUiText(plan.name)}</div>
                <div className={`lp-price-amount ${plan.slug === "basico" ? "is-free" : ""}`}>
                  {billing === "monthly" ? plan.priceMonthly : plan.priceYearly}
                </div>
                <div className="lp-price-period">
                  {billing === "monthly" ? "Facturaci&oacute;n mensual" : "Facturaci&oacute;n anual"}
                </div>
                <div className="lp-price-subtitle">{cleanUiText(plan.note)}</div>
                <div className="lp-price-divider" />
                <ul className="lp-price-features">
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <span className="lp-price-check">
                        <svg viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      {cleanUiText(feature)}
                    </li>
                  ))}
                </ul>
                <Link className="lp-price-btn-primary" to={`/planes/${plan.slug}`}>Ver detalle</Link>
                <Link className="lp-price-btn-ghost" to="/register">{cleanUiText(plan.cta)}</Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-cta-section">
        <div className="lp-cta-inner">
          <div className="lp-cta-eyebrow">Empieza hoy</div>
          <h2>Comienza a organizar tu <em>salud hoy</em></h2>
          <p>&Uacute;nete a miles de personas que ya conf&iacute;an en Klinip para gestionar su salud y la de su familia.</p>
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
              <BrandLogo
                className="brand-logo-landing brand-logo-keep-name-mobile"
                markClassName="landing-logo-mark"
                imgClassName="landing-logo-mark-img"
                responsive
              />
              <span>Tu ruta de salud, simplificada</span>
            </div>
          </div>
          <div className="lp-footer-copy">&copy; 2026 Klinip. Todos los derechos reservados.</div>
        </div>
      </footer>
    </div>
  );
}
