import React from "react";
import { Link } from "react-router-dom";

export default function LegalTerms() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <div className="legal-header">
          <p className="legal-kicker">Documento legal</p>
          <h1 className="legal-title">Términos y Condiciones de Uso</h1>
          <p className="legal-meta">Versión 1.0 - Enero 2026</p>
        </div>

        <section className="legal-section">
          <h2>1. Naturaleza del servicio</h2>
          <p>
            Klinip es una aplicación para gestión personal de información de
            salud, que permite organizar citas, medicamentos y documentos
            médicos. Klinip no diagnostica ni reemplaza al médico tratante.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Responsabilidad del usuario</h2>
          <ul className="legal-list">
            <li>La información ingresada es real y de su propiedad.</li>
            <li>Es responsable del uso de recordatorios y alertas.</li>
            <li>No utilizará la plataforma para fines ilícitos.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>3. Reglas de uso</h2>
          <ul className="legal-list">
            <li>Prohibido el uso con datos de terceros sin consentimiento.</li>
            <li>No se permite ingeniería inversa ni usos comerciales sin permiso.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>4. Limitación de responsabilidad</h2>
          <p>
            Klinip no garantiza disponibilidad ininterrumpida, exactitud
            médica del contenido o cumplimiento clínico de recordatorios. Klinip
            no será responsable por daños derivados del uso incorrecto.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Modificaciones</h2>
          <p>
            Klinip puede actualizar estos términos y notificará cambios
            relevantes.
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
