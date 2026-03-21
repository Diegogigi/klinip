import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getPublicPlans } from "../api";
import { getDefaultPlanSlug, getPlanBySlug, PLAN_CATALOG } from "../data/plans";

const PLAN_THEME = {
  basico: { tone: "green", dot: "#16A34A" },
  plus: { tone: "blue", dot: "#2563EB" },
  familiar: { tone: "violet", dot: "#7C3AED" },
};

const PLAN_PAGE_COPY = {
  basico: {
    badge: "Gratis para siempre",
    badgeIcon: (
      <svg viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    subtitle: "Salud personal · IA esencial",
    description:
      "El punto de partida para ordenar tu salud en digital. Incluye tu perfil, documentos, medicamentos y Klinip IA en modalidad básica con capacidad diaria limitada.",
    primaryCta: "Empezar gratis",
    secondaryCta: "Ver planes superiores",
    note: "Gratis para siempre · 1 perfil incluido",
    ctaEyebrow: "Empieza hoy",
    ctaTitle: "Comienza con Klinip",
    ctaTitleEm: "gratis",
    ctaSub: "Organiza tu salud personal con lo esencial y activa Klinip IA básica desde el primer día.",
    ctaPrimary: "Crear cuenta gratis",
    ctaSecondary: "Ver plan Plus",
    features: [
      {
        title: "1 perfil de salud",
        desc: "Gestiona tu propia ficha de salud con tus datos, documentos, citas y medicamentos en un solo lugar.",
        tone: "green",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ),
      },
      {
        title: "Medicamentos, citas y calendario",
        desc: "Registra tus tratamientos, agenda médica y actividades de salud con una vista simple y clara.",
        tone: "blue",
        icon: (
          <svg viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        ),
      },
      {
        title: "Documentos con lectura automática básica",
        desc: "Sube recetas, resultados y órdenes para mantenerlos organizados y con texto detectado automáticamente para búsquedas simples.",
        tone: "amber",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        ),
      },
      {
        title: "Klinip IA básica",
        desc: "Haz preguntas rápidas sobre tu información de salud con una capacidad de hasta 15 consultas al día.",
        tone: "indigo",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
      {
        title: "Recordatorios esenciales",
        desc: "Recibe alertas para citas y tomas de medicamentos sin complejidad extra.",
        tone: "red",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        ),
      },
      {
        title: "Acceso móvil y escritorio",
        desc: "Disponible desde celular o computador para que tu información esté siempre contigo.",
        tone: "violet",
        icon: (
          <svg viewBox="0 0 24 24">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        ),
      },
      {
        title: "KlinipFeed personal",
        desc: "Publica avances y novedades de salud en un feed privado desde tu propia cuenta.",
        tone: "amber",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
    ],
    faqs: [
      {
        q: "¿El plan Básico es gratis para siempre?",
        a: "Sí. El plan Básico no tiene vencimiento y te permite usar Klinip de forma permanente con 1 perfil de salud.",
      },
      {
        q: "¿La IA está incluida en el plan Básico?",
        a: "Sí, pero en modalidad básica. Puedes usar Klinip IA con una capacidad de hasta 15 consultas al día.",
      },
      {
        q: "¿Puedo cambiar a un plan superior después?",
        a: "Sí. Puedes cambiar a Plus o Familiar cuando necesites más perfiles o IA completa.",
      },
    ],
  },
  plus: {
    badge: "Más elegido",
    badgeIcon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
    subtitle: "Más perfiles · IA completa",
    description:
      "Pensado para quienes gestionan su salud y la de personas a su cargo desde una sola cuenta, con hasta 3 perfiles y acceso completo a Klinip IA.",
    primaryCta: "Elegir Plus",
    secondaryCta: "Ver detalle completo",
    note: "$3.990 al mes o $39.990 al año",
    ctaEyebrow: "Más capacidad",
    ctaTitle: "Escala tu seguimiento con",
    ctaTitleEm: "IA completa",
    ctaSub: "Más perfiles, más contexto clínico y más profundidad para entender tu información de salud.",
    ctaPrimary: "Elegir Plus",
    ctaSecondary: "Ver plan Familiar",
    features: [
      {
        title: "Hasta 3 perfiles de salud",
        desc: "Administra tu salud y la de hasta 2 personas más desde una sola cuenta, sin colaboración multiusuario.",
        tone: "blue",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        ),
      },
      {
        title: "Klinip IA completa",
        desc: "Consulta documentos, medicamentos, citas, historial y contexto del perfil sin límite diario de consultas.",
        tone: "indigo",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
      {
        title: "Lectura automática mejorada",
        desc: "Detecta mejor la información útil desde fotos y PDFs para acelerar tus búsquedas y resúmenes.",
        tone: "teal",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="M9 13h6M9 17h3" />
          </svg>
        ),
      },
      {
        title: "Historial completo y reportes",
        desc: "Accede a una línea de tiempo más profunda y genera reportes clínicos para compartir.",
        tone: "violet",
        icon: (
          <svg viewBox="0 0 24 24">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        ),
      },
      {
        title: "Recordatorios avanzados",
        desc: "Mantén mejor seguimiento de tratamientos y actividades con más contexto clínico.",
        tone: "red",
        icon: (
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <circle cx="12" cy="16" r=".5" fill="currentColor" />
          </svg>
        ),
      },
      {
        title: "Gestión individual de varios perfiles",
        desc: "Ideal para quien coordina más de una persona, pero sin panel familiar compartido ni roles multiusuario.",
        tone: "amber",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4l-5 16" />
          </svg>
        ),
      },
      {
        title: "KlinipFeed por hogar",
        desc: "Sigue avances, resultados y publicaciones privadas entre hasta 3 perfiles administrados desde tu cuenta.",
        tone: "green",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
    ],
    faqs: [
      {
        q: "¿Qué cambia realmente entre Básico y Plus?",
        a: "Plus sube de 1 a 3 perfiles y activa Klinip IA completa, además de lectura automática mejorada de documentos, más historial y reportes.",
      },
      {
        q: "¿Plus incluye colaboración familiar?",
        a: "No. Plus permite más perfiles bajo una sola cuenta, pero no habilita panel familiar ni colaboración multiusuario.",
      },
      {
        q: "¿Puedo pasar luego a Familiar?",
        a: "Sí. Si más adelante necesitas colaboración entre cuidadores y panel familiar, puedes subir a Familiar.",
      },
    ],
  },
  familiar: {
    badge: "Colaboración total",
    badgeIcon: (
      <svg viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    subtitle: "Multiusuario · IA completa",
    description:
      "El plan más completo para familias y cuidadores. Incluye colaboración multiusuario, panel familiar, calendarios compartidos y Klinip IA completa para todo el grupo.",
    primaryCta: "Elegir Familiar",
    secondaryCta: "Comparar con Plus",
    note: "$6.990 al mes o $69.990 al año",
    ctaEyebrow: "Para coordinar en equipo",
    ctaTitle: "La salud de todos",
    ctaTitleEm: "bien coordinada",
    ctaSub: "Centraliza perfiles, roles, recordatorios y contexto clínico compartido en un solo espacio.",
    ctaPrimary: "Elegir Familiar",
    ctaSecondary: "Comparar planes",
    features: [
      {
        title: "Hasta 5 perfiles de salud",
        desc: "Concentra la salud del grupo familiar en una sola suscripción con historial y seguimiento por persona.",
        tone: "violet",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        ),
      },
      {
        title: "Panel familiar y calendarios",
        desc: "Visualiza citas, exámenes, tratamientos y documentos del grupo desde una vista compartida.",
        tone: "blue",
        icon: (
          <svg viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        ),
      },
      {
        title: "Roles y colaboración multiusuario",
        desc: "Asigna administradores, cuidadores o lectores con control explícito de acceso por perfil.",
        tone: "green",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        ),
      },
      {
        title: "Klinip IA completa para todo el grupo",
        desc: "Usa el asistente con contexto clínico completo para cada integrante, sin capacidad reducida.",
        tone: "indigo",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
      {
        title: "Recordatorios por perfil",
        desc: "Cada persona tiene sus propios recordatorios, pendientes y alertas según su situación clínica.",
        tone: "red",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        ),
      },
      {
        title: "Historial y actividad por persona",
        desc: "Sigue la evolución de cada integrante con documentos, adherencia, citas y actividad reciente.",
        tone: "amber",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4l-5 16" />
          </svg>
        ),
      },
      {
        title: "KlinipFeed familiar compartido",
        desc: "Convierte Klinip en una pequeña red social privada para cuidadores y familia con actividad del grupo.",
        tone: "teal",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
    ],
    faqs: [
      {
        q: "¿Qué habilita Familiar que Plus no tiene?",
        a: "Familiar habilita colaboración multiusuario, panel familiar y roles por cuidador, además de subir el límite a 5 perfiles.",
      },
      {
        q: "¿Puedo controlar qué puede ver o editar cada cuidador?",
        a: "Sí. Puedes asignar roles y permisos según el nivel de acceso que necesite cada persona.",
      },
      {
        q: "¿Familiar mantiene IA completa?",
        a: "Sí. Familiar conserva la IA completa y la extiende al contexto compartido del grupo familiar.",
      },
    ],
  },
};

