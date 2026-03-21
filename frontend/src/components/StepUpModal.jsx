import React, { useEffect, useRef, useState } from "react";
import { requestStepUpEmailCode, stepUpVerify } from "../api";

const METHOD_EMAIL = "email_code";
const METHOD_PASSWORD = "password";
const METHOD_AUTHENTICATOR = "authenticator";

function getMethodOptions(hasMfa) {
  const options = [
    {
      id: METHOD_EMAIL,
      title: "Código por correo",
      badge: "Recomendado",
      description: "Te enviamos un código temporal de 6 dígitos al correo de tu cuenta.",
    },
    {
      id: METHOD_PASSWORD,
      title: "Contraseña actual",
      badge: "Siempre disponible",
      description: "Usa la misma contraseña con la que inicias sesión en Klinip.",
    },
  ];

  if (hasMfa) {
    options.push({
      id: METHOD_AUTHENTICATOR,
      title: "App autenticadora",
      badge: "Opcional",
      description: "Usa Google Authenticator, Microsoft Authenticator, Authy u otra app compatible.",
    });
  }

  return options;
}

function getMethodFieldMeta(method) {
  if (method === METHOD_EMAIL) {
    return {
      label: "Código temporal",
      placeholder: "000000",
      type: "text",
      inputMode: "numeric",
      autoComplete: "one-time-code",
      maxLength: 6,
      helper:
        "Escribe el código de 6 dígitos que llegó a tu correo. Expira en pocos minutos.",
      normalize: (value) => value.replace(/\D/g, "").slice(0, 6),
    };
  }

  if (method === METHOD_AUTHENTICATOR) {
    return {
      label: "Código del autenticador o código de respaldo",
      placeholder: "000000 o código de respaldo",
      type: "text",
      inputMode: "text",
      autoComplete: "one-time-code",
      maxLength: 32,
      helper:
        "La app autenticadora es opcional. Si la activaste, aquí puedes usar el código de 6 dígitos o un código de respaldo.",
      normalize: (value) => value.slice(0, 32),
    };
  }

  return {
    label: "Contraseña actual",
    placeholder: "Ingresa tu contraseña",
    type: "password",
    inputMode: undefined,
    autoComplete: "current-password",
    maxLength: 128,
    helper:
      "Corresponde a la misma contraseña que usas para iniciar sesión. No es la contraseña del perfil de salud.",
    normalize: (value) => value,
  };
}

