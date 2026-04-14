import { parseDate, toLocaleDateTimeOrEmpty } from "../utils/dates";
import { buildMedicationScheduleEventsBetween as sharedBuildMedicationScheduleEventsBetween } from "../utils/medicationSchedule";

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
let appointmentRuntimeTimer = null;
let medicationRuntimeTimer = null;
let audioContext = null;
const APPOINTMENT_TYPE_LABELS = [
  { match: "examen", label: "Examen" },
  { match: "tramite", label: "Trámite" }
];
const DEFAULT_APPOINTMENT_LABEL = "Cita médica";
const MEDICATION_LEAD_MINUTES = 5;

function getAppointmentTypeLabel(reminder) {
  const raw = `${reminder?.type || ""}`.toLowerCase();
  const found = APPOINTMENT_TYPE_LABELS.find(item => raw.includes(item.match));
  return found ? found.label : DEFAULT_APPOINTMENT_LABEL;
}

function postMessageToServiceWorker(message) {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((registration) => {
      const target = registration.active || registration.waiting || registration.installing;
      if (target) {
        target.postMessage(message);
      }
    })
    .catch((err) => {
      console.warn("No se pudo enviar mensaje al service worker:", err);
    });
}

function removeScheduledInServiceWorker(id) {
  postMessageToServiceWorker({ type: "REMOVE_SCHEDULED_NOTIFICATION", id });
}

function scheduleInServiceWorker(notification) {
  postMessageToServiceWorker({ type: "SCHEDULE_NOTIFICATION", notification });
}

function clearServiceWorkerSchedule() {
  postMessageToServiceWorker({ type: "CLEAR_SCHEDULED_NOTIFICATIONS" });
}

function recordNotificationInServiceWorker(notification) {
  postMessageToServiceWorker({ type: "RECORD_NOTIFICATION", notification });
}

function clearRuntimeTimer(type) {
  if (type === "appointment" && appointmentRuntimeTimer) {
    clearTimeout(appointmentRuntimeTimer);
    appointmentRuntimeTimer = null;
  }
  if (type === "medication" && medicationRuntimeTimer) {
    clearTimeout(medicationRuntimeTimer);
    medicationRuntimeTimer = null;
  }
}

function setRuntimeTimer(type, timerId) {
  clearRuntimeTimer(type);
  if (type === "appointment") {
    appointmentRuntimeTimer = timerId;
  }
  if (type === "medication") {
    medicationRuntimeTimer = timerId;
  }
}

function inferNotificationType(notification = {}) {
  if (notification?.data?.type) return notification.data.type;
  const tag = String(notification?.tag || "");
  if (tag.startsWith("appointment-")) return "appointment";
  if (tag.startsWith("medication-")) return "medication";
  return "";
}

