const CLINICAL_REFRESH_EVENT = "klinip-clinical-data-changed";
const CLINICAL_REFRESH_STORAGE_KEY = "klinip:clinical-refresh";

function normalizePayload(detail = {}) {
  return {
    at: Date.now(),
    profileId: detail?.profileId ? Number(detail.profileId) : null,
    sources: Array.isArray(detail?.sources) ? detail.sources.filter(Boolean) : [],
  };
}

export function notifyClinicalDataChanged(detail = {}) {
  const payload = normalizePayload(detail);
  if (typeof window === "undefined") {
    return payload;
  }
  try {
    window.localStorage.setItem(CLINICAL_REFRESH_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
  window.dispatchEvent(new CustomEvent(CLINICAL_REFRESH_EVENT, { detail: payload }));
  return payload;
}

export function subscribeClinicalDataChanged(handler) {
  if (typeof window === "undefined" || typeof handler !== "function") {
    return () => {};
  }

  const handleCustomEvent = (event) => {
    handler(normalizePayload(event?.detail || {}));
  };

  const handleStorageEvent = (event) => {
    if (event.key !== CLINICAL_REFRESH_STORAGE_KEY || !event.newValue) {
      return;
    }
    try {
      handler(normalizePayload(JSON.parse(event.newValue)));
    } catch {
      handler(normalizePayload({}));
    }
  };

  window.addEventListener(CLINICAL_REFRESH_EVENT, handleCustomEvent);
  window.addEventListener("storage", handleStorageEvent);

  return () => {
    window.removeEventListener(CLINICAL_REFRESH_EVENT, handleCustomEvent);
    window.removeEventListener("storage", handleStorageEvent);
  };
}
