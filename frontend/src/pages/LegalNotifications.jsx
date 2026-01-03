import React from "react";
import { Link } from "react-router-dom";

export default function LegalNotifications() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <div className="legal-header">
          <p className="legal-kicker">Documento legal</p>
          <h1 className="legal-title">Notificaciones de Klinip</h1>
          <p className="legal-meta">Version 1.0 - Enero 2026</p>
        </div>

        <section className="legal-section">
          <p>
            Klinip puede enviar notificaciones push para recordatorios de
            medicamentos, citas y examenes. Estas alertas se activan solo con tu
            permiso y puedes desactivarlas en cualquier momento desde tu perfil.
          </p>
        </section>

        <section className="legal-section">
          <h2>Que se envia</h2>
          <ul className="legal-list">
            <li>Recordatorios de citas, examenes y tramites.</li>
            <li>Recordatorios de medicamentos segun frecuencia u horario.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>Control del usuario</h2>
          <p>
            Puedes configurar o revocar tu consentimiento de notificaciones desde
            el perfil. Si decides configurar despues, Klinip puede volver a
            preguntarte mas adelante.
          </p>
        </section>

        <div className="legal-footer">
          <Link className="secondary-btn" to="/register">
            Volver a registro
          </Link>
        </div>
      </div>
    </div>
  );
}
