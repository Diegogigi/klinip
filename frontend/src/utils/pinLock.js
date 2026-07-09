const PIN_RECOVERY_LOGIN_KEY = "klinip_pin_recovery_login";
const PIN_RELOCK_REQUIRED_KEY = "klinip_pin_relock_required";
const PIN_RECENT_PASSWORD_LOGIN_KEY = "klinip_pin_recent_password_login";
const PIN_SUPPRESS_RELOCK_UNTIL_KEY = "klinip_pin_suppress_relock_until";

export function markPinRecoveryLogin() {
  try {
    sessionStorage.setItem(PIN_RECOVERY_LOGIN_KEY, "1");
  } catch (_) {
    // noop
  }
}

export function consumePinRecoveryLogin() {
  try {
    const value = sessionStorage.getItem(PIN_RECOVERY_LOGIN_KEY) === "1";
    sessionStorage.removeItem(PIN_RECOVERY_LOGIN_KEY);
    return value;
  } catch (_) {
    return false;
  }
}

export function markPinRecentPasswordLogin() {
  try {
    sessionStorage.setItem(PIN_RECENT_PASSWORD_LOGIN_KEY, "1");
  } catch (_) {
    // noop
  }
}

export function consumePinRecentPasswordLogin() {
  try {
    const value = sessionStorage.getItem(PIN_RECENT_PASSWORD_LOGIN_KEY) === "1";
    sessionStorage.removeItem(PIN_RECENT_PASSWORD_LOGIN_KEY);
    return value;
  } catch (_) {
    return false;
  }
}

export function markPinRelockRequired() {
  try {
    sessionStorage.setItem(PIN_RELOCK_REQUIRED_KEY, "1");
  } catch (_) {
    // noop
  }
}

export function clearPinRelockRequired() {
  try {
    sessionStorage.removeItem(PIN_RELOCK_REQUIRED_KEY);
  } catch (_) {
    // noop
  }
}

export function hasPinRelockRequired() {
  try {
    return sessionStorage.getItem(PIN_RELOCK_REQUIRED_KEY) === "1";
  } catch (_) {
    return false;
  }
}

// La app abre selectores nativos (cámara, galería) que esconden la pestaña
// por segundos u minutos legítimos, sin que el usuario haya "salido" de
// Klinip. Antes de abrir uno de esos selectores se llama a esta función para
// que el listener de re-bloqueo no confunda ese hand-off con un abandono
// real de la app. Se guarda en sessionStorage (no en memoria) porque en
// algunos navegadores móviles la pestaña puede recrearse durante ese lapso.
export function suppressNextPinRelock(ttlMs = 120000) {
  try {
    sessionStorage.setItem(PIN_SUPPRESS_RELOCK_UNTIL_KEY, String(Date.now() + ttlMs));
  } catch (_) {
    // noop
  }
}

export function isPinRelockSuppressed() {
  try {
    const raw = sessionStorage.getItem(PIN_SUPPRESS_RELOCK_UNTIL_KEY);
    if (!raw) return false;
    return Date.now() < Number(raw);
  } catch (_) {
    return false;
  }
}

export function clearPinRelockSuppression() {
  try {
    sessionStorage.removeItem(PIN_SUPPRESS_RELOCK_UNTIL_KEY);
  } catch (_) {
    // noop
  }
}
