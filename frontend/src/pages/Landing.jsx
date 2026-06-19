import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getLandingStats, getPublicPlans } from "../api";
import BrandLogo from "../components/BrandLogo";
import { PLAN_CATALOG } from "../data/plans";
import { cleanUiText } from "../utils/textEncoding";

const LANDING_NAV_ITEMS = [
  { id: "todo", label: "Todo tu salud" },
  { id: "ia", label: "Copiloto IA" },
  { id: "privacidad", label: "Privacidad" },
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

// ── Hub: "Reúne toda tu salud en un solo lugar" (4 columnas) ───────────────
const dataHub = [
  {
    key: "citas",
    title: "Citas y agenda",
    desc: "Tus controles, exámenes y consultas en una sola línea de tiempo.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="4" width="18" height="18" rx="3" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    ),
  },
  {
    key: "medicamentos",
    title: "Medicamentos",
    desc: "Registra tomas y mira tu adherencia diaria y de los últimos 30 días.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="8" width="13" height="8" rx="4" transform="rotate(-35 9.5 12)" />
        <path d="M9 9.5 14.5 15" />
      </svg>
    ),
  },
  {
    key: "documentos",
    title: "Documentos con OCR",
    desc: "Una foto y Klinip lee fecha, centro y datos clave de recetas y exámenes.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M8 13h8M8 17h5" />
      </svg>
    ),
  },
  {
    key: "familia",
    title: "Familia",
    desc: "Comparte avances y contexto de salud del hogar en un espacio privado.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="8" cy="9" r="2.5" />
        <circle cx="16" cy="9" r="2.5" />
        <path d="M3.5 19a4.5 4.5 0 0 1 9 0M11.5 19a4.5 4.5 0 0 1 9 0" />
      </svg>
    ),
  },
];

// ── Secciones alternadas (imagen-texto) con mockups del producto ─────────────
const featureStories = [
  {
    key: "adherencia",
    eyebrow: "Adherencia inteligente",
    title: "Tu tratamiento, al día y a 30 días",
    desc: "Klinip calcula tu adherencia de forma justa: cuenta desde que empiezas a registrar, con una vista de hoy en vivo y otra de tendencia mensual.",
    bullets: [
      "Anillo de adherencia que se mueve al registrar cada dosis",
      "Vista diaria y de 30 días, sin penalizar el historial previo",
      "Alertas cuando un medicamento está por terminarse",
    ],
    mockup: "adherence",
  },
  {
    key: "ocr",
    eyebrow: "Documentos sin esfuerzo",
    title: "Una foto y Klinip entiende tu documento",
    desc: "Toma una foto de una receta, orden o resultado y el motor OCR extrae lo importante: tipo, fecha, centro y valores clave, listos para tu historial.",
    bullets: [
      "Captura desde el botón central de la app",
      "Lectura automática de fecha, centro y datos clínicos",
      "Resumen amigable y búsqueda rápida",
    ],
    mockup: "ocr",
    reverse: true,
  },
  {
    key: "familia",
    eyebrow: "En sintonía con tu hogar",
    title: "Mantén a tu familia al tanto",
    desc: "Un espacio privado donde compartir avances, recordatorios y novedades de salud con quienes te importan, con el alcance que define tu plan.",
    bullets: [
      "Feed familiar privado y seguro",
      "Perfiles de salud para cada integrante",
      "Contexto reciente del hogar en un vistazo",
    ],
    mockup: "family",
  },
];

const aiBullets = [
  "Detecta cuando una cita o un medicamento está por vencer",
  "Explica tu adherencia y tu historial en lenguaje cotidiano",
  "Prepara resúmenes y recordatorios por ti",
];

const privacyPoints = [
  {
    title: "Tú decides qué se comparte",
    desc: "Consentimiento explícito y control total sobre cada perfil y cada dato.",
  },
  {
    title: "Tus datos no entrenan modelos externos",
    desc: "Tu información clínica nunca se usa para entrenar modelos de terceros.",
  },
  {
    title: "Exportación y borrado a tu ritmo",
    desc: "Descarga o elimina tu información cuando quieras, sin fricciones.",
  },
];

