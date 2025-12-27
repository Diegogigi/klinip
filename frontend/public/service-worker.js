const CACHE_NAME = "klinip-cache-v3";
const ASSETS = [
  "/manifest.webmanifest",
  "/icons/k_logo.png",
  "/sounds/notification.mp3"
];

// Almacenamiento de notificaciones programadas
const NOTIFICATIONS_STORE = "klinip-notifications";

self.addEventListener("install", (event) => {
  console.log("🔧 Service Worker instalando...");
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS).catch(err => {
        console.warn("Error cargando cache:", err);
        return Promise.resolve();
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("message", (event) => {
  console.log("📨 Mensaje recibido:", event.data);
  
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === "SCHEDULE_NOTIFICATION") {
    // Guardar notificación para mostrarla después
    scheduleNotification(event.data.notification);
  }
  
  if (event.data && event.data.type === "CHECK_PENDING_NOTIFICATIONS") {
    checkAndShowPendingNotifications();
  }
});

self.addEventListener("activate", (event) => {
  console.log("✅ Service Worker activado");
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null)))
      )
      .then(() => self.clients.claim())
      .then(() => checkAndShowPendingNotifications())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  
  // No cachear llamadas a la API
  if (event.request.url.includes("/api/") || 
      event.request.url.includes("/appointments") ||
      event.request.url.includes("/medications") ||
      event.request.url.includes("/documents")) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request).then(response => {
        return response || caches.match("/");
      }))
    );
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cachear respuestas exitosas
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      });
    })
  );
});

// Función para programar notificación
async function scheduleNotification(notification) {
  try {
    const db = await openNotificationsDB();
    const tx = db.transaction(NOTIFICATIONS_STORE, "readwrite");
    const store = tx.objectStore(NOTIFICATIONS_STORE);
    await store.add(notification);
    console.log("✅ Notificación guardada:", notification.title);
  } catch (err) {
    console.error("Error guardando notificación:", err);
  }
}

// Función para verificar y mostrar notificaciones pendientes
async function checkAndShowPendingNotifications() {
  try {
    const db = await openNotificationsDB();
    const tx = db.transaction(NOTIFICATIONS_STORE, "readonly");
    const store = tx.objectStore(NOTIFICATIONS_STORE);
    const notifications = await store.getAll();
    
    const now = Date.now();
    const toShow = notifications.filter(n => n.triggerAt <= now && n.triggerAt > now - 60000);
    
    for (const notification of toShow) {
      await self.registration.showNotification(notification.title, {
        body: notification.body,
        icon: notification.icon || "/icons/k_logo.png",
        badge: "/icons/k_logo.png",
        tag: notification.tag,
        data: notification.data || { url: notification.url || "/" },
        requireInteraction: true,
        vibrate: [200, 100, 200],
        actions: [
          { action: "open", title: "Ver detalles" },
          { action: "close", title: "Cerrar" }
        ]
      });
      
      // Eliminar notificación mostrada
      const deleteTx = db.transaction(NOTIFICATIONS_STORE, "readwrite");
      const deleteStore = deleteTx.objectStore(NOTIFICATIONS_STORE);
      await deleteStore.delete(notification.id);
    }
  } catch (err) {
    console.error("Error verificando notificaciones:", err);
  }
}

// Abrir base de datos IndexedDB para notificaciones
function openNotificationsDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("KlinipNotifications", 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(NOTIFICATIONS_STORE)) {
        const store = db.createObjectStore(NOTIFICATIONS_STORE, { keyPath: "id" });
        store.createIndex("triggerAt", "triggerAt", { unique: false });
      }
    };
  });
}

// Verificar notificaciones periódicamente
// DESACTIVADO: Verificación periódica puede causar notificaciones duplicadas
// Solo confiar en push notifications desde el servidor
// setInterval(() => {
//   checkAndShowPendingNotifications();
// }, 60000); // Cada minuto

// Sistema de deduplicación global para evitar notificaciones repetidas
const recentlyShownNotifications = new Map(); // tag -> timestamp
const DEDUP_WINDOW_MS = 60000; // 1 minuto - no mostrar la misma notificación dos veces en este período

function shouldShowNotification(tag) {
  if (!tag || tag.includes('notification-')) return true; // Tags genéricos siempre permitir
  
  const now = Date.now();
  const lastShown = recentlyShownNotifications.get(tag);
  
  if (lastShown && (now - lastShown) < DEDUP_WINDOW_MS) {
    console.log(`🚫 Notificación duplicada bloqueada: ${tag} (mostrada hace ${Math.round((now - lastShown) / 1000)}s)`);
    return false;
  }
  
  recentlyShownNotifications.set(tag, now);
  
  // Limpiar entradas antiguas (más de 5 minutos)
  for (const [key, time] of recentlyShownNotifications.entries()) {
    if (now - time > 5 * 60000) {
      recentlyShownNotifications.delete(key);
    }
  }
  
  return true;
}

