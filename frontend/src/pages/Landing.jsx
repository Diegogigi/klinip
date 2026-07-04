import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLandingStats, getPublicPlans } from "../api";
import BrandLogo from "../components/BrandLogo";
import { PLAN_CATALOG } from "../data/plans";
import { cleanUiText } from "../utils/textEncoding";
import "./Landing.css";

const AUDIENCE_SWITCH_ITEMS = [
  { id: "people", label: "Personas", to: "/personas" },
  { id: "business", label: "Empresas", to: "/empresas" },
];

const PEOPLE_LANDING_NAV_ITEMS = [
  { id: "personas", label: "Personas" },
  { id: "modulos", label: "Módulos" },
  { id: "confianza", label: "Confianza" },
  { id: "planes", label: "Planes" },
];

const BUSINESS_LANDING_NAV_ITEMS = [
  { id: "empresas", label: "Empresas" },
  { id: "modulos", label: "Capacidades" },
  { id: "confianza", label: "Confianza" },
  { id: "faq", label: "Preguntas" },
];

const fallbackStats = {
  users: 1200,
  appointments: 15000,
  reminders: 50000,
  satisfaction: 98,
};

const peopleHeroHighlights = [
  "Información clínica, cobertura y documentos en un mismo lugar",
  "IA que explica tu información en lenguaje simple, sin reemplazar al profesional",
  "Permisos explícitos para compartir con familia y cuidadores autorizados",
];

const businessHeroHighlights = [
  "Resultados, recetas y seguimiento en una sola experiencia para la persona usuaria",
  "Continuidad visible después de cada atención, beneficio o programa",
  "Permisos claros y propiedad de datos respetada en todo el flujo",
];

const businessHeroSteps = [
  {
    title: "La atención ocurre",
    description: "Recetas, resultados e indicaciones se generan en el momento clínico o del beneficio.",
  },
  {
    title: "Klinip ordena",
    description: "La información se convierte en seguimiento claro, recordatorios y próximos pasos.",
  },
  {
    title: "La persona continúa",
    description: "Todo llega a su teléfono sin mezclar la operación interna con la experiencia personal.",
  },
];

const peopleBenefits = [
  "Organiza tu salud sin depender de portales, papeles, chats o memoria.",
  "Activa recordatorios útiles para tratamientos, controles y próximos pasos.",
  "Comparte contexto con tu red de apoyo sin perder control sobre tus datos.",
];