const COMPARISON_ROWS = [
  {
    group: "Perfiles y usuarios",
    rows: [
      { label: "Perfiles de salud", basico: "1", plus: "Hasta 3", familiar: "Hasta 5" },
      { label: "Colaboración multiusuario", basico: false, plus: false, familiar: true },
      { label: "Panel familiar", basico: false, plus: false, familiar: true },
    ],
  },
  {
    group: "Seguimiento clínico",
    rows: [
      { label: "Medicamentos, citas y calendario", basico: true, plus: true, familiar: true },
      { label: "Lectura automática de documentos", basico: "Básica", plus: "Mejorada", familiar: "Mejorada" },
      { label: "Historial y reportes", basico: "Esencial", plus: "Completo", familiar: "Completo" },
    ],
  },
  {
    group: "KlinipFeed",
    rows: [
      { label: "Modo de feed", basico: "Personal", plus: "Hogar", familiar: "Familiar compartido" },
      { label: "Publicaciones privadas de salud", basico: true, plus: true, familiar: true },
      { label: "Actividad compartida entre cuidadores", basico: false, plus: false, familiar: true },
    ],
  },
  {
    group: "Klinip IA",
    rows: [
      { label: "Asistente Klinip IA", basico: "Básica", plus: "Completa", familiar: "Completa" },
      { label: "Capacidad diaria de IA", basico: "15 consultas/día", plus: "Completa", familiar: "Completa" },
      { label: "Contexto completo de documentos, medicamentos y citas", basico: true, plus: true, familiar: true },
    ],
  },
];

