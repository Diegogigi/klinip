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
    badge: "Para siempre gratis",
    badgeIcon: (
      <svg viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    subtitle: "Salud personal · Sin tarjeta de crédito",
    description:
      "Todo lo que necesitas para empezar a organizar tu salud de forma digital. Ideal para personas que quieren tener sus citas, medicamentos y documentos en un solo lugar.",
    primaryCta: "Empezar gratis",
    secondaryCta: "Ver planes de pago",
    note: "Sin límite de tiempo. Sin tarjeta requerida.",
    ctaEyebrow: "Empieza hoy",
    ctaTitle: "Comienza gratis, sin compromisos",
    ctaTitleEm: "gratis",
    ctaSub: "Sin tarjeta de crédito. Sin límite de tiempo. Solo tu salud, organizada.",
    ctaPrimary: "Crear cuenta gratis",
    ctaSecondary: "Ver plan Plus",
    features: [
      {
        title: "1 perfil de salud",
        desc: "Gestiona tu propio perfil con toda tu información médica centralizada y siempre accesible.",
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
        desc: "Registra tus medicamentos con dosis y horarios. Agrega citas y visualiza todo en un calendario unificado.",
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
        title: "Documentos con OCR básico",
        desc: "Sube recetas, resultados y órdenes. El OCR básico extrae texto automáticamente para búsquedas rápidas.",
        tone: "amber",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        ),
      },
      {
        title: "Recordatorios esenciales",
        desc: "Alertas para tomar medicamentos y recordatorios de citas próximas por correo electrónico.",
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
        desc: "Disponible en cualquier dispositivo. Tu información sincronizada siempre en tiempo real.",
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
        title: "Privacidad y seguridad",
        desc: "Tus datos cifrados y protegidos. Control total sobre tu información médica sin compartir con terceros.",
        tone: "teal",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        ),
      },
    ],
    faqs: [
      {
        q: "¿El plan Básico es realmente gratis para siempre?",
        a: "Sí. El plan Básico no tiene fecha de vencimiento ni requiere tarjeta de crédito. Puedes usarlo de forma permanente con todas sus funciones incluidas.",
      },
      {
        q: "¿Puedo actualizar mi plan en cualquier momento?",
        a: "Sí. Puedes subir de plan cuando quieras desde la configuración de tu cuenta. El cambio es inmediato y solo pagas la diferencia proporcional del mes.",
      },
      {
        q: "¿Mis datos están seguros en Klinip?",
        a: "Tu información está cifrada en tránsito y en reposo. Nunca compartimos ni vendemos datos a terceros. Puedes exportar o eliminar tu información cuando quieras.",
      },
      {
        q: "¿Qué pasa si cancelo un plan de pago?",
        a: "Si cancelas, tu cuenta se mantiene activa hasta el fin del periodo pagado. Luego, pasa automáticamente al plan Básico sin perder tus datos históricos.",
      },
    ],
  },
  plus: {
    badge: "Más popular",
    badgeIcon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
    subtitle: "Individual ampliado · Facturación mensual",
    description:
      "Para quienes quieren llevar el control total de su salud con inteligencia artificial. Incluye historial completo, OCR mejorado y el copiloto de IA para anticiparte a cualquier situación.",
    primaryCta: "Probar Plus gratis",
    secondaryCta: "Ver detalle completo",
    note: "14 días de prueba gratis · Sin tarjeta requerida",
    ctaEyebrow: "14 días gratis",
    ctaTitle: "Prueba Plus sin riesgos",
    ctaTitleEm: "Plus",
    ctaSub: "14 días completos sin tarjeta. Acceso a todas las funciones de IA desde el primer día.",
    ctaPrimary: "Probar Plus gratis",
    ctaSecondary: "Ver plan Familiar",
    features: [
      {
        title: "Hasta 3 perfiles de salud",
        desc: "Gestiona tu salud y la de hasta 2 personas más desde una sola cuenta.",
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
        title: "OCR mejorado",
        desc: "Extrae automáticamente fecha, médico, diagnóstico y medicamentos desde fotos o PDFs.",
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
        desc: "Línea de tiempo completa de tu salud con reportes exportables para compartir con tu médico.",
        tone: "violet",
        icon: (
          <svg viewBox="0 0 24 24">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        ),
      },
      {
        title: "Recordatorios avanzados con IA",
        desc: "El sistema aprende tus patrones y envía alertas inteligentes antes de que algo se escape.",
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
        title: "Copiloto IA en salud",
        desc: "Pregunta por medicamentos, historial o próximas citas y recibe respuestas en lenguaje natural.",
        tone: "indigo",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
      {
        title: "Gestión de dependientes",
        desc: "Administra la salud de menores o personas a tu cargo con perfiles independientes.",
        tone: "amber",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4l-5 16" />
          </svg>
        ),
      },
    ],
    faqs: [
      {
        q: "¿Cómo funciona la prueba gratis de 14 días?",
        a: "Puedes probar el plan Plus completo durante 14 días sin ingresar tarjeta de crédito. Al terminar, puedes continuar con Plus o volver al plan Básico.",
      },
      {
        q: "¿Qué es el copiloto de IA?",
        a: "Es un asistente conversacional que conoce tu historial de salud. Puedes preguntarle por medicamentos, resúmenes para consultas o adherencia.",
      },
      {
        q: "¿Puedo cancelar en cualquier momento?",
        a: "Sí. Puedes cancelar desde tu perfil sin penalidades. La cuenta sigue activa hasta el fin del periodo pagado y luego baja a Básico.",
      },
    ],
  },
  familiar: {
    badge: "Ecosistema familiar",
    badgeIcon: (
      <svg viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    subtitle: "Hasta 5 perfiles · Facturación mensual",
    description:
      "El plan completo para familias que quieren gestionar la salud de todos en un solo lugar. Panel familiar compartido, roles por cuidador, alertas inteligentes por perfil y colaboración total.",
    primaryCta: "Elegir Familiar",
    secondaryCta: "Comparar con Plus",
    note: "14 días de prueba gratis · Cancela cuando quieras",
    ctaEyebrow: "Para toda la familia",
    ctaTitle: "La salud de todos, en un solo lugar",
    ctaTitleEm: "en un solo lugar",
    ctaSub: "14 días gratis para toda tu familia. Sin tarjeta. Sin complicaciones.",
    ctaPrimary: "Elegir Familiar",
    ctaSecondary: "Comparar planes",
    features: [
      {
        title: "Hasta 5 perfiles de salud",
        desc: "Toda la familia en una sola cuenta. Cada miembro tiene su propio perfil, historial y recordatorios independientes.",
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
        desc: "Vista centralizada de toda la familia para coordinar citas, exámenes y medicamentos.",
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
        title: "Roles y colaboración",
        desc: "Asigna roles de administrador, editor o lector a cada cuidador con control total de permisos.",
        tone: "green",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        ),
      },
      {
        title: "Alertas inteligentes por perfil",
        desc: "Alertas individualizadas para cada miembro de la familia cuando alguien necesita atención.",
        tone: "red",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        ),
      },
      {
        title: "Copiloto IA para toda la familia",
        desc: "El asistente de IA conoce el historial de cada miembro y sugiere acciones preventivas.",
        tone: "indigo",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
      {
        title: "Historial y actividad por persona",
        desc: "Reportes detallados de adherencia, citas y documentos para cada miembro.",
        tone: "amber",
        icon: (
          <svg viewBox="0 0 24 24">
            <path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4l-5 16" />
          </svg>
        ),
      },
    ],
    faqs: [
      {
        q: "¿Quién puede ser parte del plan Familiar?",
        a: "Cualquier persona que invites: pareja, hijos, padres, abuelos o personas a tu cuidado. Cada miembro puede tener su propio acceso con los permisos que tú definas.",
      },
      {
        q: "¿Puedo controlar qué ve cada miembro?",
        a: "Sí. Puedes asignar roles: administrador, editor o lector. Cada perfil puede tener restricciones de privacidad según tu configuración.",
      },
      {
        q: "¿Qué pasa si un miembro quiere su propia cuenta?",
        a: "Puede crearla cuando quiera. Sus datos del perfil familiar pueden exportarse para continuar de forma independiente.",
      },
      {
        q: "¿Se puede agregar más de 5 perfiles?",
        a: "El plan Familiar incluye hasta 5 perfiles. Si necesitas más, puedes contactarnos para opciones ampliadas.",
      },
    ],
  },
};

