import React, { useEffect, useRef, useState } from "react";
import { stepUpVerify } from "../api";

/**
 * Modal de step-up authentication.
 * Se muestra cuando una acción sensible requiere verificación adicional.
 */
export default function StepUpModal({
  open,
  onClose,
  onVerified,
  hasMfa = false,
  actionLabel = "esta acción",
}) {
  const [proof, setProof] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [method, setMethod] = useState(hasMfa ? "code" : "password");
  const inputRef = useRef(null);

  const isPasswordMethod = method === "password";
  const normalizedProof = isPasswordMethod ? proof : proof.trim();
  const canSubmit = isPasswordMethod ? proof.length > 0 : normalizedProof.length > 0;

  useEffect(() => {
    if (open) {
      setProof("");
      setError("");
      setMethod(hasMfa ? "code" : "password");
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [hasMfa, open]);

  if (!open) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      const res = await stepUpVerify({ proof: normalizedProof });
      if (res?.stepup_token) {
        setProof("");
        onVerified(res.stepup_token);
      } else {
        setError("Respuesta inesperada. Intenta de nuevo.");
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(
        typeof detail === "string"
          ? detail
          : detail?.message || "Verificación incorrecta. Intenta de nuevo."
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
              <h3 id="stepup-modal-title">Verificación requerida</h3>
              <p>
                Para <strong>{actionLabel}</strong>, confirma tu identidad.
              </p>
            </div>
          </div>
          <button className="stepup-modal-close" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="stepup-modal-body">
          {hasMfa ? (
            <div className="stepup-method-switch" role="tablist" aria-label="Método de verificación">
              <button
                type="button"
                className={`stepup-method-btn${!isPasswordMethod ? " is-active" : ""}`}
                onClick={() => {
                  setMethod("code");
                  setProof("");
                  setError("");
                }}
              >
                Código o respaldo
              </button>
              <button
                type="button"
                className={`stepup-method-btn${isPasswordMethod ? " is-active" : ""}`}
                onClick={() => {
                  setMethod("password");
                  setProof("");
                  setError("");
                }}
              >
                Contraseña
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="auth-alert error stepup-alert">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="stepup-form">
            <div className="input-group">
              <label className="input-label">
                {isPasswordMethod
                  ? "Contraseña actual"
                  : "Código del autenticador o código de respaldo"}
              </label>
              <input
                ref={inputRef}
                className="input-field"
                type={isPasswordMethod ? "password" : "text"}
                inputMode={isPasswordMethod ? undefined : "text"}
                value={proof}
                onChange={(event) =>
                  setProof(isPasswordMethod ? event.target.value : event.target.value.slice(0, 32))
                }
                placeholder={isPasswordMethod ? "Ingresa tu contraseña actual" : "000000 o código de respaldo"}
                autoComplete={isPasswordMethod ? "current-password" : "one-time-code"}
                maxLength={isPasswordMethod ? 128 : 32}
                disabled={loading}
              />
              <span className="tiny-note stepup-help-text">
                {isPasswordMethod
                  ? "Usa tu contraseña exacta. Si contiene espacios, se respetarán tal como los escribas."
                  : "Puedes usar el código de 6 dígitos del autenticador o un código de respaldo."}
              </span>
            </div>

            <div className="stepup-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={onClose}
                disabled={loading}
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
