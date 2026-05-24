import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { login, getMe, verifyMfaLogin } from "../api";
import BrandLogo from "../components/BrandLogo";
import { clearAppCaches } from "../utils/cache";
import { extractApiError } from "../utils/errors";

export default function Login({ onAuthenticated }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const mfaInputRef = useRef(null);

  const finalizeLogin = async (accessToken) => {
    localStorage.setItem("token", accessToken);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!localStorage.getItem("token")) throw new Error("No se pudo guardar el token");
    const me = await getMe();
    if (me?.email && me.email.toLowerCase() !== email.trim().toLowerCase()) {
      localStorage.removeItem("token");
      throw new Error("La sesión no coincide con el usuario ingresado. Intenta de nuevo.");
    }
    onAuthenticated(me);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await clearAppCaches();
      localStorage.removeItem("token");
      const res = await login({ email, password });

      if (res?.mfa_required) {
        if (res.refresh_token) localStorage.setItem("refresh_token", res.refresh_token);
        setMfaToken(res.mfa_token);
        setMfaRequired(true);
        setTimeout(() => mfaInputRef.current?.focus(), 100);
        return;
      }

      if (res?.access_token) {
        if (res.refresh_token) localStorage.setItem("refresh_token", res.refresh_token);
        await finalizeLogin(res.access_token);
      } else {
        throw new Error("No se recibió token de acceso");
      }
    } catch (err) {
      setError(extractApiError(err, "Correo o contraseña incorrectos."));
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await verifyMfaLogin({ mfa_token: mfaToken, code: mfaCode });
      if (res?.access_token) {
        if (res.refresh_token) localStorage.setItem("refresh_token", res.refresh_token);
        await finalizeLogin(res.access_token);
      } else {
        throw new Error("Respuesta inesperada del servidor");
      }
    } catch (err) {
      setError(extractApiError(err, "Código incorrecto. Intenta de nuevo."));
      setMfaCode("");
      setTimeout(() => mfaInputRef.current?.focus(), 100);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-decoration">
        <div className="auth-blob blob-1" />
        <div className="auth-blob blob-2" />
        <div className="auth-blob blob-3" />
      </div>

      <div className="auth-content">
        <Link to="/" className="auth-back-link" aria-label="Volver a la landing">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Volver al inicio
        </Link>

        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-logo">
              <BrandLogo
                className="auth-logo-text brand-logo-auth"
                markClassName="brand-logo-auth-mark"
                imgClassName="brand-logo-auth-img"
                nameClassName="brand-logo-auth-name"
                variant="outline"
              />
            </div>

            {mfaRequired ? (
              <>
                <h2 className="auth-welcome">Verificación en dos pasos</h2>
                <p className="auth-description">
                  Ingresa el código de tu aplicación autenticadora
                </p>
              </>
            ) : (
              <>
                <h2 className="auth-welcome">¡Bienvenido de nuevo!</h2>
                <p className="auth-description">
                  Ingresa tus datos para acceder a tu ruta de salud
                </p>
              </>
            )}
          </div>

          {error ? (
            <div className="auth-alert error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          ) : null}

          {mfaRequired ? (
            <form onSubmit={handleMfaSubmit} className="auth-form">
              <div className="auth-input-group">
                <label className="auth-label">Código de autenticación</label>
                <div className="auth-input-wrapper">
                  <svg className="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <input
                    ref={mfaInputRef}
                    className="auth-input"
                    type="text"
                    inputMode="numeric"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                    placeholder="000000"
                    autoComplete="one-time-code"
                    maxLength={10}
                  />
                </div>
                <p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.35rem" }}>
                  También puedes ingresar un código de respaldo de 10 caracteres.
                </p>
              </div>

              <button className="auth-submit" type="submit" disabled={loading || mfaCode.length < 6}>
                {loading ? (
                  <>
                    <span className="auth-spinner" />
                    Verificando...
                  </>
                ) : (
                  <>
                    Verificar
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </>
                )}
              </button>

              <p className="auth-footer" style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="auth-link"
                  style={{ background: "none", border: "none", cursor: "pointer" }}
                  onClick={() => {
                    setMfaRequired(false);
                    setMfaCode("");
                    setError("");
                  }}
                >
                  ← Volver al inicio de sesión
                </button>
              </p>
            </form>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="auth-form">
                <div className="auth-input-group">
                  <label className="auth-label">Correo electrónico</label>
                  <div className="auth-input-wrapper">
                    <svg className="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    <input
                      className="auth-input"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="tu@correo.com"
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="auth-input-group">
                  <label className="auth-label">Contraseña</label>
                  <div className="auth-input-wrapper">
                    <svg className="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <input
                      className="auth-input"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <button className="auth-submit" type="submit" disabled={loading}>
                  {loading ? (
                    <>
                      <span className="auth-spinner" />
                      Ingresando...
                    </>
                  ) : (
                    <>
                      Ingresar
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </>
                  )}
                </button>
              </form>

              <p className="auth-footer" style={{ marginTop: "0.75rem" }}>
                <Link to="/forgot-password" className="auth-link">
                  ¿Olvidaste tu contraseña?
                </Link>
              </p>

              <div className="auth-divider">
                <span>o</span>
              </div>

              <p className="auth-footer">
                ¿No tienes cuenta?{" "}
                <Link to="/register" className="auth-link">
                  Crear cuenta gratis
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
