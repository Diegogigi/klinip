import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getLandingStats, getPublicPlans } from "../api";
import BrandLogo from "../components/BrandLogo";
import { PLAN_CATALOG } from "../data/plans";
import { cleanUiText } from "../utils/textEncoding";
import "./Landing.css";

const LANDING_NAV_ITEMS = [
  { id: "valor", label: "Valor" },
  { id: "acompanamiento", label: "Acompañamiento" },
  { id: "privacidad", label: "Privacidad" },
  { id: "planes", label: "Planes" },
];

const fallbackStats = {
  users: 1200,
  appointments: 15000,
  reminders: 50000,
  satisfaction: 98,
};

const heroHighlights = [
  "Agenda, medicamentos y documentos en un mismo lugar",
  "Apoyo claro para pacientes, familias y cuidadores",
  "Diseño pensado para personas reales, no para dashboards fríos",
];

const carePillars = [
  {
    title: "Todo ordenado",
    description:
      "Tus citas, resultados, indicaciones y recordatorios se entienden rápido, sin tener que abrir diez pantallas.",
    tone: "blue",
  },
  {
    title: "Mejor acompañado",
    description:
      "Klinip ayuda a que la familia y el equipo tratante compartan contexto sin perder privacidad ni control.",
    tone: "sand",
  },
  {
    title: "Menos carga mental",
    description:
      "La app te recuerda lo importante, resume lo urgente y baja la fricción diaria del cuidado de salud.",
    tone: "green",
  },
];

const operationalCards = [
  {
    eyebrow: "Seguimiento diario",
    title: "Tu rutina de salud se vuelve visible",
    description:
      "Ve pendientes, próximas citas y recordatorios sin rebuscar entre mensajes, papeles o aplicaciones separadas.",
  },
  {
    eyebrow: "Contexto compartido",
    title: "La familia entiende qué está pasando",
    description:
      "Comparte avances y tareas con las personas correctas para que el cuidado no dependa de una sola persona.",
  },
  {
    eyebrow: "Lectura útil",
    title: "Los documentos dejan de ser una carga",
    description:
      "Recetas, órdenes y resultados se transforman en información legible y ordenada para usarla cuando la necesitas.",
  },
];

const storySections = [
  {
    id: "story-paciente",
    eyebrow: "Para pacientes",
    title: "Una vista clara para seguir tu día sin enredarte",
    description:
      "La información importante aparece de frente: qué toca hoy, qué viene después y qué necesita atención.",
    bullets: [
      "Recordatorios visibles y simples",
      "Resumen comprensible del estado del día",
      "Acceso rápido a lo más importante",
    ],
    image: {
      src: "/landing/hero-giselle.jpg",
      fallback: "/landing/fallback-home-hero.png",
      alt: "Paciente mostrando la app Klinip en su teléfono desde su casa.",
    },
  },
  {
    id: "story-familia",
    eyebrow: "Para familias",
    title: "Acompañar a alguien se vuelve más fácil y más humano",
    description:
      "Cuando varias personas están pendientes del mismo proceso de salud, Klinip ayuda a compartir contexto sin confusión.",
    bullets: [
      "Seguimiento compartido con criterio",
      "Visión más clara para cuidadores y cercanos",
      "Menos llamadas y menos pérdida de información",
    ],
    reverse: true,
    image: {
      src: "/landing/familia-cuidando.jpg",
      fallback: "/landing/fallback-familia-home.png",
      alt: "Dos familiares revisando el estado de salud desde la aplicación.",
    },
  },
  {
    id: "story-consulta",
    eyebrow: "Para consultas y controles",
    title: "Llegar mejor preparado cambia la conversación clínica",
    description:
      "Con tus antecedentes ordenados, la consulta se enfoca en decidir mejor y no en reconstruir el historial desde cero.",
    bullets: [
      "Más contexto antes de cada cita",
      "Información lista para conversar con el profesional",
      "Menos tiempo perdido explicando lo mismo",
    ],
    image: {
      src: "/landing/consulta-acompanada.jpg",
      fallback: "/landing/fallback-radar-salud.png",
      alt: "Paciente, familiar y médico revisando información de salud en un teléfono.",
    },
  },
  {
    id: "story-documentos",
    eyebrow: "Para documentos",
    title: "Tus exámenes y recetas quedan guardados con sentido",
    description:
      "La app toma lo que normalmente vive en papel o en fotos sueltas y lo convierte en una referencia fácil de usar.",
    bullets: [
      "Subida rápida desde el teléfono",
      "Lectura útil para el seguimiento diario",
      "Mejor orden para consultas futuras",
    ],
    reverse: true,
    image: {
      src: "/landing/documentos-en-casa.jpg",
      fallback: "/landing/fallback-mi-salud.png",
      alt: "Persona revisando un documento clínico mientras usa Klinip en su teléfono.",
    },
  },
];

