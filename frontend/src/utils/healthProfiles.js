import { cleanUiText } from "./textEncoding";

function isOwnHealthProfile(item, user) {
  if (!item) return false;
  const currentUserId = Number(user?.id || 0);
  const ownerUserId = Number(item.owner_user_id || 0);
  if (currentUserId && ownerUserId) {
    return currentUserId === ownerUserId;
  }
  return String(item.relationship_type || "").trim().toLowerCase() === "self";
}

export function getHealthProfileRoleLabel(item, user) {
  if (!item) return "";
  if (isOwnHealthProfile(item, user)) return "Tu perfil";
  if (item.is_primary_profile) return "Titular";

  const role = String(item.access_role || "").trim().toLowerCase();
  if (role === "admin") return "Administrador";
  if (role === "caregiver") return "Editor";
  if (role === "viewer") return "Lector";
  return "Compartido";
}

export function getHealthProfileDisplayName(item, user) {
  if (!item) return "Perfil";

  const fullName = cleanUiText(item.full_name, "");
  const ownerName = cleanUiText(item.owner_name || item.owner_email, "");
  const accountName = cleanUiText(user?.name || user?.email, "");
  const sameAsAccount =
    fullName &&
    accountName &&
    fullName.localeCompare(accountName, undefined, { sensitivity: "accent" }) === 0;

  if (!isOwnHealthProfile(item, user) && ownerName && (item.is_primary_profile || !fullName || sameAsAccount)) {
    return ownerName;
  }

  return fullName || ownerName || "Perfil de salud";
}

export function getHealthProfileAccessLabel(item, user) {
  if (!item) return "";
  const roleLabel = getHealthProfileRoleLabel(item, user);
  if (roleLabel === "Tu perfil") return roleLabel;

  const ownerName = cleanUiText(item.owner_name || item.owner_email, "");
  return ownerName ? `${ownerName} · ${roleLabel}` : roleLabel;
}

export function getHealthProfileMenuLabel(item, user) {
  if (!item) return "Perfil";
  const displayName = getHealthProfileDisplayName(item, user);
  const accessLabel = getHealthProfileAccessLabel(item, user);
  return accessLabel ? `${displayName} (${accessLabel})` : displayName;
}
