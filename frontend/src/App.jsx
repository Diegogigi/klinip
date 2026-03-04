import React, { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation, Link, useNavigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Appointments from "./pages/Appointments";
import Calendar from "./pages/Calendar";
import Medications from "./pages/Medications";
import Documents from "./pages/Documents";
import Settings from "./pages/Settings";
import Timeline from "./pages/Timeline";
import Stats from "./pages/Stats";
import Landing from "./pages/Landing";
import LegalPrivacy from "./pages/LegalPrivacy";
import LegalTerms from "./pages/LegalTerms";
import LegalConsent from "./pages/LegalConsent";
import LegalNotifications from "./pages/LegalNotifications";
import { getMe, getMedications, updateMe, logout as apiLogout } from "./api";
import { registerServiceWorker, ensurePushSubscription, removePushSubscription } from "./services/pwa";

const icons = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 10.5 12 4l8 6.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M10 20v-6h4v6" />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 3.5h7l3 3.5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" />
      <path d="M14 3.5v4h3" />
      <path d="M9 12h6M9 15h6M9 9h2" />
    </svg>
  ),
  heart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <g transform="rotate(-35 12 12)">
        <rect x="5" y="8" width="14" height="8" rx="4" fill="#ffffff" stroke="currentColor" />
        <path
          d="M5 12a4 4 0 0 1 4-4h3v8H9a4 4 0 0 1-4-4z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M12 8v8" />
      </g>
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 6v12M9.5 10v8M14 7v11M18.5 12v6" />
    </svg>
  ),
  extras: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 14h3l2-4 2 8 2-5h3" />
      <circle cx="6" cy="14" r="1" />
      <circle cx="13" cy="10" r="1" />
      <circle cx="15" cy="18" r="1" />
      <circle cx="19" cy="13" r="1" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19.5a6 6 0 0 1 12 0" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <path d="M9 3v3M15 3v3M4 10h16" />
    </svg>
  ),
  appointment: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
    </svg>
  ),
  timeline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 4v16M18 4v16" />
      <circle cx="6" cy="8" r="1.8" />
      <circle cx="18" cy="12" r="1.8" />
      <circle cx="6" cy="16" r="1.8" />
    </svg>
  ),
};

