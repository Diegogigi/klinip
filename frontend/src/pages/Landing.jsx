import React from "react";
import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="landing">
      <div className="landing-hero">
        <div className="landing-badge">Klinip</div>
        <h1>Organiza tu salud en un solo lugar.</h1>
        <p>Agenda citas, guarda documentos, registra medicamentos y recibe recordatorios.</p>
        <div className="landing-actions">
          <Link className="primary-btn" to="/register">
            Crear cuenta
          </Link>
          <Link className="secondary-btn" to="/login">
            Ingresar
          </Link>
        </div>
        <div className="landing-meta">Privado, seguro y listo para escritorio y móvil.</div>
      </div>
      <div className="landing-cards">
        <div className="landing-card">
          <h3>Recordatorios inteligentes</h3>
          <p>Notificaciones push, email y alertas visuales para no olvidar tus atenciones.</p>
        </div>
        <div className="landing-card">
          <h3>Calendario unificado</h3>
          <p>Todas tus citas y medicamentos en una sola vista mensual.</p>
        </div>
        <div className="landing-card">
          <h3>Documentos siempre a mano</h3>
          <p>Resultados, recetas e informes disponibles en cualquier dispositivo.</p>
        </div>
      </div>
    </div>
  );
}
