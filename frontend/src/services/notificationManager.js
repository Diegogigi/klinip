import { parseDate, toLocaleDateTimeOrEmpty } from "../utils/dates";

// Constantes
const dayMs = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "klinip_scheduled_notifications";
const SOUND_URLS = {
  appointment: "/sounds/appointment.mp3",
  medication: "/sounds/medication.mp3",
  urgent: "/sounds/urgent.mp3",
  default: "/sounds/notification.mp3"
};

// Estado global
let appointmentTimers = [];
let medicationTimers = [];
let audioContext = null;

// Rate limiter para evitar muchas notificaciones simultáneas al iniciar sesión
let recentNotifications = new Map(); // tag -> timestamp
const NOTIFICATION_COOLDOWN_MS = 5000; // 5 segundos de cooldown por notificación única

function shouldThrottleNotification(tag) {
  if (!tag) return false;
  
  const lastShown = recentNotifications.get(tag);
  const now = Date.now();
  
  if (lastShown && (now - lastShown) < NOTIFICATION_COOLDOWN_MS) {
    console.log(`⏸️ Notificación throttled: ${tag}`);
    return true; // Bloquear notificación duplicada reciente
  }
  
  recentNotifications.set(tag, now);
  
  // Limpiar notificaciones antiguas del mapa (más de 1 hora)
  for (const [key, time] of recentNotifications.entries()) {
    if (now - time > 60 * 60 * 1000) {
      recentNotifications.delete(key);
    }
  }
  
  return false;
}

/**
 * Clase para gestionar notificaciones persistentes
 */
class NotificationManager {
  constructor() {
    this.scheduledNotifications = this.loadScheduledNotifications();
    this.initAudioContext();
  }

  initAudioContext() {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn("Audio Context no disponible:", e);
    }
  }

  /**
   * Cargar notificaciones programadas desde localStorage
   */
  loadScheduledNotifications() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error("Error cargando notificaciones:", e);
      return [];
    }
  }

  /**
   * Guardar notificaciones programadas en localStorage
   */
  saveScheduledNotifications() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.scheduledNotifications));
    } catch (e) {
      console.error("Error guardando notificaciones:", e);
    }
  }

  /**
   * Agregar una notificación programada
   */
  addScheduledNotification(notification) {
    this.scheduledNotifications.push({
      id: `${Date.now()}-${Math.random()}`,
      ...notification,
      createdAt: Date.now()
    });
    this.saveScheduledNotifications();
  }

  /**
   * Eliminar notificación por ID
   */
  removeScheduledNotification(id) {
    this.scheduledNotifications = this.scheduledNotifications.filter(n => n.id !== id);
    this.saveScheduledNotifications();
  }

  /**
   * Limpiar notificaciones antiguas (más de 30 días)
   */
  cleanOldNotifications() {
    const thirtyDaysAgo = Date.now() - 30 * dayMs;
    this.scheduledNotifications = this.scheduledNotifications.filter(
      n => n.triggerAt > thirtyDaysAgo
    );
    this.saveScheduledNotifications();
  }

  /**
   * Obtener notificaciones pendientes
   */
  getPendingNotifications() {
    return this.scheduledNotifications.filter(n => n.triggerAt > Date.now());
  }

  /**
   * Reproducir sonido de notificación
   */
  async playNotificationSound(type = "default") {
    try {
      const soundUrl = SOUND_URLS[type] || SOUND_URLS.default;
      const audio = new Audio(soundUrl);
      audio.volume = 0.5;
      await audio.play().catch(err => {
        console.warn("No se pudo reproducir sonido:", err);
      });
    } catch (e) {
      console.warn("Error reproduciendo sonido:", e);
    }
  }
}

// Instancia global
const notificationManager = new NotificationManager();

/**
 * Solicitar permiso de notificaciones
 */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    console.warn("Este navegador no soporta notificaciones");
    return false;
  }
  
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  
  const perm = await Notification.requestPermission();
  return perm === "granted";
}

/**
 * Mostrar notificación mejorada
 */