function Sidebar({ user, theme, onToggleTheme, notifications }) {
  const location = useLocation();
  const isPublicAuthRoute =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/reset-password";
  const isAuthRoute =
    isPublicAuthRoute ||
    (!user && location.pathname === "/");
  const [expanded, setExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const notificationCounts = (notifications || []).reduce((acc, item) => {
    const path = getPathFromNotification(item);
    if (path.startsWith("/appointments")) acc.appointments += 1;
    if (path.startsWith("/medications")) acc.medications += 1;
    if (path.startsWith("/documents")) acc.documents += 1;
    if (path.startsWith("/calendar")) acc.calendar += 1;
    return acc;
  }, { appointments: 0, medications: 0, documents: 0, calendar: 0 });

  const links = [
    { to: "/", label: "Inicio", icon: icons.home },
    { to: "/appointments", label: "Citas", icon: icons.appointment, badge: notificationCounts.appointments },
    { to: "/calendar", label: "Calendario", icon: icons.calendar, badge: notificationCounts.calendar },
    { to: "/stats", label: "Stats", icon: icons.chart },
    { to: "/timeline", label: "Historia", icon: icons.timeline },
    { to: "/medications", label: "Meds", icon: icons.heart, badge: notificationCounts.medications },
    { to: "/documents", label: "Docs", icon: icons.doc, badge: notificationCounts.documents },
    { to: "/settings", label: "Perfil", icon: icons.user },
  ];
  const mobilePrimaryLinks = [links[0], links[1], links[2], links[4]];
  const mobileOverflowLinks = [links[3], links[5], links[6], links[7]];

  useEffect(() => {
    setShowMobileMenu(false);
  }, [location.pathname, isMobile]);

  if (isAuthRoute) return null;

  return (
    <aside
      className={`sidebar ${expanded && !isMobile ? "expanded" : ""}`}
      onMouseEnter={() => !isMobile && setExpanded(true)}
      onMouseLeave={() => !isMobile && setExpanded(false)}
    >
      <div className="sidebar-brand">
        <div className="brand-avatar">
          <img
            src="/icons/new_log.png"
            alt="Klinip"
            className="brand-avatar-img"
          />
        </div>
        {expanded && (
          <div>
            <div className="brand-title">Klinip</div>
            <div className="brand-subtitle">Tu ruta de salud</div>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        {isMobile ? (
          <>
            {mobilePrimaryLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`sidebar-link ${location.pathname === link.to ? "active" : ""}`}
                onClick={() => setShowMobileMenu(false)}
              >
                <span className="sidebar-icon">{link.icon}</span>
                {link.badge > 0 && (
                  <span className="sidebar-badge">{link.badge}</span>
                )}
                <span className="sidebar-label">{link.label}</span>
              </Link>
            ))}
            <button
              type="button"
              className={`sidebar-link sidebar-more ${showMobileMenu ? "active" : ""}`}
              aria-expanded={showMobileMenu}
              aria-controls="sidebar-more-menu"
              onClick={() => setShowMobileMenu((prev) => !prev)}
            >
              <span className="sidebar-icon">{icons.extras}</span>
              <span className="sidebar-label">Otros</span>
            </button>
            <div
              id="sidebar-more-menu"
              className={`sidebar-more-menu ${showMobileMenu ? "open" : ""}`}
            >
              {mobileOverflowLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`sidebar-menu-link ${
                    location.pathname === link.to ? "active" : ""
                  }`}
                  onClick={() => setShowMobileMenu(false)}
                >
                  <span className="sidebar-icon">{link.icon}</span>
                  {link.badge > 0 && (
                    <span className="sidebar-badge">{link.badge}</span>
                  )}
                  <span className="sidebar-label">{link.label}</span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`sidebar-link ${location.pathname === link.to ? "active" : ""}`}
            >
              <span className="sidebar-icon">{link.icon}</span>
              {link.badge > 0 && (
                <span className="sidebar-badge">{link.badge}</span>
              )}
              <span className="sidebar-label">{link.label}</span>
            </Link>
          ))
        )}
      </nav>

      <div className="sidebar-footer">
        <button
          className="theme-toggle"
          type="button"
          onClick={onToggleTheme}
          role="switch"
          aria-checked={theme === "dark"}
        >
          <span className="theme-toggle-label">
            {theme === "dark" ? "Modo oscuro" : "Modo claro"}
          </span>
          <span className={`theme-switch ${theme === "dark" ? "is-dark" : ""}`}>
            <span className="theme-switch-thumb" />
          </span>
        </button>
      </div>
    </aside>
  );
}

