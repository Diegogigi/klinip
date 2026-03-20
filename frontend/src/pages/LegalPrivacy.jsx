import React from "react";
import { Link } from "react-router-dom";

export default function LegalPrivacy() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <div className="legal-header">
          <p className="legal-kicker">Documento legal</p>
          <h1 className="legal-title">Política de Privacidad de Klinip</h1>
          <p className="legal-meta">Versión 1.1 · Marzo 2026</p>
        </div>

        <section className="legal-section">
          <h2>1. Qué datos puede tratar Klinip</h2>
          <ul className="legal-list">
            <li>Datos de cuenta, como nombre, correo electrónico y configuración de acceso.</li>
            <li>Datos de salud registrados por el usuario en perfiles, notas, medicamentos, citas y documentos.</li>
            <li>Archivos subidos por el usuario, incluyendo imágenes, PDFs y texto extraído mediante OCR.</li>
            <li>Conversaciones con Klinip IA, referencias, resúmenes y acciones solicitadas dentro del chat.</li>
            <li>Datos técnicos y de seguridad necesarios para operar la plataforma y proteger la cuenta.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>2. Finalidades del tratamiento</h2>
          <p>Klinip utiliza esta información para:</p>
          <ul className="legal-list">
            <li>Permitir la gestión de salud personal y familiar dentro de la plataforma.</li>
            <li>Organizar documentos, generar OCR, recordatorios, reportes y resúmenes clínicos orientativos.</li>
            <li>Responder consultas mediante Klinip IA usando el contexto autorizado del perfil activo.</li>
            <li>Mejorar seguridad, continuidad operativa, auditoría y prevención de accesos no autorizados.</li>
            <li>Enviar comunicaciones operativas o notificaciones, según la configuración del usuario.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>3. Base legal</h2>
          <p>
            El tratamiento de datos se funda en la ejecución del servicio solicitado por el usuario y, en
            el caso de datos sensibles de salud, en el consentimiento informado otorgado al crear o usar la
            cuenta conforme a la normativa chilena aplicable.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. IA, OCR y procesamiento automatizado</h2>
          <p>
            Para ciertas funciones, Klinip puede procesar texto, imágenes y documentos mediante OCR o
            herramientas de IA con el fin de organizar, resumir o responder consultas sobre la información
            registrada por el usuario.
          </p>
          <ul className="legal-list">
            <li>Estas funciones operan como apoyo y pueden producir resultados incompletos o inexactos.</li>
            <li>La información crítica debe verificarse con el documento original y con profesionales de salud.</li>
            <li>Klinip no utiliza estas funciones como sustituto de decisión clínica profesional.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>5. Acceso, colaboración y confidencialidad</h2>
          <p>
            Cuando el usuario comparte perfiles o habilita colaboración familiar, Klinip aplicará los roles,
            permisos y restricciones configurados dentro de la cuenta. Proveedores tecnológicos podrán tratar
            datos únicamente para prestar infraestructura, almacenamiento, procesamiento o soporte, bajo
            obligaciones de confidencialidad y seguridad.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Conservación y eliminación</h2>
          <p>
            Los datos se conservan mientras la cuenta permanezca activa o durante el tiempo necesario para
            prestar el servicio, cumplir obligaciones legales, resolver incidentes o atender solicitudes del
            usuario. Este puede solicitar eliminación, exportación o revisión de su información conforme a
            las herramientas disponibles y a la normativa aplicable.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Seguridad</h2>
          <p>
            Klinip aplica medidas razonables de seguridad técnicas y organizativas para proteger la
            confidencialidad, integridad y disponibilidad de la información. Sin perjuicio de ello, ningún
            sistema conectado a internet puede garantizar riesgo cero.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Derechos del titular y contacto</h2>
          <p>
            El usuario puede ejercer derechos de acceso, rectificación, cancelación, oposición y otras
            solicitudes relacionadas escribiendo a soporte@klinip.cl o utilizando los mecanismos habilitados
            dentro de la plataforma.
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
