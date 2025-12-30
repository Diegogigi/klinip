import React from "react";
import { Link } from "react-router-dom";

export default function LegalTerms() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <div className="legal-header">
          <p className="legal-kicker">Documento legal</p>
          <h1 className="legal-title">Terminos y Condiciones de Uso</h1>
          <p className="legal-meta">Version 1.0 - Enero 2026</p>
        </div>

        <section className="legal-section">
          <h2>1. Naturaleza del servicio</h2>
          <p>
            Klinip es una aplicacion para gestion personal de informacion de
            salud, que permite organizar citas, medicamentos y documentos
            medicos. Klinip no diagnostica ni reemplaza al medico tratante.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Responsabilidad del usuario</h2>
          <ul className="legal-list">
            <li>La informacion ingresada es real y de su propiedad.</li>
            <li>Es responsable del uso de recordatorios y alertas.</li>
            <li>No utilizara la plataforma para fines ilicitos.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>3. Reglas de uso</h2>
          <ul className="legal-list">
            <li>Prohibido el uso con datos de terceros sin consentimiento.</li>
            <li>No se permite ingenieria inversa ni usos comerciales sin permiso.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>4. Limitacion de responsabilidad</h2>
          <p>
            Klinip no garantiza disponibilidad ininterrumpida, exactitud
            medica del contenido o cumplimiento clinico de recordatorios. Klinip
            no sera responsable por danos derivados del uso incorrecto.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Modificaciones</h2>
          <p>
            Klinip puede actualizar estos terminos y notificara cambios
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
