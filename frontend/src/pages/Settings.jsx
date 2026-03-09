import React, { useState, useMemo, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import NotificationSettings from "../components/NotificationSettings";
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
  runFamilyAutomations,
  getProfileAutomation,
  updateProfileAutomation,
  getProfileNotes,
  createProfileNote,
  revokeDataConsent,
  deleteAccount as deleteAccountApi,
  submitPrivacyRequest,
} from "../api";
import { toIsoOrNull, toLocaleDateOrEmpty, toLocaleDateTimeOrEmpty } from "../utils/dates";

export default function Settings({ user, onLogout, theme, onToggleTheme, onUserUpdate }) {
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeSection, setActiveSection] = useState("perfil");
  const [isMobileSettings, setIsMobileSettings] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 640 : false
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
  const [inviteForm, setInviteForm] = useState({
    email: "",
    role: "viewer",
    relationship_type: "",
  });
  const plan = planInfo?.plan_type || "basico";

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
  const profileInitial = (profileDisplayName || profileDisplayEmail).trim().charAt(0).toUpperCase();

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

  useEffect(() => {
    const onResize = () => {
      const isMobile = window.innerWidth <= 640;
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
        setFamilyProfiles(Array.isArray(profiles) ? profiles : []);
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
        const [cards, alerts, report, pendingForMe] = await Promise.all([
          getFamilyPanel(),
          getFamilyAlerts().catch(() => []),
          getFamilyReportSummary(30).catch(() => null),
          getMyPendingProfileInvitations().catch(() => []),
        ]);
        if (mounted) setFamilyPanelCards(Array.isArray(cards) ? cards : []);
        if (mounted) setFamilyAlerts(Array.isArray(alerts) ? alerts : []);
        if (mounted) setFamilyReport(report || null);
        if (mounted) setMyPendingInvitations(Array.isArray(pendingForMe) ? pendingForMe : []);
      } catch (err) {
        if (mounted) setFamilyPanelCards([]);
        if (mounted) setFamilyAlerts([]);
        if (mounted) setFamilyReport(null);
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
          getHealthProfileActivity(activeFamilyProfileId),
          getProfileAutomation(activeFamilyProfileId).catch(() => null),
          getProfileNotes(activeFamilyProfileId).catch(() => []),
        ]);
        if (!mounted) return;
        setCaregivers(Array.isArray(careList) ? careList : []);
        setInvitations(Array.isArray(invList) ? invList : []);
        setActivityLog(Array.isArray(actList) ? actList : []);
        if (autoCfg) setAutomationSettings(autoCfg);
        setProfileNotes(Array.isArray(notesList) ? notesList : []);
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
  }, [profile?.id, activeFamilyProfileId, planInfo?.plan_type]);

  const handleSectionSelect = (section) => {
    setActiveSection(section);
    if (isMobileSettings) {
      setMobileSectionOpen(true);
    }
  };

  const activeSectionLabel = {
    perfil: "Perfil",
    familia: "Mi familia",
    privacidad: "Privacidad",
    notificaciones: "Notificaciones",
    datos: "Exportar",
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
            body { font-family: Poppins, Arial, sans-serif; padding: 16px; }
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
        window.alert("Link de comparticiИn copiado al portapapeles.");
      } else {
        prompt("Copia este link", link);
      }
    } catch (err) {
      console.error("No se pudo generar link", err);
      window.alert("No se pudo generar el link.");
    } finally {
      setExporting(false);
    }
  };


  const handleClearLocal = () => {
    if (!window.confirm("¿Borrar los datos locales de Klinip en este navegador?")) return;
    const keys = [
      "klinip_users",
      "klinip_session",
      "klinip_appointments",
      "klinip_documents",
      "klinip_medications",
      "klinip_onboarding_seen",
      "klinip_onboarding_completed_v1",
    ];
    keys.forEach((k) => localStorage.removeItem(k));
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

  const handleDeleteAccount = async () => {
    setPrivacyNotice("");
    try {
      await deleteAccountApi();
      localStorage.removeItem("token");
      onLogout?.();
      navigate("/register");
    } catch (err) {
      console.error(err);
      setPrivacyNotice("No se pudo eliminar la cuenta.");
    }
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

  const handleSaveHealthProfile = async () => {
    setHealthProfileStatus("");
    try {
      const updated = await updateMe({
        chronic_condition: (chronicCondition || "").trim(),
        primary_care_center: (primaryCareCenter || "").trim(),
      });
      onUserUpdate?.(updated);
      setHealthProfileStatus("Perfil de salud actualizado");
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
      setFamilyPanelCards(Array.isArray(cards) ? cards : []);
      setFamilyStatus(`Perfil ${created?.full_name || ""} creado correctamente`);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo crear el perfil");
      console.error("Error creando perfil asistido:", err);
    }
  };

  const handleInviteCaregiver = async () => {
    if (!activeFamilyProfileId) {
      setFamilyStatus("Selecciona un perfil activo para invitar");
      return;
    }
    const email = (inviteForm.email || "").trim().toLowerCase();
    if (!email) {
      setFamilyStatus("Debes ingresar un correo para la invitacion");
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
        getHealthProfileActivity(activeFamilyProfileId),
      ]);
      setCaregivers(Array.isArray(careList) ? careList : []);
      setInvitations(Array.isArray(invList) ? invList : []);
      setActivityLog(Array.isArray(actList) ? actList : []);
      setInviteForm({ email: "", role: "viewer", relationship_type: "" });
      setFamilyStatus("Invitacion/provision de acceso creada correctamente");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo crear la invitacion");
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
      setFamilyProfiles(Array.isArray(profiles) ? profiles : []);
      setActiveFamilyProfileId(active?.id || activeFamilyProfileId);
      setFamilyPanelCards(Array.isArray(cards) ? cards : []);
      setMyPendingInvitations(Array.isArray(pendingForMe) ? pendingForMe : []);
      setFamilyStatus("Invitacion aceptada correctamente");
      setActiveSection("familia");
      if (isMobileSettings) {
        setMobileSectionOpen(true);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo aceptar la invitacion");
      console.error("Error aceptando invitacion:", err);
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
        getHealthProfileActivity(activeFamilyProfileId),
      ]);
      setCaregivers(Array.isArray(careList) ? careList : []);
      setActivityLog(Array.isArray(actList) ? actList : []);
      setFamilyStatus("Rol actualizado");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo actualizar el rol");
      console.error("Error actualizando rol:", err);
    }
  };

  const handleRemoveCaregiver = async (relationshipId) => {
    if (!activeFamilyProfileId) return;
    if (!window.confirm("Deseas quitar este colaborador del perfil?")) return;
    try {
      await removeProfileRelationship(activeFamilyProfileId, relationshipId);
      const [careList, actList] = await Promise.all([
        getProfileCaregivers(activeFamilyProfileId),
        getHealthProfileActivity(activeFamilyProfileId),
      ]);
      setCaregivers(Array.isArray(careList) ? careList : []);
      setActivityLog(Array.isArray(actList) ? actList : []);
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
        getHealthProfileActivity(activeFamilyProfileId),
      ]);
      setInvitations(Array.isArray(invList) ? invList : []);
      setActivityLog(Array.isArray(actList) ? actList : []);
      setFamilyStatus("Invitacion revocada");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFamilyStatus(detail || "No se pudo revocar la invitacion");
      console.error("Error revocando invitacion:", err);
    }
  };

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
      setFamilyAlerts(Array.isArray(alerts) ? alerts : []);
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
      const [alerts, report] = await Promise.all([
        getFamilyAlerts().catch(() => []),
        getFamilyReportSummary(30).catch(() => null),
      ]);
      setFamilyAlerts(Array.isArray(alerts) ? alerts : []);
      setFamilyReport(report || null);
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
      setFamilyStatus("La nota no puede estar vacia");
      return;
    }
    try {
      await createProfileNote(activeFamilyProfileId, { note, visibility: "shared" });
      const [notesList, actList] = await Promise.all([
        getProfileNotes(activeFamilyProfileId).catch(() => []),
        getHealthProfileActivity(activeFamilyProfileId),
      ]);
      setProfileNotes(Array.isArray(notesList) ? notesList : []);
      setActivityLog(Array.isArray(actList) ? actList : []);
      setNewProfileNote("");
      setFamilyStatus("Nota colaborativa guardada");
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
    } catch (err) {
      setEmailRemindersEnabled(previous);
      localStorage.setItem("klinip_email_reminders_enabled", previous ? "true" : "false");
      setEmailReminderStatus("No se pudo actualizar la preferencia de correo");
      console.error("Error actualizando recordatorios por correo:", err);
    }
  };

  return (
    <>
      <div
        className={`card settings-shell ${
          isMobileSettings && mobileSectionOpen ? "is-mobile-section-open" : ""
        }`}
      >
        <aside className="settings-sidebar">
          <h2 className="card-title">Mi perfil</h2>
          <div className="settings-mobile-hero">
            <div className="settings-mobile-avatar">{profileInitial}</div>
            <h3>{profileDisplayName}</h3>
            <p>{profileDisplayEmail}</p>
            <button
              className="primary-btn"
              type="button"
              onClick={() => handleSectionSelect("perfil")}
            >
              Editar perfil
            </button>
          </div>
          <div className="settings-nav">
            <button
              className={`settings-nav-btn ${activeSection === "perfil" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleSectionSelect("perfil")}
            >
              Perfil
            </button>
            <button
              className={`settings-nav-btn ${activeSection === "familia" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleSectionSelect("familia")}
            >
              Mi familia
            </button>
            <button
              className={`settings-nav-btn ${activeSection === "privacidad" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleSectionSelect("privacidad")}
            >
              Privacidad
            </button>
            <button
              className={`settings-nav-btn ${activeSection === "notificaciones" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleSectionSelect("notificaciones")}
            >
              Notificaciones
            </button>
            <button
              className={`settings-nav-btn ${activeSection === "datos" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleSectionSelect("datos")}
            >
              Exportar
            </button>
            <button
              className={`settings-nav-btn ${activeSection === "legal" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleSectionSelect("legal")}
            >
              Legal
            </button>
          </div>
          <div className="settings-theme-box">
            <p className="settings-theme-label">Apariencia</p>
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

        <div className="settings-main">
      {isMobileSettings && mobileSectionOpen && (
        <div className="settings-mobile-backbar">
          <button
            className="secondary-btn"
            type="button"
            onClick={() => setMobileSectionOpen(false)}
          >
            Volver
          </button>
          <span>{activeSectionLabel}</span>
        </div>
      )}

      {activeSection === "perfil" && (
      <div className="settings-section">
        <h2 className="card-title profile-section-title">Perfil</h2>
        <div className="family-active-banner">
          <div>
            <p className="family-active-label">Perfil de salud activo</p>
            <p className="muted">
              Cambia rapidamente el contexto para evitar errores al gestionar datos.
            </p>
          </div>
          <select
            className="select-field"
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
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Informacion basica de tu cuenta. Proximamente podras activar recordatorios por correo. Ya existen plantillas base de correo configuradas para su lanzamiento.
        </p>
        <div className="settings-email-reminder-row">
          <div className="settings-email-reminder-copy">
            <p className="settings-email-reminder-title">Recordatorios por correo</p>
            <p className="settings-email-reminder-sub">
              Activa o desactiva la recepcion de recordatorios por email.
            </p>
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

        <div className="profile-grid">
          <div className="profile-tile">
            <p className="profile-label">Nombre</p>
            <p className="profile-value">{profile.name || "—"}</p>
          </div>
          <div className="profile-tile">
            <p className="profile-label">Correo</p>
            <p className="profile-value">{profile.email || "—"}</p>
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

        <div className="form-row">
          <div className="input-group">
            <label className="input-label">Actualizar zona horaria</label>
            <input
              className="input-field"
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
          <div className="input-group" style={{ alignSelf: "flex-end" }}>
            <button className="secondary-btn" type="button" onClick={handleSaveTimezone}>
              Guardar configuración de recordatorios
            </button>
          </div>
        </div>
        <div className="form-row" style={{ marginTop: "0.5rem" }}>
          <div className="input-group">
            <label className="input-label">Hora preferida de recordatorios</label>
            <input
              className="input-field"
              type="time"
              value={reminderPreferredTime}
              onChange={(e) => setReminderPreferredTime(e.target.value || "08:00")}
            />
          </div>
        </div>
        {timezoneStatus && <p className="muted">{timezoneStatus}</p>}

        <div className="form-row" style={{ marginTop: "0.75rem" }}>
          <div className="input-group">
            <label className="input-label">Patología crónica (opcional)</label>
            <input
              className="input-field"
              value={chronicCondition}
              onChange={(e) => setChronicCondition(e.target.value)}
              placeholder="Ej: Hipertensión, diabetes, asma"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Centro habitual (opcional)</label>
            <input
              className="input-field"
              value={primaryCareCenter}
              onChange={(e) => setPrimaryCareCenter(e.target.value)}
              placeholder="Ej: CESFAM Norte, Clínica ..."
            />
          </div>
        </div>
        <div className="form-row">
          <div className="input-group" style={{ alignSelf: "flex-end" }}>
            <button className="secondary-btn" type="button" onClick={handleSaveHealthProfile}>
              Guardar perfil de salud
            </button>
          </div>
        </div>
        {healthProfileStatus && <p className="muted">{healthProfileStatus}</p>}

      </div>
      )}

      {activeSection === "familia" && (
      <div className="settings-section">
        <h2 className="card-title">Mi familia</h2>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Gestiona perfiles de salud vinculados segun tu plan actual.
        </p>

        <div className="family-collab-card">
          <h4>Invitaciones pendientes para ti</h4>
          <div className="family-table">
            {myPendingInvitations.length ? (
              myPendingInvitations.map((inv) => (
                <div className="family-table-row" key={inv.id}>
                  <div>
                    <p className="family-name">{inv.profile_name}</p>
                    <p className="muted">
                      Invitado por {inv.inviter_name || `Usuario #${inv.inviter_user_id}`} - Rol: {inv.role}
                    </p>
                  </div>
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => handleAcceptInvitation(inv.token)}
                  >
                    Aceptar
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">No tienes invitaciones pendientes.</p>
            )}
          </div>
        </div>

        <div className="family-plan-card">
          <p><strong>Plan:</strong> {planInfo?.plan_type || "basico"}</p>
          <p><strong>Perfiles usados:</strong> {planInfo?.current_profiles ?? familyProfiles.length} / {planInfo?.max_profiles ?? 1}</p>
          <p><strong>Colaboracion:</strong> {planInfo?.collaboration_enabled ? "Habilitada" : "No disponible en este plan"}</p>
        </div>

        <h4 className="family-section-title">Panel familiar</h4>
        <div className="family-panel-grid">
          {familyPanelCards.length ? (
            familyPanelCards.map((card) => (
              <article className="family-panel-card" key={card.profile_id}>
                <p className="family-panel-name">{card.name}</p>
                <p className="muted">{card.relationship || "Sin relacion"} {typeof card.age_years === "number" ? `- ${card.age_years} años` : ""}</p>
                <p className="muted">Medicamentos activos: {card.medications_active}</p>
                <p className="muted">Recordatorios pendientes: {card.reminders_pending}</p>
                <p className="muted">Proxima cita: {card.next_appointment_at ? toLocaleDateTimeOrEmpty(card.next_appointment_at) : "Sin cita"}</p>
                <p className="muted">Cuidadores: {card.caregivers_count}</p>
              </article>
            ))
          ) : (
            <p className="muted">No hay datos de panel familiar disponibles aun.</p>
          )}
        </div>

        <div className="family-collab-card">
          <h4>Alertas inteligentes</h4>
          <div className="family-activity-list">
            {familyAlerts.length ? (
              familyAlerts.map((alert) => (
                <article className="family-activity-item" key={alert.id}>
                  <p className="family-name">
                    [{alert.severity}] {alert.profile_name}: {alert.title}
                  </p>
                  <p className="muted">{alert.message}</p>
                  {alert.suggested_action ? (
                    <p className="muted">Sugerencia: {alert.suggested_action}</p>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="muted">No hay alertas activas por ahora.</p>
            )}
          </div>
        </div>

        <div className="family-collab-card">
          <h4>Reporte familiar (30 dias)</h4>
          {familyReport ? (
            <>
              <div className="family-report-totals">
                <p><strong>Perfiles:</strong> {familyReport?.totals?.profiles ?? 0}</p>
                <p><strong>Medicamentos activos:</strong> {familyReport?.totals?.medications_active ?? 0}</p>
                <p><strong>Citas totales:</strong> {familyReport?.totals?.appointments_total ?? 0}</p>
                <p><strong>Documentos:</strong> {familyReport?.totals?.documents_uploaded ?? 0}</p>
              </div>
              <div className="family-table">
                {(familyReport?.profiles || []).map((rp) => (
                  <div className="family-table-row" key={rp.profile_id}>
                    <div>
                      <p className="family-name">{rp.profile_name}</p>
                      <p className="muted">
                        Citas proximas: {rp.appointments_upcoming} | Adherencia: {rp.adherence_rate ?? "-"}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">Sin datos de reporte aun.</p>
          )}
        </div>

        {planInfo?.max_profiles > (planInfo?.current_profiles ?? 0) ? (
          <div className="family-create-card">
            <h4>Agregar perfil asistido</h4>
            <div className="form-row">
              <div className="input-group">
                <label className="input-label">Nombre completo</label>
                <input
                  className="input-field"
                  value={newFamilyProfile.full_name}
                  onChange={(e) =>
                    setNewFamilyProfile((prev) => ({ ...prev, full_name: e.target.value }))
                  }
                  placeholder="Ej: Maria Gonzalez"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Relacion</label>
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
                <label className="input-label">Sexo/Genero (opcional)</label>
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
            Alcanzaste el limite de perfiles de tu plan. Para agregar mas, sube de plan.
          </p>
        )}

        <div className="family-list">
          {familyLoading ? (
            <p className="muted">Cargando perfiles...</p>
          ) : familyProfiles.length ? (
            familyProfiles.map((item) => (
              <article
                className={`family-item ${item.id === activeFamilyProfileId ? "is-active" : ""}`}
                key={item.id}
              >
                <div>
                  <p className="family-name">{item.full_name}</p>
                  <p className="muted">
                    {item.relation_with_owner || "Sin relacion"} - Rol: {item.access_role || "admin"}
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

        {planInfo?.collaboration_enabled && !!activeFamilyProfileId && (
          <>
            <div className="family-collab-card">
              <h4>Automatizaciones</h4>
              <div className="family-table">
                {[
                  ["smart_alerts_enabled", "Alertas inteligentes"],
                  ["medication_overdue_alerts", "Alertas de adherencia de medicamentos"],
                  ["upcoming_appointment_alerts", "Alertas de citas proximas"],
                  ["inactivity_alerts", "Alertas por inactividad clinica"],
                  ["weekly_family_report_enabled", "Reporte familiar semanal"],
                  ["auto_email_caregivers", "Enviar reporte por correo al ejecutar"],
                ].map(([key, label]) => (
                  <div className="family-table-row" key={key}>
                    <p className="family-name">{label}</p>
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
              <div className="family-row-actions" style={{ marginTop: "0.7rem" }}>
                <button className="secondary-btn" type="button" onClick={handleSaveAutomationSettings}>
                  Guardar automatizaciones
                </button>
                <button className="secondary-btn" type="button" onClick={handleRunAutomations}>
                  Ejecutar automatizaciones ahora
                </button>
              </div>
              {automationStatus ? <p className="muted" style={{ marginTop: "0.6rem" }}>{automationStatus}</p> : null}
            </div>

            <div className="family-collab-card">
              <h4>Invitar familiar o cuidador</h4>
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
                    <option value="caregiver">Cuidador</option>
                    <option value="viewer">Visualizador</option>
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Relacion</label>
                  <input
                    className="input-field"
                    value={inviteForm.relationship_type}
                    onChange={(e) => setInviteForm((prev) => ({ ...prev, relationship_type: e.target.value }))}
                    placeholder="Ej: Hijo, Hermana, Cuidador"
                  />
                </div>
              </div>
              <button className="secondary-btn" type="button" onClick={handleInviteCaregiver}>
                Enviar invitacion
              </button>
            </div>

            <div className="family-collab-card">
              <h4>Roles y accesos</h4>
              <div className="family-table">
                {caregivers.length ? (
                  caregivers.map((row) => (
                    <div className="family-table-row" key={row.id}>
                      <div>
                        <p className="family-name">{row.user_name || row.user_email || `Usuario #${row.user_id}`}</p>
                        <p className="muted">{row.user_email || ""} - {row.relationship_type || "Sin relacion"}</p>
                      </div>
                      <div className="family-row-actions">
                        <select
                          className="select-field"
                          value={row.role || "viewer"}
                          onChange={(e) => handleRoleChange(row.id, e.target.value)}
                        >
                          <option value="admin">Administrador</option>
                          <option value="caregiver">Cuidador</option>
                          <option value="viewer">Visualizador</option>
                        </select>
                        {row.user_id !== profile?.id && (
                          <button
                            className="secondary-btn danger"
                            type="button"
                            onClick={() => handleRemoveCaregiver(row.id)}
                          >
                            Quitar
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">Aun no hay cuidadores adicionales en este perfil.</p>
                )}
              </div>
            </div>

            <div className="family-collab-card">
              <h4>Invitaciones</h4>
              <div className="family-table">
                {invitations.length ? (
                  invitations.map((inv) => (
                    <div className="family-table-row" key={inv.id}>
                      <div>
                        <p className="family-name">{inv.invitee_email}</p>
                        <p className="muted">Rol: {inv.role} - Estado: {inv.status}</p>
                      </div>
                      {inv.status === "pending" || inv.status === "accepted" ? (
                        <button
                          className="secondary-btn danger"
                          type="button"
                          onClick={() => handleRevokeInvitation(inv.id)}
                        >
                          Quitar
                        </button>
                      ) : (
                        <span className="muted">Sin acciones</span>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="muted">No hay invitaciones registradas para este perfil.</p>
                )}
              </div>
            </div>
          </>
        )}

        {!!activeFamilyProfileId && (
          <div className="family-collab-card">
            <h4>Notas colaborativas</h4>
            <div className="input-group">
              <label className="input-label">Nueva nota</label>
              <textarea
                className="textarea-field"
                value={newProfileNote}
                onChange={(e) => setNewProfileNote(e.target.value)}
                placeholder="Ej: Paciente reporta mejor respuesta al tratamiento..."
              />
            </div>
            <button className="secondary-btn" type="button" onClick={handleCreateProfileNote}>
              Guardar nota
            </button>
            <div className="family-activity-list" style={{ marginTop: "0.7rem" }}>
              {profileNotes.length ? (
                profileNotes.map((note) => (
                  <article className="family-activity-item" key={note.id}>
                    <p className="family-name">{note.created_by_name || `Usuario #${note.created_by_user_id}`}</p>
                    <p className="muted">{note.note}</p>
                    <p className="muted">{toLocaleDateTimeOrEmpty(note.created_at)}</p>
                  </article>
                ))
              ) : (
                <p className="muted">Sin notas colaborativas todavia.</p>
              )}
            </div>
          </div>
        )}

        {!!activeFamilyProfileId && (
          <div className="family-collab-card">
            <h4>Actividad reciente</h4>
            <div className="family-activity-list">
              {activityLog.length ? (
                activityLog.map((entry) => (
                  <article className="family-activity-item" key={entry.id}>
                    <p className="family-name">{entry.description}</p>
                    <p className="muted">
                      {entry.action_type} - {entry.created_at ? toLocaleDateTimeOrEmpty(entry.created_at) : ""}
                    </p>
                  </article>
                ))
              ) : (
                <p className="muted">Aun no hay actividad en este perfil.</p>
              )}
            </div>
          </div>
        )}

        {familyStatus && <p className="muted" style={{ marginTop: "0.75rem" }}>{familyStatus}</p>}
      </div>
      )}

      {activeSection === "datos" && (
      <div className="settings-section">
        <h2 className="card-title">Exportar y compartir</h2>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Descarga tus datos en CSV/PDF o genera un enlace temporal para compartir.
        </p>
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
              {exporting ? "Generando..." : "Compartir link rápido"}
            </button>
          </div>
        </div>
      </div>
      )}

      {activeSection === "notificaciones" && (
      <div className="settings-section">
        <h3 className="card-title">🔔 Notificaciones y Recordatorios</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Configura tus preferencias de notificaciones, recordatorios de citas y medicamentos. 
          Personaliza cuándo quieres recibir alertas.
        </p>
        <NotificationSettings embedded />
      </div>
      )}

      {activeSection === "legal" && (
      <div className="settings-section">
        <h3 className="card-title">Legal</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Revisa los documentos legales y administra tu consentimiento.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <Link className="secondary-btn" to="/legal/privacy">
            Politica de privacidad
          </Link>
          <Link className="secondary-btn" to="/legal/terms">
            Terminos de uso
          </Link>
          <Link className="secondary-btn" to="/legal/consent">
            Consentimiento de datos
          </Link>
        </div>
        <div>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            Estado de consentimiento: {consentRevoked ? "Revocado" : "Activo"}
          </p>
          {consentRevoked ? (
            <button className="secondary-btn" type="button" onClick={handleRestoreConsent}>
              Restaurar consentimiento
            </button>
          ) : (
            <button className="secondary-btn" type="button" onClick={handleRevokeConsent}>
              Revocar consentimiento
            </button>
          )}
        </div>
      </div>
      )}

      {activeSection === "privacidad" && (
      <div className="settings-section">
        <h3 className="card-title">Privacidad y seguridad</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Administra tus datos, consentimiento y solicitudes de privacidad.
        </p>
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

      {showDeleteConfirm && (
        <div className="modal-backdrop">
          <div className="modal-card" role="dialog" aria-modal="true">
            <h3>Eliminar mi cuenta y todos mis datos</h3>
            <p className="muted">
              Esta accion es permanente. Se eliminaran tus datos de citas,
              medicamentos y documentos. No podras deshacer este cambio.
            </p>
            <p className="muted">
              ?Estas seguro de que deseas eliminar tu cuenta y todos tus datos de Klinip?
              Esta accion es irreversible.
            </p>
            <div className="modal-actions">
              <button className="secondary-btn" type="button" onClick={() => setShowDeleteConfirm(false)}>
                Cancelar
              </button>
              <button className="primary-btn" type="button" onClick={handleDeleteAccount}>
                Si, eliminar definitivamente
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
    </>
  );
}









