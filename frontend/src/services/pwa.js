import { subscribePush, unsubscribePush } from "./httpApi";

const PUBLIC_VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";
const SERVICE_WORKER_URL = "/service-worker.js";
const APP_SHELL_VERSION = "20260522-bootfix-1";
const APP_SHELL_VERSION_KEY = "klinip-app-shell-version";
let pendingPushSubscriptionPromise = null;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isStandaloneDisplayMode() {
  const mediaStandalone =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const navigatorStandalone =
    typeof navigator !== "undefined" &&
    Object.prototype.hasOwnProperty.call(navigator, "standalone") &&
    navigator.standalone === true;
  return Boolean(mediaStandalone || navigatorStandalone);
}

async function getExistingServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;

  let registration = await navigator.serviceWorker
    .getRegistration(SERVICE_WORKER_URL)
    .catch(() => null);

  if (!registration) {
    registration = await navigator.serviceWorker.getRegistration().catch(() => null);
  }

  return registration;
}

export function getPushSupportStatus() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      supported: false,
      reason: "No se pudo verificar el soporte de notificaciones push.",
    };
  }

  if (!("Notification" in window)) {
    return {
      supported: false,
      reason: "Este navegador no soporta notificaciones del sistema.",
    };
  }

  if (!("serviceWorker" in navigator)) {
    return {
      supported: false,
      reason: "Este navegador no soporta Service Worker.",
    };
  }

  if (!("PushManager" in window)) {
    return {
      supported: false,
      reason: "Este navegador no soporta notificaciones push.",
    };
  }

  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    return {
      supported: false,
      reason: "Las notificaciones push requieren HTTPS.",
    };
  }

  const userAgent = navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(userAgent);
  if (isIOS && !isStandaloneDisplayMode()) {
    return {
      supported: false,
      reason:
        "En iPhone y iPad las notificaciones push funcionan solo si Klinip est\u00e1 instalada en la pantalla de inicio.",
    };
  }

  if (!PUBLIC_VAPID_KEY.trim()) {
    return {
      supported: false,
      reason: "Falta la clave VAPID p\u00fablica. Revisa la configuraci\u00f3n del despliegue.",
    };
  }

  return { supported: true, reason: "" };
}

let _swRegistrationPromise = null;

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  // Singleton: los listeners de update solo se crean una vez por sesión de página
  if (_swRegistrationPromise) return _swRegistrationPromise;
  _swRegistrationPromise = _doRegisterServiceWorker();
  return _swRegistrationPromise;
}

async function resetStaleAppShellIfNeeded() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }

  const storedVersion = localStorage.getItem(APP_SHELL_VERSION_KEY) || "";
  if (storedVersion === APP_SHELL_VERSION) {
    return false;
  }

  const refreshGuardKey = `klinip-app-shell-refresh-${APP_SHELL_VERSION}`;
  if (sessionStorage.getItem(refreshGuardKey) === "done") {
    localStorage.setItem(APP_SHELL_VERSION_KEY, APP_SHELL_VERSION);
    return false;
  }

  sessionStorage.setItem(refreshGuardKey, "done");
  localStorage.setItem(APP_SHELL_VERSION_KEY, APP_SHELL_VERSION);

  try {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)));

    if ("caches" in window) {
      const cacheKeys = await caches.keys().catch(() => []);
      await Promise.all(
        cacheKeys
          .filter((key) => String(key || "").startsWith("klinip-cache"))
          .map((key) => caches.delete(key).catch(() => false))
      );
    }
  } catch (error) {
    console.warn("No se pudo limpiar la shell instalada de Klinip.", error);
  }

  window.location.reload();
  return true;
}

