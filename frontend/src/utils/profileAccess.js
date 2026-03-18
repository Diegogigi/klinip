export function normalizeProfileRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (!normalized) return "owner";
  if (normalized === "admin" || normalized === "administrador") return "admin";
  if (normalized === "caregiver" || normalized === "editor" || normalized === "cuidador") return "caregiver";
  if (normalized === "viewer" || normalized === "lector" || normalized === "visualizador") return "viewer";
  return normalized;
}

export function canWriteProfile(profile) {
  const role = normalizeProfileRole(profile?.access_role);
  return role === "owner" || role === "admin" || role === "caregiver";
}

export function isViewerProfile(profile) {
  return normalizeProfileRole(profile?.access_role) === "viewer";
}
