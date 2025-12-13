import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login, getMe, DEMO_MODE } from "../api";

export default function Login({ onAuthenticated }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login({ email, password });
      if (res?.access_token) {
        localStorage.setItem("token", res.access_token);
      }
      const me = await getMe();
      onAuthenticated(me);
      navigate("/");
    } catch (err) {
      console.error(err);
      setError("Correo o contraseña incorrectos.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <div className="card">
        <p className="pill">Demo local</p>
        <h1 className="auth-title">Ingresar a Klinip</h1>
        <p className="auth-subtitle">
          Para el demo, tus datos se guardan solo en este navegador. Así tu cabeza descansa
          y Klinip recuerda por ti.
        </p>
        {error && <p className="error-text">{error}</p>}
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">Correo electrónico</label>
            <input
              className="input-field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="tu@correo.cl"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Contraseña</label>
            <input
              className="input-field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>
          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
        <p className="auth-footer">
          ¿No tienes cuenta?{" "}
          <Link to="/register" className="link">
            Crear cuenta
          </Link>
        </p>
        {DEMO_MODE && (
          <p className="tiny-note">
            Tip: puedes usar cualquier correo válido; no hay conexión a backend en modo demo.
          </p>
        )}
      </div>
    </div>
  );
}