const faqItems = [
  {
    q: "¿Klinip es gratis?",
    a: "Sí. Puedes empezar con el plan básico sin costo y subir de plan cuando necesites más perfiles, colaboración o red familiar.",
  },
  {
    q: "¿Qué hace el asistente de IA?",
    a: "Organiza tu agenda, te avisa de citas y medicamentos, explica tu adherencia e historial y prepara resúmenes, todo en lenguaje natural.",
  },
  {
    q: "¿Cómo funciona la lectura de documentos?",
    a: "Tomas una foto de una receta, orden o resultado y el OCR de Klinip extrae fecha, centro y datos clave para guardarlos en tu historial.",
  },
  {
    q: "¿Puedo gestionar la salud de mi familia?",
    a: "Sí. Creas perfiles de salud para tu hogar y compartes avances en un espacio privado, según el alcance de tu plan.",
  },
  {
    q: "¿Mis datos están seguros?",
    a: "Tu información es privada y bajo tu control. No se comparte sin tu consentimiento ni se usa para entrenar modelos externos.",
  },
  {
    q: "¿En qué dispositivos funciona?",
    a: "Klinip funciona en el navegador y como app instalable (PWA) en móvil y escritorio, con notificaciones incluso con la app cerrada.",
  },
];

// ── Mockups del producto (imágenes hechas con la propia UI) ──────────────────
function PhoneFrame({ children, tag }) {
  return (
    <div className="kl-phone">
      <div className="kl-phone-notch" />
      <div className="kl-phone-screen">
        {tag ? <div className="kl-phone-tag">{tag}</div> : null}
        {children}
      </div>
    </div>
  );
}

function AdherenceMockup() {
  return (
    <PhoneFrame tag="Inicio">
      <div className="kl-mk-hero">
        <div className="kl-mk-hero-top">
          <span className="kl-mk-greet">Hola, Diego</span>
          <span className="kl-mk-bell" />
        </div>
        <div className="kl-mk-ring-card">
          <div className="kl-mk-ring">
            <span>92%</span>
          </div>
          <div className="kl-mk-ring-meta">
            <strong>Adherencia 30 d&iacute;as</strong>
            <span className="kl-mk-today">Hoy 100% &middot; 2/2</span>
          </div>
        </div>
        <div className="kl-mk-pill-row">
          <span className="kl-mk-pill is-blue">Amlodipino 5 mg</span>
          <span className="kl-mk-pill is-green">Al d&iacute;a</span>
        </div>
      </div>
    </PhoneFrame>
  );
}

function OcrMockup() {
  return (
    <PhoneFrame tag="Documento">
      <div className="kl-mk-scan">
        <div className="kl-mk-scan-doc">
          <div className="kl-mk-scan-line" />
          <span className="kl-mk-scan-h" />
          <span className="kl-mk-scan-h is-short" />
          <span className="kl-mk-scan-h" />
          <span className="kl-mk-scan-h is-short" />
        </div>
        <div className="kl-mk-extract">
          <div className="kl-mk-extract-row"><span>Tipo</span><strong>Receta</strong></div>
          <div className="kl-mk-extract-row"><span>Fecha</span><strong>12 jun 2026</strong></div>
          <div className="kl-mk-extract-row"><span>Centro</span><strong>Cl&iacute;nica Norte</strong></div>
          <div className="kl-mk-extract-row"><span>Detectado</span><strong className="is-ok">2 medicamentos</strong></div>
        </div>
      </div>
    </PhoneFrame>
  );
}

function FamilyMockup() {
  return (
    <PhoneFrame tag="Familia">
      <div className="kl-mk-feed">
        {[
          { who: "Mamá", txt: "Control de presión al día ✅", tone: "green" },
          { who: "Papá", txt: "Subió resultados de laboratorio", tone: "blue" },
          { who: "Tú", txt: "Recordatorio de medicación activado", tone: "violet" },
        ].map((item) => (
          <div key={item.who} className="kl-mk-feed-card">
            <span className={`kl-mk-avatar tone-${item.tone}`}>{item.who.slice(0, 1)}</span>
            <div>
              <strong>{cleanUiText(item.who)}</strong>
              <span>{cleanUiText(item.txt)}</span>
            </div>
          </div>
        ))}
      </div>
    </PhoneFrame>
  );
}

const MOCKUPS = {
  adherence: AdherenceMockup,
  ocr: OcrMockup,
  family: FamilyMockup,
};

