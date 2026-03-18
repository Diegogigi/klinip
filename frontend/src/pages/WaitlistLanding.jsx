import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { joinWaitlist } from "../api";

const roleOptions = [
  { value: "persona", label: "Paciente o usuario", badge: "P" },
  { value: "familiar", label: "Familiar o cuidador", badge: "F" },
  { value: "profesional", label: "Profesional de salud", badge: "S" },
  { value: "institucion", label: "Centro o institucion", badge: "C" },
];

const journeyOptions = [
  { value: "medicamentos", label: "Ordenar medicamentos y recordatorios" },
  { value: "citas", label: "Mantener citas y documentos al dia" },
  { value: "acompanamiento", label: "Acompanamiento familiar o de cuidado" },
  { value: "equipo", label: "Coordinacion con un equipo de salud" },
];

const credibilityItems = [
  "Acceso anticipado cuando abramos nuevos cupos.",
  "Actualizaciones utiles sin descargar la app todavia.",
  "Comunicacion pensada para pacientes, familias y cuidadores.",
  "Ingreso gradual mientras afinamos los ultimos detalles.",
];

const statItems = [
  { value: "1 solo", label: "formulario para reservar tu lugar" },
  { value: "Top 1", label: "aviso cuando abramos acceso" },
  { value: "100%", label: "sin descargar la app por ahora" },
];

const initialForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  role: "persona",
  journey: "medicamentos",
  consent_updates: true,
};

const getSourceLabel = () => {
  if (typeof window === "undefined") return "www";
  return window.location.hostname || "www";
};