const privacyPoints = [
  {
    title: "Control por perfil",
    description:
      "Cada persona decide qué comparte y con quién, especialmente cuando hay familia o cuidadores involucrados.",
  },
  {
    title: "Privacidad desde el diseño",
    description:
      "La información clínica se trata como información sensible: con contexto, permisos y claridad de uso.",
  },
  {
    title: "Datos útiles, no expuestos",
    description:
      "Klinip busca hacer más simple la gestión diaria sin convertir tu historial en ruido ni en un activo ajeno.",
  },
];

const faqItems = [
  {
    q: "¿Klinip está pensado solo para pacientes mayores?",
    a: "No. Está pensado para cualquier persona que necesite ordenar su salud, pero con especial foco en procesos donde también participan familias o cuidadores.",
  },
  {
    q: "¿Puedo usarlo con mi familia?",
    a: "Sí. La experiencia considera acompañamiento y seguimiento compartido, siempre respetando qué perfiles y datos se comparten.",
  },
  {
    q: "¿Sirve para llevar documentos y resultados?",
    a: "Sí. La landing ya comunica esa capacidad porque Klinip permite centralizar recetas, órdenes y resultados en un mismo flujo.",
  },
  {
    q: "¿Necesito instalar una app?",
    a: "Puedes entrar desde el navegador y también usar la experiencia instalable en celular o escritorio cuando corresponda.",
  },
];

const formatCount = (value) => `${new Intl.NumberFormat("es-CL").format(value)}+`;
const formatPercent = (value) => `${value}%`;

