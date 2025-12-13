import React from "react";
import { DEMO_MODE } from "../api";

export default function Settings({ user }) {
  const profile = user || {};
  const plan = DEMO_MODE ? "Demo local" : "Backend activo";

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

        {DEMO_MODE && (
          <p className="tiny-note" style={{ marginTop: "0.75rem" }}>
            Demo local: tus datos viven en este navegador. Limpia el almacenamiento si quieres empezar
            de cero.
          </p>
        )}
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
    </>
  );
}