function CheckCell({ value }) {
  if (value === true) {
    return (
      <span className="pp-check yes">
        <svg viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="pp-check no">
        <svg viewBox="0 0 24 24">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  }
  return <span className="pp-cell-text">{value}</span>;
}

export default function Plans({ user }) {
  const navigate = useNavigate();
  const { planSlug } = useParams();
  const [billing, setBilling] = useState("monthly");
  const [plans, setPlans] = useState(PLAN_CATALOG);
  const [openFaq, setOpenFaq] = useState(0);

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

  const selectedPlan = useMemo(
    () =>
      getPlanBySlug(planSlug, plans) ||
      getPlanBySlug(getDefaultPlanSlug(plans), plans) ||
      plans[0],
    [planSlug, plans]
  );

  useEffect(() => {
    setOpenFaq(0);
  }, [selectedPlan?.slug]);

  const activeSlug = selectedPlan?.slug || "plus";
  const detailCopy = PLAN_PAGE_COPY[activeSlug] || PLAN_PAGE_COPY.plus;
  const theme = PLAN_THEME[activeSlug] || PLAN_THEME.plus;
  const ctaTarget = user ? "/" : "/register";
  const navCtaLabel = user ? "Ir a mi panel" : "Crear cuenta";

  const priceLabel = billing === "monthly" ? selectedPlan.priceMonthly : selectedPlan.priceYearly;
  const isFree = String(priceLabel).toLowerCase().includes("gratis");
  const periodLabel = isFree
    ? ""
    : billing === "monthly"
      ? "/ mes"
      : selectedPlan.yearlyEquivalent
        ? `${selectedPlan.yearlyEquivalent} · cobrado anual`
        : "/ año";

  return (
    <div className="pp-page">
      <header className="pp-navbar">
        <div className="pp-navbar-inner">
          <Link to="/" className="pp-nav-logo">
            <span className="brand-wordmark responsive" aria-label="Klinip">
              <span className="brand-wordmark-full">Klinip</span>
              <span className="brand-wordmark-compact">K</span>
            </span>
          </Link>

          <nav className="pp-nav-links">
            <a href="/#features" className="pp-nav-link">Funciones</a>
            <a href="/#ia" className="pp-nav-link">IA en salud</a>
            <span className="pp-nav-link is-active">Planes</span>
          </nav>

          <div className="pp-nav-right">
            <Link to="/login" className="pp-btn-ghost">Iniciar sesión</Link>
            <Link to={ctaTarget} className="pp-btn-primary-nav">{navCtaLabel}</Link>
          </div>
        </div>
      </header>

      <section className="pp-hero">
        <div className="pp-hero-inner">
          <div className="pp-hero-eyebrow"><span />Planes y precios<span /></div>
          <h1>Elige el plan para tu <em>salud y tu familia</em></h1>
          <p>Empieza gratis y escala cuando necesites más perfiles, más colaboración, IA completa o un KlinipFeed más compartido.</p>

          <div className="pp-billing-wrap">
            <span className={`pp-billing-label ${billing === "monthly" ? "is-on" : ""}`}>Mensual</span>
            <button
              type="button"
              className={`pp-billing-switch ${billing === "yearly" ? "is-yearly" : ""}`}
              onClick={() => setBilling((prev) => (prev === "monthly" ? "yearly" : "monthly"))}
              aria-label="Cambiar facturación"
            >
              <span className="pp-billing-track" />
              <span className="pp-billing-thumb" />
            </button>
            <span className={`pp-billing-label ${billing === "yearly" ? "is-on" : ""}`}>Anual</span>
            <span className="pp-billing-save">Ahorra 2 meses</span>
          </div>
        </div>
      </section>

      <div className="pp-plan-tabs">
        {plans.map((plan) => (
          <button
            key={plan.slug}
            type="button"
            className={`pp-plan-tab ${activeSlug === plan.slug ? "is-active" : ""}`}
            onClick={() => navigate(`/planes/${plan.slug}`)}
          >
            <span className="pp-plan-tab-dot" style={{ background: PLAN_THEME[plan.slug]?.dot || "#2563EB" }} />
            <span>
              {plan.name} — {billing === "monthly" ? plan.priceMonthly : plan.yearlyEquivalent || plan.priceYearly}
            </span>
          </button>
        ))}
      </div>

      <div className="pp-surface">
        <div className="pp-content">
          <section className="pp-detail is-active">
            <div className="pp-detail-header">
              <div className="pp-detail-left">
                <div className={`pp-badge tone-${theme.tone}`}>
                  {detailCopy.badgeIcon}
                  {detailCopy.badge}
                </div>
                <h2>Plan <em>{selectedPlan.name}</em></h2>
                <div className="pp-price-row">
                  <strong className={`pp-price ${isFree ? "is-free" : ""}`}>{priceLabel}</strong>
                  {periodLabel ? <span>{periodLabel}</span> : null}
                </div>
                <div className="pp-detail-subtitle">{detailCopy.subtitle}</div>
                <p className="pp-detail-desc">{detailCopy.description}</p>
              </div>

              <div className="pp-detail-right">
                <Link to={ctaTarget} className={`pp-btn-main ${activeSlug === "basico" ? "is-green" : ""}`}>
                  {user ? "Usar este plan" : detailCopy.primaryCta}
                  <svg viewBox="0 0 24 24">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
                <button type="button" className="pp-btn-secondary">
                  {detailCopy.secondaryCta}
                </button>
                <p className="pp-detail-note">{detailCopy.note}</p>
              </div>
            </div>

            <section className="pp-feature-section">
              <h3>Qué incluye el plan <em>{selectedPlan.name}</em></h3>
              <div className="pp-feature-grid">
                {detailCopy.features.map((item) => (
                  <article key={item.title} className="pp-feature-card">
                    <div className={`pp-feature-line tone-${item.tone}`} />
                    <div className={`pp-feature-icon tone-${item.tone}`}>{item.icon}</div>
                    <h4>{item.title}</h4>
                    <p>{item.desc}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="pp-comparison-section">
              <h3>Comparación de <em>todos los planes</em></h3>
              <div className="pp-table-wrap">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Función</th>
                      <th className={activeSlug === "basico" ? "is-highlight" : ""}>Básico</th>
                      <th className={activeSlug === "plus" ? "is-highlight" : ""}>Plus</th>
                      <th className={activeSlug === "familiar" ? "is-highlight" : ""}>Familiar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON_ROWS.map((group) => (
                      <React.Fragment key={group.group}>
                        <tr className="pp-group-row">
                          <td colSpan={4}>{group.group}</td>
                        </tr>
                        {group.rows.map((row) => (
                          <tr key={row.label}>
                            <td>{row.label}</td>
                            <td className={activeSlug === "basico" ? "is-highlight" : ""}><CheckCell value={row.basico} /></td>
                            <td className={activeSlug === "plus" ? "is-highlight" : ""}><CheckCell value={row.plus} /></td>
                            <td className={activeSlug === "familiar" ? "is-highlight" : ""}><CheckCell value={row.familiar} /></td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="pp-faq-section">
              <h3>Preguntas <em>frecuentes</em></h3>
              <div className="pp-faq-list">
                {detailCopy.faqs.map((item, index) => {
                  const isOpen = openFaq === index;
                  return (
                    <article key={item.q} className={`pp-faq-item ${isOpen ? "is-open" : ""}`}>
                      <button
                        type="button"
                        className="pp-faq-q"
                        onClick={() => setOpenFaq((prev) => (prev === index ? -1 : index))}
                      >
                        <span>{item.q}</span>
                        <span className="pp-faq-arrow">
                          <svg viewBox="0 0 24 24">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </span>
                      </button>
                      {isOpen ? <div className="pp-faq-a">{item.a}</div> : null}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="pp-cta-bottom">
              <div className="pp-cta-eyebrow">{detailCopy.ctaEyebrow}</div>
              <h3>
                {detailCopy.ctaTitle.replace(detailCopy.ctaTitleEm, "").trim()} <em>{detailCopy.ctaTitleEm}</em>
              </h3>
              <p>{detailCopy.ctaSub}</p>
              <div className="pp-cta-actions">
                <Link to={ctaTarget} className="pp-cta-main">
                  {detailCopy.ctaPrimary}
                  <svg viewBox="0 0 24 24">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
                <button type="button" className="pp-cta-ghost">
                  {detailCopy.ctaSecondary}
                </button>
              </div>
            </section>
          </section>
        </div>
      </div>

      <footer className="pp-footer">
        <div className="pp-footer-inner">
          <div className="pp-footer-brand">
            <div>
              <div className="pp-footer-name brand-wordmark responsive" aria-label="Klinip">
                <span className="brand-wordmark-full">Klinip</span>
                <span className="brand-wordmark-compact">K</span>
              </div>
              <div className="pp-footer-tag">Tu ruta de salud, simplificada</div>
            </div>
          </div>
          <div className="pp-footer-copy">© 2026 Klinip. Todos los derechos reservados.</div>
        </div>
      </footer>
    </div>
  );
}
