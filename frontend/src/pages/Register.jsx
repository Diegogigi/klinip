import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register, login, getMe, DEMO_MODE } from "../api";

export default function Register({ onRegistered }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    try {
      setLoading(true);
      await register({ name, email, password });
      const session = await login({ email, password });
      if (session?.access_token) {
        localStorage.setItem("token", session.access_token);
      }
      const me = await getMe();
      onRegistered(me);
      navigate("/");
    } catch (err) {
      console.error(err);
      setError(err?.message || "No se pudo crear la cuenta. ¿Correo ya registrado?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <div className="card">
        <p className="pill">Demo local</p>
        <h1 className="auth-title">Crear cuenta en Klinip</h1>
        <p className="auth-subtitle">
          En modo demo guardamos todo en este navegador. Podrás crear citas, exámenes y
          documentos sin depender de un backend.
        </p>
        {error && <p className="error-text">{error}</p>}
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">Nombre completo</label>
            <input
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Ej: Ana Pérez"
            />
          </div>
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
              placeholder="Elige una clave fácil de recordar"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Repetir contraseña</label>
            <input
              className="input-field"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? "Creando cuenta..." : "Registrarse"}
          </button>
        </form>
        <p className="auth-footer">
          ¿Ya tienes cuenta?{" "}
          <Link to="/login" className="link">
            Ingresar
          </Link>
        </p>
        {DEMO_MODE && (
          <p className="tiny-note">
            Este demo funciona 100% en localStorage. Puedes limpiar tus datos cuando quieras
            desde el navegador.
          </p>
        )}
      </div>
    </div>
  );
}
