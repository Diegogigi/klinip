const PIN_RECOVERY_LOGIN_KEY = "klinip_pin_recovery_login";

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
