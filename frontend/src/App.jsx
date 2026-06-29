import React, { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation, Link, useNavigate } from "react-router-dom";
import {
  getMe,
  getAppPinStatus,
  getAppointments,
  getMedications,
  updateMe,
  logout as apiLogout,
  getMyPlan,
  getHealthProfiles,
  getActiveHealthProfile,
  setActiveHealthProfile,
  isAuthSessionError,
} from "./api";
import { registerServiceWorker, ensurePushSubscription, removePushSubscription } from "./services/pwa";
import {
  clearScheduledNotifications,
  scheduleReminderNotifications,
  scheduleMedicationNotifications,
} from "./services/notificationManager";
import { subscribeClinicalDataChanged, notifyClinicalDataChanged } from "./utils/clinicalRefresh";
import DocumentUploadWizard from "./components/DocumentUploadWizard";
import { isHandheldViewport } from "./utils/mobileViewport";
import {
  getMedicationScheduleTimes,
  isMedicationActiveAt,
  parseScheduleTimeValue,
} from "./utils/medicationSchedule";
import BrandLogo, { BrandMark } from "./components/BrandLogo";
import PinLock from "./components/PinLock";
import { consumePinRecoveryLogin } from "./utils/pinLock";
import { observeMojibakeRepair } from "./utils/textEncoding";

const LAZY_ROUTE_RELOAD_PREFIX = "klinip-lazy-route-reload";

function isRecoverableLazyError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("chunkloaderror") ||
    message.includes("loading chunk") ||
    message.includes("unable to preload css")
  );
}

function lazyWithRecovery(loader, key) {
  return React.lazy(async () => {
    try {
      const mod = await loader();
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(`${LAZY_ROUTE_RELOAD_PREFIX}:${key}`);
      }
      return mod;
    } catch (error) {
      if (typeof window !== "undefined" && isRecoverableLazyError(error)) {
        const reloadKey = `${LAZY_ROUTE_RELOAD_PREFIX}:${key}`;
        if (sessionStorage.getItem(reloadKey) !== "1") {
          sessionStorage.setItem(reloadKey, "1");
          window.location.reload();
          await new Promise(() => {});
        }
      }
      throw error;
    }
  });
}

const Login = lazyWithRecovery(() => import("./pages/Login"), "login");
const Register = lazyWithRecovery(() => import("./pages/Register"), "register");
const ForgotPassword = lazyWithRecovery(() => import("./pages/ForgotPassword"), "forgot-password");
const ResetPassword = lazyWithRecovery(() => import("./pages/ResetPassword"), "reset-password");
const Dashboard = lazyWithRecovery(() => import("./pages/Dashboard"), "dashboard");
const Appointments = lazyWithRecovery(() => import("./pages/Appointments"), "appointments");
const Calendar = lazyWithRecovery(() => import("./pages/Calendar"), "calendar");
const Medications = lazyWithRecovery(() => import("./pages/Medications"), "medications");
const Documents = lazyWithRecovery(() => import("./pages/Documents"), "documents");
const Settings = lazyWithRecovery(() => import("./pages/Settings"), "settings");
const Timeline = lazyWithRecovery(() => import("./pages/Timeline"), "timeline");
const Stats = lazyWithRecovery(() => import("./pages/Stats"), "stats");
const MiSalud = lazyWithRecovery(() => import("./pages/MiSalud"), "mi-salud");
const Biometrics = lazyWithRecovery(() => import("./pages/Biometrics"), "biometrics");
const AiKlinip = lazyWithRecovery(() => import("./pages/AiKlinip"), "ai-klinip");
const ClinicalReports = lazyWithRecovery(() => import("./pages/ClinicalReports"), "clinical-reports");
const Landing = lazyWithRecovery(() => import("./pages/Landing"), "landing");
const Plans = lazyWithRecovery(() => import("./pages/Plans"), "plans");
const KlinipFeed = lazyWithRecovery(() => import("./pages/KlinipFeed"), "feed");
const KlinipVoicePage = lazyWithRecovery(() => import("./pages/KlinipVoicePage"), "voice");
const SharedVoicePage = lazyWithRecovery(() => import("./pages/SharedVoicePage"), "shared-voice");
const LegalPrivacy = lazyWithRecovery(() => import("./pages/LegalPrivacy"), "legal-privacy");
const LegalTerms = lazyWithRecovery(() => import("./pages/LegalTerms"), "legal-terms");
const LegalConsent = lazyWithRecovery(() => import("./pages/LegalConsent"), "legal-consent");
const LegalNotifications = lazyWithRecovery(() => import("./pages/LegalNotifications"), "legal-notifications");

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
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19.5a6 6 0 0 1 12 0" />
    </svg>
  ),
  family: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="9" r="2.5" />
      <circle cx="16" cy="9" r="2.5" />
      <path d="M3.5 19a4.5 4.5 0 0 1 9 0" />
      <path d="M11.5 19a4.5 4.5 0 0 1 9 0" />
    </svg>
  ),
  feed: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h8M8 14h5" />
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
  ai: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="6" width="14" height="12" rx="4" />
      <path d="M9 12h.01M12 12h.01M15 12h.01" />
      <path d="M12 3v2M4 12H2M22 12h-2M18.5 5.5 17 7M5.5 5.5 7 7" />
    </svg>
  ),
  aiMobile: <span className="icon-k" aria-hidden="true">K</span>,
  voice: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4M8 21h8" />
    </svg>
  ),
  ocr: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.2a2.4 2.4 0 0 1 2.4-2.4h1.1l.8-1.4a1.6 1.6 0 0 1 1.4-.8h4.6a1.6 1.6 0 0 1 1.4.8l.8 1.4h1.1A2.4 2.4 0 0 1 20 9.2v7.4a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 16.6z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  ),
};

const ROUTE_TRANSITION_ORDER = [
  "/",
  "/ai",
  "/voice",
  "/family",
  "/mi-salud",
  "/mi-salud/biometricos",
  "/appointments",
  "/calendar",
  "/timeline",
  "/documents",
  "/medications",
  "/stats",
  "/clinical-reports",
  "/settings",
  "/settings/familia",
];

const HEALTH_SECTION_PATHS = [
  "/mi-salud",
  "/mi-salud/biometricos",
  "/appointments",
  "/calendar",
  "/timeline",
  "/documents",
  "/medications",
  "/stats",
  "/clinical-reports",
];

function isSidebarLinkActive(pathname, link) {
  if (link.activePaths?.includes(pathname)) return true;
  return pathname === link.to;
}

function getRouteTransitionDirection(fromPath, toPath) {
  if (!fromPath || !toPath || fromPath === toPath) return "forward";
  const fromIndex = ROUTE_TRANSITION_ORDER.indexOf(fromPath);
  const toIndex = ROUTE_TRANSITION_ORDER.indexOf(toPath);
  if (fromIndex === -1 || toIndex === -1) {
    if (toPath.startsWith(fromPath)) return "forward";
    if (fromPath.startsWith(toPath)) return "backward";
    return "forward";
  }
  return toIndex >= fromIndex ? "forward" : "backward";
}

function getHealthProfileAccessLabel(item, userId) {
  if (!item) return "";
  const isOwnProfile = Number(item.owner_user_id) === Number(userId);
  if (isOwnProfile) return "propio";
  const ownerName = (item.owner_name || item.owner_email || "").trim();
  const ownerSuffix = ownerName ? ` · de ${ownerName.split(" ")[0]}` : "";
  if (item.is_primary_profile) return `titular${ownerSuffix}`;
  const role = (item.access_role || "").toLowerCase();
  if (role === "admin") return `admin${ownerSuffix}`;
  return `invitado${ownerSuffix}`;
}

function isPinProtectionActive(user) {
  return Boolean(user?.pin_enabled || user?.pin_set);
}