function Topbar({ user, notifications, onClearNotifications, onOpenNotification, onLogout }) {
  const location = useLocation();

  const isAuthRoute =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/reset-password";
  const titles = {
    "/": "Resumen",
    "/appointments": "Citas",
    "/documents": "Documentos",
    "/medications": "Medicamentos",
    "/calendar": "Calendario",
    "/stats": "Estadisticas",
    "/timeline": "Historia",
    "/settings": "Perfil",
  };
  const title = titles[location.pathname] || "Klinip";
  const subtitle = location.pathname === "/" ? "Panel general" : "Tu ruta de salud";
  const initials = (user?.name || "Klinip").slice(0, 1).toUpperCase();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  useEffect(() => {
    setNotificationsOpen(false);
    setProfileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!profileMenuRef.current) return;
      if (!profileMenuRef.current.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  if (isAuthRoute || (!user && location.pathname === "/")) return null;

  return (
    <header className="topbar">
      <div>
        <p className="topbar-label">{subtitle}</p>
        <div className="topbar-row">
          <h2 className="topbar-title">{title}</h2>
          <span className="topbar-chip">{today}</span>
        </div>
      </div>
      <div className="topbar-actions">
        <div className="topbar-notifications">
          <button
            className="topbar-quick"
            type="button"
            aria-label="Ver notificaciones"
            onClick={() => setNotificationsOpen((prev) => !prev)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {notifications?.length > 0 && (
              <span className="notification-badge">{notifications.length}</span>
            )}
          </button>
          {notificationsOpen && (
            <div className="notifications-dropdown">
              <div className="notifications-header">
                <span>Notificaciones</span>
                {notifications?.length > 0 && (
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => {
                      onClearNotifications?.();
                      setNotificationsOpen(false);
                    }}
                  >
                    Limpiar
                  </button>
                )}
              </div>
              {notifications?.length ? (
                <ul className="notifications-list">
                  {notifications.slice(0, 6).map((item) => (
                    <li
                      key={item.id}
                      className="notifications-item"
                      onClick={() => {
                        onOpenNotification?.(item);
                        setNotificationsOpen(false);
                      }}
                    >
                      <div className="notifications-title">{item.title || "Recordatorio"}</div>
                      <div className="notifications-body">{item.body || ""}</div>
                      <div className="notifications-meta">
                        {item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="notifications-empty">Sin notificaciones recientes</div>
              )}
            </div>
          )}
        </div>
        <div className="topbar-user-wrap" ref={profileMenuRef}>
          <button
            type="button"
            className="topbar-user"
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
            onClick={() => setProfileMenuOpen((prev) => !prev)}
          >
            <span className="topbar-avatar">{initials}</span>
            <span className="topbar-name">{user?.name || "Invitado"}</span>
          </button>
          {profileMenuOpen && (
            <div className="topbar-user-menu" role="menu">
              <button
                type="button"
                className="topbar-user-menu-item"
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false);
                  onLogout?.();
                }}
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

const NOTIFICATION_STORAGE_KEY_BASE = "klinip_received_notifications";
const LAST_USER_ID_KEY = "klinip_last_user_id";
const CONSENT_ACCEPTED_KEY = "klinip_consent_accepted_v1";
const PUSH_REGISTERED_KEY_BASE = "klinip_push_registered";
const PUSH_ENDPOINT_KEY_BASE = "klinip_push_endpoint";
const NOTIF_CONSENT_KEY_BASE = "klinip_notifications_consent";
const NOTIF_LAST_PROMPT_KEY_BASE = "klinip_notifications_last_prompt";
const NOTIF_PROMPT_COUNT_KEY_BASE = "klinip_notifications_prompt_count";
const NOTIF_PROMPT_DAYS = 5;
const NOTIF_PROMPT_SESSIONS = 5;
const MED_ALERT_POLL_MS = 15000;
const getUserKey = (base, userId) => (userId ? `${base}_${userId}` : base);

const parseMedicationScheduleTime = (value = "") => {
  if (!value || typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
};

const buildMedicationPromptKey = (med, date) => {
  const day = date.toISOString().slice(0, 10);
  const slot = med.schedule_time || "manual";
  return `klinip_med_prompt_${med.id}_${day}_${slot}`;
};

const isMedicationActive = (med, now) => {
  if (med?.completed) return false;
  if (!med?.end_date) return true;
  const end = new Date(med.end_date);
  if (Number.isNaN(end.getTime())) return true;
  end.setHours(23, 59, 59, 999);
  return now.getTime() <= end.getTime();
};

const getPathFromNotification = (item) => {
  if (!item) return "";
  if (item.kind === "document") return "/documents";
  if (item.kind === "medication") return "/medications";
  if (item.kind === "appointment") return "/appointments";
  if (item.tag?.startsWith("document-")) return "/documents";
  if (item.tag?.startsWith("medication-")) return "/medications";
  if (item.tag?.startsWith("appointment-")) return "/appointments";
  if (item.tag?.startsWith("calendar-")) return "/calendar";
  let raw = item.url || "";
  if (!raw) return "";
  try {
    if (raw.startsWith("http")) {
      const parsed = new URL(raw);
      raw = parsed.hash ? parsed.hash.slice(1) : parsed.pathname;
    }
  } catch (err) {
    raw = item.url || "";
  }
  if (raw.includes("#")) {
    raw = raw.split("#")[1] || "";
  }
  if (!raw.startsWith("/")) {
    raw = `/${raw}`;
  }
  return raw.split("?")[0];
};

function ProtectedRoute({ user, children }) {
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateRegistration, setUpdateRegistration] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      return savedTheme;
    }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const [booting, setBooting] = useState(true);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [notifConsentOpen, setNotifConsentOpen] = useState(false);
  const globalMedCheckRef = useRef(Date.now() - MED_ALERT_POLL_MS);

  useEffect(() => {
    document.body.classList.toggle("theme-dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    async function bootstrap() {
      const token = localStorage.getItem("token");
      if (!token) {
        setBooting(false);
        return;
      }
      try {
        const me = await getMe();
        setUser(me);
      } catch (err) {
        localStorage.removeItem("token");
        setUser(null);
      } finally {
        setBooting(false);
      }
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (!user || booting) return undefined;

    let active = true;

    const checkDueMedicationPopups = async () => {
      const now = new Date();
      const nowTs = now.getTime();
      const lastChecked = globalMedCheckRef.current;

      try {
        const meds = (await getMedications()) || [];
        if (!active) return;

        const due = meds
          .filter((med) => {
            if (!med?.schedule_time) return false;
            if (!isMedicationActive(med, now)) return false;
            const slot = parseMedicationScheduleTime(med.schedule_time);
            if (!slot) return false;
            const trigger = new Date(now);
            trigger.setHours(slot.hour, slot.minute, 0, 0);
            const triggerTs = trigger.getTime();
            if (triggerTs <= lastChecked || triggerTs > nowTs) return false;
            const key = buildMedicationPromptKey(med, now);
            return !localStorage.getItem(key);
          })
          .map((med) => {
            const slot = parseMedicationScheduleTime(med.schedule_time);
            const trigger = new Date(now);
            trigger.setHours(slot.hour, slot.minute, 0, 0);
            return { med, triggerTs: trigger.getTime() };
          })
          .sort((a, b) => a.triggerTs - b.triggerTs);

        if (due.length > 0) {
          const first = due[0].med;
          const key = buildMedicationPromptKey(first, now);
          localStorage.setItem(key, "prompted");
          const target = `/medications?notify=1&medicationId=${first.id}`;
          if (!(location.pathname === "/medications" && location.search.includes(`medicationId=${first.id}`) && location.search.includes("notify=1"))) {
            navigate(target);
          }
        }
      } catch (err) {
        console.error("No se pudo verificar alertas de medicamentos", err);
      } finally {
        globalMedCheckRef.current = nowTs;
      }
    };

    checkDueMedicationPopups();
    const intervalId = window.setInterval(checkDueMedicationPopups, MED_ALERT_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [user, booting, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!user) {
      setConsentOpen(false);
      return;
    }
    const consentKey = getUserKey(CONSENT_ACCEPTED_KEY, user.id);
    const accepted = localStorage.getItem(consentKey) === "true";
    if (!accepted) {
      setConsentChecked(false);
      setConsentOpen(true);
    }
  }, [user]);

  useEffect(() => {
    if (!user || consentOpen) {
      setNotifConsentOpen(false);
      return;
    }
    const consentKey = getUserKey(NOTIF_CONSENT_KEY_BASE, user.id);
    const lastPromptKey = getUserKey(NOTIF_LAST_PROMPT_KEY_BASE, user.id);
    const promptCountKey = getUserKey(NOTIF_PROMPT_COUNT_KEY_BASE, user.id);
    const storedConsent = localStorage.getItem(consentKey) || "";

    if ("Notification" in window && Notification.permission === "denied") {
      localStorage.setItem(consentKey, "rejected");
      updateMe({ notifications_consent: "rejected" }).catch(() => null);
      setNotifConsentOpen(false);
      return;
    }

    if (storedConsent === "accepted" || storedConsent === "rejected") {
      setNotifConsentOpen(false);
      return;
    }

    const lastPrompt = localStorage.getItem(lastPromptKey);
    const promptCount = parseInt(
      localStorage.getItem(promptCountKey) || "0",
      10
    );
    const now = Date.now();
    const lastTime = lastPrompt ? Date.parse(lastPrompt) : 0;
    const daysSince = lastTime ? (now - lastTime) / (1000 * 60 * 60 * 24) : 999;
    const nextCount = promptCount + 1;
    localStorage.setItem(promptCountKey, String(nextCount));

    const shouldPrompt =
      !lastPrompt ||
      daysSince >= NOTIF_PROMPT_DAYS ||
      nextCount % NOTIF_PROMPT_SESSIONS === 0;

    if (shouldPrompt) {
      setNotifConsentOpen(true);
    }
  }, [user, consentOpen]);

  useEffect(() => {
    if (!user) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const consentKey = getUserKey(NOTIF_CONSENT_KEY_BASE, user.id);
    const consentValue = localStorage.getItem(consentKey);
    if (consentValue !== "accepted") return;
    const registeredKey = getUserKey(PUSH_REGISTERED_KEY_BASE, user.id);
    const endpointKey = getUserKey(PUSH_ENDPOINT_KEY_BASE, user.id);

    const syncSubscription = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        const currentEndpoint = sub?.endpoint || "";
        const storedEndpoint = localStorage.getItem(endpointKey) || "";
        const alreadyRegistered = localStorage.getItem(registeredKey) === "true";

        if (alreadyRegistered && storedEndpoint && currentEndpoint === storedEndpoint) {
          return;
        }

        await ensurePushSubscription();
        const newSub = await reg.pushManager.getSubscription();
        if (newSub?.endpoint) {
          localStorage.setItem(endpointKey, newSub.endpoint);
          localStorage.setItem(registeredKey, "true");
        } else {
          localStorage.removeItem(endpointKey);
          localStorage.removeItem(registeredKey);
        }
      } catch (err) {
        console.warn("No se pudo sincronizar la suscripcion push", err);
      }
    };

    syncSubscription();
  }, [user]);

  const persistNotifications = (items) => {
    setNotifications(items);
    if (!user) return;
    const key = getUserKey(NOTIFICATION_STORAGE_KEY_BASE, user.id);
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch (err) {
      console.warn("No se pudo guardar notificaciones localmente:", err);
    }
  };

  const loadNotificationsFromIdb = () =>
    new Promise((resolve) => {
      if (!("indexedDB" in window)) return resolve([]);
      const request = indexedDB.open("KlinipNotifications", 2);
      request.onerror = () => resolve([]);
      request.onupgradeneeded = () => resolve([]);
      request.onsuccess = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains("klinip-received-notifications")) {
            db.close();
            return resolve([]);
          }
          const tx = db.transaction("klinip-received-notifications", "readonly");
          const store = tx.objectStore("klinip-received-notifications");
          const getAll = store.getAll();
          getAll.onsuccess = () => resolve(getAll.result || []);
          getAll.onerror = () => resolve([]);
          tx.oncomplete = () => db.close();
        } catch (err) {
          resolve([]);
        }
      };
    });

  const addNotification = (notification) => {
    if (!notification || !user) return;
    if (notification.userId && String(notification.userId) !== String(user.id)) {
      return;
    }
    const normalized = {
      ...notification,
      userId: notification.userId || user.id,
    };
    setNotifications((prev) => {
      const exists = prev.some((item) => item.id === normalized.id);
      if (exists) return prev;
      const next = [normalized, ...prev].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      try {
        const key = getUserKey(NOTIFICATION_STORAGE_KEY_BASE, user.id);
        localStorage.setItem(key, JSON.stringify(next));
      } catch (err) {
        console.warn("No se pudo guardar notificaciones localmente:", err);
      }
      return next;
    });
  };

  const handleClearNotifications = () => {
    setNotifications([]);
    if (user) {
      try {
        const key = getUserKey(NOTIFICATION_STORAGE_KEY_BASE, user.id);
        localStorage.removeItem(key);
      } catch (err) {
        console.warn("No se pudo limpiar notificaciones localmente:", err);
      }
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.active?.postMessage({ type: "CLEAR_RECEIVED_NOTIFICATIONS" });
      });
    }
    if ("clearAppBadge" in navigator) {
      navigator.clearAppBadge();
    }
  };

  const removeNotificationsByPredicate = (predicate) => {
    if (typeof predicate !== "function") return;
    setNotifications((prev) => {
      const toRemove = prev.filter(predicate);
      if (!toRemove.length) return prev;
      const next = prev.filter((item) => !predicate(item));
      try {
        localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(next));
      } catch (err) {
        console.warn("No se pudo guardar notificaciones localmente:", err);
      }
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.active?.postMessage({
            type: "REMOVE_RECEIVED_NOTIFICATIONS",
            ids: toRemove.map((item) => item.id),
          });
        });
      }
      return next;
    });
  };

  const handleOpenNotification = (item) => {
    if (!item) return;
    removeNotificationsByPredicate((notif) => notif.id === item.id);
    if (item.url) navigate(item.url);
  };

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event) => {
      const data = event.data || {};
      if (data.type === "NOTIFICATION_RECORDED") {
        addNotification(data.notification);
      }
      if (data.type === "RECEIVED_NOTIFICATIONS") {
        if (!user) return;
        const list = Array.isArray(data.notifications) ? data.notifications : [];
        const filtered = list.filter(
          (item) => String(item.userId || "") === String(user.id)
        );
        const sorted = filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        persistNotifications(sorted);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [user]);

  useEffect(() => {
    if (!user || !("serviceWorker" in navigator)) return;
    let cancelled = false;

    const syncNotifications = async () => {
      const reg = await registerServiceWorker().catch(() => null);
      const target = reg?.active || reg?.waiting || reg?.installing || navigator.serviceWorker.controller;
      if (target) {
        target.postMessage({ type: "GET_RECEIVED_NOTIFICATIONS" });
        return;
      }
      const stored = await loadNotificationsFromIdb();
      if (!cancelled && stored.length) {
        const filtered = stored.filter(
          (item) => String(item.userId || "") === String(user.id)
        );
        const sorted = filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        persistNotifications(sorted);
      }
    };

    syncNotifications();

    const onControllerChange = () => {
      navigator.serviceWorker.controller?.postMessage({ type: "GET_RECEIVED_NOTIFICATIONS" });
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [user]);

  useEffect(() => {
    const count = notifications.length;
    if ("setAppBadge" in navigator) {
      if (count > 0) {
        navigator.setAppBadge(count);
      } else if ("clearAppBadge" in navigator) {
        navigator.clearAppBadge();
      }
    }
  }, [notifications.length]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    const lastUserId = localStorage.getItem(LAST_USER_ID_KEY);
    if (lastUserId && String(lastUserId) !== String(user.id)) {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.active?.postMessage({ type: "CLEAR_RECEIVED_NOTIFICATIONS" });
        });
      }
      setNotifications([]);
    }
    const key = getUserKey(NOTIFICATION_STORAGE_KEY_BASE, user.id);
    try {
      const saved = localStorage.getItem(key);
      const parsed = saved ? JSON.parse(saved) : [];
      const filtered = parsed.filter(
        (item) => String(item.userId || "") === String(user.id)
      );
      setNotifications(filtered);
    } catch (err) {
      setNotifications([]);
    }
    localStorage.setItem(LAST_USER_ID_KEY, String(user.id));
  }, [user]);

  useEffect(() => {
    if (!location?.pathname) return;
    const path = location.pathname;
    if (
      path.startsWith("/appointments") ||
      path.startsWith("/medications") ||
      path.startsWith("/documents") ||
      path.startsWith("/calendar")
    ) {
      removeNotificationsByPredicate((item) => getPathFromNotification(item) === path);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    let active = true;

    const initServiceWorker = async () => {
      const reg = await registerServiceWorker().catch(() => null);
      if (!active) return;
      if (reg?.waiting && navigator.serviceWorker.controller) {
        setUpdateRegistration(reg);
        setUpdateAvailable(true);
      }
    };

    initServiceWorker();

    const intervalId = window.setInterval(() => {
      navigator.serviceWorker.getRegistration().then((reg) => reg?.update?.().catch(() => null));
    }, 5 * 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const onUpdate = (event) => {
      const reg = event.detail?.registration || null;
      setUpdateRegistration(reg);
        setUpdateAvailable(true);
        if ("Notification" in window && Notification.permission === "granted" && reg?.showNotification) {
          reg.showNotification("Actualizacion disponible", {
            body: "Hay una nueva version de Klinip. Actualiza para aplicar cambios.",
            icon: "/icons/android-chrome-192x192.png",
          }).catch(() => null);
        }
      };
    window.addEventListener("klinip-sw-update", onUpdate);
    return () => window.removeEventListener("klinip-sw-update", onUpdate);
  }, []);

  const handleApplyUpdate = async () => {
    try {
      const reg = updateRegistration || (await navigator.serviceWorker.getRegistration());
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      } else {
        window.location.reload();
      }
    } catch (err) {
      window.location.reload();
    } finally {
      setUpdateAvailable(false);
    }
  };
  
  const handleToggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const handleLogout = () => {
    const registeredKey = getUserKey(PUSH_REGISTERED_KEY_BASE, user?.id);
    const endpointKey = getUserKey(PUSH_ENDPOINT_KEY_BASE, user?.id);
    localStorage.removeItem("token");
    if (registeredKey) localStorage.removeItem(registeredKey);
    if (endpointKey) localStorage.removeItem(endpointKey);
    if (user?.id) {
      const key = getUserKey(NOTIFICATION_STORAGE_KEY_BASE, user.id);
      localStorage.removeItem(key);
    }
    apiLogout?.();
    setUser(null);
    removePushSubscription();
    if ("caches" in window) {
      caches.keys().then((keys) => {
        keys
          .filter((key) => key.startsWith("klinip-cache"))
          .forEach((key) => caches.delete(key));
      });
    }
  };

  const handleAcceptConsent = () => {
    const consentKey = getUserKey(CONSENT_ACCEPTED_KEY, user?.id);
    localStorage.setItem(consentKey, "true");
    localStorage.removeItem("klinip_consent_revoked");
    setConsentOpen(false);
  };

  const handleAcceptNotifications = () => {
    setNotifConsentOpen(false);
    (async () => {
      try {
        const consentKey = getUserKey(NOTIF_CONSENT_KEY_BASE, user?.id);
        const lastPromptKey = getUserKey(NOTIF_LAST_PROMPT_KEY_BASE, user?.id);
        if (!("Notification" in window)) {
          localStorage.setItem(consentKey, "later");
          localStorage.setItem(lastPromptKey, new Date().toISOString());
          await updateMe({
            notifications_consent: "later",
            notifications_last_prompt: new Date().toISOString(),
          });
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          localStorage.setItem(consentKey, "accepted");
          await updateMe({ notifications_consent: "accepted" });
          await ensurePushSubscription();
        } else if (permission === "denied") {
          localStorage.setItem(consentKey, "rejected");
          await updateMe({ notifications_consent: "rejected" });
        } else {
          localStorage.setItem(consentKey, "later");
          localStorage.setItem(lastPromptKey, new Date().toISOString());
          await updateMe({
            notifications_consent: "later",
            notifications_last_prompt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error("Error solicitando permiso de notificaciones", err);
        const consentKey = getUserKey(NOTIF_CONSENT_KEY_BASE, user?.id);
        const lastPromptKey = getUserKey(NOTIF_LAST_PROMPT_KEY_BASE, user?.id);
        localStorage.setItem(consentKey, "later");
        localStorage.setItem(lastPromptKey, new Date().toISOString());
        updateMe({
          notifications_consent: "later",
          notifications_last_prompt: new Date().toISOString(),
        }).catch(() => null);
      }
    })();
  };

  const handleLaterNotifications = () => {
    const consentKey = getUserKey(NOTIF_CONSENT_KEY_BASE, user?.id);
    const lastPromptKey = getUserKey(NOTIF_LAST_PROMPT_KEY_BASE, user?.id);
    localStorage.setItem(consentKey, "later");
    localStorage.setItem(lastPromptKey, new Date().toISOString());
    setNotifConsentOpen(false);
    updateMe({
      notifications_consent: "later",
      notifications_last_prompt: new Date().toISOString(),
    }).catch((err) => {
      console.error("Error guardando consentimiento", err);
    });
  };

  const handleLearnMoreNotifications = () => {
    navigate("/legal/notificaciones");
  };



  if (booting) {
    return (
      <div className="app-shell">
        <div className="main-content">
          <div className="splash">
            <div className="splash-dot" />
            <p>Cargando Klinip...</p>
          </div>
        </div>
      </div>
    );
  }

  const isPublicLanding = !user && location.pathname === "/";

  return (
    <div className="app-shell">
      {consentOpen && (
        <div className="consent-backdrop">
          <div className="consent-card" role="dialog" aria-modal="true">
            <p className="consent-kicker">Asistente Klinip</p>
            <h2 className="consent-title">Acepta los documentos legales</h2>
            <p className="consent-text">
              Antes de continuar, revisa y acepta los documentos legales de Klinip.
            </p>
            <div className="consent-links">
              <Link to="/legal/terms" className="secondary-btn">
                Terminos de uso
              </Link>
              <Link to="/legal/privacy" className="secondary-btn">
                Politica de privacidad
              </Link>
              <Link to="/legal/consent" className="secondary-btn">
                Consentimiento informado
              </Link>
            </div>
            <label className="consent-checkbox">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
              />
              <span>
                He leido y acepto los Terminos, Politica de Privacidad y
                Consentimiento informado.
              </span>
            </label>
            <button
              className="primary-btn"
              type="button"
              onClick={handleAcceptConsent}
              disabled={!consentChecked}
              style={{ width: "100%" }}
            >
              Aceptar terminos
            </button>
          </div>
        </div>
      )}
      {notifConsentOpen && (
        <div className="consent-backdrop">
          <div className="consent-card notification-consent" role="dialog" aria-modal="true">
            <p className="consent-kicker">Recordatorios</p>
            <h2 className="consent-title">Te ayudamos a recordar tus cuidados de salud</h2>
            <p className="consent-text">
              Activa las notificaciones para medicamentos, citas y examenes.
              Puedes cambiar esta configuracion desde tu perfil cuando quieras.
            </p>
            <div className="consent-switch-row">
              <div>
                <p className="consent-switch-title">Activar notificaciones</p>
                <p className="consent-switch-sub">Recibe alertas importantes en tu dispositivo.</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  onChange={(event) => {
                    if (event.target.checked) {
                      handleAcceptNotifications();
                    }
                  }}
                />
                <span className="switch-slider" />
              </label>
            </div>
            <div className="consent-actions">
              <button className="secondary-btn" type="button" onClick={handleLaterNotifications}>
                Configurar despues
              </button>
              <button className="ghost-btn" type="button" onClick={handleLearnMoreNotifications}>
                Aprender mas
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="layout">
        <Sidebar
          user={user}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          notifications={notifications}
        />
        <div className={`main-area ${isPublicLanding ? "main-area-public" : ""}`}>
          <Topbar
            user={user}
            notifications={notifications}
            onClearNotifications={handleClearNotifications}
            onOpenNotification={handleOpenNotification}
            onLogout={handleLogout}
          />
          {updateAvailable && (
            <div className="update-banner" role="status" aria-live="polite">
              <div>
                <p className="update-title">Actualizacion disponible</p>
                <p className="update-text">
                  Hay una nueva version de Klinip. Actualiza para aplicar los cambios.
                </p>
              </div>
              <div className="update-actions">
                <button className="primary-btn" type="button" onClick={handleApplyUpdate}>
                  Actualizar ahora
                </button>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => setUpdateAvailable(false)}
                >
                  Despues
                </button>
              </div>
            </div>
          )}
          <main className={`main-content ${isPublicLanding ? "main-content-landing" : ""}`}>
            <Routes>
              <Route
                path="/login"
                element={
                  user ? <Navigate to="/" replace /> : <Login onAuthenticated={setUser} />
                }
              />
              <Route
                path="/forgot-password"
                element={user ? <Navigate to="/" replace /> : <ForgotPassword />}
              />
              <Route
                path="/reset-password"
                element={user ? <Navigate to="/" replace /> : <ResetPassword />}
              />
              <Route
                path="/register"
                element={
                  user ? <Navigate to="/" replace /> : <Register onRegistered={setUser} />
                }
              />
              <Route path="/legal/privacy" element={<LegalPrivacy />} />
              <Route path="/legal/terms" element={<LegalTerms />} />
              <Route path="/legal/consent" element={<LegalConsent />} />
              <Route path="/legal/notificaciones" element={<LegalNotifications />} />
              <Route
                path="/"
                element={
                  user ? (
                    <ProtectedRoute user={user}>
                      <Dashboard user={user} />
                    </ProtectedRoute>
                  ) : (
                    <Landing />
                  )
                }
              />
              <Route
                path="/appointments"
                element={
                  <ProtectedRoute user={user}>
                    <Appointments />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/documents"
                element={
                  <ProtectedRoute user={user}>
                    <Documents />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/medications"
                element={
                  <ProtectedRoute user={user}>
                    <Medications />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/calendar"
                element={
                  <ProtectedRoute user={user}>
                    <Calendar />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/timeline"
                element={
                  <ProtectedRoute user={user}>
                    <Timeline />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/stats"
                element={
                  <ProtectedRoute user={user}>
                    <Stats />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute user={user}>
                    <Settings
                      user={user}
                      onLogout={handleLogout}
                      theme={theme}
                      onToggleTheme={handleToggleTheme}
                      onUserUpdate={setUser}
                    />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}




