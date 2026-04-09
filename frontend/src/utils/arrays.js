/**
 * Garantiza que el valor sea un array. Si no lo es, devuelve [].
 * Uso: ensureArray(response.data) en lugar de Array.isArray(x) ? x : []
 */
export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}