function Sidebar({
  user,
  notifications,
  planInfo,
  healthProfiles,
  activeProfileId,
  onSwitchProfile,
  switchingProfile,
  onOpenOcr,
}) {
  const location = useLocation();
  const isPublicAuthRoute =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/reset-password";
  const isAuthRoute =
    isPublicAuthRoute ||
    (!user && location.pathname === "/");
  const isPlansRoute =
    location.pathname === "/planes" || location.pathname.startsWith("/planes/");
  const isLegalRoute = location.pathname.startsWith("/legal/");
  const isSharedVoiceRoute = location.pathname.startsWith("/voice/shared/");
  const [isMobile, setIsMobile] = useState(() => isHandheldViewport(768));
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(isHandheldViewport(768));
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
    { to: "/", label: "Inicio", icon: icons.home, section: "main" },
    { to: "/ai", label: "Asistente", icon: icons.ai, section: "main" },
    { to: "/voice", label: "Voz", icon: icons.voice, section: "main" },
    { to: "/family", label: "Familia", icon: icons.family, activePaths: ["/family", "/feed"], section: "care" },
    {
      to: "/mi-salud",
      label: "Mi salud",
      icon: icons.heart,
      badge: notificationCounts.medications + notificationCounts.documents,
      activePaths: HEALTH_SECTION_PATHS,
      section: "care",
    },
  ];
  const desktopNavGroups = [
    { id: "main", label: "Principal" },
    { id: "care", label: "Salud y familia" },
  ];
  const mobilePrimaryLinks = ["/", "/voice", "/family", "/mi-salud"]
    .map((path) => links.find((item) => item.to === path))
    .filter(Boolean);
  const mobileOverflowLinks = [];
  const normalizedPlan = (planInfo?.plan_type || "basico").toLowerCase();
  const canSwitchProfiles =
    Array.isArray(healthProfiles) && healthProfiles.length > 1;
  const activeProfile =
    (healthProfiles || []).find((item) => Number(item.id) === Number(activeProfileId)) ||
    (healthProfiles || [])[0] ||
    null;
  const planLabel =
    normalizedPlan === "familiar"
      ? "Plan Familiar"
      : normalizedPlan === "plus"
      ? "Plan Plus"
      : "Plan Básico";
  const activeProfileAccessLabel = activeProfile
    ? getHealthProfileAccessLabel(activeProfile, user?.id)
    : "principal";
  const sidebarAlertsCount = notifications?.length || 0;
  const sidebarHealthCount =
    notificationCounts.medications + notificationCounts.documents;
  const sidebarInitial = (user?.name || "Klinip").slice(0, 1).toUpperCase();
  const mobileSidebarShellStyle = isMobile
    ? {
        left: "50%",
        right: "auto",
        bottom: "calc(0.78rem + env(safe-area-inset-bottom))",
        width: "min(calc(100vw - 2.2rem), 23.2rem)",
        maxWidth: "23.2rem",
        height: "auto",
        padding: "0.46rem 0.54rem 0.42rem",
        borderRadius: "1.9rem",
        transform: "translateX(-50%)",
        overflow: "visible",
        isolation: "isolate",
      }
    : undefined;

  useEffect(() => {
    setShowMobileMenu(false);
  }, [location.pathname, isMobile]);

  const renderMobileLink = (link) => (
    <Link
      key={link.to}
      to={link.to}
      className={`sidebar-link sidebar-link-mobile ${isSidebarLinkActive(location.pathname, link) ? "active" : ""} ${
        link.to === "/voice" ? "is-mobile-voice" : ""
      }`}
      aria-label={link.label}
      onClick={() => setShowMobileMenu(false)}
    >
      <span className="sidebar-icon sidebar-icon-mobile">{link.icon}</span>
      {link.badge > 0 && (
        <span className="sidebar-badge sidebar-badge-mobile">{link.badge}</span>
      )}
      <span className="sidebar-label sidebar-label-mobile">{link.label}</span>
    </Link>
  );

  if (isAuthRoute || isPlansRoute || isLegalRoute || isSharedVoiceRoute) return null;

  return (
    <aside
      className={`sidebar ${isMobile ? "sidebar-mobile-shell" : ""}`}
      style={mobileSidebarShellStyle}
    >
      <div className="sidebar-brand">
        <BrandLogo
          className="brand-wordmark-sidebar brand-logo-sidebar"
          markClassName="brand-logo-sidebar-mark"
          imgClassName="brand-logo-sidebar-img"
          nameClassName="brand-logo-sidebar-name"
        />
      </div>

      {!isMobile && (
        <div className="sidebar-desktop-panel">
          <div className="sidebar-desktop-plan-row">
            <span className="sidebar-desktop-plan-badge">{planLabel}</span>
            <span className="sidebar-desktop-plan-caption">Escritorio clínico</span>
          </div>

          <div className="sidebar-desktop-profile-card">
            <div className="sidebar-desktop-profile-head">
              <span className="sidebar-desktop-avatar" aria-hidden="true">
                {sidebarInitial}
              </span>
              <div className="sidebar-desktop-profile-copy">
                <p className="sidebar-desktop-profile-label">Perfil activo</p>
                <p className="sidebar-desktop-profile-name">
                  {activeProfile?.full_name || user?.name || "Perfil personal"}
                </p>
              </div>
            </div>
            <div className="sidebar-desktop-profile-meta">
              <span className="sidebar-desktop-profile-role">
                Acceso {activeProfileAccessLabel}
              </span>
              <span className="sidebar-desktop-profile-email">
                {user?.email || "sin-correo"}
              </span>
            </div>
            {canSwitchProfiles ? (
              <select
                className="sidebar-desktop-profile-select"
                value={activeProfileId || ""}
                onChange={(e) => onSwitchProfile?.(e.target.value)}
                disabled={!!switchingProfile}
                aria-label="Cambiar perfil de salud"
              >
                {(healthProfiles || []).map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.full_name}
                    {` (${getHealthProfileAccessLabel(item, user?.id)})`}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="sidebar-desktop-metrics" aria-label="Resumen lateral">
            <div className="sidebar-desktop-metric">
              <span className="sidebar-desktop-metric-value">{sidebarAlertsCount}</span>
              <span className="sidebar-desktop-metric-label">Alertas</span>
            </div>
            <div className="sidebar-desktop-metric">
              <span className="sidebar-desktop-metric-value">{sidebarHealthCount}</span>
              <span className="sidebar-desktop-metric-label">Pendientes</span>
            </div>
          </div>
        </div>
      )}

      <nav className={`sidebar-nav ${isMobile ? "sidebar-nav-mobile" : ""}`}>
        {isMobile ? (
          <>
            {mobilePrimaryLinks.slice(0, 2).map((link) => renderMobileLink(link))}
            <button
              type="button"
              className="sidebar-link sidebar-link-mobile is-mobile-ocr"
              aria-label="Escanear documento o tomar foto"
              onClick={() => {
                setShowMobileMenu(false);
                onOpenOcr?.();
              }}
            >
              <span className="sidebar-icon sidebar-icon-mobile sidebar-icon-ocr">
                {icons.ocr}
              </span>
              <span className="sidebar-label sidebar-label-mobile">Escanear</span>
            </button>
            {mobilePrimaryLinks.slice(2).map((link) => renderMobileLink(link))}
            {mobileOverflowLinks.length > 0 && (
              <>
                <button
                  type="button"
                  className={`sidebar-link sidebar-more ${showMobileMenu ? "active" : ""}`}
                  aria-label="Otros"
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
                        isSidebarLinkActive(location.pathname, link) ? "active" : ""
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
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="sidebar-scan-cta"
              onClick={() => onOpenOcr?.()}
            >
              <span className="sidebar-scan-cta-icon" aria-hidden="true">
                {icons.ocr}
              </span>
              <span className="sidebar-scan-cta-copy">
                <span className="sidebar-scan-cta-title">Escanear documento</span>
                <span className="sidebar-scan-cta-sub">Sube un examen o receta</span>
              </span>
            </button>
            {desktopNavGroups.map((group) => {
              const groupLinks = links.filter((link) => link.section === group.id);
              if (groupLinks.length === 0) return null;
              return (
                <div className="sidebar-nav-group" key={group.id}>
                  <div className="sidebar-section-label" aria-hidden="true">
                    {group.label}
                  </div>
                  {groupLinks.map((link) => {
                    const active = isSidebarLinkActive(location.pathname, link);
                    return (
                      <Link
                        key={link.to}
                        to={link.to}
                        className={`sidebar-link ${active ? "active" : ""}`}
                        aria-label={link.label}
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="sidebar-link-rail" aria-hidden="true" />
                        <span className="sidebar-icon">{link.icon}</span>
                        {link.badge > 0 && (
                          <span className="sidebar-badge">{link.badge}</span>
                        )}
                        <span className="sidebar-label">{link.label}</span>
                        <span className="sidebar-tooltip" role="presentation">
                          {link.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </nav>

      {!isMobile && (
        <div className="sidebar-desktop-footer">
          <Link to="/settings" className="sidebar-desktop-settings-link">
            <span className="sidebar-icon" aria-hidden="true">{icons.user}</span>
            <span className="sidebar-desktop-settings-copy">
              <span className="sidebar-desktop-settings-title">Ajustes de cuenta</span>
              <span className="sidebar-desktop-settings-subtitle">
                Perfil, plan y preferencias
              </span>
            </span>
          </Link>
        </div>
      )}

    </aside>
  );
}

function Topbar({
  user,
  notifications,
  onClearNotifications,
  onOpenNotification,
  onLogout,
  theme,
  onToggleTheme,
  planInfo,
  healthProfiles,
  activeProfileId,
  onSwitchProfile,
  switchingProfile,
  isDashboard,
}) {
  const location = useLocation();
  const navigate = useNavigate();

  const isAuthRoute =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/reset-password";
  const isPlansRoute =
    location.pathname === "/planes" || location.pathname.startsWith("/planes/");
  const isLegalRoute = location.pathname.startsWith("/legal/");
  const isSharedVoiceRoute = location.pathname.startsWith("/voice/shared/");
  const titles = {
    "/": "Inicio",
    "/appointments": "Citas",
    "/documents": "Documentos",
    "/medications": "Medicamentos",
    "/calendar": "Calendario",
    "/stats": "Estadísticas",
    "/ai": "Asistente",
    "/timeline": "Historia clínica",
    "/family": "Familia",
    "/feed": "Familia",
    "/voice": "Voz",
    "/mi-salud": "Mi salud",
    "/mi-salud/biometricos": "Biométricos",
    "/clinical-reports": "Reportes",
    "/settings": "Perfil",
    "/settings/familia": "Gestionar familia",
  };
  const title = titles[location.pathname] || "Panel";
  const subtitle =
    location.pathname === "/"
      ? "Panel general"
      : "Tu ruta de salud";
  const initials = (user?.name || "Klinip").slice(0, 1).toUpperCase();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [isMobileTopbar, setIsMobileTopbar] = useState(() => isHandheldViewport(768));
  const profileMenuRef = useRef(null);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  useEffect(() => {
    const handleResize = () => setIsMobileTopbar(isHandheldViewport(768));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  const normalizedPlan = (planInfo?.plan_type || "basico").toLowerCase();
  const canSwitchProfiles =
    Array.isArray(healthProfiles) && healthProfiles.length > 1;
  const activeProfile =
    (healthProfiles || []).find((item) => Number(item.id) === Number(activeProfileId)) ||
    (healthProfiles || [])[0] ||
    null;
  const planLabel =
    normalizedPlan === "familiar"
      ? "Plan Familiar"
      : normalizedPlan === "plus"
      ? "Plan Plus"
      : "Plan Básico";
  const activeProfileLabel = activeProfile
    ? getHealthProfileAccessLabel(activeProfile, user?.id)
    : "principal";

  if (isAuthRoute || isPlansRoute || isLegalRoute || isSharedVoiceRoute || (!user && location.pathname === "/")) return null;

  const topbarClass = [
    "topbar",
    isMobileTopbar && isDashboard ? "topbar-hidden-mobile" : "",
    isMobileTopbar && !isDashboard ? "topbar-mobile-compact" : "",
  ].filter(Boolean).join(" ");

  return (
    <header className={topbarClass}>
      <div className="topbar-main">
        <div>
          <p className="topbar-label">{subtitle}</p>
          <div className="topbar-row">
            <h2 className="topbar-title">{title}</h2>
            <span className="topbar-chip">{today}</span>
          </div>
        </div>
        {!isMobileTopbar && (
          <div className="topbar-highlights" aria-label="Resumen del contexto">
            <div className="topbar-highlight-card">
              <span className="topbar-highlight-label">Plan activo</span>
              <strong className="topbar-highlight-value">{planLabel}</strong>
            </div>
            <div className="topbar-highlight-card">
              <span className="topbar-highlight-label">Perfil actual</span>
              <strong className="topbar-highlight-value">
                {activeProfile?.full_name || user?.name || "Perfil personal"}
              </strong>
              <span className="topbar-highlight-note">
                Acceso {activeProfileLabel}
              </span>
            </div>
          </div>
        )}
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
                <span className="notifications-heading">Notificaciones</span>
                {notifications?.length > 0 && (
                  <button
                    className="secondary-btn notifications-clear-btn"
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
            <span className="topbar-avatar" aria-hidden="true">
              <svg className="topbar-avatar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="8" r="4"/>
                <path d="M6 20a6 6 0 0 1 12 0"/>
              </svg>
              <span className="topbar-avatar-initial">{initials}</span>
            </span>
            <span className="topbar-name">{user?.name || "Invitado"}</span>
          </button>
          {profileMenuOpen && (
            <div className="topbar-user-menu" role="menu">
              <div className="topbar-user-menu-head">
                <span className="topbar-user-menu-avatar">{initials}</span>
                <div>
                  <p className="topbar-user-menu-name">{user?.name || "Invitado"}</p>
                  <p className="topbar-user-menu-email">{user?.email || "sin-correo"}</p>
                </div>
              </div>
              <div className="topbar-user-menu-profile-card">
                <div className="topbar-user-menu-profile-head">
                  <span className="topbar-user-menu-profile-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="8" r="3.2" />
                      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
                    </svg>
                  </span>
                  <span className="topbar-user-menu-plan">{planLabel}</span>
                </div>
                <p className="topbar-user-menu-profile-name">
                  {activeProfile
                    ? `${activeProfile.full_name} (${getHealthProfileAccessLabel(activeProfile, user?.id)})`
                    : user?.name || "Perfil personal"}
                </p>
                {canSwitchProfiles ? (
                  <select
                    className="topbar-user-menu-profile-select"
                    value={activeProfileId || ""}
                    onChange={(e) => onSwitchProfile?.(e.target.value)}
                    disabled={!!switchingProfile}
                  >
                    {(healthProfiles || []).map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.full_name}
                        {` (${getHealthProfileAccessLabel(item, user?.id)})`}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              <div className="topbar-user-menu-actions">
                <button
                  type="button"
                  className="topbar-user-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    navigate("/settings");
                  }}
                >
                  <span className="topbar-user-menu-item-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="8" r="3.2" />
                      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
                    </svg>
                  </span>
                  <span>Mi perfil</span>
                </button>
                <button
                  type="button"
                  className="topbar-user-menu-item"
                  role="menuitem"
                >
                  <span className="topbar-user-menu-item-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
                    </svg>
                  </span>
                  <span className="topbar-user-theme-text">
                    {theme === "dark" ? "Modo oscuro" : "Modo claro"}
                  </span>
                  <label className="switch topbar-user-theme-switch">
                    <input
                      type="checkbox"
                      checked={theme === "dark"}
                      onChange={() => onToggleTheme?.()}
                    />
                    <span className="switch-slider" />
                  </label>
                </button>
              </div>
              <div className="topbar-user-menu-divider" />
              <button
                type="button"
                className="topbar-user-menu-item is-danger"
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false);
                  onLogout?.();
                }}
              >
                <span className="topbar-user-menu-item-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="M16 17l5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                </span>
                <span>Cerrar sesión</span>
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
const ONBOARDING_COMPLETED_KEY_BASE = "klinip_onboarding_completed_v2";
const NOTIF_PROMPT_DAYS = 5;
const NOTIF_PROMPT_SESSIONS = 5;
const MED_ALERT_POLL_MS = 60000;
const APP_LOCK_GRACE_MS = 0;
const MED_ALERT_INITIAL_DELAY_MS = 15000;
const FAMILY_CONTEXT_ROUTE_REFRESH_MS = 30000;
const BOOTSTRAP_SESSION_TIMEOUT_MS = 12000;
const ONBOARDING_TIMEZONE_OPTIONS = [
  "America/Santiago",
  "America/Lima",
  "America/Bogota",
  "America/Mexico_City",
  "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo",
  "America/New_York",
  "Europe/Madrid",
  "Europe/London",
  "UTC",
];
const getUserKey = (base, userId) => (userId ? `${base}_${userId}` : base);

const buildMedicationPromptKey = (med, date, slotKey = "") => {
  const day = date.toISOString().slice(0, 10);
  const slot = slotKey || med.schedule_time || "manual";
  return `klinip_med_prompt_${med.id}_${day}_${slot}`;
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
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

function RouteLoadingFallback() {
  return (
    <div className="route-loading-shell" role="status" aria-live="polite" aria-label="Cargando sección">
      <div className="route-loading-card">
        <span className="route-loading-dot" aria-hidden="true" />
        <div>
          <strong>Cargando sección</strong>
          <p>Preparando la siguiente vista.</p>
        </div>
      </div>
    </div>
  );
}

class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("Error cargando la ruta de Klinip:", error);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="route-loading-shell" role="alert" aria-live="assertive">
          <div className="route-loading-card route-error-card">
            <span className="route-error-icon" aria-hidden="true">!</span>
            <div>
              <strong>No pudimos abrir esta pantalla</strong>
              <p>La app intentará recuperar la vista. Si sigue igual, actualiza esta página.</p>
              <button className="route-error-btn" type="button" onClick={this.handleReload}>
                Actualizar ahora
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [appLocked, setAppLocked] = useState(false);
  const pinHiddenAtRef = useRef(0);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateRegistration, setUpdateRegistration] = useState(null);
  const [activeUpdateKey, setActiveUpdateKey] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      return savedTheme;
    }
    return "light";
  });
  const [booting, setBooting] = useState(true);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [notifConsentOpen, setNotifConsentOpen] = useState(false);
  const [notifSwitchChecked, setNotifSwitchChecked] = useState(false);
  const [notifSwitchLoading, setNotifSwitchLoading] = useState(false);
  const [notifSwitchMessage, setNotifSwitchMessage] = useState("");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingNotifLoading, setOnboardingNotifLoading] = useState(false);
  const [onboardingNotifMessage, setOnboardingNotifMessage] = useState("");
  const [planInfo, setPlanInfo] = useState(null);
  const [healthProfiles, setHealthProfiles] = useState([]);
  const [activeHealthProfileId, setActiveHealthProfileId] = useState(null);
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const [ocrWizardOpen, setOcrWizardOpen] = useState(false);
  const [isMobileShell, setIsMobileShell] = useState(() => isHandheldViewport(768));
  const [routeTransitionKey, setRouteTransitionKey] = useState(0);
  const [routeTransitionDirection, setRouteTransitionDirection] = useState("forward");
  const [onboardingData, setOnboardingData] = useState({
    notificationsConsent: "",
    timezone: "America/Santiago",
    reminderPreferredTime: "08:00",
    hasChronicCondition: "",
    chronicCondition: "",
    primaryCareCenter: "",
  });
  const globalMedCheckRef = useRef(Date.now() - MED_ALERT_POLL_MS);
  const medAlertPollingRef = useRef(false);
  const locationRef = useRef(location);
  const previousPathRef = useRef(location.pathname);
  const seenUpdateKeysRef = useRef(new Set());
  const dismissedUpdateKeyRef = useRef("");
  const pushNotifiedUpdateKeyRef = useRef("");
  const familyContextLoadingRef = useRef(false);
  const lastFamilyContextRefreshRef = useRef(0);

  useEffect(() => {
    document.body.classList.toggle("theme-dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    return observeMojibakeRepair(document.body);
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobileShell(isHandheldViewport(768));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    if (previousPath !== location.pathname) {
      setRouteTransitionDirection(getRouteTransitionDirection(previousPath, location.pathname));
      setRouteTransitionKey((current) => current + 1);
      previousPathRef.current = location.pathname;
    }
  }, [location.pathname]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const token = localStorage.getItem("token");
      if (!token) {
        if (active) setBooting(false);
        return;
      }
      try {
        const me = await withTimeout(
          getMe(),
          BOOTSTRAP_SESSION_TIMEOUT_MS,
          "La sesion inicial tardó demasiado."
        );
        if (!active) return;
        let resolvedUser = me;
        try {
          const pinStatus = await withTimeout(
            getAppPinStatus(),
            BOOTSTRAP_SESSION_TIMEOUT_MS,
            "La validacion del PIN tardó demasiado."
          );
          if (!active) return;
          resolvedUser = {
            ...me,
            pin_set: typeof pinStatus?.pin_set === "boolean" ? pinStatus.pin_set : me?.pin_set,
            pin_enabled:
              typeof pinStatus?.pin_enabled === "boolean"
                ? pinStatus.pin_enabled
                : me?.pin_enabled,
          };
        } catch (_) {
          resolvedUser = me;
        }
        setUser(resolvedUser);
      } catch (err) {
        if (!active) return;
        localStorage.removeItem("token");
        localStorage.removeItem("refresh_token");
        setUser(null);
      } finally {
        if (active) setBooting(false);
      }
    }
    bootstrap();
    return () => {
      active = false;
    };
  }, []);

  // Redirect to login when session expires (refresh token failed)
  useEffect(() => {
    const onSessionExpired = () => {
      setUser(null);
      navigate("/login", { replace: true });
    };
    window.addEventListener("klinip:session-expired", onSessionExpired);
    return () => window.removeEventListener("klinip:session-expired", onSessionExpired);
  }, [navigate]);

  // Bloqueo con PIN: al abrir la app con sesión activa, exigir PIN si está
  // activo. Solo se omite una vez cuando el propio usuario cerró sesión para
  // restaurarlo tras olvidarlo.
  useEffect(() => {
    if (booting) return;
    if (!user?.id) {
      setAppLocked(false);
      return;
    }
    if (consumePinRecoveryLogin()) {
      setAppLocked(false);
      return;
    }
    setAppLocked(isPinProtectionActive(user));
  }, [booting, user?.id, user?.pin_enabled, user?.pin_set]);

  // Re-bloqueo al volver de segundo plano. Si el PIN está activo, se vuelve a
  // pedir cada vez que la app reaparece.
  useEffect(() => {
    if (!user?.id) return undefined;
    const handleVisibility = () => {
      if (document.hidden) {
        pinHiddenAtRef.current = Date.now();
        return;
      }
      const hiddenFor = pinHiddenAtRef.current
        ? Date.now() - pinHiddenAtRef.current
        : 0;
      if (hiddenFor > APP_LOCK_GRACE_MS && isPinProtectionActive(user)) {
        setAppLocked(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [user?.id, user?.pin_enabled, user?.pin_set]);

  useEffect(() => {
    let mounted = true;
    const loadFamilyContext = async () => {
      if (!user?.id) {
        familyContextLoadingRef.current = false;
        lastFamilyContextRefreshRef.current = 0;
        if (!mounted) return;
        setPlanInfo(null);
        setHealthProfiles([]);
        setActiveHealthProfileId(null);
        return;
      }
      familyContextLoadingRef.current = true;
      try {
        const [plan, profiles, activeResult] = await Promise.allSettled([
          getMyPlan(),
          getHealthProfiles(),
          getActiveHealthProfile(),
        ]);
        if (!mounted) return;
        setPlanInfo(plan.status === "fulfilled" ? (plan.value || null) : null);
        const list = profiles.status === "fulfilled" && Array.isArray(profiles.value) ? profiles.value : [];
        setHealthProfiles(list);
        const active = activeResult.status === "fulfilled" ? activeResult.value : null;
        setActiveHealthProfileId(active?.id || list?.[0]?.id || null);
        lastFamilyContextRefreshRef.current = Date.now();
      } finally {
        familyContextLoadingRef.current = false;
      }
    };
    loadFamilyContext();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    if (familyContextLoadingRef.current) return;
    if (
      lastFamilyContextRefreshRef.current &&
      (Date.now() - lastFamilyContextRefreshRef.current) < FAMILY_CONTEXT_ROUTE_REFRESH_MS
    ) {
      return;
    }
    let cancelled = false;
    const refreshOnRoute = async () => {
      familyContextLoadingRef.current = true;
      try {
        const [profilesResult, activeResult] = await Promise.allSettled([
          getHealthProfiles(),
          getActiveHealthProfile(),
        ]);
        if (cancelled) return;
        const list = profilesResult.status === "fulfilled" && Array.isArray(profilesResult.value)
          ? profilesResult.value
          : [];
        const active = activeResult.status === "fulfilled" ? activeResult.value : null;
        setHealthProfiles(list);
        setActiveHealthProfileId(active?.id || list?.[0]?.id || null);
        lastFamilyContextRefreshRef.current = Date.now();
      } catch (_) {
        // noop: evitar ruido en cada cambio de ruta
      } finally {
        familyContextLoadingRef.current = false;
      }
    };
    refreshOnRoute();
    return () => {
      cancelled = true;
    };
  }, [location.pathname, user?.id]);

  useEffect(() => {
    if (!user || booting) return undefined;

    let active = true;

    const checkDueMedicationPopups = async () => {
      // Evita tráfico innecesario en pestañas en segundo plano.
      if (typeof document !== "undefined" && document.hidden) return;
      const currentPath = locationRef.current?.pathname || "";
      // Si el usuario ya está en medicamentos, evita doble polling (esa vista maneja su propio flujo).
      if (currentPath.startsWith("/medications")) return;
      if (medAlertPollingRef.current) return;

      const now = new Date();
      const nowTs = now.getTime();
      const lastChecked = globalMedCheckRef.current;
      medAlertPollingRef.current = true;

      try {
        const meds = (await getMedications()) || [];
        if (!active) return;

        const due = meds
          .flatMap((med) => {
            if (!isMedicationActiveAt(med, now)) return [];
            return getMedicationScheduleTimes(med)
              .map((slotKey) => {
                const slot = parseScheduleTimeValue(slotKey);
                if (!slot) return null;
                const trigger = new Date(now);
                trigger.setHours(slot.hour, slot.minute, 0, 0);
                const triggerTs = trigger.getTime();
                if (triggerTs <= lastChecked || triggerTs > nowTs) return null;
                const key = buildMedicationPromptKey(med, now, slotKey);
                if (localStorage.getItem(key)) return null;
                return { med, triggerTs, slotKey };
              })
              .filter(Boolean);
          })
          .sort((a, b) => a.triggerTs - b.triggerTs);

        if (due.length > 0) {
          const first = due[0].med;
          const key = buildMedicationPromptKey(first, now, due[0].slotKey);
          localStorage.setItem(key, "prompted");
          const target = `/medications?medicationId=${first.id}&source=reminder`;
          const currentSearch = locationRef.current?.search || "";
          if (!(currentPath === "/medications" && currentSearch.includes(`medicationId=${first.id}`))) {
            navigate(target);
          }
        }
      } catch (err) {
        console.error("No se pudo verificar alertas de medicamentos", err);
      } finally {
        medAlertPollingRef.current = false;
        globalMedCheckRef.current = nowTs;
      }
    };

    const initialTimeoutId = window.setTimeout(
      checkDueMedicationPopups,
      MED_ALERT_INITIAL_DELAY_MS
    );
    const intervalId = window.setInterval(checkDueMedicationPopups, MED_ALERT_POLL_MS);
    return () => {
      active = false;
      medAlertPollingRef.current = false;
      window.clearTimeout(initialTimeoutId);
      window.clearInterval(intervalId);
    };
  }, [user, booting, navigate]);

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
    const onboardingKey = getUserKey(ONBOARDING_COMPLETED_KEY_BASE, user.id);
    const onboardingDone = localStorage.getItem(onboardingKey) === "true";
    if (!onboardingDone || onboardingOpen) {
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
  }, [user, consentOpen, onboardingOpen]);

  useEffect(() => {
    if (!user || booting || consentOpen || notifConsentOpen) return;
    const onboardingKey = getUserKey(ONBOARDING_COMPLETED_KEY_BASE, user.id);
    const onboardingDone = localStorage.getItem(onboardingKey) === "true";
    if (onboardingDone) return;
    const notifConsent = localStorage.getItem(
      getUserKey(NOTIF_CONSENT_KEY_BASE, user.id)
    ) || "";
    setOnboardingData({
      notificationsConsent: notifConsent,
      timezone: user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Santiago",
      reminderPreferredTime: user?.reminder_preferred_time || "08:00",
      hasChronicCondition: (user?.chronic_condition || "").trim() ? "yes" : "no",
      chronicCondition: user?.chronic_condition || "",
      primaryCareCenter: user?.primary_care_center || "",
    });
    setOnboardingNotifMessage("");
    setOnboardingStep(0);
    setOnboardingOpen(true);
  }, [user, booting, consentOpen, notifConsentOpen]);

  useEffect(() => {
    clearScheduledNotifications();
    if (!user) return;
    const consentValue =
      localStorage.getItem(getUserKey(NOTIF_CONSENT_KEY_BASE, user.id)) || "";
    const pushRegistered =
      localStorage.getItem(getUserKey(PUSH_REGISTERED_KEY_BASE, user.id)) === "true";
    const browserNotificationsEnabled =
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted";
    const usePushOnly =
      consentValue === "accepted" && browserNotificationsEnabled && pushRegistered;
    if (usePushOnly) {
      return;
    }
    let active = true;
    let refreshSequence = 0;
    const refreshScheduledNotifications = async (sources = []) => {
      const currentSequence = ++refreshSequence;
      const normalizedSources = Array.isArray(sources) ? sources : [];
      const refreshAppointments =
        normalizedSources.length === 0 || normalizedSources.includes("appointments");
      const refreshMedications =
        normalizedSources.length === 0 || normalizedSources.includes("medications");

      if (!refreshAppointments && !refreshMedications) return;

      try {
        const [appointments, medications] = await Promise.all([
          refreshAppointments ? getAppointments().catch(() => []) : Promise.resolve(null),
          refreshMedications ? getMedications().catch(() => []) : Promise.resolve(null),
        ]);
        if (!active || currentSequence !== refreshSequence) return;
        if (refreshAppointments) {
          scheduleReminderNotifications(appointments || []);
        }
        if (refreshMedications) {
          scheduleMedicationNotifications(medications || []);
        }
      } catch (err) {
        console.warn("No se pudieron programar notificaciones", err);
      }
    };

    refreshScheduledNotifications();
    const unsubscribeClinicalRefresh = subscribeClinicalDataChanged((detail) => {
      refreshScheduledNotifications(detail?.sources || []);
    });

    return () => {
      active = false;
      unsubscribeClinicalRefresh();
    };
  }, [user]);

  useEffect(() => {
    if (!notifConsentOpen || !user) {
      setNotifSwitchLoading(false);
      return;
    }
    const consentKey = getUserKey(NOTIF_CONSENT_KEY_BASE, user.id);
    const storedConsent = localStorage.getItem(consentKey) || "";
    const grantedByBrowser =
      "Notification" in window && Notification.permission === "granted";
    const enabled = storedConsent === "accepted" || grantedByBrowser;
    setNotifSwitchChecked(enabled);
    setNotifSwitchMessage(
      enabled ? "Notificaciones activadas." : ""
    );
  }, [notifConsentOpen, user]);

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
      const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
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
      const justApplied = sessionStorage.getItem("klinip-sw-applied");
      if (justApplied) {
        sessionStorage.removeItem("klinip-sw-applied");
        return;
      }
      const reg = await registerServiceWorker().catch(() => null);
      if (!active) return;
      if (reg?.waiting && navigator.serviceWorker.controller) {
        const waitingKey = reg.waiting.scriptURL || reg.scope || "klinip-sw-update";
        if (!seenUpdateKeysRef.current.has(waitingKey)) {
          seenUpdateKeysRef.current.add(waitingKey);
          setUpdateRegistration(reg);
          setActiveUpdateKey(waitingKey);
          setUpdateAvailable(true);
        }
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
      const updateKey =
        event.detail?.updateKey ||
        reg?.waiting?.scriptURL ||
        reg?.installing?.scriptURL ||
        reg?.active?.scriptURL ||
        reg?.scope ||
        "klinip-sw-update";
      if (sessionStorage.getItem("klinip-sw-applied")) return;
      if (localStorage.getItem("klinip-sw-last-applied") === updateKey) return;
      const dismissedKey = dismissedUpdateKeyRef.current || "";
      if (dismissedKey && dismissedKey === updateKey) return;
      if (seenUpdateKeysRef.current.has(updateKey)) return;
      seenUpdateKeysRef.current.add(updateKey);
      setUpdateRegistration(reg);
      setActiveUpdateKey(updateKey);
      setUpdateAvailable(true);
      const pushNotifiedKey =
        pushNotifiedUpdateKeyRef.current ||
        localStorage.getItem("klinip-sw-push-notified") ||
        "";
      if (
        pushNotifiedKey !== updateKey &&
        "Notification" in window &&
        Notification.permission === "granted" &&
        reg?.showNotification
      ) {
        reg
          .showNotification("Actualización de Klinip disponible", {
            body: "Hay una nueva versión lista. Actualiza para ver los cambios más recientes.",
            icon: "/icons/android-chrome-192x192.png?v=20260523a",
          })
          .then(() => {
            pushNotifiedUpdateKeyRef.current = updateKey;
            localStorage.setItem("klinip-sw-push-notified", updateKey);
          })
          .catch(() => null);
      }
    };
    window.addEventListener("klinip-sw-update", onUpdate);
    return () => window.removeEventListener("klinip-sw-update", onUpdate);
  }, []);

  const handleDismissUpdate = () => {
    if (activeUpdateKey) {
      dismissedUpdateKeyRef.current = activeUpdateKey;
    }
    setUpdateAvailable(false);
  };

  const handleApplyUpdate = async () => {
    sessionStorage.setItem("klinip-sw-applied", "1");
    if (activeUpdateKey) {
      localStorage.setItem("klinip-sw-last-applied", activeUpdateKey);
    }
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

  const handleLogout = async () => {
    const registeredKey = getUserKey(PUSH_REGISTERED_KEY_BASE, user?.id);
    const endpointKey = getUserKey(PUSH_ENDPOINT_KEY_BASE, user?.id);
    const pushCleanup = Promise.race([
      removePushSubscription().catch(() => false),
      new Promise((resolve) => window.setTimeout(() => resolve(false), 1500)),
    ]);
    localStorage.removeItem("token");
    if (registeredKey) localStorage.removeItem(registeredKey);
    if (endpointKey) localStorage.removeItem(endpointKey);
    localStorage.removeItem(LAST_USER_ID_KEY);
    if (user?.id) {
      const key = getUserKey(NOTIFICATION_STORAGE_KEY_BASE, user.id);
      localStorage.removeItem(key);
    }
    setAppLocked(false);
    setUser(null);
    setBooting(false);
    navigate("/login", { replace: true });
    try {
      await pushCleanup;
    } catch (_) {
      // noop
    }
    try {
      await apiLogout?.();
    } catch (_) {
      // noop
    }
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
    setNotifSwitchLoading(true);
    setNotifSwitchMessage("");
    (async () => {
      try {
        const consentKey = getUserKey(NOTIF_CONSENT_KEY_BASE, user?.id);
        const lastPromptKey = getUserKey(NOTIF_LAST_PROMPT_KEY_BASE, user?.id);
        if (!("Notification" in window)) {
          setNotifSwitchChecked(false);
          setNotifSwitchMessage("Este navegador no soporta notificaciones.");
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
          setNotifSwitchChecked(true);
          setNotifSwitchMessage("Notificaciones activadas.");
          localStorage.setItem(consentKey, "accepted");
          await updateMe({ notifications_consent: "accepted" });
          await ensurePushSubscription();
        } else if (permission === "denied") {
          setNotifSwitchChecked(false);
          setNotifSwitchMessage("Permiso denegado en el navegador.");
          localStorage.setItem(consentKey, "rejected");
          await updateMe({ notifications_consent: "rejected" });
        } else {
          setNotifSwitchChecked(false);
          setNotifSwitchMessage("Permiso no concedido.");
          localStorage.setItem(consentKey, "later");
          localStorage.setItem(lastPromptKey, new Date().toISOString());
          await updateMe({
            notifications_consent: "later",
            notifications_last_prompt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error("Error solicitando permiso de notificaciones", err);
        setNotifSwitchChecked(false);
        setNotifSwitchMessage("No se pudo activar notificaciones.");
        const consentKey = getUserKey(NOTIF_CONSENT_KEY_BASE, user?.id);
        const lastPromptKey = getUserKey(NOTIF_LAST_PROMPT_KEY_BASE, user?.id);
        localStorage.setItem(consentKey, "later");
        localStorage.setItem(lastPromptKey, new Date().toISOString());
        updateMe({
          notifications_consent: "later",
          notifications_last_prompt: new Date().toISOString(),
        }).catch(() => null);
      } finally {
        setNotifSwitchLoading(false);
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

  const handleSkipOnboarding = () => {
    if (!user?.id) return;
    const onboardingKey = getUserKey(ONBOARDING_COMPLETED_KEY_BASE, user.id);
    const consentKey = getUserKey(NOTIF_CONSENT_KEY_BASE, user.id);
    const lastPromptKey = getUserKey(NOTIF_LAST_PROMPT_KEY_BASE, user.id);
    if (!localStorage.getItem(consentKey)) {
      localStorage.setItem(consentKey, "later");
      localStorage.setItem(lastPromptKey, new Date().toISOString());
      updateMe({
        notifications_consent: "later",
        notifications_last_prompt: new Date().toISOString(),
      }).catch(() => null);
    }
    localStorage.setItem(onboardingKey, "true");
    setOnboardingOpen(false);
  };

  const handleOnboardingEnableNotifications = async () => {
    if (!user?.id) return;
    setOnboardingNotifLoading(true);
    setOnboardingNotifMessage("");
    try {
      if (!("Notification" in window)) {
        setOnboardingData((prev) => ({ ...prev, notificationsConsent: "later" }));
        setOnboardingNotifMessage("Este navegador no soporta notificaciones.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        await ensurePushSubscription();
        setOnboardingData((prev) => ({ ...prev, notificationsConsent: "accepted" }));
        setOnboardingNotifMessage("Notificaciones activadas.");
      } else if (permission === "denied") {
        setOnboardingData((prev) => ({ ...prev, notificationsConsent: "rejected" }));
        setOnboardingNotifMessage("Permiso denegado. Puedes cambiarlo después.");
      } else {
        setOnboardingData((prev) => ({ ...prev, notificationsConsent: "later" }));
        setOnboardingNotifMessage("Puedes activarlas más tarde desde tu perfil.");
      }
    } catch (err) {
      console.error("Error habilitando notificaciones en onboarding", err);
      setOnboardingData((prev) => ({ ...prev, notificationsConsent: "later" }));
      setOnboardingNotifMessage("No se pudo activar notificaciones ahora.");
    } finally {
      setOnboardingNotifLoading(false);
    }
  };

  const handleSwitchActiveProfile = async (profileId) => {
    const nextId = Number(profileId || 0);
    if (!nextId || Number.isNaN(nextId)) return;
    setSwitchingProfile(true);
    try {
      const active = await setActiveHealthProfile(nextId);
      setActiveHealthProfileId(active?.id || nextId);
      const profiles = await getHealthProfiles().catch(() => []);
      if (Array.isArray(profiles)) {
        setHealthProfiles(profiles);
      }
      lastFamilyContextRefreshRef.current = Date.now();
    } catch (err) {
      console.error("No se pudo cambiar el perfil activo en header:", err);
    } finally {
      setSwitchingProfile(false);
    }
  };

  const handleCompleteOnboarding = async () => {
    if (!user?.id) return;
    setOnboardingSaving(true);
    try {
      const condition =
        onboardingData.hasChronicCondition === "yes"
          ? (onboardingData.chronicCondition || "").trim()
          : "";
      const center = (onboardingData.primaryCareCenter || "").trim();
      const notifConsent = onboardingData.notificationsConsent || "later";
      const nowIso = new Date().toISOString();
      const updated = await updateMe({
        timezone: onboardingData.timezone,
        reminder_preferred_time: onboardingData.reminderPreferredTime,
        chronic_condition: condition,
        primary_care_center: center,
        notifications_consent: notifConsent,
        notifications_last_prompt: nowIso,
      });
      setUser(updated || user);
      const consentKey = getUserKey(NOTIF_CONSENT_KEY_BASE, user.id);
      const lastPromptKey = getUserKey(NOTIF_LAST_PROMPT_KEY_BASE, user.id);
      localStorage.setItem(consentKey, notifConsent);
      localStorage.setItem(lastPromptKey, nowIso);
      const onboardingKey = getUserKey(ONBOARDING_COMPLETED_KEY_BASE, user.id);
      localStorage.setItem(onboardingKey, "true");
      setOnboardingOpen(false);
    } catch (err) {
      console.error("Error guardando onboarding", err);
    } finally {
      setOnboardingSaving(false);
    }
  };



  if (booting) {
    return (
      <div className="app-shell">
        <div className="main-content">
          <div className="splash splash-brand" role="status" aria-live="polite" aria-label="Cargando Klinip">
            <div className="splash-brand-shell">
              <div className="splash-brand-orbit" aria-hidden="true">
                <span className="splash-brand-orbit-ring splash-brand-orbit-ring-outer" />
                <span className="splash-brand-orbit-ring splash-brand-orbit-ring-inner" />
                <span className="splash-brand-core">
                  <span className="splash-brand-core-glow" />
                  <BrandMark
                    variant="solid"
                    className="splash-brand-core-logo"
                    imgClassName="splash-brand-core-logo-img"
                  />
                </span>
              </div>
              <p className="splash-brand-kicker">Plataforma clínica inteligente</p>
              <div className="brand-wordmark splash-brand-wordmark" aria-label="Klinip">
                <span className="brand-wordmark-full">Klinip</span>
              </div>
              <p className="splash-brand-text">Preparando tu entorno de salud y sincronizando datos clave.</p>
              <div className="splash-brand-progress" aria-hidden="true">
                <span />
              </div>
              <p className="splash-brand-footnote">Cargando módulos clínicos y recordatorios personalizados</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isPlansRoute =
    location.pathname === "/planes" || location.pathname.startsWith("/planes/");
  const isLegalRoute = location.pathname.startsWith("/legal/");
  const isSharedVoiceRoute = location.pathname.startsWith("/voice/shared/");
  const isPublicMarketingRoute =
    (!user && location.pathname === "/") ||
    location.pathname === "/personas" ||
    location.pathname === "/empresas" ||
    isPlansRoute;
  const isPublicAuthRoute =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/reset-password";
  const isPublicStandaloneRoute =
    isPublicMarketingRoute || isLegalRoute || isSharedVoiceRoute || isPublicAuthRoute;
  const isAiRoute = location.pathname === "/ai";
  const hideAppChrome = isAiRoute;
  const showAppChrome = !hideAppChrome && !isPublicStandaloneRoute;
  // En la IA mantenemos la experiencia inmersiva, pero en móvil mostramos la navbar.
  const showAiNavbar = isAiRoute && isMobileShell;
  const isFamilyRoute = location.pathname === "/family";
  const isSettingsRoute = location.pathname.startsWith("/settings");
  const isDashboardRoute = location.pathname === "/" && !!user;

  return (
    <div className="app-shell">
      {appLocked && user ? (
        <PinLock
          user={user}
          hasExistingPin={isPinProtectionActive(user)}
          onUnlock={() => setAppLocked(false)}
          onLogout={handleLogout}
        />
      ) : null}
      {consentOpen && (
        <div className="consent-backdrop">
          <div className="consent-card" role="dialog" aria-modal="true">
            <p className="consent-kicker">Asistente Klinip</p>
            <h2 className="consent-title">Acepta los documentos legales</h2>
            <p className="consent-text">
              Antes de continuar, revisa y acepta los documentos legales de Klinip.
            </p>
            <div className="consent-links">
              <Link to="/legal/terms" className="secondary-btn" target="_blank" rel="noreferrer">
                Términos de uso
              </Link>
              <Link to="/legal/privacy" className="secondary-btn" target="_blank" rel="noreferrer">
                Política de privacidad
              </Link>
              <Link to="/legal/consent" className="secondary-btn" target="_blank" rel="noreferrer">
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
                 He leído y acepto los Términos, la Política de Privacidad y el
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
              Aceptar términos
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
              Activa las notificaciones para medicamentos, citas y exámenes.
              Puedes cambiar esta configuración desde tu perfil cuando quieras.
            </p>
            <div className="consent-switch-row">
              <div>
                <p className="consent-switch-title">Activar notificaciones</p>
                <p className="consent-switch-sub">Recibe alertas importantes en tu dispositivo.</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={notifSwitchChecked}
                  disabled={notifSwitchLoading}
                  onChange={(event) => {
                    if (event.target.checked) {
                      handleAcceptNotifications();
                    } else if (notifSwitchChecked) {
                      setNotifSwitchChecked(true);
                    }
                  }}
                />
                <span className="switch-slider" />
              </label>
            </div>
            {notifSwitchMessage ? (
              <p className="consent-switch-sub" style={{ marginTop: "0.5rem" }}>
                {notifSwitchMessage}
              </p>
            ) : null}
            <div className="consent-actions">
              <button className="secondary-btn" type="button" onClick={handleLaterNotifications}>
                  {notifSwitchChecked ? "Cerrar" : "Configurar después"}
              </button>
              <button className="ghost-btn" type="button" onClick={handleLearnMoreNotifications}>
                 Aprender más
              </button>
            </div>
          </div>
        </div>
      )}
      {onboardingOpen && (
        <div className="ob-backdrop">
          <div className="ob-overlay" role="dialog" aria-modal="true" aria-label="Bienvenida a Klinip">
            {onboardingStep < 4 && (
              <button
                className="ob-skip"
                type="button"
                onClick={handleSkipOnboarding}
                disabled={onboardingSaving}
              >
                {onboardingStep + 1}/5 &nbsp; Saltar
              </button>
            )}

            <div className="ob-illus-wrap">
              {onboardingStep === 0 && (
                <svg className="ob-illus" viewBox="0 0 260 230" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="130" cy="108" r="80" fill="rgba(255,255,255,0.12)" />
                  <ellipse cx="130" cy="88" rx="26" ry="29" fill="rgba(255,255,255,0.95)" />
                  <ellipse cx="130" cy="68" rx="26" ry="14" fill="#7c3aed" opacity="0.85" />
                  <rect x="103" y="117" width="54" height="55" rx="10" fill="rgba(255,255,255,0.95)" />
                  <rect x="116" y="117" width="9" height="32" rx="4" fill="#dbeafe" />
                  <rect x="135" y="117" width="9" height="32" rx="4" fill="#dbeafe" />
                  <path d="M112 140 Q103 152 108 163" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" fill="none" />
                  <circle cx="109" cy="165" r="6" fill="#2563eb" />
                  <rect x="121" y="128" width="9" height="22" rx="2.5" fill="#2563eb" />
                  <rect x="115" y="134" width="21" height="9" rx="2.5" fill="#2563eb" />
                  <circle cx="62" cy="86" r="20" fill="rgba(255,255,255,0.18)" />
                  <path d="M55 86h14M62 79v14" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx="198" cy="92" r="20" fill="rgba(255,255,255,0.18)" />
                  <path d="M198 84c-7 0-12 5-12 10s9 11 12 13c3-2 12-8 12-13s-5-10-12-10z" fill="#fff" />
                  <circle cx="185" cy="138" r="15" fill="rgba(255,255,255,0.18)" />
                  <path d="M179 138l4 5 7-9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="78" cy="144" r="15" fill="rgba(255,255,255,0.18)" />
                  <rect x="72" y="137" width="13" height="14" rx="2.5" fill="none" stroke="#fff" strokeWidth="2" />
                  <path d="M75 143h7M75 147h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              )}
              {onboardingStep === 1 && (
                <svg className="ob-illus" viewBox="0 0 260 210" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="130" cy="105" r="78" fill="rgba(255,255,255,0.12)" />
                  <path d="M130 38c-33 0-50 28-50 56v28l-12 13h124l-12-13V94c0-28-17-56-50-56z" fill="rgba(255,255,255,0.93)" />
                  <circle cx="130" cy="148" r="12" fill="rgba(255,255,255,0.93)" />
                  <circle cx="130" cy="28" r="9" fill="rgba(255,255,255,0.93)" />
                  <circle cx="178" cy="58" r="16" fill="#ef4444" />
                  <rect x="177" y="50" width="2" height="9" rx="1" fill="#fff" />
                  <circle cx="178" cy="62" r="1.5" fill="#fff" />
                  <rect x="58" y="78" width="44" height="27" rx="7" fill="rgba(255,255,255,0.22)" />
                  <rect x="64" y="84" width="22" height="3.5" rx="2" fill="#fff" />
                  <rect x="64" y="91" width="15" height="3.5" rx="2" fill="rgba(255,255,255,0.7)" />
                  <rect x="160" y="83" width="44" height="27" rx="7" fill="rgba(255,255,255,0.22)" />
                  <rect x="166" y="89" width="22" height="3.5" rx="2" fill="#fff" />
                  <rect x="166" y="96" width="15" height="3.5" rx="2" fill="rgba(255,255,255,0.7)" />
                  <rect x="78" y="160" width="104" height="27" rx="7" fill="rgba(255,255,255,0.18)" />
                  <rect x="85" y="167" width="42" height="3.5" rx="2" fill="#fff" />
                  <rect x="85" y="174" width="28" height="3.5" rx="2" fill="rgba(255,255,255,0.7)" />
                </svg>
              )}
              {onboardingStep === 2 && (
                <svg className="ob-illus" viewBox="0 0 260 210" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="130" cy="105" r="78" fill="rgba(255,255,255,0.12)" />
                  <circle cx="130" cy="100" r="60" fill="rgba(255,255,255,0.93)" stroke="rgba(255,255,255,0.4)" strokeWidth="3" />
                  <circle cx="130" cy="100" r="6" fill="#2563eb" />
                  <line x1="130" y1="100" x2="130" y2="57" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" />
                  <line x1="130" y1="100" x2="157" y2="112" stroke="#1d4ed8" strokeWidth="3" strokeLinecap="round" />
                  <line x1="130" y1="43" x2="130" y2="50" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="130" y1="150" x2="130" y2="157" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="73" y1="100" x2="80" y2="100" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="180" y1="100" x2="187" y2="100" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="93" y1="60" x2="98" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
                  <line x1="162" y1="134" x2="167" y2="140" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
                  <line x1="167" y1="60" x2="162" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
                  <line x1="98" y1="134" x2="93" y2="140" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="64" cy="160" r="24" fill="rgba(255,255,255,0.2)" />
                  <ellipse cx="64" cy="160" rx="8" ry="18" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
                  <line x1="46" y1="160" x2="82" y2="160" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
                  <line x1="64" y1="142" x2="64" y2="178" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
                  <circle cx="196" cy="155" r="24" fill="rgba(255,255,255,0.2)" />
                  <ellipse cx="196" cy="155" rx="8" ry="18" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
                  <line x1="178" y1="155" x2="214" y2="155" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
                  <line x1="196" y1="137" x2="196" y2="173" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
                </svg>
              )}
              {onboardingStep === 3 && (
                <svg className="ob-illus" viewBox="0 0 260 230" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="130" cy="115" r="80" fill="rgba(255,255,255,0.12)" />
                  <rect x="74" y="58" width="112" height="138" rx="12" fill="rgba(255,255,255,0.93)" />
                  <rect x="100" y="46" width="60" height="24" rx="7" fill="rgba(255,255,255,0.93)" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
                  <rect x="84" y="84" width="92" height="3.5" rx="2" fill="#e2e8f0" />
                  <rect x="84" y="96" width="66" height="3.5" rx="2" fill="#e2e8f0" />
                  <polyline points="84,122 96,122 103,105 110,138 117,112 124,122 150,122 157,111 164,132 170,122" stroke="#2563eb" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <path d="M130 155c0 0-16-9-16-20 0-6 5-10 9-10 3 0 5 2 7 5 2-3 4-5 7-5 4 0 9 4 9 10 0 11-16 20-16 20z" fill="#ef4444" />
                  <ellipse cx="92" cy="170" rx="11" ry="7" fill="#dbeafe" transform="rotate(-30 92 170)" />
                  <line x1="86" y1="165" x2="98" y2="175" stroke="#93c5fd" strokeWidth="2.2" />
                  <circle cx="168" cy="96" r="11" fill="rgba(37,99,235,0.18)" />
                  <path d="M162 96l4 5 8-9" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {onboardingStep === 4 && (
                <svg className="ob-illus" viewBox="0 0 260 230" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="130" cy="115" r="80" fill="rgba(255,255,255,0.12)" />
                  <path d="M130 42c0 0-36 35-36 76 0 18 12 30 36 36 24-6 36-18 36-36 0-41-36-76-36-76z" fill="rgba(255,255,255,0.93)" />
                  <circle cx="130" cy="105" r="14" fill="#bfdbfe" />
                  <circle cx="130" cy="105" r="8" fill="#2563eb" />
                  <path d="M94 118 L77 142 L100 136z" fill="rgba(255,255,255,0.75)" />
                  <path d="M166 118 L183 142 L160 136z" fill="rgba(255,255,255,0.75)" />
                  <ellipse cx="130" cy="162" rx="14" ry="17" fill="rgba(251,191,36,0.85)" />
                  <ellipse cx="130" cy="170" rx="8" ry="11" fill="rgba(249,115,22,0.9)" />
                  <circle cx="72" cy="76" r="5" fill="rgba(255,255,255,0.7)" />
                  <circle cx="188" cy="88" r="4" fill="rgba(255,255,255,0.6)" />
                  <circle cx="82" cy="148" r="6" fill="rgba(255,255,255,0.55)" />
                  <circle cx="178" cy="142" r="5" fill="rgba(255,255,255,0.65)" />
                  <circle cx="95" cy="58" r="4" fill="rgba(255,255,255,0.55)" />
                  <circle cx="162" cy="62" r="6" fill="rgba(255,255,255,0.7)" />
                  <rect x="52" y="182" width="56" height="30" rx="8" fill="rgba(255,255,255,0.22)" />
                  <rect x="59" y="190" width="26" height="3.5" rx="2" fill="#fff" />
                  <rect x="59" y="197" width="18" height="3.5" rx="2" fill="rgba(255,255,255,0.7)" />
                  <rect x="152" y="182" width="56" height="30" rx="8" fill="rgba(255,255,255,0.22)" />
                  <rect x="159" y="190" width="26" height="3.5" rx="2" fill="#fff" />
                  <rect x="159" y="197" width="18" height="3.5" rx="2" fill="rgba(255,255,255,0.7)" />
                </svg>
              )}
            </div>

            <div className="ob-card">
              <div className="ob-card-content">
                {onboardingStep === 0 && (
                  <>
                    <h2 className="ob-title">Organiza tu salud en un solo lugar</h2>
                    <p className="ob-text">Gestiona medicamentos, citas y documentos médicos de forma simple. Te guiaremos en pocos pasos.</p>
                  </>
                )}
                {onboardingStep === 1 && (
                  <>
                    <h2 className="ob-title">Nunca olvides un medicamento</h2>
                    <p className="ob-text">Activa recordatorios y recibe alertas de medicamentos, citas y documentos pendientes.</p>
                    <div className="ob-actions-col">
                      <button
                        className="ob-action-btn ob-action-primary"
                        type="button"
                        onClick={handleOnboardingEnableNotifications}
                        disabled={onboardingNotifLoading}
                      >
                        {onboardingNotifLoading ? "Activando..." : "Activar notificaciones"}
                      </button>
                      <button
                        className="ob-action-btn ob-action-ghost"
                        type="button"
                        onClick={() => setOnboardingData((prev) => ({ ...prev, notificationsConsent: "later" }))}
                        disabled={onboardingNotifLoading}
                      >
                        Ahora no
                      </button>
                    </div>
                    {onboardingNotifMessage && <p className="ob-msg">{onboardingNotifMessage}</p>}
                  </>
                )}
                {onboardingStep === 2 && (
                  <>
                    <h2 className="ob-title">Ajusta tus preferencias</h2>
                    <p className="ob-text">Indica tu zona horaria y la hora preferida para recibir recordatorios.</p>
                    <div className="ob-form">
                      <input
                        className="ob-input"
                        list="onboarding-timezone-options"
                        value={onboardingData.timezone}
                        onChange={(e) => setOnboardingData((prev) => ({ ...prev, timezone: e.target.value }))}
                        placeholder="Zona horaria (ej: America/Santiago)"
                      />
                      <datalist id="onboarding-timezone-options">
                        {ONBOARDING_TIMEZONE_OPTIONS.map((tz) => (<option value={tz} key={tz} />))}
                      </datalist>
                      <label className="ob-input-label">Hora preferida de recordatorio</label>
                      <input
                        className="ob-input"
                        type="time"
                        value={onboardingData.reminderPreferredTime}
                        onChange={(e) => setOnboardingData((prev) => ({ ...prev, reminderPreferredTime: e.target.value || "08:00" }))}
                      />
                    </div>
                  </>
                )}
                {onboardingStep === 3 && (
                  <>
                    <h2 className="ob-title">Personaliza tu perfil de salud</h2>
                    <p className="ob-text">¿Tienes una condición crónica? Nos ayuda a darte mejores recomendaciones.</p>
                    <div className="ob-toggle-row">
                      <button
                        className={`ob-toggle-btn${onboardingData.hasChronicCondition === "yes" ? " ob-toggle-active" : ""}`}
                        type="button"
                        onClick={() => setOnboardingData((prev) => ({ ...prev, hasChronicCondition: "yes" }))}
                      >Sí</button>
                      <button
                        className={`ob-toggle-btn${onboardingData.hasChronicCondition === "no" ? " ob-toggle-active" : ""}`}
                        type="button"
                        onClick={() => setOnboardingData((prev) => ({ ...prev, hasChronicCondition: "no", chronicCondition: "" }))}
                      >No</button>
                    </div>
                    <div className="ob-form">
                      {onboardingData.hasChronicCondition === "yes" && (
                        <input
                          className="ob-input"
                          type="text"
                          value={onboardingData.chronicCondition}
                          onChange={(e) => setOnboardingData((prev) => ({ ...prev, chronicCondition: e.target.value }))}
                          placeholder="Ej: hipertensión, diabetes, asma..."
                        />
                      )}
                      <input
                        className="ob-input"
                        type="text"
                        value={onboardingData.primaryCareCenter}
                        onChange={(e) => setOnboardingData((prev) => ({ ...prev, primaryCareCenter: e.target.value }))}
                        placeholder="Centro habitual (opcional): CESFAM, Clínica..."
                      />
                    </div>
                  </>
                )}
                {onboardingStep === 4 && (
                  <>
                    <h2 className="ob-title">¡Listo para comenzar!</h2>
                    <p className="ob-text">Elige por dónde empezar o explora Klinip por tu cuenta.</p>
                    <div className="ob-quick-actions">
                      <button className="ob-quick-btn" type="button" onClick={() => { handleSkipOnboarding(); navigate("/documents"); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 3.5h7l3 3.5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" /><path d="M14 3.5v4h3" /><path d="M9 12h6M9 15h4" /></svg>
                        Subir documento
                      </button>
                      <button className="ob-quick-btn" type="button" onClick={() => { handleSkipOnboarding(); navigate("/medications"); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="6" width="14" height="15" rx="2" /><path d="M10.5 3h3a1.5 1.5 0 0 1 1.5 1.5v1.5H9V4.5A1.5 1.5 0 0 1 10.5 3Z" /><path d="M9 13h6M12 10v6" /></svg>
                        Medicamentos
                      </button>
                      <button className="ob-quick-btn" type="button" onClick={() => { handleSkipOnboarding(); navigate("/appointments"); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2.5" /></svg>
                        Agendar cita
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="ob-footer">
                <div className="ob-dots">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span key={i} className={`ob-dot${onboardingStep === i ? " ob-dot-active" : ""}`} />
                  ))}
                </div>
                <div className="ob-nav">
                  {onboardingStep > 0 && (
                    <button
                      className="ob-back-btn"
                      type="button"
                      onClick={() => setOnboardingStep((prev) => Math.max(prev - 1, 0))}
                      disabled={onboardingSaving}
                      aria-label="Paso anterior"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                  )}
                  {onboardingStep < 4 ? (
                    <button
                      className="ob-cta"
                      type="button"
                      onClick={() => setOnboardingStep((prev) => Math.min(prev + 1, 4))}
                      disabled={
                        onboardingSaving ||
                        (onboardingStep === 3 &&
                          onboardingData.hasChronicCondition === "yes" &&
                          !(onboardingData.chronicCondition || "").trim())
                      }
                    >
                      Continuar
                    </button>
                  ) : (
                    <button
                      className="ob-cta"
                      type="button"
                      onClick={handleCompleteOnboarding}
                      disabled={onboardingSaving}
                    >
                      {onboardingSaving ? "Guardando..." : "Comenzar"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="layout">
        {showAppChrome || showAiNavbar ? (
          <Sidebar
            user={user}
            notifications={notifications}
            planInfo={planInfo}
            healthProfiles={healthProfiles}
            activeProfileId={activeHealthProfileId}
            onSwitchProfile={handleSwitchActiveProfile}
            switchingProfile={switchingProfile}
            onOpenOcr={() => setOcrWizardOpen(true)}
          />
        ) : null}
        <div className={`main-area ${isPublicStandaloneRoute ? "main-area-public" : ""} ${
          hideAppChrome ? "main-area-ai-immersive" : ""
        } ${showAiNavbar ? "main-area-ai-immersive-nav" : ""}`}>
          {showAppChrome ? (
            <Topbar
              user={user}
              notifications={notifications}
              onClearNotifications={handleClearNotifications}
              onOpenNotification={handleOpenNotification}
              onLogout={handleLogout}
              theme={theme}
              onToggleTheme={handleToggleTheme}
              planInfo={planInfo}
              healthProfiles={healthProfiles}
              activeProfileId={activeHealthProfileId}
              onSwitchProfile={handleSwitchActiveProfile}
              switchingProfile={switchingProfile}
              isDashboard={isDashboardRoute}
            />
          ) : null}
          {updateAvailable && !isPublicStandaloneRoute && !hideAppChrome && (
            <div className="update-banner" role="status" aria-live="polite">
              <div>
                <p className="update-title">Actualización disponible</p>
                <p className="update-text">
                  Hay una nueva versión de Klinip. Actualiza para aplicar los cambios.
                </p>
              </div>
              <div className="update-actions">
                <button className="primary-btn" type="button" onClick={handleApplyUpdate}>
                  Actualizar ahora
                </button>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={handleDismissUpdate}
                >
                  Después
                </button>
              </div>
            </div>
          )}
          <main
            className={`main-content ${isPublicStandaloneRoute ? "main-content-landing" : ""} ${
              isAiRoute ? "main-content-ai" : ""
            } ${isFamilyRoute ? "main-content-family" : ""} ${
              isSettingsRoute ? "main-content-settings" : ""
            } ${isDashboardRoute ? "main-content-dashboard" : ""} ${
              hideAppChrome ? "main-content-ai-immersive" : ""
            }`}
          >
            <div
              key={`${location.pathname}-${routeTransitionKey}`}
              className={`route-scene route-scene-${routeTransitionDirection} ${
                isMobileShell ? "route-scene-mobile" : "route-scene-desktop"
              } ${hideAppChrome ? "route-scene-ai-immersive" : ""}`}
            >
            <RouteErrorBoundary resetKey={location.pathname}>
            <React.Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              <Route
                path="/login"
                element={
                  user ? (
                    <Navigate
                      to={
                        location.state?.from
                          ? location.state.from.pathname + (location.state.from.search || "")
                          : "/"
                      }
                      replace
                    />
                  ) : (
                    <Login onAuthenticated={setUser} />
                  )
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
              <Route path="/voice/shared/:token" element={<SharedVoicePage />} />
              <Route
                path="/planes"
                element={<Plans user={user} />}
              />
              <Route
                path="/planes/:planSlug"
                element={<Plans user={user} />}
              />
              <Route
                path="/"
                element={
                  user ? (
                    <ProtectedRoute user={user}>
                      <Dashboard
                        key={`dashboard-${activeHealthProfileId || "none"}`}
                        user={user}
                        notifications={notifications}
                        onClearNotifications={handleClearNotifications}
                        onOpenNotification={handleOpenNotification}
                        onLogout={handleLogout}
                        theme={theme}
                        onToggleTheme={handleToggleTheme}
                        planInfo={planInfo}
                        healthProfiles={healthProfiles}
                        activeProfileId={activeHealthProfileId}
                        onSwitchProfile={handleSwitchActiveProfile}
                        switchingProfile={switchingProfile}
                      />
                    </ProtectedRoute>
                  ) : (
                    <Landing theme={theme} onToggleTheme={handleToggleTheme} audience="people" />
                  )
                }
              />
              <Route
                path="/personas"
                element={<Landing theme={theme} onToggleTheme={handleToggleTheme} audience="people" />}
              />
              <Route
                path="/empresas"
                element={<Landing theme={theme} onToggleTheme={handleToggleTheme} audience="business" />}
              />
              <Route
                path="/appointments"
                element={
                  <ProtectedRoute user={user}>
                    <Appointments key={`appointments-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/documents"
                element={
                  <ProtectedRoute user={user}>
                    <Documents key={`documents-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/medications"
                element={
                  <ProtectedRoute user={user}>
                    <Medications key={`medications-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/calendar"
                element={
                  <ProtectedRoute user={user}>
                    <Calendar key={`calendar-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/timeline"
                element={
                  <ProtectedRoute user={user}>
                    <Timeline key={`timeline-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/stats"
                element={
                  <ProtectedRoute user={user}>
                    <Stats key={`stats-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/mi-salud"
                element={
                  <ProtectedRoute user={user}>
                    <MiSalud key={`mi-salud-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/mi-salud/biometricos"
                element={
                  <ProtectedRoute user={user}>
                    <Biometrics key={`biometrics-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/mi-salud/biometricos/:metricType"
                element={
                  <ProtectedRoute user={user}>
                    <Biometrics key={`biometrics-detail-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/ai"
                element={
                  <ProtectedRoute user={user}>
                    <AiKlinip key={`ai-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/clinical-reports"
                element={
                  <ProtectedRoute user={user}>
                    <ClinicalReports key={`clinical-reports-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/family"
                element={
                  <ProtectedRoute user={user}>
                    <KlinipFeed user={user} />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute user={user}>
                    <Settings
                      key={`settings-${activeHealthProfileId || "none"}`}
                      user={user}
                      onLogout={handleLogout}
                      theme={theme}
                      onToggleTheme={handleToggleTheme}
                      onUserUpdate={setUser}
                      initialSection="perfil"
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings/familia"
                element={
                  <ProtectedRoute user={user}>
                    <Settings
                      key={`settings-family-${activeHealthProfileId || "none"}`}
                      user={user}
                      onLogout={handleLogout}
                      theme={theme}
                      onToggleTheme={handleToggleTheme}
                      onUserUpdate={setUser}
                      initialSection="familia"
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/feed"
                element={
                  <ProtectedRoute user={user}>
                    <Navigate to="/family" replace />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/voice"
                element={
                  <ProtectedRoute user={user}>
                    <KlinipVoicePage key={`voice-${activeHealthProfileId || "none"}`} />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </React.Suspense>
            </RouteErrorBoundary>
            </div>
          </main>
        </div>
        {!hideAppChrome && user ? (
          <DocumentUploadWizard
            open={ocrWizardOpen}
            onClose={() => setOcrWizardOpen(false)}
            profileId={activeHealthProfileId}
            onUploaded={() => {
              notifyClinicalDataChanged({
                profileId: activeHealthProfileId,
                sources: ["documents", "health-radar"],
              });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
