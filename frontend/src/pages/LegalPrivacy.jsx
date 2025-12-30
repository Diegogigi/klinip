import React from "react";
import { Link } from "react-router-dom";

export default function LegalPrivacy() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <div className="legal-header">
          <p className="legal-kicker">Documento legal</p>
          <h1 className="legal-title">Politica de Privacidad de Klinip</h1>
          <p className="legal-meta">Version 1.0 - Enero 2026</p>
        </div>

        <section className="legal-section">
          <h2>1. Finalidad del tratamiento</h2>
          <p>
            Klinip recopila y procesa datos personales con el proposito de
            gestionar informacion de salud personal, organizar citas, medicamentos
            y documentos clinicos, generar recordatorios y notificaciones, y
            mejorar la experiencia del usuario mediante analitica interna.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Datos que se recopilan</h2>
          <ul className="legal-list">
            <li>Datos de identificacion: nombre, correo electronico.</li>
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
            vigente en Chile, con consentimiento explicito del usuario.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. Conservacion y eliminacion</h2>
          <p>
            Los datos se almacenan mientras el usuario mantenga su cuenta activa.
            El usuario puede exportar sus datos y eliminar su informacion o su
            cuenta desde el perfil.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Transferencia y confidencialidad</h2>
          <p>
            No se comparten datos con terceros sin autorizacion del usuario.
            Proveedores tecnologicos pueden acceder a infraestructura bajo
            acuerdos de confidencialidad.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Seguridad</h2>
          <p>
            Klinip aplica medidas tecnicas y organizativas contra accesos no
            autorizados, perdida o alteracion de la informacion.
          </p>
          <p className="legal-note">
            Klinip es una app de gestion personal de salud y no reemplaza la
            atencion profesional.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Derechos del titular de datos</h2>
          <p>
            El usuario puede ejercer acceso, rectificacion, cancelacion y
            oposicion escribiendo a soporte@klinip.cl.
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
