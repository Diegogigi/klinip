import React, { useEffect, useRef, useState } from "react";
import { stepUpVerify } from "../api";

/**
 * Modal de step-up authentication.
 * Se muestra cuando una acción sensible (descarga de documento, eliminar cuenta,
 * modificar permisos familiares, etc.) requiere verificación adicional.
 *
 * Props:
 *   open         {boolean}           — controla la visibilidad
 *   onClose      {() => void}        — cerrar sin completar
 *   onVerified   {(token) => void}   — verificación exitosa, recibe el step-up token
 *   hasMfa       {boolean}           — si el usuario tiene MFA activo
 *   actionLabel  {string}            — descripción de la acción (para el mensaje)
 */
export default function StepUpModal({ open, onClose, onVerified, hasMfa = false, actionLabel = "esta acción" }) {
  const [proof, setProof] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setProof("");
      setError("");
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!proof.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await stepUpVerify({ proof: proof.trim() });
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
      className="modal-overlay"
      style={{ zIndex: 2100 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-card" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1e40af" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span style={{ fontWeight: 600, fontSize: "1rem" }}>Verificación requerida</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        <div className="modal-body">
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Para <strong>{actionLabel}</strong>, confirma tu identidad:
          </p>

          {error && (
            <div className="auth-alert error" style={{ marginBottom: "0.75rem" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="input-group" style={{ marginBottom: "1rem" }}>
              <label className="input-label">
                {hasMfa
                  ? "Código de autenticador, código de respaldo o contraseña"
                  : "Contraseña actual"}
              </label>
              <input
                ref={inputRef}
                className="input-field"
                type={hasMfa ? "text" : "password"}
                inputMode={hasMfa ? "numeric" : undefined}
                value={proof}
                onChange={(e) => setProof(hasMfa ? e.target.value.slice(0, 16) : e.target.value)}
                placeholder={hasMfa ? "000000 o código de respaldo" : "••••••••"}
                autoComplete={hasMfa ? "one-time-code" : "current-password"}
                maxLength={hasMfa ? 16 : 128}
                disabled={loading}
              />
            </div>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
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
                disabled={loading || !proof.trim()}
              >
                {loading ? (
                  <>
                    <span className="auth-spinner" style={{ width: "14px", height: "14px" }}></span>
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
