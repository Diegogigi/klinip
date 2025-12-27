import React, { useState } from "react";
import NotificationSettings from "../components/NotificationSettings";

export default function Settings({ user, onLogout, theme, onToggleTheme }) {
  const profile = user || {};
  const plan = "Backend activo";
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);

  const handleClearLocal = () => {
    if (!window.confirm("¿Borrar los datos locales de Klinip en este navegador?")) return;
    const keys = [
      "klinip_users",
      "klinip_session",
      "klinip_appointments",
      "klinip_documents",
      "klinip_medications",
      "klinip_onboarding_seen",
    ];
    keys.forEach((k) => localStorage.removeItem(k));
    alert("Datos locales borrados. Vuelve a iniciar sesión para continuar.");
    window.location.reload();
  };

  return (
    <>
      <div className="card">
        <h2 className="card-title">Perfil</h2>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Información básica de tu cuenta. Próximamente podrás activar recordatorios por correo y agregar
          perfiles de familia.
        </p>

        <div className="profile-grid">
          <div className="profile-tile">
            <p className="profile-label">Nombre</p>
            <p className="profile-value">{profile.name || "—"}</p>
          </div>
          <div className="profile-tile">
            <p className="profile-label">Correo</p>
            <p className="profile-value">{profile.email || "—"}</p>
          </div>
          <div className="profile-tile">
            <p className="profile-label">Plan</p>
            <p className="profile-value">{plan}</p>
          </div>
        </div>

      </div>

      <div className="card">
        <h3 className="card-title">Apariencia</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Personaliza el modo de color de Klinip.
        </p>
        <button
          className="theme-toggle"
          type="button"
          onClick={onToggleTheme}
          role="switch"
          aria-checked={theme === "dark"}
          style={{ maxWidth: "260px" }}
        >
          <span className="theme-toggle-label">
            {theme === "dark" ? "Modo oscuro" : "Modo claro"}
          </span>
          <span className={`theme-switch ${theme === "dark" ? "is-dark" : ""}`}>
            <span className="theme-switch-thumb" />
          </span>
        </button>
      </div>

      <div className="card">
        <h3 className="card-title">🔔 Notificaciones y Recordatorios</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Configura tus preferencias de notificaciones, recordatorios de citas y medicamentos. 
          Personaliza cuándo quieres recibir alertas.
        </p>
        <button
          className="primary-btn"
          type="button"
          onClick={() => setShowNotificationSettings(true)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: "20px", height: "20px" }}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          Configurar Notificaciones
        </button>
      </div>

      <div className="card">
        <h3 className="card-title">Privacidad y seguridad</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Para producción podrás exportar y borrar tus datos, y configurar notificaciones seguras.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button className="secondary-btn" type="button">
            Exportar datos
          </button>
          <button className="secondary-btn" type="button" onClick={handleClearLocal}>
            Borrar datos locales
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Sesión</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Cierra tu sesión para salir de forma segura de tu cuenta.
        </p>
        <button 
          className="primary-btn" 
          type="button" 
          onClick={() => {
            if (window.confirm("¿Estás seguro de que deseas cerrar sesión?")) {
              onLogout?.();
            }
          }}
          style={{ width: "100%" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: "20px", height: "20px" }}>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Cerrar sesión
        </button>
      </div>

      {showNotificationSettings && (
        <NotificationSettings onClose={() => setShowNotificationSettings(false)} />
      )}
    </>
  );
}
