import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getPublicPlans } from "../api";
import { getDefaultPlanSlug, getPlanBySlug, PLAN_CATALOG } from "../data/plans";

export default function Plans({ user }) {
  const navigate = useNavigate();
  const { planSlug } = useParams();
  const [billing, setBilling] = useState("monthly");
  const [plans, setPlans] = useState(PLAN_CATALOG);

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

  const ctaTarget = user ? "/" : "/register";
  const ctaLabel = user ? "Ir a mi panel" : "Crear cuenta";

  return (
    <div className="plans-page">
      <header className="plans-page-nav">
        <Link to="/" className="plans-page-brand">
          <img src="/icons/img_sin_fondo.png" alt="Klinip" className="plans-page-brand-img" />
          <span>Klinip</span>
        </Link>
        <div className="plans-page-nav-actions">
          <Link to="/" className="landing-btn-ghost">
            Inicio
          </Link>
          <Link to={ctaTarget} className="landing-btn-primary">
            {ctaLabel}
          </Link>
        </div>
      </header>

      <section className="plans-page-hero">
        <div>
          <span className="plans-page-kicker">Planes Klinip</span>
          <h1>Compara planes y revisa el detalle antes de elegir.</h1>
          <p>
            Cada plan organiza citas, medicamentos y documentos. La diferencia está en cuántos
            perfiles puedes manejar y cuánto nivel de colaboración necesitas.
          </p>
        </div>
        <div className="landing-plan-toggle">
          <span className={billing === "monthly" ? "toggle-active" : ""}>Mensual</span>
          <button
            type="button"
            className={`toggle-switch ${billing === "yearly" ? "is-yearly" : ""}`}
            onClick={() => setBilling((prev) => (prev === "monthly" ? "yearly" : "monthly"))}
            aria-label="Cambiar plan mensual o anual"
          >
            <span className="toggle-knob" />
          </button>
          <span className={billing === "yearly" ? "toggle-active" : ""}>Anual</span>
        </div>
      </section>

      <section className="plans-page-grid">
        <div className="plans-page-list">
          {plans.map((plan) => {
            const isActive = plan.slug === selectedPlan.slug;
            return (
              <button
                key={plan.slug}
                type="button"
                className={`plans-page-card ${isActive ? "is-active" : ""} ${plan.recommended ? "is-recommended" : ""}`}
                onClick={() => navigate(`/planes/${plan.slug}`)}
              >
                <div className="plans-page-card-top">
                  <div>
                    <h2>{plan.name}</h2>
                    <p>{billing === "monthly" ? plan.priceMonthly : plan.priceYearly}</p>
                  </div>
                  {plan.recommended ? <span className="plan-highlight">Recomendado</span> : null}
                </div>
                <span className="plan-note">{plan.note}</span>
                <p className="plans-page-card-summary">{plan.summary}</p>
                <ul className="plan-features">
                  {plan.features.slice(0, 3).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        <article className="plans-page-detail">
          <div className="plans-page-detail-header">
            <div>
              <span className="plans-page-detail-note">{selectedPlan.note}</span>
              <h2>{selectedPlan.name}</h2>
              <p>{selectedPlan.summary}</p>
            </div>
            <div className="plans-page-price-box">
              <strong>{billing === "monthly" ? selectedPlan.priceMonthly : selectedPlan.priceYearly}</strong>
              <span>{billing === "yearly" ? selectedPlan.yearlyEquivalent : "Facturación mensual"}</span>
            </div>
          </div>

          <div className="plans-page-metrics">
            {selectedPlan.metrics.map((item) => (
              <div key={item.label} className="plans-page-metric">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="plans-page-sections">
            {selectedPlan.detailSections.map((section) => (
              <section key={section.title} className="plans-page-detail-section">
                <h3>{section.title}</h3>
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <section className="plans-page-detail-section">
            <h3>Lo más destacado</h3>
            <ul>
              {selectedPlan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </section>

          <div className="plans-page-actions">
            <Link className="landing-btn-primary" to={ctaTarget}>
              {user ? "Usar este plan en Klinip" : selectedPlan.cta}
            </Link>
            {!user ? (
              <Link className="landing-btn-secondary" to="/login">
                Ya tengo cuenta
              </Link>
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}
