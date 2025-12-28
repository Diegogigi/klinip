import { useState, useEffect } from "react";
import {
  requestNotificationPermission,
  getNotificationStats,
  clearScheduledNotifications,
  scheduleReminderNotifications,
  scheduleMedicationNotifications
} from "../services/notificationManager";
import { ensurePushSubscription, removePushSubscription } from "../services/pwa";
import { getAppointments, getMedications, getPushStatus, sendTestPush } from "../services/httpApi";
import "./NotificationSettings.css";

export default function NotificationSettings({ onClose }) {
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [stats, setStats] = useState({ scheduled: 0, appointments: 0, medications: 0, total: 0 });
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
      minutes30: true
    }
  });

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
      // 1. Verificar si el navegador tiene una suscripción activa
      let browserHasSubscription = false;
      if ("serviceWorker" in navigator && "PushManager" in window) {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          browserHasSubscription = sub !== null;
          console.log("🔍 Suscripción en navegador:", browserHasSubscription ? "✅ Activa" : "❌ No encontrada");
        } catch (err) {
          console.warn("No se pudo verificar suscripción del navegador:", err);
        }
      }

      // 2. Verificar si el backend tiene la suscripción registrada
      const status = await getPushStatus();
      console.log("📊 Estado en backend:", status.enabled ? "✅ Registrada" : "❌ No registrada");

      // 3. El estado es activo solo si AMBOS están activos
      const isEnabled = browserHasSubscription && status.enabled;
      setPushEnabled(isEnabled);
      
      console.log("🎯 Estado final de push:", isEnabled ? "✅ ACTIVO" : "❌ INACTIVO");
      
      // 4. Si hay desincronización, mostrar advertencia
      if (browserHasSubscription !== status.enabled) {
        console.warn("⚠️ Desincronización detectada entre navegador y backend");
        if (browserHasSubscription && !status.enabled) {
          console.warn("→ El navegador tiene suscripción pero el backend no");
        } else if (!browserHasSubscription && status.enabled) {
          console.warn("→ El backend tiene suscripción pero el navegador no");
        }
      }
    } catch (err) {
      console.error("Error cargando estado de push:", err);
      setPushEnabled(false);
    }
  };

  const loadSettings = () => {
    const saved = localStorage.getItem("klinip_notification_settings");
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {
        console.error("Error cargando configuración:", e);
      }
    }
  };

  const saveSettings = (newSettings) => {
    localStorage.setItem("klinip_notification_settings", JSON.stringify(newSettings));
    setSettings(newSettings);
  };

  const updateStats = () => {
    const currentStats = getNotificationStats();
    setStats(currentStats);
  };

  const handleEnableNotifications = async () => {
    const granted = await requestNotificationPermission();
    setNotificationsEnabled(granted);
    if (granted) {
      await rescheduleNotifications();
    }
  };

  const handleEnablePush = async () => {
    try {
      console.log("🔄 Iniciando habilitación de push...");
      const success = await ensurePushSubscription();
      if (success) {
        // Verificar el estado desde el servidor para confirmar
        await loadPushStatus();
        alert("✅ Notificaciones push habilitadas correctamente. Recibirás recordatorios automáticos.");
      }
    } catch (err) {
      console.error("❌ Error habilitando push:", err);
      
      // Mostrar mensaje de error específico
      let errorMessage = "❌ Error al habilitar notificaciones push:\n\n";
      
      if (err.message) {
        errorMessage += err.message;
      } else {
        errorMessage += "Error desconocido. Verifica:\n";
        errorMessage += "• Estar en HTTPS (no HTTP)\n";
        errorMessage += "• Tener permisos de notificaciones\n";
        errorMessage += "• Conexión a internet\n";
      }
      
      alert(errorMessage);
      setPushEnabled(false);
    }
  };

  const handleDisablePush = async () => {
    try {
      await removePushSubscription();
      setPushEnabled(false);
      alert("🔕 Notificaciones push deshabilitadas");
      // Verificar el estado desde el servidor para confirmar
      await loadPushStatus();
    } catch (err) {
      console.error("Error deshabilitando push:", err);
    }
  };

  const rescheduleNotifications = async () => {
    try {
      clearScheduledNotifications();

      // NOTA: Las notificaciones ahora se envían automáticamente desde el servidor
      // vía push notifications. No es necesario programarlas localmente.
      // El servidor enviará recordatorios basándose en las citas y medicamentos.
      
      // Si quieres usar notificaciones locales además de push, descomenta:
      // if (settings.appointmentReminders) {
      //   const appointments = await getAppointments();
      //   const offsets = buildCustomOffsets();
      //   scheduleReminderNotifications(appointments, offsets);
      // }
      //
      // if (settings.medicationReminders) {
      //   const medications = await getMedications();
      //   scheduleMedicationNotifications(medications);
      // }

      updateStats();
      alert("✅ Configuración guardada. Las notificaciones push se enviarán automáticamente desde el servidor.");
    } catch (err) {
      console.error("Error reprogramando notificaciones:", err);
      alert("❌ Error al reprogramar notificaciones");
    }
  };

  const buildCustomOffsets = () => {
    const offsets = [];
    
    if (settings.customOffsets.days7) {
      offsets.push({ days: 7, label: "7 días antes", icon: "🟢", priority: "low", sound: "appointment" });
    }
    if (settings.customOffsets.days3) {
      offsets.push({ days: 3, label: "3 días antes", icon: "🟡", priority: "normal", sound: "appointment" });
    }
    if (settings.customOffsets.days1) {
      offsets.push({ days: 1, label: "1 día antes", icon: "🟠", priority: "high", sound: "appointment" });
    }
    if (settings.customOffsets.hours2) {
      offsets.push({ hours: 2, label: "2 horas antes", icon: "🔴", priority: "urgent", sound: "urgent" });
    }
    if (settings.customOffsets.minutes30) {
      offsets.push({ minutes: 30, label: "30 minutos antes", icon: "🚨", priority: "urgent", sound: "urgent" });
    }

    return offsets;
  };

  const handleClearAll = () => {
    if (window.confirm("¿Deseas borrar todas las notificaciones programadas?")) {
      clearScheduledNotifications();
      updateStats();
      alert("🗑️ Todas las notificaciones han sido borradas");
    }
  };

  const handleTestPush = async () => {
    if (!pushEnabled) {
      alert("⚠️ Primero debes habilitar las notificaciones push");
      return;
    }
    
    try {
      console.log("📤 Enviando notificación de prueba...");
      const result = await sendTestPush();
      if (result.sent) {
        alert("✅ Notificación de prueba enviada. Deberías recibirla en unos segundos.");
      } else {
        alert("⚠️ No se pudo enviar la notificación. Revisa la consola para más detalles.");
      }
    } catch (err) {
      console.error("Error enviando notificación de prueba:", err);
      alert("❌ Error al enviar notificación de prueba:\n" + (err.message || "Error desconocido"));
    }
  };

  const handleSettingChange = (key, value) => {
    const newSettings = { ...settings, [key]: value };
    saveSettings(newSettings);
  };

  const handleOffsetChange = (offset, value) => {
    const newSettings = {
      ...settings,
      customOffsets: {
        ...settings.customOffsets,
        [offset]: value
      }
    };
    saveSettings(newSettings);
  };

  return (
    <div className="notification-settings-overlay" onClick={onClose}>
      <div className="notification-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>⚙️ Configuración de Notificaciones</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-content">
          {/* Estado actual */}
          <section className="settings-section">
            <h3>📊 Estado Actual</h3>
            <div className="status-grid">
              <div className="status-item">
                <span className="status-label">Notificaciones del navegador:</span>
                <span className={`status-value ${notificationsEnabled ? "enabled" : "disabled"}`}>
                  {notificationsEnabled ? "✅ Habilitadas" : "❌ Deshabilitadas"}
                </span>
              </div>
              <div className="status-item">
                <span className="status-label">Notificaciones push:</span>
                <span className={`status-value ${pushEnabled ? "enabled" : "disabled"}`}>
                  {pushEnabled ? "✅ Activas" : "⚠️ Inactivas"}
                </span>
              </div>
              <div className="status-item">
                <span className="status-label">Notificaciones programadas:</span>
                <span className="status-value">{stats.total}</span>
              </div>
              <div className="status-item">
                <span className="status-label">Citas:</span>
                <span className="status-value">{stats.appointments}</span>
              </div>
              <div className="status-item">
                <span className="status-label">Medicamentos:</span>
                <span className="status-value">{stats.medications}</span>
              </div>
            </div>
          </section>

          {/* Habilitar notificaciones */}
          {!notificationsEnabled && (
            <section className="settings-section">
              <button className="primary-btn" onClick={handleEnableNotifications}>
                🔔 Habilitar Notificaciones del Navegador
              </button>
              <p className="help-text">
                Necesitas habilitar las notificaciones para recibir recordatorios
              </p>
            </section>
          )}

          {/* Push notifications */}
          <section className="settings-section">
            <h3>📱 Notificaciones Push</h3>
            <p className="help-text">
              Las notificaciones push funcionan incluso cuando la aplicación está cerrada
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {!pushEnabled ? (
                <button className="primary-btn" onClick={handleEnablePush}>
                  Habilitar Notificaciones Push
                </button>
              ) : (
                <>
                  <button className="danger-btn" onClick={handleDisablePush}>
                    Deshabilitar Notificaciones Push
                  </button>
                  <button className="secondary-btn" onClick={handleTestPush}>
                    🧪 Enviar Notificación de Prueba
                  </button>
                </>
              )}
            </div>
          </section>

          {/* Preferencias de recordatorios */}
          <section className="settings-section">
            <h3>⏰ Preferencias de Recordatorios</h3>
            
            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={settings.appointmentReminders}
                  onChange={(e) => handleSettingChange("appointmentReminders", e.target.checked)}
                />
                <span>Recordatorios de citas y exámenes</span>
              </label>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={settings.medicationReminders}
                  onChange={(e) => handleSettingChange("medicationReminders", e.target.checked)}
                />
                <span>Recordatorios de medicamentos</span>
              </label>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={settings.soundEnabled}
                  onChange={(e) => handleSettingChange("soundEnabled", e.target.checked)}
                />
                <span>Sonido en notificaciones</span>
              </label>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={settings.vibrationEnabled}
                  onChange={(e) => handleSettingChange("vibrationEnabled", e.target.checked)}
                />
                <span>Vibración en notificaciones (móviles)</span>
              </label>
            </div>
          </section>

          {/* Tiempos de recordatorio */}
          <section className="settings-section">
            <h3>🕐 Cuándo Recordar (Citas)</h3>
            <p className="help-text">Elige cuándo quieres recibir recordatorios antes de tus citas</p>
            
            <div className="offset-options">
              <div className="setting-item">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.customOffsets.days7}
                    onChange={(e) => handleOffsetChange("days7", e.target.checked)}
                  />
                  <span>🟢 7 días antes</span>
                </label>
              </div>

              <div className="setting-item">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.customOffsets.days3}
                    onChange={(e) => handleOffsetChange("days3", e.target.checked)}
                  />
                  <span>🟡 3 días antes</span>
                </label>
              </div>

              <div className="setting-item">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.customOffsets.days1}
                    onChange={(e) => handleOffsetChange("days1", e.target.checked)}
                  />
                  <span>🟠 1 día antes</span>
                </label>
              </div>

              <div className="setting-item">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.customOffsets.hours2}
                    onChange={(e) => handleOffsetChange("hours2", e.target.checked)}
                  />
                  <span>🔴 2 horas antes</span>
                </label>
              </div>

              <div className="setting-item">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.customOffsets.minutes30}
                    onChange={(e) => handleOffsetChange("minutes30", e.target.checked)}
                  />
                  <span>🚨 30 minutos antes</span>
                </label>
              </div>
            </div>
          </section>

          {/* Acciones */}
          <section className="settings-section actions">
            <button className="primary-btn" onClick={rescheduleNotifications}>
              🔄 Reprogramar Notificaciones
            </button>
            <button className="danger-btn" onClick={handleClearAll}>
              🗑️ Borrar Todas las Notificaciones
            </button>
            <button className="secondary-btn" onClick={() => {
              updateStats();
              alert("📊 Estadísticas actualizadas");
            }}>
              📊 Actualizar Estadísticas
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

