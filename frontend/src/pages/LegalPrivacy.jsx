import React from "react";
import { Link } from "react-router-dom";

export default function LegalPrivacy() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <div className="legal-header">
          <p className="legal-kicker">Documento legal</p>
          <h1 className="legal-title">Política de Privacidad de Klinip</h1>
          <p className="legal-meta">Versión 1.0 - Enero 2026</p>
        </div>

        <section className="legal-section">
          <h2>1. Finalidad del tratamiento</h2>
          <p>
            Klinip recopila y procesa datos personales con el propósito de
            gestionar información de salud personal, organizar citas, medicamentos
            y documentos clínicos, generar recordatorios y notificaciones, y
            mejorar la experiencia del usuario mediante analítica interna.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Datos que se recopilan</h2>
          <ul className="legal-list">
            <li>Datos de identificación: nombre, correo electrónico.</li>
            <li>Datos de uso: actividad en la plataforma.</li>
            <li>Datos de salud proporcionados voluntariamente por el usuario.</li>
          </ul>
          <p className="legal-note">
            Klinip solo accede a los datos ingresados por el usuario.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Base legal</h2>
          <p>
            El tratamiento se realiza conforme a la Ley 19.628 y normativa
            vigente en Chile, con consentimiento explícito del usuario.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. Conservación y eliminación</h2>
          <p>
            Los datos se almacenan mientras el usuario mantenga su cuenta activa.
            El usuario puede exportar sus datos y eliminar su información o su
            cuenta desde el perfil.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Transferencia y confidencialidad</h2>
          <p>
            No se comparten datos con terceros sin autorización del usuario.
            Proveedores tecnológicos pueden acceder a infraestructura bajo
            acuerdos de confidencialidad.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Seguridad</h2>
          <p>
            Klinip aplica medidas técnicas y organizativas contra accesos no
            autorizados, pérdida o alteración de la información.
          </p>
          <p className="legal-note">
            Klinip es una app de gestión personal de salud y no reemplaza la
            atención profesional.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Derechos del titular de datos</h2>
          <p>
            El usuario puede ejercer acceso, rectificación, cancelación y
            oposición escribiendo a soporte@klinip.cl.
          </p>
        </section>

        <div className="legal-footer">
          <Link className="secondary-btn" to="/register">
            Volver al registro
          </Link>
        </div>
      </div>
    </div>
  );
}