async function showNotification(title, body, options = {}) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const {
    icon = "/icons/k_logo.png",
    badge = "/icons/k_logo.png",
    tag = "",
    requireInteraction = true,
    vibrate = [200, 100, 200],
    sound = "default",
    url = "/",
    data = {},
    actions = [
      { action: "open", title: "Ver detalles" },
      { action: "close", title: "Cerrar" }
    ]
  } = options;

  // Aplicar throttling para evitar muchas notificaciones a la vez
  if (shouldThrottleNotification(tag)) {
    return; // Saltar notificación si ya se mostró recientemente
  }

  // Reproducir sonido
  await notificationManager.playNotificationSound(sound);

  // Usar service worker si está disponible
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        icon,
        badge,
        vibrate,
        requireInteraction,
        tag,
        actions,
        data: {
          url,
          timestamp: Date.now(),
          sound,
          ...data
        }
      });
      console.log(`✅ Notificación enviada: ${title}`);
      return;
    } catch (err) {
      console.warn("No se pudo usar service worker:", err);
    }
  }

  // Fallback a notificación simple
  const notification = new Notification(title, {
    body,
    icon,
    tag,
    data: { url, ...data }
  });

  notification.onclick = () => {
    window.focus();
    if (url) window.location.href = url;
    notification.close();
  };
}

/**
 * Limpiar todas las notificaciones programadas
 */
export function clearScheduledNotifications() {
  appointmentTimers.forEach(clearTimeout);
  medicationTimers.forEach(clearTimeout);
  appointmentTimers = [];
  medicationTimers = [];
}

/**
 * Programar recordatorios de citas con opciones mejoradas
 */
export function scheduleReminderNotifications(reminders, customOffsets = null) {
  appointmentTimers.forEach(clearTimeout);
  appointmentTimers = [];
  
  if (!reminders?.length) return;

  // Offsets personalizables
  const offsets = customOffsets || [
    { days: 7, label: "7 días antes", icon: "🟢", priority: "low", sound: "appointment" },
    { days: 3, label: "3 días antes", icon: "🟡", priority: "normal", sound: "appointment" },
    { days: 1, label: "1 día antes", icon: "🟠", priority: "high", sound: "appointment" },
    { hours: 2, label: "2 horas antes", icon: "🔴", priority: "urgent", sound: "urgent" },
    { minutes: 30, label: "30 minutos antes", icon: "🚨", priority: "urgent", sound: "urgent" }
  ];

  reminders.forEach((rem) => {
    if (!rem.date_time) return;
    const whenDate = parseDate(rem.date_time);
    if (!whenDate) return;
    const when = whenDate.getTime();

    offsets.forEach(({ days, hours, minutes, label, icon, priority, sound }) => {
      let triggerAt = when;
      
      if (days) triggerAt -= days * dayMs;
      if (hours) triggerAt -= hours * 60 * 60 * 1000;
      if (minutes) triggerAt -= minutes * 60 * 1000;
      
      const delay = triggerAt - Date.now();

      const notificationData = {
        appointmentId: rem.id,
        type: rem.type,
        specialty: rem.specialty,
        center: rem.center,
        date_time: rem.date_time,
        priority,
        days,
        hours,
        minutes
      };

      const title = `${icon} Recordatorio: ${label}`;
      const body = `${rem.specialty || rem.type || "Cita"} en ${rem.center || "Centro médico"}\n📅 ${toLocaleDateTimeOrEmpty(rem.date_time)}${rem.notes ? `\n📝 ${rem.notes}` : ""}`;

      // IMPORTANTE: NO mostrar notificaciones pasadas al iniciar sesión
      // Esto evita que se disparen todas las notificaciones atrasadas a la vez
      // Solo programar notificaciones futuras (próximos 30 días)
      if (delay > 0 && delay < 30 * dayMs) {
        // Guardar en persistencia
        notificationManager.addScheduledNotification({
          triggerAt,
          title,
          body,
          sound,
          url: "/appointments",
          tag: `appointment-${rem.id}-${label}`,
          data: notificationData
        });

        // Programar timeout
        const timer = setTimeout(() => {
          showNotification(title, body, {
            sound,
            url: "/appointments",
            tag: `appointment-${rem.id}-${label}`,
            data: notificationData
          });
        }, delay);
        
        appointmentTimers.push(timer);
      }
    });
  });

  notificationManager.cleanOldNotifications();
  console.log(`📱 ${appointmentTimers.length} notificaciones de citas programadas`);
}

/**
 * Derivar horas de medicación según frecuencia
 */
