import React, { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import NotificationSettings from "../components/NotificationSettings";
import {
  updateMe,
  getAppointments,
  getDocuments,
  revokeDataConsent,
  deleteAccount as deleteAccountApi,
  submitPrivacyRequest,
} from "../api";
import { toIsoOrNull, toLocaleDateOrEmpty, toLocaleDateTimeOrEmpty } from "../utils/dates";

export default function Settings({ user, onLogout, theme, onToggleTheme, onUserUpdate }) {
  const profile = user || {};
  const plan = "Backend activo";
  const navigate = useNavigate();
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [consentRevoked, setConsentRevoked] = useState(() => {
    return localStorage.getItem("klinip_consent_revoked") === "true";
  });
  const [privacyReason, setPrivacyReason] = useState("acceso");
  const [privacyMessage, setPrivacyMessage] = useState("");
  const [privacyIncludeTech, setPrivacyIncludeTech] = useState(true);
  const [privacySending, setPrivacySending] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState("");
  const [privacySuccessMessage, setPrivacySuccessMessage] = useState("");
  const [showPrivacySuccessModal, setShowPrivacySuccessModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const detectedTimezone = useMemo(() => {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Santiago";
  }, []);
  const [timezone, setTimezone] = useState(profile.timezone || detectedTimezone || "America/Santiago");
  const [timezoneStatus, setTimezoneStatus] = useState("");

  const timezoneOptions = [
    "America/Santiago",
    "America/Lima",
    "America/Bogota",
    "America/Mexico_City",
    "America/Argentina/Buenos_Aires",
    "America/Sao_Paulo",
    "America/New_York",
    "Europe/Madrid",
    "Europe/London",
    "UTC",
  ];

  const handleSaveTimezone = async () => {
    setTimezoneStatus("");
    try {
      const updated = await updateMe({ timezone });
      onUserUpdate?.(updated);
      setTimezoneStatus("Zona horaria actualizada");
    } catch (err) {
      setTimezoneStatus("No se pudo actualizar la zona horaria");
      console.error("Error actualizando zona horaria:", err);
    }
  };

  const loadExportData = async () => {
    const [appointments, documents] = await Promise.all([getAppointments(), getDocuments()]);
    return {
      appointments: appointments || [],
      documents: documents || [],
    };
  };

  const exportCsv = async () => {
    const { appointments } = await loadExportData();
    if (!appointments.length) {
      window.alert("No hay citas para exportar.");
      return;
    }
    const header = ["id", "tipo", "especialidad", "centro", "fecha", "estado", "notas"];
    const rows = appointments.map((a) => [
      a.id,
      a.type,
      a.specialty || "",
      a.center || "",
      a.date_time ? toIsoOrNull(a.date_time) || "" : "",
      a.status,
      (a.notes || "").replace(/\"/g, '\"\"'),
    ]);
    const csv = [header.join(","), ...rows.map((r) => r.map((x) => `"${x}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "citas.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    const { appointments, documents } = await loadExportData();
    const html = `
      <html>
        <head>
          <title>Klinip - Resumen</title>
          <style>
            body { font-family: Poppins, Arial, sans-serif; padding: 16px; }
            h1 { font-size: 20px; margin: 0 0 12px; }
            h2 { font-size: 16px; margin: 12px 0 6px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #e5e7eb; padding: 6px; text-align: left; }
            th { background: #f8fafc; }
          </style>
        </head>
        <body>
          <h1>Klinip - Resumen</h1>
          <h2>Citas</h2>
          <table>
            <thead><tr><th>Tipo</th><th>Especialidad</th><th>Centro</th><th>Fecha</th><th>Estado</th></tr></thead>
            <tbody>
              ${appointments
                .map(
                  (a) =>
                    `<tr><td>${a.type}</td><td>${a.specialty || ""}</td><td>${a.center || ""}</td><td>${
                      a.date_time ? toLocaleDateTimeOrEmpty(a.date_time) : ""
                    }</td><td>${a.status}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
          <h2>Documentos</h2>
          <table>
            <thead><tr><th>Tipo</th><th>Centro</th><th>Fecha</th></tr></thead>
            <tbody>
              ${documents
                .map(
                  (d) =>
                    `<tr><td>${d.doc_type}</td><td>${d.center || ""}</td><td>${
                      d.date ? toLocaleDateOrEmpty(d.date) : ""
                    }</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
        </body>
      </html>
    `;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const shareLink = async () => {
    try {
      setExporting(true);
      const { appointments, documents } = await loadExportData();
      const payload = {
        appointments,
        documents,
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const link = `${window.location.origin}/#share=${encoded}`;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        window.alert("Link de comparticiИn copiado al portapapeles.");
      } else {
        prompt("Copia este link", link);
      }
    } catch (err) {
      console.error("No se pudo generar link", err);
      window.alert("No se pudo generar el link.");
    } finally {
      setExporting(false);
    }
  };


  const handleClearLocal = () => {
    if (!window.confirm("¿Borrar los datos locales de Klinip en este navegador?")) return;
    const keys = [
      "klinip_users",
      "klinip_session",
      "klinip_appointments",
      "klinip_documents",
      "klinip_medications",
      "klinip_onboarding_seen",
    ];
    keys.forEach((k) => localStorage.removeItem(k));
    alert("Datos locales borrados. Vuelve a iniciar sesión para continuar.");
    window.location.reload();
  };

  const handleRevokeConsent = () => {
    setPrivacyNotice("");
    if (!window.confirm("¿Deseas revocar tu consentimiento de datos de salud?")) return;
    revokeDataConsent()
      .then(() => {
        localStorage.setItem("klinip_consent_revoked", "true");
        setConsentRevoked(true);
        setPrivacyNotice(
          "Has revocado tu consentimiento. Algunas funcionalidades avanzadas se han limitado."
        );
      })
      .catch((err) => {
        console.error(err);
        setPrivacyNotice("No se pudo revocar el consentimiento.");
      });
  };

  const handleRestoreConsent = () => {
    localStorage.removeItem("klinip_consent_revoked");
    setConsentRevoked(false);
    setPrivacyNotice("Consentimiento restaurado.");
  };

  const handleDeleteAccount = async () => {
    setPrivacyNotice("");
    try {
      await deleteAccountApi();
      localStorage.removeItem("token");
      onLogout?.();
      navigate("/register");
    } catch (err) {
      console.error(err);
      setPrivacyNotice("No se pudo eliminar la cuenta.");
    }
  };

  const handleSendPrivacyRequest = async () => {
    const cleanMessage = privacyMessage.trim();
    if (!cleanMessage) {
      setPrivacyNotice("Debes escribir un mensaje.");
      return;
    }
    setPrivacySending(true);
    setPrivacyNotice("");
    try {
      const response = await submitPrivacyRequest({
        reason: privacyReason,
        message: cleanMessage,
        include_tech: privacyIncludeTech,
      });
      setPrivacyMessage("");
      const requestId = response?.request_id;
      setPrivacyNotice("");
      setPrivacySuccessMessage(
        requestId
          ? `Solicitud enviada (#${requestId}). Te responderemos pronto.`
          : "Solicitud enviada. Te responderemos pronto."
      );
      setShowPrivacySuccessModal(true);
    } catch (err) {
      console.error(err);
      const detail = err?.response?.data?.detail;
      setPrivacyNotice(detail || "No se pudo enviar la solicitud.");
    } finally {
      setPrivacySending(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2 className="card-title">Perfil</h2>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Información básica de tu cuenta. Próximamente podrás activar recordatorios por correo y agregar
          perfiles de familia.
        </p>

        <div className="profile-grid">
          <div className="profile-tile">
            <p className="profile-label">Nombre</p>
            <p className="profile-value">{profile.name || "—"}</p>
          </div>
          <div className="profile-tile">
            <p className="profile-label">Correo</p>
            <p className="profile-value">{profile.email || "—"}</p>
          </div>
          <div className="profile-tile">
            <p className="profile-label">Plan</p>
            <p className="profile-value">{plan}</p>
          </div>
          <div className="profile-tile">
            <p className="profile-label">Zona horaria</p>
            <p className="profile-value">{profile.timezone || detectedTimezone}</p>
          </div>
        </div>

        <div className="form-row">
          <div className="input-group">
            <label className="input-label">Actualizar zona horaria</label>
            <input
              className="input-field"
              list="timezone-options"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/Santiago"
            />
            <datalist id="timezone-options">
              {timezoneOptions.map((tz) => (
                <option value={tz} key={tz} />
              ))}
            </datalist>
          </div>
          <div className="input-group" style={{ alignSelf: "flex-end" }}>
            <button className="secondary-btn" type="button" onClick={handleSaveTimezone}>
              Guardar zona horaria
            </button>
          </div>
        </div>
        {timezoneStatus && <p className="muted">{timezoneStatus}</p>}

      </div>

      <div className="card">
        <div className="card-header" style={{ alignItems: "center" }}>
          <div>
            <h2 className="card-title">Exportar y compartir</h2>
            <p className="muted">Lleva tus citas y documentos a PDF/CSV o comparte un link temporal.</p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="secondary-btn" type="button" onClick={exportCsv}>
              CSV citas
            </button>
            <button className="secondary-btn" type="button" onClick={exportPdf}>
              PDF resumen
            </button>
            <button className="primary-btn" type="button" onClick={shareLink} disabled={exporting}>
              {exporting ? "Generando..." : "Compartir link"}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Apariencia</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Personaliza el modo de color de Klinip.
        </p>
        <button
          className="theme-toggle"
          type="button"
          onClick={onToggleTheme}
          role="switch"
          aria-checked={theme === "dark"}
          style={{ maxWidth: "260px" }}
        >
          <span className="theme-toggle-label">
            {theme === "dark" ? "Modo oscuro" : "Modo claro"}
          </span>
          <span className={`theme-switch ${theme === "dark" ? "is-dark" : ""}`}>
            <span className="theme-switch-thumb" />
          </span>
        </button>
      </div>

      <div className="card">
        <h3 className="card-title">🔔 Notificaciones y Recordatorios</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Configura tus preferencias de notificaciones, recordatorios de citas y medicamentos. 
          Personaliza cuándo quieres recibir alertas.
        </p>
        <button
          className="primary-btn"
          type="button"
          onClick={() => setShowNotificationSettings(true)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: "20px", height: "20px" }}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          Configurar Notificaciones
        </button>
      </div>

      <div className="card">
        <h3 className="card-title">Legal</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Revisa los documentos legales y administra tu consentimiento.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <Link className="secondary-btn" to="/legal/privacy">
            Politica de privacidad
          </Link>
          <Link className="secondary-btn" to="/legal/terms">
            Terminos de uso
          </Link>
          <Link className="secondary-btn" to="/legal/consent">
            Consentimiento de datos
          </Link>
        </div>
        <div>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            Estado de consentimiento: {consentRevoked ? "Revocado" : "Activo"}
          </p>
          {consentRevoked ? (
            <button className="secondary-btn" type="button" onClick={handleRestoreConsent}>
              Restaurar consentimiento
            </button>
          ) : (
            <button className="secondary-btn" type="button" onClick={handleRevokeConsent}>
              Revocar consentimiento
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Privacidad y seguridad</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Administra tus datos, consentimiento y solicitudes de privacidad.
        </p>
        <div className="privacy-grid">
          <div className="privacy-tile">
            <h4>Exportar datos</h4>
            <p className="muted">
              Descarga un resumen de tus citas y documentos cuando lo necesites.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="secondary-btn" type="button" onClick={exportCsv}>
                CSV citas
              </button>
              <button className="secondary-btn" type="button" onClick={exportPdf}>
                PDF resumen
              </button>
              <button className="secondary-btn" type="button" onClick={handleClearLocal}>
                Borrar datos locales
              </button>
            </div>
          </div>

          <div className="privacy-tile">
            <h4>Control de cuenta y consentimiento</h4>
            <p className="muted">
              Revoca el consentimiento de datos de salud o elimina tu cuenta de forma definitiva.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="secondary-btn" type="button" onClick={handleRevokeConsent}>
                Revocar consentimiento
              </button>
              <button className="secondary-btn" type="button" onClick={() => setShowDeleteConfirm(true)}>
                Eliminar mi cuenta
              </button>
            </div>
          </div>

          <div className="privacy-tile">
            <h4>Soporte de privacidad</h4>
            <p className="muted">
              Si necesitas acceso, rectificacion o eliminacion, dejanos tu solicitud.
            </p>
            <div className="form-row">
              <div className="input-group">
                <label className="input-label">Motivo</label>
                <select
                  className="select-field"
                  value={privacyReason}
                  onChange={(e) => setPrivacyReason(e.target.value)}
                >
                  <option value="acceso">Acceso a mis datos</option>
                  <option value="rectificacion">Rectificacion</option>
                  <option value="eliminacion">Eliminacion</option>
                  <option value="otra">Otra consulta</option>
                </select>
              </div>
            </div>
            <div className="input-group">
              <label className="input-label">Mensaje</label>
              <textarea
                className="textarea-field"
                value={privacyMessage}
                onChange={(e) => setPrivacyMessage(e.target.value)}
                placeholder="Escribe tu solicitud..."
              />
            </div>
            <label className="auth-consent-label" style={{ marginBottom: "0.75rem" }}>
              <input
                type="checkbox"
                checked={privacyIncludeTech}
                onChange={(e) => setPrivacyIncludeTech(e.target.checked)}
              />
              <span>Adjuntar informacion tecnica basica</span>
            </label>
            <button
              className="primary-btn"
              type="button"
              onClick={handleSendPrivacyRequest}
              disabled={privacySending || !privacyMessage.trim()}
            >
              {privacySending ? "Enviando..." : "Enviar solicitud"}
            </button>
          </div>
        </div>
        {privacyNotice && (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            {privacyNotice}
          </p>
        )}
      </div>

      <div className="card">
        <h3 className="card-title">Sesión</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Cierra tu sesión para salir de forma segura de tu cuenta.
        </p>
        <button 
          className="primary-btn" 
          type="button" 
          onClick={() => {
            if (window.confirm("¿Estás seguro de que deseas cerrar sesión?")) {
              onLogout?.();
            }
          }}
          style={{ width: "100%" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: "20px", height: "20px" }}>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Cerrar sesión
        </button>
      </div>

      {showDeleteConfirm && (
        <div className="modal-backdrop">
          <div className="modal-card" role="dialog" aria-modal="true">
            <h3>Eliminar mi cuenta y todos mis datos</h3>
            <p className="muted">
              Esta accion es permanente. Se eliminaran tus datos de citas,
              medicamentos y documentos. No podras deshacer este cambio.
            </p>
            <p className="muted">
              ?Estas seguro de que deseas eliminar tu cuenta y todos tus datos de Klinip?
              Esta accion es irreversible.
            </p>
            <div className="modal-actions">
              <button className="secondary-btn" type="button" onClick={() => setShowDeleteConfirm(false)}>
                Cancelar
              </button>
              <button className="primary-btn" type="button" onClick={handleDeleteAccount}>
                Si, eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrivacySuccessModal && (
        <div className="modal-backdrop" onClick={() => setShowPrivacySuccessModal(false)}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Solicitud enviada</h3>
            <p className="muted">{privacySuccessMessage}</p>
            <div className="modal-actions">
              <button className="primary-btn" type="button" onClick={() => setShowPrivacySuccessModal(false)}>
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {showNotificationSettings && (
        <NotificationSettings onClose={() => setShowNotificationSettings(false)} />
      )}
    </>
  );
}
