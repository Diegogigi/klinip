import React from "react";
import { Link } from "react-router-dom";

export default function LegalConsent() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <div className="legal-header">
          <p className="legal-kicker">Documento legal</p>
          <h1 className="legal-title">Consentimiento Informado</h1>
          <p className="legal-meta">Version 1.0 - Enero 2026</p>
        </div>

        <section className="legal-section">
          <p>Al usar Klinip, el usuario declara:</p>
          <ul className="legal-list">
            <li>Que entiende que la plataforma recopila datos personales sensibles de salud.</li>
            <li>Que otorga consentimiento explicito e informado para su tratamiento.</li>
            <li>Que puede revocar su consentimiento y solicitar eliminacion total en cualquier momento.</li>
            <li>
              Que conoce que Klinip no toma decisiones medicas automaticas y la
              responsabilidad primaria permanece en el usuario y su equipo clinico.
            </li>
            <li>
              Que acepta el uso de IA y reconocimiento de documentos solo para
              asistir en el llenado automatico y organizacion de su informacion.
            </li>
          </ul>
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
