import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLandingStats, getPublicPlans } from "../api";
import BrandLogo from "../components/BrandLogo";
import { PLAN_CATALOG } from "../data/plans";
import { cleanUiText } from "../utils/textEncoding";
import "./Landing.css";

const LANDING_NAV_ITEMS = [
  { id: "principios", label: "Principios" },
  { id: "recorrido", label: "Recorrido" },
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
  "Continuidad entre consulta, hogar y red de apoyo",
  "IA que orienta y prioriza sin reemplazar criterio médico",
  "Privacidad por perfil, permisos y contexto real",
];

const brandPrinciples = [
  {
    title: "Humana",
    description:
      "Habla claro, acompaña procesos sensibles y evita el tono frío de una herramienta que solo muestra datos.",
    tone: "blue",
  },
  {
    title: "Clara",
    description:
      "Ordena citas, medicamentos, documentos y prioridades para que cada siguiente paso sea fácil de entender.",
    tone: "sand",
  },
  {
    title: "Activa",
    description:
      "No se queda en almacenar información. Detecta señales, resume contexto y ayuda a actuar a tiempo.",
    tone: "green",
  },
  {
    title: "Compartida con criterio",
    description:
      "Integra a familia y cuidadores cuando hace falta, pero con permisos explícitos y foco clínico.",
    tone: "indigo",
  },
];

const journeySteps = [
  {
    eyebrow: "Antes y después de la consulta",
    title: "Lo importante queda conectado en vez de perderse entre papeles, chats y memoria.",
    description:
      "Klinip centraliza documentos, citas, medicamentos y tareas en el perfil correcto para que el seguimiento no dependa de recordar todo de nuevo.",
    bullets: [
      "Subida rápida de recetas, órdenes e informes",
      "Agenda clínica y recordatorios visibles desde el inicio",
      "Contexto listo para futuras consultas y controles",
    ],
    chips: ["Documentos activos", "Agenda clínica", "Perfil ordenado"],
    image: {
      src: "/landing/documentos-en-casa.jpg",
      fallback: "/landing/fallback-mi-salud.png",
      alt: "Persona revisando documentos clínicos con Klinip a mano.",
    },
  },
  {
    eyebrow: "Durante el seguimiento",
    title: "La app prioriza, explica y baja la carga mental de cuidar tu salud.",
    description:
      "Radar, adherencia y asistencia contextual se combinan para mostrar qué importa hoy, qué viene después y qué necesita atención antes de escalar.",
    bullets: [
      "Alertas y señales visibles en lenguaje simple",
      "Klinip IA orientativa con contexto del perfil activo",
      "Klinip Voice para transformar consultas en continuidad útil",
    ],
    chips: ["Radar", "Klinip IA", "Klinip Voice"],
    reverse: true,
    image: {
      src: "/landing/consulta-acompanada.jpg",
      fallback: "/landing/fallback-radar-salud.png",
      alt: "Paciente, familiar y profesional revisando información de salud en conjunto.",
    },
  },
  {
    eyebrow: "Cuando hay familia o cuidadores",
    title: "Acompañar se vuelve más coordinado, más privado y menos improvisado.",
    description:
      "Cada integrante autorizado puede ver el contexto que corresponde, seguir avances y ayudar sin convertir la salud en una conversación desordenada.",
    bullets: [
      "Colaboración familiar por permisos y roles",
      "Actualizaciones privadas para compartir avances reales",
      "Más continuidad entre quien consulta y quien acompaña",
    ],
    chips: ["Permisos por perfil", "Red familiar privada", "Seguimiento compartido"],
    image: {
      src: "/landing/familia-cuidando.jpg",
      fallback: "/landing/fallback-familia-home.png",
      alt: "Familia revisando juntos el seguimiento de salud desde Klinip.",
    },
  },
];

const moduleCards = [
  {
    title: "Radar de salud",
    description:
      "La capa que detecta prioridades, citas cercanas, adherencia y señales que no conviene dejar pasar.",
    eyebrow: "Prioriza",
    tone: "blue",
    icon: "radar",
    featured: true,
    bullets: ["Señales visibles", "Pendientes del día", "Seguimiento continuo"],
  },
  {
    title: "Documentos que activan acciones",
    description:
      "OCR clínico y lectura contextual para pasar de guardar archivos a entender qué hacer con ellos.",
    eyebrow: "Interpreta",
    tone: "sand",
    icon: "document",
  },
  {
    title: "Medicamentos y adherencia",
    description:
      "Tratamientos, horarios y reposiciones en una vista que ayuda a sostener el cuidado diario.",
    eyebrow: "Sostiene",
    tone: "green",
    icon: "pill",
  },
  {
    title: "Klinip Voice",
    description:
      "Convierte una consulta en un registro útil, entendible y compartible cuando el usuario lo autoriza.",
    eyebrow: "Escucha",
    tone: "indigo",
    icon: "voice",
  },
  {
    title: "Red familiar privada",
    description:
      "Un espacio cerrado para actualizaciones relevantes entre familia y cuidadores, no una red social abierta.",
    eyebrow: "Conecta",
    tone: "coral",
    icon: "family",
  },
  {
    title: "Asistente Klinip IA",
    description:
      "Explica, resume y orienta con contexto real del perfil activo sin prometer decisiones automáticas.",
    eyebrow: "Orienta",
    tone: "violet",
    icon: "spark",
  },
];