export default function WaitlistLanding() {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [serverState, setServerState] = useState({ type: "", message: "" });

  const selectedRole = useMemo(
    () => roleOptions.find((option) => option.value === form.role) || roleOptions[0],
    [form.role]
  );

  const fullName = useMemo(
    () => [form.first_name, form.last_name].map((value) => value.trim()).filter(Boolean).join(" "),
    [form.first_name, form.last_name]
  );

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setServerState({ type: "", message: "" });

    try {
      const response = await joinWaitlist({
        full_name: fullName,
        email: form.email,
        phone: form.phone,
        role: form.role,
        notes: journeyOptions.find((option) => option.value === form.journey)?.label || "",
        consent_updates: form.consent_updates,
        source: `waitlist-${getSourceLabel()}`,
      });

      setServerState({
        type: response?.already_registered ? "info" : "success",
        message:
          response?.message ||
          "Tu lugar quedo registrado. Te avisaremos cuando Klinip abra nuevos accesos.",
      });
      setForm((current) => ({
        ...initialForm,
        email: current.email,
      }));
    } catch (error) {
      const detail =
        error?.response?.data?.detail ||
        "No pudimos registrar tu solicitud ahora. Intentalo nuevamente en unos minutos.";
      setServerState({ type: "error", message: detail });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="wl-page">
      <div className="wl-orb wl-orb-one" aria-hidden="true" />
      <div className="wl-orb wl-orb-two" aria-hidden="true" />

      <main className="wl-shell">
        <section className="wl-copy" aria-label="Presentacion de la lista de espera">
          <div className="wl-pill">
            <span className="wl-pill-dot" aria-hidden="true" />
            Lanzamiento proximo
          </div>

          <h1 className="wl-title">
            Klinip esta casi lista
            <span>para abrir su siguiente etapa.</span>
          </h1>

          <p className="wl-description">
            Mientras pulimos los ultimos detalles, la entrada publica sera por fila. Deja tus
            datos y te escribiremos cuando abramos acceso, demos noticias importantes o activemos
            nuevos cupos.
          </p>

          <div className="wl-checks" role="list" aria-label="Beneficios de la lista">
            {credibilityItems.map((item) => (
              <div key={item} className="wl-check-item" role="listitem">
                <span className="wl-check-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="wl-proof">
            <div className="wl-proof-avatars" aria-hidden="true">
              <span>KR</span>
              <span>FA</span>
              <span>PS</span>
            </div>
            <p>
              Pensada para personas, familias y equipos que necesitan una forma mas clara de
              coordinar salud y seguimiento.
            </p>
          </div>

          <div className="wl-stats" aria-label="Resumen de acceso">
            {statItems.map((item) => (
              <article key={item.label} className="wl-stat-card">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="wl-form-wrap" aria-label="Formulario de lista de espera">
          <div className="wl-card">
            <div className="wl-card-accent" aria-hidden="true" />

            <div className="wl-card-head">
              <p className="wl-card-eyebrow">
                <span aria-hidden="true" />
                Formulario de fila
              </p>
              <h2>
                Reserva tu lugar en <em>Klinip</em>
              </h2>
              <p>
                Completa tus datos y te avisaremos cuando la aplicacion abra acceso publico o
                habilitemos nuevos cupos.
              </p>
              <div className="wl-counter">
                <span className="wl-counter-dot" aria-hidden="true" />
                Acceso por invitacion mientras seguimos afinando el lanzamiento
              </div>
            </div>

            <div className="wl-divider" aria-hidden="true" />

            <form className="wl-form" onSubmit={handleSubmit}>
              <div className="wl-grid-two">
                <label className="wl-field">
                  <span>Nombre</span>
                  <input
                    name="first_name"
                    type="text"
                    value={form.first_name}
                    onChange={handleChange}
                    placeholder="Ej. Daniela"
                    autoComplete="given-name"
                    required
                  />
                </label>

                <label className="wl-field">
                  <span>Apellido</span>
                  <input
                    name="last_name"
                    type="text"
                    value={form.last_name}
                    onChange={handleChange}
                    placeholder="Ej. Rojas"
                    autoComplete="family-name"
                    required
                  />
                </label>
              </div>

              <label className="wl-field">
                <span>Correo</span>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="tu@correo.com"
                  autoComplete="email"
                  required
                />
              </label>

              <div className="wl-grid-two">
                <label className="wl-field">
                  <span>Telefono</span>
                  <input
                    name="phone"
                    type="tel"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="+56 9 1234 5678"
                    autoComplete="tel"
                  />
                </label>

                <label className="wl-field">
                  <span>Hoy te interesa mas</span>
                  <select name="journey" value={form.journey} onChange={handleChange}>
                    {journeyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className="wl-role-group">
                <legend>Tu relacion con Klinip</legend>
                <div className="wl-role-grid">
                  {roleOptions.map((option) => {
                    const checked = form.role === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`wl-role-card${checked ? " is-selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="role"
                          value={option.value}
                          checked={checked}
                          onChange={handleChange}
                        />
                        <span className="wl-role-badge" aria-hidden="true">
                          {option.badge}
                        </span>
                        <span className="wl-role-copy">
                          <strong>{option.label}</strong>
                          <small>
                            {checked ? "Seleccionado para tus avisos" : "Elegir este perfil"}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <label className="wl-consent">
                <input
                  name="consent_updates"
                  type="checkbox"
                  checked={form.consent_updates}
                  onChange={handleChange}
                />
                <span>
                  Quiero recibir noticias de lanzamiento, nuevos cupos y avisos importantes de
                  Klinip.
                </span>
              </label>

              {serverState.message ? (
                <div className={`wl-feedback wl-feedback-${serverState.type || "info"}`}>
                  {serverState.message}
                </div>
              ) : null}

              <button className="wl-submit" type="submit" disabled={submitting}>
                {submitting ? "Guardando tu lugar..." : "Quiero entrar a la fila"}
              </button>
            </form>

            <div className="wl-card-foot">
              <p>Te avisaremos por correo cuando activemos nuevos accesos y novedades importantes.</p>
              <div className="wl-foot-links">
                <Link to="/legal/privacy">Privacidad</Link>
                <Link to="/legal/terms">Terminos</Link>
              </div>
              <div className="wl-selected-role">
                Perfil elegido: <strong>{selectedRole.label}</strong>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
