import React from "react";
import { Link } from "react-router-dom";

export default function LegalTerms() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <div className="legal-header">
          <p className="legal-kicker">Documento legal</p>
          <h1 className="legal-title">Términos y Condiciones de Uso</h1>
          <p className="legal-meta">Versión 1.1 · Marzo 2026</p>
        </div>

        <section className="legal-section">
          <h2>1. Naturaleza del servicio</h2>
          <p>
            Klinip es una plataforma digital de gestión personal de salud. Permite organizar perfiles,
            medicamentos, citas, calendario, documentos clínicos, notas rápidas, recordatorios y reportes
            de apoyo. Algunas funciones pueden variar según el plan contratado.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Uso de IA y automatizaciones</h2>
          <p>
            Klinip puede utilizar funciones de inteligencia artificial para resumir documentos, interpretar
            texto OCR, responder preguntas sobre información registrada por el usuario y asistir en tareas
            como generación de notas, reportes o recordatorios. Estas funciones son orientativas.
          </p>
          <ul className="legal-list">
            <li>La IA no reemplaza evaluación médica, diagnóstico ni tratamiento profesional.</li>
            <li>El OCR y los resúmenes automáticos pueden contener errores y deben validarse con el original.</li>
            <li>Las respuestas de la IA dependen de la información registrada en la cuenta o perfil activo.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>3. Responsabilidad del usuario</h2>
          <ul className="legal-list">
            <li>El usuario debe ingresar información veraz, actualizada y respecto de la cual tenga autorización.</li>
            <li>Es responsable de revisar recordatorios, configuraciones y resultados generados por la plataforma.</li>
            <li>Debe resguardar sus credenciales y notificar cualquier uso no autorizado de su cuenta.</li>
            <li>No debe utilizar Klinip como sustituto de atención médica urgente o de emergencia.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>4. Perfiles, colaboración y datos de terceros</h2>
          <p>
            Si el usuario crea perfiles para familiares, dependientes u otras personas, declara que cuenta
            con base legítima para gestionar esa información y que respetará los permisos y niveles de acceso
            configurados en la plataforma. Las funciones colaborativas pueden depender del plan activo.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Usos no permitidos</h2>
          <ul className="legal-list">
            <li>Usar la plataforma para fines ilícitos, fraudulentos o que vulneren derechos de terceros.</li>
            <li>Cargar información de salud de terceros sin autorización suficiente.</li>
            <li>Intentar acceder indebidamente a cuentas, perfiles, archivos o funciones restringidas.</li>
            <li>Realizar ingeniería inversa, scraping abusivo o explotación comercial no autorizada.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>6. Disponibilidad, cambios y planes</h2>
          <p>
            Klinip puede actualizar funciones, límites de uso, planes, módulos de IA, integraciones y
            automatizaciones para mejorar el servicio, reforzar seguridad o ajustarse a requerimientos
            técnicos y regulatorios. Cuando corresponda, los cambios relevantes serán informados al usuario.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Limitación de responsabilidad</h2>
          <p>
            Klinip entrega herramientas de apoyo para organización y comprensión de información de salud,
            pero no garantiza disponibilidad ininterrumpida ni ausencia total de errores en OCR, IA,
            notificaciones o contenidos generados. El usuario debe confirmar la información crítica con los
            documentos originales y con profesionales competentes.
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