const neutralLayerCards = [
  {
    title: "Independiente del prestador",
    description:
      "Klinip no reemplaza la ficha clínica ni el sistema de una clínica. Te ayuda a reunir lo que recibes y usarlo mejor.",
  },
  {
    title: "Independiente de la Isapre o Fonasa",
    description:
      "Puedes ordenar bonos, reembolsos, licencias, coberturas y documentos del seguro sin depender de un solo portal.",
  },
  {
    title: "Centrada en la persona",
    description:
      "La información se explica en simple y se comparte solo con familiares o cuidadores autorizados por el usuario.",
  },
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

const businessCapabilityCards = [
  {
    eyebrow: "Documentos",
    title: "Resultados, recetas y órdenes con continuidad",
    description: "Klinip transforma archivos clínicos en información visible, organizada y lista para seguimiento.",
  },
  {
    eyebrow: "Seguimiento",
    title: "Recordatorios y próximos pasos activados",
    description: "La persona usuaria recibe una experiencia clara para sostener tratamientos, controles y acciones pendientes.",
  },
  {
    eyebrow: "Acompañamiento",
    title: "Contexto compartible sin perder control",
    description: "Permisos, historial y apoyo familiar siguen reglas claras para no romper la privacidad.",
  },
];

const businessTrustCards = [
  {
    title: "La organización no se adueña del dato",
    description: "Klinip extiende la continuidad sin transferir la propiedad de la información personal de salud.",
  },
  {
    title: "Permisos claros para cada flujo",
    description: "La experiencia define qué se comparte, con quién y para qué, evitando accesos ambiguos.",
  },
  {
    title: "Más claridad para la persona usuaria",
    description: "La continuidad funciona mejor cuando las indicaciones, documentos y recordatorios se entienden de inmediato.",
  },
];

const businessImageCards = [
  {
    title: "Implementación en terreno",
    description: "Klinip puede vivir dentro de campañas, programas y puntos de atención donde la continuidad necesita verse.",
    image: {
      src: "/landing/empresa-uno.jpeg",
      fallback: "/landing/empresa-uno.jpeg",
      alt: "Equipo de salud mostrando Klinip durante una jornada de vacunación y acompañamiento en terreno.",
    },
  },
  {
    title: "Acompañamiento en puntos de atención",
    description: "La experiencia también sirve para orientar personas usuarias y activar seguimiento desde espacios presenciales.",
    image: {
      src: "/landing/empresa-dos.jpeg",
      fallback: "/landing/empresa-dos.jpeg",
      alt: "Equipo de salud presentando Klinip a personas usuarias en un punto de atención presencial.",
    },
  },
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
    eyebrow: "Lee y ordena documentos",
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
      fallback: "/landing/fallback-mi-salud.jpeg",
      alt: "Documentos clínicos organizados dentro de Klinip.",
      style: { objectPosition: "center 30%" },
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
      src: "/landing/hero-giselle.jpeg",
      fallback: "/landing/hero-giselle.jpeg",
      alt: "Persona usando Klinip para seguir medicamentos, citas y recordatorios diarios.",
      style: { objectPosition: "center 24%" },
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
      src: "/landing/empresa-dos.jpeg",
      fallback: "/landing/empresa-dos.jpeg",
      alt: "Personas recibiendo orientación de salud con Klinip para priorizar lo importante.",
      style: { objectPosition: "center 38%" },
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
      fallback: "/landing/consulta-acompanada.jpg",
      alt: "Consulta clínica acompañada con continuidad a través de Klinip Voice.",
      style: { objectPosition: "center 32%" },
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
      fallback: "/landing/familia-cuidando.jpg",
      alt: "Familia y cuidadores siguiendo el proceso de salud desde Klinip.",
      style: { objectPosition: "center 26%" },
    },
  },
  {
    title: "Cobertura y trámites de salud",
    eyebrow: "Isapre, Fonasa y seguro",
    description:
      "Ordena documentos de cobertura, bonos, reembolsos, licencias y copagos para entender mejor el costo real de tu salud.",
    spotlight: "La parte clínica y la parte financiera dejan de vivir separadas.",
    bullets: [
      "Documentos de cobertura junto al historial",
      "Base para explicar copagos y reembolsos",
      "Preparado para futuras integraciones",
    ],
    image: {
      src: "/landing/documentos-en-casa.jpg",
      fallback: "/landing/fallback-mi-salud.jpeg",
      alt: "Documentos de salud y cobertura ordenados dentro de Klinip.",
      style: { objectPosition: "center 42%" },
    },
  },
];

const trustCards = [
  {
    title: "Tus datos siguen siendo tuyos",
    description: "Klinip organiza tu información para usarla mejor, sin quitarte control sobre ella.",
  },
  {
    title: "Privacidad por diseño",
    description: "Perfiles, permisos y red familiar ayudan a compartir con criterio y sin exponer de más.",
  },
  {
    title: "Más claridad, menos olvido",
    description: "Documentos, recordatorios y Voice ayudan a mantener continuidad después de cada atención.",
  },
];

const faqItems = [
  {
    q: "¿Klinip sirve si cuido mi salud y también acompaño a otra persona?",
    a: "Sí. Klinip está pensado para personas, familias y cuidadores que necesitan ordenar documentos, tratamientos, citas y contexto compartido.",
  },
  {
    q: "¿Klinip reemplaza al profesional de salud?",
    a: "No. Klinip ayuda a organizar, entender y priorizar información clínica, pero no reemplaza evaluación médica profesional.",
  },
  {
    q: "¿Qué puedo centralizar en Klinip?",
    a: "Documentos clínicos, medicamentos, citas, recordatorios, contexto familiar y documentos de cobertura como bonos, reembolsos o licencias.",
  },
  {
    q: "¿Quién controla la información compartida?",
    a: "El usuario. Klinip trabaja con perfiles y permisos explícitos para que la información de salud se comparta solo con quienes corresponde.",
  },
];

