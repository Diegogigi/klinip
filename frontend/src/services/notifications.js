// Este archivo mantiene compatibilidad con el código anterior
// Importa y re-exporta funciones del nuevo notificationManager

import {
  requestNotificationPermission as newRequestPermission,
  clearScheduledNotifications as newClearNotifications,
  scheduleReminderNotifications as newScheduleReminders,
  scheduleMedicationNotifications as newScheduleMedications,
  sendEmailReminder as newSendEmail,
  getNotificationStats,
  createCustomNotification
} from "./notificationManager";

// Re-exportar funciones para mantener compatibilidad
export const requestNotificationPermission = newRequestPermission;
export const clearScheduledNotifications = newClearNotifications;
export const scheduleReminderNotifications = newScheduleReminders;
export const scheduleMedicationNotifications = newScheduleMedications;
export const sendEmailReminder = newSendEmail;

// Exportar nuevas funciones
export { getNotificationStats, createCustomNotification };

// Mantener para compatibilidad con código antiguo si es necesario
const dayMs = 24 * 60 * 60 * 1000;
export { dayMs };

// Funciones heredadas se han movido a notificationManager.js
// Este archivo solo mantiene las exportaciones para compatibilidad