function buildScheduledNotificationId(notification = {}) {
  if (notification?.id) return String(notification.id);
  if (notification?.tag) return String(notification.tag);

  const type = inferNotificationType(notification) || "notification";
  const entityId =
    notification?.data?.appointmentId ||
    notification?.data?.medicationId ||
    notification?.appointmentId ||
    notification?.medicationId ||
    "generic";
  const triggerAt = notification?.triggerAt || notification?.data?.triggerAt || "now";

  return `${type}-${entityId}-${triggerAt}`;
}

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
    const id = buildScheduledNotificationId(notification);
    const created = {
      id,
      ...notification,
      createdAt: Date.now()
    };
    const existingIndex = this.scheduledNotifications.findIndex((item) => item.id === id);
    if (existingIndex >= 0) {
      this.scheduledNotifications[existingIndex] = created;
    } else {
      this.scheduledNotifications.push(created);
    }
    this.saveScheduledNotifications();
    scheduleInServiceWorker(created);
    return created;
  }

  clearAllScheduledNotifications() {
    this.scheduledNotifications = [];
    this.saveScheduledNotifications();
  }

  /**
   * Eliminar notificación por ID
   */
  removeScheduledNotification(id) {
    this.scheduledNotifications = this.scheduledNotifications.filter(n => n.id !== id);
    this.saveScheduledNotifications();
    removeScheduledInServiceWorker(id);
  }

  removeScheduledNotificationsByType(type) {
    if (!type) return;
    const toRemove = this.scheduledNotifications.filter(
      (notification) => inferNotificationType(notification) === type
    );
    if (!toRemove.length) return;
    this.scheduledNotifications = this.scheduledNotifications.filter(
      (notification) => inferNotificationType(notification) !== type
    );
    this.saveScheduledNotifications();
    toRemove.forEach((notification) => {
      removeScheduledInServiceWorker(notification.id);
    });
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

  getNextScheduledNotificationByType(type) {
    const now = Date.now();
    return this.scheduledNotifications
      .filter(
        (notification) =>
          inferNotificationType(notification) === type &&
          Number(notification?.triggerAt || 0) > now
      )
      .sort((a, b) => Number(a.triggerAt || 0) - Number(b.triggerAt || 0))[0] || null;
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
const RUNTIME_SCHEDULER_WINDOW_MS = 60 * 60 * 1000;

function armRuntimeScheduler(type) {
  clearRuntimeTimer(type);

  const nextNotification = notificationManager.getNextScheduledNotificationByType(type);
  if (!nextNotification) return;

  const now = Date.now();
  const delay = Number(nextNotification.triggerAt || 0) - now;
  const wakeDelay = Math.min(Math.max(delay, 0), RUNTIME_SCHEDULER_WINDOW_MS);
  const shouldDispatchOnWake = delay <= RUNTIME_SCHEDULER_WINDOW_MS;

  const timerId = setTimeout(async () => {
    try {
      if (!shouldDispatchOnWake) {
        armRuntimeScheduler(type);
        return;
      }

      const latestNotification = notificationManager.scheduledNotifications.find(
        (item) => item.id === nextNotification.id
      );
      if (!latestNotification) {
        armRuntimeScheduler(type);
        return;
      }

      notificationManager.removeScheduledNotification(latestNotification.id);
      await showNotification(latestNotification.title, latestNotification.body, {
        id: latestNotification.id,
        sound: latestNotification.sound,
        url: latestNotification.url,
        tag: latestNotification.tag,
        requireInteraction: inferNotificationType(latestNotification) === "medication",
        actions: latestNotification.actions,
        data: latestNotification.data || {},
      });
    } finally {
      armRuntimeScheduler(type);
    }
  }, wakeDelay);

  setRuntimeTimer(type, timerId);
}

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
    id = "",
    icon = "/icons/android-chrome-192x192.png",
    badge = "/icons/android-chrome-192x192.png",
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
      recordNotificationInServiceWorker({
        id: id || tag || buildScheduledNotificationId({ title, triggerAt: Date.now(), data }),
        title,
        body,
        url,
        tag,
        timestamp: Date.now(),
        source: "local",
        data
      });
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

  recordNotificationInServiceWorker({
    id: id || tag || buildScheduledNotificationId({ title, triggerAt: Date.now(), data }),
    title,
    body,
    url,
    tag,
    timestamp: Date.now(),
    source: "local"
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
  clearRuntimeTimer("appointment");
  clearRuntimeTimer("medication");
  notificationManager.clearAllScheduledNotifications();
  clearServiceWorkerSchedule();
}

/**
 * Programar recordatorios de citas con opciones mejoradas
 */
export function scheduleReminderNotifications(reminders, customOffsets = null) {
  clearRuntimeTimer("appointment");
  notificationManager.removeScheduledNotificationsByType("appointment");

  if (!reminders?.length) {
    notificationManager.cleanOldNotifications();
    return;
  }

  // Offsets personalizables
  const offsets = customOffsets || [
    { days: 7, label: "7 días antes", icon: "", priority: "low", sound: "appointment" },
    { days: 3, label: "3 días antes", icon: "", priority: "normal", sound: "appointment" },
    { days: 1, label: "1 día antes", icon: "", priority: "high", sound: "appointment" },
    { hours: 2, label: "2 horas antes", icon: "", priority: "urgent", sound: "urgent" },
    { minutes: 30, label: "30 minutos antes", icon: "", priority: "urgent", sound: "urgent" },
    { minutes: 5, label: "5 minutos antes", icon: "", priority: "urgent", sound: "urgent" }
  ];

  reminders.forEach((rem) => {
    if (!rem.date_time) return;
    const whenDate = parseDate(rem.date_time);
    if (!whenDate) return;
    const when = whenDate.getTime();

    const appointmentLabel = getAppointmentTypeLabel(rem);

    offsets.forEach(({ days, hours, minutes, label, priority, sound }) => {
      let triggerAt = when;

      if (days) triggerAt -= days * dayMs;
      if (hours) triggerAt -= hours * 60 * 60 * 1000;
      if (minutes) triggerAt -= minutes * 60 * 1000;

      const delay = triggerAt - Date.now();

      const notificationData = {
        appointmentId: rem.id,
        type: "appointment",
        category: appointmentLabel,
        appointmentType: rem.type,
        specialty: rem.specialty,
        center: rem.center,
        date_time: rem.date_time,
        priority,
        days,
        hours,
        minutes
      };

      const title = `${appointmentLabel} - Recordatorio: ${label}`;
      const body = `${rem.specialty || rem.type || "Cita"} en ${rem.center || "Centro médico"}
${toLocaleDateTimeOrEmpty(rem.date_time)}${rem.notes ? `
${rem.notes}` : ""}`;

      // IMPORTANTE: NO mostrar notificaciones pasadas al iniciar sesion
      // Esto evita que se disparen todas las notificaciones atrasadas a la vez
      // Solo programar notificaciones futuras (proximos 30 dias)
      if (delay > 0 && delay < 30 * dayMs) {
        // Guardar en persistencia
        notificationManager.addScheduledNotification({
          triggerAt,
          title,
          body,
          sound,
          url: "/appointments",
          tag: `appointment-${rem.id}-${label}`,
          actions: [
            { action: "done", title: "Realizada" },
            { action: "open", title: "Ver detalles" }
          ],
          data: notificationData
        });

      }
    });
  });

  notificationManager.cleanOldNotifications();
  armRuntimeScheduler("appointment");
  console.log("Notificaciones de citas reprogramadas");
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

function deriveFrequencyIntervalHours(frequencyText = "") {
  const text = String(frequencyText || "").toLowerCase();
  const match = text.match(/cada\s+(\d{1,2})\s+hora/);
  if (match) {
    const hours = Number(match[1]);
    if ([4, 6, 8, 12, 24].includes(hours)) return hours;
  }
  if ((text.includes("12") && text.includes("hora")) || text.includes("2 veces")) return 12;
  if ((text.includes("8") && text.includes("hora")) || text.includes("3 veces")) return 8;
  if ((text.includes("6") && text.includes("hora")) || text.includes("4 veces")) return 6;
  if ((text.includes("24") && text.includes("hora")) || text.includes("una vez")) return 24;
  return null;
}

function parseScheduleTime(value = "") {
  if (!value || typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseDurationDays(value = "") {
  const text = String(value || "").toLowerCase().trim();
  const daysMatch = text.match(/(\d+)\s*d[ií]a/);
  if (daysMatch) return Number(daysMatch[1]);
  const weeksMatch = text.match(/(\d+)\s*semana/);
  if (weeksMatch) return Number(weeksMatch[1]) * 7;
  return null;
}

function getMedicationStartAt(med) {
  return parseDate(med?.start_at || med?.created_at || Date.now());
}

function getMedicationEndAt(med) {
  const explicitEnd = parseDate(med?.end_date);
  if (explicitEnd) {
    explicitEnd.setHours(23, 59, 59, 999);
    return explicitEnd;
  }
  const startAt = getMedicationStartAt(med);
  const durationDays = parseDurationDays(med?.duration || "");
  if (!startAt || !durationDays) return null;
  return new Date(startAt.getTime() + durationDays * dayMs);
}

function buildMedicationScheduleEventsBetween(med, windowStart, windowEnd) {
  const startAt = getMedicationStartAt(med) || new Date(windowStart);
  const effectiveStart = new Date(Math.max(startAt.getTime(), windowStart.getTime()));
  const effectiveEnd = new Date(windowEnd);
  const endAt = getMedicationEndAt(med);
  if (endAt && endAt.getTime() < effectiveEnd.getTime()) {
    effectiveEnd.setTime(endAt.getTime());
  }
  if (effectiveEnd.getTime() < effectiveStart.getTime()) return [];

  const intervalHours = deriveFrequencyIntervalHours(med?.frequency || "");
  if (intervalHours) {
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const events = [];
    let current = new Date(startAt);
    if (current.getTime() < effectiveStart.getTime()) {
      const jumpSteps = Math.floor((effectiveStart.getTime() - current.getTime()) / intervalMs);
      current = new Date(current.getTime() + jumpSteps * intervalMs);
      while (current.getTime() < effectiveStart.getTime()) {
        current = new Date(current.getTime() + intervalMs);
      }
    }
    while (current.getTime() <= effectiveEnd.getTime()) {
      events.push(new Date(current));
      current = new Date(current.getTime() + intervalMs);
    }
    return events;
  }

  const scheduleTime = parseScheduleTime(med?.schedule_time) || {
    hour: startAt.getHours(),
    minute: startAt.getMinutes(),
  };
  const current = new Date(effectiveStart);
  current.setHours(scheduleTime.hour, scheduleTime.minute, 0, 0);
  if (current.getTime() < effectiveStart.getTime()) {
    current.setDate(current.getDate() + 1);
  }
  const events = [];
  while (current.getTime() <= effectiveEnd.getTime()) {
    events.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return events;
}

/**
 * Programar recordatorios de medicación mejorados
 */
export function scheduleMedicationNotifications(medications) {
  clearRuntimeTimer("medication");
  notificationManager.removeScheduledNotificationsByType("medication");

  if (!medications?.length) {
    notificationManager.cleanOldNotifications();
    return;
  }

  const leadOffsets = [MEDICATION_LEAD_MINUTES, 0];
  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * dayMs);

  medications.forEach((med) => {
    if (med?.completed) return;

    sharedBuildMedicationScheduleEventsBetween(med, now, horizon).forEach((trigger) => {
      const triggerExact = trigger.getTime();

      leadOffsets.forEach((offsetMinutes) => {
        const triggerAt = triggerExact - offsetMinutes * 60 * 1000;
        const delay = triggerAt - Date.now();
        if (delay <= 0) return;

        const notificationData = {
          medicationId: med.id,
          name: med.name,
          dose: med.dose,
          frequency: med.frequency,
          leadMinutes: offsetMinutes,
          type: "medication"
        };

        const title = `Medicación: ${med.name || "Tratamiento"}`;
        const prefix = offsetMinutes === 0 ? "Ahora" : `En ${offsetMinutes} minutos`;
        const body = `${prefix}
${med.dose ? `Dosis: ${med.dose}
` : ""}${med.frequency ? `Frecuencia: ${med.frequency}
` : ""}${med.notes ? `${med.notes}` : "Tomar según indicación médica"}`;

        const targetUrl =
          offsetMinutes === 0
            ? `/medications?notify=1&medicationId=${med.id}&trigger=${triggerExact}`
            : "/medications";

        notificationManager.addScheduledNotification({
          triggerAt,
          title,
          body,
          sound: "medication",
          url: targetUrl,
          tag: `medication-${med.id}-${triggerExact}-lead-${offsetMinutes}`,
          actions: [
            { action: "done", title: "Realizado" },
            { action: "open", title: "Ver detalles" }
          ],
          data: notificationData
        });

      });
    });
  });

  notificationManager.cleanOldNotifications();
  armRuntimeScheduler("medication");
  console.log("Recordatorios de medicacion reprogramados");
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
  const created = notificationManager.addScheduledNotification({
    triggerAt,
    title,
    body,
    sound,
    url,
    data
  });

  // Programar
  setTimeout(() => {
    notificationManager.removeScheduledNotification(created.id);
    showNotification(title, body, { sound, url, data });
  }, delay);
}

/**
 * Obtener estadísticas de notificaciones
 */
export function getNotificationStats() {
  const pending = notificationManager.getPendingNotifications();
  const appointments = pending.filter(n => n.data?.type === "appointment").length;
  const medications = pending.filter(n => n.data?.type === "medication").length;
  return {
    scheduled: pending.length,
    appointments,
    medications,
    total: pending.length
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

