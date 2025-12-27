import { subscribePush, unsubscribePush } from "./httpApi";

const PUBLIC_VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/service-worker.js");
    reg.update().catch(() => null);

    let hasRefreshed = false;
    const refreshOnUpdate = () => {
      if (hasRefreshed) return;
      hasRefreshed = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", refreshOnUpdate);

    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          newWorker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });

    return reg;
  } catch (err) {
    console.error("No se pudo registrar service worker", err);
    return null;
  }
}

export async function ensurePushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (!PUBLIC_VAPID_KEY) {
    console.warn("VITE_VAPID_PUBLIC_KEY no configurada; no se suscribe a push");
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  
  // Cancelar cualquier suscripción anterior para evitar duplicados
  let existingSub = await reg.pushManager.getSubscription();
  if (existingSub) {
    try {
      await existingSub.unsubscribe();
      console.log("Suscripción anterior cancelada para evitar duplicados");
    } catch (err) {
      console.warn("No se pudo cancelar suscripción anterior:", err);
    }
  }
  
  // Crear nueva suscripción
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
  });
  
  await subscribePush({
    endpoint: sub.endpoint,
    keys: sub.toJSON().keys,
  });
  return true;
}

export async function removePushSubscription() {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await unsubscribePush({ endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return true;
}
