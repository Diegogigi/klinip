import React, { useState, useMemo, useEffect } from "react";
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
  const [activeSection, setActiveSection] = useState("perfil");
  const [isMobileSettings, setIsMobileSettings] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 640 : false
  );
  const [mobileSectionOpen, setMobileSectionOpen] = useState(false);

  const detectedTimezone = useMemo(() => {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Santiago";
  }, []);
  const [timezone, setTimezone] = useState(profile.timezone || detectedTimezone || "America/Santiago");
  const [reminderPreferredTime, setReminderPreferredTime] = useState(profile.reminder_preferred_time || "08:00");
  const [timezoneStatus, setTimezoneStatus] = useState("");
  const [chronicCondition, setChronicCondition] = useState(profile.chronic_condition || "");
  const [primaryCareCenter, setPrimaryCareCenter] = useState(profile.primary_care_center || "");
  const [healthProfileStatus, setHealthProfileStatus] = useState("");
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(() => {
    if (typeof profile.email_reminders_enabled === "boolean") {
      return profile.email_reminders_enabled;
    }
    return localStorage.getItem("klinip_email_reminders_enabled") === "true";
  });
  const [emailReminderStatus, setEmailReminderStatus] = useState("");
  const profileDisplayName = profile.name || "Usuario Klinip";
  const profileDisplayEmail = profile.email || "sin-correo";
  const profileInitial = (profileDisplayName || profileDisplayEmail).trim().charAt(0).toUpperCase();

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

  useEffect(() => {
    setTimezone(profile.timezone || detectedTimezone || "America/Santiago");
    setReminderPreferredTime(profile.reminder_preferred_time || "08:00");
    setChronicCondition(profile.chronic_condition || "");
    setPrimaryCareCenter(profile.primary_care_center || "");
    if (typeof profile.email_reminders_enabled === "boolean") {
      setEmailRemindersEnabled(profile.email_reminders_enabled);
      localStorage.setItem(
        "klinip_email_reminders_enabled",
        profile.email_reminders_enabled ? "true" : "false"
      );
    }
  }, [profile.id, profile.timezone, profile.reminder_preferred_time, profile.chronic_condition, profile.primary_care_center, profile.email_reminders_enabled, detectedTimezone]);

  useEffect(() => {
    const onResize = () => {
      const isMobile = window.innerWidth <= 640;
      setIsMobileSettings(isMobile);
      if (!isMobile) {
        setMobileSectionOpen(false);
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleSectionSelect = (section) => {
    setActiveSection(section);
    if (isMobileSettings) {
      setMobileSectionOpen(true);
    }
  };

  const activeSectionLabel = {
    perfil: "Perfil",
    privacidad: "Privacidad",
    notificaciones: "Notificaciones",
    datos: "Exportar",
    legal: "Legal",
  }[activeSection] || "Perfil";

  const handleSaveTimezone = async () => {
    setTimezoneStatus("");
    try {
      const updated = await updateMe({
        timezone,
        reminder_preferred_time: reminderPreferredTime,
      });
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
      "klinip_onboarding_completed_v1",
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

  const handleSaveHealthProfile = async () => {
    setHealthProfileStatus("");
    try {
      const updated = await updateMe({
        chronic_condition: (chronicCondition || "").trim(),
        primary_care_center: (primaryCareCenter || "").trim(),
      });
      onUserUpdate?.(updated);
      setHealthProfileStatus("Perfil de salud actualizado");
    } catch (err) {
      setHealthProfileStatus("No se pudo actualizar el perfil de salud");
      console.error("Error actualizando perfil de salud:", err);
    }
  };

  const handleToggleEmailReminders = async (enabled) => {
    const previous = emailRemindersEnabled;
    setEmailReminderStatus("");
    setEmailRemindersEnabled(enabled);
    localStorage.setItem("klinip_email_reminders_enabled", enabled ? "true" : "false");
    try {
      const updated = await updateMe({
        email_reminders_enabled: enabled,
      });
      onUserUpdate?.(updated);
      setEmailReminderStatus(enabled ? "Recordatorios por correo activados" : "Recordatorios por correo desactivados");
    } catch (err) {
      setEmailRemindersEnabled(previous);
      localStorage.setItem("klinip_email_reminders_enabled", previous ? "true" : "false");
      setEmailReminderStatus("No se pudo actualizar la preferencia de correo");
      console.error("Error actualizando recordatorios por correo:", err);
    }
  };

  return (
    <>
      <div
        className={`card settings-shell ${
          isMobileSettings && mobileSectionOpen ? "is-mobile-section-open" : ""
        }`}
      >
        <aside className="settings-sidebar">
          <h2 className="card-title">Mi perfil</h2>
          <div className="settings-mobile-hero">
            <div className="settings-mobile-avatar">{profileInitial}</div>
            <h3>{profileDisplayName}</h3>
            <p>{profileDisplayEmail}</p>
            <button
              className="primary-btn"
              type="button"
              onClick={() => handleSectionSelect("perfil")}
            >
              Editar perfil
            </button>
          </div>
          <div className="settings-nav">
            <button
              className={`settings-nav-btn ${activeSection === "perfil" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleSectionSelect("perfil")}
            >
              Perfil
            </button>
            <button
              className={`settings-nav-btn ${activeSection === "privacidad" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleSectionSelect("privacidad")}
            >
              Privacidad
            </button>
            <button
              className={`settings-nav-btn ${activeSection === "notificaciones" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleSectionSelect("notificaciones")}
            >
              Notificaciones
            </button>
            <button
              className={`settings-nav-btn ${activeSection === "datos" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleSectionSelect("datos")}
            >
              Exportar
            </button>
            <button
              className={`settings-nav-btn ${activeSection === "legal" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleSectionSelect("legal")}
            >
              Legal
            </button>
          </div>
          <div className="settings-theme-box">
            <p className="settings-theme-label">Apariencia</p>
            <button
              className="theme-toggle"
              type="button"
              onClick={onToggleTheme}
              role="switch"
              aria-checked={theme === "dark"}
            >
              <span className="theme-toggle-label">
                {theme === "dark" ? "Modo oscuro" : "Modo claro"}
              </span>
              <span className={`theme-switch ${theme === "dark" ? "is-dark" : ""}`}>
                <span className="theme-switch-thumb" />
              </span>
            </button>
          </div>
          <button
            className="settings-logout-btn"
            type="button"
            onClick={() => {
              if (window.confirm("¿Estás seguro de que deseas cerrar sesión?")) {
                onLogout?.();
              }
            }}
          >
            Cerrar sesión
          </button>
        </aside>

        <div className="settings-main">
      {isMobileSettings && mobileSectionOpen && (
        <div className="settings-mobile-backbar">
          <button
            className="secondary-btn"
            type="button"
            onClick={() => setMobileSectionOpen(false)}
          >
            Volver
          </button>
          <span>{activeSectionLabel}</span>
        </div>
      )}

      {activeSection === "perfil" && (
      <div className="settings-section">
        <h2 className="card-title profile-section-title">Perfil</h2>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Informacion basica de tu cuenta. Proximamente podras activar recordatorios por correo. Ya existen plantillas base de correo configuradas para su lanzamiento.
        </p>
        <div className="settings-email-reminder-row">
          <div className="settings-email-reminder-copy">
            <p className="settings-email-reminder-title">Recordatorios por correo</p>
            <p className="settings-email-reminder-sub">
              Activa o desactiva la recepcion de recordatorios por email.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={emailRemindersEnabled}
              onChange={(e) => handleToggleEmailReminders(e.target.checked)}
            />
            <span className="switch-slider" />
          </label>
        </div>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Estado actual: {emailRemindersEnabled ? "Activados" : "Desactivados"}
        </p>
        {emailReminderStatus && <p className="muted">{emailReminderStatus}</p>}

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
              Guardar configuración de recordatorios
            </button>
          </div>
        </div>
        <div className="form-row" style={{ marginTop: "0.5rem" }}>
          <div className="input-group">
            <label className="input-label">Hora preferida de recordatorios</label>
            <input
              className="input-field"
              type="time"
              value={reminderPreferredTime}
              onChange={(e) => setReminderPreferredTime(e.target.value || "08:00")}
            />
          </div>
        </div>
        {timezoneStatus && <p className="muted">{timezoneStatus}</p>}

        <div className="form-row" style={{ marginTop: "0.75rem" }}>
          <div className="input-group">
            <label className="input-label">Patología crónica (opcional)</label>
            <input
              className="input-field"
              value={chronicCondition}
              onChange={(e) => setChronicCondition(e.target.value)}
              placeholder="Ej: Hipertensión, diabetes, asma"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Centro habitual (opcional)</label>
            <input
              className="input-field"
              value={primaryCareCenter}
              onChange={(e) => setPrimaryCareCenter(e.target.value)}
              placeholder="Ej: CESFAM Norte, Clínica ..."
            />
          </div>
        </div>
        <div className="form-row">
          <div className="input-group" style={{ alignSelf: "flex-end" }}>
            <button className="secondary-btn" type="button" onClick={handleSaveHealthProfile}>
              Guardar perfil de salud
            </button>
          </div>
        </div>
        {healthProfileStatus && <p className="muted">{healthProfileStatus}</p>}

      </div>
      )}

      {activeSection === "datos" && (
      <div className="settings-section">
        <h2 className="card-title">Exportar y compartir</h2>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Descarga tus datos en CSV/PDF o genera un enlace temporal para compartir.
        </p>
        <div className="export-layout">
          <div className="export-card">
            <h4>Descargar archivos</h4>
            <p className="muted">
              Exporta tus citas y documentos para respaldo o revisión externa.
            </p>
            <div className="export-actions">
              <button className="secondary-btn" type="button" onClick={exportCsv}>
                Descargar CSV de citas
              </button>
              <button className="secondary-btn" type="button" onClick={exportPdf}>
                Descargar PDF resumen
              </button>
            </div>
          </div>

          <div className="export-card">
            <h4>Compartir por enlace</h4>
            <p className="muted">
              Crea un enlace temporal con tus datos actuales y cópialo al portapapeles.
            </p>
            <div className="export-actions">
              <button className="secondary-btn" type="button" onClick={shareLink} disabled={exporting}>
                {exporting ? "Generando enlace..." : "Generar y copiar enlace"}
              </button>
            </div>
            <p className="muted export-note">
              El enlace se genera con la información disponible al momento de crearlo.
            </p>
          </div>
        </div>
        <div className="export-footer">
          <div className="export-footer-tip">
            Recomendación: usa PDF para lectura y CSV para análisis o importación.
          </div>
          <div>
            <button className="primary-btn" type="button" onClick={shareLink} disabled={exporting}>
              {exporting ? "Generando..." : "Compartir link rápido"}
            </button>
          </div>
        </div>
      </div>
      )}

      {activeSection === "notificaciones" && (
      <div className="settings-section">
        <h3 className="card-title">🔔 Notificaciones y Recordatorios</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Configura tus preferencias de notificaciones, recordatorios de citas y medicamentos. 
          Personaliza cuándo quieres recibir alertas.
        </p>
        <NotificationSettings embedded />
      </div>
      )}

      {activeSection === "legal" && (
      <div className="settings-section">
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
      )}

      {activeSection === "privacidad" && (
      <div className="settings-section">
        <h3 className="card-title">Privacidad y seguridad</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Administra tus datos, consentimiento y solicitudes de privacidad.
        </p>
        <div className="privacy-layout">
          <div className="privacy-card">
            <div className="privacy-card-header">
              <h4>Consentimiento y cuenta</h4>
              <span className={`privacy-status-pill ${consentRevoked ? "is-off" : "is-on"}`}>
                {consentRevoked ? "Revocado" : "Activo"}
              </span>
            </div>
            <p className="muted">
              Gestiona el permiso para datos de salud y las acciones críticas de tu cuenta.
            </p>
            <div className="privacy-actions">
              {consentRevoked ? (
                <button className="secondary-btn" type="button" onClick={handleRestoreConsent}>
                  Restaurar consentimiento
                </button>
              ) : (
                <button className="secondary-btn" type="button" onClick={handleRevokeConsent}>
                  Revocar consentimiento
                </button>
              )}
              <button className="secondary-btn danger" type="button" onClick={() => setShowDeleteConfirm(true)}>
                Eliminar mi cuenta
              </button>
            </div>
          </div>

          <div className="privacy-card">
            <h4>Exportar y limpieza</h4>
            <p className="muted">
              Descarga tus datos o limpia información local del navegador.
            </p>
            <div className="privacy-actions">
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

          <div className="privacy-card privacy-support-card">
            <h4>Soporte de privacidad</h4>
            <p className="muted">
              Si necesitas acceso, rectificación o eliminación de datos, envía tu solicitud aquí.
            </p>
            <div className="privacy-form-grid">
              <div className="input-group">
                <label className="input-label">Motivo</label>
                <select
                  className="select-field"
                  value={privacyReason}
                  onChange={(e) => setPrivacyReason(e.target.value)}
                >
                  <option value="acceso">Acceso a mis datos</option>
                  <option value="rectificacion">Rectificación</option>
                  <option value="eliminacion">Eliminación</option>
                  <option value="otra">Otra consulta</option>
                </select>
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
            </div>
            <label className="auth-consent-label" style={{ marginBottom: "0.75rem" }}>
              <input
                type="checkbox"
                checked={privacyIncludeTech}
                onChange={(e) => setPrivacyIncludeTech(e.target.checked)}
              />
              <span>Adjuntar información técnica básica</span>
            </label>
            <div className="privacy-form-actions">
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
        </div>
        {privacyNotice && (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            {privacyNotice}
          </p>
        )}
      </div>
      )}
        </div>
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
    </>
  );
}









