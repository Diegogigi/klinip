import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { requestStepUpEmailCode, stepUpVerify } from "../api";

const METHOD_EMAIL = "email_code";
const METHOD_PASSWORD = "password";
const METHOD_AUTHENTICATOR = "authenticator";

function getFieldMeta(method) {
  if (method === METHOD_PASSWORD) {
    return {
      label: "Contrasena actual",
      placeholder: "Ingresa tu contrasena",
      type: "password",
      inputMode: undefined,
      autoComplete: "current-password",
      maxLength: 128,
      normalize: (value) => value,
      helper: "Usa la misma contrasena con la que inicias sesion.",
    };
  }

  if (method === METHOD_AUTHENTICATOR) {
    return {
      label: "Codigo del autenticador",
      placeholder: "000000 o codigo de respaldo",
      type: "text",
      inputMode: "text",
      autoComplete: "one-time-code",
      maxLength: 32,
      normalize: (value) => value.slice(0, 32),
      helper: "Ingresa el codigo de tu app autenticadora o un codigo de respaldo.",
    };
  }

  return {
    label: "Codigo temporal",
    placeholder: "000000",
    type: "text",
    inputMode: "numeric",
    autoComplete: "one-time-code",
    maxLength: 6,
    normalize: (value) => value.replace(/\D/g, "").slice(0, 6),
    helper: "Revisa tu correo e ingresa el codigo de 6 digitos.",
  };
}

export default function StepUpModal({
  open,
  onClose,
  onVerified,
  hasMfa = false,
  actionLabel = "esta accion",
}) {
  const [method, setMethod] = useState(METHOD_EMAIL);
  const [proof, setProof] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [error, setError] = useState("");
  const [emailNotice, setEmailNotice] = useState("");
  const [emailMeta, setEmailMeta] = useState(null);
  const [showAlternateMethods, setShowAlternateMethods] = useState(false);
  const inputRef = useRef(null);

  const fieldMeta = useMemo(() => getFieldMeta(method), [method]);
  const normalizedProof = method === METHOD_PASSWORD ? proof : proof.trim();
  const canSubmit = normalizedProof.length > 0;
  const emailSent = Boolean(emailMeta || emailNotice);

  useEffect(() => {
    if (!open) return;
    setMethod(METHOD_EMAIL);
    setProof("");
    setLoading(false);
    setSendingEmailCode(false);
    setError("");
    setEmailNotice("");
    setEmailMeta(null);
    setShowAlternateMethods(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setProof("");
    setError("");
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [method, open, emailSent]);

  if (!open) return null;

  const handleSendEmailCode = async () => {
    setSendingEmailCode(true);
    setError("");
    setEmailNotice("");
    try {
      const response = await requestStepUpEmailCode();
      setEmailMeta(response || null);
      setEmailNotice(
        response?.masked_email
          ? `El codigo llegara a ${response.masked_email}.`
          : "El codigo llegara a tu correo."
      );
      setMethod(METHOD_EMAIL);
      setShowAlternateMethods(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "No se pudo enviar el codigo.");
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

  const renderEmailFlow = () => (
    <>
      <div className="stepup-email-panel">
        <p className="stepup-email-title">Te enviaremos un codigo temporal al correo de tu cuenta.</p>
        <button
          type="button"
          className="secondary-btn stepup-email-send"
          onClick={handleSendEmailCode}
          disabled={sendingEmailCode || loading}
        >
          {sendingEmailCode ? "Enviando..." : emailSent ? "Reenviar codigo" : "Enviar codigo"}
        </button>
      </div>

      {emailNotice ? <div className="auth-alert success stepup-alert"><span>{emailNotice}</span></div> : null}
      {error ? <div className="auth-alert error stepup-alert"><span>{error}</span></div> : null}

      {emailSent ? (
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
                "Confirmar codigo"
              )}
            </button>
          </div>
        </form>
      ) : null}
    </>
  );

  const alternateMethods = [
    { id: METHOD_PASSWORD, label: "Contrasena" },
    ...(hasMfa ? [{ id: METHOD_AUTHENTICATOR, label: "Autenticador" }] : []),
  ];

  const renderAlternateFlow = () => (
    <>
      <div className="stepup-alt-switch" role="tablist" aria-label="Metodo alternativo">
        {alternateMethods.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`stepup-alt-btn${method === option.id ? " is-active" : ""}`}
            onClick={() => setMethod(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

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
        </div>

        <div className="stepup-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setMethod(METHOD_EMAIL);
              setShowAlternateMethods(false);
              setError("");
            }}
            disabled={loading}
          >
            Volver al correo
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
    </>
  );

  const modal = (
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
              <h3 id="stepup-modal-title">Confirma que eres tu</h3>
              <p>Para <strong>{actionLabel}</strong>, enviaremos un codigo a tu correo.</p>
            </div>
          </div>
          <button className="stepup-modal-close" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="stepup-modal-body">
          {showAlternateMethods ? renderAlternateFlow() : renderEmailFlow()}

          {!showAlternateMethods ? (
            <button
              type="button"
              className="stepup-inline-link"
              onClick={() => {
                setShowAlternateMethods(true);
                setMethod(METHOD_PASSWORD);
                setError("");
              }}
              disabled={loading || sendingEmailCode}
            >
              Usar otro metodo
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.getElementById("overlay-root") || document.body);
}
