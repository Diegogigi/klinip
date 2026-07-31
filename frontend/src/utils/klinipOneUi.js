export const DEVICE_SCOPES = [
  "device:read_config",
  "profile:read_basic",
  "device:refresh",
  "device:heartbeat",
  "messages:read",
  "messages:ack",
];

export const MESSAGE_STATE_LABELS = {
  queued: "Pendiente de entrega",
  delivered: "Entregado al dispositivo",
  announced: "Anunciado",
  heard: "Escuchado",
  acknowledged: "Confirmado",
  revoked: "Revocado",
  expired: "Vencido",
  failed: "No entregado",
};

export const PAIRING_STATE_LABELS = {
  pending: "Disponible",
  claimed: "Utilizado",
  expired: "Vencido",
  cancelled: "Cancelado",
};

export function canManageDevices(profile, userId) {
  if (!profile) return false;
  if (Number(profile.owner_user_id) === Number(userId)) return true;
  const role = String(profile.access_role || "").toLowerCase();
  const permissions = profile.access_permissions || [];
  return (
    profile.access_status === "accepted" &&
    (role === "admin" ||
      (role === "caregiver" && permissions.includes("manage_devices")))
  );
}

export function canSendDeviceMessages(profile, userId) {
  if (!profile) return false;
  if (Number(profile.owner_user_id) === Number(userId)) return true;
  const role = String(profile.access_role || "").toLowerCase();
  const permissions = profile.access_permissions || [];
  return (
    profile.access_status === "accepted" &&
    (role === "admin" ||
      (role === "caregiver" &&
        permissions.includes("send_device_messages")))
  );
}

export function getDeviceDisplayState(device, now = Date.now()) {
  if (device?.status === "revoked") return "Revocado";
  if (!device?.last_seen_at) return "Vinculado";
  const lastSeen = new Date(device.last_seen_at).getTime();
  if (!Number.isFinite(lastSeen) || now - lastSeen <= 5 * 60 * 1000) {
    return "Vinculado";
  }
  return "Sin conexión";
}

export function getMessageDisplayState(message) {
  const recipients = message?.recipients || [];
  if (!recipients.length) {
    return MESSAGE_STATE_LABELS[message?.status] || "Pendiente";
  }
  if (recipients.every((item) => item.current_state === "acknowledged")) {
    return "Confirmado";
  }
  if (
    message?.requires_acknowledgement &&
    recipients.some((item) => item.current_state === "heard")
  ) {
    return "Escuchado · Pendiente de confirmar";
  }
  const states = recipients.map((item) => item.current_state);
  const priority = [
    "heard",
    "announced",
    "delivered",
    "queued",
    "failed",
    "expired",
    "revoked",
  ];
  const selected = priority.find((state) => states.includes(state));
  return MESSAGE_STATE_LABELS[selected] || "Pendiente";
}

export function secondsUntil(expiresAt, now = Date.now()) {
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

export function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