const COMPARISON_ROWS = [
  {
    group: "Perfiles y usuarios",
    rows: [
      { label: "Perfiles de salud", basico: "1", plus: "Hasta 3", familiar: "Hasta 5" },
      { label: "Panel familiar", basico: false, plus: false, familiar: true },
      { label: "Roles y colaboración", basico: false, plus: false, familiar: true },
    ],
  },
  {
    group: "Medicamentos y citas",
    rows: [
      { label: "Registro de medicamentos", basico: true, plus: true, familiar: true },
      { label: "Calendario unificado", basico: true, plus: true, familiar: true },
      { label: "Seguimiento de adherencia", basico: true, plus: true, familiar: true },
    ],
  },
  {
    group: "Documentos",
    rows: [
      { label: "Subir documentos", basico: true, plus: true, familiar: true },
      { label: "OCR automático", basico: "Básico", plus: "Mejorado", familiar: "Mejorado" },
      { label: "Historial completo", basico: false, plus: true, familiar: true },
    ],
  },
  {
    group: "IA y recordatorios",
    rows: [
      { label: "Recordatorios esenciales", basico: true, plus: true, familiar: true },
      { label: "Recordatorios avanzados con IA", basico: false, plus: true, familiar: true },
      { label: "Copiloto IA en salud", basico: false, plus: true, familiar: true },
      { label: "Reportes de salud", basico: false, plus: true, familiar: true },
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
          <p>Empieza gratis y escala cuando lo necesites. Sin compromisos, cancela cuando quieras.</p>

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
