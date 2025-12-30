import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation, Link, useNavigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Appointments from "./pages/Appointments";
import Calendar from "./pages/Calendar";
import Medications from "./pages/Medications";
import Documents from "./pages/Documents";
import Settings from "./pages/Settings";
import Timeline from "./pages/Timeline";
import Landing from "./pages/Landing";
import LegalPrivacy from "./pages/LegalPrivacy";
import LegalTerms from "./pages/LegalTerms";
import LegalConsent from "./pages/LegalConsent";
import { getMe, logout as apiLogout } from "./api";
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
      <path d="M12 20s-7-4.5-7-9.5S8.5 4 12 7.5C15.5 4 19 6.5 19 10.5S12 20 12 20Z" />
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
  timeline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 4v16M18 4v16" />
      <circle cx="6" cy="8" r="1.8" />
      <circle cx="18" cy="12" r="1.8" />
      <circle cx="6" cy="16" r="1.8" />
    </svg>
  ),
};

function Sidebar({ user, theme, onToggleTheme }) {
  const location = useLocation();
  const isAuthRoute =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
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

  const links = [
    { to: "/", label: "Inicio", icon: icons.home },
    { to: "/appointments", label: "Citas", icon: icons.calendar },
    { to: "/calendar", label: "Calendario", icon: icons.calendar },
    { to: "/timeline", label: "Historia", icon: icons.timeline },
    { to: "/medications", label: "Meds", icon: icons.heart },
    { to: "/documents", label: "Docs", icon: icons.doc },
    { to: "/settings", label: "Perfil", icon: icons.user },
  ];
  const mobilePrimaryLinks = [links[0], links[1], links[2], links[4]];
  const mobileOverflowLinks = [links[3], links[5], links[6]];

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
        <div className="brand-avatar">K</div>
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

function Topbar({ user, notifications, onClearNotifications }) {
  const location = useLocation();

  const isAuthRoute = location.pathname === "/login" || location.pathname === "/register";
  const titles = {
    "/": "Resumen",
    "/appointments": "Citas",
    "/documents": "Documentos",
    "/medications": "Medicamentos",
    "/calendar": "Calendario",
    "/timeline": "Historia",
    "/settings": "Perfil",
  };
  const title = titles[location.pathname] || "Klinip";
  const subtitle = location.pathname === "/" ? "Panel general" : "Tu ruta de salud";
  const initials = (user?.name || "Klinip").slice(0, 1).toUpperCase();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  useEffect(() => {
    setNotificationsOpen(false);
  }, [location.pathname]);

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
                        if (item.url) navigate(item.url);
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
        <div className="topbar-user">
          <span className="topbar-avatar">{initials}</span>
          <span className="topbar-name">{user?.name || "Invitado"}</span>
        </div>
      </div>
    </header>
  );
}

const NOTIFICATION_STORAGE_KEY = "klinip_received_notifications";

function ProtectedRoute({ user, children }) {
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
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
        setUser(null);
      } finally {
        setBooting(false);
      }
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (!user) {
      setConsentOpen(false);
      return;
    }
    const accepted = localStorage.getItem("klinip_consent_accepted_v1") === "true";
    if (!accepted) {
      setConsentChecked(false);
      setConsentOpen(true);
    }
  }, [user]);

  const persistNotifications = (items) => {
    setNotifications(items);
    try {
      localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(items));
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
    if (!notification) return;
    setNotifications((prev) => {
      const exists = prev.some((item) => item.id === notification.id);
      if (exists) return prev;
      const next = [notification, ...prev].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      try {
        localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(next));
      } catch (err) {
        console.warn("No se pudo guardar notificaciones localmente:", err);
      }
      return next;
    });
  };

  const handleClearNotifications = () => {
    setNotifications([]);
    try {
      localStorage.removeItem(NOTIFICATION_STORAGE_KEY);
    } catch (err) {
      console.warn("No se pudo limpiar notificaciones localmente:", err);
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

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event) => {
      const data = event.data || {};
      if (data.type === "NOTIFICATION_RECORDED") {
        addNotification(data.notification);
      }
      if (data.type === "RECEIVED_NOTIFICATIONS") {
        const list = Array.isArray(data.notifications) ? data.notifications : [];
        const sorted = list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        persistNotifications(sorted);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

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
        const sorted = stored.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
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
  
  const handleToggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    apiLogout?.();
    setUser(null);
    removePushSubscription();
  };

  const handleAcceptConsent = () => {
    localStorage.setItem("klinip_consent_accepted_v1", "true");
    localStorage.removeItem("klinip_consent_revoked");
    setConsentOpen(false);
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
      <div className="layout">
        <Sidebar user={user} theme={theme} onToggleTheme={handleToggleTheme} />
        <div className="main-area">
          <Topbar
            user={user}
            notifications={notifications}
            onClearNotifications={handleClearNotifications}
          />
          <main className="main-content">
            <Routes>
              <Route
                path="/login"
                element={
                  user ? <Navigate to="/" replace /> : <Login onAuthenticated={setUser} />
                }
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


