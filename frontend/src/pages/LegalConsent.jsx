import React from "react";
import { Link } from "react-router-dom";

export default function LegalConsent() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <div className="legal-header">
          <p className="legal-kicker">Documento legal</p>
          <h1 className="legal-title">Consentimiento Informado</h1>
          <p className="legal-meta">Versión 1.1 · Marzo 2026</p>
        </div>

        <section className="legal-section">
          <p>Al usar Klinip, el usuario declara que comprende y acepta lo siguiente:</p>
          <ul className="legal-list">
            <li>Que la plataforma tratará datos personales sensibles relacionados con su salud y bienestar.</li>
            <li>Que autoriza el almacenamiento y organización de datos como perfiles, medicamentos, citas, documentos y notas del perfil.</li>
            <li>Que autoriza el procesamiento de archivos subidos por él, incluyendo lectura OCR cuando corresponda.</li>
            <li>Que comprende que Klinip IA puede usar el contexto disponible del perfil activo para responder preguntas, generar resúmenes o asistir en acciones dentro de la app.</li>
            <li>Que entiende que la IA y el OCR son funciones de apoyo, pueden cometer errores y no reemplazan criterio médico profesional.</li>
            <li>Que si comparte perfiles o gestiona información de terceros, declara contar con autorización suficiente para hacerlo.</li>
            <li>Que puede revocar su consentimiento o solicitar medidas sobre sus datos conforme a la normativa aplicable.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>Alcance del consentimiento</h2>
          <p>
            Este consentimiento cubre el uso de funcionalidades actuales y futuras relacionadas con gestión
            de salud, recordatorios, resúmenes, reportes, lectura documental, automatizaciones y asistencia
            contextual mediante IA dentro de Klinip, siempre dentro del marco de apoyo digital al usuario.
          </p>
        </section>

        <section className="legal-section">
          <h2>Límites importantes</h2>
          <ul className="legal-list">
            <li>Klinip no reemplaza atención médica, diagnóstico, receta ni indicación terapéutica profesional.</li>
            <li>La plataforma no debe utilizarse como único medio de respuesta ante urgencias o emergencias.</li>
            <li>La información relevante debe ser revisada por el usuario y contrastada con su documentación original.</li>
          </ul>
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
