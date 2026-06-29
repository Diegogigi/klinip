import React, { useState, useMemo, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import NotificationSettings from "../components/NotificationSettings";
import SuccessSheet from "../components/SuccessSheet";
import StepUpModal from "../components/StepUpModal";
import PinLock from "../components/PinLock";
import { getMe, disableAppPin } from "../api";
import { isHandheldViewport } from "../utils/mobileViewport";
import {
  updateMe,
  getAppointments,
  getDocuments,
  getMyPlan,
  getHealthProfiles,
  getActiveHealthProfile,
  createHealthProfile,
  setActiveHealthProfile,
  getFamilyPanel,
  getProfileCaregivers,
  inviteProfileCaregiver,
  getProfileInvitations,
  getMyPendingProfileInvitations,
  acceptProfileInvitation,
  updateProfileRelationship,
  removeProfileRelationship,
  revokeProfileInvitation,
  getHealthProfileActivity,
  getFamilyAlerts,
  getFamilyReportSummary,
  getAiFamilyContext,
  runFamilyAutomations,
  getProfileAutomation,
  updateProfileAutomation,
  getProfileNotes,
  createProfileNote,
  revokeDataConsent,
  deleteAccount as deleteAccountApi,
  submitPrivacyRequest,
  getMfaStatus,
  startMfaEnroll,
  verifyMfaEnrollment,
  disableMfa,
  regenerateMfaBackupCodes,
  getSessions,
  revokeSession,
  revokeAllSessions,
  getAuditLogs,
} from "../api";
import { toIsoOrNull, toLocaleDateOrEmpty, toLocaleDateTimeOrEmpty } from "../utils/dates";
import { ensureArray } from "../utils/arrays";

const ACTION_TYPE_LABELS = {
  invitation_accepted: "Invitación aceptada",
  invitation_created: "Invitación enviada",
  invitation_revoked: "Invitación revocada",
  invitation_rejected: "Invitación rechazada",
  member_removed: "Miembro eliminado",
  access_granted: "Acceso otorgado",
  access_revoked: "Acceso revocado",
  profile_updated: "Perfil actualizado",
  ai_conversation_deleted: "Conversación IA eliminada",
  ai_conversation_renamed: "Conversación IA renombrada",
  document_uploaded: "Documento subido",
  medication_added: "Medicamento agregado",
  appointment_created: "Cita creada",
  note_added: "Nota agregada",
  note_updated: "Nota actualizada",
  note_deleted: "Nota eliminada",
};

const SECURITY_EVENT_LABELS = {
  login_ok: "Inicio de sesión correcto",
  login_fail: "Inicio de sesión rechazado",
  mfa_enroll_started: "Configuración de app autenticadora iniciada",
  mfa_enabled: "App autenticadora activada",
  mfa_disabled: "App autenticadora desactivada",
  mfa_backup_codes_regenerated: "Códigos de respaldo regenerados",
  stepup_granted: "Acceso sensible autorizado",
  stepup_failed: "Verificación sensible rechazada",
  stepup_email_requested: "Código temporal enviado al correo",
  stepup_email_failed: "Código temporal por correo rechazado",
  document_downloaded: "Documento descargado",
};

const getNameInitials = (value, fallback = "PF") =>
  String(value || fallback)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || fallback;

function FamilyAvatar({ name, avatarUrl, className, style, fallback = "PF" }) {
  return (
    <span className={className} style={style} aria-hidden="true">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="family-avatar-img" />
      ) : (
        getNameInitials(name, fallback)
      )}
    </span>
  );
}

const getSecurityEventLabel = (action) =>
  SECURITY_EVENT_LABELS[action] || String(action || "evento").replace(/_/g, " ");

const getSecurityEventTone = (action) => {
  const normalized = String(action || "").toLowerCase();
  if (normalized.includes("fail") || normalized.includes("failed")) return "is-danger";
  if (normalized.includes("email") || normalized.includes("mfa")) return "is-info";
  return "is-success";
};

const getSessionDeviceSummary = (deviceLabel) => {
  const raw = String(deviceLabel || "").trim();
  if (!raw) {
    return {
      title: "Dispositivo sin nombre",
      detail: "",
    };
  }

  const browserMatch =
    raw.match(/Edg\/([\d.]+)/i) ||
    raw.match(/Chrome\/([\d.]+)/i) ||
    raw.match(/Firefox\/([\d.]+)/i) ||
    raw.match(/Version\/([\d.]+).*Safari/i) ||
    raw.match(/Safari\/([\d.]+)/i);
  const browserName = browserMatch
    ? browserMatch[0].startsWith("Edg")
      ? `Edge ${browserMatch[1].split(".")[0]}`
      : browserMatch[0].startsWith("Chrome")
      ? `Chrome ${browserMatch[1].split(".")[0]}`
      : browserMatch[0].startsWith("Firefox")
      ? `Firefox ${browserMatch[1].split(".")[0]}`
      : `Safari ${browserMatch[1].split(".")[0]}`
    : "";

  let platform = "";
  if (/Windows/i.test(raw)) platform = "Windows";
  else if (/Android/i.test(raw)) platform = "Android";
  else if (/(iPhone|iPad|iOS)/i.test(raw)) platform = "iPhone";
  else if (/Mac OS X|Macintosh/i.test(raw)) platform = "macOS";
  else if (/Linux/i.test(raw)) platform = "Linux";

  const title = [browserName, platform].filter(Boolean).join(" · ") || "Dispositivo desconocido";
  return {
    title,
    detail: "",
  };
};

