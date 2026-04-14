const CACHE_NAME = "klinip-cache-v20";
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

function buildNetworkUnavailableResponse() {
  return new Response("Network unavailable", {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function ensureResponse(value) {
  return value instanceof Response ? value : buildNetworkUnavailableResponse();
}

function respondSafely(event, responseLike) {
  event.respondWith(
    Promise.resolve(responseLike)
      .then((value) => ensureResponse(value))
      .catch(() => buildNetworkUnavailableResponse())
  );
}

function fetchWithNetworkFallback(request, fallback = null) {
  return fetch(request).catch(async () => {
    if (!fallback) return buildNetworkUnavailableResponse();
    try {
      const fallbackResponse = await fallback();
      if (fallbackResponse instanceof Response) return fallbackResponse;
    } catch (_) {
      // Si el fallback falla o no devuelve una Response válida, devolver 503.
    }
    return buildNetworkUnavailableResponse();
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
      .then(() => clearAllScheduledNotifications())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (!["http:", "https:"].includes(requestUrl.protocol)) return;

  if (event.request.headers.get("authorization")) {
    respondSafely(event, fetchWithNetworkFallback(event.request));
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
    event.request.url.includes("/documents") ||
    event.request.url.includes("/voice")
  ) {
    respondSafely(event, fetchWithNetworkFallback(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    respondSafely(event, fetchWithNetworkFallback(event.request, offlineNavigationFallback));
    return;
  }

  respondSafely(
    event,
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetchWithNetworkFallback(event.request, () => caches.match(event.request)).then((response) => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return ensureResponse(response);
      });
    })
  );
});

async function scheduleNotification(notification) {
  try {
    const db = await openNotificationsDB();
    const tx = db.transaction(NOTIFICATIONS_STORE, "readwrite");
    const store = tx.objectStore(NOTIFICATIONS_STORE);
    await requestToPromise(store.put(notification));
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
    const existing = await requestToPromise(received.get(id));
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
    const baseCount = current && current.value ? current.value : 0;
    const nextCount = existing ? baseCount : baseCount + 1;
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

async function hasReceivedNotification(id, tag) {
  if (!id && !tag) return false;
  try {
    const db = await openNotificationsDB();
    const tx = db.transaction(RECEIVED_STORE, "readonly");
    const store = tx.objectStore(RECEIVED_STORE);
    const byId = id ? await requestToPromise(store.get(id)) : null;
    if (byId) return true;
    const allNotifications = await requestToPromise(store.getAll());
    return (allNotifications || []).some((item) => {
      if (!item) return false;
      if (id && item.id === id) return true;
      if (tag && item.tag === tag) return true;
      return false;
    });
  } catch (err) {
    console.warn("Unable to verify duplicated notification:", err);
    return false;
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
      const wasAlreadyReceived = await hasReceivedNotification(notification.id, notification.tag);
      if (wasAlreadyReceived) {
        const deleteTx = db.transaction(NOTIFICATIONS_STORE, "readwrite");
        const deleteStore = deleteTx.objectStore(NOTIFICATIONS_STORE);
        await requestToPromise(deleteStore.delete(notification.id));
        continue;
      }

      if (!shouldShowNotification(notification.tag)) {
        const deleteTx = db.transaction(NOTIFICATIONS_STORE, "readwrite");
        const deleteStore = deleteTx.objectStore(NOTIFICATIONS_STORE);
        await requestToPromise(deleteStore.delete(notification.id));
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
        data: {
          ...(notification.data || {}),
          url:
            (notification.data && notification.data.url) ||
            notification.url ||
            "/",
        },
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
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (_e) {
      // Malformed payload — still show a generic notification rather than silently failing
      data = { title: "Klinip - Recordatorio", body: event.data.text() || "" };
    }
  }
  const title = data.title || "Klinip - Recordatorio";
  const body = data.body || "Tienes un recordatorio pendiente";
  const url = data.url || "/";
  const icon = data.icon || "/icons/android-chrome-192x192.png";
  const priority = data.priority || "normal";
  const sound = data.sound || "default";

  const tag =
    data.tag ||
    (data.postId && data.kind === "feed" ? `feed-post-${data.postId}` : null) ||
    (data.appointmentId ? `appointment-${data.appointmentId}` : null) ||
    (data.medicationId ? `medication-${data.medicationId}` : null) ||
    `push-${Date.now()}`;

  let requireInteraction = true;
  let vibrate = [200, 100, 200];

  if (priority === "urgent") {
    vibrate = [300, 200, 300, 200, 300];
    requireInteraction = true;
  } else if (priority === "low") {
    vibrate = [100];
    requireInteraction = false;
  }

  const notificationOptions = {
    body,
    icon,
    badge: "/icons/android-chrome-192x192.png",
    vibrate,
    requireInteraction,
    silent: false,
    tag,
    actions: data.kind === "feed"
      ? [{ action: "open", title: "Ver en el feed", icon: "/icons/android-chrome-192x192.png" }]
      : data.kind === "note"
      ? [{ action: "open", title: "Ver nota", icon: "/icons/android-chrome-192x192.png" }]
      : [
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
  };

  // CRITICAL: siempre llamar event.waitUntil con showNotification.
  // Chrome revoca permisos push si un push event no muestra notificación.
  // showNotification va PRIMERO e independiente de recordReceivedNotification.
  event.waitUntil((async () => {
    const wasAlreadyReceived = await hasReceivedNotification(tag, tag);
    if (wasAlreadyReceived || !shouldShowNotification(tag)) {
      return;
    }

    await self.registration.showNotification(title, notificationOptions)
      .catch((err) => {
        console.error("ERROR showNotification:", err);
      });

    await recordReceivedNotification({
      id: tag,
      title,
      body,
      url,
      tag,
      timestamp: Date.now(),
      source: "push",
      userId: data.userId || null
    }).catch((err) => {
      console.error("ERROR recordReceivedNotification:", err);
    });
  })());
});

function toAbsoluteAppUrl(url) {
  const raw = String(url || "/").trim();
  if (!raw) {
    return `${self.location.origin}/#/`;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (raw.startsWith("/#")) {
    return `${self.location.origin}${raw}`;
  }
  if (raw.startsWith("/")) {
    return `${self.location.origin}/#${raw}`;
  }
  if (raw.startsWith("#")) {
    return `${self.location.origin}/${raw}`;
  }
  return `${self.location.origin}/#/${raw}`;
}

async function openNotificationTarget(targetUrl) {
  const absoluteTargetUrl = toAbsoluteAppUrl(targetUrl);
  const clientList = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const exactClient = clientList.find((client) => client.url === absoluteTargetUrl);

  if (exactClient && "focus" in exactClient) {
    return exactClient.focus();
  }

  if (clients.openWindow) {
    const openedClient = await clients.openWindow(absoluteTargetUrl);
    if (openedClient && "focus" in openedClient) {
      return openedClient.focus();
    }
    return openedClient;
  }

  for (const client of clientList) {
    if ("focus" in client) {
      await client.focus();
      if (client.navigate) {
        return client.navigate(absoluteTargetUrl);
      }
      return client;
    }
  }

  return null;
}

self.addEventListener("notificationclick", (event) => {
  const notificationData = event.notification.data || {};
  event.notification.close();

  if (event.action === "close") {
    return;
  }

  if (event.action === "done") {
    const appointmentId = notificationData.appointmentId;
    const medicationId = notificationData.medicationId;
    const targetUrl =
      appointmentId
        ? `/appointments?complete=${appointmentId}`
        : medicationId
        ? `/medications?intake=${medicationId}`
        : notificationData.url || "/";
    event.waitUntil(openNotificationTarget(targetUrl));
    return;
  }

  const isDefaultClick = !event.action;
  let targetUrl = notificationData.url || "/";

  if (isDefaultClick || event.action === "open") {
    if (!notificationData.url && notificationData.appointmentId) {
      targetUrl = `/appointments?notify=1&appointmentId=${notificationData.appointmentId}`;
    } else if (!notificationData.url && notificationData.medicationId) {
      targetUrl = `/medications?notify=1&medicationId=${notificationData.medicationId}`;
    } else if (!notificationData.url && notificationData.kind === "note") {
      targetUrl = "/";
    }
  }

  event.waitUntil(openNotificationTarget(targetUrl));
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
