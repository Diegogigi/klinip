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
    if (import.meta.env.DEV) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)));
      if ("caches" in window) {
        const cacheKeys = await caches.keys().catch(() => []);
        await Promise.all(cacheKeys.map((key) => caches.delete(key).catch(() => false)));
      }
      return null;
    }

    const reg = await navigator.serviceWorker.register("/service-worker.js");
    reg.update().catch(() => null);

    let lastNotifiedUpdateKey = "";
    const notifyUpdate = (worker = null) => {
      const updateKey =
        worker?.scriptURL ||
        reg.waiting?.scriptURL ||
        reg.installing?.scriptURL ||
        reg.active?.scriptURL ||
        reg.scope ||
        "klinip-sw-update";
      if (lastNotifiedUpdateKey === updateKey) return;
      lastNotifiedUpdateKey = updateKey;
      window.dispatchEvent(
        new CustomEvent("klinip-sw-update", {
          detail: { registration: reg, updateKey },
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

    if (reg.waiting && navigator.serviceWorker.controller) {
      notifyUpdate(reg.waiting);
    }

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          notifyUpdate(newWorker);
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
  try {
    // 1. Verificar compatibilidad del navegador
    if (!("serviceWorker" in navigator)) {
      throw new Error("Tu navegador no soporta Service Workers");
    }
    
    if (!("PushManager" in window)) {
      throw new Error("Tu navegador no soporta notificaciones push");
    }
    
    // 2. Verificar HTTPS (requerido en móviles)
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      throw new Error("Las notificaciones push requieren HTTPS. Por favor accede usando https://");
    }
    
    // 3. Verificar clave VAPID
    if (!PUBLIC_VAPID_KEY || PUBLIC_VAPID_KEY.trim() === "") {
      throw new Error("Error de configuración: Falta la clave VAPID. Contacta al administrador.");
    }
    
    // 4. Solicitar permiso de notificaciones
    console.log("Solicitando permiso de notificaciones...");
  const permission = await Notification.requestPermission();
    console.log("Permiso obtenido:", permission);
    
    if (permission !== "granted") {
      throw new Error("Debes permitir las notificaciones en tu navegador");
    }
    
    // 5. Esperar a que el service worker esté listo
    console.log("Esperando service worker...");
  const reg = await navigator.serviceWorker.ready;
    console.log("Service worker listo");
    
    // 6. Cancelar cualquier suscripción anterior para evitar duplicados
    let existingSub = await reg.pushManager.getSubscription();
    if (existingSub) {
      try {
        console.log("Cancelando suscripción anterior...");
        await unsubscribePush({ endpoint: existingSub.endpoint });
        await existingSub.unsubscribe();
        console.log("Suscripción anterior cancelada");
      } catch (err) {
        console.warn("No se pudo cancelar suscripción anterior:", err);
      }
    }
    
    // 7. Crear nueva suscripción
    console.log("Creando nueva suscripción push...");
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
    });
    console.log("Suscripción creada:", sub.endpoint);
    
    // 8. Enviar suscripción al servidor
    console.log("Enviando suscripción al servidor...");
  await subscribePush({
    endpoint: sub.endpoint,
    keys: sub.toJSON().keys,
  });
    console.log("✅ Suscripción registrada en el servidor");
    
  return true;
  } catch (error) {
    console.error("❌ Error en ensurePushSubscription:", error);
    throw error; // Re-lanzar el error para que el componente lo maneje
  }
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