export default function Settings({ user, onLogout, onUserUpdate, initialSection = "perfil" }) {
  const profile = user || {};
  const navigate = useNavigate();
  const location = useLocation();
  const [exporting, setExporting] = useState(false);
  const [consentRevoked, setConsentRevoked] = useState(() => {
    return localStorage.getItem("klinip_consent_revoked") === "true";
  });
  const [privacyReason, setPrivacyReason] = useState("acceso");
  const [privacyMessage, setPrivacyMessage] = useState("");
  const [privacyIncludeTech, setPrivacyIncludeTech] = useState(true);
  const [privacySending, setPrivacySending] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState("");
  const [privacySuccessMessage, setPrivacySuccessMessage] = useState("");
  const [showPrivacySuccessModal, setShowPrivacySuccessModal] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeSection, setActiveSection] = useState(initialSection || "perfil");

  // ── PIN de la app (a nivel de cuenta, en el backend) ──
  const [pinEnabled, setPinEnabled] = useState(() => Boolean(user?.pin_enabled));
  const [pinHasSet, setPinHasSet] = useState(() => Boolean(user?.pin_set));
  const [pinFlow, setPinFlow] = useState(null); // null | "enable" | "change"
  const [pinNotice, setPinNotice] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const pinSupported = true;

  useEffect(() => {
    setPinEnabled(Boolean(user?.pin_enabled));
    setPinHasSet(Boolean(user?.pin_set));
  }, [user?.pin_enabled, user?.pin_set]);

  const refreshUserAfterPin = async () => {
    try {
      const me = await getMe();
      onUserUpdate?.(me);
      setPinEnabled(Boolean(me?.pin_enabled));
      setPinHasSet(Boolean(me?.pin_set));
    } catch (_) {
      // noop
    }
  };

  const handlePinToggle = async (next) => {
    setPinNotice("");
    if (next) {
      // Activar siempre pasa por crear el PIN (no existe aún en el servidor).
      setPinFlow("enable");
    } else {
      // Desactivar: borra el PIN en el servidor (en todos los dispositivos).
      setPinBusy(true);
      try {
        await disableAppPin();
        await refreshUserAfterPin();
        setPinEnabled(false);
        setPinHasSet(false);
        setPinNotice("El PIN se desactivó para esta cuenta.");
      } catch (_) {
        setPinNotice("No se pudo desactivar el bloqueo. Revisa tu conexión.");
      } finally {
        setPinBusy(false);
      }
    }
  };

  const handlePinFlowDone = async () => {
    const wasChange = pinFlow === "change";
    setPinFlow(null);
    await refreshUserAfterPin();
    setPinNotice(
      wasChange
        ? "PIN actualizado para tu cuenta."
        : "PIN creado y bloqueo activado para tu cuenta.",
    );
  };

  const handlePinFlowCancel = () => {
    setPinFlow(null);
  };

  // ── MFA state ──
  const [mfaStatus, setMfaStatus] = useState(null); // { mfa_enabled, backup_codes_remaining }
  const [mfaEnrollData, setMfaEnrollData] = useState(null); // { totp_uri, secret, backup_codes }
  const [mfaEnrollCode, setMfaEnrollCode] = useState("");
  const [mfaDisableCode, setMfaDisableCode] = useState("");
  const [mfaRegenCode, setMfaRegenCode] = useState("");
  const [mfaNewBackupCodes, setMfaNewBackupCodes] = useState(null);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaNotice, setMfaNotice] = useState("");
  // ── Sessions state ──
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  // ── Audit log state ──
  const [auditLogs, setAuditLogs] = useState([]);
  // ── Step-up state ──
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPending, setStepUpPending] = useState(null); // action name string
  const [auditLoading, setAuditLoading] = useState(false);
  const [isMobileSettings, setIsMobileSettings] = useState(() =>
    typeof window !== "undefined" ? isHandheldViewport(640) : false
  );
  const [mobileSectionOpen, setMobileSectionOpen] = useState(false);
  const [planInfo, setPlanInfo] = useState(null);
  const [familyProfiles, setFamilyProfiles] = useState([]);
  const [activeFamilyProfileId, setActiveFamilyProfileId] = useState(null);
  const [familyStatus, setFamilyStatus] = useState("");
  const [familyLoading, setFamilyLoading] = useState(false);
  const [newFamilyProfile, setNewFamilyProfile] = useState({
    full_name: "",
    relation_with_owner: "",
    gender: "",
  });
  const [familyPanelCards, setFamilyPanelCards] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [myPendingInvitations, setMyPendingInvitations] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [familyAlerts, setFamilyAlerts] = useState([]);
  const [familyReport, setFamilyReport] = useState(null);
  const [familyAiContext, setFamilyAiContext] = useState(null);
  const [automationStatus, setAutomationStatus] = useState("");
  const [automationSettings, setAutomationSettings] = useState({
    smart_alerts_enabled: true,
    medication_overdue_alerts: true,
    upcoming_appointment_alerts: true,
    inactivity_alerts: true,
    weekly_family_report_enabled: false,
    auto_email_caregivers: false,
  });
  const [profileNotes, setProfileNotes] = useState([]);
  const [newProfileNote, setNewProfileNote] = useState("");
  const [showAllProfileNotes, setShowAllProfileNotes] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    role: "viewer",
    relationship_type: "",
  });
  const [familyStandalonePanel, setFamilyStandalonePanel] = useState(null);
  const plan = planInfo?.plan_type || "basico";
  const familyRoleLabel = (role) => {
    const normalizedRole = String(role || "viewer").trim().toLowerCase();
    if (normalizedRole === "admin") return "Administrador";
    if (normalizedRole === "caregiver") return "Editor";
    return "Lector";
  };
  const familyRoleAccessSummary = (role) => {
    const normalizedRole = String(role || "viewer").trim().toLowerCase();
    if (normalizedRole === "admin") {
      return "Puedes ver, editar y gestionar colaboradores.";
    }
    if (normalizedRole === "caregiver") {
      return "Puedes ver y editar datos clínicos.";
    }
    return "Solo puedes revisar la información compartida.";
  };
  const openSettingsSuccess = (payload) => {
    setSettingsSuccess({
      secondaryLabel: "Seguir revisando",
      ...payload,
    });
  };
  const getActivityNotePreview = (entry) => {
    const preview = entry?.metadata?.note_preview;
    return typeof preview === "string" ? preview.trim() : "";
  };

  const detectedTimezone = useMemo(() => {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Santiago";
  }, []);
  const [timezone, setTimezone] = useState(profile.timezone || detectedTimezone || "America/Santiago");
  const [reminderPreferredTime, setReminderPreferredTime] = useState(profile.reminder_preferred_time || "08:00");
  const [timezoneStatus, setTimezoneStatus] = useState("");
  const [chronicCondition, setChronicCondition] = useState(profile.chronic_condition || "");
  const [primaryCareCenter, setPrimaryCareCenter] = useState(profile.primary_care_center || "");
  const [healthProfileStatus, setHealthProfileStatus] = useState("");
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(() => {
    if (typeof profile.email_reminders_enabled === "boolean") {
      return profile.email_reminders_enabled;
    }
    return localStorage.getItem("klinip_email_reminders_enabled") === "true";
  });
  const [emailReminderStatus, setEmailReminderStatus] = useState("");
  const profileDisplayName = profile.name || "Usuario Klinip";
  const profileDisplayEmail = profile.email || "sin-correo";
  const normalizedProfileEmail = String(profile.email || "").trim().toLowerCase();
  const profileInitial = (profileDisplayName || profileDisplayEmail).trim().charAt(0).toUpperCase();
  const isFamilyStandalone = (initialSection || "perfil") === "familia";
  const familyNameInputRef = useRef(null);
  const familyInviteEmailRef = useRef(null);
  const familyCreateCardRef = useRef(null);
  const familyInviteCardRef = useRef(null);
  const familyRolesCardRef = useRef(null);

  const normalizeCaregivers = (items) => {
    const seen = new Set();
    return ensureArray(items).filter((row) => {
      const rowEmail = String(row?.user_email || "").trim().toLowerCase();
      const isSelfRow =
        (normalizedProfileEmail && rowEmail === normalizedProfileEmail) ||
        String(row?.relationship_type || "").toLowerCase() === "self";
      if (isSelfRow) return false;

      const key =
        row?.user_id
          ? `user:${row.user_id}`
          : row?.user_email
            ? `email:${String(row.user_email).trim().toLowerCase()}`
            : `row:${row?.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const timezoneOptions = [
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

  const familyAccentTones = [
    { key: "green", start: "#0ea5e9", end: "#2563eb", soft: "#e0f2fe", border: "#bae6fd" },
    { key: "violet", start: "#7c3aed", end: "#a78bfa", soft: "#f3e8ff", border: "#ddd6fe" },
    { key: "teal", start: "#0891b2", end: "#22c55e", soft: "#ecfeff", border: "#a5f3fc" },
    { key: "amber", start: "#f59e0b", end: "#fb7185", soft: "#fff7ed", border: "#fed7aa" },
  ];

  useEffect(() => {
    setTimezone(profile.timezone || detectedTimezone || "America/Santiago");
    setReminderPreferredTime(profile.reminder_preferred_time || "08:00");
    setChronicCondition(profile.chronic_condition || "");
    setPrimaryCareCenter(profile.primary_care_center || "");
    if (typeof profile.email_reminders_enabled === "boolean") {
      setEmailRemindersEnabled(profile.email_reminders_enabled);
      localStorage.setItem(
        "klinip_email_reminders_enabled",
        profile.email_reminders_enabled ? "true" : "false"
      );
    }
  }, [profile.id, profile.timezone, profile.reminder_preferred_time, profile.chronic_condition, profile.primary_care_center, profile.email_reminders_enabled, detectedTimezone]);

  const planMaxProfiles = planInfo?.max_profiles ?? 1;
  const planCurrentProfiles = planInfo?.current_profiles ?? familyProfiles.length;
  const familySlotsRemaining = Math.max(planMaxProfiles - planCurrentProfiles, 0);
  const panelByProfileId = new Map((familyPanelCards || []).map((item) => [Number(item.profile_id), item]));
  const familyMemberCards = familyProfiles.map((item, index) => {
    const panel = panelByProfileId.get(Number(item.id)) || {};
    const tone = familyAccentTones[index % familyAccentTones.length];
    const isOwnProfile = Number(item.owner_user_id) === Number(profile?.id);
    const isPrimaryProfile = Boolean(item.is_primary_profile);
    const roleLabel = familyRoleLabel(item.access_role);
    const relationLabel = panel.relationship || item.relation_with_owner || "Perfil de salud";
    const ageLabel = typeof panel.age_years === "number" ? `${panel.age_years} años` : null;
    const relationshipLabel = isOwnProfile
      ? "Perfil administrado desde tu cuenta"
      : isPrimaryProfile
      ? "Perfil principal del plan familiar"
      : `${relationLabel}${ageLabel ? ` - ${ageLabel}` : ""}`;
    const badgeLabel = isOwnProfile
      ? "Tu perfil"
      : isPrimaryProfile
      ? "Titular del plan"
      : "Perfil compartido";
    const accessSummary = isOwnProfile
      ? "Administrador desde tu cuenta."
      : roleLabel;
    const accessHint = isOwnProfile
      ? "Este perfil no depende de una invitación externa."
      : isPrimaryProfile
      ? familyRoleAccessSummary(item.access_role)
      : `Acceso otorgado desde otra cuenta. ${familyRoleAccessSummary(item.access_role)}`;
    return {
      ...item,
      tone,
      initials: getNameInitials(item.full_name, "PF"),
      avatarUrl: item.avatar_url || "",
      relationshipLabel,
      badgeLabel,
      accessSummary,
      accessHint,
      isOwner: isOwnProfile,
    };
  });
  const familyReportHighlight =
    familyReport?.profiles?.find((item) => Number(item.profile_id) === Number(activeFamilyProfileId)) ||
    familyReport?.profiles?.[0] ||
    null;
  const activeHealthProfile =
    familyProfiles.find((item) => Number(item.id) === Number(activeFamilyProfileId)) || familyProfiles[0] || null;
  const collaboratorCards = (caregivers || []).map((row, index) => {
    const tone = familyAccentTones[(familyMemberCards.length + index) % familyAccentTones.length];
    return {
      id: `collab-${row.id}`,
      relationshipId: row.id,
      tone,
      initials: getNameInitials(row.user_name || row.user_email, "CO"),
      avatarUrl: row.user_avatar_url || "",
      name: row.user_name || row.user_email || `Usuario #${row.user_id}`,
      email: row.user_email || "",
      relationshipLabel: row.relationship_type || "Colaborador",
      accessLabel: familyRoleLabel(row.role),
      permissionSummary:
        row.role === "admin"
          ? "Puede ver, editar y gestionar colaboradores."
        : row.role === "caregiver"
          ? "Puede ver y editar datos clínicos."
          : "Acceso de solo lectura.",
      sharedProfileName: activeHealthProfile?.full_name || "Perfil activo",
    };
  });
  const bannerParticipants = [...familyMemberCards, ...collaboratorCards];
  const linkedMembersCount = familyMemberCards.length + collaboratorCards.length;
  const activeHealthProfileRole = String(activeHealthProfile?.access_role || "").trim().toLowerCase();
  const isActiveHealthProfileOwner =
    !!activeHealthProfile && Number(activeHealthProfile.owner_user_id) === Number(profile?.id);
  const canEditActiveFamilyProfile =
    !!activeHealthProfile && (isActiveHealthProfileOwner || ["admin", "caregiver"].includes(activeHealthProfileRole));
  const canManageActiveFamilyProfile =
    !!activeHealthProfile && (isActiveHealthProfileOwner || activeHealthProfileRole === "admin");
  const shouldLoadFamilyAnalytics = !isFamilyStandalone;
  const shouldLoadFamilyActivity = !isFamilyStandalone;
  const shouldLoadFamilyAutomation = !isFamilyStandalone;
  const shouldLoadFamilyNotes = !isFamilyStandalone;
  const visibleProfileNotes = showAllProfileNotes ? profileNotes : profileNotes.slice(0, 3);
  const canToggleProfileNotes = profileNotes.length > 3;
  const hasRelevantFamilyAiSignals = Boolean(
    familyAiContext &&
      (
        Number(familyAiContext.active_alerts_total || 0) > 0 ||
        Number(familyAiContext.low_adherence_profiles || 0) > 0 ||
        Number(familyAiContext.pending_documents_total || 0) > 0 ||
        (familyAiContext.profiles || []).some(
          (item) =>
            Number(item.active_alerts || 0) > 0 ||
            Boolean(item.low_adherence) ||
            Number(item.pending_documents_count || 0) > 0
        )
      )
  );
  const chronicConditionTags = (chronicCondition || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const settingsSections = [
    { id: "perfil", label: "Perfil", icon: "profile" },
    { id: "seguridad", label: "Seguridad", icon: "shield" },
    { id: "privacidad", label: "Privacidad", icon: "shield" },
    { id: "notificaciones", label: "Notificaciones", icon: "bell" },
    { id: "datos", label: "Exportar datos", icon: "export" },
    { id: "reportes", label: "Reportes IA", icon: "legal" },
    { id: "legal", label: "Legal", icon: "legal" },
  ];
  const mfaNoticeTone =
    mfaNotice && /(correctamente|activado|regenerados|desactivado)/i.test(mfaNotice)
      ? "is-success"
      : "is-danger";

  useEffect(() => {
    const onResize = () => {
      const isMobile = isHandheldViewport(640);
      setIsMobileSettings(isMobile);
      if (!isMobile) {
        setMobileSectionOpen(false);
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setActiveSection(initialSection || "perfil");
    if ((initialSection || "perfil") === "familia" && isMobileSettings) {
      setMobileSectionOpen(true);
    }
  }, [initialSection, isMobileSettings]);

  useEffect(() => {
    setShowAllProfileNotes(false);
  }, [activeFamilyProfileId]);

  useEffect(() => {
    setFamilyStandalonePanel(null);
  }, [activeFamilyProfileId]);

  useEffect(() => {
    let mounted = true;
    const loadFamilyContext = async () => {
      if (!profile?.id) return;
      setFamilyLoading(true);
      try {
        const [plan, profiles, active] = await Promise.all([
          getMyPlan(),
          getHealthProfiles(),
          getActiveHealthProfile(),
        ]);
        if (!mounted) return;
        setPlanInfo(plan || null);
        setFamilyProfiles(ensureArray(profiles));
        setActiveFamilyProfileId(active?.id || null);
      } catch (err) {
        if (!mounted) return;
        console.error("No se pudo cargar contexto familiar:", err);
      } finally {
        if (mounted) setFamilyLoading(false);
      }
    };
    loadFamilyContext();
    return () => {
      mounted = false;
    };
  }, [profile?.id]);

  useEffect(() => {
    let mounted = true;
    const loadFamilyDetails = async () => {
      if (!profile?.id) return;
      try {
        const [cards, alerts, report, aiContext, pendingForMe] = await Promise.all([
          getFamilyPanel(),
          shouldLoadFamilyAnalytics ? getFamilyAlerts().catch(() => []) : Promise.resolve([]),
          shouldLoadFamilyAnalytics ? getFamilyReportSummary(30).catch(() => null) : Promise.resolve(null),
          shouldLoadFamilyAnalytics ? getAiFamilyContext(30).catch(() => null) : Promise.resolve(null),
          getMyPendingProfileInvitations().catch(() => []),
        ]);
        if (mounted) setFamilyPanelCards(ensureArray(cards));
        if (mounted) setFamilyAlerts(ensureArray(alerts));
        if (mounted) setFamilyReport(report || null);
        if (mounted) setFamilyAiContext(aiContext || null);
        if (mounted) setMyPendingInvitations(ensureArray(pendingForMe));
      } catch (err) {
        if (mounted) setFamilyPanelCards([]);
        if (mounted) setFamilyAlerts([]);
        if (mounted) setFamilyReport(null);
        if (mounted) setFamilyAiContext(null);
        if (mounted) setMyPendingInvitations([]);
        console.error("No se pudo cargar panel familiar:", err);
      }

      if (!activeFamilyProfileId) {
        if (mounted) {
          setCaregivers([]);
          setInvitations([]);
          setActivityLog([]);
          setProfileNotes([]);
        }
        return;
      }

      try {
        const [careList, invList, actList, autoCfg, notesList] = await Promise.all([
          getProfileCaregivers(activeFamilyProfileId),
          getProfileInvitations(activeFamilyProfileId).catch(() => []),
          shouldLoadFamilyActivity ? getHealthProfileActivity(activeFamilyProfileId) : Promise.resolve([]),
          shouldLoadFamilyAutomation ? getProfileAutomation(activeFamilyProfileId).catch(() => null) : Promise.resolve(null),
          shouldLoadFamilyNotes ? getProfileNotes(activeFamilyProfileId).catch(() => []) : Promise.resolve([]),
        ]);
        if (!mounted) return;
        setCaregivers(normalizeCaregivers(careList));
        setInvitations(ensureArray(invList));
        setActivityLog(ensureArray(actList));
        if (autoCfg) setAutomationSettings(autoCfg);
        setProfileNotes(ensureArray(notesList));
      } catch (err) {
        if (!mounted) return;
        setCaregivers([]);
        setInvitations([]);
        setActivityLog([]);
        setProfileNotes([]);
        console.error("No se pudieron cargar detalles de colaboracion:", err);
      }
    };
    loadFamilyDetails();
    return () => {
      mounted = false;
    };
  }, [
    profile?.id,
    activeFamilyProfileId,
    planInfo?.plan_type,
    shouldLoadFamilyActivity,
    shouldLoadFamilyAnalytics,
    shouldLoadFamilyAutomation,
    shouldLoadFamilyNotes,
  ]);

  useEffect(() => {
    if (activeSection === "seguridad") {
      loadMfaStatus();
      loadSessions();
      loadAuditLogs();
    }
  }, [activeSection]);

  const handleSectionSelect = (section) => {
    setActiveSection(section);
    if (isMobileSettings) {
      setMobileSectionOpen(true);
    }
  };

  const activeSectionLabel = {
    perfil: "Perfil",
    familia: "Mi familia",
    seguridad: "Seguridad",
    privacidad: "Privacidad",
    notificaciones: "Notificaciones",
    datos: "Exportar",
    reportes: "Reportes IA",
    legal: "Legal",
  }[activeSection] || "Perfil";

  const handleSaveTimezone = async () => {
    setTimezoneStatus("");
    try {
      const updated = await updateMe({
        timezone,
        reminder_preferred_time: reminderPreferredTime,
      });
      onUserUpdate?.(updated);
      setTimezoneStatus("Zona horaria actualizada");
      openSettingsSuccess({
        kicker: "Preferencias guardadas",
        title: "Horario actualizado",
        copy: "La zona horaria y la hora sugerida para recordatorios quedaron actualizadas.",
        rows: [
          { icon: "profile", label: "Zona horaria", value: timezone || "Sin definir" },
          { icon: "clock", label: "Hora sugerida", value: reminderPreferredTime || "Sin definir" },
        ],
      });
    } catch (err) {
      setTimezoneStatus("No se pudo actualizar la zona horaria");
      console.error("Error actualizando zona horaria:", err);
    }
  };

  const loadExportData = async () => {
    const [appointments, documents] = await Promise.all([getAppointments(), getDocuments()]);
    return {
      appointments: appointments || [],
      documents: documents || [],
    };
  };

  const exportCsv = async () => {
    const { appointments } = await loadExportData();
    if (!appointments.length) {
      window.alert("No hay citas para exportar.");
      return;
    }
    const header = ["id", "tipo", "especialidad", "centro", "fecha", "estado", "notas"];
    const rows = appointments.map((a) => [
      a.id,
      a.type,
      a.specialty || "",
      a.center || "",
      a.date_time ? toIsoOrNull(a.date_time) || "" : "",
      a.status,
      (a.notes || "").replace(/\"/g, '\"\"'),
    ]);
    const csv = [header.join(","), ...rows.map((r) => r.map((x) => `"${x}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "citas.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    const { appointments, documents } = await loadExportData();
    const html = `
      <html>
        <head>
          <title>Klinip - Resumen</title>
          <style>
            body { font-family: Nunito, Arial, sans-serif; padding: 16px; }
            h1 { font-size: 20px; margin: 0 0 12px; }
            h2 { font-size: 16px; margin: 12px 0 6px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #e5e7eb; padding: 6px; text-align: left; }
            th { background: #f8fafc; }
          </style>
        </head>
        <body>
          <h1>Klinip - Resumen</h1>
          <h2>Citas</h2>
          <table>
            <thead><tr><th>Tipo</th><th>Especialidad</th><th>Centro</th><th>Fecha</th><th>Estado</th></tr></thead>
            <tbody>
              ${appointments
                .map(
                  (a) =>
                    `<tr><td>${a.type}</td><td>${a.specialty || ""}</td><td>${a.center || ""}</td><td>${
                      a.date_time ? toLocaleDateTimeOrEmpty(a.date_time) : ""
                    }</td><td>${a.status}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
          <h2>Documentos</h2>
          <table>
            <thead><tr><th>Tipo</th><th>Centro</th><th>Fecha</th></tr></thead>
            <tbody>
              ${documents
                .map(
                  (d) =>
                    `<tr><td>${d.doc_type}</td><td>${d.center || ""}</td><td>${
                      d.date ? toLocaleDateOrEmpty(d.date) : ""
                    }</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
        </body>
      </html>
    `;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const shareLink = async () => {
    try {
      setExporting(true);
      const { appointments, documents } = await loadExportData();
      const payload = {
        appointments,
        documents,
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const link = `${window.location.origin}/#share=${encoded}`;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        openSettingsSuccess({
          kicker: "Enlace copiado",
          title: "Compartido listo",
          copy: "El enlace quedó copiado al portapapeles para que lo envíes cuando quieras.",
          rows: [
            { icon: "doc", label: "Contenido", value: "Citas y documentos exportados" },
            { icon: "profile", label: "Destino", value: "Portapapeles del dispositivo" },
          ],
        });
      } else {
        prompt("Copia este enlace", link);
      }
    } catch (err) {
      console.error("No se pudo generar el enlace", err);
      window.alert("No se pudo generar el enlace.");
    } finally {
      setExporting(false);
    }
  };


  const handleClearLocal = () => {
    if (!window.confirm("¿Borrar los datos locales de Klinip en este navegador?")) return;
    const exactKeys = [
      "klinip_users",
      "klinip_session",
      "klinip_appointments",
      "klinip_documents",
      "klinip_medications",
      "klinip_onboarding_seen",
      "klinip_onboarding_completed_v1",
      "klinip_onboarding_completed_v2",
    ];
    const prefixKeys = [
      "klinip_onboarding_completed_v1_",
      "klinip_onboarding_completed_v2_",
      "klinip_notifications_consent_",
      "klinip_notifications_last_prompt_",
      "klinip_notifications_prompt_count_",
      "klinip_push_registered_",
      "klinip_push_endpoint_",
    ];
    exactKeys.forEach((k) => localStorage.removeItem(k));
    Object.keys(localStorage).forEach((key) => {
      if (prefixKeys.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    });
    alert("Datos locales borrados. Vuelve a iniciar sesión para continuar.");
    window.location.reload();
  };

  const handleRevokeConsent = () => {
    setPrivacyNotice("");
    if (!window.confirm("¿Deseas revocar tu consentimiento de datos de salud?")) return;
    revokeDataConsent()
      .then(() => {
        localStorage.setItem("klinip_consent_revoked", "true");
        setConsentRevoked(true);
        setPrivacyNotice(
          "Has revocado tu consentimiento. Algunas funcionalidades avanzadas se han limitado."
        );
      })
      .catch((err) => {
        console.error(err);
        setPrivacyNotice("No se pudo revocar el consentimiento.");
      });
  };

  const handleRestoreConsent = () => {
    localStorage.removeItem("klinip_consent_revoked");
    setConsentRevoked(false);
    setPrivacyNotice("Consentimiento restaurado.");
  };

  const handleDeleteAccount = async (stepUpToken) => {
    setPrivacyNotice("");
    try {
      await deleteAccountApi(stepUpToken);
      localStorage.removeItem("token");
      onLogout?.();
      navigate("/register");
    } catch (err) {
      if (err.stepUpRequired) {
        setStepUpPending("deleteAccount");
        setStepUpOpen(true);
        return;
      }
      console.error(err);
      setPrivacyNotice("No se pudo eliminar la cuenta.");
    }
  };

  const handleSettingsStepUpVerified = (token) => {
    setStepUpOpen(false);
    const pending = stepUpPending;
    setStepUpPending(null);
    if (pending === "deleteAccount") handleDeleteAccount(token);
  };

  const handleSendPrivacyRequest = async () => {
    const cleanMessage = privacyMessage.trim();
    if (!cleanMessage) {
      setPrivacyNotice("Debes escribir un mensaje.");
      return;
    }
    setPrivacySending(true);
    setPrivacyNotice("");
    try {
      const response = await submitPrivacyRequest({
        reason: privacyReason,
        message: cleanMessage,
        include_tech: privacyIncludeTech,
      });
      setPrivacyMessage("");
      const requestId = response?.request_id;
      setPrivacyNotice("");
      setPrivacySuccessMessage(
        requestId
          ? `Solicitud enviada (#${requestId}). Te responderemos pronto.`
          : "Solicitud enviada. Te responderemos pronto."
      );
      setShowPrivacySuccessModal(true);
    } catch (err) {
      console.error(err);
      const detail = err?.response?.data?.detail;
      setPrivacyNotice(detail || "No se pudo enviar la solicitud.");
    } finally {
      setPrivacySending(false);
    }
  };

  // ── MFA handlers ────────────────────────────────────────────────────────────

  const loadMfaStatus = async () => {
    try {
      const s = await getMfaStatus();
      setMfaStatus(s);
    } catch {}
  };

  const handleMfaEnrollStart = async () => {
    setMfaLoading(true);
    setMfaNotice("");
    try {
      const data = await startMfaEnroll();
      setMfaEnrollData(data);
    } catch (err) {
      setMfaNotice(err?.response?.data?.detail || "No se pudo iniciar el enrolamiento.");
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaEnrollConfirm = async () => {
    setMfaLoading(true);
    setMfaNotice("");
    try {
      await verifyMfaEnrollment({ code: mfaEnrollCode });
      setMfaEnrollData(null);
      setMfaEnrollCode("");
      setMfaNotice("MFA activado correctamente.");
      await loadMfaStatus();
    } catch (err) {
      setMfaNotice(err?.response?.data?.detail || "Código incorrecto.");
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaDisable = async () => {
    if (!mfaDisableCode) return;
    setMfaLoading(true);
    setMfaNotice("");
    try {
      await disableMfa({ code: mfaDisableCode });
      setMfaDisableCode("");
      setMfaNotice("MFA desactivado.");
      await loadMfaStatus();
    } catch (err) {
      setMfaNotice(err?.response?.data?.detail || "Código incorrecto.");
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaRegenBackupCodes = async () => {
    if (!mfaRegenCode) return;
    setMfaLoading(true);
    setMfaNotice("");
    try {
      const res = await regenerateMfaBackupCodes({ code: mfaRegenCode });
      setMfaNewBackupCodes(res.backup_codes);
      setMfaRegenCode("");
      setMfaNotice("Códigos de respaldo regenerados. Guárdalos ahora, no se mostrarán de nuevo.");
      await loadMfaStatus();
    } catch (err) {
      setMfaNotice(err?.response?.data?.detail || "Código incorrecto.");
    } finally {
      setMfaLoading(false);
    }
  };

  // ── Session handlers ─────────────────────────────────────────────────────────

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const data = await getSessions();
      setSessions(ensureArray(data));
    } catch {} finally {
      setSessionsLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId) => {
    try {
      await revokeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      alert(err?.response?.data?.detail || "No se pudo revocar la sesión.");
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!window.confirm("¿Cerrar todas las sesiones activas? Deberás iniciar sesión de nuevo.")) return;
    try {
      await revokeAllSessions();
      setSessions([]);
      setMfaNotice("Todas las sesiones cerradas.");
    } catch (err) {
      setMfaNotice(err?.response?.data?.detail || "Error al cerrar sesiones.");
    }
  };

  // ── Audit log handlers ────────────────────────────────────────────────────────

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const data = await getAuditLogs({ limit: 30 });
      setAuditLogs(ensureArray(data));
    } catch {} finally {
      setAuditLoading(false);
    }
  };

  const handleSaveHealthProfile = async () => {
    setHealthProfileStatus("");
    try {
      const updated = await updateMe({
        chronic_condition: (chronicCondition || "").trim(),
        primary_care_center: (primaryCareCenter || "").trim(),
      });
      onUserUpdate?.(updated);
      setHealthProfileStatus("Perfil de salud actualizado");
      openSettingsSuccess({
        kicker: "Perfil actualizado",
        title: "Cambios aplicados",
        copy: "La información base de salud quedó actualizada en tu cuenta.",
        rows: [
          { icon: "doc", label: "Condición crónica", value: (chronicCondition || "Sin especificar").trim() || "Sin especificar" },
          { icon: "building", label: "Centro principal", value: (primaryCareCenter || "Sin especificar").trim() || "Sin especificar" },
        ],
      });
    } catch (err) {
      setHealthProfileStatus("No se pudo actualizar el perfil de salud");
      console.error("Error actualizando perfil de salud:", err);
    }
  };

  const handleSetActiveProfile = async (profileId) => {
    const nextId = Number(profileId || 0);
    if (!nextId || Number.isNaN(nextId)) return;
    setFamilyStatus("");
    setActiveFamilyProfileId(nextId);
    try {
      const active = await setActiveHealthProfile(nextId);
      setActiveFamilyProfileId(active?.id || nextId);
      setFamilyStatus(`Perfil activo: ${active?.full_name || "actualizado"}`);
      openSettingsSuccess({
        kicker: "Perfil activo cambiado",
        title: "Contexto actualizado",
        copy: "Klinip ahora usará este perfil como contexto principal para tus acciones.",
        rows: [
          { icon: "profile", label: "Perfil activo", value: active?.full_name || `Perfil #${nextId}` },
        ],
      });
    } catch (err) {
      console.error("No se pudo cambiar perfil activo:", err);
      setFamilyStatus("No se pudo cambiar el perfil activo");
    }
  };

  const handleCreateFamilyProfile = async () => {
    const cleanName = (newFamilyProfile.full_name || "").trim();
    if (!cleanName) {
      setFamilyStatus("Debes ingresar nombre completo para el perfil");
      return;
    }
    setFamilyStatus("");
    try {
      const created = await createHealthProfile({
        full_name: cleanName,
        relation_with_owner: (newFamilyProfile.relation_with_owner || "").trim(),
        gender: (newFamilyProfile.gender || "").trim(),
      });
      setFamilyProfiles((prev) => [...prev, created]);
      setNewFamilyProfile({
        full_name: "",
        relation_with_owner: "",
        gender: "",
      });
      const plan = await getMyPlan();
      const cards = await getFamilyPanel().catch(() => []);
      setPlanInfo(plan || null);
      setFamilyPanelCards(ensureArray(cards));
      setFamilyStandalonePanel(null);
      setFamilyStatus(`Perfil ${created?.full_name || ""} creado correctamente`);
      openSettingsSuccess({
        kicker: "Perfil creado",
        title: "Nuevo perfil familiar listo",
        copy: "El perfil quedó creado y ya puedes comenzar a cargar información o invitar apoyo.",
        rows: [
          { icon: "profile", label: "Perfil", value: created?.full_name || cleanName },
          { icon: "doc", label: "Relación", value: (created?.relation_with_owner || newFamilyProfile.relation_with_owner || "Sin especificar").trim() || "Sin especificar" },
        ],
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo crear el perfil");
      console.error("Error creando perfil asistido:", err);
    }
  };

  const focusAssistedFamilyForm = () => {
    setFamilyStandalonePanel("profile");
    setTimeout(() => {
      familyCreateCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      familyNameInputRef.current?.focus();
    }, 10);
  };
  const focusInviteCaregiverForm = () => {
    setFamilyStandalonePanel("invite");
    setTimeout(() => {
      familyInviteCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      familyInviteEmailRef.current?.focus();
    }, 10);
  };
  const focusFamilyRoles = () => {
    setTimeout(() => {
      familyRolesCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 10);
  };

  const handleInviteCaregiver = async () => {
    if (!activeFamilyProfileId) {
      setFamilyStatus("Selecciona un perfil activo para invitar");
      return;
    }
    const email = (inviteForm.email || "").trim().toLowerCase();
    if (!email) {
      setFamilyStatus("Debes ingresar un correo para la invitación");
      return;
    }
    setFamilyStatus("");
    try {
      await inviteProfileCaregiver(activeFamilyProfileId, {
        email,
        role: inviteForm.role,
        relationship_type: inviteForm.relationship_type,
      });
      const [careList, invList, actList] = await Promise.all([
        getProfileCaregivers(activeFamilyProfileId),
        getProfileInvitations(activeFamilyProfileId).catch(() => []),
        shouldLoadFamilyActivity ? getHealthProfileActivity(activeFamilyProfileId) : Promise.resolve([]),
      ]);
      setCaregivers(normalizeCaregivers(careList));
      setInvitations(ensureArray(invList));
      setActivityLog(ensureArray(actList));
      setInviteForm({ email: "", role: "viewer", relationship_type: "" });
      setFamilyStandalonePanel(null);
      setFamilyStatus("Invitación creada correctamente");
      openSettingsSuccess({
        kicker: "Invitación enviada",
        title: "Acceso en preparación",
        copy: "La invitación quedó enviada. Cuando la persona la acepte, aparecerá dentro del perfil compartido.",
        rows: [
          { icon: "profile", label: "Correo", value: email },
          { icon: "doc", label: "Rol inicial", value: familyRoleLabel(inviteForm.role) },
        ],
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo crear la invitación");
      console.error("Error invitando colaborador:", err);
    }
  };

  const handleAcceptInvitation = async (token) => {
    const cleanToken = (token || "").trim();
    if (!cleanToken) return;
    setFamilyStatus("");
    try {
      await acceptProfileInvitation(cleanToken);
      const [profiles, active, cards, pendingForMe] = await Promise.all([
        getHealthProfiles().catch(() => []),
        getActiveHealthProfile().catch(() => null),
        getFamilyPanel().catch(() => []),
        getMyPendingProfileInvitations().catch(() => []),
      ]);
      setFamilyProfiles(ensureArray(profiles));
      setActiveFamilyProfileId(active?.id || activeFamilyProfileId);
      setFamilyPanelCards(ensureArray(cards));
      setMyPendingInvitations(ensureArray(pendingForMe));
      setFamilyStatus("Invitación aceptada correctamente");
      openSettingsSuccess({
        kicker: "Invitación aceptada",
        title: "Acceso disponible",
        copy: "El perfil compartido ya quedó disponible dentro de tu cuenta.",
        rows: [
          { icon: "profile", label: "Perfil activo", value: active?.full_name || "Perfil compartido" },
        ],
      });
      setActiveSection("familia");
      navigate("/settings/familia");
      if (isMobileSettings) {
        setMobileSectionOpen(true);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo aceptar la invitación");
      console.error("Error aceptando invitación:", err);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    const token = (params.get("family_invite_token") || "").trim();
    if (!token || !profile?.id) return;
    handleAcceptInvitation(token).finally(() => {
      const nextParams = new URLSearchParams(location.search || "");
      nextParams.delete("family_invite_token");
      const nextSearch = nextParams.toString();
      navigate(
        { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" },
        { replace: true }
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, profile?.id]);

  const handleRoleChange = async (relationshipId, nextRole) => {
    if (!activeFamilyProfileId) return;
    try {
      await updateProfileRelationship(activeFamilyProfileId, relationshipId, { role: nextRole });
      const [careList, actList] = await Promise.all([
        getProfileCaregivers(activeFamilyProfileId),
        shouldLoadFamilyActivity ? getHealthProfileActivity(activeFamilyProfileId) : Promise.resolve([]),
      ]);
      setCaregivers(normalizeCaregivers(careList));
      setActivityLog(ensureArray(actList));
      setFamilyStatus("Rol actualizado");
      const caregiver = caregivers.find((item) => Number(item.id) === Number(relationshipId));
      openSettingsSuccess({
        kicker: "Permiso actualizado",
        title: "Rol modificado",
        copy: "El nivel de acceso quedó actualizado para este colaborador.",
        rows: [
          { icon: "profile", label: "Colaborador", value: caregiver?.name || caregiver?.email || `Acceso #${relationshipId}` },
          { icon: "doc", label: "Nuevo rol", value: familyRoleLabel(nextRole) },
        ],
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo actualizar el rol");
      console.error("Error actualizando rol:", err);
    }
  };

  const handleRemoveCaregiver = async (relationshipId) => {
    if (!activeFamilyProfileId) return;
    if (!window.confirm("¿Deseas quitar este colaborador del perfil?")) return;
    try {
      await removeProfileRelationship(activeFamilyProfileId, relationshipId);
      const [careList, actList] = await Promise.all([
        getProfileCaregivers(activeFamilyProfileId),
        shouldLoadFamilyActivity ? getHealthProfileActivity(activeFamilyProfileId) : Promise.resolve([]),
      ]);
      setCaregivers(normalizeCaregivers(careList));
      setActivityLog(ensureArray(actList));
      setFamilyStatus("Colaborador removido");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo remover colaborador");
      console.error("Error removiendo colaborador:", err);
    }
  };

  const handleRevokeInvitation = async (invitationId) => {
    if (!activeFamilyProfileId) return;
    try {
      await revokeProfileInvitation(activeFamilyProfileId, invitationId);
      const [invList, actList] = await Promise.all([
        getProfileInvitations(activeFamilyProfileId).catch(() => []),
        shouldLoadFamilyActivity ? getHealthProfileActivity(activeFamilyProfileId) : Promise.resolve([]),
      ]);
      setInvitations(ensureArray(invList));
      setActivityLog(ensureArray(actList));
      setFamilyStatus("Invitación revocada");
      openSettingsSuccess({
        kicker: "Invitación revocada",
        title: "Acceso cancelado",
        copy: "La invitación pendiente quedó cancelada y ya no podrá usarse para entrar al perfil.",
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo revocar la invitación");
      console.error("Error revocando invitación:", err);
    }
  };

  const invitationStatusClassName = (status) => {
    if (status === "accepted") return "is-active";
    if (status === "revoked") return "is-revoked";
    return "is-pending";
  };

  const invitationStatusLabel = (status) => {
    if (status === "accepted") return "Acceso activo";
    if (status === "revoked") return "Revocada";
    return "Pendiente";
  };

  const invitationHelpText = (inv) => {
    const isOwnActiveAccess =
      inv.status === "accepted" &&
      normalizedProfileEmail &&
      String(inv.invitee_email || "").trim().toLowerCase() === normalizedProfileEmail;

    if (inv.status === "accepted") {
      if (isOwnActiveAccess) {
        return "Este acceso ya está activo en tu cuenta. Para evitar errores, ya no puedes revocarlo desde Invitaciones.";
      }
      return "Esta invitación ya fue aceptada y hoy funciona como un acceso activo. Si necesitas cambiar permisos o quitar ese acceso, usa Roles y accesos.";
    }
    if (inv.status === "pending") {
      return "Todavía no ha sido aceptada. Puedes cancelarla mientras siga pendiente.";
    }
    return "Esta invitación ya quedó cerrada y no hace cambios sobre el acceso actual.";
  };

  const renderManagedInvitation = (inv) => (
    <article className="family-inv-row" key={inv.id}>
      <div className="family-role-body">
        <p className="family-role-name">{inv.invitee_email}</p>
        <p className="family-role-meta">
          Rol: {familyRoleLabel(inv.role)}
          {inv.relationship_type ? ` · Relación: ${inv.relationship_type}` : ""}
        </p>
        <p className="family-inv-note">{invitationHelpText(inv)}</p>
      </div>
      <div className="family-role-actions">
        <span className={`family-status-pill ${invitationStatusClassName(inv.status)}`}>
          {invitationStatusLabel(inv.status)}
        </span>
        {inv.status === "pending" ? (
          <button
            className="secondary-btn danger"
            type="button"
            onClick={() => handleRevokeInvitation(inv.id)}
          >
            Cancelar invitación
          </button>
        ) : null}
      </div>
    </article>
  );

  const handleToggleAutomationSetting = (key, value) => {
    setAutomationSettings((prev) => ({ ...prev, [key]: !!value }));
  };

  const handleSaveAutomationSettings = async () => {
    if (!activeFamilyProfileId) return;
    setAutomationStatus("");
    try {
      const updated = await updateProfileAutomation(activeFamilyProfileId, automationSettings);
      setAutomationSettings(updated || automationSettings);
      setAutomationStatus("Automatizaciones actualizadas");
      const alerts = await getFamilyAlerts().catch(() => []);
      setFamilyAlerts(ensureArray(alerts));
      const enabledCount = Object.values(updated || automationSettings).filter(Boolean).length;
      openSettingsSuccess({
        kicker: "Automatizaciones guardadas",
        title: "Preferencias actualizadas",
        copy: "Las reglas automáticas de este perfil quedaron actualizadas.",
        rows: [
          { icon: "profile", label: "Perfil", value: familyProfiles.find((item) => Number(item.id) === Number(activeFamilyProfileId))?.full_name || "Perfil activo" },
          { icon: "doc", label: "Reglas activas", value: String(enabledCount) },
        ],
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setAutomationStatus(detail || "No se pudo actualizar automatizaciones");
      console.error("Error guardando automatizaciones:", err);
    }
  };

  const handleRunAutomations = async () => {
    setAutomationStatus("");
    try {
      const result = await runFamilyAutomations(true);
      const executed = result?.executed || {};
      setAutomationStatus(
        `Automatizaciones ejecutadas. Alertas: ${executed.alerts_generated || 0}, correo: ${executed.emails_sent || 0}`
      );
      const [alerts, report, aiContext] = await Promise.all([
        getFamilyAlerts().catch(() => []),
        getFamilyReportSummary(30).catch(() => null),
        getAiFamilyContext(30).catch(() => null),
      ]);
      setFamilyAlerts(ensureArray(alerts));
      setFamilyReport(report || null);
      setFamilyAiContext(aiContext || null);
      openSettingsSuccess({
        kicker: "Automatizaciones ejecutadas",
        title: "Ejecución completada",
        copy: "Klinip revisó las reglas activas y actualizó el contexto familiar.",
        rows: [
          { icon: "doc", label: "Alertas generadas", value: String(executed.alerts_generated || 0) },
          { icon: "profile", label: "Correos enviados", value: String(executed.emails_sent || 0) },
        ],
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setAutomationStatus(detail || "No se pudieron ejecutar automatizaciones");
      console.error("Error ejecutando automatizaciones:", err);
    }
  };

  const handleCreateProfileNote = async () => {
    if (!activeFamilyProfileId) return;
    const note = (newProfileNote || "").trim();
    if (!note) {
      setFamilyStatus("La nota no puede estar vacía");
      return;
    }
    try {
      await createProfileNote(activeFamilyProfileId, { note, visibility: "shared" });
      const [notesList, actList] = await Promise.all([
        getProfileNotes(activeFamilyProfileId).catch(() => []),
        getHealthProfileActivity(activeFamilyProfileId),
      ]);
      setProfileNotes(ensureArray(notesList));
      setActivityLog(ensureArray(actList));
      setNewProfileNote("");
      setFamilyStatus("Nota colaborativa guardada");
      openSettingsSuccess({
        kicker: "Nota guardada",
        title: "Seguimiento actualizado",
        copy: "La nota colaborativa quedó disponible dentro del perfil compartido.",
        rows: [
          { icon: "profile", label: "Perfil", value: familyProfiles.find((item) => Number(item.id) === Number(activeFamilyProfileId))?.full_name || "Perfil activo" },
          { icon: "doc", label: "Nota", value: note.slice(0, 96) },
        ],
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo guardar la nota");
      console.error("Error guardando nota:", err);
    }
  };

  const handleToggleEmailReminders = async (enabled) => {
    const previous = emailRemindersEnabled;
    setEmailReminderStatus("");
    setEmailRemindersEnabled(enabled);
    localStorage.setItem("klinip_email_reminders_enabled", enabled ? "true" : "false");
    try {
      const updated = await updateMe({
        email_reminders_enabled: enabled,
      });
      onUserUpdate?.(updated);
      setEmailReminderStatus(enabled ? "Recordatorios por correo activados" : "Recordatorios por correo desactivados");
      openSettingsSuccess({
        kicker: "Correo actualizado",
        title: enabled ? "Recordatorios activados" : "Recordatorios desactivados",
        copy: enabled
          ? "Klinip volverá a enviarte recordatorios por correo cuando corresponda."
          : "Klinip dejará de usar correo para este tipo de recordatorios.",
        rows: [
          { icon: "doc", label: "Canal", value: "Correo electrónico" },
          { icon: "profile", label: "Estado", value: enabled ? "Activo" : "Inactivo" },
        ],
      });
    } catch (err) {
      setEmailRemindersEnabled(previous);
      localStorage.setItem("klinip_email_reminders_enabled", previous ? "true" : "false");
      setEmailReminderStatus("No se pudo actualizar la preferencia de correo");
      console.error("Error actualizando recordatorios por correo:", err);
    }
  };

  const settingsShellClassName = [
    "settings-shell",
    isMobileSettings ? "settings-shell-native-scene native-mobile-scene" : "",
    isMobileSettings && mobileSectionOpen ? "is-mobile-section-open" : "",
    isFamilyStandalone ? "is-family-standalone" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const settingsSidebarClassName = [
    "settings-sidebar",
    isMobileSettings ? "settings-sidebar-native native-surface native-surface-hero" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const settingsMainClassName = [
    "settings-main",
    isFamilyStandalone ? "is-family-standalone-main" : "",
    isMobileSettings ? "settings-main-native" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const getSettingsSectionClassName = (sectionId, extraClassName = "") =>
    [
      "settings-section",
      `settings-section-${sectionId}`,
      isMobileSettings ? "settings-section-native native-section native-section-delay-2" : "",
      extraClassName,
    ]
      .filter(Boolean)
      .join(" ");

  const renderFamilyStandaloneSection = () => (
    <>
      <div className="family-page-header family-page-header-minimal">
        <div>
          <h2 className="card-title">Mi familia</h2>
          <p className="muted">Perfiles y accesos en un solo lugar.</p>
        </div>
      </div>

      <div className="family-standalone-actions">
        {canManageActiveFamilyProfile ? (
          <button
            className={`secondary-btn family-standalone-cta ${familyStandalonePanel === "invite" ? "is-open" : ""}`}
            type="button"
            onClick={() => {
              if (familyStandalonePanel === "invite") {
                setFamilyStandalonePanel(null);
                return;
              }
              focusInviteCaregiverForm();
            }}
          >
            {familyStandalonePanel === "invite" ? "Cerrar invitación" : "Invitar colaborador"}
          </button>
        ) : null}
        <button
          className={`secondary-btn family-standalone-cta ${familyStandalonePanel === "profile" ? "is-open" : ""}`}
          type="button"
          disabled={familySlotsRemaining === 0}
          onClick={() => {
            if (familyStandalonePanel === "profile") {
              setFamilyStandalonePanel(null);
              return;
            }
            focusAssistedFamilyForm();
          }}
        >
          {familySlotsRemaining > 0 ? "Agregar perfil" : "Sin cupos disponibles"}
        </button>
      </div>

      {canManageActiveFamilyProfile && familyStandalonePanel === "invite" ? (
        <div ref={familyInviteCardRef} className="family-create-card family-management-card family-inline-panel">
          <div className="family-card-head">
            <div>
              <p className="family-card-kicker family-title-teal">Invitar colaborador</p>
              <p className="family-inline-muted">Envía acceso a otra persona para ayudar con este perfil.</p>
            </div>
          </div>
          <div className="form-row">
            <div className="input-group">
              <label className="input-label">Correo</label>
              <input
                className="input-field"
                ref={familyInviteEmailRef}
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="correo@ejemplo.com"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Rol</label>
              <select
                className="select-field"
                value={inviteForm.role}
                onChange={(e) => setInviteForm((prev) => ({ ...prev, role: e.target.value }))}
              >
                <option value="admin">Administrador</option>
                <option value="caregiver">Editor</option>
                <option value="viewer">Lector</option>
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Relación</label>
              <input
                className="input-field"
                value={inviteForm.relationship_type}
                onChange={(e) => setInviteForm((prev) => ({ ...prev, relationship_type: e.target.value }))}
                placeholder="Ej: Hijo, Hermana, Cuidador"
              />
            </div>
          </div>
          <button className="secondary-btn" type="button" onClick={handleInviteCaregiver}>
            Enviar invitación
          </button>
        </div>
      ) : null}

      {familyStandalonePanel === "profile" ? (
        planInfo?.max_profiles > (planInfo?.current_profiles ?? 0) ? (
          <div
            ref={familyCreateCardRef}
            className="family-create-card family-management-card family-inline-panel"
          >
            <div className="family-card-head">
              <div>
                <p className="family-card-kicker family-title-blue">Agregar perfil asistido</p>
                <p className="family-inline-muted">Crea un perfil nuevo con lo esencial para empezar.</p>
              </div>
            </div>
            <div className="form-row">
              <div className="input-group">
                <label className="input-label">Nombre completo</label>
                <input
                  className="input-field"
                  ref={familyNameInputRef}
                  value={newFamilyProfile.full_name}
                  onChange={(e) =>
                    setNewFamilyProfile((prev) => ({ ...prev, full_name: e.target.value }))
                  }
                  placeholder="Ej: María González"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Relación</label>
                <input
                  className="input-field"
                  value={newFamilyProfile.relation_with_owner}
                  onChange={(e) =>
                    setNewFamilyProfile((prev) => ({ ...prev, relation_with_owner: e.target.value }))
                  }
                  placeholder="Ej: Madre, Padre, Hijo/a"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Sexo/Género (opcional)</label>
                <input
                  className="input-field"
                  value={newFamilyProfile.gender}
                  onChange={(e) =>
                    setNewFamilyProfile((prev) => ({ ...prev, gender: e.target.value }))
                  }
                  placeholder="Ej: Femenino"
                />
              </div>
            </div>
            <button className="secondary-btn" type="button" onClick={handleCreateFamilyProfile}>
              Crear perfil
            </button>
          </div>
        ) : (
          <div className="family-create-card family-management-card family-inline-panel family-inline-panel-limit">
            <p className="muted">Alcanzaste el límite de perfiles de tu plan.</p>
            <button className="secondary-btn" type="button" onClick={() => navigate("/planes/familiar")}>
              Ver planes
            </button>
          </div>
        )
      ) : null}

      <div className="family-member-grid family-member-grid-minimal">
        {familyMemberCards.map((item) => (
          <article
            className={`family-member-card family-member-card-minimal ${item.id === activeFamilyProfileId ? "is-active" : ""}`}
            key={item.id}
          >
            <div
              className="family-member-accent"
              style={{ background: `linear-gradient(90deg, ${item.tone.start}, ${item.tone.end})` }}
            />
            <div className="family-member-head">
              <FamilyAvatar
                className="family-member-avatar"
                name={item.full_name}
                avatarUrl={item.avatarUrl}
                style={{ background: `linear-gradient(135deg, ${item.tone.start}, ${item.tone.end})` }}
                fallback={item.initials}
              />
              <div>
                <p className="family-member-name">{item.full_name}</p>
                <p className="family-member-meta">{item.relationshipLabel}</p>
              </div>
            </div>
            <div className="family-member-summary-row">
              <span
                className={`family-member-badge ${item.isOwner ? "is-owner" : "is-managed"}`}
                style={
                  item.isOwner
                    ? undefined
                    : { background: item.tone.soft, borderColor: item.tone.border, color: item.tone.start }
                }
              >
                {item.badgeLabel}
              </span>
              <span className="family-member-summary-text">{item.accessSummary}</span>
            </div>
            <button
              className="family-member-btn family-member-btn-outline family-member-btn-single"
              type="button"
              onClick={() => handleSetActiveProfile(item.id)}
            >
              {item.id === activeFamilyProfileId ? "Perfil activo" : "Activar perfil"}
            </button>
          </article>
        ))}

        {collaboratorCards.map((item) => (
          <article className="family-member-card family-member-card-collaborator family-member-card-minimal" key={item.id}>
            <div
              className="family-member-accent"
              style={{ background: `linear-gradient(90deg, ${item.tone.start}, ${item.tone.end})` }}
            />
            <div className="family-member-head">
              <FamilyAvatar
                className="family-member-avatar"
                name={item.name}
                avatarUrl={item.avatarUrl}
                style={{ background: `linear-gradient(135deg, ${item.tone.start}, ${item.tone.end})` }}
                fallback={item.initials}
              />
              <div>
                <p className="family-member-name">{item.name}</p>
                <p className="family-member-meta">
                  {item.relationshipLabel}
                  {item.email ? ` · ${item.email}` : ""}
                </p>
              </div>
            </div>
            <div className="family-member-summary-row">
              <span
                className="family-member-badge is-managed"
                style={{ background: item.tone.soft, borderColor: item.tone.border, color: item.tone.start }}
              >
                {item.accessLabel}
              </span>
              <span className="family-member-summary-text">{item.permissionSummary}</span>
            </div>
            <button
              className="family-member-btn family-member-btn-outline family-member-btn-single"
              type="button"
              onClick={focusFamilyRoles}
            >
              Gestionar acceso
            </button>
          </article>
        ))}
      </div>

      <section
        className="family-collab-card family-canvas-card family-roles-card family-roles-card-standalone"
        ref={familyRolesCardRef}
      >
        <div className="family-card-head">
          <div>
            <p className="family-card-kicker family-title-teal">Roles y accesos</p>
            <p className="family-inline-muted">Administra permisos e invitaciones del perfil activo.</p>
          </div>
        </div>

        <div className="family-roles-list">
          <article className="family-role-row">
            <span className="family-role-avatar is-blue">{profileInitial}</span>
            <div className="family-role-body">
              <p className="family-role-name">{profileDisplayName}</p>
              <p className="family-role-meta">{profileDisplayEmail} · cuenta principal</p>
            </div>
            <div className="family-role-actions">
              <select className="select-field" value="admin" disabled>
                <option value="admin">Administrador</option>
              </select>
            </div>
          </article>

          {caregivers.map((row, index) => (
            <article className="family-role-row" key={row.id}>
              <span className={`family-role-avatar ${index % 2 === 0 ? "is-violet" : "is-sky"}`}>
                {(row.user_name || row.user_email || "CU")
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase() || "")
                  .join("") || "CU"}
              </span>
              <div className="family-role-body">
                <p className="family-role-name">
                  {row.user_name || row.user_email || `Usuario #${row.user_id}`}
                </p>
                <p className="family-role-meta">
                  {row.user_email || "Sin correo"} · {row.relationship_type || "Sin relación"}
                </p>
              </div>
              <div className="family-role-actions">
                <select
                  className="select-field"
                  value={row.role || "viewer"}
                  onChange={(e) => handleRoleChange(row.id, e.target.value)}
                >
                  <option value="admin">Administrador</option>
                  <option value="caregiver">Editor</option>
                  <option value="viewer">Lector</option>
                </select>
                {String(row?.user_email || "").trim().toLowerCase() !== normalizedProfileEmail &&
                String(row?.relationship_type || "").toLowerCase() !== "self" ? (
                  <button
                    className="secondary-btn danger"
                    type="button"
                    onClick={() => handleRemoveCaregiver(row.id)}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        <div className="family-invitations-block">
          <p className="family-subsection-label">Invitaciones</p>
          <p className="family-inv-section-note">
            Pendiente significa que la persona aún no entra al perfil. Acceso activo significa que la invitación ya fue aceptada y ahora se gestiona desde Roles y accesos.
          </p>
          <div className="family-invitations-list">
            {invitations.length ? (
              invitations.map((inv) => renderManagedInvitation(inv))
            ) : null}

            {myPendingInvitations.map((inv) => (
              <article className="family-inv-row" key={`pending-${inv.id}`}>
                <div className="family-role-body">
                  <p className="family-role-name">{inv.profile_name}</p>
                  <p className="family-role-meta">
                    Invitado por {inv.inviter_name || `Usuario #${inv.inviter_user_id}`} · Rol: {familyRoleLabel(inv.role)}
                  </p>
                </div>
                <div className="family-role-actions">
                  <span className="family-status-pill is-pending">Pendiente</span>
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => handleAcceptInvitation(inv.token)}
                  >
                    Aceptar
                  </button>
                </div>
              </article>
            ))}

            {!invitations.length && !myPendingInvitations.length ? (
              <p className="muted">No hay invitaciones registradas para este perfil.</p>
            ) : null}
          </div>
        </div>
      </section>

      {familyStatus ? <p className="muted family-standalone-status">{familyStatus}</p> : null}
    </>
  );

  return (
    <>
      <div className={settingsShellClassName}>
        {!isFamilyStandalone && (
        <aside className={settingsSidebarClassName}>
          <div className="settings-profile-card">
            <div className="settings-profile-avatar">{profileInitial}</div>
            <div className="settings-profile-name">{profileDisplayName}</div>
            <div className="settings-profile-plan">{plan}</div>
          </div>
          <div className="settings-mobile-hero">
            <div className="settings-mobile-avatar">{profileInitial}</div>
            <h3>{profileDisplayName}</h3>
            <p>{profileDisplayEmail}</p>
          </div>
          <p className="settings-nav-label">Configuración</p>
          <div className="settings-nav">
            {settingsSections.map((section) => (
              <button
                key={section.id}
                className={`settings-nav-btn ${activeSection === section.id ? "is-active" : ""}`}
                type="button"
                onClick={() => handleSectionSelect(section.id)}
              >
                <span className="settings-nav-btn-icon" aria-hidden="true">
                  {section.icon === "profile" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  ) : section.icon === "shield" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  ) : section.icon === "bell" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  ) : section.icon === "export" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  )}
                </span>
                <span>{section.label}</span>
              </button>
            ))}
          </div>
          <button
            className="settings-logout-btn"
            type="button"
            onClick={() => {
              if (window.confirm("¿Estás seguro de que deseas cerrar sesión?")) {
                onLogout?.();
              }
            }}
          >
            Cerrar sesión
          </button>
        </aside>
        )}

        <div className={settingsMainClassName}>
      {isMobileSettings && mobileSectionOpen && !isFamilyStandalone && (
        <div className="settings-mobile-backbar native-section native-section-delay-1">
          <button
            className="klinip-back-btn"
            type="button"
            onClick={() => setMobileSectionOpen(false)}
            aria-label="Volver a la vista anterior"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span>{activeSectionLabel}</span>
        </div>
      )}

      {activeSection === "perfil" && (
      <div className={getSettingsSectionClassName("perfil")}>
        <div className="profile-page-header">
          <div>
            <p className="profile-page-eyebrow"><span />Configuración personal</p>
            <h2 className="profile-page-title">
              Mi <em>perfil</em>
            </h2>
            <p className="muted">Centraliza tu cuenta, recordatorios y datos de salud base.</p>
          </div>
          <div className="family-page-plan-chip">{plan}</div>
        </div>

        <div className="profile-quick-grid">
          <article className="profile-quick-card">
            <span className="profile-quick-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="12" cy="8" r="3.2" />
                <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
              </svg>
            </span>
            <p className="profile-quick-title">Cuenta</p>
            <p className="profile-quick-description">Nombre, correo y plan activo.</p>
            <span className="profile-quick-action">{profile.email || "sin correo"}</span>
          </article>
          <article className="profile-quick-card">
            <span className="profile-quick-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
              </svg>
            </span>
            <p className="profile-quick-title">Recordatorios</p>
            <p className="profile-quick-description">Horario preferido y notificaciones por correo.</p>
            <span className="profile-quick-action">{emailRemindersEnabled ? "Correo activo" : "Correo desactivado"}</span>
          </article>
          <article className="profile-quick-card">
            <span className="profile-quick-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M12 21s-6.5-4.2-6.5-10A4.5 4.5 0 0 1 10 6.5c.9 0 1.7.26 2 .9.3-.64 1.1-.9 2-.9a4.5 4.5 0 0 1 4.5 4.5c0 5.8-6.5 10-6.5 10z" />
              </svg>
            </span>
            <p className="profile-quick-title">Salud base</p>
            <p className="profile-quick-description">Patología crónica y centro habitual.</p>
            <span className="profile-quick-action">{primaryCareCenter || "Sin centro definido"}</span>
          </article>
        </div>

        <div className="profile-page-card profile-page-card-accent-blue">
          <div className="profile-page-card-line" />
          <h4>Cuenta y perfil activo</h4>
          <div className="profile-active-strip">
            <div>
              <p className="profile-active-label">Perfil de salud activo</p>
              <p className="muted">Selecciona el perfil con el que estás trabajando para evitar errores al gestionar datos.</p>
            </div>
            <select
              className="profile-selector"
              value={activeFamilyProfileId || ""}
              onChange={(e) => handleSetActiveProfile(e.target.value)}
            >
              <option value="" disabled>
                Seleccionar perfil
              </option>
              {familyProfiles.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.full_name} {item.relation_with_owner ? `(${item.relation_with_owner})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="form-info-row" style={{ marginBottom: "1rem" }}>
            <div className="profile-tile">
              <p className="profile-label">Nombre</p>
              <p className="profile-value">{activeHealthProfile?.full_name || profile.name || "-"}</p>
            </div>
            <div className="profile-tile">
              <p className="profile-label">Correo</p>
              <p className="profile-value">{profile.email || "-"}</p>
            </div>
            <div className="profile-tile">
              <p className="profile-label">Plan</p>
              <p className="profile-value">{plan}</p>
            </div>
            <div className="profile-tile">
              <p className="profile-label">Zona horaria</p>
              <p className="profile-value">{profile.timezone || detectedTimezone}</p>
            </div>
          </div>
          <div className="form-section" style={{ marginBottom: "0" }}>
            <div className="form-section-title">Cuenta</div>
            <div className="form-grid-2">
              <div className="form-field">
                <label className="form-label">Nombre completo</label>
                <input className="form-input" value={activeHealthProfile?.full_name || profile.name || ""} readOnly />
              </div>
              <div className="form-field">
                <label className="form-label">Correo electrónico</label>
                <input className="form-input" value={profile.email || ""} readOnly />
              </div>
            </div>
          </div>
        </div>

        <div className="profile-page-card profile-page-card-accent-amber">
          <div className="profile-page-card-line" />
          <h4>Recordatorios y horario</h4>
          <div className="settings-email-reminder-row">
            <div className="settings-email-reminder-copy">
              <p className="settings-email-reminder-title">Recordatorios por correo</p>
              <p className="settings-email-reminder-sub">Activa o desactiva la recepción de recordatorios por email.</p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={emailRemindersEnabled}
                onChange={(e) => handleToggleEmailReminders(e.target.checked)}
              />
              <span className="switch-slider" />
            </label>
          </div>
          <p className="muted" style={{ marginBottom: "0.75rem" }}>
            Estado actual: {emailRemindersEnabled ? "Activados" : "Desactivados"}
          </p>
          {emailReminderStatus && <p className="muted">{emailReminderStatus}</p>}
          <div className="form-grid-2" style={{ marginBottom: "0.8rem" }}>
            <div className="form-field">
              <label className="form-label">Actualizar zona horaria</label>
              <input
                className="form-input"
                list="timezone-options"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="America/Santiago"
              />
              <datalist id="timezone-options">
                {timezoneOptions.map((tz) => (
                  <option value={tz} key={tz} />
                ))}
              </datalist>
            </div>
            <div className="form-field">
              <label className="form-label">Hora preferida de recordatorios</label>
              <input
                className="form-input"
                type="time"
                value={reminderPreferredTime}
                onChange={(e) => setReminderPreferredTime(e.target.value || "08:00")}
              />
            </div>
          </div>
          <div className="save-bar">
            <button className="btn-save" type="button" onClick={handleSaveTimezone}>
              Guardar configuración
            </button>
          </div>
          {timezoneStatus && <p className="muted">{timezoneStatus}</p>}
        </div>

        <div className="profile-page-card profile-page-card-accent-teal">
          <div className="profile-page-card-line" />
          <h4>Perfil de salud base</h4>
          <div className="form-grid-2" style={{ marginTop: "0.25rem", marginBottom: "0.9rem" }}>
            <div className="form-field">
              <label className="form-label">Patología crónica (opcional)</label>
              <input
                className="form-input"
                value={chronicCondition}
                onChange={(e) => setChronicCondition(e.target.value)}
                placeholder="Ej: hipertensión, diabetes, asma"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Centro habitual (opcional)</label>
              <input
                className="form-input"
                value={primaryCareCenter}
                onChange={(e) => setPrimaryCareCenter(e.target.value)}
                placeholder="Ej: CESFAM Norte, Clinica ..."
              />
            </div>
          </div>
          <div className="form-field" style={{ marginBottom: "0.9rem" }}>
            <label className="form-label">Condiciones o patologías registradas</label>
            <div className="health-tags">
              {chronicConditionTags.length ? (
                chronicConditionTags.map((tag) => <span className="htag" key={tag}>{tag}</span>)
              ) : (
                <span className="htag">Sin condiciones registradas</span>
              )}
            </div>
          </div>
          <div className="save-bar">
            <button className="btn-save" type="button" onClick={handleSaveHealthProfile}>
              Guardar perfil de salud
            </button>
          </div>
          {healthProfileStatus && <p className="muted">{healthProfileStatus}</p>}
        </div>
      </div>
      )}

      {activeSection === "familia" && (
      <div className={getSettingsSectionClassName("familia", isFamilyStandalone ? "family-section-standalone" : "")}>
        {isFamilyStandalone ? (
          renderFamilyStandaloneSection()
        ) : (
          <>
            <div className="family-page-header">
              <div>
                <h2 className="card-title">Mi familia</h2>
                <p className="muted">Gestiona perfiles de salud vinculados según tu plan actual.</p>
              </div>
              <div className="family-page-plan-chip">
                {planInfo?.plan_type || "basico"}
              </div>
            </div>

            <div className="family-klinip-banner">
          <div className="family-klinip-banner-copy">
            <span className="family-klinip-banner-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <div>
              <p className="family-klinip-banner-title">
                Plan {planInfo?.plan_type || "familiar"} - {planCurrentProfiles} perfil{planCurrentProfiles === 1 ? "" : "es"} activo{planCurrentProfiles === 1 ? "" : "s"} de {planMaxProfiles}
              </p>
              <p className="family-klinip-banner-subtitle">
                Gestión coordinada para tu grupo de salud. Hay {linkedMembersCount} miembro{linkedMembersCount === 1 ? "" : "s"} vinculado{linkedMembersCount === 1 ? "" : "s"} y quedan {familySlotsRemaining} espacio{familySlotsRemaining === 1 ? "" : "s"} de perfil disponible{familySlotsRemaining === 1 ? "" : "s"}.
              </p>
            </div>
          </div>
          <div className="family-klinip-banner-actions">
            <div className="family-klinip-avatar-cluster">
              {bannerParticipants.slice(0, Math.max(planMaxProfiles, 5)).map((item) => (
                <FamilyAvatar
                  key={item.id}
                  className="family-klinip-avatar"
                  name={item.full_name || item.name}
                  avatarUrl={item.avatarUrl}
                  style={{ background: `linear-gradient(135deg, ${item.tone.start}, ${item.tone.end})` }}
                  fallback={item.initials}
                />
              ))}
              {Array.from({ length: familySlotsRemaining }).map((_, index) => (
                <button
                  key={`slot-${index}`}
                  type="button"
                  className="family-klinip-avatar family-klinip-avatar-add"
                  onClick={focusAssistedFamilyForm}
                >
                  +
                </button>
              ))}
            </div>
            <button
              type="button"
              className="family-klinip-upgrade"
              onClick={() => navigate("/planes/familiar")}
            >
              Ampliar plan
            </button>
          </div>
        </div>

        <div className="family-member-grid">
          {familyMemberCards.map((item) => (
            <article
              className={`family-member-card ${item.id === activeFamilyProfileId ? "is-active" : ""}`}
              key={item.id}
            >
              <div
                className="family-member-accent"
                style={{ background: `linear-gradient(90deg, ${item.tone.start}, ${item.tone.end})` }}
              />
              <div className="family-member-head">
                <FamilyAvatar
                  className="family-member-avatar"
                  name={item.full_name}
                  avatarUrl={item.avatarUrl}
                  style={{ background: `linear-gradient(135deg, ${item.tone.start}, ${item.tone.end})` }}
                  fallback={item.initials}
                />
                <div>
                  <p className="family-member-name">{item.full_name}</p>
                  <p className="family-member-meta">{item.relationshipLabel}</p>
                  <span
                    className={`family-member-badge ${item.isOwner ? "is-owner" : "is-managed"}`}
                    style={
                      item.isOwner
                        ? undefined
                        : { background: item.tone.soft, borderColor: item.tone.border, color: item.tone.start }
                    }
                  >
                    {item.badgeLabel}
                  </span>
                </div>
              </div>
              <div className="family-member-details">
                <p className="family-member-detail-line">
                  <strong>Acceso actual:</strong> {item.accessSummary}
                </p>
                <p className="family-member-detail-line">{item.accessHint}</p>
              </div>
              <div className="family-member-actions">
                <button
                  className="family-member-btn family-member-btn-outline"
                  type="button"
                  onClick={() => handleSetActiveProfile(item.id)}
                >
                  {item.id === activeFamilyProfileId ? "Perfil activo" : "Ver perfil"}
                </button>
                <button
                  className="family-member-btn family-member-btn-solid"
                  type="button"
                  onClick={() => {
                    handleSetActiveProfile(item.id);
                    navigate("/ai");
                  }}
                >
                  Abrir copiloto
                </button>
              </div>
            </article>
          ))}
          {collaboratorCards.map((item) => (
            <article className="family-member-card family-member-card-collaborator" key={item.id}>
              <div
                className="family-member-accent"
                style={{ background: `linear-gradient(90deg, ${item.tone.start}, ${item.tone.end})` }}
              />
              <div className="family-member-head">
                <FamilyAvatar
                  className="family-member-avatar"
                  name={item.name}
                  avatarUrl={item.avatarUrl}
                  style={{ background: `linear-gradient(135deg, ${item.tone.start}, ${item.tone.end})` }}
                  fallback={item.initials}
                />
                <div>
                  <p className="family-member-name">{item.name}</p>
                  <p className="family-member-meta">
                    {item.relationshipLabel}
                    {item.email ? ` - ${item.email}` : ""}
                  </p>
                  <span
                    className="family-member-badge is-managed"
                    style={{ background: item.tone.soft, borderColor: item.tone.border, color: item.tone.start }}
                  >
                    {item.accessLabel}
                  </span>
                </div>
              </div>
              <div className="family-member-collab-details">
                <p className="family-member-collab-line">
                  <strong>Perfil compartido:</strong> {item.sharedProfileName}
                </p>
                <p className="family-member-collab-line">{item.permissionSummary}</p>
              </div>
              <div className="family-member-actions">
                <button
                  className="family-member-btn family-member-btn-outline"
                  type="button"
                  onClick={focusFamilyRoles}
                >
                  Ver permisos
                </button>
                <button
                  className="family-member-btn family-member-btn-solid"
                  type="button"
                  onClick={focusFamilyRoles}
                >
                  Gestionar acceso
                </button>
              </div>
            </article>
          ))}
          {familySlotsRemaining > 0 && (
            <button
              type="button"
              className="family-member-card family-member-card-add"
              onClick={focusAssistedFamilyForm}
            >
              <span className="family-member-add-icon">+</span>
              <span className="family-member-add-title">Agregar familiar</span>
              <span className="family-member-add-sub">
                Te quedan {familySlotsRemaining} espacio{familySlotsRemaining === 1 ? "" : "s"} disponible{familySlotsRemaining === 1 ? "" : "s"}.
              </span>
            </button>
          )}
        </div>

        <div className="family-lower-layout">
          <div className="family-lower-left">
            <section className="family-collab-card family-canvas-card family-roles-card" ref={familyRolesCardRef}>
              <div className="family-card-line tone-teal" />
              <div className="family-card-head">
                <div>
                  <p className="family-card-kicker family-title-teal">Roles y accesos</p>
                  <p className="family-inline-muted">Gestiona permisos de cada colaborador</p>
                </div>
              </div>

              <div className="family-roles-help">
                <p className="family-inline-muted">Administrador: puede ver, editar y gestionar colaboradores y permisos.</p>
                <p className="family-inline-muted">Editor: puede ver y editar datos clínicos, pero no invitar ni cambiar permisos.</p>
                <p className="family-inline-muted">Lector: solo puede revisar la información del perfil compartido.</p>
              </div>

              <div className="family-roles-list">
                <article className="family-role-row">
                  <span className="family-role-avatar is-blue">{profileInitial}</span>
                  <div className="family-role-body">
                    <p className="family-role-name">{profileDisplayName}</p>
                    <p className="family-role-meta">{profileDisplayEmail} · self</p>
                  </div>
                  <div className="family-role-actions">
                    <select className="select-field" value="admin" disabled>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                </article>

                {caregivers.map((row, index) => (
                  <article className="family-role-row" key={row.id}>
                    <span className={`family-role-avatar ${index % 2 === 0 ? "is-violet" : "is-sky"}`}>
                      {(row.user_name || row.user_email || "CU")
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((part) => part[0]?.toUpperCase() || "")
                        .join("") || "CU"}
                    </span>
                    <div className="family-role-body">
                      <p className="family-role-name">
                        {row.user_name || row.user_email || `Usuario #${row.user_id}`}
                      </p>
                      <p className="family-role-meta">
                        {row.user_email || "Sin correo"} · {row.relationship_type || "Sin relación"}
                      </p>
                    </div>
                    <div className="family-role-actions">
                      <select
                        className="select-field"
                        value={row.role || "viewer"}
                        onChange={(e) => handleRoleChange(row.id, e.target.value)}
                      >
                        <option value="admin">Administrador</option>
                        <option value="caregiver">Editor</option>
                        <option value="viewer">Lector</option>
                      </select>
                      {String(row?.user_email || "").trim().toLowerCase() !== normalizedProfileEmail &&
                      String(row?.relationship_type || "").toLowerCase() !== "self" ? (
                        <button
                          className="secondary-btn danger"
                          type="button"
                          onClick={() => handleRemoveCaregiver(row.id)}
                        >
                          Quitar
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>

              <div className="family-invitations-block">
                <p className="family-subsection-label">Invitaciones</p>
                <p className="family-inv-section-note">
                  Pendiente significa que la persona aún no entra al perfil. Acceso activo significa que la invitación ya fue aceptada y ahora se gestiona desde Roles y accesos.
                </p>
                <div className="family-invitations-list">
                  {invitations.length ? (
                    invitations.map((inv) => renderManagedInvitation(inv))
                  ) : (
                    <p className="muted">No hay invitaciones registradas para este perfil.</p>
                  )}

                  {myPendingInvitations.map((inv) => (
                    <article className="family-inv-row" key={`pending-${inv.id}`}>
                      <div className="family-role-body">
                        <p className="family-role-name">{inv.profile_name}</p>
                        <p className="family-role-meta">
                          Invitado por {inv.inviter_name || `Usuario #${inv.inviter_user_id}`} · Rol: {familyRoleLabel(inv.role)}
                        </p>
                      </div>
                      <div className="family-role-actions">
                        <span className="family-status-pill is-pending">Pendiente</span>
                        <button
                          className="secondary-btn"
                          type="button"
                          onClick={() => handleAcceptInvitation(inv.token)}
                        >
                          Aceptar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

            </section>

            <section className="family-collab-card family-canvas-card family-notes-card">
              <div className="family-card-line tone-violet" />
              <div className="family-card-head">
                <div>
                  <p className="family-card-kicker family-title-violet">Notas del perfil</p>
                  <p className="family-inline-muted">
                    Deja contexto breve sobre síntomas, cambios o pendientes para quienes cuidan este perfil.
                  </p>
                </div>
                <button
                  className="family-link-btn"
                  type="button"
                  onClick={() => setShowAllProfileNotes((prev) => !prev)}
                  disabled={!canToggleProfileNotes}
                >
                  {canToggleProfileNotes ? (showAllProfileNotes ? "Ver menos" : `Ver historial (${profileNotes.length})`) : "Últimas notas"}
                </button>
              </div>

              <p className="family-note-purpose">
                Úsala para dejar observaciones rápidas que ayuden a otro cuidador a entender qué pasó y qué sigue.
              </p>

              {canEditActiveFamilyProfile ? (
                <>
                  <textarea
                    className="textarea-field family-notes-textarea"
                    value={newProfileNote}
                    onChange={(e) => setNewProfileNote(e.target.value)}
                    placeholder="Ej: Paciente reporta mejor respuesta al tratamiento..."
                  />
                  <button className="secondary-btn family-full-btn" type="button" onClick={handleCreateProfileNote}>
                    Guardar nota
                  </button>
                </>
              ) : (
                <p className="muted">
                  Disponible en plan Familiar para coordinación entre cuidadores.
                </p>
              )}

              <div className="family-notes-history">
                <div className="family-notes-history-head">
                  <p className="family-notes-history-title">Historial de notas</p>
                  {profileNotes.length ? (
                    <p className="family-inline-muted">
                      {showAllProfileNotes || profileNotes.length <= 3
                        ? `${profileNotes.length} nota${profileNotes.length === 1 ? "" : "s"} visible${profileNotes.length === 1 ? "" : "s"}`
                        : `Mostrando 3 de ${profileNotes.length} notas`}
                    </p>
                  ) : null}
                </div>
                {visibleProfileNotes.length ? (
                  <div className="family-notes-list">
                    {visibleProfileNotes.map((item) => (
                      <article className="family-note-item" key={item.id}>
                        <div className="family-note-item-head">
                          <p className="family-note-item-author">{item.created_by_name || "Cuidador"}</p>
                          <p className="family-note-item-meta">
                            {item.updated_at && item.updated_at !== item.created_at ? "Actualizada" : "Creada"}
                            {" · "}
                            {item.updated_at
                              ? toLocaleDateTimeOrEmpty(item.updated_at)
                              : toLocaleDateTimeOrEmpty(item.created_at)}
                          </p>
                        </div>
                        <p className="family-note-item-body">{item.note}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    Aún no hay notas del perfil guardadas para este perfil.
                  </p>
                )}
              </div>

              <div className="family-activity-divider">
                <span />
                <p>Actividad reciente</p>
                <span />
              </div>

              {!!activeFamilyProfileId ? (
                <div className="family-timeline">
                  {activityLog.length ? (
                    activityLog.map((entry) => {
                      const notePreview = getActivityNotePreview(entry);
                      const tone =
                        entry.action_type === "invitation_accepted"
                          ? "accept"
                        : entry.action_type === "invitation_revoked"
                          ? "revoke"
                        : entry.action_type?.startsWith("note_")
                          ? "note"
                          : "invite";
                      return (
                        <article className="family-timeline-item" key={entry.id}>
                          <span className={`family-timeline-dot is-${tone}`}>
                            {tone === "accept" ? "✓" : tone === "revoke" ? "✕" : tone === "note" ? "✎" : "↗"}
                          </span>
                          <div className="family-timeline-body">
                            <p className="family-timeline-text">{entry.description}</p>
                            {notePreview ? (
                              <p className="family-timeline-note-preview">"{notePreview}"</p>
                            ) : null}
                            <p className="family-timeline-meta">
                              <span className="family-timeline-type">
                                {ACTION_TYPE_LABELS[entry.action_type] || entry.action_type.replace(/_/g, " ")}
                              </span>
                              <span className="family-timeline-sep">·</span>
                              {entry.created_at ? toLocaleDateTimeOrEmpty(entry.created_at) : ""}
                            </p>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <p className="muted">Aún no hay actividad en este perfil.</p>
                  )}
                </div>
              ) : (
                <p className="muted">Selecciona un perfil para ver su actividad.</p>
              )}
            </section>
          </div>

          <div className="family-lower-right">
            <section className="family-collab-card family-canvas-card family-alerts-card">
              <div className="family-card-line tone-red" />
              <div className="family-card-head">
                <div>
                  <p className="family-card-kicker family-title-red">Alertas inteligentes</p>
                  <p className="family-inline-muted">Notificaciones automáticas del grupo</p>
                </div>
                <button className="family-link-btn" type="button">
                  Ver todas
                </button>
              </div>

              <div className="family-smart-alerts">
                {familyAlerts.length ? (
                  familyAlerts.slice(0, 3).map((alert) => (
                    <article
                      className={`family-smart-alert is-${alert.severity === "high" ? "high" : "medium"}`}
                      key={alert.id}
                    >
                      <div className="family-smart-alert-top">
                        <span className={`family-alert-level ${alert.severity === "high" ? "is-high" : "is-medium"}`}>
                          {String(alert.severity || "medium").toUpperCase()}
                        </span>
                        <span className="family-smart-alert-name">{alert.profile_name}</span>
                      </div>
                      <p className="family-smart-alert-title">{alert.title}</p>
                      <p className="family-smart-alert-body">{alert.message}</p>
                      {alert.suggested_action ? (
                        <p className="family-smart-alert-tip">→ {alert.suggested_action}</p>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="muted">No hay alertas activas por ahora.</p>
                )}
              </div>
            </section>

            <section className="family-collab-card family-canvas-card family-report-card family-ai-family-card">
              <div className="family-card-line tone-blue" />
              <div className="family-card-head">
                <div>
                  <p className="family-card-kicker family-title-blue">IA familiar</p>
                  <p className="family-inline-muted">Lectura transversal de perfiles, alertas y brechas del grupo</p>
                </div>
                <span className="family-inline-muted">30 días</span>
              </div>

              {hasRelevantFamilyAiSignals ? (
                <>
                  <p className="family-ai-summary">{familyAiContext.summary}</p>
                  <div className="family-report-kpis family-ai-kpis">
                    <article className="family-report-kpi">
                      <strong>{familyAiContext.family_size ?? 0}</strong>
                      <span>Perfiles</span>
                    </article>
                    <article className="family-report-kpi">
                      <strong>{familyAiContext.active_alerts_total ?? 0}</strong>
                      <span>Alertas</span>
                    </article>
                    <article className="family-report-kpi">
                      <strong>{familyAiContext.low_adherence_profiles ?? 0}</strong>
                      <span>Adherencia baja</span>
                    </article>
                    <article className="family-report-kpi">
                      <strong>{familyAiContext.pending_documents_total ?? 0}</strong>
                      <span>Documentos pendientes</span>
                    </article>
                  </div>
                  <div className="family-ai-profile-list">
                    {(familyAiContext.profiles || []).slice(0, 3).map((item) => (
                      <article key={item.profile_id} className="family-ai-profile-row">
                        <div>
                          <p className="family-report-highlight-name">{item.profile_name}</p>
                          <p className="family-inline-muted">
                            {item.relation_with_owner || "Perfil familiar"} · {item.upcoming_appointments || 0} citas próximas
                          </p>
                        </div>
                        <div className="family-ai-profile-tags">
                          <span className="family-status-pill is-pending">{item.active_alerts || 0} alertas</span>
                          {item.low_adherence ? <span className="family-status-pill is-danger">adherencia baja</span> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="family-report-empty">
                  <p className="family-report-empty-title">Aún no hay señales familiares relevantes.</p>
                  <p className="family-inline-muted">
                    Cuando se detecten alertas, adherencia baja o documentos pendientes, aparecerán aquí.
                  </p>
                </div>
              )}
            </section>

            <section className="family-collab-card family-canvas-card family-report-card">
              <div className="family-card-line tone-green" />
              <div className="family-card-head">
                <div>
                  <p className="family-card-kicker family-title-green">Reporte familiar</p>
                  <p className="family-inline-muted">Resumen de actividad del grupo</p>
                </div>
                <span className="family-inline-muted">Últimos 30 días</span>
              </div>

              {familyReport ? (
                <>
                  <div className="family-report-kpis">
                    <article className="family-report-kpi">
                      <strong>{familyReport?.totals?.profiles ?? 0}</strong>
                      <span>Perfiles</span>
                    </article>
                    <article className="family-report-kpi">
                      <strong>{familyReport?.totals?.medications_active ?? 0}</strong>
                      <span>Medicamentos</span>
                    </article>
                    <article className="family-report-kpi">
                      <strong>{familyReport?.totals?.appointments_total ?? 0}</strong>
                      <span>Citas</span>
                    </article>
                    <article className="family-report-kpi">
                      <strong>{familyReport?.totals?.documents_uploaded ?? 0}</strong>
                      <span>Documentos</span>
                    </article>
                  </div>

                  {familyReportHighlight ? (
                    <article className="family-report-highlight">
                      <p className="family-report-highlight-name">{familyReportHighlight.profile_name}</p>
                      <div className="family-report-inline-stats">
                        <p>Citas próximas: <strong>{familyReportHighlight.appointments_upcoming}</strong></p>
                        <p>
                          Adherencia:{" "}
                          <strong className="family-report-danger">
                            {familyReportHighlight.adherence_rate ?? 0}%
                          </strong>
                        </p>
                      </div>
                      <div className="family-report-progress-meta">
                        <span>Adherencia general</span>
                        <span>{familyReportHighlight.adherence_rate ?? 0}%</span>
                      </div>
                      <div className="family-report-progress">
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, Number(familyReportHighlight.adherence_rate ?? 0)))}%`,
                          }}
                        />
                      </div>
                    </article>
                  ) : null}
                </>
              ) : (
                <p className="muted">Sin datos de reporte aún.</p>
              )}
            </section>

            {canEditActiveFamilyProfile ? (
              <section className="family-collab-card family-canvas-card family-automation-card">
                <div className="family-card-line tone-violet" />
                <div className="family-card-head">
                  <div>
                    <p className="family-card-kicker family-title-violet">Automatizaciones</p>
                    <p className="family-inline-muted">Activa alertas y reportes automáticos</p>
                  </div>
                </div>

                <div className="family-automation-list">
                  {[
                    ["smart_alerts_enabled", "Alertas inteligentes"],
                    ["medication_overdue_alerts", "Alertas de adherencia"],
                    ["upcoming_appointment_alerts", "Alertas de citas próximas"],
                    ["inactivity_alerts", "Alertas por inactividad clínica"],
                    ["weekly_family_report_enabled", "Reporte familiar semanal"],
                  ].map(([key, label]) => (
                    <div className="family-automation-row" key={key}>
                      <span>{label}</span>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={!!automationSettings[key]}
                          onChange={(e) => handleToggleAutomationSetting(key, e.target.checked)}
                        />
                        <span className="switch-slider" />
                      </label>
                    </div>
                  ))}
                </div>

                <div className="family-automation-actions">
                  <button className="secondary-btn" type="button" onClick={handleSaveAutomationSettings}>
                    Guardar automatizaciones
                  </button>
                  <button className="secondary-btn" type="button" onClick={handleRunAutomations}>
                    Ejecutar ahora
                  </button>
                </div>
                {automationStatus ? <p className="muted" style={{ marginTop: "0.65rem" }}>{automationStatus}</p> : null}
              </section>
            ) : null}
          </div>
        </div>

        <div className="family-secondary-stack">
          {canManageActiveFamilyProfile ? (
            <div className="family-create-card family-management-card">
              <div className="family-card-line tone-teal" />
              <div className="family-card-head">
                <div>
                  <p className="family-card-kicker family-title-teal">Invitar colaborador</p>
                  <p className="family-inline-muted">Envía acceso a otra persona para ayudar con este perfil</p>
                </div>
              </div>
              <div className="form-row">
                <div className="input-group">
                  <label className="input-label">Correo</label>
                  <input
                    className="input-field"
                    type="email"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="correo@ejemplo.com"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Rol</label>
                  <select
                    className="select-field"
                    value={inviteForm.role}
                    onChange={(e) => setInviteForm((prev) => ({ ...prev, role: e.target.value }))}
                  >
                    <option value="admin">Administrador</option>
                    <option value="caregiver">Editor</option>
                    <option value="viewer">Lector</option>
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Relación</label>
                  <input
                    className="input-field"
                    value={inviteForm.relationship_type}
                    onChange={(e) =>
                      setInviteForm((prev) => ({ ...prev, relationship_type: e.target.value }))
                    }
                    placeholder="Ej: Hijo, Hermana, Cuidador"
                  />
                </div>
              </div>
              <button className="secondary-btn" type="button" onClick={handleInviteCaregiver}>
                Enviar invitación
              </button>
            </div>
          ) : null}

          {planInfo?.max_profiles > (planInfo?.current_profiles ?? 0) ? (
            <div className="family-create-card family-management-card" ref={familyCreateCardRef}>
              <div className="family-card-line tone-blue" />
              <div className="family-card-head">
                <div>
                  <p className="family-card-kicker family-title-blue">Agregar perfil asistido</p>
                  <p className="family-inline-muted">Crea manualmente un perfil de salud con más detalle</p>
                </div>
              </div>
              <div className="form-row">
                <div className="input-group">
                  <label className="input-label">Nombre completo</label>
                  <input
                    className="input-field"
                    ref={familyNameInputRef}
                    value={newFamilyProfile.full_name}
                    onChange={(e) =>
                      setNewFamilyProfile((prev) => ({ ...prev, full_name: e.target.value }))
                    }
                    placeholder="Ej: María González"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Relación</label>
                  <input
                    className="input-field"
                    value={newFamilyProfile.relation_with_owner}
                    onChange={(e) =>
                      setNewFamilyProfile((prev) => ({ ...prev, relation_with_owner: e.target.value }))
                    }
                    placeholder="Ej: Madre, Padre, Hijo/a"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Sexo/Género (opcional)</label>
                  <input
                    className="input-field"
                    value={newFamilyProfile.gender}
                    onChange={(e) =>
                      setNewFamilyProfile((prev) => ({ ...prev, gender: e.target.value }))
                    }
                    placeholder="Ej: Femenino"
                  />
                </div>
              </div>
              <button className="secondary-btn" type="button" onClick={handleCreateFamilyProfile}>
                Crear perfil
              </button>
            </div>
          ) : (
            <p className="muted">
              Alcanzaste el límite de perfiles de tu plan. Para agregar más, sube de plan.
            </p>
          )}

          <div className="family-create-card family-management-card family-profile-switcher-card">
            <div className="family-card-line tone-blue" />
            <div className="family-card-head">
              <div>
                <p className="family-card-kicker family-title-blue">Perfiles activos</p>
                <p className="family-inline-muted">Cambia rápido el perfil familiar en uso</p>
              </div>
            </div>
            <div className="family-list family-profile-list">
              {familyLoading ? (
                <p className="muted">Cargando perfiles...</p>
              ) : familyProfiles.length ? (
                familyProfiles.map((item) => (
                  <article
                    className={`family-item family-profile-row ${item.id === activeFamilyProfileId ? "is-active" : ""}`}
                    key={item.id}
                    >
                      <div>
                        <p className="family-name">{item.full_name}</p>
                        <p className="muted family-profile-row-meta">
                          {item.relation_with_owner || "Sin relación"} · {familyRoleLabel(item.access_role || "admin")}
                        </p>
                      </div>
                    <button
                      className="secondary-btn"
                      type="button"
                      onClick={() => handleSetActiveProfile(item.id)}
                    >
                      {item.id === activeFamilyProfileId ? "Activo" : "Activar"}
                    </button>
                  </article>
                ))
              ) : (
                <p className="muted">Aun no tienes perfiles de salud vinculados.</p>
              )}
            </div>
          </div>
        </div>

        {familyStatus && <p className="muted" style={{ marginTop: "0.75rem" }}>{familyStatus}</p>}
          </>
        )}
      </div>
      )}

      {activeSection === "datos" && (
      <div className={getSettingsSectionClassName("datos")}>
        <div className="profile-page-header">
          <div>
            <p className="profile-page-eyebrow"><span />Portabilidad</p>
            <h2 className="profile-page-title">
              Exportar <em>mis datos</em>
            </h2>
            <p className="muted">Descarga una copia completa de tu información de salud.</p>
          </div>
        </div>
        <div className="export-layout">
          <div className="export-card">
            <h4>Descargar archivos</h4>
            <p className="muted">
              Exporta tus citas y documentos para respaldo o revisión externa.
            </p>
            <div className="export-actions">
              <button className="secondary-btn" type="button" onClick={exportCsv}>
                Descargar CSV de citas
              </button>
              <button className="secondary-btn" type="button" onClick={exportPdf}>
                Descargar PDF resumen
              </button>
            </div>
          </div>

          <div className="export-card">
            <h4>Compartir por enlace</h4>
            <p className="muted">
              Crea un enlace temporal con tus datos actuales y cópialo al portapapeles.
            </p>
            <div className="export-actions">
              <button className="secondary-btn" type="button" onClick={shareLink} disabled={exporting}>
                {exporting ? "Generando enlace..." : "Generar y copiar enlace"}
              </button>
            </div>
            <p className="muted export-note">
              El enlace se genera con la información disponible al momento de crearlo.
            </p>
          </div>
        </div>
        <div className="export-footer">
          <div className="export-footer-tip">
            Recomendación: usa PDF para lectura y CSV para análisis o importación.
          </div>
          <div>
            <button className="primary-btn" type="button" onClick={shareLink} disabled={exporting}>
              {exporting ? "Generando..." : "Compartir enlace rápido"}
            </button>
          </div>
        </div>
      </div>
      )}

      {activeSection === "reportes" && (
      <div className={getSettingsSectionClassName("reportes")}>
        <div className="profile-page-header">
          <div>
            <p className="profile-page-eyebrow"><span />Copiloto IA</p>
            <h2 className="profile-page-title">
              Reportes <em>clínicos</em>
            </h2>
            <p className="muted">Accede a la vista dedicada de reportes y también solicítalos directamente desde Klinip IA.</p>
          </div>
        </div>
        <div className="export-layout">
          <div className="export-card">
            <h4>Vista dedicada de reportes</h4>
            <p className="muted">
              Revisa, filtra y descarga reportes clínicos estructurados del perfil activo desde una vista exclusiva.
            </p>
            <div className="export-actions">
              <Link className="secondary-btn" to="/clinical-reports">
                Ir a reportes clínicos
              </Link>
            </div>
          </div>

          <div className="export-card">
            <h4>Pedir reportes en el chat</h4>
            <p className="muted">
              También puedes generarlos desde Klinip IA con mensajes como “genera un reporte clínico” o “crea un reporte mensual”.
            </p>
            <div className="export-actions">
              <Link className="secondary-btn" to="/ai">
                Abrir Klinip IA
              </Link>
            </div>
          </div>
        </div>
        <div className="export-footer">
          <div className="export-footer-tip">
            Los reportes generados desde IA también quedan disponibles en la vista dedicada para descarga en PDF.
          </div>
        </div>
      </div>
      )}

      {activeSection === "notificaciones" && (
      <div className={getSettingsSectionClassName("notificaciones")}>
        <div className="profile-page-header">
          <div>
            <p className="profile-page-eyebrow"><span />Alertas</p>
            <h2 className="profile-page-title">
              Centro de <em>notificaciones</em>
            </h2>
            <p className="muted">Controla qué alertas recibes y por qué canal.</p>
          </div>
        </div>
        <div className="profile-page-card profile-page-card-accent-blue">
          <div className="profile-page-card-line" />
          <h4>Preferencias de notificación</h4>
          <p className="card-sub">Configura citas, medicamentos, adherencia y avisos generales.</p>
          <NotificationSettings embedded />
        </div>
      </div>
      )}

      {activeSection === "legal" && (
      <div className={getSettingsSectionClassName("legal")}>
        <div className="profile-page-header">
          <div>
            <p className="profile-page-eyebrow"><span />Documentación</p>
            <h2 className="profile-page-title">
              Información <em>legal</em>
            </h2>
            <p className="muted">Términos, políticas y condiciones de uso de Klinip.</p>
          </div>
        </div>
        <div className="profile-page-card profile-page-card-accent-slate">
          <div className="profile-page-card-line" />
          <h4>Documentos legales</h4>
          <p className="card-sub">Lee y revisa las políticas que rigen el uso de la plataforma.</p>
          <div className="legal-list">
            <Link className="legal-row" to="/legal/terms">
              <span className="lr-title">Términos y condiciones de uso</span>
              <div className="lr-arrow">
                <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </Link>
            <Link className="legal-row" to="/legal/privacy">
              <span className="lr-title">Política de privacidad</span>
              <div className="lr-arrow">
                <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </Link>
            <Link className="legal-row" to="/legal/consent">
              <span className="lr-title">Consentimiento de datos</span>
              <div className="lr-arrow">
                <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </Link>
            <div className="legal-row">
              <span className="lr-title">Estado de consentimiento: {consentRevoked ? "Revocado" : "Activo"}</span>
              <div>
                {consentRevoked ? (
                  <button className="btn-sm" type="button" onClick={handleRestoreConsent}>
                    Restaurar
                  </button>
                ) : (
                  <button className="btn-sm" type="button" onClick={handleRevokeConsent}>
                    Revocar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {activeSection === "seguridad" && (
      <div className={getSettingsSectionClassName("seguridad")}>
        <div className="profile-page-header">
          <div>
            <p className="profile-page-eyebrow"><span />Cuenta</p>
            <h2 className="profile-page-title">
              <em>Seguridad</em> avanzada
            </h2>
            <p className="muted">Protección reforzada para tu cuenta, documentos e información clínica.</p>
          </div>
        </div>
        <div className="security-stack">
          <div className="privacy-card security-overview-card">
            <div className="privacy-card-header security-card-heading">
              <div>
                <h4>Cómo protegemos las acciones sensibles</h4>
                <p className="muted">
                  Cuando abres o descargas documentos clínicos, Klinip te vuelve a pedir confirmar tu identidad.
                </p>
              </div>
            </div>
            <div className="security-overview-grid">
              <div className="security-overview-tile">
                <span className="security-overview-kicker">Método recomendado</span>
                <strong>Código temporal por correo</strong>
                <p className="muted">
                  Recibes un código numérico de 6 dígitos en tu correo y lo ingresas para continuar. No requiere otra app.
                </p>
              </div>
              <div className="security-overview-tile">
                <span className="security-overview-kicker">Método alternativo</span>
                <strong>Tu contraseña actual</strong>
                <p className="muted">
                  Es la misma contraseña con la que inicias sesión. No corresponde a la contraseña del perfil de salud.
                </p>
              </div>
              <div className="security-overview-tile">
                <span className="security-overview-kicker">Opción avanzada</span>
                <strong>App autenticadora</strong>
                <p className="muted">
                  Es opcional. Puedes usar apps gratuitas como Google Authenticator, Microsoft Authenticator o Authy.
                </p>
              </div>
            </div>
          </div>

          <div className="privacy-card security-pin-card">
            <div className="privacy-card-header security-card-heading">
              <div>
                <h4>Bloqueo con PIN</h4>
                <p className="muted">
                  Usa un PIN de 4 dígitos adicional a tu contraseña. Se guarda en tu
                  cuenta y será el mismo en todos tus dispositivos, pero se pedirá
                  al reabrir Klinip en cada sesión.
                </p>
              </div>
              <span className={`privacy-status-pill ${pinEnabled ? "is-on" : "is-off"}`}>
                {pinEnabled ? "Activado" : "Desactivado"}
              </span>
            </div>

            {pinNotice ? (
              <div className="security-inline-notice is-info">
                <span>{pinNotice}</span>
              </div>
            ) : null}

            {!pinSupported ? (
              <div className="security-inline-notice is-warning">
                <span>Este navegador no permite administrar el PIN en este momento.</span>
              </div>
            ) : (
              <>
                <div className="security-pin-row">
                  <div>
                    <strong>Activar bloqueo con PIN</strong>
                    <p className="muted">
                      {pinEnabled
                        ? pinHasSet
                          ? "El mismo PIN se pedirá cuando vuelvas a abrir Klinip en cualquiera de tus dispositivos."
                          : "Crea tu PIN para terminar de activar esta protección."
                        : "Actívalo para usar el mismo PIN en todos tus dispositivos."}
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={pinEnabled}
                      disabled={pinBusy}
                      onChange={(e) => handlePinToggle(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="security-inline-notice is-info">
                  <span>
                    Si olvidas tu PIN, puedes cerrar sesión, volver a entrar con tu
                    contraseña y cambiarlo desde aquí.
                  </span>
                </div>

                {pinEnabled && pinHasSet ? (
                  <div className="privacy-actions">
                    <button
                      className="secondary-btn"
                      type="button"
                      disabled={pinBusy}
                      onClick={() => {
                        setPinNotice("");
                        setPinFlow("change");
                      }}
                    >
                      Cambiar PIN
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="security-grid">
            <div className="privacy-card security-mfa-card">
              <div className="privacy-card-header security-card-heading">
                <div>
                  <h4>App autenticadora opcional</h4>
                  <p className="muted">
                    Si quieres una capa extra, puedes activar una app autenticadora aparte de tu contraseña.
                  </p>
                </div>
                {mfaStatus && (
                  <span className={`privacy-status-pill ${mfaStatus.mfa_enabled ? "is-on" : "is-off"}`}>
                    {mfaStatus.mfa_enabled ? "Activa" : "Inactiva"}
                  </span>
                )}
              </div>

              {mfaNotice ? (
                <div className={`security-inline-notice ${mfaNoticeTone}`}>
                  <span>{mfaNotice}</span>
                </div>
              ) : null}

              {!mfaEnrollData ? (
                <div className="security-faq-list">
                  <div className="security-faq-item">
                    <strong>¿Necesito otra app?</strong>
                    <p className="muted">Solo si quieres activar esta capa extra. Klinip seguirá funcionando con correo y contraseña.</p>
                  </div>
                  <div className="security-faq-item">
                    <strong>¿Las apps autenticadoras son gratis?</strong>
                    <p className="muted">Sí. Las más conocidas son gratuitas y muestran un código de 6 dígitos que cambia cada pocos segundos.</p>
                  </div>
                </div>
              ) : null}

              {mfaStatus && !mfaStatus.mfa_enabled && !mfaEnrollData ? (
                <div className="privacy-actions">
                  <button className="primary-btn" type="button" onClick={handleMfaEnrollStart} disabled={mfaLoading}>
                    {mfaLoading ? "Preparando..." : "Activar app autenticadora"}
                  </button>
                </div>
              ) : null}

              {mfaEnrollData ? (
                <div className="security-mfa-enroll">
                  <div className="security-step-list">
                    <div className="security-step-card">
                      <span className="security-step-number">1</span>
                      <div>
                        <strong>Escanea el código QR</strong>
                        <p className="muted">
                          Abre tu app autenticadora, toca “Agregar cuenta” y escanea este QR. Si no puedes escanearlo, usa la clave manual.
                        </p>
                      </div>
                    </div>
                    <div className="security-mfa-qr">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(mfaEnrollData.totp_uri)}`}
                        alt="Código QR para MFA"
                        width={200}
                        height={200}
                      />
                    </div>
                    <div className="security-mfa-secret">
                      <span className="security-inline-label">Clave manual</span>
                      <code>{mfaEnrollData.secret}</code>
                    </div>

                    <div className="security-step-card">
                      <span className="security-step-number">2</span>
                      <div>
                        <strong>Guarda tus códigos de respaldo</strong>
                        <p className="muted">Sirven si pierdes acceso al celular. Se muestran solo una vez.</p>
                      </div>
                    </div>
                    <div className="security-code-grid">
                      {mfaEnrollData.backup_codes.map((code) => (
                        <code key={code} className="security-code-chip">{code}</code>
                      ))}
                    </div>

                    <div className="security-step-card">
                      <span className="security-step-number">3</span>
                      <div>
                        <strong>Confirma con el código de la app</strong>
                        <p className="muted">Ingresa el código de 6 dígitos que ahora ves en tu app autenticadora.</p>
                      </div>
                    </div>
                    <div className="security-inline-form">
                      <input
                        className="input-field security-code-input"
                        type="text"
                        inputMode="numeric"
                        value={mfaEnrollCode}
                        onChange={(event) => setMfaEnrollCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="000000"
                        maxLength={6}
                      />
                      <button
                        className="primary-btn"
                        type="button"
                        onClick={handleMfaEnrollConfirm}
                        disabled={mfaLoading || mfaEnrollCode.length < 6}
                      >
                        {mfaLoading ? "Verificando..." : "Confirmar activación"}
                      </button>
                      <button
                        className="secondary-btn"
                        type="button"
                        onClick={() => {
                          setMfaEnrollData(null);
                          setMfaEnrollCode("");
                          setMfaNotice("");
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {mfaStatus?.mfa_enabled && !mfaEnrollData ? (
                <div className="security-mfa-active">
                  <div className="security-mini-stat">
                    <span className="security-inline-label">Códigos de respaldo disponibles</span>
                    <strong>{mfaStatus.backup_codes_remaining}</strong>
                  </div>

                  <div className="security-inline-block">
                    <strong>Regenerar códigos de respaldo</strong>
                    <p className="muted">Ingresa un código actual de tu app autenticadora para generar nuevos códigos de respaldo.</p>
                    <div className="security-inline-form">
                      <input
                        className="input-field security-code-input"
                        type="text"
                        inputMode="numeric"
                        value={mfaRegenCode}
                        onChange={(event) => setMfaRegenCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="Código de la app"
                        maxLength={6}
                      />
                      <button
                        className="secondary-btn"
                        type="button"
                        onClick={handleMfaRegenBackupCodes}
                        disabled={mfaLoading || mfaRegenCode.length < 6}
                      >
                        Regenerar
                      </button>
                    </div>
                    {mfaNewBackupCodes ? (
                      <div className="security-code-grid">
                        {mfaNewBackupCodes.map((code) => (
                          <code key={code} className="security-code-chip">{code}</code>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="security-inline-block">
                    <strong>Desactivar app autenticadora</strong>
                    <p className="muted">Puedes apagarla cuando quieras usando un código de la app o un código de respaldo.</p>
                    <div className="security-inline-form">
                      <input
                        className="input-field"
                        type="text"
                        value={mfaDisableCode}
                        onChange={(event) => setMfaDisableCode(event.target.value.slice(0, 32))}
                        placeholder="Código de la app o de respaldo"
                      />
                      <button
                        className="secondary-btn danger"
                        type="button"
                        onClick={handleMfaDisable}
                        disabled={mfaLoading || !mfaDisableCode}
                      >
                        Desactivar
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="privacy-card security-sessions-card">
              <div className="privacy-card-header security-card-heading">
                <div>
                  <h4>Sesiones activas</h4>
                  <p className="muted">Dispositivos que mantienen acceso a tu cuenta en este momento.</p>
                </div>
                <button className="secondary-btn danger" type="button" onClick={handleRevokeAllSessions}>
                  Cerrar todas
                </button>
              </div>

              {sessionsLoading ? (
                <p className="muted">Cargando sesiones...</p>
              ) : sessions.length === 0 ? (
                <p className="muted">No hay sesiones activas registradas.</p>
              ) : (
                <div className="security-session-list">
                  {sessions.map((session) => {
                    const deviceInfo = getSessionDeviceSummary(session.device_label);
                    return (
                      <div key={session.id} className="security-session-card">
                        <div className="security-session-main">
                          <div className="security-session-topline">
                            <strong className="security-session-title">{deviceInfo.title}</strong>
                            {session.is_current ? <span className="security-session-pill">Sesión actual</span> : null}
                          </div>
                          {deviceInfo.detail ? (
                            <p className="security-session-detail">{deviceInfo.detail}</p>
                          ) : null}
                          <div className="security-session-meta">
                            <span className="security-session-meta-item">
                              <strong>IP</strong>
                              <span>{session.ip_address || "No disponible"}</span>
                            </span>
                            <span className="security-session-meta-item">
                              <strong>Creada</strong>
                              <span>
                                {session.created_at
                                  ? new Date(session.created_at).toLocaleString("es-CL", {
                                      dateStyle: "short",
                                      timeStyle: "short",
                                    })
                                  : "Sin fecha"}
                              </span>
                            </span>
                            <span className="security-session-meta-item">
                              <strong>Último uso</strong>
                              <span>
                                {session.last_used_at
                                  ? new Date(session.last_used_at).toLocaleString("es-CL", {
                                      dateStyle: "short",
                                      timeStyle: "short",
                                    })
                                  : "Sin registro"}
                              </span>
                            </span>
                          </div>
                        </div>
                        <button
                          className="secondary-btn danger security-session-action"
                          type="button"
                          onClick={() => handleRevokeSession(session.id)}
                        >
                          Revocar
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="privacy-card security-audit-card">
            <div className="security-card-heading">
              <div>
                <h4>Historial de seguridad</h4>
                <p className="muted">Últimos eventos relacionados con acceso, verificación y cambios de seguridad.</p>
              </div>
            </div>
            {auditLoading ? (
              <p className="muted">Cargando historial...</p>
            ) : auditLogs.length === 0 ? (
              <p className="muted">Sin eventos registrados.</p>
            ) : (
              <div className="security-audit-list">
                {auditLogs.map((log) => (
                  <article key={log.id} className="security-audit-item">
                    <div className="security-audit-main">
                      <span className={`security-audit-badge ${getSecurityEventTone(log.action)}`}>
                        {getSecurityEventLabel(log.action)}
                      </span>
                      <p className="muted">
                        IP: {log.ip_address || "No disponible"}
                      </p>
                    </div>
                    <time className="security-audit-date">
                      {log.created_at
                        ? new Date(log.created_at).toLocaleString("es-CL", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "Sin fecha"}
                    </time>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {activeSection === "privacidad" && (
      <div className={getSettingsSectionClassName("privacidad")}>
        <div className="profile-page-header">
          <div>
            <p className="profile-page-eyebrow"><span />Seguridad</p>
            <h2 className="profile-page-title">
              <em>Privacidad</em> y acceso
            </h2>
            <p className="muted">Gestiona la seguridad de tu cuenta y el acceso a tus datos.</p>
          </div>
        </div>
        <div className="privacy-layout">
          <div className="privacy-card">
            <div className="privacy-card-header">
              <h4>Consentimiento y cuenta</h4>
              <span className={`privacy-status-pill ${consentRevoked ? "is-off" : "is-on"}`}>
                {consentRevoked ? "Revocado" : "Activo"}
              </span>
            </div>
            <p className="muted">
              Gestiona el permiso para datos de salud y las acciones críticas de tu cuenta.
            </p>
            <div className="privacy-actions">
              {consentRevoked ? (
                <button className="secondary-btn" type="button" onClick={handleRestoreConsent}>
                  Restaurar consentimiento
                </button>
              ) : (
                <button className="secondary-btn" type="button" onClick={handleRevokeConsent}>
                  Revocar consentimiento
                </button>
              )}
              <button className="secondary-btn danger" type="button" onClick={() => setShowDeleteConfirm(true)}>
                Eliminar mi cuenta
              </button>
            </div>
          </div>

          <div className="privacy-card">
            <h4>Exportar y limpieza</h4>
            <p className="muted">
              Descarga tus datos o limpia información local del navegador.
            </p>
            <div className="privacy-actions">
              <button className="secondary-btn" type="button" onClick={exportCsv}>
                CSV citas
              </button>
              <button className="secondary-btn" type="button" onClick={exportPdf}>
                PDF resumen
              </button>
              <button className="secondary-btn" type="button" onClick={handleClearLocal}>
                Borrar datos locales
              </button>
            </div>
          </div>

          <div className="privacy-card privacy-support-card">
            <h4>Soporte de privacidad</h4>
            <p className="muted">
              Si necesitas acceso, rectificación o eliminación de datos, envía tu solicitud aquí.
            </p>
            <div className="privacy-form-grid">
              <div className="input-group">
                <label className="input-label">Motivo</label>
                <select
                  className="select-field"
                  value={privacyReason}
                  onChange={(e) => setPrivacyReason(e.target.value)}
                >
                  <option value="acceso">Acceso a mis datos</option>
                  <option value="rectificacion">Rectificación</option>
                  <option value="eliminacion">Eliminación</option>
                  <option value="otra">Otra consulta</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Mensaje</label>
                <textarea
                  className="textarea-field"
                  value={privacyMessage}
                  onChange={(e) => setPrivacyMessage(e.target.value)}
                  placeholder="Escribe tu solicitud..."
                />
              </div>
            </div>
            <label className="auth-consent-label" style={{ marginBottom: "0.75rem" }}>
              <input
                type="checkbox"
                checked={privacyIncludeTech}
                onChange={(e) => setPrivacyIncludeTech(e.target.checked)}
              />
              <span>Adjuntar información técnica básica</span>
            </label>
            <div className="privacy-form-actions">
              <button
                className="primary-btn"
                type="button"
                onClick={handleSendPrivacyRequest}
                disabled={privacySending || !privacyMessage.trim()}
              >
                {privacySending ? "Enviando..." : "Enviar solicitud"}
              </button>
            </div>
          </div>
        </div>
        {privacyNotice && (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            {privacyNotice}
          </p>
        )}
      </div>
      )}
        </div>
      </div>

      <SuccessSheet
        open={Boolean(settingsSuccess)}
        onClose={() => setSettingsSuccess(null)}
        {...(settingsSuccess || {})}
      />

      {showDeleteConfirm && (
        <div className="modal-backdrop">
          <div className="modal-card" role="dialog" aria-modal="true">
            <h3>Eliminar mi cuenta y todos mis datos</h3>
            <p className="muted">
              Esta acción es permanente. Se eliminarán tus datos de citas,
              medicamentos y documentos. No podrás deshacer este cambio.
            </p>
            <p className="muted">
              ¿Estás seguro de que deseas eliminar tu cuenta y todos tus datos de Klinip?
              Esta acción es irreversible.
            </p>
            <div className="modal-actions">
              <button className="secondary-btn" type="button" onClick={() => setShowDeleteConfirm(false)}>
                Cancelar
              </button>
              <button className="primary-btn" type="button" onClick={handleDeleteAccount}>
                Sí, eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrivacySuccessModal && (
        <div className="modal-backdrop" onClick={() => setShowPrivacySuccessModal(false)}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Solicitud enviada</h3>
            <p className="muted">{privacySuccessMessage}</p>
            <div className="modal-actions">
              <button className="primary-btn" type="button" onClick={() => setShowPrivacySuccessModal(false)}>
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      <StepUpModal
        open={stepUpOpen}
        onClose={() => { setStepUpOpen(false); setStepUpPending(null); }}
        onVerified={handleSettingsStepUpVerified}
        hasMfa={!!mfaStatus?.mfa_enabled}
        actionLabel={stepUpPending === "deleteAccount" ? "eliminar tu cuenta" : "esta acción"}
      />
      {pinFlow ? (
        <PinLock
          user={user}
          forceSetup
          hasExistingPin={pinHasSet}
          onUnlock={handlePinFlowDone}
          onCancel={handlePinFlowCancel}
        />
      ) : null}
    </>
  );
}