const businessFaqItems = [
  {
    q: "¿Qué tipo de organización puede usar Klinip Empresas?",
    a: "Centros, programas, beneficios corporativos y equipos que quieren extender la continuidad del cuidado más allá del momento de atención.",
  },
  {
    q: "¿La empresa pasa a ser dueña de los datos personales de salud?",
    a: "No. Klinip mantiene la propiedad de datos en la persona usuaria y trabaja con permisos claros para cada flujo de información.",
  },
  {
    q: "¿Klinip reemplaza los sistemas clínicos existentes?",
    a: "No necesariamente. Puede complementar la operación existente y convertir documentos, indicaciones y recordatorios en una experiencia más clara para seguimiento.",
  },
  {
    q: "¿Qué recibe la persona usuaria al final del flujo?",
    a: "Una experiencia única para revisar documentos, tratamientos, recordatorios, contexto y siguientes pasos desde su teléfono.",
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

function LandingImage({ src, fallback, alt, className, style }) {
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    setCurrentSrc(src);
  }, [src]);

  return (
    <img
      className={className}
      src={currentSrc}
      alt={alt}
      style={style}
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

export default function Landing({ theme = "light", onToggleTheme, audience = "people" }) {
  const isBusinessAudience = audience === "business";
  const landingNavItems = isBusinessAudience
    ? BUSINESS_LANDING_NAV_ITEMS
    : PEOPLE_LANDING_NAV_ITEMS;
  const [stats, setStats] = useState(fallbackStats);
  const [billing, setBilling] = useState("monthly");
  const [plans, setPlans] = useState(PLAN_CATALOG);
  const [activeNavSection, setActiveNavSection] = useState(landingNavItems[0].id);
  const [openFaq, setOpenFaq] = useState(null);

  const heroHighlights = isBusinessAudience ? businessHeroHighlights : peopleHeroHighlights;
  const faqEntries = isBusinessAudience ? businessFaqItems : faqItems;
  const statItems = [
    { value: formatCount(stats.users), label: "personas usando Klinip" },
    { value: formatCount(stats.appointments), label: "citas coordinadas" },
    { value: formatCount(stats.reminders), label: "recordatorios enviados" },
    { value: formatPercent(stats.satisfaction), label: "satisfacción reportada" },
  ];

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
    setActiveNavSection(landingNavItems[0].id);
  }, [landingNavItems]);

  useEffect(() => {
    const sections = landingNavItems.map((item) => document.getElementById(item.id)).filter(Boolean);
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
  }, [landingNavItems]);

  useEffect(() => {
    const revealAll = () =>
      document
        .querySelectorAll(".landing-reveal:not(.is-visible)")
        .forEach((node) => node.classList.add("is-visible"));

    // Sin IntersectionObserver: mostrar todo de inmediato.
    if (typeof IntersectionObserver === "undefined") {
      revealAll();
      return undefined;
    }

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
      // Umbral 0 + margen amplio: dispara fácil al acercarse (clave en móvil).
      { rootMargin: "0px 0px 12% 0px", threshold: 0 }
    );

    nodes.forEach((node) => observer.observe(node));

    // Red de seguridad: si el observer no revela algo (móvil, contenido que
    // aparece después), igual se muestra para que NINGUNA imagen quede invisible.
    const safety = window.setTimeout(revealAll, 2500);

    return () => {
      observer.disconnect();
      window.clearTimeout(safety);
    };
  }, [audience]);

  const handleLandingNav = (sectionId) => {
    const target = document.getElementById(sectionId);
    if (!target) return;
    setActiveNavSection(sectionId);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="landing-brand">
      <header className="landing-brand-nav">
        <div className="landing-brand-shell landing-brand-nav-inner">
          <Link className="landing-brand-logo-link" to="/personas">
            <BrandLogo
              className="brand-logo-landing brand-logo-keep-name-mobile landing-brand-logo"
              markClassName="landing-brand-logo-mark"
              nameClassName="landing-brand-logo-name"
              responsive
            />
          </Link>

          <nav className="landing-brand-nav-links" aria-label="Navegación de la landing">
            {landingNavItems.map((item) => (
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
        {isBusinessAudience ? (
          <div className="landing-brand-shell landing-brand-hero-grid">
            <div className="landing-brand-hero-copy landing-reveal">
              <div className="landing-brand-segmented" role="tablist" aria-label="Audiencias principales">
                {AUDIENCE_SWITCH_ITEMS.map((item) => (
                  <Link
                    key={item.id}
                    className={`landing-brand-segment ${
                      (item.id === "business") === isBusinessAudience ? "is-active" : ""
                    }`}
                    to={item.to}
                    aria-current={(item.id === "business") === isBusinessAudience ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              <span className="landing-brand-eyebrow">Continuidad clínica para organizaciones</span>
              <h1>
                Klinip conecta la atención
                <span> con seguimiento real.</span>
              </h1>
              <p className="landing-brand-lead">
                Lleva resultados, recetas, indicaciones y recordatorios a una experiencia clara para la persona
                usuaria, sin mezclar la operación de tu organización con la experiencia personal.
              </p>

              <div className="landing-brand-cta-row">
                <Link className="landing-brand-btn is-primary is-large" to="/register">
                  Explorar solución
                  <ArrowIcon />
                </Link>
                <button
                  type="button"
                  className="landing-brand-btn is-secondary is-large"
                  onClick={() => handleLandingNav("modulos")}
                >
                  Ver capacidades
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

            <div className="landing-brand-business-panel landing-reveal">
              <span className="landing-brand-business-panel-kicker">Cómo funciona Klinip Empresas</span>
              <h2>Una propuesta más simple para continuidad, seguimiento y claridad.</h2>
              <p>
                La organización entrega contexto. Klinip lo convierte en una experiencia entendible para la
                persona usuaria sin mostrar la interfaz interna de la empresa.
              </p>
              <div className="landing-brand-business-steps" aria-label="Proceso de Klinip Empresas">
                {businessHeroSteps.map((item, index) => (
                  <article key={item.title} className="landing-brand-business-step">
                    <span className="landing-brand-business-step-index">0{index + 1}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                  </article>
                ))}
              </div>
              <div className="landing-brand-business-note">
                <strong>La persona usuaria sigue controlando su información.</strong>
                <span>Klinip mejora la continuidad, no cambia la propiedad del dato.</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="landing-brand-shell landing-brand-shell-hero-bleed">
            <div className="landing-brand-hero-immersive landing-reveal">
              <LandingImage
                className="landing-brand-hero-immersive-image"
                src="/landing/hero-giselle.jpeg"
                fallback="/landing/hero-giselle.jpeg"
                alt="Paciente usando Klinip desde su hogar con su información de salud organizada."
              />
              <div className="landing-brand-hero-immersive-overlay">
                <div className="landing-brand-segmented" role="tablist" aria-label="Audiencias principales">
                  {AUDIENCE_SWITCH_ITEMS.map((item) => (
                    <Link
                      key={item.id}
                      className={`landing-brand-segment ${
                        (item.id === "business") === isBusinessAudience ? "is-active" : ""
                      }`}
                      to={item.to}
                      aria-current={(item.id === "business") === isBusinessAudience ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
                <span className="landing-brand-eyebrow">Plataforma neutral de salud personal</span>
                <h1>
                  Tu salud no debería vivir repartida
                  <span> entre portales y PDFs.</span>
                </h1>
                <p className="landing-brand-lead">
                  Klinip reúne información clínica, cobertura, citas, documentos y red familiar autorizada en una
                  experiencia independiente del prestador, Isapre o Fonasa.
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
              </div>
              <div className="landing-brand-stage-chip landing-brand-stage-chip-hero">
                <span className="landing-brand-stage-chip-dot" aria-hidden="true" />
                <span>Tu información de salud sigue siendo tuya</span>
              </div>
              <div className="landing-brand-stage-photo-note landing-brand-stage-photo-note-hero">
                <small>Klinip como capa central</small>
                <strong>Clínica, cobertura, IA y familia autorizada conectadas alrededor del usuario.</strong>
                <p>
                  Una experiencia diseñada para entender qué sigue, qué documento importa y qué compartir sin
                  perder control.
                </p>
              </div>
            </div>
          </div>
        )}

        {!isBusinessAudience ? (
          <div className="landing-brand-shell landing-brand-proof landing-reveal">
            <div className="landing-brand-stats" aria-label="Indicadores principales">
              {statItems.map((item) => (
                <StatCard key={item.label} value={item.value} label={item.label} />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {!isBusinessAudience ? (
        <>
          <section className="landing-brand-section landing-brand-neutral-layer">
            <div className="landing-brand-shell">
              <div className="landing-brand-neutral-panel landing-reveal">
                <div className="landing-brand-section-head">
                  <span className="landing-brand-eyebrow">Capa neutral</span>
                  <h2>Una plataforma centrada en el usuario, no en el portal donde quedó la información.</h2>
                  <p>
                    Klinip ayuda a unir datos dispersos, explicarlos con IA y compartirlos con familia autorizada,
                    aunque cada clínica, Isapre, Fonasa o laboratorio siga usando su propio sistema.
                  </p>
                </div>
                <div className="landing-brand-simple-grid landing-brand-neutral-grid">
                  {neutralLayerCards.map((item) => (
                    <article key={item.title} className="landing-brand-simple-card landing-brand-neutral-card">
                      <span className="landing-brand-simple-card-kicker">Neutral</span>
                      <h3>{item.title}</h3>
                      <p>{item.description}</p>
                    </article>
                  ))}
                </div>
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
                    src="/landing/fallback-home-hero.jpeg"
                    fallback="/landing/fallback-home-hero.jpeg"
                    alt="Pantalla principal de Klinip con centro de control diario y seguimiento."
                  />
                </div>
                <div className="landing-brand-phone landing-brand-phone-front">
                  <div className="landing-brand-phone-notch" aria-hidden="true" />
                  <LandingImage
                    className="landing-brand-phone-screen"
                    src="/landing/fallback-confirmacion-home.jpeg"
                    fallback="/landing/fallback-confirmacion-home.jpeg"
                    alt="Pantalla de confirmación y resumen diario de Klinip."
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
                    seguir un tratamiento, revisar cobertura, recordar una cita o compartir contexto con alguien
                    de confianza.
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
        </>
      ) : (
        <section id="empresas" className="landing-brand-section landing-brand-section-soft">
          <div className="landing-brand-shell">
            <div className="landing-brand-section-head landing-reveal">
              <span className="landing-brand-eyebrow">Empresas</span>
              <h2>Una landing empresarial más directa, separada de la experiencia de personas.</h2>
              <p>
                Klinip Empresas está pensada para organizaciones que necesitan continuidad visible sin mezclar
                su operación con la interfaz personal del usuario final.
              </p>
            </div>
            <figure className="landing-brand-enterprise-hero landing-reveal">
              <LandingImage
                className="landing-brand-enterprise-hero-image"
                src="/landing/empresa-ecosistema.jpeg"
                fallback="/landing/empresa-ecosistema.jpeg"
                alt="Ecosistema Klinip Empresas: continuidad entre la atención, el hogar y el seguimiento de cada persona."
              />
            </figure>
            <div className="landing-brand-enterprise-gallery">
              {businessImageCards.map((item) => (
                <article key={item.title} className="landing-brand-enterprise-media-card landing-reveal">
                  <LandingImage
                    className="landing-brand-enterprise-media-image"
                    src={item.image.src}
                    fallback={item.image.fallback}
                    alt={item.image.alt}
                  />
                  <div className="landing-brand-enterprise-media-body">
                    <span className="landing-brand-simple-card-kicker">Terreno</span>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="landing-brand-simple-grid landing-brand-simple-grid-enterprise">
              {companyBenefits.map((item) => (
                <article key={item.title} className="landing-brand-simple-card landing-reveal">
                  <span className="landing-brand-simple-card-kicker">Valor</span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
              {companyOutcomeItems.map((item) => (
                <article key={item} className="landing-brand-simple-card landing-reveal">
                  <span className="landing-brand-simple-card-kicker">Resultado</span>
                  <h3>{item}</h3>
                  <p>La continuidad se vuelve más clara para la organización y más útil para la persona usuaria.</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section id="modulos" className="landing-brand-section">
        <div className="landing-brand-shell">
          <div className="landing-brand-section-head">
            <span className="landing-brand-eyebrow">
              {isBusinessAudience ? "Capacidades clave" : "Módulos Klinip"}
            </span>
            {isBusinessAudience ? (
              <>
                <h2>Solo lo esencial para una propuesta empresarial clara.</h2>
                <p>
                  La versión de empresas resume las capacidades principales sin repetir toda la narrativa de la
                  landing de personas.
                </p>
              </>
            ) : (
              <>
                <h2>Una experiencia personal clara, con pilares concretos y visibles.</h2>
                <p>
                  Cada bloque responde a un uso real: sacar una foto, activar seguimiento, sostener tratamientos,
                  entender consultas, ordenar cobertura y compartir con criterio.
                </p>
              </>
            )}
          </div>

          {isBusinessAudience ? (
            <div className="landing-brand-simple-grid landing-brand-simple-grid-capabilities">
              {businessCapabilityCards.map((item) => (
                <article key={item.title} className="landing-brand-simple-card landing-reveal">
                  <span className="landing-brand-simple-card-kicker">{item.eyebrow}</span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          ) : (
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
                      style={item.image.style}
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
          )}
        </div>
      </section>

      <section id="confianza" className="landing-brand-section">
        <div className="landing-brand-shell">
          {isBusinessAudience ? (
            <>
              <div className="landing-brand-section-head landing-reveal">
                <span className="landing-brand-eyebrow">Confianza</span>
                <h2>Privacidad y propiedad de datos con una explicación simple.</h2>
                <p>
                  La propuesta empresarial debe dejar claro desde el inicio que la continuidad no elimina el
                  control de la persona usuaria sobre su información.
                </p>
              </div>
              <div className="landing-brand-ownership-banner landing-brand-ownership-banner-business landing-reveal">
                <strong>La persona usuaria sigue siendo dueña de su información de salud.</strong>
                <span>
                  Klinip organiza la información, la vuelve más entendible y permite compartirla con criterio,
                  sin transferir su control a la organización.
                </span>
              </div>
              <div className="landing-brand-simple-grid landing-brand-simple-grid-trust">
                {businessTrustCards.map((item) => (
                  <article key={item.title} className="landing-brand-simple-card landing-reveal">
                    <span className="landing-brand-simple-card-kicker">Confianza</span>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="landing-brand-trust-panel landing-reveal">
              <div className="landing-brand-section-head is-on-dark">
                <span className="landing-brand-eyebrow is-on-dark">Confianza</span>
                <h2>Tus datos de salud siguen siendo tuyos.</h2>
                <p>Klinip te ayuda a entender, ordenar y compartir mejor tu información, sin quitarte control.</p>
              </div>

              <div className="landing-brand-ownership-banner">
                <strong>Privacidad clara y continuidad real.</strong>
                <span>La información se organiza para ayudarte, no para volverse ajena a ti.</span>
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
          )}
        </div>
      </section>

      {!isBusinessAudience ? (
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
      ) : null}

      <section
        id={isBusinessAudience ? "faq" : undefined}
        className="landing-brand-section landing-brand-section-faq"
      >
        <div className="landing-brand-shell landing-brand-shell-narrow">
          <div className="landing-brand-section-head">
            <span className="landing-brand-eyebrow">Preguntas frecuentes</span>
            <h2>
              {isBusinessAudience
                ? "La propuesta para empresas también tiene que responder rápido."
                : "Una landing clara también tiene que responder rápido."}
            </h2>
          </div>

          <div className="landing-brand-faq">
            {faqEntries.map((item, index) => {
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
              <h2>
                {isBusinessAudience
                  ? "Klinip Empresas funciona mejor cuando la continuidad no se corta al salir de la atención."
                  : "Klinip se ve mejor cuando se entiende como un servicio real de continuidad."}
              </h2>
              <p>
                {isBusinessAudience
                  ? "Separa la experiencia personal de la operación institucional y lleva seguimiento claro a cada persona usuaria."
                  : "Para personas, familias y cuidadores, la promesa sigue siendo la misma: más claridad, más seguimiento y más control sobre la información de salud."}
              </p>
            </div>
            <div className="landing-brand-cta-actions">
              <Link className="landing-brand-btn is-primary is-large" to="/register">
                {isBusinessAudience ? "Explorar solución" : "Crear cuenta gratis"}
                <ArrowIcon />
              </Link>
              <Link
                className="landing-brand-btn is-dark-ghost is-large"
                to={isBusinessAudience ? "/personas" : "/login"}
              >
                {isBusinessAudience ? "Ver landing personas" : "Ya tengo cuenta"}
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
            <span>
              {isBusinessAudience
                ? "Continuidad de salud para organizaciones con una experiencia clara para cada persona usuaria."
                : "Salud personal y familiar con más claridad, continuidad y contexto."}
            </span>
          </div>
          <div className="landing-brand-footer-copy">&copy; 2026 Klinip. Todos los derechos reservados.</div>
        </div>
      </footer>
    </div>
  );
}