function deriveDoseHours(frequencyText = "") {
  const text = frequencyText.toLowerCase();
  
  // Cada 4 horas: 6 tomas al día
  if (text.includes("4") && text.includes("hora")) return [6, 10, 14, 18, 22, 2];
  
  // Cada 6 horas: 4 tomas al día
  if (text.includes("6") && text.includes("hora")) return [6, 12, 18, 24];
  
  // Cada 8 horas: 3 tomas al día
  if (text.includes("8") && text.includes("hora")) return [7, 15, 23];
  
  // Cada 12 horas: 2 tomas al día
  if (text.includes("12") && text.includes("hora")) return [8, 20];
  
  // 3 veces al día
  if (text.includes("3") && text.includes("vez")) return [8, 14, 20];
  
  // 2 veces al día
  if (text.includes("2") && text.includes("vez")) return [8, 20];
  
  // Default: una vez al día
  return [9];
}

/**
 * Programar recordatorios de medicación mejorados
 */
export function scheduleMedicationNotifications(medications) {
  medicationTimers.forEach(clearTimeout);
  medicationTimers = [];
  
  if (!medications?.length) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + 30 * dayMs);

  medications.forEach((med) => {
    if (!med?.end_date) return;
    
    const end = parseDate(med.end_date);
    if (!end) return;
    
    const lastDay = end < horizon ? end : horizon;
    const hours = deriveDoseHours(med.frequency);

    // Programar para cada día
    for (let day = new Date(today); day <= lastDay; day.setDate(day.getDate() + 1)) {
      hours.forEach((hour) => {
        const trigger = new Date(day);
        trigger.setHours(hour, 0, 0, 0);
        const delay = trigger.getTime() - Date.now();
        
        // Solo programar futuras notificaciones
        if (delay <= 0) return;

        const notificationData = {
          medicationId: med.id,
          name: med.name,
          dose: med.dose,
          frequency: med.frequency,
          type: "medication"
        };

        const title = `💊 Medicación: ${med.name || "Tratamiento"}`;
        const body = `${med.dose ? `Dosis: ${med.dose}\n` : ""}${med.frequency ? `Frecuencia: ${med.frequency}\n` : ""}${med.notes ? `📝 ${med.notes}` : "Tomar según indicación médica"}`;

        // Guardar en persistencia
        notificationManager.addScheduledNotification({
          triggerAt: trigger.getTime(),
          title,
          body,
          sound: "medication",
          url: "/medications",
          tag: `medication-${med.id}-${trigger.getTime()}`,
          data: notificationData
        });

        // Programar timeout
        const timer = setTimeout(() => {
          showNotification(title, body, {
            sound: "medication",
            url: "/medications",
            tag: `medication-${med.id}-${trigger.getTime()}`,
            requireInteraction: true,
            data: notificationData
          });
        }, delay);
        
        medicationTimers.push(timer);
      });
    }
  });

  notificationManager.cleanOldNotifications();
  console.log(`💊 ${medicationTimers.length} recordatorios de medicación programados`);
}

/**
 * Crear notificación personalizada
 */
export function createCustomNotification(options) {
  const {
    title,
    body,
    triggerAt,
    sound = "default",
    url = "/",
    data = {}
  } = options;

  const delay = triggerAt - Date.now();

  if (delay <= 0) {
    showNotification(title, body, { sound, url, data });
    return;
  }

  // Guardar en persistencia
  notificationManager.addScheduledNotification({
    triggerAt,
    title,
    body,
    sound,
    url,
    data
  });

  // Programar
  setTimeout(() => {
    showNotification(title, body, { sound, url, data });
  }, delay);
}

/**
 * Obtener estadísticas de notificaciones
 */
export function getNotificationStats() {
  return {
    scheduled: notificationManager.getPendingNotifications().length,
    appointments: appointmentTimers.length,
    medications: medicationTimers.length,
    total: appointmentTimers.length + medicationTimers.length
  };
}

/**
 * Enviar recordatorio por email
 */
export function sendEmailReminder(reminder) {
  const subject = encodeURIComponent(
    `Recordatorio Klinip: ${reminder.center || "Actividad de salud"}`
  );
  const body = encodeURIComponent(
    `Hola, esto es un recordatorio de Klinip.

Actividad: ${reminder.type || reminder.specialty || "actividad"}
Centro: ${reminder.center || "No definido"}
Fecha y hora: ${reminder.date_time ? toLocaleDateTimeOrEmpty(reminder.date_time) : "Por agendar"}
Notas: ${reminder.notes || "Sin notas"}

Mensaje generado desde Klinip.`
  );

  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

export { notificationManager };