const trustCards = [
  {
    title: "Fuente original primero",
    description:
      "Documentos, agenda, registros y audio clínico siguen siendo la base. La IA interpreta encima de esa fuente, no la reemplaza.",
  },
  {
    title: "IA orientativa, no diagnóstica",
    description:
      "Klinip ayuda a entender y priorizar. Las decisiones clínicas siguen siendo del usuario y del profesional tratante.",
  },
  {
    title: "Privacidad por diseño",
    description:
      "Perfiles, permisos y contexto compartido existen para acompañar mejor, no para exponer información sensible.",
  },
];

const faqItems = [
  {
    q: "¿Klinip reemplaza a un profesional de salud?",
    a: "No. Klinip orienta, organiza y ayuda a entender el contexto clínico, pero no diagnostica ni reemplaza atención médica profesional.",
  },
  {
    q: "¿Sirve solo para una persona o también para familias?",
    a: "Funciona para ambos casos. Puedes empezar con un perfil personal y escalar a una experiencia con más perfiles, colaboración y red familiar.",
  },
  {
    q: "¿Qué tipo de información puedo centralizar?",
    a: "Citas, medicamentos, documentos, recordatorios, notas relevantes y, cuando corresponda, registros compartidos con cuidadores o familia.",
  },
  {
    q: "¿Necesito instalar una app?",
    a: "No necesariamente. Puedes usar Klinip desde el navegador y también acceder a una experiencia instalable según el dispositivo.",
  },
  {
    q: "¿La IA toma decisiones por mí?",
    a: "No. La IA resume, prioriza y explica. Klinip está diseñado para apoyar decisiones, no para tomarlas de forma autónoma.",
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

function ModuleIcon({ icon }) {
  switch (icon) {
    case "radar":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 12 17 7" />
        </svg>
      );
    case "document":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M14 3v6h5" />
          <path d="M10 13h6" />
          <path d="M10 17h4" />
        </svg>
      );
    case "pill":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m8 6 10 10" />
          <path d="M7.5 16.5a4.95 4.95 0 0 1 0-7l2-2a4.95 4.95 0 0 1 7 7l-2 2a4.95 4.95 0 0 1-7 0Z" />
        </svg>
      );
    case "voice":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3Z" />
          <path d="M7 11a5 5 0 0 0 10 0" />
          <path d="M12 16v4" />
          <path d="M9 20h6" />
        </svg>
      );
    case "family":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16.5 20v-1.2a3.3 3.3 0 0 0-3.3-3.3H8.8a3.3 3.3 0 0 0-3.3 3.3V20" />
          <circle cx="11" cy="8" r="3" />
          <path d="M18 20v-1a2.8 2.8 0 0 0-2.2-2.7" />
          <path d="M15.6 5.6a2.8 2.8 0 1 1 0 4" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m12 3 2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2Z" />
        </svg>
      );
  }
}