export default function StepUpModal({
  open,
  onClose,
  onVerified,
  hasMfa = false,
  actionLabel = "esta acción",
}) {
  const [method, setMethod] = useState(METHOD_EMAIL);
  const [proof, setProof] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [error, setError] = useState("");
  const [emailNotice, setEmailNotice] = useState("");
  const [emailMeta, setEmailMeta] = useState(null);
  const inputRef = useRef(null);

  const methodOptions = getMethodOptions(hasMfa);
  const fieldMeta = getMethodFieldMeta(method);
  const normalizedProof =
    method === METHOD_PASSWORD ? proof : proof.trim();
  const canSubmit = normalizedProof.length > 0;

  useEffect(() => {
    if (!open) return;
    setMethod(METHOD_EMAIL);
    setProof("");
    setLoading(false);
    setSendingEmailCode(false);
    setError("");
    setEmailNotice("");
    setEmailMeta(null);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setProof("");
    setError("");
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [method, open]);

  if (!open) return null;

  const handleMethodChange = (nextMethod) => {
    setMethod(nextMethod);
  };

  const handleSendEmailCode = async () => {
    setSendingEmailCode(true);
    setError("");
    setEmailNotice("");
    try {
      const response = await requestStepUpEmailCode();
      setEmailMeta(response || null);
      setEmailNotice(
        response?.masked_email
          ? `Enviamos un código temporal a ${response.masked_email}.`
          : "Enviamos un código temporal a tu correo."
      );
      setTimeout(() => inputRef.current?.focus(), 80);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "No se pudo enviar el código temporal.");
    } finally {
      setSendingEmailCode(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      const response = await stepUpVerify({
        method,
        proof: normalizedProof,
      });
      if (response?.stepup_token) {
        setProof("");
        onVerified(response.stepup_token);
        return;
      }
      setError("Respuesta inesperada. Intenta nuevamente.");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(
        typeof detail === "string"
          ? detail
          : detail?.message || "No pudimos confirmar tu identidad."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-backdrop stepup-modal-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="modal-card stepup-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stepup-modal-title"
      >
        <div className="stepup-modal-header">
          <div className="stepup-modal-title-wrap">
            <svg
              className="stepup-modal-lock"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <div>
              <h3 id="stepup-modal-title">Confirma que eres tú</h3>
              <p>
                Para <strong>{actionLabel}</strong>, elige un método de seguridad y valida tu identidad.
              </p>
            </div>
          </div>
          <button className="stepup-modal-close" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="stepup-modal-body">
          <div className="stepup-intro-card">
            <p className="stepup-intro-title">¿Qué está pasando?</p>
            <p className="stepup-intro-copy">
              Esta verificación protege documentos e información sensible. Puedes usar tu correo, tu contraseña
              o, si la activaste, una app autenticadora.
            </p>
          </div>

          <div className={`stepup-method-switch${hasMfa ? " has-three" : ""}`} role="tablist" aria-label="Método de verificación">
            {methodOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`stepup-method-btn${method === option.id ? " is-active" : ""}`}
                onClick={() => handleMethodChange(option.id)}
              >
                <span className="stepup-method-btn-title">{option.title}</span>
                <span className="stepup-method-btn-badge">{option.badge}</span>
                <span className="stepup-method-btn-desc">{option.description}</span>
              </button>
            ))}
          </div>

          {method === METHOD_EMAIL ? (
            <div className="stepup-channel-card">
              <div>
                <p className="stepup-channel-title">Código temporal por correo</p>
                <p className="stepup-channel-copy">
                  No necesitas instalar otra app. Te enviaremos un código temporal a tu correo registrado.
                </p>
              </div>
              <button
                type="button"
                className="secondary-btn stepup-email-send"
                onClick={handleSendEmailCode}
                disabled={sendingEmailCode || loading}
              >
                {sendingEmailCode ? "Enviando..." : emailMeta ? "Reenviar código" : "Enviar código"}
              </button>
            </div>
          ) : null}

          {method === METHOD_AUTHENTICATOR ? (
            <div className="stepup-channel-card is-subtle">
              <div>
                <p className="stepup-channel-title">App autenticadora opcional</p>
                <p className="stepup-channel-copy">
                  Puedes usar apps gratuitas como Google Authenticator, Microsoft Authenticator o Authy.
                </p>
              </div>
            </div>
          ) : null}

          {emailNotice ? <div className="auth-alert success stepup-alert"><span>{emailNotice}</span></div> : null}
          {error ? <div className="auth-alert error stepup-alert"><span>{error}</span></div> : null}

          <form onSubmit={handleSubmit} className="stepup-form">
            <div className="input-group">
              <label className="input-label">{fieldMeta.label}</label>
              <input
                ref={inputRef}
                className="input-field"
                type={fieldMeta.type}
                inputMode={fieldMeta.inputMode}
                value={proof}
                onChange={(event) => setProof(fieldMeta.normalize(event.target.value))}
                placeholder={fieldMeta.placeholder}
                autoComplete={fieldMeta.autoComplete}
                maxLength={fieldMeta.maxLength}
                disabled={loading}
              />
              <span className="tiny-note stepup-help-text">{fieldMeta.helper}</span>
              {method === METHOD_EMAIL && emailMeta?.expires_in ? (
                <span className="tiny-note stepup-help-text">
                  El código dura aproximadamente {Math.max(1, Math.round(emailMeta.expires_in / 60))} minutos.
                </span>
              ) : null}
            </div>

            <div className="stepup-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={onClose}
                disabled={loading || sendingEmailCode}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-btn"
                disabled={loading || !canSubmit}
              >
                {loading ? (
                  <>
                    <span className="auth-spinner stepup-spinner"></span>
                    Verificando...
                  </>
                ) : (
                  "Confirmar"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
