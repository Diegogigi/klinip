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
    { days: 7, label: "7 d?as antes" },
    { days: 3, label: "3 d?as antes" },
    { days: 1, label: "1 d?a antes" },
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
          `${rem.center || "Centro"} ? ${rem.type || "actividad"} ? ${new Date(rem.date_time).toLocaleString()}`
        );
        return;
      }
      timers.push(
        setTimeout(() => {
          showNotification(
            `Recordatorio (${label})`,
            `${rem.center || "Centro"} ? ${rem.type || "actividad"} ? ${new Date(rem.date_time).toLocaleString()}`
          );
        }, delay)
      );
    });
  });
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
      `Fecha y hora: ${
        reminder.date_time ? new Date(reminder.date_time).toLocaleString() : "Por agendar"
      }
` +
      `Notas: ${reminder.notes || "Sin notas"}

` +
      `Mensaje generado desde Klinip.`
  );

  // Lugar para integrar un backend real de correo.
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}
