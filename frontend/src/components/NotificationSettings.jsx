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
  // Cargar estado inicial de push desde localStorage
  const [pushEnabled, setPushEnabled] = useState(() => {
    const saved = localStorage.getItem("klinip_push_enabled");
    return saved === "true";
  });
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
      minutes30: true,
      minutes5: true
    }
  });

  useEffect(() => {
    console.log("═".repeat(50));
    console.log("🚀 NotificationSettings MONTADO");
    console.log("═".repeat(50));
    loadNotificationStatus();
    loadSettings();
    updateStats();
    loadPushStatus();

    // Cleanup: detectar cuando el componente se desmonta
    return () => {
      console.log("═".repeat(50));
      console.log("👋 NotificationSettings DESMONTADO (formulario cerrado)");
      console.log("💾 Estado de push al cerrar:", localStorage.getItem("klinip_push_enabled"));
      console.log("═".repeat(50));
    };
  }, []);

  const loadNotificationStatus = () => {
    if ("Notification" in window) {
      setNotificationsEnabled(Notification.permission === "granted");
    }
  };

  const loadPushStatus = async () => {
    try {
      console.log("🔄 Iniciando verificación de estado push...");
      
      // 1. Verificar si el navegador tiene una suscripción activa
      let browserHasSubscription = false;
      if ("serviceWorker" in navigator && "PushManager" in window) {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          browserHasSubscription = sub !== null;
          console.log("🔍 Suscripción en navegador:", browserHasSubscription ? "✅ Activa" : "❌ No encontrada");
          if (sub) {
            console.log("   └─ Endpoint:", sub.endpoint.substring(0, 50) + "...");
          }
        } catch (err) {
          console.warn("No se pudo verificar suscripción del navegador:", err);
        }
      }

      // 2. Verificar si el backend tiene la suscripción registrada
      const status = await getPushStatus();
      console.log("📊 Estado en backend:", status.enabled ? "✅ Registrada" : "❌ No registrada");
      if (status.enabled) {
        console.log("   └─ Subscription ID:", status.subscription_id);
      }

      // 3. El estado es activo solo si AMBOS están activos
      const isEnabled = browserHasSubscription && status.enabled;
      
      // 4. Persistir el estado en localStorage
      localStorage.setItem("klinip_push_enabled", isEnabled.toString());
      console.log("💾 Estado guardado en localStorage:", isEnabled);
      
      setPushEnabled(isEnabled);
      
      console.log("🎯 Estado final de push:", isEnabled ? "✅ ACTIVO" : "❌ INACTIVO");
      console.log("─".repeat(50));
      
      // 5. Si hay desincronización, mostrar advertencia y solución
      if (browserHasSubscription !== status.enabled) {
        console.warn("⚠️ DESINCRONIZACIÓN DETECTADA");
        if (browserHasSubscription && !status.enabled) {
          console.warn("→ El navegador tiene suscripción pero el backend NO");
          console.warn("→ Solución: Habilita las notificaciones push nuevamente");
        } else if (!browserHasSubscription && status.enabled) {
          console.warn("→ El backend tiene suscripción pero el navegador NO");
          console.warn("→ Solución: Deshabilita y vuelve a habilitar las notificaciones");
        }
        console.warn("─".repeat(50));
      }
    } catch (err) {
      console.error("❌ Error cargando estado de push:", err);
      localStorage.setItem("klinip_push_enabled", "false");
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
      console.log("═".repeat(50));
      console.log("🔄 HABILITANDO NOTIFICACIONES PUSH");
      console.log("═".repeat(50));
      
      const success = await ensurePushSubscription();
      if (success) {
        console.log("✅ Suscripción creada exitosamente");
        
        // Esperar un momento para que el servidor registre la suscripción
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verificar el estado desde el servidor para confirmar
        await loadPushStatus();
        
        // Programar notificaciones locales
        console.log("📅 Programando notificaciones locales...");
        await rescheduleNotifications();
        
        console.log("✅ NOTIFICACIONES PUSH HABILITADAS");
        console.log("═".repeat(50));
        alert("✅ Notificaciones push habilitadas correctamente. Recibirás recordatorios automáticos.");
      }
    } catch (err) {
      console.error("❌ Error habilitando push:", err);
      console.error("═".repeat(50));
      
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
      localStorage.setItem("klinip_push_enabled", "false");
      setPushEnabled(false);
    }
  };

  const handleDisablePush = async () => {
    try {
      console.log("═".repeat(50));
      console.log("🔕 DESHABILITANDO NOTIFICACIONES PUSH");
      console.log("═".repeat(50));
      
      await removePushSubscription();
      
      localStorage.setItem("klinip_push_enabled", "false");
      setPushEnabled(false);
      
      console.log("✅ Notificaciones deshabilitadas");
      console.log("═".repeat(50));
      
      alert("🔕 Notificaciones push deshabilitadas");
      
      // Verificar el estado desde el servidor para confirmar
      await loadPushStatus();
    } catch (err) {
      console.error("❌ Error deshabilitando push:", err);
      console.error("═".repeat(50));
    }
  };

  const rescheduleNotifications = async () => {
    try {
      console.log("🔄 Reprogramando notificaciones...");
      clearScheduledNotifications();

      let programadas = 0;

      // Programar recordatorios de citas
      if (settings.appointmentReminders) {
        console.log("📅 Cargando citas...");
        const appointments = await getAppointments();
        const offsets = buildCustomOffsets();
        console.log(`   └─ ${appointments.length} citas encontradas`);
        console.log(`   └─ ${offsets.length} momentos de recordatorio`);
        scheduleReminderNotifications(appointments, offsets);
        programadas += appointments.length * offsets.length;
      }

      // Programar recordatorios de medicamentos
      if (settings.medicationReminders) {
        console.log("💊 Cargando medicamentos...");
        const medications = await getMedications();
        console.log(`   └─ ${medications.length} medicamentos encontrados`);
        scheduleMedicationNotifications(medications);
        programadas += medications.length;
      }

      updateStats();
      
      console.log(`✅ ${programadas} notificaciones programadas`);
      
      // No mostrar alert si se llamó desde handleEnablePush
      if (pushEnabled) {
        console.log("💡 Notificaciones locales programadas + Push del servidor activo");
      } else {
        alert(`✅ ${programadas} notificaciones programadas.`);
      }
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
    if (settings.customOffsets.minutes5) {
      offsets.push({ minutes: 5, label: "5 minutos antes", icon: "", priority: "urgent", sound: "urgent" });
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
              <div className="setting-item">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.customOffsets.minutes5}
                    onChange={(e) => handleOffsetChange("minutes5", e.target.checked)}
                  />
                  <span>5 minutos antes</span>
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