export default function Landing({ theme = "light", onToggleTheme }) {
  const [stats, setStats] = useState(fallbackStats);
  const [billing, setBilling] = useState("monthly");
  const [plans, setPlans] = useState(PLAN_CATALOG);
  const [activeNavSection, setActiveNavSection] = useState("todo");
  const [openFaq, setOpenFaq] = useState(0);
  const pageRef = useRef(null);

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

  // Scroll-reveal: aparición suave al entrar en viewport (efecto healthapp.google)
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return undefined;
    const els = Array.from(root.querySelectorAll(".kl-reveal"));
    if (typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("is-in"));
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -10% 0px" }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [plans.length]);

  // Nav activo según sección visible
  useEffect(() => {
    const sections = LANDING_NAV_ITEMS.map((item) => document.getElementById(item.id)).filter(Boolean);
    if (!sections.length || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visibleEntry?.target?.id) setActiveNavSection(visibleEntry.target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0.15, 0.35, 0.55] }
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
    { value: formatCount(stats.users), label: "Usuarios" },
    { value: formatCount(stats.appointments), label: "Citas gestionadas" },
    { value: formatCount(stats.reminders), label: "Recordatorios" },
    { value: formatPercent(stats.satisfaction), label: "Satisfacción" },
  ];

  return (
    <div className="kl-page" ref={pageRef}>
      <header className="kl-navbar">
        <div className="kl-navbar-inner">
          <Link className="kl-nav-logo" to="/">
            <BrandLogo
              className="brand-logo-landing brand-logo-keep-name-mobile"
              nameClassName="kl-nav-logo-name"
              showMark={false}
              responsive
            />
          </Link>

          <nav className="kl-nav-links">
            {LANDING_NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`kl-nav-link ${activeNavSection === item.id ? "active" : ""}`}
                onClick={() => handleLandingNav(item.id)}
                aria-current={activeNavSection === item.id ? "page" : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="kl-nav-right">
            <button
              type="button"
              className="theme-toggle kl-theme-toggle"
              onClick={() => onToggleTheme?.()}
              aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              aria-pressed={theme === "dark"}
            >
              <span className={`theme-switch ${theme === "dark" ? "is-dark" : ""}`}>
                <span className="theme-switch-thumb" />
              </span>
            </button>
            <Link className="kl-btn-ghost" to="/login">Iniciar sesi&oacute;n</Link>
            <Link className="kl-btn-primary" to="/register">Crear cuenta</Link>
          </div>
        </div>
      </header>

      {/* ── HERO full-bleed ─────────────────────────────────────────────── */}
      <section className="kl-hero">
        <div className="kl-hero-bg" aria-hidden="true">
          <span className="kl-hero-orb kl-hero-orb-1" />
          <span className="kl-hero-orb kl-hero-orb-2" />
          <span className="kl-hero-grid" />
        </div>
        <div className="kl-hero-inner">
          <div className="kl-hero-copy">
            <div className="kl-hero-pill kl-reveal">
              <span className="kl-hero-pill-dot" />
              Asistente cl&iacute;nico con IA
            </div>
            <h1 className="kl-hero-title kl-reveal">
              Una nueva relaci&oacute;n
              <span> con tu salud</span>
            </h1>
            <p className="kl-hero-desc kl-reveal">
              Klinip re&uacute;ne tus citas, medicamentos, documentos e historial en un solo lugar,
              con una IA que te ayuda a no olvidar nada y a entender tu salud d&iacute;a a d&iacute;a.
            </p>
            <div className="kl-hero-actions kl-reveal">
              <Link className="kl-btn-hero" to="/register">
                <span>Comenzar gratis</span>
                <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              </Link>
              <Link className="kl-btn-secondary" to="/login">Ya tengo cuenta</Link>
            </div>
            <div className="kl-hero-stats kl-reveal">
              {statItems.map((item) => (
                <div key={item.label} className="kl-hero-stat">
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="kl-hero-visual kl-reveal">
            <AdherenceMockup />
            <div className="kl-hero-float kl-hero-float-1">
              <span className="kl-hero-float-dot is-green" />
              Dosis registrada
            </div>
            <div className="kl-hero-float kl-hero-float-2">
              <span className="kl-hero-float-dot is-blue" />
              Cita en 1 h
            </div>
          </div>
        </div>

        <button
          type="button"
          className="kl-scroll-cue"
          onClick={() => handleLandingNav("todo")}
          aria-label="Desplazarse hacia abajo"
        >
          <span className="kl-scroll-mouse"><span className="kl-scroll-wheel" /></span>
          <span className="kl-scroll-text">Descubre m&aacute;s</span>
        </button>
      </section>

      {/* ── HUB: toda tu salud en un lugar ──────────────────────────────── */}
      <section id="todo" className="kl-section kl-hub">
        <div className="kl-section-inner">
          <div className="kl-section-head kl-reveal">
            <div className="kl-eyebrow">Todo en un lugar</div>
            <h2 className="kl-section-title">Re&uacute;ne toda tu salud <em>en un solo lugar</em></h2>
            <p className="kl-section-sub">Citas, medicamentos, documentos y tu familia, conectados y siempre a mano.</p>
          </div>
          <div className="kl-hub-grid">
            {dataHub.map((item, i) => (
              <article
                key={item.key}
                className="kl-hub-card kl-reveal"
                style={{ "--kl-delay": `${i * 90}ms` }}
              >
                <div className="kl-hub-icon">{item.icon}</div>
                <h3>{cleanUiText(item.title)}</h3>
                <p>{cleanUiText(item.desc)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Copiloto IA ─────────────────────────────────────────────────── */}
      <section id="ia" className="kl-section kl-ai">
        <div className="kl-section-inner kl-ai-inner">
          <div className="kl-ai-copy kl-reveal">
            <div className="kl-eyebrow is-light">Klinip IA</div>
            <h2 className="kl-section-title is-light">Tu copiloto de <em>salud personal</em></h2>
            <p className="kl-section-sub is-light">
              Pregunta en lenguaje natural sobre tus medicamentos, tus citas o tu historial.
              Klinip aprende tu rutina, detecta patrones y act&uacute;a antes de que algo se escape.
            </p>
            <ul className="kl-ai-list">
              {aiBullets.map((b) => (
                <li key={b}>
                  <span className="kl-ai-check">
                    <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                  {cleanUiText(b)}
                </li>
              ))}
            </ul>
          </div>

          <div className="kl-ai-visual kl-reveal">
            <div className="kl-ai-chat">
              <div className="kl-ai-chat-bar">
                <div className="kl-ai-chat-dots"><span /><span /><span /></div>
                <span className="kl-ai-chat-title">Klinip IA</span>
                <span className="kl-ai-chat-tag">En l&iacute;nea</span>
              </div>
              <div className="kl-ai-messages">
                <div className="kl-ai-msg is-ai">Hola. Tienes cardiolog&iacute;a hoy a las 12:00. &iquest;Preparo un resumen con tus documentos relevantes?</div>
                <div className="kl-ai-msg is-user">S&iacute;, por favor</div>
                <div className="kl-ai-msg is-ai">Listo. Adjunt&eacute; tu &uacute;ltimo ECG y la lista de medicamentos, y activ&eacute; un recordatorio 1 hora antes.</div>
              </div>
              <div className="kl-ai-chips">
                <span className="kl-ai-chip">&iquest;Mi &uacute;ltima dosis?</span>
                <span className="kl-ai-chip">Citas de marzo</span>
                <span className="kl-ai-chip">Adherencia</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Secciones alternadas con scroll-reveal ──────────────────────── */}
      {featureStories.map((story) => {
        const Mockup = MOCKUPS[story.mockup];
        return (
          <section key={story.key} className={`kl-section kl-story ${story.reverse ? "is-reverse" : ""}`}>
            <div className="kl-section-inner kl-story-inner">
              <div className="kl-story-copy kl-reveal">
                <div className="kl-eyebrow">{cleanUiText(story.eyebrow)}</div>
                <h2 className="kl-section-title">{cleanUiText(story.title)}</h2>
                <p className="kl-section-sub">{cleanUiText(story.desc)}</p>
                <ul className="kl-story-bullets">
                  {story.bullets.map((b) => (
                    <li key={b}>
                      <span className="kl-story-check">
                        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                      </span>
                      {cleanUiText(b)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="kl-story-visual kl-reveal">
                <div className="kl-story-glow" aria-hidden="true" />
                {Mockup ? <Mockup /> : null}
              </div>
            </div>
          </section>
        );
      })}

      {/* ── Privacidad y seguridad ──────────────────────────────────────── */}
      <section id="privacidad" className="kl-section kl-privacy">
        <div className="kl-section-inner">
          <div className="kl-section-head kl-reveal">
            <div className="kl-privacy-shield" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
            </div>
            <div className="kl-eyebrow">Personal, proactivo y seguro</div>
            <h2 className="kl-section-title">Tu salud es tuya, <em>siempre</em></h2>
            <p className="kl-section-sub">Dise&ntilde;ado con privacidad desde el primer d&iacute;a. T&uacute; tienes el control.</p>
          </div>
          <div className="kl-privacy-grid">
            {privacyPoints.map((item, i) => (
              <article key={item.title} className="kl-privacy-card kl-reveal" style={{ "--kl-delay": `${i * 90}ms` }}>
                <h3>{cleanUiText(item.title)}</h3>
                <p>{cleanUiText(item.desc)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Planes ──────────────────────────────────────────────────────── */}
      <section id="planes" className="kl-section kl-pricing">
        <div className="kl-section-inner">
          <div className="kl-section-head kl-reveal">
            <div className="kl-eyebrow">Planes</div>
            <h2 className="kl-section-title">Pensados para <em>cada necesidad</em></h2>
            <p className="kl-section-sub">Empieza gratis y escala cuando necesites m&aacute;s perfiles o m&aacute;s colaboraci&oacute;n.</p>
          </div>

          <div className="kl-billing-toggle kl-reveal">
            <span className={billing === "monthly" ? "is-active" : ""}>Mensual</span>
            <button
              type="button"
              className={`kl-billing-switch ${billing === "yearly" ? "is-yearly" : ""}`}
              onClick={() => setBilling((prev) => (prev === "monthly" ? "yearly" : "monthly"))}
              aria-label="Cambiar facturación"
            >
              <span className="kl-billing-thumb" />
            </button>
            <span className={billing === "yearly" ? "is-active" : ""}>Anual</span>
            <span className="kl-billing-badge">Ahorra 2 meses</span>
          </div>

          <div className="kl-pricing-grid">
            {plans.map((plan, i) => (
              <article
                key={plan.slug}
                className={`kl-price-card kl-reveal ${plan.recommended ? "is-featured" : ""}`}
                style={{ "--kl-delay": `${i * 90}ms` }}
              >
                {plan.recommended ? <span className="kl-price-rec">Recomendado</span> : null}
                <div className="kl-price-plan">{cleanUiText(plan.name)}</div>
                <div className={`kl-price-amount ${plan.slug === "basico" ? "is-free" : ""}`}>
                  {billing === "monthly" ? plan.priceMonthly : plan.priceYearly}
                </div>
                <div className="kl-price-period">
                  {billing === "monthly" ? "Facturación mensual" : "Facturación anual"}
                </div>
                <div className="kl-price-subtitle">{cleanUiText(plan.note)}</div>
                <div className="kl-price-divider" />
                <ul className="kl-price-features">
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <span className="kl-price-check">
                        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                      </span>
                      {cleanUiText(feature)}
                    </li>
                  ))}
                </ul>
                <Link className="kl-price-btn-primary" to={`/planes/${plan.slug}`}>Ver detalle</Link>
                <Link className="kl-price-btn-ghost" to="/register">{cleanUiText(plan.cta)}</Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ acordeón ───────────────────────────────────────────────── */}
      <section className="kl-section kl-faq">
        <div className="kl-section-inner kl-faq-inner">
          <div className="kl-section-head kl-reveal">
            <div className="kl-eyebrow">Preguntas frecuentes</div>
            <h2 className="kl-section-title">Resolvemos tus <em>dudas</em></h2>
          </div>
          <div className="kl-faq-list kl-reveal">
            {faqItems.map((item, i) => {
              const open = openFaq === i;
              return (
                <div key={item.q} className={`kl-faq-item ${open ? "is-open" : ""}`}>
                  <button
                    type="button"
                    className="kl-faq-q"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : i)}
                  >
                    <span>{cleanUiText(item.q)}</span>
                    <span className="kl-faq-icon" aria-hidden="true" />
                  </button>
                  <div className="kl-faq-a" style={{ maxHeight: open ? "400px" : "0px" }}>
                    <p>{cleanUiText(item.a)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA final ───────────────────────────────────────────────────── */}
      <section className="kl-cta">
        <div className="kl-cta-inner kl-reveal">
          <div className="kl-eyebrow is-light">Empieza hoy</div>
          <h2>Comienza tu camino de <em>salud personalizada</em></h2>
          <p>&Uacute;nete a miles de personas que ya confían en Klinip para cuidar su salud y la de su familia.</p>
          <Link className="kl-cta-btn" to="/register">
            <span>Crear cuenta gratis</span>
            <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
          </Link>
        </div>
      </section>

      <footer className="kl-footer">
        <div className="kl-footer-inner">
          <div className="kl-footer-brand">
            <BrandLogo className="brand-logo-landing brand-logo-keep-name-mobile" showMark={false} responsive />
            <span>Tu ruta de salud, simplificada</span>
          </div>
          <div className="kl-footer-copy">&copy; 2026 Klinip. Todos los derechos reservados.</div>
        </div>
      </footer>
    </div>
  );
}
