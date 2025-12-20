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

function Sidebar({ user, onLogout }) {
  const location = useLocation();
  const isAuthRoute =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    (!user && location.pathname === "/");
  const [expanded, setExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (isAuthRoute) return null;

  const links = [
    { to: "/", label: "Inicio", icon: icons.home },
    { to: "/appointments", label: "Citas", icon: icons.calendar },
    { to: "/calendar", label: "Calendario", icon: icons.calendar },
    { to: "/timeline", label: "Historia", icon: icons.timeline },
    { to: "/medications", label: "Meds", icon: icons.heart },
    { to: "/documents", label: "Docs", icon: icons.doc },
    { to: "/settings", label: "Perfil", icon: icons.user },
  ];

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
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={`sidebar-link ${location.pathname === link.to ? "active" : ""}`}
          >
            <span className="sidebar-icon">{link.icon}</span>
            <span className="sidebar-label">{link.label}</span>
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        {expanded && <div className="sidebar-user">{user?.name || "Invitado"}</div>}
        <button className="nav-button ghost" onClick={onLogout}>
          <span className="sidebar-icon">{icons.user}</span>
          {expanded && "Cerrar sesión"}
        </button>
      </div>
    </aside>
  );
}

function Topbar({ user }) {
  const location = useLocation();

  const isAuthRoute = location.pathname === "/login" || location.pathname === "/register";
  if (isAuthRoute || (!user && location.pathname === "/")) return null;

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
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

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
        <div className="topbar-user">
          <span className="topbar-avatar">{initials}</span>
          <span className="topbar-name">{user?.name || "Invitado"}</span>
        </div>
      </div>
    </header>
  );
}

function ProtectedRoute({ user, children }) {
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const navigate = useNavigate();
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState({
    objetivo: "",
    recordatorios: "visual",
    preferencia: "calendario",
  });

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
    if (!user) return;
    const seen = localStorage.getItem("klinip_onboarding_seen");
    if (!seen) {
      setShowOnboarding(true);
    }
  }, [user]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    apiLogout?.();
    setUser(null);
    removePushSubscription();
  };

  useEffect(() => {
    if (!user) return;
    registerServiceWorker().then(() => {
      ensurePushSubscription().catch((err) =>
        console.error("No se pudo suscribir a push", err)
      );
    });
  }, [user]);

  const completeOnboarding = () => {
    localStorage.setItem("klinip_onboarding_seen", "1");
    setShowOnboarding(false);
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
      <div className="layout">
        <Sidebar user={user} onLogout={handleLogout} />
        <div className="main-area">
          <Topbar user={user} />
          <main className="main-content">
            <Routes>
              <Route
              path="/login"
              element={
                user ? (
                  <Navigate to="/" replace />
                ) : (
                  <Login onAuthenticated={setUser} />
                )
              }
            />
            <Route
              path="/register"
              element={
                user ? (
                  <Navigate to="/" replace />
                ) : (
                  <Register onRegistered={setUser} />
                )
              }
            />
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
                <Settings user={user} onLogout={handleLogout} />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
      {showOnboarding && (
        <Onboarding
          user={user}
          step={onboardingStep}
          data={onboardingData}
          setData={setOnboardingData}
          onNext={() => setOnboardingStep((s) => Math.min(s + 1, 2))}
          onPrev={() => setOnboardingStep((s) => Math.max(s - 1, 0))}
          onSkip={completeOnboarding}
          onClose={completeOnboarding}
          onGo={(path) => {
            completeOnboarding();
            navigate(path);
          }}
        />
      )}
    </div>
  );
}

function Onboarding({ onClose, onGo, user, step, data, setData, onNext, onPrev, onSkip }) {
  const steps = [
    {
      title: "Define tu objetivo",
      desc: "¿Qué quieres lograr con Klinip?",
      content: (
        <div className="onboarding-fields">
          <label className="input-label">Objetivo principal</label>
          <input
            className="input-field"
            placeholder="Ej: Organizar mis citas de control"
            value={data.objetivo}
            onChange={(e) => setData({ ...data, objetivo: e.target.value })}
          />
        </div>
      ),
    },
    {
      title: "Recordatorios",
      desc: "Elige cómo quieres tus alertas",
      content: (
        <div className="onboarding-options">
          <button
            className={`pill-button ${data.recordatorios === "visual" ? "active" : ""}`}
            type="button"
            onClick={() => setData({ ...data, recordatorios: "visual" })}
          >
            🔔 Visuales en la app
          </button>
          <button
            className={`pill-button ${data.recordatorios === "push" ? "active" : ""}`}
            type="button"
            onClick={() => setData({ ...data, recordatorios: "push" })}
          >
            📱 Push (si el navegador lo permite)
          </button>
          <button
            className={`pill-button ${data.recordatorios === "correo" ? "active" : ""}`}
            type="button"
            onClick={() => setData({ ...data, recordatorios: "correo" })}
          >
            ✉️ Correo (próximamente)
          </button>
        </div>
      ),
    },
    {
      title: "¿Por dónde empiezas?",
      desc: "Atajo rápido para tu primer paso",
      content: (
        <div className="onboarding-actions-grid">
          <button className="primary-btn" type="button" onClick={() => onGo("/appointments")}>
            Cargar mi primera cita
          </button>
          <button className="secondary-btn" type="button" onClick={() => onGo("/documents")}>
            Subir documentos
          </button>
          <button className="secondary-btn" type="button" onClick={() => onGo("/calendar")}>
            Ver calendario
          </button>
          <button className="secondary-btn" type="button" onClick={() => onGo("/medications")}>
            Registrar medicamento
          </button>
          <button className="secondary-btn" type="button" onClick={() => onGo("/timeline")}>
            Ver mi historia
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="floating-form-backdrop" onClick={onClose}>
      <div className="floating-form-card onboarding-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="card-title">¡Bienvenido a Klinip{user?.name ? `, ${user.name}` : ""}!</h2>
        <div className="onboarding-stepper">
          {steps.map((_, idx) => (
            <div key={idx} className={`step ${idx === step ? "active" : idx < step ? "done" : ""}`}>
              <div className="step-index">{idx + 1}</div>
            </div>
          ))}
        </div>
        <h3 className="onboarding-title">{steps[step].title}</h3>
        <p className="muted">{steps[step].desc}</p>
        {steps[step].content}
        <div className="floating-actions" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {step > 0 && (
              <button className="secondary-btn" type="button" onClick={onPrev}>
                Anterior
              </button>
            )}
            <button className="secondary-btn" type="button" onClick={onSkip}>
              Omitir
            </button>
          </div>
          {step < steps.length - 1 ? (
            <button className="primary-btn" type="button" onClick={onNext}>
              Continuar
            </button>
          ) : (
            <button className="primary-btn" type="button" onClick={onClose}>
              Empezar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
