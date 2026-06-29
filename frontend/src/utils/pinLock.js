// Bloqueo local de la app con PIN de 4 dígitos.
// Es una capa de conveniencia sobre la sesión JWT: guardamos sólo un hash
// salteado del PIN en localStorage (nunca el PIN en claro). No reemplaza la
// autenticación del backend; protege el acceso rápido a la app en el dispositivo.

const PIN_HASH_KEY = "klinip_pin_hash_v1";
const PIN_SALT_KEY = "klinip_pin_salt_v1";
const PIN_ENABLED_KEY = "klinip_pin_enabled_v1";

const storageKey = (base, userId) => (userId ? `${base}_${userId}` : base);

function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

async function hashPin(salt, pin) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

export function hasPin(userId) {
  try {
    return Boolean(localStorage.getItem(storageKey(PIN_HASH_KEY, userId)));
  } catch (_) {
    return false;
  }
}

export async function setPin(userId, pin) {
  const salt = randomSalt();
  const hash = await hashPin(salt, pin);
  localStorage.setItem(storageKey(PIN_SALT_KEY, userId), salt);
  localStorage.setItem(storageKey(PIN_HASH_KEY, userId), hash);
}

export async function verifyPin(userId, pin) {
  try {
    const salt = localStorage.getItem(storageKey(PIN_SALT_KEY, userId));
    const stored = localStorage.getItem(storageKey(PIN_HASH_KEY, userId));
    if (!salt || !stored) return false;
    const hash = await hashPin(salt, pin);
    return hash === stored;
  } catch (_) {
    return false;
  }
}

export function clearPin(userId) {
  try {
    localStorage.removeItem(storageKey(PIN_HASH_KEY, userId));
    localStorage.removeItem(storageKey(PIN_SALT_KEY, userId));
  } catch (_) {
    // noop
  }
}

// Preferencia de bloqueo. Por defecto activado: la seguridad viene encendida y
// el usuario puede desactivarla desde Ajustes.
export function isPinLockEnabled(userId) {
  try {
    return localStorage.getItem(storageKey(PIN_ENABLED_KEY, userId)) !== "false";
  } catch (_) {
    return true;
  }
}

export function setPinLockEnabled(userId, enabled) {
  try {
    localStorage.setItem(
      storageKey(PIN_ENABLED_KEY, userId),
      enabled ? "true" : "false"
    );
  } catch (_) {
    // noop
  }
}

// El navegador necesita un contexto seguro (https o localhost) para WebCrypto.
export function isPinSupported() {
  return Boolean(
    typeof crypto !== "undefined" && crypto.subtle && window.isSecureContext
  );
}