async function _doRegisterServiceWorker() {
  try {
    if (import.meta.env.DEV) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)));
      if ("caches" in window) {
        const cacheKeys = await caches.keys().catch(() => []);
        await Promise.all(cacheKeys.map((key) => caches.delete(key).catch(() => false)));
      }
      return null;
    }

    const refreshTriggered = await resetStaleAppShellIfNeeded();
    if (refreshTriggered) {
      return null;
    }

    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    registration.update().catch(() => null);

    let lastNotifiedUpdateKey = "";
    const notifyUpdate = (worker = null) => {
      const updateKey =
        worker?.scriptURL ||
        registration.waiting?.scriptURL ||
        registration.installing?.scriptURL ||
        registration.active?.scriptURL ||
        registration.scope ||
        "klinip-sw-update";

      if (lastNotifiedUpdateKey === updateKey) return;
      lastNotifiedUpdateKey = updateKey;

      window.dispatchEvent(
        new CustomEvent("klinip-sw-update", {
          detail: { registration, updateKey },
        })
      );
    };

    let hasRefreshed = false;
    const refreshOnUpdate = () => {
      if (hasRefreshed) return;
      hasRefreshed = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", refreshOnUpdate);

    if (registration.waiting && navigator.serviceWorker.controller) {
      notifyUpdate(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          notifyUpdate(newWorker);
        }
      });
    });

    return registration;
  } catch (error) {
    console.error("No se pudo registrar el service worker.", error);
    return null;
  }
}

async function ensureServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Este navegador no soporta Service Worker.");
  }

  let registration = await getExistingServiceWorkerRegistration();
  if (!registration) {
    registration = await registerServiceWorker();
  }

  if (!registration) {
    throw new Error("No se pudo registrar el service worker de Klinip.");
  }

  await registration.update().catch(() => null);

  const readyRegistration = await navigator.serviceWorker.ready.catch(() => null);
  return readyRegistration || registration;
}

export async function getCurrentPushSubscription(options = {}) {
  const { registerIfMissing = false } = options;
  const support = getPushSupportStatus();

  if (!support.supported) {
    return {
      ...support,
      registration: null,
      subscription: null,
      browserHasSubscription: false,
    };
  }

  const registration = registerIfMissing
    ? await ensureServiceWorkerRegistration()
    : await getExistingServiceWorkerRegistration();

  if (!registration) {
    return {
      ...support,
      registration: null,
      subscription: null,
      browserHasSubscription: false,
    };
  }

  const subscription = await registration.pushManager.getSubscription().catch(() => null);

  return {
    ...support,
    registration,
    subscription,
    browserHasSubscription: Boolean(subscription?.endpoint),
  };
}

async function syncSubscriptionWithServer(subscription) {
  const rawSubscription = subscription?.toJSON?.() || {};
  const keys = rawSubscription.keys || {};

  if (!subscription?.endpoint || !keys.p256dh || !keys.auth) {
    throw new Error("La suscripci\u00f3n push del navegador es inv\u00e1lida.");
  }

  try {
    await subscribePush({
      endpoint: subscription.endpoint,
      keys,
    });
  } catch (err) {
    // The browser subscription exists — a transient network error should not
    // block the user.  The next visit will retry via ensurePushSubscription.
    console.warn("Push: no se pudo sincronizar la suscripci\u00f3n con el servidor:", err?.message || err);
  }
}

export async function ensurePushSubscription() {
  if (pendingPushSubscriptionPromise) {
    return pendingPushSubscriptionPromise;
  }

  pendingPushSubscriptionPromise = (async () => {
    const support = getPushSupportStatus();
    if (!support.supported) {
      throw new Error(support.reason);
    }

    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();

    if (permission !== "granted") {
      throw new Error("Debes permitir las notificaciones en tu navegador.");
    }

    const { registration } = await getCurrentPushSubscription({ registerIfMissing: true });
    if (!registration) {
      throw new Error("No se pudo preparar el service worker para notificaciones.");
    }

    let subscription = await registration.pushManager.getSubscription();
    if (subscription?.endpoint) {
      await syncSubscriptionWithServer(subscription);
      return true;
    }

    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
    });

    await syncSubscriptionWithServer(subscription);
    return true;
  })();

  try {
    return await pendingPushSubscriptionPromise;
  } finally {
    pendingPushSubscriptionPromise = null;
  }
}

export async function removePushSubscription() {
  const { registration } = await getCurrentPushSubscription();
  if (!registration) return false;

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  try {
    await unsubscribePush({ endpoint: subscription.endpoint });
  } catch (error) {
    if (error?.response?.status !== 401) {
      console.warn("No se pudo desregistrar la suscripci\u00f3n push en backend.", error);
    }
  }

  await subscription.unsubscribe().catch(() => false);
  return true;
}
