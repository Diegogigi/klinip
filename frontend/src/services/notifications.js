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

function showNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  new Notification(title, { body, icon: "/favicon.ico" });
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
    { days: 7, label: "7 d?as antes" },
    { days: 3, label: "3 d?as antes" },
    { days: 1, label: "1 d?a antes" },
  ];

  reminders.forEach((rem) => {
    if (!rem.date_time) return;
    const whenDate = parseDate(rem.date_time);
    if (!whenDate) return;
    const when = whenDate.getTime();
    offsets.forEach(({ days, label }) => {
      const triggerAt = when - days * dayMs;
      const delay = triggerAt - Date.now();
      if (delay <= 0) {
        showNotification(
          `Recordatorio (${label})`,
          `${rem.center || "Centro"} ? ${rem.type || "actividad"} ? ${toLocaleDateTimeOrEmpty(rem.date_time)}`
        );
        return;
      }
      appointmentTimers.push(
        setTimeout(() => {
          showNotification(
            `Recordatorio (${label})`,
            `${rem.center || "Centro"} ? ${rem.type || "actividad"} ? ${toLocaleDateTimeOrEmpty(rem.date_time)}`
          );
        }, delay)
      );
    });
  });
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
        medicationTimers.push(
          setTimeout(() => {
            showNotification(
              `Medicaci?n: ${med.name || "Tratamiento"}`,
              `${med.dose ? med.dose + " - " : ""}${med.frequency || "Tomar seg?n indicaci?n"}. ${
                med.notes || ""
              }`
            );
          }, delay)
        );
      });
    }
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
        reminder.date_time ? toLocaleDateTimeOrEmpty(reminder.date_time) : "Por agendar"
      }
` +
      `Notas: ${reminder.notes || "Sin notas"}

` +
      `Mensaje generado desde Klinip.`
  );

  // Lugar para integrar un backend real de correo.
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}