function BrandFlower() {
  return (
    <svg className="landing-brand-flower" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 17.5c7.18 0 13 5.82 13 13v8.41l7.28-4.2c6.21-3.59 14.15-1.46 17.74 4.75 3.59 6.21 1.46 14.15-4.75 17.74L76 61.4l7.27 4.2c6.21 3.59 8.34 11.53 4.75 17.74-3.59 6.21-11.53 8.34-17.74 4.75L63 83.9v8.4c0 7.19-5.82 13-13 13s-13-5.81-13-13v-8.4l-7.28 4.2c-6.21 3.59-14.15 1.46-17.74-4.75-3.59-6.21-1.46-14.15 4.75-17.74l7.27-4.2-7.27-4.2c-6.21-3.59-8.34-11.53-4.75-17.74 3.59-6.21 11.53-8.34 17.74-4.75l7.28 4.2V30.5c0-7.18 5.82-13 13-13Z" />
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
  const [activeNavSection, setActiveNavSection] = useState("principios");
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
      <BrandFlower />

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
          <div className="landing-brand-hero-copy">
            <span className="landing-brand-eyebrow">Continuidad de cuidados</span>
            <h1>
              Klinip ordena lo que pasa
              <span> entre la consulta y la vida real.</span>
            </h1>
            <p className="landing-brand-lead">
              Centraliza documentos, medicamentos, citas, recordatorios, voz clínica y acompañamiento
              familiar en un espacio privado que ayuda a entender, priorizar y actuar con más contexto.
            </p>

            <div className="landing-brand-cta-row">
              <Link className="landing-brand-btn is-primary is-large" to="/register">
                Crear cuenta gratis
                <ArrowIcon />
              </Link>
              <button
                type="button"
                className="landing-brand-btn is-secondary is-large"
                onClick={() => handleLandingNav("recorrido")}
              >
                Ver el recorrido
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

            <div className="landing-brand-stats" aria-label="Indicadores principales">
              {statItems.map((item) => (
                <StatCard key={item.label} value={item.value} label={item.label} />
              ))}
            </div>
          </div>

          <div className="landing-brand-stage">
            <div className="landing-brand-stage-panel">
              <div className="landing-brand-stage-head">
                <BrandLogo
                  className="landing-brand-stage-logo"
                  markClassName="landing-brand-stage-logo-mark"
                  nameClassName="landing-brand-stage-logo-name"
                  variant="transparent"
                  responsive
                />
                <span>Continuidad activa</span>
              </div>

              <div className="landing-brand-stage-priority">
                <div>
                  <small>Prioridad de hoy</small>
                  <strong>Consulta mañana 09:30</strong>
                </div>
                <span className="landing-brand-stage-badge">Radar activo</span>
              </div>

              <div className="landing-brand-stage-list">
                <div className="landing-brand-stage-item">
                  <span className="landing-brand-stage-item-dot is-blue" aria-hidden="true" />
                  <div>
                    <strong>Documento leído</strong>
                    <p>Receta vinculada a tratamiento y próxima reposición.</p>
                  </div>
                </div>
                <div className="landing-brand-stage-item">
                  <span className="landing-brand-stage-item-dot is-green" aria-hidden="true" />
                  <div>
                    <strong>Red familiar coordinada</strong>
                    <p>Dos personas autorizadas siguiendo el mismo proceso.</p>
                  </div>
                </div>
                <div className="landing-brand-stage-item">
                  <span className="landing-brand-stage-item-dot is-gold" aria-hidden="true" />
                  <div>
                    <strong>Consulta con contexto</strong>
                    <p>Antecedentes, recordatorios y voz clínica en el mismo flujo.</p>
                  </div>
                </div>
              </div>

              <div className="landing-brand-stage-footer">
                <div className="landing-brand-mini-card">
                  <small>Klinip Voice</small>
                  <strong>Resumen claro</strong>
                </div>
                <div className="landing-brand-mini-card">
                  <small>Familia</small>
                  <strong>Permisos activos</strong>
                </div>
              </div>
            </div>

            <div className="landing-brand-stage-photo">
              <LandingImage
                className="landing-brand-stage-image"
                src="/landing/hero-giselle.jpg"
                fallback="/landing/fallback-home-hero.png"
                alt="Paciente usando Klinip desde su hogar."
              />
              <div className="landing-brand-stage-photo-note">
                <small>Diseñado para el día a día</small>
                <strong>Menos fricción, más claridad</strong>
              </div>
            </div>

            <div className="landing-brand-floating-card is-left">
              <span>Perfil personal y familiar</span>
            </div>
            <div className="landing-brand-floating-card is-right">
              <span>IA orientativa con contexto real</span>
            </div>
          </div>
        </div>
      </section>

      <section id="principios" className="landing-brand-section">
        <div className="landing-brand-shell">
          <div className="landing-brand-principles-layout">
            <div className="landing-brand-quote-card">
              <span className="landing-brand-eyebrow">Principios de marca</span>
              <h2>Klinip no es solo una agenda ni solo un chatbot.</h2>
              <p>
                Es una plataforma de salud personal y familiar pensada para acompañar mejor lo que ocurre
                fuera del box médico: cuando toca entender, recordar, coordinar y seguir cuidando.
              </p>
              <div className="landing-brand-quote-line">
                Escucha el contexto clínico, entiende el historial y ayuda a actuar antes de que el problema
                escale.
              </div>
            </div>

            <div className="landing-brand-principles-grid">
              {brandPrinciples.map((item) => (
                <article
                  key={item.title}
                  className={`landing-brand-principle-card tone-${item.tone}`}
                >
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="recorrido" className="landing-brand-section landing-brand-section-soft">
        <div className="landing-brand-shell">
          <div className="landing-brand-section-head">
            <span className="landing-brand-eyebrow">Recorrido Klinip</span>
            <h2>La salud se ordena mejor cuando cada etapa conversa con la siguiente.</h2>
            <p>
              La experiencia de Klinip está pensada como continuidad: capturar, interpretar, priorizar y
              acompañar sin perder de vista a la persona, su contexto y su red de apoyo.
            </p>
          </div>

          <div className="landing-brand-journey-list">
            {journeySteps.map((step, index) => (
              <article
                key={step.title}
                className={`landing-brand-journey-card ${step.reverse ? "is-reverse" : ""}`}
              >
                <div className="landing-brand-journey-media">
                  <LandingImage
                    className="landing-brand-journey-image"
                    src={step.image.src}
                    fallback={step.image.fallback}
                    alt={step.image.alt}
                  />
                </div>
                <div className="landing-brand-journey-content">
                  <span className="landing-brand-journey-step">0{index + 1}</span>
                  <span className="landing-brand-eyebrow">{step.eyebrow}</span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                  <ul className="landing-brand-journey-bullets">
                    {step.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                  <div className="landing-brand-chip-row">
                    {step.chips.map((chip) => (
                      <span key={chip} className="landing-brand-chip">
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="modulos" className="landing-brand-section">
        <div className="landing-brand-shell">
          <div className="landing-brand-section-head">
            <span className="landing-brand-eyebrow">Módulos reales</span>
            <h2>El producto ya tiene piezas concretas para convertir información clínica en acción útil.</h2>
            <p>
              Klinip integra módulos que se potencian entre sí: agenda, adherencia, documentos, IA, voz
              clínica y colaboración familiar dentro de un mismo lenguaje visual y funcional.
            </p>
          </div>

          <div className="landing-brand-module-grid">
            {moduleCards.map((item) => (
              <article
                key={item.title}
                className={`landing-brand-module-card tone-${item.tone} ${item.featured ? "is-featured" : ""}`}
              >
                <div className="landing-brand-module-icon" aria-hidden="true">
                  <ModuleIcon icon={item.icon} />
                </div>
                <span className="landing-brand-module-eyebrow">{item.eyebrow}</span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                {item.featured ? (
                  <div className="landing-brand-module-feature">
                    <div className="landing-brand-module-meter">
                      <span className="is-strong" />
                      <span className="is-medium" />
                      <span className="is-soft" />
                    </div>
                    <ul className="landing-brand-module-feature-list">
                      {item.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="confianza" className="landing-brand-section">
        <div className="landing-brand-shell">
          <div className="landing-brand-trust-panel">
            <div className="landing-brand-section-head is-on-dark">
              <span className="landing-brand-eyebrow is-on-dark">Confianza y criterio</span>
              <h2>Tecnología con criterio clínico, no con promesas vacías.</h2>
              <p>
                Klinip se presenta como un sistema de apoyo que interpreta señales, organiza contexto y
                acompaña procesos sensibles con reglas claras de privacidad y responsabilidad.
              </p>
            </div>

            <div className="landing-brand-trust-flow" aria-label="Flujo de confianza de Klinip">
              <div className="landing-brand-trust-flow-step">
                <strong>Señal clínica</strong>
                <span>Documento, consulta, cita o actualización familiar.</span>
              </div>
              <div className="landing-brand-trust-flow-step">
                <strong>Contexto del perfil</strong>
                <span>Klinip cruza historial, adherencia, agenda y permisos.</span>
              </div>
              <div className="landing-brand-trust-flow-step">
                <strong>Acción clara</strong>
                <span>Resume, prioriza y orienta el siguiente paso con lenguaje comprensible.</span>
              </div>
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
            <h2>Empieza con tu propio cuidado y suma más contexto cuando lo necesites.</h2>
            <p>
              El catálogo acompaña la forma en que crece el uso real de Klinip: desde un perfil personal
              hasta una coordinación familiar con mayor colaboración.
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
            <h2>Klinip está pensado para acompañar procesos reales de salud, no para verse futurista.</h2>
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
              <span className="landing-brand-eyebrow is-on-dark">Empieza hoy</span>
              <h2>Una plataforma clínica personal se vuelve valiosa cuando también acompaña lo cotidiano.</h2>
              <p>
                Empieza con tu propio perfil y escala a familia, cuidadores y más contexto cuando tu proceso
                de salud lo necesite.
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
