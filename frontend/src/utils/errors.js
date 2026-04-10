/**
 * Extrae un mensaje de error legible desde una respuesta de API o excepcion.
 */
export function extractApiError(err, fallback = "Ocurrio un error inesperado.") {
  if (!err) return fallback;
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (typeof err?.message === "string" && err.message) return err.message;
  return fallback;
}
