import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLandingStats, getPublicPlans } from "../api";
import BrandLogo from "../components/BrandLogo";
import { PLAN_CATALOG } from "../data/plans";
import { cleanUiText } from "../utils/textEncoding";
import "./Landing.css";

const LANDING_NAV_ITEMS = [
  { id: "personas", label: "Personas" },
  { id: "empresas", label: "Empresas" },
  { id: "modulos", label: "Módulos" },
  { id: "confianza", label: "Confianza" },
  { id: "planes", label: "Planes" },
];

const fallbackStats = {
  users: 1200,
  appointments: 15000,
  reminders: 50000,
  satisfaction: 98,
};

const heroHighlights = [
  "Documentos, citas, medicamentos y contexto en un mismo lugar",
  "Klinip Voice con versión clara para el usuario y versión compartible para el profesional",
  "Propiedad de datos y permisos explícitos para familia, cuidadores y equipos",
];

const peopleBenefits = [
  "Organiza tu salud sin depender de papeles, chats o memoria.",
  "Activa recordatorios útiles para tratamientos, controles y próximos pasos.",
  "Comparte contexto con tu red de apoyo sin perder control sobre tus datos.",
];

const companyBenefits = [
  {
    title: "Carga clínica automática",
    description:
      "Resultados, recetas, órdenes e indicaciones pueden llegar al teléfono del usuario en una experiencia más clara y lista para activar seguimiento.",
  },
  {
    title: "Menos fricción operativa",
    description:
      "Klinip transforma documentos, citas, recordatorios y Voice en continuidad real sin depender de PDFs sueltos, llamados o reenvíos manuales.",
  },
  {
    title: "Más valor para la empresa",
    description:
      "Tu centro o programa ofrece una experiencia digital más moderna, trazable y útil para pacientes, colaboradores o beneficiarios.",
  },
];

const companyFlowItems = [
  "Resultados y exámenes",
  "Recetas e indicaciones",
  "Documentos con OCR",
  "Klinip Voice",
  "Recordatorios automáticos",
  "Permisos familiares",
];

const companyOutcomeItems = [
  "Más continuidad entre atención, hogar y seguimiento",
  "Mayor percepción de orden y servicio para el usuario",
  "Implementación compatible con programas, centros y beneficios de salud",
];

const showcaseIndicators = [
  "Salud del corazón",
  "Cognición",
  "Metabolismo",
  "Inflamación",
  "Equilibrio hormonal",
  "Aptitud física",
  "Más de 100 otros indicadores",
];

const moduleCards = [
  {
    title: "Documentos que activan seguimiento",
    eyebrow: "OCR clínico",
    description:
      "Sacas una foto y Klinip ordena recetas, órdenes o resultados para que dejen de ser archivos sueltos.",
    spotlight: "Del documento a un siguiente paso visible.",
    bullets: [
      "Historial ordenado por perfil",
      "Lectura contextual para entender qué importa",
      "Base para citas, recordatorios y continuidad",
    ],
    image: {
      src: "/landing/documentos-en-casa.jpg",
      fallback: "/landing/fallback-mi-salud.png",
      alt: "Documentos clínicos organizados dentro de Klinip.",
    },
  },
  {
    title: "Recordatorios para medicamentos y citas",
    eyebrow: "Adherencia diaria",
    description:
      "Klinip ayuda a transformar contexto clínico en recordatorios visibles para sostener tratamientos y controles.",
    spotlight: "Menos carga mental, más continuidad.",
    bullets: [
      "Tratamientos visibles en la rutina",
      "Citas y controles en una sola vista",
      "Alertas más claras para el día a día",
    ],
    image: {
      src: "/landing/fallback-home-hero.png",
      fallback: "/landing/fallback-home-hero.png",
      alt: "Recordatorios y seguimiento diario en Klinip.",
    },
  },
  {
    title: "Radar de salud",
    eyebrow: "Prioriza",
    description:
      "Muestra primero lo que necesita atención para que el usuario no navegue a ciegas entre demasiada información.",
    spotlight: "Lo importante aparece antes de que se pierda.",
    bullets: [
      "Señales clínicas visibles",
      "Prioridades del día con contexto",
      "Mejor continuidad entre consulta y hogar",
    ],
    image: {
      src: "/landing/fallback-radar-salud.png",
      fallback: "/landing/fallback-radar-salud.png",
      alt: "Radar de salud con prioridades visibles en Klinip.",
    },
  },
  {
    title: "Klinip Voice",
    eyebrow: "Consulta grabada",
    description:
      "Registra la consulta para generar una lectura simple para el usuario y otra más útil para compartir con el profesional cuando corresponde.",
    spotlight: "La consulta sigue viva después de salir del box.",
    bullets: [
      "Versión clara para entender en casa",
      "Versión compartible para continuidad profesional",
      "Más comprensión sin perder la fuente original",
    ],
    image: {
      src: "/landing/consulta-acompanada.jpg",
      fallback: "/landing/fallback-mi-salud.png",
      alt: "Consulta clínica acompañada con continuidad a través de Klinip Voice.",
    },
  },
  {
    title: "Red familiar privada",
    eyebrow: "Permisos y apoyo",
    description:
      "La red familiar existe para acompañar mejor, no para exponer información. Cada permiso responde a un contexto real de cuidado.",
    spotlight: "Compartir con criterio también es parte del cuidado.",
    bullets: [
      "Permisos por perfil y relación",
      "Actualizaciones privadas entre cuidadores",
      "Más coordinación sin improvisación",
    ],
    image: {
      src: "/landing/familia-cuidando.jpg",
      fallback: "/landing/fallback-familia-home.png",
      alt: "Familia y cuidadores siguiendo el proceso de salud desde Klinip.",
    },
  },
];

