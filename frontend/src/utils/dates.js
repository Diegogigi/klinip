export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    
    // Si el string tiene formato ISO sin zona horaria (como el que enviamos al backend),
    // lo parseamos como hora local añadiendo manualmente los componentes
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (isoMatch) {
      const [, year, month, day, hours, minutes, seconds] = isoMatch;
      // Crear la fecha en hora local
      const date = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes),
        parseInt(seconds)
      );
      return Number.isNaN(date.getTime()) ? null : date;
    }
    
    const normalized = trimmed.replace(" ", "T");
    const fromNormalized = new Date(normalized);
    if (!Number.isNaN(fromNormalized.getTime())) return fromNormalized;
    const fallback = new Date(trimmed);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return null;
}

export function toIsoOrNull(value) {
  if (!value) return null;
  
  // Si ya es un string en formato datetime-local (YYYY-MM-DDTHH:mm), 
  // simplemente agregamos los segundos para hacerlo ISO compatible
  // sin convertir a UTC
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.trim())) {
    return value.trim() + ":00";
  }
  
  // Para otros formatos, parseamos y formateamos en hora local
  const date = parseDate(value);
  if (!date) return null;
  
  // Formatear la fecha en hora local sin conversión a UTC
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

export function toLocaleDateOrEmpty(value) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString() : "";
}

export function toLocaleDateTimeOrEmpty(value) {
  const date = parseDate(value);
  return date ? date.toLocaleString() : "";
}