self.addEventListener("push", (event) => {
  console.log("📥 Push notification received", event);

  const data = event.data ? event.data.json() : {};
  const title = data.title || "Klinip - Recordatorio";
  const body = data.body || "Tienes un recordatorio pendiente";
  const url = data.url || "/";
  const icon = data.icon || "/icons/k_logo.png";
  const priority = data.priority || "normal";
  const sound = data.sound || "default";
  
  // Generar tag único basado en el contenido para evitar duplicados
  const tag = data.tag || (data.appointmentId ? `appointment-${data.appointmentId}` : null) || (data.medicationId ? `medication-${data.medicationId}` : null) || `push-${Date.now()}`;

  // Verificar deduplicación
  if (!shouldShowNotification(tag)) {
    console.log("⏸️ Push duplicado ignorado");
    return; // No procesar notificación duplicada
  }

  // Configuración según prioridad
  let requireInteraction = true;
  let vibrate = [200, 100, 200];
  
  if (priority === "urgent") {
    vibrate = [300, 200, 300, 200, 300];
    requireInteraction = true;
  } else if (priority === "low") {
    vibrate = [100];
    requireInteraction = false;
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: "/icons/k_logo.png",
      vibrate,
      requireInteraction,
      tag,
      actions: [
        { action: "open", title: "Ver detalles", icon: "/icons/k_logo.png" },
        { action: "snooze", title: "Posponer 10 min", icon: "/icons/k_logo.png" },
        { action: "close", title: "Cerrar" }
      ],
      data: {
        url,
        timestamp: Date.now(),
        sound,
        priority,
        ...data
      },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  console.log("🔔 Notification clicked", event.action);

  const notificationData = event.notification.data || {};
  
  // Cerrar la notificación
  event.notification.close();

  // Manejar acción de cerrar
  if (event.action === "close") {
    return;
  }

  // Manejar acción de posponer
  if (event.action === "snooze") {
    event.waitUntil(
      (async () => {
        // Posponer 10 minutos
        const snoozeTime = Date.now() + 10 * 60 * 1000;
        
        await scheduleNotification({
          id: `snooze-${Date.now()}`,
          triggerAt: snoozeTime,
          title: event.notification.title,
          body: event.notification.body + " (Pospuesto)",
          icon: "/icons/k_logo.png",
          url: notificationData.url || "/",
          data: notificationData
        });
        
        console.log("⏰ Notificación pospuesta 10 minutos");
      })()
    );
    return;
  }

  // Manejar acción de abrir
  const targetUrl = notificationData.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Si hay una ventana abierta, enfócarla y navegar
        for (const client of clientList) {
          if ("focus" in client) {
            return client.focus().then(() => {
              if (client.navigate) {
                return client.navigate(targetUrl);
              }
            });
          }
        }
        // Si no hay ventana abierta, abrir una nueva
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
      .catch((err) => {
        console.error("Error abriendo ventana:", err);
      })
  );
});

self.addEventListener("notificationclose", (event) => {
  console.log("🔕 Notification closed", event);
  
  // Opcional: registrar estadísticas de notificaciones cerradas
  const data = event.notification.data || {};
  console.log("Notificación cerrada sin acción:", data);
});

// Soporte para Background Sync (sincronización en segundo plano)
self.addEventListener("sync", (event) => {
  console.log("🔄 Background sync:", event.tag);
  
  if (event.tag === "sync-notifications") {
    event.waitUntil(checkAndShowPendingNotifications());
  }
  
  if (event.tag === "sync-data") {
    event.waitUntil(syncOfflineData());
  }
});

// Función para sincronizar datos offline
async function syncOfflineData() {
  try {
    // Aquí se puede implementar lógica para sincronizar datos guardados offline
    console.log("📤 Sincronizando datos offline...");
    
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    
    // Sincronizar requests pendientes
    for (const request of requests) {
      if (request.method === "POST" || request.method === "PUT") {
        try {
          await fetch(request.clone());
          await cache.delete(request);
        } catch (err) {
          console.warn("No se pudo sincronizar:", request.url);
        }
      }
    }
    
    console.log("✅ Sincronización completada");
  } catch (err) {
    console.error("Error en sincronización:", err);
  }
}

// Periodicidad para verificar notificaciones
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "check-notifications") {
    event.waitUntil(checkAndShowPendingNotifications());
  }
});

console.log("🚀 Service Worker de Klinip cargado correctamente");
