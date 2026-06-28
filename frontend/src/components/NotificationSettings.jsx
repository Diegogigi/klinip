import { useEffect, useState } from "react";
import {
  getNotificationStats,
  clearScheduledNotifications,
} from "../services/notificationManager";
import {
  ensurePushSubscription,
  removePushSubscription,
  getPushSupportStatus,
  getCurrentPushSubscription,
} from "../services/pwa";
import {
  getPushStatus,
  sendTestPush,
} from "../services/httpApi";
import { getMe, updateMe } from "../api";
import SuccessSheet from "./SuccessSheet";
import "./NotificationSettings.css";

export default function NotificationSettings({ onClose, embedded = false }) {
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [pushSupport, setPushSupport] = useState(() => getPushSupportStatus());
  const pushSupported = pushSupport.supported;
  const [pushActionLoading, setPushActionLoading] = useState(false);
  const [pushSubscriptionCount, setPushSubscriptionCount] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(() => {
    const saved = localStorage.getItem("klinip_push_enabled");
    return saved === "true";
  });
  const [stats, setStats] = useState({
    scheduled: 0,
    appointments: 0,
    medications: 0,
    total: 0,
  });
  const [settings, setSettings] = useState({
    appointmentReminders: true,
    medicationReminders: true,
    soundEnabled: true,
    vibrationEnabled: true,
    customOffsets: {
      days7: true,
      days3: true,
      days1: true,
      hours2: true,
      minutes30: true,
      minutes5: true,
      },
  });
  const [successSheet, setSuccessSheet] = useState(null);

  const openSuccessSheet = (payload) => {
    setSuccessSheet({
      secondaryLabel: "Entendido",
      ...payload,
    });
  };

  useEffect(() => {
    loadNotificationStatus();
    loadSettings();
    updateStats();
    loadPushStatus();
  }, []);

  const loadNotificationStatus = () => {
    if ("Notification" in window) {
      setNotificationsEnabled(Notification.permission === "granted");
    }
  };

  const loadPushStatus = async () => {
    try {
      const support = getPushSupportStatus();
      setPushSupport(support);

      if (!support.supported) {
        localStorage.setItem("klinip_push_enabled", "false");
        setPushEnabled(false);
        setPushSubscriptionCount(0);
        return;
      }

      const clientState = await getCurrentPushSubscription();
      const backendStatus = await getPushStatus();
      const enabled = clientState.browserHasSubscription && backendStatus.enabled;

      localStorage.setItem("klinip_push_enabled", enabled.toString());
      setPushEnabled(enabled);
      setPushSubscriptionCount(Number(backendStatus?.count || 0));

      if (clientState.browserHasSubscription !== backendStatus.enabled) {
        console.warn("Estado push desincronizado entre navegador y backend.");
      }
    } catch (error) {
      console.error("Error cargando el estado de push:", error);
      localStorage.setItem("klinip_push_enabled", "false");
      setPushEnabled(false);
      setPushSubscriptionCount(0);
    }
  };

  const loadSettings = async () => {
    try {
      const me = await getMe();
      const raw = me?.notification_settings_json;
      if (raw) {
        const parsed = JSON.parse(raw);
        setSettings(parsed);
        localStorage.setItem("klinip_notification_settings", JSON.stringify(parsed));
        return;
      }
    } catch (error) {
      console.warn(
        "No se pudo cargar la configuraci\u00f3n desde backend. Se usar\u00e1 el estado local.",
        error
      );
    }

    const saved = localStorage.getItem("klinip_notification_settings");
    if (!saved) return;

    try {
      setSettings(JSON.parse(saved));
    } catch (error) {
      console.error("Error cargando la configuraci\u00f3n local:", error);
    }
  };

  const saveSettings = (nextSettings) => {
    localStorage.setItem("klinip_notification_settings", JSON.stringify(nextSettings));
    setSettings(nextSettings);
    updateMe({
      notification_settings_json: JSON.stringify(nextSettings),
    }).catch((error) => {
      console.error("No se pudo guardar la configuraci\u00f3n de notificaciones.", error);
    });
  };

  const updateStats = () => {
    setStats(getNotificationStats());
  };

  const handleEnableNotifications = async () => {
    if (!("Notification" in window)) {
      window.alert("Este navegador no soporta notificaciones.");
      return;
    }
    const granted =
      Notification.permission === "granted"
        ? true
        : (await Notification.requestPermission()) === "granted";
    setNotificationsEnabled(granted);
    if (!granted) {
      window.alert("Debes permitir las notificaciones del navegador.");
      return;
    }
    await loadPushStatus();
  };

  const handleEnablePush = async () => {
    if (pushActionLoading) return;
    setPushActionLoading(true);
    try {
      const support = getPushSupportStatus();
      setPushSupport(support);

      if (!support.supported) {
        window.alert(support.reason || "Tu dispositivo no soporta notificaciones push.");
        return;
      }

      const success = await ensurePushSubscription();
      if (!success) return;

      await new Promise((resolve) => {
        window.setTimeout(resolve, 500);
      });

      await loadPushStatus();

      openSuccessSheet({
        kicker: "Push activado",
        title: "Notificaciones listas",
        copy: "Klinip ya puede enviarte recordatorios automáticos incluso cuando la app esté cerrada.",
        rows: [
          { icon: "doc", label: "Canal", value: "Notificaciones push del dispositivo" },
          { icon: "profile", label: "Estado", value: "Suscripción activa" },
        ],
      });
    } catch (error) {
      console.error("Error habilitando push:", error);

      const statusCode = error?.response?.status;
      const backendDetail = error?.response?.data?.detail;
      let details =
        backendDetail ||
        error?.message ||
        "Verifica HTTPS, permisos del navegador y que la clave VAPID est\u00e9 configurada.";

      if (statusCode === 503 || statusCode === 520) {
        details =
          "El servidor no pudo registrar la suscripci\u00f3n push. Intenta nuevamente en unos segundos.";
      }

      window.alert(`Error al habilitar notificaciones push.\n\n${details}`);
      localStorage.setItem("klinip_push_enabled", "false");
      setPushEnabled(false);
    } finally {
      setPushActionLoading(false);
    }
  };

  const handleDisablePush = async () => {
    if (pushActionLoading) return;
    setPushActionLoading(true);
    try {
      await removePushSubscription();
      localStorage.setItem("klinip_push_enabled", "false");
      setPushEnabled(false);
      await loadPushStatus();
      openSuccessSheet({
        kicker: "Push desactivado",
        title: "Cambio aplicado",
        copy: "Klinip dejó de enviar notificaciones push a este dispositivo.",
        rows: [
          { icon: "doc", label: "Canal", value: "Notificaciones push del dispositivo" },
          { icon: "profile", label: "Estado", value: "Suscripción desactivada" },
        ],
      });
    } catch (error) {
      console.error("Error deshabilitando push:", error);
    } finally {
      setPushActionLoading(false);
    }
  };

  const handleClearAll = () => {
    if (!window.confirm("\u00bfDeseas borrar los recordatorios locales heredados?")) return;

    clearScheduledNotifications();
    updateStats();
    openSuccessSheet({
      kicker: "Limpieza completada",
      title: "Recordatorios locales eliminados",
      copy: "Los recordatorios heredados del navegador se borraron. Klinip seguirá usando push para avisarte.",
      rows: [
        { icon: "doc", label: "Acción", value: "Recordatorios locales antiguos" },
        { icon: "profile", label: "Resultado", value: "Quedaron eliminados" },
      ],
    });
  };

  const handleTestPush = async () => {
    if (!pushSupported) {
      window.alert(pushSupport.reason || "Tu navegador no soporta notificaciones push.");
      return;
    }

    if (!pushEnabled) {
      await loadPushStatus();
      const stillDisabled = localStorage.getItem("klinip_push_enabled") !== "true";
      if (stillDisabled) {
        window.alert("Primero debes habilitar las notificaciones push.");
        return;
      }
    }

    try {
      const result = await sendTestPush();
      if (result.sent || result.ok) {
        openSuccessSheet({
          kicker: "Prueba enviada",
          title: "Notificación en camino",
          copy: "Deberías recibir la notificación de prueba en unos segundos en este dispositivo.",
          rows: [
            { icon: "doc", label: "Tipo", value: "Notificación push de prueba" },
            { icon: "clock", label: "Entrega esperada", value: "En unos segundos" },
          ],
        });
      } else {
        window.alert("No se pudo enviar la notificaci\u00f3n de prueba.");
      }
    } catch (error) {
      console.error("Error enviando notificaci\u00f3n de prueba:", error);
      const details = error?.response?.data?.detail || error?.message || "Error desconocido.";
      window.alert(`Error al enviar la notificaci\u00f3n de prueba.\n${details}`);
    }
  };

  const handleSettingChange = (key, value) => {
    const nextSettings = { ...settings, [key]: value };
    saveSettings(nextSettings);
  };

  const handleOffsetChange = (offset, value) => {
    const nextSettings = {
      ...settings,
      customOffsets: {
        ...settings.customOffsets,
        [offset]: value,
      },
    };
    saveSettings(nextSettings);
  };

  const panelContent = (
    <div className="notification-settings-panel" onClick={(event) => !embedded && event.stopPropagation()}>
      <SuccessSheet
        open={Boolean(successSheet)}
        onClose={() => setSuccessSheet(null)}
        {...(successSheet || {})}
      />
      {!embedded && (
        <div className="settings-header">
          <h2>Configuraci&oacute;n de notificaciones</h2>
          <button className="close-btn" onClick={onClose} aria-label="Cerrar">
            &times;
          </button>
        </div>
      )}

      <div className="settings-content">
        <section className="settings-section">
          <h3>Estado actual</h3>
          <div className="status-grid">
            <div className="status-item">
              <span className="status-label">Notificaciones del navegador</span>
              <span className={`status-value ${notificationsEnabled ? "enabled" : "disabled"}`}>
                {notificationsEnabled ? "Habilitadas" : "Deshabilitadas"}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Notificaciones push</span>
              <span className={`status-value ${pushEnabled ? "enabled" : "disabled"}`}>
                {pushEnabled ? "Activas" : "Inactivas"}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Suscripciones push registradas</span>
              <span className="status-value">{pushSubscriptionCount}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Recordatorios locales heredados</span>
              <span className="status-value">{stats.total}</span>
            </div>
          </div>
        </section>

        {!notificationsEnabled && (
          <section className="settings-section">
            <button className="primary-btn" onClick={handleEnableNotifications}>
              Habilitar notificaciones del navegador
            </button>
            <p className="help-text">
              Debes habilitar las notificaciones del navegador para registrar y recibir recordatorios push.
            </p>
          </section>
        )}

        <section className="settings-section">
          <h3>Notificaciones push</h3>
          <p className="help-text">
            Las notificaciones push funcionan incluso cuando la aplicaci&oacute;n est&aacute; cerrada.
          </p>
          {!pushSupported && (
            <p className="help-text">
              {pushSupport.reason || "Tu navegador no soporta notificaciones push."}
            </p>
          )}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {!pushEnabled ? (
              <button className="primary-btn" onClick={handleEnablePush} disabled={!pushSupported || pushActionLoading}>
                {pushActionLoading ? "Activando..." : "Habilitar notificaciones push"}
              </button>
            ) : (
              <button className="danger-btn" onClick={handleDisablePush} disabled={pushActionLoading}>
                {pushActionLoading ? "Desactivando..." : "Deshabilitar notificaciones push"}
              </button>
            )}
            <button className="secondary-btn" onClick={handleTestPush} disabled={!pushEnabled || pushActionLoading}>
              Enviar notificaci&oacute;n de prueba
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>Preferencias</h3>

          <div className="setting-item">
            <label>
              <input
                type="checkbox"
                checked={settings.appointmentReminders}
                onChange={(event) =>
                  handleSettingChange("appointmentReminders", event.target.checked)
                }
              />
              <span>Recordatorios de citas y ex&aacute;menes</span>
            </label>
          </div>

          <div className="setting-item">
            <label>
              <input
                type="checkbox"
                checked={settings.medicationReminders}
                onChange={(event) =>
                  handleSettingChange("medicationReminders", event.target.checked)
                }
              />
              <span>Recordatorios de medicamentos</span>
            </label>
          </div>

          <div className="setting-item">
            <label>
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(event) => handleSettingChange("soundEnabled", event.target.checked)}
              />
              <span>Sonido en notificaciones</span>
            </label>
          </div>

          <div className="setting-item">
            <label>
              <input
                type="checkbox"
                checked={settings.vibrationEnabled}
                onChange={(event) =>
                  handleSettingChange("vibrationEnabled", event.target.checked)
                }
              />
              <span>Vibraci&oacute;n en notificaciones para m&oacute;viles</span>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>Cu&aacute;ndo recordar citas</h3>
          <p className="help-text">
            Elige cu&aacute;ndo quieres recibir recordatorios antes de cada cita.
          </p>

          <div className="offset-options">
            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={settings.customOffsets.days7}
                  onChange={(event) => handleOffsetChange("days7", event.target.checked)}
                />
              <span>7 d&iacute;as antes</span>
              </label>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={settings.customOffsets.days3}
                  onChange={(event) => handleOffsetChange("days3", event.target.checked)}
                />
                <span>3 d&iacute;as antes</span>
              </label>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={settings.customOffsets.days1}
                  onChange={(event) => handleOffsetChange("days1", event.target.checked)}
                />
                <span>1 d&iacute;a antes</span>
              </label>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={settings.customOffsets.hours2}
                  onChange={(event) => handleOffsetChange("hours2", event.target.checked)}
                />
                <span>2 horas antes</span>
              </label>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={settings.customOffsets.minutes30}
                  onChange={(event) => handleOffsetChange("minutes30", event.target.checked)}
                />
                <span>30 minutos antes</span>
              </label>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={settings.customOffsets.minutes5}
                  onChange={(event) => handleOffsetChange("minutes5", event.target.checked)}
                />
                <span>5 minutos antes</span>
              </label>
            </div>
          </div>
        </section>

        <section className="settings-section actions">
          <button
            className="primary-btn"
            onClick={async () => {
              await loadPushStatus();
              updateStats();
              openSuccessSheet({
                kicker: "Estado actualizado",
                title: "Revisión completada",
                copy: "Klinip volvió a revisar permisos, suscripción push y recordatorios locales de este dispositivo.",
                rows: [
                  { icon: "profile", label: "Push", value: pushEnabled ? "Activo" : "Inactivo" },
                  { icon: "doc", label: "Suscripciones", value: String(pushSubscriptionCount || 0) },
                ],
              });
            }}
          >
            Actualizar estado
          </button>
          <button className="danger-btn" onClick={handleClearAll}>
            Limpiar recordatorios locales antiguos
          </button>
        </section>
      </div>
    </div>
  );

  if (embedded) {
    return <div className="notification-settings-embedded">{panelContent}</div>;
  }

  return (
    <div className="notification-settings-overlay" onClick={onClose}>
      {panelContent}
    </div>
  );
}