const StatCard = ({ value, label }) => (
  <div className="landing-modern-stat">
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
  const [activeNavSection, setActiveNavSection] = useState("valor");
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
    { value: formatCount(stats.users), label: "usuarios" },
    { value: formatCount(stats.appointments), label: "citas gestionadas" },
    { value: formatCount(stats.reminders), label: "recordatorios enviados" },
    { value: formatPercent(stats.satisfaction), label: "satisfacción reportada" },
  ];

  return (
    <div className="landing-modern" ref={pageRef}>
      <header className="landing-modern-nav">
        <div className="landing-modern-shell landing-modern-nav-inner">
          <Link className="landing-modern-logo" to="/">
            <BrandLogo
              className="brand-logo-landing brand-logo-keep-name-mobile"
              nameClassName="landing-modern-logo-name"
              showMark={false}
              responsive
            />
          </Link>

          <nav className="landing-modern-links" aria-label="Navegación de la landing">
            {LANDING_NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`landing-modern-link ${activeNavSection === item.id ? "is-active" : ""}`}
                onClick={() => handleLandingNav(item.id)}
                aria-current={activeNavSection === item.id ? "page" : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="landing-modern-actions">
            <button
              type="button"
              className="theme-toggle landing-modern-theme-toggle"
              onClick={() => onToggleTheme?.()}
              aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              aria-pressed={theme === "dark"}
            >
              <span className={`theme-switch ${theme === "dark" ? "is-dark" : ""}`}>
                <span className="theme-switch-thumb" />
              </span>
            </button>
            <Link className="landing-modern-btn is-ghost" to="/login">
              Iniciar sesión
            </Link>
            <Link className="landing-modern-btn is-primary" to="/register">
              Crear cuenta
            </Link>
          </div>
        </div>
      </header>

      <section className="landing-modern-hero">
        <div className="landing-modern-shell landing-modern-hero-grid">
          <div className="landing-modern-copy">
            <span className="landing-modern-kicker">Cuidado de salud más claro y más humano</span>
            <h1>
              Una app para ordenar la salud,
              <span> acompañar mejor y decidir con más contexto.</span>
            </h1>
            <p className="landing-modern-lead">
              Klinip reúne agenda, medicamentos, documentos y acompañamiento familiar en una experiencia
              moderna, sobria y fácil de entender tanto en escritorio como en celular.
            </p>

            <div className="landing-modern-cta-row">
              <Link className="landing-modern-btn is-primary is-large" to="/register">
                Comenzar gratis
              </Link>
              <button
                type="button"
                className="landing-modern-btn is-secondary is-large"
                onClick={() => handleLandingNav("valor")}
              >
                Ver cómo funciona
              </button>
            </div>

            <div className="landing-modern-highlights">
              {heroHighlights.map((item) => (
                <div key={item} className="landing-modern-highlight">
                  <span className="landing-modern-highlight-dot" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <div className="landing-modern-stats" aria-label="Indicadores principales">
              {statItems.map((item) => (
                <StatCard key={item.label} value={item.value} label={item.label} />
              ))}
            </div>
          </div>

          <div className="landing-modern-hero-media">
            <div className="landing-modern-photo-frame">
              <LandingImage
                className="landing-modern-photo"
                src="/landing/hero-giselle.jpg"
                fallback="/landing/fallback-home-hero.png"
                alt="Paciente usando Klinip en su teléfono desde casa."
              />
            </div>
            <div className="landing-modern-floating-card is-top">
              <span className="landing-modern-floating-label">Seguimiento diario</span>
              <strong>Prioridades visibles</strong>
              <p>Lo urgente, lo pendiente y lo próximo aparecen en una sola mirada.</p>
            </div>
            <div className="landing-modern-floating-card is-bottom">
              <span className="landing-modern-floating-label">Experiencia multiplataforma</span>
              <strong>Escritorio y celular</strong>
              <p>Diseñada para usarla con calma en casa o rápido antes de una consulta.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="valor" className="landing-modern-section">
        <div className="landing-modern-shell">
          <div className="landing-modern-section-head">
            <span className="landing-modern-kicker">Valor clínico y cotidiano</span>
            <h2>Menos aspecto de maqueta. Más utilidad real para el día a día.</h2>
            <p>
              La nueva landing prioriza contexto, confianza y personas reales. La app se presenta como una
              herramienta concreta para ordenar el cuidado de salud, no como una demo genérica de IA.
            </p>
          </div>

          <div className="landing-modern-pillars">
            {carePillars.map((item) => (
              <article key={item.title} className={`landing-modern-pillar is-${item.tone}`}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>

          <div className="landing-modern-operations">
            {operationalCards.map((item) => (
              <article key={item.title} className="landing-modern-operation-card">
                <span className="landing-modern-operation-eyebrow">{item.eyebrow}</span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="acompanamiento" className="landing-modern-section landing-modern-section-muted">
        <div className="landing-modern-shell">
          <div className="landing-modern-section-head">
            <span className="landing-modern-kicker">Acompañamiento real</span>
            <h2>La experiencia gira en torno a personas, no a widgets.</h2>
            <p>
              Cada bloque usa fotografía real y copy más directo para transmitir cercanía, seguimiento y
              utilidad clínica sin exagerar promesas tecnológicas.
            </p>
          </div>

          <div className="landing-modern-story-list">
            {storySections.map((story) => (
              <article
                key={story.id}
                className={`landing-modern-story ${story.reverse ? "is-reverse" : ""}`}
              >
                <div className="landing-modern-story-image-wrap">
                  <LandingImage
                    className="landing-modern-story-image"
                    src={story.image.src}
                    fallback={story.image.fallback}
                    alt={story.image.alt}
                  />
                </div>
                <div className="landing-modern-story-copy">
                  <span className="landing-modern-kicker">{story.eyebrow}</span>
                  <h3>{story.title}</h3>
                  <p>{story.description}</p>
                  <ul>
                    {story.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="privacidad" className="landing-modern-section">
        <div className="landing-modern-shell">
          <div className="landing-modern-section-head">
            <span className="landing-modern-kicker">Privacidad y criterio</span>
            <h2>La información sensible se trata con el tono y el cuidado correctos.</h2>
            <p>
              El mensaje visual y textual de esta landing evita el tono de "todo lo sabe la IA" y vuelve a
              poner el foco en control, acompañamiento y confianza.
            </p>
          </div>

          <div className="landing-modern-privacy-grid">
            {privacyPoints.map((item) => (
              <article key={item.title} className="landing-modern-privacy-card">
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="planes" className="landing-modern-section landing-modern-section-pricing">
        <div className="landing-modern-shell">
          <div className="landing-modern-section-head">
            <span className="landing-modern-kicker">Planes</span>
            <h2>Empieza simple y escala cuando tu contexto lo necesite.</h2>
            <p>
              La estructura de planes se mantiene, pero ahora vive dentro de una landing más limpia y con
              mejor lectura en móvil.
            </p>
          </div>

          <div className="landing-modern-billing-toggle">
            <span className={billing === "monthly" ? "is-active" : ""}>Mensual</span>
            <button
              type="button"
              className={`landing-modern-billing-switch ${billing === "yearly" ? "is-yearly" : ""}`}
              onClick={() => setBilling((prev) => (prev === "monthly" ? "yearly" : "monthly"))}
              aria-label="Cambiar facturación"
            >
              <span className="landing-modern-billing-thumb" />
            </button>
            <span className={billing === "yearly" ? "is-active" : ""}>Anual</span>
            <span className="landing-modern-billing-badge">Ahorra 2 meses</span>
          </div>

          <div className="landing-modern-pricing-grid">
            {plans.map((plan) => (
              <article
                key={plan.slug}
                className={`landing-modern-price-card ${plan.recommended ? "is-featured" : ""}`}
              >
                {plan.recommended ? <span className="landing-modern-price-rec">Recomendado</span> : null}
                <div className="landing-modern-price-plan">{cleanUiText(plan.name)}</div>
                <div className={`landing-modern-price-amount ${plan.slug === "basico" ? "is-free" : ""}`}>
                  {billing === "monthly" ? plan.priceMonthly : plan.priceYearly}
                </div>
                <div className="landing-modern-price-period">
                  {billing === "monthly" ? "Facturación mensual" : "Facturación anual"}
                </div>
                <p className="landing-modern-price-note">{cleanUiText(plan.note)}</p>
                <ul className="landing-modern-price-features">
                  {plan.features.map((feature) => (
                    <li key={feature}>{cleanUiText(feature)}</li>
                  ))}
                </ul>
                <Link className="landing-modern-btn is-primary" to={`/planes/${plan.slug}`}>
                  Ver detalle
                </Link>
                <Link className="landing-modern-btn is-ghost" to="/register">
                  {cleanUiText(plan.cta)}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-modern-section landing-modern-section-faq">
        <div className="landing-modern-shell landing-modern-shell-narrow">
          <div className="landing-modern-section-head">
            <span className="landing-modern-kicker">Preguntas frecuentes</span>
            <h2>Una landing más limpia también explica mejor.</h2>
          </div>

          <div className="landing-modern-faq">
            {faqItems.map((item, index) => {
              const open = openFaq === index;
              return (
                <div key={item.q} className={`landing-modern-faq-item ${open ? "is-open" : ""}`}>
                  <button
                    type="button"
                    className="landing-modern-faq-question"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : index)}
                  >
                    <span>{item.q}</span>
                    <span className="landing-modern-faq-icon" aria-hidden="true" />
                  </button>
                  <div className="landing-modern-faq-answer">
                    <p>{item.a}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="landing-modern-cta">
        <div className="landing-modern-shell landing-modern-cta-inner">
          <div>
            <span className="landing-modern-kicker is-on-dark">Listo para empezar</span>
            <h2>Klinip se ve más confiable cuando se parece a un servicio real.</h2>
            <p>
              La base ya quedó preparada para reemplazar los fallbacks por tus fotos definitivas y seguir
              afinando la narrativa comercial.
            </p>
          </div>
          <div className="landing-modern-cta-actions">
            <Link className="landing-modern-btn is-primary is-large" to="/register">
              Crear cuenta gratis
            </Link>
            <Link className="landing-modern-btn is-dark-ghost is-large" to="/login">
              Ya tengo cuenta
            </Link>
          </div>
        </div>
      </section>

      <footer className="landing-modern-footer">
        <div className="landing-modern-shell landing-modern-footer-inner">
          <div className="landing-modern-footer-brand">
            <BrandLogo className="brand-logo-landing brand-logo-keep-name-mobile" showMark={false} responsive />
            <span>Tu salud más ordenada, tu cuidado más acompañado.</span>
          </div>
          <div className="landing-modern-footer-copy">&copy; 2026 Klinip. Todos los derechos reservados.</div>
        </div>
      </footer>
    </div>
  );
}
