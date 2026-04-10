export const MIN_PASSWORD_LENGTH = 6;

/**
 * Valida una contrasena y retorna un mensaje de error o null si es valida.
 */
export function validatePassword(password) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `La contrasena debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  return null;
}

/**
 * Valida que dos contrasenas coincidan.
 */
export function validatePasswordMatch(password, confirm) {
  if (password !== confirm) {
    return "Las contrasenas no coinciden.";
  }
  return null;
}
