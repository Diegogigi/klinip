const CACHE_NAME = "klinip-cache-v14";
const ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icons/apple-touch-icon.png",
  "/icons/android-chrome-192x192.png",
  "/icons/android-chrome-512x512.png",
  "/icons/favicon-16x16.png",
  "/icons/favicon-32x32.png",
  "/icons/favicon.ico",
  "/sounds/notification.mp3"
];

const NOTIFICATIONS_STORE = "klinip-notifications";
const RECEIVED_STORE = "klinip-received-notifications";
const BADGE_STORE = "klinip-badge";

function fetchWithNetworkFallback(request, fallback = null) {
  return fetch(request).catch(() => {
    if (fallback) return fallback();
    return Response.error();
  });
}

function offlineNavigationFallback() {
  return caches.match("/").then((response) => {
    if (response) return response;
    return new Response("Sin conexion disponible.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS).catch(() => Promise.resolve()))
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (data.type === "SCHEDULE_NOTIFICATION") {
    scheduleNotification(data.notification);
  }

  if (data.type === "CLEAR_SCHEDULED_NOTIFICATIONS") {
    clearAllScheduledNotifications();
  }

  if (data.type === "REMOVE_SCHEDULED_NOTIFICATION") {
    removeScheduledNotification(data.id);
  }

  if (data.type === "RECORD_NOTIFICATION") {
    recordReceivedNotification(data.notification);
  }

  if (data.type === "GET_RECEIVED_NOTIFICATIONS") {
    sendReceivedNotifications();
  }

  if (data.type === "CLEAR_RECEIVED_NOTIFICATIONS") {
    clearReceivedNotifications();
  }

  if (data.type === "REMOVE_RECEIVED_NOTIFICATIONS") {
    removeReceivedNotifications(data.ids || []);
  }

  if (data.type === "CHECK_PENDING_NOTIFICATIONS") {
    checkAndShowPendingNotifications();
  }
});

self.addEventListener("activate", (event) => {
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

  if (event.request.headers.get("authorization")) {
    event.respondWith(fetchWithNetworkFallback(event.request));
    return;
  }

  if (
    event.request.url.includes("/auth/") ||
    event.request.url.includes("/me") ||
    event.request.url.includes("/privacy/") ||
    event.request.url.includes("/push/") ||
    event.request.url.includes("/api/") ||
    event.request.url.includes("/ai/") ||
    event.request.url.includes("/health-profiles") ||
    event.request.url.includes("/plans/me") ||
    event.request.url.includes("/appointments") ||
    event.request.url.includes("/medications") ||
    event.request.url.includes("/documents")
  ) {
    event.respondWith(fetchWithNetworkFallback(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetchWithNetworkFallback(event.request, offlineNavigationFallback)
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetchWithNetworkFallback(event.request, () => caches.match(event.request)).then((response) => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      });
    })
  );
});

async function scheduleNotification(notification) {
  try {
    const db = await openNotificationsDB();
    const tx = db.transaction(NOTIFICATIONS_STORE, "readwrite");
    const store = tx.objectStore(NOTIFICATIONS_STORE);
    await requestToPromise(store.add(notification));
  } catch (err) {
    console.error("Error saving scheduled notification:", err);
  }
}

async function recordReceivedNotification(notification) {
  if (!notification) return;
  try {
    const userId = notification.userId || (notification.data && notification.data.userId) || null;
    const db = await openNotificationsDB();
    const tx = db.transaction([RECEIVED_STORE, BADGE_STORE], "readwrite");
    const received = tx.objectStore(RECEIVED_STORE);
    const badge = tx.objectStore(BADGE_STORE);
    const id = notification.id || notification.tag || `received-${Date.now()}-${Math.random()}`;
    await requestToPromise(received.put({
      id,
      title: notification.title,
      body: notification.body,
      url: notification.url || "/",
      tag: notification.tag || "",
      timestamp: notification.timestamp || Date.now(),
      source: notification.source || "system",
      userId
    }));
    const current = await requestToPromise(badge.get("count"));
    const nextCount = (current && current.value ? current.value : 0) + 1;
    await requestToPromise(badge.put({ key: "count", value: nextCount }));
    await updateAppBadge(nextCount);
    await broadcastMessage({
      type: "NOTIFICATION_RECORDED",
      notification: {
        id,
        title: notification.title,
        body: notification.body,
        url: notification.url || "/",
        tag: notification.tag || "",
        timestamp: notification.timestamp || Date.now(),
        source: notification.source || "system",
        userId
      }
    });
  } catch (err) {
    console.error("Error recording notification:", err);
  }
}

async function sendReceivedNotifications() {
  try {
    const db = await openNotificationsDB();
    const tx = db.transaction(RECEIVED_STORE, "readonly");
    const store = tx.objectStore(RECEIVED_STORE);
    const notifications = await requestToPromise(store.getAll());
    await broadcastMessage({ type: "RECEIVED_NOTIFICATIONS", notifications });
  } catch (err) {
    console.error("Error loading notifications:", err);
  }
}

async function clearReceivedNotifications() {
  try {
    const db = await openNotificationsDB();
    const tx = db.transaction([RECEIVED_STORE, BADGE_STORE], "readwrite");
    await requestToPromise(tx.objectStore(RECEIVED_STORE).clear());
    await requestToPromise(tx.objectStore(BADGE_STORE).put({ key: "count", value: 0 }));
    await updateAppBadge(0);
    await broadcastMessage({ type: "RECEIVED_NOTIFICATIONS", notifications: [] });
  } catch (err) {
    console.error("Error clearing notifications:", err);
  }
}

async function removeReceivedNotifications(ids) {
  if (!ids || !ids.length) return;
  try {
    const db = await openNotificationsDB();
    const tx = db.transaction([RECEIVED_STORE, BADGE_STORE], "readwrite");
    const received = tx.objectStore(RECEIVED_STORE);
    for (const id of ids) {
      await requestToPromise(received.delete(id));
    }
    const remaining = await requestToPromise(received.getAll());
    const nextCount = Array.isArray(remaining) ? remaining.length : 0;
    await requestToPromise(tx.objectStore(BADGE_STORE).put({ key: "count", value: nextCount }));
    await updateAppBadge(nextCount);
    await broadcastMessage({ type: "RECEIVED_NOTIFICATIONS", notifications: remaining || [] });
  } catch (err) {
    console.error("Error removing notifications:", err);
  }
}

async function updateAppBadge(count) {
  try {
    if (self.registration && typeof self.registration.setAppBadge === "function") {
      if (count > 0) {
        await self.registration.setAppBadge(count);
      } else if (typeof self.registration.clearAppBadge === "function") {
        await self.registration.clearAppBadge();
      }
    }
  } catch (err) {
    console.warn("Unable to update app badge:", err);
  }
}

async function broadcastMessage(message) {
  const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clientList.forEach((client) => client.postMessage(message));
}

async function checkAndShowPendingNotifications() {
  try {
    const db = await openNotificationsDB();
    const tx = db.transaction(NOTIFICATIONS_STORE, "readonly");
    const store = tx.objectStore(NOTIFICATIONS_STORE);
    const notifications = await requestToPromise(store.getAll());

    const now = Date.now();
    const toShow = notifications.filter(
      (n) => n.triggerAt <= now && n.triggerAt > now - 60000
    );

    for (const notification of toShow) {
      if (!shouldShowNotification(notification.tag)) {
        continue;
      }

      await recordReceivedNotification({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        url: notification.url || "/",
        tag: notification.tag,
        timestamp: Date.now(),
        source: "scheduled",
        userId: notification.userId || (notification.data && notification.data.userId) || null
      });

      const actions =
        notification.actions ||
        (notification.data && notification.data.type === "appointment"
          ? [
              { action: "done", title: "Realizada" },
              { action: "open", title: "Ver detalles" }
            ]
          : notification.data && notification.data.type === "medication"
          ? [
              { action: "done", title: "Realizado" },
              { action: "open", title: "Ver detalles" }
            ]
          : [{ action: "open", title: "Ver detalles" }]);

      await self.registration.showNotification(notification.title, {
        body: notification.body,
        icon: notification.icon || "/icons/android-chrome-192x192.png",
        badge: "/icons/android-chrome-192x192.png",
        tag: notification.tag,
        data: notification.data || { url: notification.url || "/" },
        requireInteraction: true,
        vibrate: [200, 100, 200],
        actions
      });

      const deleteTx = db.transaction(NOTIFICATIONS_STORE, "readwrite");
      const deleteStore = deleteTx.objectStore(NOTIFICATIONS_STORE);
      await requestToPromise(deleteStore.delete(notification.id));
    }
  } catch (err) {
    console.error("Error checking pending notifications:", err);
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openNotificationsDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("KlinipNotifications", 2);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(NOTIFICATIONS_STORE)) {
        const store = db.createObjectStore(NOTIFICATIONS_STORE, { keyPath: "id" });
        store.createIndex("triggerAt", "triggerAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(RECEIVED_STORE)) {
        const store = db.createObjectStore(RECEIVED_STORE, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
      if (!db.objectStoreNames.contains(BADGE_STORE)) {
        db.createObjectStore(BADGE_STORE, { keyPath: "key" });
      }
    };
  });
}

async function clearAllScheduledNotifications() {
  try {
    const db = await openNotificationsDB();
    const tx = db.transaction(NOTIFICATIONS_STORE, "readwrite");
    const store = tx.objectStore(NOTIFICATIONS_STORE);
    await requestToPromise(store.clear());
  } catch (err) {
    console.error("Error clearing scheduled notifications:", err);
  }
}

async function removeScheduledNotification(id) {
  try {
    const db = await openNotificationsDB();
    const tx = db.transaction(NOTIFICATIONS_STORE, "readwrite");
    const store = tx.objectStore(NOTIFICATIONS_STORE);
    await requestToPromise(store.delete(id));
  } catch (err) {
    console.error("Error removing scheduled notification:", err);
  }
}

setInterval(() => {
  checkAndShowPendingNotifications();
}, 60000);

checkAndShowPendingNotifications();

const recentlyShownNotifications = new Map();
const DEDUP_WINDOW_MS = 60000;

function shouldShowNotification(tag) {
  if (!tag || tag.includes("notification-")) return true;

  const now = Date.now();
  const lastShown = recentlyShownNotifications.get(tag);

  if (lastShown && now - lastShown < DEDUP_WINDOW_MS) {
    return false;
  }

  recentlyShownNotifications.set(tag, now);

  for (const [key, time] of recentlyShownNotifications.entries()) {
    if (now - time > 5 * 60000) {
      recentlyShownNotifications.delete(key);
    }
  }

  return true;
}

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Klinip - Recordatorio";
  const body = data.body || "Tienes un recordatorio pendiente";
  const url = data.url || "/";
  const icon = data.icon || "/icons/android-chrome-192x192.png";
  const priority = data.priority || "normal";
  const sound = data.sound || "default";

  const tag =
    data.tag ||
    (data.appointmentId ? `appointment-${data.appointmentId}` : null) ||
    (data.medicationId ? `medication-${data.medicationId}` : null) ||
    `push-${Date.now()}`;

  if (!shouldShowNotification(tag)) {
    return;
  }

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
    Promise.all([
      recordReceivedNotification({
        id: tag,
        title,
        body,
        url,
        tag,
        timestamp: Date.now(),
        source: "push",
        userId: data.userId || null
      }),
      self.registration.showNotification(title, {
        body,
        icon,
        badge: "/icons/android-chrome-192x192.png",
        vibrate,
        requireInteraction,
        tag,
        actions: [
          {
            action: "done",
            title: data.medicationId ? "Realizado" : "Realizada",
            icon: "/icons/android-chrome-192x192.png"
          },
          { action: "open", title: "Ver detalles", icon: "/icons/android-chrome-192x192.png" }
        ],
        data: {
          url,
          timestamp: Date.now(),
          sound,
          priority,
          ...data
        }
      })
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  const notificationData = event.notification.data || {};
  event.notification.close();
  const normalizeUrl = (url) => {
    if (!url) return "/#/";
    if (url.startsWith("/#")) return url;
    if (url.startsWith("/")) return `/#${url}`;
    return `/#/${url}`;
  };

  if (event.action === "close") {
    return;
  }

  if (event.action === "done") {
    const appointmentId = notificationData.appointmentId;
    const medicationId = notificationData.medicationId;
    const targetUrl = normalizeUrl(
      appointmentId
        ? `/appointments?complete=${appointmentId}`
        : medicationId
        ? `/medications?intake=${medicationId}`
        : notificationData.url || "/"
    );
    event.waitUntil(
      clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            if ("focus" in client) {
              return client.focus().then(() => {
                if (client.navigate) {
                  return client.navigate(targetUrl);
                }
              });
            }
          }
          if (clients.openWindow) {
            return clients.openWindow(targetUrl);
          }
        })
    );
    return;
  }

  const isDefaultClick = !event.action;
  let targetUrl = notificationData.url || "/";

  if (isDefaultClick) {
    if (notificationData.appointmentId) {
      targetUrl = `/appointments?notify=1&appointmentId=${notificationData.appointmentId}`;
    } else if (notificationData.medicationId) {
      targetUrl = `/medications?notify=1&medicationId=${notificationData.medicationId}`;
    }
  }
  targetUrl = normalizeUrl(targetUrl);

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            return client.focus().then(() => {
              if (client.navigate) {
                return client.navigate(targetUrl);
              }
            });
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

self.addEventListener("notificationclose", () => {});

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-notifications") {
    event.waitUntil(checkAndShowPendingNotifications());
  }

  if (event.tag === "sync-data") {
    event.waitUntil(syncOfflineData());
  }
});

async function syncOfflineData() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();

    for (const request of requests) {
      if (request.method === "POST" || request.method === "PUT") {
        try {
          await fetch(request.clone());
          await cache.delete(request);
        } catch (err) {
          console.warn("Unable to sync request:", request.url);
        }
      }
    }
  } catch (err) {
    console.error("Error in offline sync:", err);
  }
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "check-notifications") {
    event.waitUntil(checkAndShowPendingNotifications());
  }
});
