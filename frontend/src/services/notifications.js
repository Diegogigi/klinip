import { DEMO_MODE } from "../api";

const dayMs = 24 * 60 * 60 * 1000;
let timers = [];

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const perm = await Notification.requestPermission();
  return perm === "granted";
}

function showNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  new Notification(title, { body, icon: "/favicon.ico" });
}

export function clearScheduledNotifications() {
  timers.forEach(clearTimeout);
  timers = [];
}

export function scheduleReminderNotifications(reminders) {
  clearScheduledNotifications();
  if (!reminders?.length) return;

  const offsets = [
    { days: 7, label: "7 días antes" },
    { days: 3, label: "3 días antes" },
    { days: 1, label: "1 día antes" },
  ];

  reminders.forEach((rem) => {
    if (!rem.date_time) return;
    const when = new Date(rem.date_time).getTime();
    offsets.forEach(({ days, label }) => {
      const triggerAt = when - days * dayMs;
      const delay = triggerAt - Date.now();
      if (delay <= 0) {
        showNotification(
          `Recordatorio (${label})`,
          `${rem.center || "Centro"} · ${rem.type || "actividad"} · ${new Date(rem.date_time).toLocaleString()}`
        );
        return;
      }
      const cappedDelay = DEMO_MODE ? Math.min(delay, 15000) : delay;
      timers.push(
        setTimeout(() => {
          showNotification(
            `Recordatorio (${label})`,
            `${rem.center || "Centro"} · ${rem.type || "actividad"} · ${new Date(rem.date_time).toLocaleString()}`
          );
        }, cappedDelay)
      );
    });
  });
}

export function sendEmailReminder(reminder) {
  const subject = encodeURIComponent(`Recordatorio Klinip: ${reminder.center || "Actividad de salud"}`);
  const body = encodeURIComponent(
    `Hola, esto es un recordatorio de Klinip.\n\n` +
      `Actividad: ${reminder.type || "actividad"}\n` +
      `Centro: ${reminder.center || "No definido"}\n` +
      `Fecha y hora: ${
        reminder.date_time ? new Date(reminder.date_time).toLocaleString() : "Por agendar"
      }\n` +
      `Notas: ${reminder.notes || "Sin notas"}\n\n` +
      `Generado desde el demo.`
  );

  if (DEMO_MODE) {
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  } else {
    // Lugar para integrar un backend real de correo.
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }
}
