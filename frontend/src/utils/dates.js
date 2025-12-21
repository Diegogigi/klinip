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
    const normalized = trimmed.replace(" ", "T");
    const fromNormalized = new Date(normalized);
    if (!Number.isNaN(fromNormalized.getTime())) return fromNormalized;
    const fallback = new Date(trimmed);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return null;
}

export function toIsoOrNull(value) {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

export function toLocaleDateOrEmpty(value) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString() : "";
}

export function toLocaleDateTimeOrEmpty(value) {
  const date = parseDate(value);
  return date ? date.toLocaleString() : "";
}