const trustCards = [
  {
    title: "Tu información sigue siendo tuya",
    description:
      "Klinip ordena y hace útil tu información de salud, pero no te quita control sobre ella ni la convierte en una caja negra.",
  },
  {
    title: "Privacidad por diseño",
    description:
      "Perfiles, permisos y red familiar están pensados para compartir con criterio, no para abrir información sensible sin contexto.",
  },
  {
    title: "IA que orienta, no reemplaza",
    description:
      "Klinip resume, explica y prioriza con contexto real. Las decisiones clínicas siguen siendo del usuario y del profesional.",
  },
  {
    title: "Voice con doble lectura útil",
    description:
      "Una versión más clara para el usuario y una versión más compartible para el profesional ayudan a sostener continuidad real.",
  },
];

const faqItems = [
  {
    q: "¿Klinip es para personas o también para empresas?",
    a: "Para ambos. Puede usarse como plataforma personal y familiar, y también como base para experiencias de salud, seguimiento o acompañamiento en organizaciones.",
  },
  {
    q: "¿Klinip reemplaza al profesional de salud?",
    a: "No. Klinip ayuda a organizar, entender y priorizar información clínica, pero no reemplaza evaluación médica profesional.",
  },
  {
    q: "¿Qué puedo centralizar en Klinip?",
    a: "Documentos, medicamentos, citas, recordatorios, contexto familiar y, cuando aplica, registros de Klinip Voice para continuidad posterior.",
  },
  {
    q: "¿Quién controla la información compartida?",
    a: "El usuario. Klinip trabaja con perfiles y permisos explícitos para que la información de salud se comparta solo con quienes corresponde.",
  },
];

const formatCount = (value) => `${new Intl.NumberFormat("es-CL").format(value)}+`;
const formatPercent = (value) => `${value}%`;

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 5 7 7-7 7" />
    </svg>
  );
}

const StatCard = ({ value, label }) => (
  <div className="landing-brand-stat">
    <strong>{value}</strong>
    <span>{label}</span>
  </div>
);

function LandingImage({ src, fallback, alt, className }) {
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    setCurrentSrc(src);
  }, [src]);

  return (
    <img
      className={className}
      src={currentSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (fallback && currentSrc !== fallback) {
          setCurrentSrc(fallback);
        }
      }}
    />
  );
}

