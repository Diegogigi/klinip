import React, { useEffect, useMemo, useState } from "react";
import { joinWaitlist, trackWaitlistVisit } from "../api";

const roleOptions = [
  {
    value: "solo",
    label: "Solo yo",
    helper: "Cuenta personal",
    icon: "Yo",
    apiRole: "persona",
  },
  {
    value: "familia",
    label: "Mi familia",
    helper: "Gestión familiar",
    icon: "Fa",
    apiRole: "familiar",
  },
  {
    value: "cuidador",
    label: "Cuido a alguien",
    helper: "Apoyo y seguimiento",
    icon: "Cu",
    apiRole: "familiar",
  },
  {
    value: "profesional",
    label: "Soy profesional",
    helper: "Uso profesional",
    icon: "Pr",
    apiRole: "profesional",
  },
];

const journeyOptions = [
  { value: "", label: "Selecciona una opcion" },
  { value: "libretas", label: "Libretas o papel" },
  { value: "whatsapp", label: "WhatsApp / fotos del celular" },
  { value: "carpetas", label: "Carpetas fisicas" },
  { value: "otra_app", label: "Otra app (Notion, Excel, etc.)" },
  { value: "sin_sistema", label: "No tengo un sistema" },
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
  role: "solo",
  journey: "",
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

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const visitKey = "klinip_waitlist_visit_tracked";
    const existing = window.sessionStorage.getItem(visitKey);
    if (existing) return undefined;

    const sessionIdKey = "klinip_waitlist_session_id";
    let sessionId = window.sessionStorage.getItem(sessionIdKey);
    if (!sessionId) {
      sessionId = `wl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      window.sessionStorage.setItem(sessionIdKey, sessionId);
    }

    window.sessionStorage.setItem(visitKey, "1");
    trackWaitlistVisit({
      source: `waitlist-${getSourceLabel()}`,
      path: window.location.pathname + (window.location.hash || ""),
      session_id: sessionId,
    }).catch(() => {});

    return undefined;
  }, []);

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
        role: selectedRole.apiRole,
        notes: journeyOptions.find((option) => option.value === form.journey)?.label || "",
        consent_updates: form.consent_updates,
        source: `waitlist-${getSourceLabel()}`,
      });

      setServerState({
        type: response?.already_registered ? "info" : "success",
        message:
          response?.message ||
          "Tu lugar quedó registrado. Te avisaremos cuando Klinip abra nuevos accesos.",
      });
      setForm((current) => ({
        ...initialForm,
        email: current.email,
      }));
    } catch (error) {
      const detail =
        error?.response?.data?.detail ||
          "No pudimos registrar tu solicitud ahora. Inténtalo nuevamente en unos minutos.";
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
        <section className="wl-copy" aria-label="Presentación de la lista de espera">
          <div className="wl-pill">
            <span className="wl-pill-dot" aria-hidden="true" />
            Lanzamiento próximo
          </div>

          <h1 className="wl-title">
            Klinip está casi lista
            <span>para abrir su siguiente etapa.</span>
          </h1>

          <p className="wl-description">
            Mientras pulimos los últimos detalles, la entrada pública será por fila. Deja tus
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
              Pensada para personas, familias y equipos que necesitan una forma más clara de
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
                Completa tus datos y te avisaremos cuando la aplicación abra acceso público o
                habilitemos nuevos cupos.
              </p>
              <div className="wl-counter">
                <span className="wl-counter-dot" aria-hidden="true" />
                Acceso por invitación mientras seguimos afinando el lanzamiento
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

              <label className="wl-field">
                <span>Teléfono</span>
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
                <span>¿Cómo gestionas tu salud hoy?</span>
                <select name="journey" value={form.journey} onChange={handleChange} required>
                  {journeyOptions.map((option) => (
                    <option key={option.value || "placeholder"} value={option.value} disabled={!option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset className="wl-role-group">
                <legend>¿Quién usará Klinip?</legend>
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
                        <span className="wl-role-radio" aria-hidden="true">
                          <span className="wl-role-radio-dot" />
                        </span>
                        <span className="wl-role-copy">
                          <span className="wl-role-line">
                            <span className="wl-role-emoji" aria-hidden="true">
                              {option.icon}
                            </span>
                            <strong>{option.label}</strong>
                          </span>
                          <small>{option.helper}</small>
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
                  Acepto recibir novedades de Klinip por correo. Puedes darte de baja en cualquier
                  momento. Consulta nuestra <span className="wl-consent-policy">política de privacidad.</span>
                </span>
              </label>

              {serverState.message ? (
                <div className={`wl-feedback wl-feedback-${serverState.type || "info"}`}>
                  {serverState.message}
                </div>
              ) : null}

              <button className="wl-submit" type="submit" disabled={submitting}>
                <span className="wl-submit-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 3l6 2.4v5.7c0 4.2-2.5 8-6 9.9-3.5-1.9-6-5.7-6-9.9V5.4L12 3z" />
                  </svg>
                </span>
                <span>{submitting ? "Guardando tu lugar..." : "Unirme a la lista de espera"}</span>
              </button>
            </form>

            <div className="wl-card-foot">
              <p>Te avisaremos por correo cuando activemos nuevos accesos y novedades importantes.</p>
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
