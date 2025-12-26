const CACHE_NAME = "klinip-cache-v2";
const ASSETS = ["/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener("push", (event) => {
  console.log("📥 Push notification received", event);

  const data = event.data ? event.data.json() : {};
  const title = data.title || "Klinip - Recordatorio";
  const body = data.body || "Tienes un recordatorio pendiente";
  const url = data.url || "/";
  const icon = data.icon || "/icons/k_logo.png";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: "/icons/k_logo.png",
      vibrate: [200, 100, 200],
      requireInteraction: true,
      actions: [
        { action: "open", title: "Ver detalles", icon: "/icons/k_logo.png" },
        { action: "close", title: "Cerrar" }
      ],
      data: {
        url,
        timestamp: Date.now(),
        ...data
      },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  console.log("🔔 Notification clicked", event.action);

  event.notification.close();

  if (event.action === "close") {
    return;
  }

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Si hay una ventana abierta, enfócarla y navegar
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Si no hay ventana abierta, abrir una nueva
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

self.addEventListener("notificationclose", (event) => {
  console.log("🔕 Notification closed", event);
});
