const PIN_RECOVERY_LOGIN_KEY = "klinip_pin_recovery_login";
const PIN_RELOCK_REQUIRED_KEY = "klinip_pin_relock_required";
const PIN_RECENT_PASSWORD_LOGIN_KEY = "klinip_pin_recent_password_login";

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
