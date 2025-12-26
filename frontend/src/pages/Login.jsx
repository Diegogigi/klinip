import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login, getMe } from "../api";

export default function Login({ onAuthenticated }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login({ email, password });
      console.log("Login response:", res);
      
      if (res?.access_token) {
        localStorage.setItem("token", res.access_token);
        console.log("Token guardado:", res.access_token.substring(0, 20) + "...");
        
        // Esperar un momento para asegurar que el token se guardó
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Verificar que el token se guardó
        const savedToken = localStorage.getItem("token");
        if (!savedToken) {
          throw new Error("No se pudo guardar el token");
        }
        
        // Intentar obtener el usuario
        try {
          const me = await getMe();
          console.log("Usuario obtenido:", me);
          onAuthenticated(me);
          navigate("/");
        } catch (meError) {
          console.error("Error al obtener usuario:", meError);
          // Si falla getMe, el token puede ser inválido
          localStorage.removeItem("token");
          throw new Error(meError?.response?.data?.detail || meError?.message || "Error al verificar la sesión. Por favor, intenta de nuevo.");
        }
      } else {
        throw new Error("No se recibió token de acceso");
      }
    } catch (err) {
      console.error("Error completo:", err);
      setError(err?.response?.data?.detail || err?.message || "Correo o contraseña incorrectos.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-decoration">
        <div className="auth-blob blob-1"></div>
        <div className="auth-blob blob-2"></div>
        <div className="auth-blob blob-3"></div>
      </div>
      
      <div className="auth-content">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-logo">
              <div className="auth-logo-icon">
                <img src="/icons/icon-192.png" alt="Klinip" />
              </div>
              <h1 className="auth-logo-text">Klinip</h1>
            </div>
            <h2 className="auth-welcome">¡Bienvenido de nuevo!</h2>
            <p className="auth-description">
              Ingresa tus datos para acceder a tu ruta de salud
            </p>
          </div>

          {error && (
            <div className="auth-alert error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="auth-input-group">
              <label className="auth-label">Correo electrónico</label>
              <div className="auth-input-wrapper">
                <svg className="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
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
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
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
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="auth-spinner"></span>
                  Ingresando...
                </>
              ) : (
                <>
                  Ingresar
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                </>
              )}
            </button>
          </form>

          <div className="auth-divider">
            <span>o</span>
          </div>

          <p className="auth-footer">
            ¿No tienes cuenta?{" "}
            <Link to="/register" className="auth-link">
              Crear cuenta gratis
            </Link>
          </p>
        </div>

      </div>
    </div>
  );
}
