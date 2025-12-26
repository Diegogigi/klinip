import { parseDate, toLocaleDateTimeOrEmpty } from "../utils/dates";

const dayMs = 24 * 60 * 60 * 1000;
let appointmentTimers = [];
let medicationTimers = [];

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const perm = await Notification.requestPermission();
  return perm === "granted";
}

// Función mejorada para mostrar notificaciones usando Service Worker
async function showNotification(title, body, data = {}) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  // Intentar usar el service worker para notificaciones persistentes
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        vibrate: [200, 100, 200],
        requireInteraction: true,
        actions: [
          { action: "open", title: "Ver detalles" },
          { action: "close", title: "Cerrar" }
        ],
        data: {
          url: "/",
          timestamp: Date.now(),
          ...data
        }
      });
      console.log(`✅ Notificación enviada: ${title}`);
      return;
    } catch (err) {
      console.warn("No se pudo usar service worker para notificación:", err);
    }
  }

  // Fallback a notificación simple
  new Notification(title, {
    body,
    icon: "/icons/icon-192.png",
    data
  });
}

export function clearScheduledNotifications() {
  appointmentTimers.forEach(clearTimeout);
  medicationTimers.forEach(clearTimeout);
  appointmentTimers = [];
  medicationTimers = [];
}

export function scheduleReminderNotifications(reminders) {
  appointmentTimers.forEach(clearTimeout);
  appointmentTimers = [];
  if (!reminders?.length) return;

  const offsets = [
    { days: 7, label: "7 días antes", icon: "🟢", priority: "low" },
    { days: 3, label: "3 días antes", icon: "🟡", priority: "normal" },
    { days: 1, label: "1 día antes", icon: "🔴", priority: "high" },
  ];

  reminders.forEach((rem) => {
    if (!rem.date_time) return;
    const whenDate = parseDate(rem.date_time);
    if (!whenDate) return;
    const when = whenDate.getTime();

    offsets.forEach(({ days, label, icon, priority }) => {
      const triggerAt = when - days * dayMs;
      const delay = triggerAt - Date.now();

      const notificationData = {
        appointmentId: rem.id,
        type: rem.type,
        center: rem.center,
        date_time: rem.date_time,
        priority,
        days
      };

      const title = `${icon} Recordatorio: ${label}`;
      const body = `${rem.type || "Cita"} en ${rem.center || "Centro médico"}\n📅 ${toLocaleDateTimeOrEmpty(rem.date_time)}${rem.notes ? `\n📝 ${rem.notes}` : ""}`;

      if (delay <= 0) {
        // Si ya pasó el momento, mostrar inmediatamente
        showNotification(title, body, notificationData);
        return;
      }

      // Programar notificación
      appointmentTimers.push(
        setTimeout(() => {
          showNotification(title, body, notificationData);
        }, delay)
      );
    });
  });

  console.log(`📱 ${appointmentTimers.length} notificaciones programadas para ${reminders.length} citas`);
}

function deriveDoseHours(frequencyText = "") {
  const text = frequencyText.toLowerCase();
  if (text.includes("6")) return [6, 12, 18, 22];
  if (text.includes("8")) return [7, 15, 22];
  if (text.includes("12")) return [9, 21];
  return [9];
}

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

    for (let day = new Date(today); day <= lastDay; day.setDate(day.getDate() + 1)) {
      hours.forEach((hour) => {
        const trigger = new Date(day);
        trigger.setHours(hour, 0, 0, 0);
        const delay = trigger.getTime() - Date.now();
        if (delay <= 0) return;

        const notificationData = {
          medicationId: med.id,
          name: med.name,
          dose: med.dose,
          type: "medication"
        };

        const title = `💊 Medicación: ${med.name || "Tratamiento"}`;
        const body = `${med.dose ? `Dosis: ${med.dose}\n` : ""}${med.frequency ? `Frecuencia: ${med.frequency}\n` : ""}${med.notes ? `Notas: ${med.notes}` : "Tomar según indicación médica"}`;

        medicationTimers.push(
          setTimeout(() => {
            showNotification(title, body, notificationData);
          }, delay)
        );
      });
    }
  });

  console.log(`💊 ${medicationTimers.length} recordatorios de medicación programados para ${medications.length} medicamentos`);
}

export function sendEmailReminder(reminder) {
  const subject = encodeURIComponent(`Recordatorio Klinip: ${reminder.center || "Actividad de salud"}`);
  const body = encodeURIComponent(
    `Hola, esto es un recordatorio de Klinip.

` +
    `Actividad: ${reminder.type || "actividad"}
` +
    `Centro: ${reminder.center || "No definido"}
` +
    `Fecha y hora: ${reminder.date_time ? toLocaleDateTimeOrEmpty(reminder.date_time) : "Por agendar"
    }
` +
    `Notas: ${reminder.notes || "Sin notas"}

` +
    `Mensaje generado desde Klinip.`
  );

  // Lugar para integrar un backend real de correo.
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}
