// Bloqueo de la app con PIN de 4 dígitos.
//
// El PIN ahora vive en el backend (asociado a la cuenta), por lo que es el
// mismo en todos los dispositivos. Aquí sólo manejamos una marca de sesión:
// cuando el usuario inicia sesión con su contraseña, esa sesión queda
// "desbloqueada" (no le pedimos el PIN inmediatamente, porque ya se autenticó).
// Esto también sirve de recuperación: si olvidó el PIN, cierra sesión, vuelve
// a entrar con su contraseña y puede cambiarlo desde Ajustes.

const FRESH_LOGIN_KEY = "klinip_pin_fresh_login";

export function markPinFreshLogin() {
  try {
    sessionStorage.setItem(FRESH_LOGIN_KEY, "1");
  } catch (_) {
    // noop
  }
}

export function consumePinFreshLogin() {
  try {
    const value = sessionStorage.getItem(FRESH_LOGIN_KEY) === "1";
    sessionStorage.removeItem(FRESH_LOGIN_KEY);
    return value;
  } catch (_) {
    return false;
  }
}