export default function Landing({ theme = "light", onToggleTheme }) {
  const [stats, setStats] = useState(fallbackStats);
  const [billing, setBilling] = useState("monthly");
  const [plans, setPlans] = useState(PLAN_CATALOG);
  const [activeNavSection, setActiveNavSection] = useState("personas");
  const [openFaq, setOpenFaq] = useState(0);

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
      { rootMargin: "-30% 0px -50% 0px", threshold: [0.18, 0.4, 0.6] }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const nodes = Array.from(document.querySelectorAll(".landing-reveal"));
    if (!nodes.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.18 }
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const handleLandingNav = (sectionId) => {
    const target = document.getElementById(sectionId);
    if (!target) return;
    setActiveNavSection(sectionId);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const statItems = [
    { value: formatCount(stats.users), label: "personas usando Klinip" },
    { value: formatCount(stats.appointments), label: "citas coordinadas" },
    { value: formatCount(stats.reminders), label: "recordatorios enviados" },
    { value: formatPercent(stats.satisfaction), label: "satisfacción reportada" },
  ];

  return (
    <div className="landing-brand">
      <header className="landing-brand-nav">
        <div className="landing-brand-shell landing-brand-nav-inner">
          <Link className="landing-brand-logo-link" to="/">
            <BrandLogo
              className="brand-logo-landing brand-logo-keep-name-mobile landing-brand-logo"
              markClassName="landing-brand-logo-mark"
              nameClassName="landing-brand-logo-name"
              responsive
            />
          </Link>

          <nav className="landing-brand-nav-links" aria-label="Navegación de la landing">
            {LANDING_NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`landing-brand-nav-link ${activeNavSection === item.id ? "is-active" : ""}`}
                onClick={() => handleLandingNav(item.id)}
                aria-current={activeNavSection === item.id ? "page" : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="landing-brand-nav-actions">
            <button
              type="button"
              className="theme-toggle landing-brand-theme-toggle"
              onClick={() => onToggleTheme?.()}
              aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              aria-pressed={theme === "dark"}
            >
              <span className={`theme-switch ${theme === "dark" ? "is-dark" : ""}`}>
                <span className="theme-switch-thumb" />
              </span>
            </button>
            <Link className="landing-brand-btn is-ghost" to="/login">
              Iniciar sesión
            </Link>
            <Link className="landing-brand-btn is-primary" to="/register">
              Crear cuenta
            </Link>
          </div>
        </div>
      </header>

      <section className="landing-brand-hero">
        <div className="landing-brand-shell landing-brand-hero-grid">
          <div className="landing-brand-hero-copy landing-reveal">
            <div className="landing-brand-segmented" role="tablist" aria-label="Audiencias principales">
              <button type="button" className="landing-brand-segment is-active" onClick={() => handleLandingNav("personas")}>
                Personas
              </button>
              <button type="button" className="landing-brand-segment" onClick={() => handleLandingNav("empresas")}>
                Empresas
              </button>
            </div>

            <span className="landing-brand-eyebrow">Plataforma clínica personal y familiar</span>
            <h1>
              Klinip organiza la salud
              <span> con continuidad real.</span>
            </h1>
            <p className="landing-brand-lead">
              Centraliza documentos, medicamentos, citas, recordatorios, Klinip Voice y red familiar en una
              experiencia clara para personas y adaptable a empresas que necesitan acompañar mejor procesos de
              salud.
            </p>

            <div className="landing-brand-cta-row">
              <Link className="landing-brand-btn is-primary is-large" to="/register">
                Crear cuenta gratis
                <ArrowIcon />
              </Link>
              <button
                type="button"
                className="landing-brand-btn is-secondary is-large"
                onClick={() => handleLandingNav("planes")}
              >
                Ver planes
              </button>
            </div>

            <div className="landing-brand-highlights">
              {heroHighlights.map((item) => (
                <div key={item} className="landing-brand-highlight">
                  <span className="landing-brand-highlight-dot" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="landing-brand-stage landing-reveal">
            <div className="landing-brand-stage-photo">
              <LandingImage
                className="landing-brand-stage-image"
                src="/landing/hero-giselle.jpg"
                fallback="/landing/fallback-home-hero.png"
                alt="Paciente usando Klinip desde su hogar."
              />
              <div className="landing-brand-stage-chip">
                <span className="landing-brand-stage-chip-dot" aria-hidden="true" />
                <span>Tu información de salud sigue siendo tuya</span>
              </div>
              <div className="landing-brand-stage-photo-note">
                <small>Klinip en una sola vista</small>
                <strong>Documentos, recordatorios, Radar, voz clínica y red familiar conectados.</strong>
                <p>
                  Una experiencia diseñada para entender qué sigue, qué compartir y qué necesita atención
                  antes de que se pierda.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="landing-brand-shell landing-brand-proof landing-reveal">
          <div className="landing-brand-stats" aria-label="Indicadores principales">
            {statItems.map((item) => (
              <StatCard key={item.label} value={item.value} label={item.label} />
            ))}
          </div>
        </div>
      </section>

      <section className="landing-brand-section landing-brand-showcase">
        <div className="landing-brand-shell landing-brand-showcase-grid">
          <div className="landing-brand-showcase-copy landing-reveal">
            <span className="landing-brand-eyebrow">Lectura clara</span>
            <h2>
              Entiende tu salud <span>sin ser médico</span>
            </h2>
            <p>
              Klinip presenta resultados, contexto y progreso en una vista más clara para que la información
              clínica no se sienta lejana ni difícil de interpretar.
            </p>
            <p>
              Con una interfaz más simple, puedes ver señales importantes, revisar tu avance y entender mejor
              qué está pasando en tu salud y en cada función clave.
            </p>
            <div className="landing-brand-showcase-tags" aria-label="Áreas de salud">
              {showcaseIndicators.map((item) => (
                <span key={item} className="landing-brand-showcase-tag">
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="landing-brand-showcase-phones landing-reveal">
            <div className="landing-brand-phone landing-brand-phone-back">
              <div className="landing-brand-phone-notch" aria-hidden="true" />
              <LandingImage
                className="landing-brand-phone-screen"
                src="/landing/fallback-home-hero.png"
                fallback="/landing/fallback-home-hero.png"
                alt="Pantalla principal de Klinip en celular."
              />
            </div>
            <div className="landing-brand-phone landing-brand-phone-front">
              <div className="landing-brand-phone-notch" aria-hidden="true" />
              <LandingImage
                className="landing-brand-phone-screen"
                src="/landing/fallback-radar-salud.png"
                fallback="/landing/fallback-radar-salud.png"
                alt="Pantalla de indicadores y resultados de Klinip en celular."
              />
            </div>
          </div>
        </div>
      </section>

      <section id="personas" className="landing-brand-section">
        <div className="landing-brand-shell">
          <div className="landing-brand-split-card landing-reveal">
            <div className="landing-brand-split-copy">
              <span className="landing-brand-eyebrow">Personas</span>
              <h2>Para personas, familias y cuidadores que necesitan más claridad en su salud.</h2>
              <p>
                Klinip está pensado para el momento real del cuidado: cuando hay que entender un documento,
                seguir un tratamiento, recordar una cita o compartir contexto con alguien de confianza.
              </p>
            </div>
            <div className="landing-brand-split-list">
              {peopleBenefits.map((item) => (
                <div key={item} className="landing-brand-split-item">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="empresas" className="landing-brand-section landing-brand-section-soft">
        <div className="landing-brand-shell">
          <div className="landing-brand-enterprise landing-reveal">
            <div className="landing-brand-enterprise-layout">
              <div className="landing-brand-enterprise-head">
                <span className="landing-brand-eyebrow">Empresas</span>
                <h2>Presenta Klinip a la empresa como una experiencia de salud que sigue viva.</h2>
                <p>
                  Imagina poder conectar Klinip con tu centro, beneficio o programa para que la información
                  se cargue en el teléfono del usuario de forma automática, ordenada y lista para activar
                  seguimiento.
                </p>
                <p>
                  En vez de dejar la experiencia cortada en documentos sueltos o instrucciones que se pierden,
                  Klinip convierte cada atención en una capa digital más clara para la persona y más valiosa
                  para la empresa.
                </p>
                <div className="landing-brand-enterprise-actions">
                  <button
                    type="button"
                    className="landing-brand-btn is-secondary"
                    onClick={() => handleLandingNav("planes")}
                  >
                    Ver estructura comercial
                  </button>
                  <Link className="landing-brand-btn is-primary" to="/register">
                    Explorar Klinip
                    <ArrowIcon />
                  </Link>
                </div>
                <div className="landing-brand-enterprise-outcomes" aria-label="Beneficios para la empresa">
                  {companyOutcomeItems.map((item) => (
                    <div key={item} className="landing-brand-enterprise-outcome">
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="landing-brand-enterprise-visual" aria-label="Flujo de información para empresas">
                <div className="landing-brand-enterprise-flow">
                  <div className="landing-brand-enterprise-node is-source">
                    <small>Centro, empresa o programa</small>
                    <strong>La información clínica se origina donde ocurre la atención.</strong>
                    <span>Resultados, recetas, órdenes, indicaciones y contexto clínico.</span>
                  </div>

                  <div className="landing-brand-enterprise-core">
                    <span className="landing-brand-enterprise-core-label">Klinip</span>
                    <strong>Ordena, activa y contextualiza</strong>
                    <div className="landing-brand-enterprise-chip-list">
                      {companyFlowItems.map((item) => (
                        <span key={item} className="landing-brand-enterprise-chip">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="landing-brand-enterprise-node is-user">
                    <small>En el teléfono del usuario</small>
                    <strong>Todo aparece en una experiencia más comprensible y accionable.</strong>
                    <span>Recordatorios, historial, Voice, permisos y siguientes pasos en un mismo lugar.</span>
                  </div>
                </div>

                <div className="landing-brand-enterprise-ownership">
                  <strong>La empresa mejora la continuidad.</strong>
                  <span>El usuario sigue siendo dueño de su información de salud y decide cómo compartirla.</span>
                </div>
              </div>
            </div>

            <div className="landing-brand-enterprise-grid">
              {companyBenefits.map((item) => (
                <article key={item.title} className="landing-brand-enterprise-card">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="modulos" className="landing-brand-section">
        <div className="landing-brand-shell">
          <div className="landing-brand-section-head">
            <span className="landing-brand-eyebrow">Módulos Klinip</span>
            <h2>Una experiencia comercial clara, con pilares concretos y visibles.</h2>
            <p>
              Cada bloque responde a un uso real: sacar una foto, activar seguimiento, sostener tratamientos,
              entender consultas y compartir con criterio.
            </p>
          </div>

          <div className="landing-brand-module-grid">
            {moduleCards.map((item, index) => (
              <article
                key={item.title}
                className="landing-brand-module-card landing-reveal"
                style={{ "--reveal-delay": `${index * 80}ms` }}
              >
                <div className="landing-brand-module-media">
                  <LandingImage
                    className="landing-brand-module-image"
                    src={item.image.src}
                    fallback={item.image.fallback}
                    alt={item.image.alt}
                  />
                  <div className="landing-brand-module-media-overlay">
                    <span className="landing-brand-module-eyebrow">{item.eyebrow}</span>
                  </div>
                </div>
                <div className="landing-brand-module-body">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <div className="landing-brand-module-spotlight">{item.spotlight}</div>
                  <ul className="landing-brand-module-feature-list">
                    {item.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="confianza" className="landing-brand-section">
        <div className="landing-brand-shell">
          <div className="landing-brand-trust-panel landing-reveal">
            <div className="landing-brand-section-head is-on-dark">
              <span className="landing-brand-eyebrow is-on-dark">Confianza</span>
              <h2>Propiedad de datos, privacidad y continuidad antes que ruido visual.</h2>
              <p>
                Klinip usa tecnología para hacer más útil la información clínica, pero con foco en control,
                claridad y responsabilidad.
              </p>
            </div>

            <div className="landing-brand-ownership-banner">
              <strong>Eres dueño de tu información de salud.</strong>
              <span>
                Klinip la organiza, la vuelve más entendible y te ayuda a compartirla con criterio, pero no
                la transforma en algo ajeno a ti.
              </span>
            </div>

            <div className="landing-brand-trust-grid">
              {trustCards.map((item) => (
                <article key={item.title} className="landing-brand-trust-card">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="planes" className="landing-brand-section">
        <div className="landing-brand-shell">
          <div className="landing-brand-section-head">
            <span className="landing-brand-eyebrow">Planes</span>
            <h2>Empieza como persona y escala cuando el contexto lo necesite.</h2>
            <p>
              La estructura de planes acompaña el crecimiento del uso: desde una cuenta personal hasta una
              experiencia con más perfiles y colaboración familiar.
            </p>
          </div>

          <div className="landing-brand-pricing-toolbar">
            <div className="landing-brand-billing-toggle">
              <span className={billing === "monthly" ? "is-active" : ""}>Mensual</span>
              <button
                type="button"
                className={`landing-brand-billing-switch ${billing === "yearly" ? "is-yearly" : ""}`}
                onClick={() => setBilling((prev) => (prev === "monthly" ? "yearly" : "monthly"))}
                aria-label="Cambiar facturación"
              >
                <span className="landing-brand-billing-thumb" />
              </button>
              <span className={billing === "yearly" ? "is-active" : ""}>Anual</span>
            </div>
            <span className="landing-brand-billing-badge">Ahorra 2 meses</span>
          </div>

          <div className="landing-brand-pricing-grid">
            {plans.map((plan) => (
              <article
                key={plan.slug}
                className={`landing-brand-price-card ${plan.recommended ? "is-featured" : ""}`}
              >
                {plan.recommended ? <span className="landing-brand-price-rec">Más elegido</span> : null}
                <div className="landing-brand-price-top">
                  <div>
                    <div className="landing-brand-price-plan">{cleanUiText(plan.name)}</div>
                    <p className="landing-brand-price-note">{cleanUiText(plan.note)}</p>
                  </div>
                  <div className={`landing-brand-price-amount ${plan.slug === "basico" ? "is-free" : ""}`}>
                    {cleanUiText(billing === "monthly" ? plan.priceMonthly : plan.priceYearly)}
                  </div>
                </div>

                <p className="landing-brand-price-summary">{cleanUiText(plan.summary)}</p>

                <div className="landing-brand-price-metrics">
                  {Array.isArray(plan.metrics)
                    ? plan.metrics.map((metric) => (
                        <span key={`${metric.label}-${metric.value}`} className="landing-brand-metric-chip">
                          {cleanUiText(metric.label)}: {cleanUiText(metric.value)}
                        </span>
                      ))
                    : null}
                </div>

                <ul className="landing-brand-price-features">
                  {plan.features.map((feature) => (
                    <li key={feature}>{cleanUiText(feature)}</li>
                  ))}
                </ul>

                <div className="landing-brand-price-actions">
                  <Link className="landing-brand-btn is-primary" to={`/planes/${plan.slug}`}>
                    Ver detalle
                  </Link>
                  <Link className="landing-brand-btn is-ghost" to="/register">
                    {cleanUiText(plan.cta)}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-brand-section landing-brand-section-faq">
        <div className="landing-brand-shell landing-brand-shell-narrow">
          <div className="landing-brand-section-head">
            <span className="landing-brand-eyebrow">Preguntas frecuentes</span>
            <h2>Una landing clara también tiene que responder rápido.</h2>
          </div>

          <div className="landing-brand-faq">
            {faqItems.map((item, index) => {
              const open = openFaq === index;
              return (
                <div key={item.q} className={`landing-brand-faq-item ${open ? "is-open" : ""}`}>
                  <button
                    type="button"
                    className="landing-brand-faq-question"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : index)}
                  >
                    <span>{item.q}</span>
                    <span className="landing-brand-faq-icon" aria-hidden="true" />
                  </button>
                  <div className="landing-brand-faq-answer">
                    <p>{item.a}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="landing-brand-cta">
        <div className="landing-brand-shell">
          <div className="landing-brand-cta-card">
            <div>
              <span className="landing-brand-eyebrow is-on-dark">Empezar</span>
              <h2>Klinip se ve mejor cuando se entiende como un servicio real de continuidad.</h2>
              <p>
                Para personas, familias y futuros contextos empresariales, la promesa sigue siendo la misma:
                más claridad, más seguimiento y más control sobre la información de salud.
              </p>
            </div>
            <div className="landing-brand-cta-actions">
              <Link className="landing-brand-btn is-primary is-large" to="/register">
                Crear cuenta gratis
                <ArrowIcon />
              </Link>
              <Link className="landing-brand-btn is-dark-ghost is-large" to="/login">
                Ya tengo cuenta
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="landing-brand-footer">
        <div className="landing-brand-shell landing-brand-footer-inner">
          <div className="landing-brand-footer-brand">
            <BrandLogo
              className="brand-logo-landing brand-logo-keep-name-mobile"
              markClassName="landing-brand-logo-mark"
              nameClassName="landing-brand-logo-name"
              responsive
            />
            <span>Salud personal y familiar con más claridad, continuidad y contexto.</span>
          </div>
          <div className="landing-brand-footer-copy">&copy; 2026 Klinip. Todos los derechos reservados.</div>
        </div>
      </footer>
    </div>
  );
}
