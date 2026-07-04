import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  backfillMedicationIntakes,
  createMedicationPurchase,
  deleteMedication,
  getActiveHealthProfile,
  getMedicationIntakes,
  getMedicationPurchaseReceipt,
  getMedicationPurchases,
  getMedications,
  getProfileCaregivers,
  isAuthSessionError,
  recordMedicationIntake,
  saveMedication,
} from "../api";
import {
  parseDate,
  toIsoOrNull,
  toLocalInputValue,
  toLocaleDateOrEmpty,
  toLocaleDateTimeOrEmpty,
} from "../utils/dates";
import {
  buildMedicationScheduleEventsBetween,
  deriveFrequencyIntervalHours,
  deriveFrequencyPerDay,
  getMedicationEffectiveEndAt,
  getMedicationScheduleSummary,
  getMedicationScheduleTimes,
  getMedicationStartAt,
  getMedicationFinishReason,
  getNextMedicationDose,
  isMedicationActiveAt,
  isMedicationFinished,
  parseDurationDays,
} from "../utils/medicationSchedule";
import RowActionsMenu from "../components/RowActionsMenu";
import SuccessSheet from "../components/SuccessSheet";
import { cleanUiText } from "../utils/textEncoding";
import {
  buildMedicationCreateSuccess,
  buildMedicationIntakeSuccess,
  getMedicationIntakeStatusLabel as getSharedMedicationIntakeStatusLabel,
} from "../utils/medicationIntakeSuccess";
import { notifyClinicalDataChanged } from "../utils/clinicalRefresh";
import { canWriteProfile, isViewerProfile } from "../utils/profileAccess";
import useMobileOverlayLock from "../hooks/useMobileOverlayLock";
import { ensureArray } from "../utils/arrays";

const MED_ALERT_POLL_MS = 15000;
const FREQUENCY_PRESETS = [
  { label: "Cada 24 horas", value: "Cada 24 horas" },
  { label: "Cada 12 horas", value: "Cada 12 horas" },
  { label: "Cada 8 horas", value: "Cada 8 horas" },
  { label: "Cada 6 horas", value: "Cada 6 horas" },
];
const DURATION_PRESETS = [
  { label: "3 días", value: "3 días" },
  { label: "5 días", value: "5 días" },
  { label: "7 días", value: "7 días" },
  { label: "14 días", value: "14 días" },
];
const MEDICATIONS_PAGE_SIZE = 8;
const INTAKE_SOON_TOLERANCE_MINUTES = 15;
const INTAKE_ON_TIME_WINDOW_MINUTES = 90;

function getNewestMedicationRank(item) {
  const createdAt = parseDate(item?.created_at);
  if (createdAt) return createdAt.getTime();
  const updatedAt = parseDate(item?.updated_at);
  if (updatedAt) return updatedAt.getTime();
  const startAt = parseDate(item?.start_at);
  if (startAt) return startAt.getTime();
  return Number(item?.id || 0);
}

function buildDosePromptKey(med, date) {
  const trigger = parseDate(date);
  const stamp = trigger ? toLocalInputValue(trigger).replace("T", "_").replace(":", "-") : "manual";
  return `klinip_med_prompt_${med.id}_${stamp}`;
}

function formatDoseClock(value) {
  const parsed = parseDate(value);
  if (!parsed) return new Date().toTimeString().slice(0, 5);
  return new Intl.DateTimeFormat("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatMedicationDateTime(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin dato";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatMedicationTime(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin horario";
  return new Intl.DateTimeFormat("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function buildLocalMinuteTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function formatAlertDay(date) {
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatPurchaseAmount(value, currency = "CLP") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "Monto no informado";
  try {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: currency || "CLP",
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `${currency || "CLP"} ${numeric}`;
  }
}

function getIntakeSourceLabel(source = "") {
  const normalized = String(source || "").toLowerCase();
  if (!normalized || normalized === "manual") return "Registrado manualmente";
  if (normalized.startsWith("reminder")) return "Registrado desde un recordatorio";
  if (normalized === "timeline_update") return "Actualizado desde el historial";
  return "Registro automático";
}

function getIntakeNoteLabel(item) {
  const note = String(item?.notes || "").trim();
  if (!note) return "";
  if (note === "Fallback sin horario programado desde recordatorio.") {
    return "Se registró sin una hora programada exacta.";
  }
  if (note === "El usuario marco la dosis como omitida desde el recordatorio.") {
    return "Esta dosis se marcó como omitida.";
  }
  if (note.startsWith("Actualizado desde la línea de tiempo")) {
    return "";
  }
  return note;
}

// Denominador que ve el usuario: total de dosis del tratamiento completo si
// tiene término definido; si es crónico (sin término), las esperadas hasta hoy.
function getMedicationPlannedDoses(med) {
  const planned = Number(med?.total_planned_doses);
  if (Number.isFinite(planned) && planned > 0) return planned;
  return Number(med?.expected_doses || 0);
}

function getDoseProgressLabel(taken, expected) {
  const normalizedTaken = Math.max(0, Number(taken || 0));
  const normalizedExpected = Math.max(0, Number(expected || 0));
  if (normalizedExpected > 0) {
    return `${normalizedTaken} de ${normalizedExpected} dosis registradas`;
  }
  if (normalizedTaken > 0) {
    return `${normalizedTaken} dosis registradas`;
  }
  return "Aún no hay dosis registradas";
}

function formatIntakeEventDate(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(parsed);
}

function formatIntakeEventTime(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin hora";
  return new Intl.DateTimeFormat("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatIntakeEventDateTime(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return `${formatIntakeEventDate(parsed)} a las ${formatIntakeEventTime(parsed)}`;
}

function buildMedicationCompletedSuccess({ medication, profileLabel, completedAt }) {
  return {
    kicker: "Tratamiento finalizado",
    title: "Cambios aplicados",
    copy: "El medicamento quedó finalizado y dejará de aparecer como un tratamiento activo hasta que decidas renovarlo.",
    referenceId: medication?.id,
    rows: [
      {
        icon: "profile",
        label: "Perfil activo",
        value: cleanUiText(profileLabel || "Mi perfil"),
      },
      {
        icon: "pill",
        label: "Medicamento",
        value: cleanUiText(medication?.name || "Medicamento"),
      },
      {
        icon: "clock",
        label: "Finalizado",
        value: formatMedicationDateTime(completedAt),
      },
    ],
    primaryLabel: "Ver detalle",
    secondaryLabel: "Volver a medicamentos",
    targetMedication: medication || null,
  };
}

function getMedicationDoseContext(med, now = new Date()) {
  if (!med) {
    return {
      kind: "manual",
      actionableAt: null,
      headline: "Sin información suficiente",
      helper: "Completa el horario para que Klinip ordene las tomas.",
      actionLabel: "Registrar una toma manual",
    };
  }

  if (isMedicationFinished(med, now)) {
    return {
      kind: "finished",
      actionableAt: null,
      headline: "Tratamiento finalizado",
      helper: "Este tratamiento ya no necesita nuevas tomas.",
      actionLabel: "Registrar una toma manual",
    };
  }

  const toleranceMs = INTAKE_SOON_TOLERANCE_MINUTES * 60 * 1000;
  const onTimeWindowMs = INTAKE_ON_TIME_WINDOW_MINUTES * 60 * 1000;
  const persistedNextDose = parseDate(med?.next_dose_at || null);

  if (persistedNextDose) {
    const delayMs = now.getTime() - persistedNextDose.getTime();
    if (delayMs >= -toleranceMs && delayMs <= onTimeWindowMs) {
      return {
        kind: "due_now",
        actionableAt: persistedNextDose,
        headline: `Toca ahora: ${formatMedicationDateTime(persistedNextDose)}`,
        helper: "Si ya la tomaste, regístrala con este horario.",
        actionLabel: "Registrar esta toma",
      };
    }
    if (delayMs > onTimeWindowMs) {
      return {
        kind: "overdue",
        actionableAt: persistedNextDose,
        headline: `Quedó pendiente desde ${formatMedicationDateTime(persistedNextDose)}`,
        helper: "Puedes registrar esta toma si sí ocurrió o dejarla como no tomada en el historial.",
        actionLabel: "Registrar toma pendiente",
      };
    }
    if (persistedNextDose.getTime() > now.getTime() + toleranceMs) {
      // Si la próxima dosis es HOY, permitir registrarla aunque aún no sea su
      // hora (tomada anticipadamente cuenta como la dosis de hoy). Así deja de
      // aparecer como pendiente y reaparece recién en la siguiente toma.
      if (persistedNextDose.toDateString() === now.toDateString()) {
        return {
          kind: "due_today_early",
          actionableAt: persistedNextDose,
          headline: `Dosis de hoy: ${formatMedicationDateTime(persistedNextDose)}`,
          helper: "Si ya la tomaste, regístrala como la dosis de hoy.",
          actionLabel: "Registrar la dosis de hoy",
        };
      }
      return {
        kind: "upcoming",
        actionableAt: persistedNextDose,
        headline: `Estás al día. Siguiente dosis: ${formatMedicationDateTime(persistedNextDose)}`,
        helper: "No tienes tomas pendientes por ahora. Si ya tomaste la siguiente dosis, puedes registrarla anticipada.",
        actionLabel: "Registrar la siguiente dosis",
        confirmMessage: `La siguiente dosis está programada para ${formatMedicationDateTime(persistedNextDose)}. ¿Quieres registrarla ahora como tomada anticipada?`,
      };
    }
  }

  const scheduleEvents = buildMedicationScheduleEventsBetween(
    med,
    new Date(now.getTime() - 36 * 60 * 60 * 1000),
    new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000)
  );
  const dueOrRecentEvents = scheduleEvents.filter(
    (item) => item.getTime() <= now.getTime() + toleranceMs
  );
  const actionableAt = dueOrRecentEvents.length
    ? dueOrRecentEvents[dueOrRecentEvents.length - 1]
    : null;
  const nextDose = scheduleEvents.find((item) => item.getTime() > now.getTime() + toleranceMs) || null;

  if (actionableAt) {
    const delayMs = now.getTime() - actionableAt.getTime();
    if (delayMs <= onTimeWindowMs) {
      return {
        kind: "due_now",
        actionableAt,
        headline: `Toca ahora: ${formatMedicationDateTime(actionableAt)}`,
        helper: "Si ya la tomaste, regístrala con este horario.",
        actionLabel: "Registrar esta toma",
      };
    }
    return {
      kind: "overdue",
      actionableAt,
      headline: `Quedó pendiente desde ${formatMedicationDateTime(actionableAt)}`,
      helper: "Puedes registrar esta toma si sí ocurrió o dejarla como no tomada en el historial.",
      actionLabel: "Registrar toma pendiente",
    };
  }

  if (nextDose) {
    if (nextDose.toDateString() === now.toDateString()) {
      return {
        kind: "due_today_early",
        actionableAt: nextDose,
        headline: `Dosis de hoy: ${formatMedicationDateTime(nextDose)}`,
        helper: "Si ya la tomaste, regístrala como la dosis de hoy.",
        actionLabel: "Registrar la dosis de hoy",
      };
    }
    return {
      kind: "upcoming",
      actionableAt: nextDose,
      headline: `Estás al día. Siguiente dosis: ${formatMedicationDateTime(nextDose)}`,
      helper: "No tienes tomas pendientes por ahora. Si ya tomaste la siguiente dosis, puedes registrarla anticipada.",
      actionLabel: "Registrar la siguiente dosis",
      confirmMessage: `La siguiente dosis está programada para ${formatMedicationDateTime(nextDose)}. ¿Quieres registrarla ahora como tomada anticipada?`,
    };
  }

  return {
    kind: "manual",
    actionableAt: null,
    headline: "Sin un horario calculado todavía",
    helper: "Completa la frecuencia y la primera toma para que Klinip organice el día.",
    actionLabel: "Registrar una toma manual",
  };
}

export default function Medications() {
  const location = useLocation();
  const navigate = useNavigate();
  const [meds, setMeds] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [familyCaregivers, setFamilyCaregivers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);
  const [medSuccess, setMedSuccess] = useState(null);
  const [detailIntakes, setDetailIntakes] = useState([]);
  const [detailIntakeStats, setDetailIntakeStats] = useState(null);
  const [detailIntakesLoading, setDetailIntakesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notifyQueue, setNotifyQueue] = useState([]);
  const [notifyPromptKey, setNotifyPromptKey] = useState("");
  const [notifyTriggeredAt, setNotifyTriggeredAt] = useState(null);
  const [notifyActionLoading, setNotifyActionLoading] = useState(false);
  const [missingFrequency, setMissingFrequency] = useState(null);
  const [intakeFeedback, setIntakeFeedback] = useState("");
  const [dismissedFinishedIds, setDismissedFinishedIds] = useState(() => new Set());
  const feedbackTimer = useRef(null);
  const doseCheckRef = useRef(Date.now() - MED_ALERT_POLL_MS);
  const [form, setForm] = useState({
    id: null,
    name: "",
    dose: "",
    frequency: "",
    frequency_initial: "",
    duration: "",
    start_at: "",
    schedule_time: "",
    completed: false,
    end_date: "",
    notes: "",
    document_id: "",
    refill_enabled: false,
    refill_mode: "rotativo",
    refill_fixed_user_id: "",
    refill_participant_user_ids: [],
    doses_per_intake: "1",
    frequency_per_day: "1",
    stock_total_doses: "",
    refill_alert_threshold_doses: "",
  });
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseTarget, setPurchaseTarget] = useState(null);
  const [purchaseNewStock, setPurchaseNewStock] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [purchaseNotes, setPurchaseNotes] = useState("");
  const [purchaseReceiptFile, setPurchaseReceiptFile] = useState(null);
  const [purchaseBuyerUserId, setPurchaseBuyerUserId] = useState("");
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseHistory, setPurchaseHistory] = useState([]);
  const [purchaseHistoryLoading, setPurchaseHistoryLoading] = useState(false);
  const [showAdvancedForm, setShowAdvancedForm] = useState(false);
  const [endDateAuto, setEndDateAuto] = useState(true);
  const [scheduleTimeManuallyEdited, setScheduleTimeManuallyEdited] = useState(false);
  const [draggedParticipantId, setDraggedParticipantId] = useState("");
  const [dismissedRouteReminderId, setDismissedRouteReminderId] = useState("");
  const [registerPurchaseNow, setRegisterPurchaseNow] = useState(false);
  const [formPurchaseNewStock, setFormPurchaseNewStock] = useState("");
  const [formPurchaseAmount, setFormPurchaseAmount] = useState("");
  const [formPurchaseNotes, setFormPurchaseNotes] = useState("");
  const [formPurchaseReceiptFile, setFormPurchaseReceiptFile] = useState(null);
  const [formPurchaseBuyerUserId, setFormPurchaseBuyerUserId] = useState("");
  const [medicationsPage, setMedicationsPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const searchParams = new URLSearchParams(location.search);
  const routeMedicationId = searchParams.get("medicationId");
  const routeTriggerParam = searchParams.get("trigger");
  const routeFocusSource = searchParams.get("source") || (searchParams.get("notify") === "1" ? "reminder" : "");

  const canEditActiveProfile = canWriteProfile(activeProfile);
  const isReadOnlyProfile = isViewerProfile(activeProfile);
  const hasOverlayOpen =
    showForm || notifyOpen || detailOpen || purchaseOpen || !!missingFrequency;

  useMobileOverlayLock(hasOverlayOpen);
  const hasAcceptedFamilyCollaborators = familyCaregivers.some(
    (item) => Number(item?.user_id) !== Number(activeProfile?.owner_user_id)
  );

  const load = async () => {
    try {
      const data = await getMedications();
      const sortedData = [...(data || [])].sort(
        (a, b) => getNewestMedicationRank(b) - getNewestMedicationRank(a)
      );
      setMeds(sortedData);
      const missing = sortedData.find(
        (m) => !m.frequency || m.frequency.trim() === ""
      );
      if (missing) {
        const dismissedKey = `klinip_missing_freq_dismissed_${missing.id}`;
        const dismissed = localStorage.getItem(dismissedKey) === "1";
        setMissingFrequency(dismissed ? null : missing);
      } else {
        setMissingFrequency(null);
      }
    } catch (error) {
      if (!isAuthSessionError(error)) {
        console.error("No se pudieron cargar los medicamentos", error);
      }
      setMeds([]);
      setMissingFrequency(null);
    }
  };

  const loadFamilyContext = async () => {
    try {
      const profile = await getActiveHealthProfile();
      setActiveProfile(profile || null);
      if (profile?.id) {
        const caregivers = await getProfileCaregivers(profile.id);
        setFamilyCaregivers(
          Array.isArray(caregivers)
            ? caregivers.filter((item) => item?.status === "accepted")
            : []
        );
      } else {
        setFamilyCaregivers([]);
      }
    } catch (error) {
      if (!isAuthSessionError(error)) {
        console.error("No se pudo cargar el contexto familiar de medicamentos", error);
      }
      setActiveProfile(null);
      setFamilyCaregivers([]);
    }
  };

  const loadDetailIntakeItems = async (medicationId) => {
    if (!medicationId) {
      setDetailIntakes([]);
      setDetailIntakeStats(null);
      setDetailIntakesLoading(false);
      return;
    }
    setDetailIntakesLoading(true);
    try {
      const response = await getMedicationIntakes(medicationId, 60);
      const items = ensureArray(response?.items);
      setDetailIntakes(items);
      setDetailIntakeStats({
        total: Number(response?.total_events ?? items.length) || items.length,
        taken: Number(response?.taken_events || 0),
        missed: Number(response?.missed_events || 0),
        skipped: Number(response?.skipped_events || 0),
      });
    } catch (error) {
      console.error("No se pudo cargar la línea de tiempo de adherencia", error);
      setDetailIntakes([]);
      setDetailIntakeStats(null);
    } finally {
      setDetailIntakesLoading(false);
    }
  };

  const loadPurchaseHistory = async (options = {}) => {
    if (!options.silent) {
      setPurchaseHistoryLoading(true);
    }
    try {
      const items = await getMedicationPurchases({ limit: 60 });
      setPurchaseHistory(ensureArray(items));
    } catch (error) {
      console.error("No se pudo cargar el historial de compras de medicamentos", error);
      if (!options.silent) {
        setPurchaseHistory([]);
      }
    } finally {
      if (!options.silent) {
        setPurchaseHistoryLoading(false);
      }
    }
  };

  useEffect(() => {
    load();
    loadFamilyContext();
    loadPurchaseHistory();
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) {
        clearTimeout(feedbackTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasAcceptedFamilyCollaborators || familyCaregivers.length === 0) return;
    if (!form.refill_enabled) return;
    if ((form.refill_participant_user_ids || []).length > 0) return;
    setForm((current) => ({
      ...current,
      refill_participant_user_ids: familyCaregivers.map((item) => String(item.user_id)),
      refill_fixed_user_id:
        current.refill_mode === "fijo" && !current.refill_fixed_user_id && familyCaregivers[0]
          ? String(familyCaregivers[0].user_id)
          : current.refill_fixed_user_id,
    }));
  }, [
    hasAcceptedFamilyCollaborators,
    familyCaregivers,
    form.refill_enabled,
    form.refill_fixed_user_id,
    form.refill_mode,
    form.refill_participant_user_ids,
  ]);

  useEffect(() => {
    if (!location.search) return;
    const params = new URLSearchParams(location.search);
    const intakeId = params.get("intake") || params.get("complete");
    if (!intakeId) return;
    const target = meds.find((m) => String(m.id) === String(intakeId));
    if (!target) return;
    handleRecordIntake(target).finally(() => {
      navigate("/medications", { replace: true });
    });
  }, [location.search, meds, navigate]);

  useEffect(() => {
    setMedicationsPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (!detailOpen || !detailTarget?.id) {
      setDetailIntakes([]);
      setDetailIntakeStats(null);
      setDetailIntakesLoading(false);
      return;
    }
    loadDetailIntakeItems(detailTarget.id);
  }, [detailOpen, detailTarget?.id]);

  useEffect(() => {
    if (!detailOpen || !detailTarget?.id) return;
    const refreshedTarget = meds.find(
      (med) => String(med.id) === String(detailTarget.id)
    );
    if (refreshedTarget && refreshedTarget !== detailTarget) {
      setDetailTarget(refreshedTarget);
    }
  }, [detailOpen, detailTarget, meds]);

  useEffect(() => {
    const checkDueMedicationPrompt = () => {
      const now = new Date();
      const lastCheckedAt = doseCheckRef.current;
      const nowTs = now.getTime();

      const dueMeds = [];
      (meds || []).forEach((med) => {
        if (!isMedicationActiveAt(med, now)) return;
        buildMedicationScheduleEventsBetween(
          med,
          new Date(lastCheckedAt + 1),
          now
        ).forEach((trigger) => {
          const triggerTs = trigger.getTime();
          if (triggerTs <= lastCheckedAt || triggerTs > nowTs) return;
          const key = buildDosePromptKey(med, trigger);
          if (localStorage.getItem(key)) return;
          dueMeds.push({ med, key, triggeredAt: trigger });
        });
      });

      if (!dueMeds.length) {
        doseCheckRef.current = nowTs;
        return;
      }

      dueMeds.forEach((item) => {
        localStorage.setItem(item.key, "prompted");
        setNotifyQueue((prev) => {
          if (prev.some((queued) => queued.key === item.key)) return prev;
          return [...prev, item];
        });
      });
      doseCheckRef.current = nowTs;
    };

    checkDueMedicationPrompt();
    const intervalId = setInterval(checkDueMedicationPrompt, MED_ALERT_POLL_MS);
    return () => clearInterval(intervalId);
  }, [meds]);

  useEffect(() => {
    if (notifyOpen || notifyTarget || notifyQueue.length === 0) return;
    const [nextPrompt, ...rest] = notifyQueue;
    setNotifyQueue(rest);
    setNotifyPromptKey(nextPrompt.key);
    setNotifyTriggeredAt(nextPrompt.triggeredAt);
    setNotifyTarget(nextPrompt.med);
    setNotifyOpen(true);
  }, [notifyOpen, notifyQueue, notifyTarget]);

  const resetForm = () => {
    setShowAdvancedForm(false);
    setEndDateAuto(true);
    setScheduleTimeManuallyEdited(false);
    setDraggedParticipantId("");
    setRegisterPurchaseNow(false);
    setFormPurchaseNewStock("");
    setFormPurchaseAmount("");
    setFormPurchaseNotes("");
    setFormPurchaseReceiptFile(null);
    setFormPurchaseBuyerUserId("");
    setPurchaseBuyerUserId("");
    setForm({
      id: null,
      name: "",
      dose: "",
      frequency: "",
      frequency_initial: "",
      duration: "",
      start_at: "",
      schedule_time: "",
      completed: false,
      end_date: "",
      notes: "",
      document_id: "",
      refill_enabled: false,
      refill_mode: "rotativo",
      refill_fixed_user_id: "",
      refill_participant_user_ids: [],
      doses_per_intake: "1",
      frequency_per_day: "1",
      stock_total_doses: "",
      refill_alert_threshold_doses: "",
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canEditActiveProfile) {
      alert("Este perfil está en modo solo lectura. No puedes modificar medicamentos.");
      return;
    }
    if (!String(form.name || "").trim()) {
      alert("Ingresa el nombre del medicamento.");
      return;
    }
    if (String(form.frequency || "").trim() && !String(form.start_at || "").trim()) {
      alert("Ingresa la primera toma para poder guardar la frecuencia.");
      return;
    }
    setLoading(true);
    try {
      const parsedDosesPerIntake = parseLocalizedDecimalInput(form.doses_per_intake);
      const parsedFrequencyPerDay =
        deriveFrequencyPerDay(form.frequency || "", serializeLocalizedDecimalInput(form.frequency_per_day)) || 1.0;
      // Preparar datos: convertir strings vacíos a null y document_id a número o null
      const payload = {
        name: form.name,
        dose: form.dose || "",
        frequency: form.frequency || "",
        duration: form.duration || "",
        start_at: toIsoOrNull(form.start_at),
        schedule_time: form.schedule_time || "",
        completed: Boolean(form.completed),
        end_date: endDateAuto ? null : toIsoOrNull(form.end_date),
        notes: form.notes || "",
        document_id: form.document_id ? parseInt(form.document_id) : null,
        refill_enabled:
          Boolean(form.refill_enabled) &&
          hasAcceptedFamilyCollaborators,
        refill_mode: form.refill_mode || "rotativo",
        refill_fixed_user_id: form.refill_fixed_user_id ? parseInt(form.refill_fixed_user_id, 10) : null,
        refill_participant_user_ids: (form.refill_participant_user_ids || [])
          .map((value) => parseInt(value, 10))
          .filter((value) => Number.isInteger(value) && value > 0),
        doses_per_intake: Math.max(parsedDosesPerIntake || 1.0, 0.01),
        frequency_per_day: Math.max(parsedFrequencyPerDay, 0.01),
        stock_total_doses:
          form.stock_total_doses === "" ? 0 : Math.max(parseInt(form.stock_total_doses, 10) || 0, 0),
        refill_alert_threshold_doses:
          form.refill_alert_threshold_doses === ""
            ? 0
            : Math.max(parseInt(form.refill_alert_threshold_doses, 10) || 0, 0),
      };
      
      // Si es edición, incluir el id
      if (form.id) {
        payload.id = form.id;
      }

      if (payload.refill_enabled && payload.refill_participant_user_ids.length === 0) {
        alert("Selecciona al menos un familiar para participar en la reposición.");
        setLoading(false);
        return;
      }

      if (payload.refill_enabled && !isPositiveLocalizedDecimalInput(form.doses_per_intake)) {
        alert("Ingresa cuántas unidades usas en cada toma. Puedes usar valores como 1 o 0,5.");
        setLoading(false);
        return;
      }

      if (
        payload.refill_enabled &&
        payload.refill_mode === "fijo" &&
        !payload.refill_fixed_user_id
      ) {
        alert("Selecciona a la persona responsable fija de la compra.");
        setLoading(false);
        return;
      }

      const normalizedPurchaseStock = parseInt(formPurchaseNewStock, 10) || 0;
      if (registerPurchaseNow && normalizedPurchaseStock <= 0) {
        alert("Si vas a registrar la compra ahora, indica el stock total disponible después de la compra.");
        setLoading(false);
        return;
      }
      if (registerPurchaseNow && !String(formPurchaseBuyerUserId || "").trim()) {
        alert("Selecciona quién compró el medicamento para registrar la boleta correctamente.");
        setLoading(false);
        return;
      }

      const savedMedication = await saveMedication(payload);
      const savedMedicationId = savedMedication?.id || payload.id;

      let purchaseError = null;
      if (registerPurchaseNow && savedMedicationId) {
        try {
          const purchaseFormData = new FormData();
          purchaseFormData.append("new_stock_total_doses", String(normalizedPurchaseStock));
          purchaseFormData.append("purchased_by_user_id", String(formPurchaseBuyerUserId));
          if (formPurchaseAmount.trim()) {
            purchaseFormData.append("amount_total", serializeLocalizedDecimalInput(formPurchaseAmount));
          }
          if (formPurchaseNotes.trim()) {
            purchaseFormData.append("notes", formPurchaseNotes.trim());
          }
          if (formPurchaseReceiptFile) {
            purchaseFormData.append("receipt", formPurchaseReceiptFile);
          }
          await createMedicationPurchase(savedMedicationId, purchaseFormData);
        } catch (err) {
          purchaseError = err;
        }
      }

      if (payload.id && payload.frequency) {
        localStorage.removeItem(
          `klinip_missing_freq_dismissed_${payload.id}`
        );
      }
      if (payload.frequency && !form.frequency_initial) {
        setIntakeFeedback("success:Frecuencia guardada. Recordatorios activados.");
        if (feedbackTimer.current) {
          clearTimeout(feedbackTimer.current);
        }
        feedbackTimer.current = setTimeout(() => {
          setIntakeFeedback("");
        }, 2600);
      }
      await Promise.all([load(), loadPurchaseHistory({ silent: true })]);
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["medications", "health-radar", "adherence"],
      });
      if (purchaseError) {
        resetForm();
        setShowForm(false);
        alert(
          "El medicamento se guardó, pero no se pudo registrar la compra: " +
            (purchaseError?.response?.data?.detail || purchaseError?.message || "Error desconocido")
        );
        return;
      }
      resetForm();
      setShowForm(false);
      // Confirmación visual solo al CREAR un medicamento nuevo (no al editar).
      if (!payload.id && savedMedication) {
        setMedSuccess(
          buildMedicationCreateSuccess({
            medication: savedMedication,
            profileLabel: activeProfile?.display_name || activeProfile?.full_name || "Mi perfil",
          })
        );
      }
    } catch (err) {
      console.error("Error al guardar medicamento:", err);
      console.error("Detalles del error:", err.response?.data);
      alert("No se pudo guardar el medicamento: " + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreateForm = () => {
    if (!canEditActiveProfile) return;
    resetForm();
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    resetForm();
  };

  const handleEdit = (med) => {
    if (!canEditActiveProfile) return;
    const startInputValue = toLocalInputValue(med.start_at || med.created_at || "");
    const startTimeValue = startInputValue ? startInputValue.slice(11, 16) : "";
    const scheduleTimeValue = med.schedule_time || "";
    setEndDateAuto(!Boolean(med.end_date));
    setScheduleTimeManuallyEdited(Boolean(scheduleTimeValue && scheduleTimeValue !== startTimeValue));
    setDraggedParticipantId("");
    setShowAdvancedForm(
      Boolean(
        (med.duration || "").trim() ||
        med.end_date ||
        (med.notes || "").trim() ||
        (med.schedule_time || "").trim() ||
        med.refill_enabled
      )
    );
    setShowForm(true);
    setForm({
      id: med.id,
      name: med.name,
      dose: med.dose,
      frequency: med.frequency,
      frequency_initial: med.frequency || "",
      duration: med.duration,
      start_at: startInputValue,
      schedule_time: scheduleTimeValue,
      completed: Boolean(med.completed),
      end_date: med.end_date ? med.end_date.slice(0, 10) : "",
      notes: med.notes || "",
      document_id: med.document_id || "",
      refill_enabled: Boolean(med.refill_enabled),
      refill_mode: med.refill_mode || "rotativo",
      refill_fixed_user_id: med.refill_fixed_user_id ? String(med.refill_fixed_user_id) : "",
      refill_participant_user_ids: Array.isArray(med.refill_participant_user_ids)
        ? med.refill_participant_user_ids.map((value) => String(value))
        : familyCaregivers.map((item) => String(item.user_id)),
      doses_per_intake: med.doses_per_intake != null ? formatLocalizedDecimalInput(med.doses_per_intake) : "1",
      frequency_per_day: med.frequency_per_day != null ? formatLocalizedDecimalInput(med.frequency_per_day) : "1",
      stock_total_doses:
        med.stock_total_doses || med.stock_total_doses === 0
          ? String(med.stock_total_doses)
          : "",
      refill_alert_threshold_doses:
        med.refill_alert_threshold_doses || med.refill_alert_threshold_doses === 0
          ? String(med.refill_alert_threshold_doses)
          : "",
    });
    setRegisterPurchaseNow(false);
    setFormPurchaseNewStock(String(med.stock_total_doses || ""));
    setFormPurchaseAmount("");
    setFormPurchaseNotes("");
    setFormPurchaseReceiptFile(null);
    setFormPurchaseBuyerUserId(defaultPurchaseActorId);
  };

  const handleMarkPurchased = (med) => {
    setPurchaseTarget(med);
    setPurchaseNewStock(String(med.stock_total_doses || ""));
    setPurchaseAmount("");
    setPurchaseNotes("");
    setPurchaseReceiptFile(null);
    setPurchaseBuyerUserId(defaultPurchaseActorId);
    setPurchaseOpen(true);
  };

  const resetPurchaseModal = () => {
    setPurchaseOpen(false);
    setPurchaseTarget(null);
    setPurchaseNewStock("");
    setPurchaseAmount("");
    setPurchaseNotes("");
    setPurchaseReceiptFile(null);
    setPurchaseBuyerUserId("");
  };

  const handleConfirmPurchase = async () => {
    if (!purchaseTarget) return;
    const nextStock = parseInt(purchaseNewStock, 10) || 0;
    if (nextStock <= 0) {
      alert("Ingresa cuántas dosis tendrá el nuevo stock del medicamento.");
      return;
    }
    if (!String(purchaseBuyerUserId || "").trim()) {
      alert("Selecciona quién compró el medicamento.");
      return;
    }
    setPurchaseLoading(true);
    try {
      const formData = new FormData();
      formData.append("new_stock_total_doses", String(nextStock));
      formData.append("purchased_by_user_id", String(purchaseBuyerUserId));
      if (purchaseAmount.trim()) {
        formData.append("amount_total", serializeLocalizedDecimalInput(purchaseAmount));
      }
      if (purchaseNotes.trim()) {
        formData.append("notes", purchaseNotes.trim());
      }
      if (purchaseReceiptFile) {
        formData.append("receipt", purchaseReceiptFile);
      }
      await createMedicationPurchase(purchaseTarget.id, formData);
      await Promise.all([load(), loadPurchaseHistory({ silent: true })]);
      notifyClinicalDataChanged({ profileId: activeProfile?.id, sources: ["medications", "health-radar", "adherence"] });
      resetPurchaseModal();
    } catch (err) {
      alert("No se pudo registrar la compra: " + (err.response?.data?.detail || err.message));
    } finally {
      setPurchaseLoading(false);
    }
  };

  const handleOpenPurchaseReceipt = async (purchase) => {
    if (!purchase?.id || !purchase?.has_receipt) return;
    try {
      const { blob } = await getMedicationPurchaseReceipt(purchase.id);
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      alert("No se pudo abrir la boleta: " + (error.response?.data?.detail || error.message));
    }
  };

  const dismissRouteReminder = () => {
    if (routeMedicationId) {
      setDismissedRouteReminderId(String(routeMedicationId));
    }
    navigate("/medications", { replace: true });
  };

  const handleRecordIntake = async (med, options = {}) => {
    if (!canEditActiveProfile) {
      alert("Este perfil está en modo solo lectura. No puedes registrar tomas.");
      return;
    }
    if (options.confirmMessage && !window.confirm(options.confirmMessage)) {
      return;
    }
    try {
      const payload = {
        status: "taken",
        source: options.source || "manual",
      };
      if (options.scheduledAt) {
        payload.scheduled_at =
          options.scheduledAt instanceof Date
            ? options.scheduledAt.toISOString()
            : options.scheduledAt;
      }
      const savedIntake = await recordMedicationIntake(med.id, payload);
      await refreshMedicationStateAfterIntake(
        "",
        "info:La dosis quedó guardada. Actualiza la lista si no ves el cambio.",
        {
          showFeedback: false,
          successSheet: buildMedicationIntakeSuccess({
            intake: savedIntake,
            medication: med,
            profileLabel: activeProfile?.display_name || activeProfile?.full_name || "Mi perfil",
          }),
        }
      );
    } catch (err) {
      console.error(err);
      alert(
        "No se pudo registrar la dosis: " +
          (err?.response?.data?.detail || err?.message || "Error desconocido")
      );
    }
  };

  const handleBackfillIntakes = async (med) => {
    if (!canEditActiveProfile || !med?.id) return;
    const pending = Math.max(0, Number(med?.expected_doses || 0) - Number(med?.taken_doses || 0));
    const confirmMessage =
      pending > 0
        ? `Se registrarán como tomadas las ${pending} dosis pasadas que quedaron sin registro. Tu adherencia se actualizará. ¿Continuar?`
        : "Se registrarán como tomadas las dosis pasadas que quedaron sin registro. ¿Continuar?";
    if (!window.confirm(confirmMessage)) return;
    try {
      const result = await backfillMedicationIntakes(med.id);
      const createdCount = Number(result?.created || 0);
      notifyMedicationDataChanged();
      await load();
      await loadDetailIntakeItems(med.id);
      showTimedIntakeFeedback(
        createdCount > 0
          ? `${createdCount} dosis pasadas quedaron registradas como tomadas.`
          : "No había dosis pasadas sin registro."
      );
    } catch (err) {
      console.error(err);
      alert(
        "No se pudieron registrar las dosis pasadas: " +
          (err?.response?.data?.detail || err?.message || "Error desconocido")
      );
    }
  };

  const recordTakenFromReminder = async (medication, source, triggeredAt) => {
    const scheduledAt = triggeredAt || new Date().toISOString();
    try {
      return await recordMedicationIntake(medication.id, {
        status: "taken",
        source,
        scheduled_at: scheduledAt,
      });
    } catch (error) {
      if (!triggeredAt) {
        throw error;
      }
      return recordMedicationIntake(medication.id, {
        status: "taken",
        source: `${source}_fallback`.slice(0, 40),
        taken_at: new Date().toISOString(),
        notes: "Fallback sin horario programado desde recordatorio.",
      });
    }
  };

  const showTimedIntakeFeedback = (message) => {
    setIntakeFeedback(message);
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
    }
    feedbackTimer.current = setTimeout(() => {
      setIntakeFeedback("");
    }, 2600);
  };

  const notifyMedicationDataChanged = () => {
    notifyClinicalDataChanged({
      profileId: activeProfile?.id,
      sources: ["medications", "health-radar", "adherence"],
    });
  };

  const refreshMedicationStateAfterIntake = async (
    successMessage,
    refreshFailureMessage,
    options = {}
  ) => {
    const {
      showFeedback = true,
      successSheet = null,
    } = options;
    notifyMedicationDataChanged();
    try {
      await load();
      if (showFeedback && successMessage) {
        showTimedIntakeFeedback(successMessage);
      }
    } catch (error) {
      console.error("No se pudo refrescar la lista de medicamentos", error);
      if (refreshFailureMessage || successMessage) {
        showTimedIntakeFeedback(refreshFailureMessage || successMessage);
      }
    } finally {
      if (successSheet) {
        setMedSuccess(successSheet);
      }
    }
  };

  const resetReminderPromptState = () => {
    setNotifyOpen(false);
    setNotifyTarget(null);
    setNotifyPromptKey("");
    setNotifyTriggeredAt(null);
  };

  const handleOpenDetail = (med) => {
    setDetailTarget(med);
    setDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setDetailTarget(null);
    setDetailIntakes([]);
    setDetailIntakeStats(null);
    setDetailIntakesLoading(false);
  };

  const closeNotifyModal = () => {
    if (notifyActionLoading) return;
    if (notifyPromptKey) {
      localStorage.setItem(notifyPromptKey, "dismissed");
    }
    notifyQueue.forEach((item) => {
      if (item.key) {
        localStorage.setItem(item.key, "dismissed");
      }
    });
    setNotifyQueue([]);
    setNotifyOpen(false);
    setNotifyTarget(null);
    setNotifyPromptKey("");
    setNotifyTriggeredAt(null);
    navigate("/medications", { replace: true });
  };

  const handleTakenFromAlert = async () => {
    if (!notifyTarget || !canEditActiveProfile) return;
      setNotifyActionLoading(true);
    try {
      const savedIntake = await recordTakenFromReminder(notifyTarget, "reminder_prompt", notifyTriggeredAt);
      if (notifyPromptKey) {
        localStorage.setItem(notifyPromptKey, "taken");
      }
      resetReminderPromptState();
      navigate("/medications", { replace: true });
      await refreshMedicationStateAfterIntake(
        "",
        "info:La toma quedó guardada. Actualiza la lista si no ves el cambio.",
        {
          showFeedback: false,
          successSheet: buildMedicationIntakeSuccess({
            intake: savedIntake,
            medication: notifyTarget,
            profileLabel: activeProfile?.display_name || activeProfile?.full_name || "Mi perfil",
          }),
        }
      );
    } catch (err) {
      console.error(err);
      alert(
        "No se pudo registrar la toma: " +
          (err?.response?.data?.detail || err?.message || "Error desconocido")
      );
    } finally {
      setNotifyActionLoading(false);
    }
  };

  const handleTakenAllFromAlert = async () => {
    if (!notifyTarget || !canEditActiveProfile) return;
    const batch = [
      { med: notifyTarget, key: notifyPromptKey, triggeredAt: notifyTriggeredAt },
      ...notifyQueue.map((item) => ({ med: item.med, key: item.key, triggeredAt: item.triggeredAt })),
    ];
    setNotifyActionLoading(true);
    try {
      let lastSavedIntake = null;
      for (const item of batch) {
        lastSavedIntake = await recordTakenFromReminder(item.med, "reminder_batch", item.triggeredAt);
        if (item.key) {
          localStorage.setItem(item.key, "taken");
        }
      }
      setNotifyQueue([]);
      resetReminderPromptState();
      navigate("/medications", { replace: true });
      await refreshMedicationStateAfterIntake(
        "",
        "info:Las tomas quedaron guardadas. Actualiza la lista si no ves el cambio.",
        {
          showFeedback: false,
          successSheet: buildMedicationIntakeSuccess({
            intake: lastSavedIntake,
            medication: null,
            profileLabel: activeProfile?.display_name || activeProfile?.full_name || "Mi perfil",
            count: batch.length,
          }),
        }
      );
    } catch (err) {
      console.error(err);
      alert(
        "No se pudieron registrar todas las tomas: " +
          (err?.response?.data?.detail || err?.message || "Error desconocido")
      );
    } finally {
      setNotifyActionLoading(false);
    }
  };

  const handleSkipFromAlert = async () => {
    if (!notifyTarget || !canEditActiveProfile) return;
    setNotifyActionLoading(true);
    try {
      await recordMedicationIntake(notifyTarget.id, {
        status: "skipped",
        source: "reminder_prompt",
        scheduled_at: notifyTriggeredAt || new Date().toISOString(),
        notes: "El usuario marco la dosis como omitida desde el recordatorio.",
      });
      if (notifyPromptKey) {
        localStorage.setItem(notifyPromptKey, "skipped");
      }
      resetReminderPromptState();
      navigate("/medications", { replace: true });
      await refreshMedicationStateAfterIntake(
        `info:Dosis omitida: ${notifyTarget.name}`,
        "info:La omisión quedó registrada. Actualiza la lista si no ves el cambio."
      );
    } catch (err) {
      console.error(err);
      alert(
        "No se pudo registrar la omisión: " +
          (err?.response?.data?.detail || err?.message || "Error desconocido")
      );
    } finally {
      setNotifyActionLoading(false);
    }
  };

  const handleTakeRouteReminder = async () => {
    if (!routeReminderMedication || !canEditActiveProfile) return;
    setNotifyActionLoading(true);
    try {
      const savedIntake = await recordTakenFromReminder(
        routeReminderMedication,
        "reminder_prompt",
        routeReminderTrigger
      );
      if (routeReminderPromptKey) {
        localStorage.setItem(routeReminderPromptKey, "taken");
      }
      dismissRouteReminder();
      await refreshMedicationStateAfterIntake(
        "",
        "info:La dosis quedó guardada. Actualiza la lista si no ves el cambio.",
        {
          showFeedback: false,
          successSheet: buildMedicationIntakeSuccess({
            intake: savedIntake,
            medication: routeReminderMedication,
            profileLabel: activeProfile?.display_name || activeProfile?.full_name || "Mi perfil",
          }),
        }
      );
    } catch (err) {
      console.error(err);
      alert(
        "No se pudo registrar la dosis: " +
          (err?.response?.data?.detail || err?.message || "Error desconocido")
      );
    } finally {
      setNotifyActionLoading(false);
    }
  };

  const handleSkipRouteReminder = async () => {
    if (!routeReminderMedication || !canEditActiveProfile) return;
    setNotifyActionLoading(true);
    try {
      await recordMedicationIntake(routeReminderMedication.id, {
        status: "skipped",
        source: "reminder_prompt",
        scheduled_at:
          routeReminderTrigger?.toISOString?.() || new Date().toISOString(),
        notes: "El usuario marcó la dosis como omitida desde el recordatorio.",
      });
      if (routeReminderPromptKey) {
        localStorage.setItem(routeReminderPromptKey, "skipped");
      }
      dismissRouteReminder();
      await refreshMedicationStateAfterIntake(
        `info:Dosis omitida: ${routeReminderMedication.name}`,
        "info:La omisión quedó registrada. Actualiza la lista si no ves el cambio."
      );
    } catch (err) {
      console.error(err);
      alert(
        "No se pudo registrar la omisión: " +
          (err?.response?.data?.detail || err?.message || "Error desconocido")
      );
    } finally {
      setNotifyActionLoading(false);
    }
  };

  const handleOpenRouteReminderDetail = () => {
    if (!routeReminderMedication) return;
    handleOpenDetail(routeReminderMedication);
    dismissRouteReminder();
  };

  const handleDelete = async (med) => {
    if (!canEditActiveProfile) {
      alert("Este perfil está en modo solo lectura. No puedes eliminar medicamentos.");
      return;
    }
    if (!window.confirm("¿Eliminar este medicamento?")) return;
    try {
      await deleteMedication(med.id);
      await Promise.all([load(), loadPurchaseHistory({ silent: true })]);
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["medications", "health-radar", "adherence"],
      });
    } catch (err) {
      console.error(err);
      alert(
        "No se pudo eliminar el medicamento: " +
          (err?.response?.data?.detail || err?.message || "Error desconocido")
      );
    }
  };

  const handleRenewMedication = async (med) => {
    if (!canEditActiveProfile) {
      alert("Este perfil está en modo solo lectura. No puedes crear medicamentos.");
      return;
    }
    if (!med?.id) return;
    const confirmMsg =
      "¿Crear un tratamiento nuevo con los mismos datos, comenzando hoy?";
    if (!window.confirm(confirmMsg)) return;
    try {
      const startAtIso = buildLocalMinuteTimestamp();
      const payload = {
        name: med.name || "",
        dose: med.dose || "",
        frequency: med.frequency || "",
        duration: med.duration || "",
        start_at: startAtIso,
        schedule_time: med.schedule_time || "",
        completed: false,
        end_date: null,
        notes: med.notes || "",
        document_id: med.document_id || null,
        refill_enabled: false,
        refill_mode: med.refill_mode || "rotativo",
        refill_fixed_user_id: null,
        refill_participant_user_ids: [],
        doses_per_intake: Number(med.doses_per_intake) || 1,
        frequency_per_day: Number(med.frequency_per_day) || 1,
        stock_total_doses: 0,
        refill_alert_threshold_doses: 0,
      };
      if (!med.completed) {
        await saveMedication({
          id: med.id,
          completed: true,
          end_date: buildLocalMinuteTimestamp(),
        });
      }
      await saveMedication(payload);
      await load();
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["medications", "health-radar", "adherence"],
      });
    } catch (err) {
      console.error(err);
      alert(
        "No se pudo renovar el tratamiento: " +
          (err?.response?.data?.detail || err?.message || "Error desconocido")
      );
    }
  };

  const handleCompleteMedication = async (med) => {
    if (!canEditActiveProfile) {
      alert("Este perfil está en modo solo lectura. No puedes finalizar medicamentos.");
      return;
    }
    // Permite cerrar un tratamiento que ya venció por fecha pero sigue sin
    // marcarse como completado (antes quedaba bloqueado por isMedicationFinished).
    if (!med?.id || med.completed) return;
    const medicationName = cleanUiText(med.name || "este tratamiento");
    const confirmMsg = `¿Finalizar ${medicationName} ahora? Dejará de aparecer como un tratamiento activo hasta que lo renueves.`;
    if (!window.confirm(confirmMsg)) return;
    try {
      const completedAt = buildLocalMinuteTimestamp();
      const updatedMedication = await saveMedication({
        id: med.id,
        completed: true,
        end_date: completedAt,
      });
      await load();
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["medications", "health-radar", "adherence"],
      });
      setMedSuccess(
        buildMedicationCompletedSuccess({
          medication: updatedMedication || { ...med, completed: true, end_date: completedAt },
          profileLabel:
            activeProfile?.display_name || activeProfile?.full_name || "Mi perfil",
          completedAt,
        }),
      );
    } catch (err) {
      console.error(err);
      alert(
        "No se pudo finalizar el medicamento: " +
          (err?.response?.data?.detail || err?.message || "Error desconocido"),
      );
    }
  };

  const finishedDismissStorageKey = `klinip_dismissed_finished_meds_${activeProfile?.id || "default"}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(finishedDismissStorageKey);
      const ids = raw ? JSON.parse(raw) : [];
      setDismissedFinishedIds(new Set(Array.isArray(ids) ? ids.map(Number) : []));
    } catch (_e) {
      setDismissedFinishedIds(new Set());
    }
  }, [finishedDismissStorageKey]);

  const persistDismissedFinishedIds = (idSet) => {
    try {
      window.localStorage.setItem(
        finishedDismissStorageKey,
        JSON.stringify(Array.from(idSet)),
      );
    } catch (_e) {
      // localStorage no disponible: el descarte solo dura esta sesión.
    }
  };

  // Oculta temporalmente el banner. Vuelve a aparecer si finaliza un tratamiento
  // nuevo (su id no está descartado) o al limpiar los datos del navegador.
  const dismissFinishedBanner = (ids) => {
    setDismissedFinishedIds((prev) => {
      const next = new Set(prev);
      (ids || []).forEach((id) => next.add(Number(id)));
      persistDismissedFinishedIds(next);
      return next;
    });
  };

  // Cierra definitivamente un tratamiento ya vencido por fecha (lo marca como
  // completado). Quita la tarjeta del banner y resuelve su alerta del radar.
  const handleCloseFinishedMedication = async (med) => {
    if (!canEditActiveProfile) {
      alert("Este perfil está en modo solo lectura. No puedes cerrar tratamientos.");
      return;
    }
    if (!med?.id) return;
    const medicationName = cleanUiText(med.name || "este tratamiento");
    if (!window.confirm(`¿Cerrar ${medicationName}? Quedará marcado como finalizado y dejará de aparecer aquí.`)) {
      return;
    }
    try {
      const updatedMedication = await saveMedication({ id: med.id, completed: true });
      await load();
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["medications", "health-radar", "adherence"],
      });
      setMedSuccess(
        buildMedicationCompletedSuccess({
          medication: updatedMedication || { ...med, completed: true },
          profileLabel:
            activeProfile?.display_name || activeProfile?.full_name || "Mi perfil",
          completedAt: med.end_date || buildLocalMinuteTimestamp(),
        }),
      );
    } catch (err) {
      console.error(err);
      alert(
        "No se pudo cerrar el tratamiento: " +
          (err?.response?.data?.detail || err?.message || "Error desconocido"),
      );
    }
  };

  const medsMissingFrequency = (meds || []).filter(
    (m) => !m.frequency || m.frequency.trim() === ""
  );
  const routeReminderTrigger =
    routeTriggerParam && !Number.isNaN(Number(routeTriggerParam))
      ? new Date(Number(routeTriggerParam))
      : null;
  const routeReminderMedication =
    routeFocusSource === "reminder" &&
    routeMedicationId &&
    dismissedRouteReminderId !== String(routeMedicationId)
      ? (meds || []).find((med) => String(med.id) === String(routeMedicationId)) || null
      : null;
  const routeReminderPromptKey =
    routeReminderMedication && routeReminderTrigger
      ? buildDosePromptKey(routeReminderMedication, routeReminderTrigger)
      : "";
  const adherenceTotals = (meds || []).reduce(
    (acc, med) => {
      acc.expected += Number(med.expected_doses || 0);
      acc.taken += Number(med.taken_doses || 0);
      return acc;
    },
    { expected: 0, taken: 0 }
  );
  const globalAdherence =
    adherenceTotals.expected > 0
      ? Math.round((adherenceTotals.taken / adherenceTotals.expected) * 100)
      : null;
  const filteredMeds = (meds || []).filter((med) => {
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      (med.name || "").toLowerCase().includes(term) ||
      (med.dose || "").toLowerCase().includes(term) ||
      (med.frequency || "").toLowerCase().includes(term) ||
      (med.notes || "").toLowerCase().includes(term);
    const finished = isMedicationFinished(med);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && !finished) ||
      (statusFilter === "completed" && finished) ||
      (statusFilter === "scheduled" && !finished && getMedicationScheduleTimes(med).length > 0);
    return matchesSearch && matchesStatus;
  });
  const filteredPurchases = (purchaseHistory || []).filter((item) => {
    const term = search.trim().toLowerCase();
    return (
      !term ||
      (item.medication_name_snapshot || "").toLowerCase().includes(term) ||
      (item.purchased_by_name_snapshot || "").toLowerCase().includes(term) ||
      (item.assigned_name_snapshot || "").toLowerCase().includes(term) ||
      (item.notes || "").toLowerCase().includes(term)
    );
  });
  const detailPurchases = detailTarget?.id
    ? (purchaseHistory || []).filter((item) => Number(item.medication_id) === Number(detailTarget.id)).slice(0, 6)
    : [];
  const recentlyFinishedMeds = (() => {
    const now = new Date();
    const cutoff = now.getTime() - 14 * 24 * 60 * 60 * 1000;
    return (meds || [])
      .filter((med) => {
        if (med.completed) return false;
        if (dismissedFinishedIds.has(Number(med.id))) return false;
        const endAt = getMedicationEffectiveEndAt(med);
        if (!endAt) return false;
        const ts = endAt.getTime();
        return ts < now.getTime() && ts >= cutoff;
      })
      .sort((a, b) => {
        const ta = getMedicationEffectiveEndAt(a)?.getTime() || 0;
        const tb = getMedicationEffectiveEndAt(b)?.getTime() || 0;
        return tb - ta;
      })
      .slice(0, 5);
  })();
  const familyRefillAvailable =
    hasAcceptedFamilyCollaborators;
  const familyRefillOptions = familyCaregivers.map((item) => ({
    id: String(item?.user_id || ""),
    name: item?.user_name || item?.user_email || `Familiar ${item?.user_id || ""}`,
  }));
  const purchaseActorOptions = familyCaregivers.map((item) => ({
    id: String(item?.user_id || ""),
    name: item?.user_name || item?.user_email || `Usuario ${item?.user_id || ""}`,
  }));
  const defaultPurchaseActorId = purchaseActorOptions.length === 1 ? purchaseActorOptions[0].id : "";
  const familyRefillNames = familyRefillOptions
    .map((item) => item.name || "")
    .filter(Boolean)
    .slice(0, 4);
  const sanitizeLocalizedDecimalInput = (value) => {
    const normalized = String(value ?? "")
      .replace(/\./g, ",")
      .replace(/[^0-9,]/g, "");
    const [integerPart = "", ...decimalParts] = normalized.split(",");
    return decimalParts.length ? `${integerPart},${decimalParts.join("")}` : integerPart;
  };
  const serializeLocalizedDecimalInput = (value) =>
    sanitizeLocalizedDecimalInput(value).replace(",", ".");
  const parseLocalizedDecimalInput = (value) => {
    const parsed = Number.parseFloat(serializeLocalizedDecimalInput(value));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  const isPositiveLocalizedDecimalInput = (value) => {
    const parsed = parseLocalizedDecimalInput(value);
    return Number.isFinite(parsed) && parsed > 0;
  };
  const formatLocalizedDecimalInput = (value) => {
    if (value == null || value === "") return "";
    return sanitizeLocalizedDecimalInput(String(value));
  };
  const frequencyValue = String(form.frequency || "").trim();
  const durationValue = String(form.duration || "").trim();
  const medicationPreviewName = String(form.name || "").trim() || "Medicamento";
  const medicationPreviewDose = String(form.dose || "").trim();
  const medicationStartPreview = toLocaleDateTimeOrEmpty(form.start_at) || "";
  const derivedFrequencyPerDay = deriveFrequencyPerDay(
    frequencyValue,
    serializeLocalizedDecimalInput(form.frequency_per_day)
  );
  const frequencyIntervalHours = deriveFrequencyIntervalHours(frequencyValue);
  const formPreviewMedication = {
    ...form,
    computed_schedule_times: [],
    computed_schedule_summary: "",
    effective_end_date: null,
  };
  const schedulePreviewTimes = getMedicationScheduleTimes(formPreviewMedication);
  const schedulePreviewSummary = getMedicationScheduleSummary(formPreviewMedication);
  const endPreviewDate = getMedicationEffectiveEndAt(formPreviewMedication);
  const computedEndDateInput = endPreviewDate ? toLocalInputValue(endPreviewDate).slice(0, 10) : "";
  const schedulePreviewCountLabel = schedulePreviewTimes.length
    ? schedulePreviewTimes.length === 1
      ? "1 toma al día"
      : `${schedulePreviewTimes.length} tomas al día`
    : "Sin horario calculado";
  const schedulePreviewHeadline = frequencyValue
    ? schedulePreviewSummary
      ? `Klinip la repetirá a las ${schedulePreviewSummary}.`
      : "Klinip calculará el horario cuando tenga una hora de inicio."
    : "Primero indica cada cuánto se toma para calcular el horario.";
  const schedulePreviewHelper = form.start_at
    ? scheduleTimeManuallyEdited
      ? "La hora base quedó fijada manualmente. Si cambias el inicio, Klinip mantendrá esa hora hasta que la vuelvas a sincronizar."
      : "Mientras no cambies la hora base manualmente, si ajustas el inicio Klinip actualizará todo el plan diario."
    : "La fecha y la hora de inicio sirven para ordenar las siguientes tomas.";
  const refillParticipantIds = Array.isArray(form.refill_participant_user_ids)
    ? form.refill_participant_user_ids
    : [];
  const refillParticipantItems = refillParticipantIds
    .map((participantId) =>
      familyRefillOptions.find((option) => option.id === String(participantId))
    )
    .filter(Boolean);
  const stockTotalUnits = Math.max(parseInt(form.stock_total_doses, 10) || 0, 0);
  const alertThresholdUnits = Math.max(
    parseInt(form.refill_alert_threshold_doses, 10) || 0,
    0
  );
  const dosesPerIntakeValue = Math.max(parseLocalizedDecimalInput(form.doses_per_intake) || 0, 0);
  const dailyUnitsEstimate =
    dosesPerIntakeValue > 0 && derivedFrequencyPerDay
      ? dosesPerIntakeValue * derivedFrequencyPerDay
      : 0;
  const stockCoverageDays =
    stockTotalUnits > 0 && dailyUnitsEstimate > 0
      ? stockTotalUnits / dailyUnitsEstimate
      : null;
  const thresholdCoverageDays =
    alertThresholdUnits > 0 && dailyUnitsEstimate > 0
      ? alertThresholdUnits / dailyUnitsEstimate
      : null;

  useEffect(() => {
    if (defaultPurchaseActorId) {
      setFormPurchaseBuyerUserId((current) => current || defaultPurchaseActorId);
      setPurchaseBuyerUserId((current) => current || defaultPurchaseActorId);
    }
  }, [defaultPurchaseActorId]);
  const totalMedicationPages = Math.max(
    1,
    Math.ceil(filteredMeds.length / MEDICATIONS_PAGE_SIZE) || 1
  );
  const safeMedicationPage = Math.min(medicationsPage, totalMedicationPages);
  const paginatedMeds = filteredMeds.slice(
    (safeMedicationPage - 1) * MEDICATIONS_PAGE_SIZE,
    safeMedicationPage * MEDICATIONS_PAGE_SIZE
  );
  const visibleMedicationCount = Math.min(
    safeMedicationPage * MEDICATIONS_PAGE_SIZE,
    filteredMeds.length
  );
  const detailDoseContext = detailTarget ? getMedicationDoseContext(detailTarget) : null;
  const detailTakenDoses = Number(detailTarget?.taken_doses || 0);
  const detailExpectedDoses = detailTarget ? getMedicationPlannedDoses(detailTarget) : 0;
  const detailDoseProgress = getDoseProgressLabel(detailTakenDoses, detailExpectedDoses);
  const detailPendingBackfill = Math.max(
    0,
    Number(detailTarget?.expected_doses || 0) - detailTakenDoses
  );

  useEffect(() => {
    if (medicationsPage > totalMedicationPages) {
      setMedicationsPage(totalMedicationPages);
    }
  }, [medicationsPage, totalMedicationPages]);
  const remindersReady = Boolean(frequencyValue && form.start_at);

  useEffect(() => {
    setDismissedRouteReminderId("");
  }, [location.search]);

  useEffect(() => {
    if (!routeReminderPromptKey) return;
    if (localStorage.getItem(routeReminderPromptKey)) return;
    localStorage.setItem(routeReminderPromptKey, "prompted");
  }, [routeReminderPromptKey]);

  useEffect(() => {
    if (!routeReminderMedication) return;
    const indexInFiltered = filteredMeds.findIndex(
      (med) => String(med.id) === String(routeReminderMedication.id)
    );
    if (indexInFiltered < 0) return;
    const nextPage = Math.floor(indexInFiltered / MEDICATIONS_PAGE_SIZE) + 1;
    setMedicationsPage((current) => (current === nextPage ? current : nextPage));
  }, [filteredMeds, routeReminderMedication]);

  useEffect(() => {
    if (!routeReminderMedication) return;
    const timerId = window.setTimeout(() => {
      const focusedCard = document.querySelector(
        `[data-medication-id="${routeReminderMedication.id}"]`
      );
      focusedCard?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 160);
    return () => window.clearTimeout(timerId);
  }, [paginatedMeds, routeReminderMedication]);

  useEffect(() => {
    if (!endDateAuto) return;
    setForm((current) => {
      const nextEndDate = computedEndDateInput || "";
      if ((current.end_date || "") === nextEndDate) return current;
      return {
        ...current,
        end_date: nextEndDate,
      };
    });
  }, [computedEndDateInput, endDateAuto]);

  const toggleRefillParticipant = (participantId) => {
    setForm((current) => {
      const currentIds = Array.isArray(current.refill_participant_user_ids)
        ? current.refill_participant_user_ids
        : [];
      const exists = currentIds.includes(participantId);
      const nextIds = exists
        ? currentIds.filter((item) => item !== participantId)
        : [...currentIds, participantId];
      const nextFixedUserId =
        current.refill_mode === "fijo" &&
        current.refill_fixed_user_id &&
        !nextIds.includes(current.refill_fixed_user_id)
          ? ""
          : current.refill_fixed_user_id;
      return {
        ...current,
        refill_participant_user_ids: nextIds,
        refill_fixed_user_id: nextFixedUserId,
      };
    });
  };

  const moveRefillParticipant = (participantId, direction) => {
    setForm((current) => {
      const currentIds = Array.isArray(current.refill_participant_user_ids)
        ? [...current.refill_participant_user_ids]
        : [];
      const currentIndex = currentIds.indexOf(participantId);
      if (currentIndex === -1) return current;
      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= currentIds.length) return current;
      [currentIds[currentIndex], currentIds[nextIndex]] = [
        currentIds[nextIndex],
        currentIds[currentIndex],
      ];
      return {
        ...current,
        refill_participant_user_ids: currentIds,
      };
    });
  };

  const moveRefillParticipantToTarget = (draggedId, targetId) => {
    if (!draggedId || !targetId || draggedId === targetId) return;
    setForm((current) => {
      const currentIds = Array.isArray(current.refill_participant_user_ids)
        ? [...current.refill_participant_user_ids]
        : [];
      const draggedIndex = currentIds.indexOf(draggedId);
      const targetIndex = currentIds.indexOf(targetId);
      if (draggedIndex === -1 || targetIndex === -1) return current;
      currentIds.splice(draggedIndex, 1);
      currentIds.splice(targetIndex, 0, draggedId);
      return {
        ...current,
        refill_participant_user_ids: currentIds,
      };
    });
  };

  const handleParticipantDragStart = (participantId) => {
    setDraggedParticipantId(participantId);
  };

  const handleParticipantDrop = (targetId) => {
    if (!draggedParticipantId) return;
    moveRefillParticipantToTarget(draggedParticipantId, targetId);
    setDraggedParticipantId("");
  };

  const getIntakeStatusLabel = (status) => {
    return getSharedMedicationIntakeStatusLabel(status);
  };

  const getIntakeHeadline = (item) => {
    const normalized = String(item?.status || "taken").toLowerCase();
    if (normalized === "late") return "La toma se confirmó más tarde";
    if (normalized === "missed") return "Esta dosis sigue sin confirmación";
    if (normalized === "skipped") return "Esta dosis quedó como no tomada";
    return "La toma quedó confirmada";
  };

  const getIntakeStatusSummary = (item) => {
    const normalized = String(item?.status || "taken").toLowerCase();
    if (normalized === "late") {
      return "Se registró después de la hora planificada.";
    }
    if (normalized === "missed") {
      return "Klinip detectó esta dosis, pero todavía nadie la confirmó.";
    }
    if (normalized === "skipped") {
      return "Se dejó constancia de que esta dosis no se tomó.";
    }
    const scheduledAt = parseDate(item?.scheduled_at);
    const takenAt = parseDate(item?.taken_at);
    if (scheduledAt && takenAt) {
      const diffMinutes = Math.round(Math.abs(takenAt.getTime() - scheduledAt.getTime()) / 60000);
      if (diffMinutes <= 15) {
        return "Quedó registrada dentro del horario esperado.";
      }
      return "Quedó registrada con una hora distinta a la planificada.";
    }
    if (takenAt) {
      return "La dosis se registró manualmente.";
    }
    return "";
  };

  return (
    <>
      {intakeFeedback && (
        <div
          className={`med-intake-toast ${
            intakeFeedback.startsWith("success:")
              ? "is-success"
              : "is-info"
          }`}
          role="status"
        >
          {intakeFeedback.replace(/^(success:|info:)/, "")}
        </div>
      )}
      <div className="card medications-surface-free medications-intro">
        <h2 className="card-title">Medicamentos y tratamientos</h2>
        <p className="muted">
          Registra fármacos, dosis y frecuencia. Añade duración y notas para no perder la trazabilidad.
        </p>
      </div>

      {isReadOnlyProfile ? (
        <div className="card">
          <div className="alert-info">
            <p>
              <strong>Perfil en modo lectura.</strong> Puedes revisar tratamientos y adherencia, pero no crear, editar, eliminar ni registrar tomas.
            </p>
          </div>
        </div>
      ) : null}

      {canEditActiveProfile ? (
        <div className="card medications-surface-free medications-create">
          <button
            className="primary-btn"
            type="button"
            style={{ width: "100%" }}
            onClick={handleOpenCreateForm}
          >
            Agregar medicamento
          </button>
        </div>
      ) : null}

      {canEditActiveProfile && medsMissingFrequency.length > 0 && (
        <div className="card">
          <h3 className="card-title">Faltan indicaciones</h3>
          <p className="muted">
            {medsMissingFrequency.length} medicamento(s) no tienen frecuencia.
            Completa la indicación para activar recordatorios.
          </p>
          <button
            className="primary-btn"
            type="button"
            onClick={() => handleEdit(medsMissingFrequency[0])}
          >
            Completar ahora
          </button>
        </div>
      )}

      {notifyOpen && notifyTarget && (
        <div className="med-dose-alert-backdrop" onClick={closeNotifyModal}>
          <div
            className="med-dose-alert"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="med-dose-alert-close"
              onClick={closeNotifyModal}
              aria-label="Cerrar alerta"
            >
              ×
            </button>
            <p className="med-dose-alert-day">
              {formatAlertDay(notifyTriggeredAt || new Date())}
            </p>
            <div className="med-dose-alert-icon" aria-hidden="true">
              💊
            </div>
            <h3 className="med-dose-alert-title">
              Medicamento de las{" "}
              {formatDoseClock(notifyTriggeredAt || notifyTarget.start_at || notifyTarget.schedule_time)}
            </h3>
            {canEditActiveProfile && notifyQueue.length > 0 && (
              <button
                type="button"
                className="med-dose-batch-btn"
                onClick={handleTakenAllFromAlert}
                disabled={notifyActionLoading}
              >
                {notifyActionLoading
                  ? "Registrando..."
                  : `Marcar todas como tomadas (${notifyQueue.length + 1})`}
              </button>
            )}
            <div className="med-dose-alert-card">
              <p className="med-dose-alert-name">{notifyTarget.name}</p>
              <p className="med-dose-alert-meta">
                {notifyTarget.dose || "Sin dosis definida"}
              </p>
              {notifyTarget.notes && (
                <p className="med-dose-alert-notes">{notifyTarget.notes}</p>
              )}
              <p className="med-dose-alert-helper">
                Si todavia no la tomas, puedes dejarla pendiente y volver despues.
              </p>
              {canEditActiveProfile ? (
                <div className="med-dose-alert-actions">
                  <button
                    className="med-dose-btn is-subtle"
                    type="button"
                    onClick={closeNotifyModal}
                    disabled={notifyActionLoading}
                  >
                    Ahora no
                  </button>
                  <button
                    className="med-dose-btn"
                    type="button"
                    onClick={handleSkipFromAlert}
                    disabled={notifyActionLoading}
                  >
                    No la tome
                  </button>
                  <button
                    className="med-dose-btn is-primary"
                    type="button"
                    onClick={handleTakenFromAlert}
                    disabled={notifyActionLoading}
                  >
                    {notifyActionLoading ? "Registrando..." : "Ya la tome"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {canEditActiveProfile && missingFrequency && !showForm && createPortal(
        <div
          className="modal-backdrop"
          onClick={() => setMissingFrequency(null)}
        >
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Falta frecuencia</h3>
            <p className="muted">
              Se detectó el medicamento <strong>{missingFrequency.name}</strong>
              {missingFrequency.dose ? ` (${missingFrequency.dose})` : ""} pero no
              se pudo leer la frecuencia. Indícala para activar recordatorios.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => {
                  localStorage.setItem(
                    `klinip_missing_freq_dismissed_${missingFrequency.id}`,
                    "1"
                  );
                  setMissingFrequency(null);
                }}
              >
                Luego
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => {
                  handleEdit(missingFrequency);
                  setMissingFrequency(null);
                }}
              >
                Completar ahora
              </button>
            </div>
          </div>
        </div>
      , document.getElementById("overlay-root") || document.body)}

      {showForm && canEditActiveProfile && createPortal(
        <div className="floating-form-backdrop" onClick={handleCloseForm}>
          <div className="floating-form-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-header med-form-header" style={{ marginBottom: "0.5rem" }}>
              <div>
                <p className="med-form-kicker">
                  {form.id ? "Editar tratamiento" : "Nuevo tratamiento"}
                </p>
                <h3 className="card-title" style={{ margin: 0 }}>
                  {form.id ? "Actualiza lo importante" : "Guardar medicamento"}
                </h3>
                <p className="muted med-form-header-copy">
                  Primero completa nombre, dosis, frecuencia y primera toma. En este mismo formulario también puedes registrar la compra y adjuntar la boleta.
                </p>
              </div>
              <button className="secondary-btn" type="button" onClick={handleCloseForm}>
                Cerrar
              </button>
            </div>
            <form onSubmit={handleSubmit} noValidate>
              <div className="med-form-shell">
                <section className="med-form-section is-primary">
                  <div className="med-form-section-head">
                    <div>
                      <h4>Lo esencial</h4>
                      <p className="muted">
                        Esto basta para guardar el tratamiento y, si corresponde, activar recordatorios.
                      </p>
                    </div>
                    <div className={`med-form-status ${remindersReady ? "is-ready" : "is-draft"}`}>
                      {remindersReady ? "Recordatorios listos" : "Faltan datos para recordatorios"}
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="input-group">
                      <label className="input-label">Nombre del medicamento</label>
                      <input
                        className="input-field"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        required
                        placeholder="Ej: Paracetamol"
                      />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Dosis</label>
                      <input
                        className="input-field"
                        value={form.dose}
                        onChange={(e) => setForm({ ...form, dose: e.target.value })}
                        placeholder="Ej: 500 mg o 1 comprimido"
                      />
                    </div>
                  </div>

                  <div className="input-group">
                    <label className="input-label">Cada cuánto lo toma</label>
                    <input
                      className="input-field"
                      value={form.frequency}
                      onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                      placeholder="Ej: Cada 8 horas"
                    />
                    <small className="muted med-form-helper">
                      Escribe la indicación tal como aparece en la receta o toca una opción sugerida para que Klinip arme el plan automáticamente.
                    </small>
                    <div className="med-form-chip-row" role="group" aria-label="Frecuencias sugeridas">
                      {FREQUENCY_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          className={`med-form-chip ${frequencyValue === preset.value ? "is-active" : ""}`}
                          onClick={() => setForm((current) => ({ ...current, frequency: preset.value }))}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="input-group">
                      <label className="input-label">Cuándo empieza</label>
                      <input
                        className="input-field"
                        type="datetime-local"
                        value={form.start_at}
                        required={Boolean(frequencyValue)}
                        onChange={(e) => {
                          const nextStartAt = e.target.value;
                          setForm((current) => ({
                            ...current,
                            start_at: nextStartAt,
                            schedule_time:
                              !nextStartAt || scheduleTimeManuallyEdited
                                ? current.schedule_time
                                : nextStartAt.slice(11, 16),
                          }));
                        }}
                      />
                      <small className="muted med-form-helper">
                        Esta fecha y hora marcan la primera dosis. Desde aquí Klinip calcula las siguientes.
                      </small>
                    </div>
                    <div className="input-group">
                      <label className="input-label">Duración</label>
                      <input
                        className="input-field"
                        value={form.duration}
                        onChange={(e) => setForm({ ...form, duration: e.target.value })}
                        placeholder="Ej: 7 días o 2 semanas"
                      />
                      <div className="med-form-chip-row" role="group" aria-label="Duraciones sugeridas">
                        {DURATION_PRESETS.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            className={`med-form-chip ${durationValue === preset.value ? "is-active" : ""}`}
                            onClick={() => setForm((current) => ({ ...current, duration: preset.value }))}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="med-form-summary" aria-live="polite">
                    <div className="med-form-summary-head">
                      <div>
                        <strong>{medicationPreviewName}{medicationPreviewDose ? ` · ${medicationPreviewDose}` : ""}</strong>
                        <p>{schedulePreviewHeadline}</p>
                      </div>
                      <span className={`med-form-summary-badge ${remindersReady ? "is-ready" : "is-draft"}`}>
                        {remindersReady ? "Listo para recordatorios" : "Faltan datos"}
                      </span>
                    </div>
                    <div className="med-form-summary-grid">
                      <div className="med-form-summary-item">
                        <span className="med-form-summary-label">Inicio</span>
                        <strong>{medicationStartPreview || "Pendiente"}</strong>
                        <small>{medicationStartPreview ? "Esta será la primera dosis registrada por el plan." : "Elige día y hora para comenzar."}</small>
                      </div>
                      <div className="med-form-summary-item">
                        <span className="med-form-summary-label">Plan diario</span>
                        <strong>{schedulePreviewCountLabel}</strong>
                        <small>{schedulePreviewSummary || "Klinip mostrará aquí los horarios cuando tenga datos suficientes."}</small>
                      </div>
                      <div className="med-form-summary-item">
                        <span className="med-form-summary-label">Frecuencia</span>
                        <strong>{frequencyValue || "Pendiente"}</strong>
                        <small>{frequencyIntervalHours ? `Equivale a una toma cada ${frequencyIntervalHours} horas.` : "Puedes escribirla libremente si no coincide con una opción sugerida."}</small>
                      </div>
                      <div className="med-form-summary-item">
                        <span className="med-form-summary-label">Término estimado</span>
                        <strong>{endPreviewDate ? formatMedicationDateTime(endPreviewDate) : "Pendiente"}</strong>
                        <small>{endPreviewDate ? "Klinip lo recalcula si cambias el inicio, la frecuencia o la duración." : "Aparece cuando defines la duración o la fecha de término."}</small>
                      </div>
                    </div>
                    {schedulePreviewTimes.length ? (
                      <div className="med-form-schedule-chips" aria-label="Horarios calculados">
                        {schedulePreviewTimes.map((slot) => (
                          <span key={slot} className="med-form-schedule-chip">
                            {slot}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <span>{schedulePreviewHelper}</span>
                  </div>
                </section>

                <button
                  type="button"
                  className="med-form-advanced-toggle"
                  onClick={() => setShowAdvancedForm((current) => !current)}
                  aria-expanded={showAdvancedForm}
                >
                  {showAdvancedForm ? "Ocultar compra, boleta y opciones opcionales" : "Ver compra, boleta y opciones opcionales"}
                </button>

                {showAdvancedForm && (
                  <section className="med-form-section">
                    <div className="med-form-section-head">
                      <div>
                        <h4>Opciones opcionales</h4>
                        <p className="muted">
                          Úsalas solo si quieres afinar horarios, fecha de término, notas o reposición familiar.
                        </p>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="input-group">
                        <label className="input-label">Fecha de término</label>
                        <input
                          className="input-field"
                          type="date"
                          value={form.end_date}
                          onChange={(e) => {
                            setEndDateAuto(false);
                            setForm({ ...form, end_date: e.target.value });
                          }}
                        />
                        <small className="muted med-form-helper">
                          {endDateAuto && computedEndDateInput
                            ? "Klinip la completó automáticamente. Puedes borrarla o cambiarla."
                            : "Si la dejas vacía, Klinip usará la duración para estimar la última toma."}
                        </small>
                        {!endDateAuto && computedEndDateInput ? (
                          <button
                            type="button"
                            className="secondary-btn med-inline-helper-btn"
                            onClick={() => setEndDateAuto(true)}
                          >
                            Usar fecha estimada
                          </button>
                        ) : null}
                      </div>
                      <div className="input-group">
                        <label className="input-label">Hora base del plan</label>
                        <input
                          className="input-field"
                          type="time"
                          value={form.schedule_time}
                          onChange={(e) => {
                            setScheduleTimeManuallyEdited(Boolean(e.target.value));
                            setForm({ ...form, schedule_time: e.target.value });
                          }}
                        />
                        <small className="muted med-form-helper">
                          Si no la cambias, Klinip usa la hora del inicio. Solo modifícala si quieres desplazar todo el plan diario.
                        </small>
                        {form.start_at ? (
                          <button
                            type="button"
                            className="secondary-btn med-inline-helper-btn"
                            onClick={() => {
                              setScheduleTimeManuallyEdited(false);
                              setForm((current) => ({
                                ...current,
                                schedule_time: current.start_at ? current.start_at.slice(11, 16) : "",
                              }));
                            }}
                          >
                            Usar la hora del inicio
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="med-derived-grid">
                      <div className="med-derived-card">
                        <span className="med-derived-label">Tomas por día</span>
                        <strong>
                          {derivedFrequencyPerDay
                            ? `${Number(derivedFrequencyPerDay).toLocaleString("es-CL")} al día`
                            : "Se calculará cuando la frecuencia sea reconocible"}
                        </strong>
                        <small>
                          {frequencyIntervalHours
                            ? `Detectado desde “${frequencyValue}”.`
                            : "Si la frecuencia no es clara, podrás afinar la reposición manualmente."}
                        </small>
                      </div>
                      <div className="med-derived-card">
                        <span className="med-derived-label">Horarios</span>
                        <strong>{schedulePreviewSummary || "Pendiente"}</strong>
                        <small>
                          {schedulePreviewTimes.length > 1
                            ? `Se repetirán ${schedulePreviewTimes.length} veces al día.`
                            : "Se usará un horario base diario."}
                        </small>
                      </div>
                      <div className="med-derived-card">
                        <span className="med-derived-label">Término estimado</span>
                        <strong>{endPreviewDate ? formatMedicationDateTime(endPreviewDate) : "Pendiente"}</strong>
                        <small>
                          {durationValue
                            ? "Klinip lo recalcula si cambias duración, frecuencia o primera toma."
                            : "Agrega duración si quieres que Klinip lo calcule automáticamente."}
                        </small>
                      </div>
                    </div>

                    <div className="input-group">
                      <label className="input-label">Notas</label>
                      <textarea
                        className="textarea-field"
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        placeholder="Ej: tomar después de comer o no mezclar con otro tratamiento"
                      />
                    </div>

                    <div className="med-refill-settings">
                      <div className="med-refill-settings-head">
                        <div>
                          <h4>Compra actual y boleta</h4>
                          <p>
                            Si estás creando o actualizando el medicamento y además lo compraste, puedes dejar la compra
                            registrada de inmediato con su boleta.
                          </p>
                        </div>
                        <label className="med-refill-toggle">
                          <input
                            type="checkbox"
                            checked={registerPurchaseNow}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setRegisterPurchaseNow(checked);
                              if (checked && !formPurchaseNewStock.trim()) {
                                setFormPurchaseNewStock(String(form.stock_total_doses || ""));
                              }
                              if (checked && !formPurchaseBuyerUserId && defaultPurchaseActorId) {
                                setFormPurchaseBuyerUserId(defaultPurchaseActorId);
                              }
                            }}
                          />
                          <span>Registrar ahora</span>
                        </label>
                      </div>
                      {registerPurchaseNow ? (
                        <>
                          <div className="input-group">
                            <label className="input-label">Quién compró</label>
                            <select
                              className="select-field"
                              value={formPurchaseBuyerUserId}
                              onChange={(e) => setFormPurchaseBuyerUserId(e.target.value)}
                            >
                              <option value="">Selecciona persona</option>
                              {purchaseActorOptions.map((person) => (
                                <option key={`purchase-form-${person.id}`} value={person.id}>
                                  {person.name}
                                </option>
                              ))}
                            </select>
                            <small className="muted med-form-helper">
                              Elige a la persona que hizo la compra, aunque otra persona esté subiendo la boleta.
                            </small>
                          </div>
                          <div className="form-row">
                            <div className="input-group">
                              <label className="input-label">Stock total después de la compra</label>
                              <input
                                className="input-field"
                                type="number"
                                min="0"
                                value={formPurchaseNewStock}
                                onChange={(e) => setFormPurchaseNewStock(e.target.value)}
                                placeholder="Ej: 30"
                              />
                              <small className="muted med-form-helper">
                                Escribe cuántas unidades quedaron disponibles después de esta compra.
                              </small>
                            </div>
                            <div className="input-group">
                              <label className="input-label">Monto pagado</label>
                              <input
                                className="input-field"
                                type="text"
                                inputMode="decimal"
                                value={formPurchaseAmount}
                                onChange={(e) => setFormPurchaseAmount(e.target.value)}
                                placeholder="Ej: 5490"
                              />
                              <small className="muted med-form-helper">
                                Opcional. Escríbelo sin separadores de miles.
                              </small>
                            </div>
                          </div>
                          <div className="input-group">
                            <label className="input-label">Boleta o comprobante</label>
                            <input
                              className="input-field"
                              type="file"
                              accept=".pdf,image/*"
                              onChange={(e) => setFormPurchaseReceiptFile(e.target.files?.[0] || null)}
                            />
                            <small className="muted med-form-helper">
                              Puedes subir una foto o un PDF y quedará guardado junto con la compra.
                            </small>
                            {formPurchaseReceiptFile ? (
                              <div className="med-purchase-file-chip">{formPurchaseReceiptFile.name}</div>
                            ) : null}
                          </div>
                          <div className="input-group">
                            <label className="input-label">Observación de la compra</label>
                            <textarea
                              className="textarea-field"
                              rows="3"
                              value={formPurchaseNotes}
                              onChange={(e) => setFormPurchaseNotes(e.target.value)}
                              placeholder="Ej: Se compró en farmacia de turno."
                            />
                            <small className="muted med-form-helper">
                              Este registro es independiente de “Marcar como comprado” para la reposición familiar.
                            </small>
                          </div>
                        </>
                      ) : null}
                    </div>

                    <div className="med-refill-settings">
                      <div className="med-refill-settings-head">
                        <div>
                          <h4>Reposición familiar</h4>
                          <p>
                            Klinip puede avisar quién debe comprar este medicamento cuando esté por acabarse.
                          </p>
                        </div>
                        <label className="med-refill-toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(form.refill_enabled)}
                            disabled={!familyRefillAvailable}
                            onChange={(e) =>
                              setForm((current) => ({
                                ...current,
                                refill_enabled: e.target.checked,
                                refill_participant_user_ids:
                                  e.target.checked && (!current.refill_participant_user_ids || !current.refill_participant_user_ids.length)
                                    ? familyRefillOptions.map((item) => item.id)
                                    : current.refill_participant_user_ids,
                                refill_fixed_user_id:
                                  e.target.checked &&
                                  current.refill_mode === "fijo" &&
                                  !current.refill_fixed_user_id &&
                                  familyRefillOptions[0]
                                    ? familyRefillOptions[0].id
                                    : current.refill_fixed_user_id,
                              }))
                            }
                          />
                          <span>Activar</span>
                        </label>
                      </div>
                      {familyRefillAvailable && form.refill_enabled ? (
                        <>
                          <div className="form-row">
                            <div className="input-group">
                              <label className="input-label">Unidades del envase</label>
                              <input
                                className="input-field"
                                type="number"
                                min="0"
                                value={form.stock_total_doses}
                                onChange={(e) =>
                                  setForm((current) => ({
                                    ...current,
                                    stock_total_doses: e.target.value,
                                  }))
                                }
                                placeholder="Ej: 30"
                              />
                              <small className="muted med-form-helper">
                                Cuántas pastillas, cápsulas o unidades trae la caja o envase nuevo.
                              </small>
                            </div>
                            <div className="input-group">
                              <label className="input-label">Avisar cuando queden</label>
                              <input
                                className="input-field"
                                type="number"
                                min="0"
                                value={form.refill_alert_threshold_doses}
                                onChange={(e) =>
                                  setForm((current) => ({
                                    ...current,
                                    refill_alert_threshold_doses: e.target.value,
                                  }))
                                }
                                placeholder="Ej: 8"
                              />
                              <small className="muted med-form-helper">
                                Puedes pensar este valor como “cuántas unidades mínimas quiero tener antes de comprar”.
                              </small>
                            </div>
                          </div>
                          <div className="form-row">
                            <div className="input-group">
                              <label className="input-label">Unidades por toma</label>
                                <input
                                  className="input-field"
                                  type="text"
                                  inputMode="decimal"
                                  enterKeyHint="done"
                                  value={form.doses_per_intake}
                                  onChange={(e) =>
                                    setForm((current) => ({
                                      ...current,
                                      doses_per_intake: sanitizeLocalizedDecimalInput(e.target.value),
                                    }))
                                  }
                                  placeholder="Ej: 1"
                                />
                              <small className="muted med-form-helper">
                                Acepta valores como 1 o 0,5 si usas media unidad.
                              </small>
                            </div>
                            <div className="input-group">
                              <label className="input-label">Tomas por día</label>
                              {frequencyIntervalHours ? (
                                <div className="med-derived-inline">
                                  <strong>{derivedFrequencyPerDay || 1}</strong>
                                  <span>Calculado automáticamente desde la frecuencia</span>
                                </div>
                              ) : (
                                <>
                                  <input
                                    className="input-field"
                                    type="text"
                                    inputMode="decimal"
                                    enterKeyHint="done"
                                    value={form.frequency_per_day}
                                    onChange={(e) =>
                                      setForm((current) => ({
                                        ...current,
                                        frequency_per_day: sanitizeLocalizedDecimalInput(e.target.value),
                                      }))
                                    }
                                    placeholder="Ej: 2"
                                  />
                                  <small className="muted med-form-helper">
                                    Úsalo solo si la frecuencia escrita no permite calcularlo sola.
                                  </small>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="med-derived-grid is-refill">
                            <div className="med-derived-card">
                              <span className="med-derived-label">Consumo estimado</span>
                              <strong>
                                {dailyUnitsEstimate > 0
                                  ? `${Number(dailyUnitsEstimate).toLocaleString("es-CL")} unidades al día`
                                  : "Completa frecuencia y unidades por toma"}
                              </strong>
                              <small>
                                {dailyUnitsEstimate > 0
                                  ? "Se usa para calcular cuántos días dura el envase."
                                  : "Klinip necesita saber cada cuánto lo tomas y cuántas unidades usas por toma."}
                              </small>
                            </div>
                            <div className="med-derived-card">
                              <span className="med-derived-label">Duración del envase</span>
                              <strong>
                                {stockCoverageDays != null
                                  ? `~${stockCoverageDays.toFixed(1)} días`
                                  : "Pendiente"}
                              </strong>
                              <small>
                                {stockCoverageDays != null
                                  ? `${stockTotalUnits} unidades en total.`
                                  : "Ingresa cuántas unidades trae el envase."}
                              </small>
                            </div>
                            <div className="med-derived-card">
                              <span className="med-derived-label">Aviso aproximado</span>
                              <strong>
                                {thresholdCoverageDays != null
                                  ? `~${thresholdCoverageDays.toFixed(1)} días antes de agotarse`
                                  : "Pendiente"}
                              </strong>
                              <small>
                                {alertThresholdUnits > 0
                                  ? `Se activará cuando queden ${alertThresholdUnits} unidades.`
                                  : "Define un umbral si quieres aviso automático."}
                              </small>
                            </div>
                          </div>
                          <div className="form-row">
                            <div className="input-group">
                              <label className="input-label">Cómo se asigna la compra</label>
                              <select
                                className="select-field"
                                value={form.refill_mode}
                                onChange={(e) =>
                                  setForm((current) => ({
                                    ...current,
                                    refill_mode: e.target.value,
                                    refill_fixed_user_id:
                                      e.target.value === "fijo"
                                        ? current.refill_fixed_user_id ||
                                          current.refill_participant_user_ids?.[0] ||
                                          ""
                                        : current.refill_fixed_user_id,
                                  }))
                                }
                              >
                                <option value="rotativo">Turno automático</option>
                                <option value="fijo">Responsable fijo</option>
                              </select>
                            </div>
                            {form.refill_mode === "fijo" && (
                              <div className="input-group">
                                <label className="input-label">Responsable fijo</label>
                                <select
                                  className="select-field"
                                  value={form.refill_fixed_user_id}
                                  onChange={(e) =>
                                    setForm((current) => ({ ...current, refill_fixed_user_id: e.target.value }))
                                  }
                                >
                                  <option value="">Selecciona responsable</option>
                                  {refillParticipantItems.map((participant) => (
                                    <option key={participant.id} value={participant.id}>
                                      {participant.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                          <div className="input-group">
                            <label className="input-label">Quiénes participan en la compra</label>
                            <div className="med-refill-participants">
                              {familyRefillOptions.map((participant) => {
                                const checked = refillParticipantIds.includes(participant.id);
                                const currentIndex = refillParticipantIds.indexOf(participant.id);
                                return (
                                  <div
                                    key={participant.id}
                                    className={`med-refill-participant ${checked ? "is-selected" : ""} ${
                                      draggedParticipantId === participant.id ? "is-dragging" : ""
                                    }`}
                                    draggable={checked && form.refill_mode === "rotativo"}
                                    onDragStart={() => handleParticipantDragStart(participant.id)}
                                    onDragEnd={() => setDraggedParticipantId("")}
                                    onDragOver={(event) => {
                                      if (!checked || form.refill_mode !== "rotativo") return;
                                      event.preventDefault();
                                    }}
                                    onDrop={() => handleParticipantDrop(participant.id)}
                                  >
                                    <div className="med-refill-participant-head">
                                      <label className="med-refill-participant-main">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => toggleRefillParticipant(participant.id)}
                                        />
                                        <span className="med-refill-participant-copy">
                                          <strong>{participant.name}</strong>
                                          <small>
                                            {checked
                                              ? "Participa en esta compra"
                                              : "No participa en esta compra"}
                                          </small>
                                        </span>
                                      </label>
                                      {checked ? (
                                        <span className="med-refill-order-badge">
                                          #{currentIndex + 1}
                                        </span>
                                      ) : null}
                                    </div>
                                    {checked && form.refill_mode === "rotativo" ? (
                                      <div className="med-refill-reorder-tools">
                                        <div className="med-refill-order-actions">
                                          <button
                                            type="button"
                                            className="secondary-btn"
                                            onClick={() => moveRefillParticipant(participant.id, "up")}
                                            disabled={currentIndex <= 0}
                                          >
                                            Subir
                                          </button>
                                          <button
                                            type="button"
                                            className="secondary-btn"
                                            onClick={() => moveRefillParticipant(participant.id, "down")}
                                            disabled={currentIndex === refillParticipantIds.length - 1}
                                          >
                                            Bajar
                                          </button>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          <small className="muted med-form-helper">
                              Marca solo a quienes participan. Si el turno es rotativo, usa Subir y Bajar para cambiar el orden.
                          </small>
                          </div>
                          <p className="med-refill-helper">
                            {form.refill_mode === "fijo"
                              ? `La compra quedará siempre asignada a ${refillParticipantItems.find((item) => item.id === form.refill_fixed_user_id)?.name || "la persona seleccionada"}${activeProfile?.name ? ` para ${activeProfile.name}` : ""}.`
                              : refillParticipantItems.length
                                ? `El próximo turno seguirá este orden${activeProfile?.name ? ` para ${activeProfile.name}` : ""}: ${refillParticipantItems.map((item) => item.name).join(", ")}.`
                                : `Selecciona al menos una persona para activar la rotación${activeProfile?.name ? ` de ${activeProfile.name}` : ""}.`}
                          </p>
                        </>
                      ) : !familyRefillAvailable ? (
                        <p className="med-refill-helper">
                          Esta automatización aparece cuando el perfil tiene colaboración familiar y al menos un colaborador aceptado.
                        </p>
                      ) : null}
                    </div>
                  </section>
                )}
              </div>

              <div className="floating-actions">
                <button className="primary-btn" type="submit" disabled={loading}>
                  {loading ? "Guardando..." : form.id ? "Actualizar" : "Agregar"}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={handleCloseForm}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      , document.getElementById("overlay-root") || document.body)}

      <SuccessSheet
        open={!!medSuccess}
        onClose={() => setMedSuccess(null)}
        {...(medSuccess || {})}
        onPrimary={medSuccess?.targetMedication ? () => {
          const target = medSuccess?.targetMedication;
          setMedSuccess(null);
          if (target) handleOpenDetail(target);
        } : undefined}
      />

      {detailOpen && detailTarget && createPortal(
        <div className="modal-backdrop" onClick={handleCloseDetail}>
          <div className="modal-card detail-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="detail-modal-header">
              <h3>Detalle del medicamento</h3>
              <button className="detail-close-btn" type="button" onClick={handleCloseDetail} aria-label="Cerrar">
                ×
              </button>
            </div>
            <div className="detail-modal-content">
              <div className="detail-highlight">
                <span className="detail-chip detail-chip-type medicamento">
                  {detailTarget.name || "Medicamento"}
                </span>
                {(() => {
                  const finishReason = getMedicationFinishReason(detailTarget);
                  const finished = Boolean(finishReason);
                  const label = finished ? "Finalizado" : "Activo";
                  return (
                    <span className={`detail-chip detail-chip-status ${finished ? "realizada" : "pendiente"}`}>
                      {label}
                    </span>
                  );
                })()}
              </div>
              <div className="detail-grid">
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>💊</span>
                  <div>
                    <span className="detail-label">Dosis</span>
                    <p>{detailTarget.dose || "Sin dosis"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>⏱️</span>
                  <div>
                    <span className="detail-label">Frecuencia</span>
                    <p>{detailTarget.frequency || "Sin frecuencia"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>🗓️</span>
                  <div>
                    <span className="detail-label">Primera dosis</span>
                    <p>{toLocaleDateTimeOrEmpty(detailTarget.schedule_anchor_at || detailTarget.start_at || detailTarget.created_at) || "Sin inicio definido"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>🕒</span>
                  <div>
                    <span className="detail-label">Horarios estimados</span>
                    <p>{getMedicationScheduleSummary(detailTarget) || "Sin horario"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>⏭️</span>
                  <div>
                    <span className="detail-label">Próxima dosis</span>
                    <p>{(() => {
                      const nextDose = getNextMedicationDose(detailTarget);
                      return nextDose ? formatMedicationDateTime(nextDose) : "Sin próxima dosis";
                    })()}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>📆</span>
                  <div>
                    <span className="detail-label">Duración</span>
                    <p>{detailTarget.duration || "Sin duración"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>🏁</span>
                  <div>
                    <span className="detail-label">Última toma estimada</span>
                    <p>
                      {(() => {
                        const effectiveEnd = getMedicationEffectiveEndAt(detailTarget);
                        return effectiveEnd ? formatMedicationDateTime(effectiveEnd) : "Sin término";
                      })()}
                    </p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>📦</span>
                  <div>
                    <span className="detail-label">Stock restante</span>
                    <p>
                      {detailTarget.remaining_doses != null
                        ? `${detailTarget.remaining_doses} dosis${detailTarget.days_remaining != null ? ` (~${Math.ceil(detailTarget.days_remaining)} días)` : ""}`
                        : "Sin stock configurado"}
                      {detailTarget.refill_enabled && detailTarget.refill_status && (
                        <span className={`med-refill-status-badge is-${detailTarget.refill_status} ml-1`}>
                          {detailTarget.refill_status === "critical" ? " · Crítico" : detailTarget.refill_status === "alert" ? " · Alerta" : ""}
                        </span>
                      )}
                    </p>
                    {detailTarget.refill_enabled && detailTarget.stock_total_doses > 0 && detailTarget.remaining_doses != null && (
                      <div className="med-stock-bar-wrap">
                        <div
                          className={`med-stock-bar-fill is-${detailTarget.refill_status || "normal"}`}
                          style={{ width: `${Math.min(100, Math.round((detailTarget.remaining_doses / detailTarget.stock_total_doses) * 100))}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>👥</span>
                  <div>
                    <span className="detail-label">Responsable actual</span>
                    <p>
                      {detailTarget.refill_current_assignee_name || "Sin responsable asignado"}
                      {detailTarget.refill_mode !== "fijo" && detailTarget.refill_next_assignee_name &&
                       detailTarget.refill_next_assignee_name !== detailTarget.refill_current_assignee_name
                        ? ` · Próximo: ${detailTarget.refill_next_assignee_name}` : ""}
                    </p>
                    {canEditActiveProfile && detailTarget.refill_enabled && (
                      <button
                        type="button"
                        className="med-mark-purchased-btn"
                        onClick={() => { handleMarkPurchased(detailTarget); }}
                      >
                        Marcar como comprado
                      </button>
                    )}
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>🧾</span>
                  <div>
                    <span className="detail-label">Compras recientes</span>
                    {detailPurchases.length ? (
                      <div className="med-purchase-inline-list">
                        {detailPurchases.map((purchase) => (
                          <div key={purchase.id} className="med-purchase-inline-item">
                            <strong>{formatMedicationDateTime(purchase.purchased_at || purchase.created_at)}</strong>
                            <span>
                              {purchase.purchased_by_name_snapshot || "Sin registro"}
                              {purchase.amount_total != null
                                ? ` · ${formatPurchaseAmount(purchase.amount_total, purchase.currency)}`
                                : ""}
                            </span>
                            {purchase.has_receipt ? (
                              <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => handleOpenPurchaseReceipt(purchase)}
                              >
                                Ver boleta
                              </button>
                            ) : (
                              <small>Sin boleta adjunta</small>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>Aún no hay compras registradas para este medicamento.</p>
                    )}
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>📝</span>
                  <div>
                    <span className="detail-label">Notas</span>
                    <p>{detailTarget.notes || "Sin notas"}</p>
                  </div>
                </div>
              </div>
              <div className="medication-intake-timeline">
                <div className={`med-detail-dose-summary ${detailDoseContext?.kind === "upcoming" ? "is-up-to-date" : ""}`}>
                  <div>
                    <span className="med-detail-dose-summary-label">Qué corresponde ahora</span>
                    <h4>
                      {detailDoseContext?.headline || "Sin un horario claro todavía"}
                    </h4>
                    <p>{detailDoseContext?.helper || "Completa la frecuencia y el inicio para ordenar las tomas."}</p>
                  </div>
                  <div className="med-detail-dose-summary-side">
                    <span>{detailDoseProgress}</span>
                    {canEditActiveProfile && detailPendingBackfill > 0 ? (
                      <button
                        type="button"
                        className="med-backfill-btn"
                        onClick={() => handleBackfillIntakes(detailTarget)}
                      >
                        ¿Las tomaste? Registrar {detailPendingBackfill}{" "}
                        {detailPendingBackfill === 1 ? "dosis pasada" : "dosis pasadas"} sin registro
                      </button>
                    ) : null}
                    {canEditActiveProfile && !isMedicationFinished(detailTarget) ? (
                      <button
                        type="button"
                        className={`${detailDoseContext?.kind === "upcoming" ? "secondary-btn" : "primary-btn"} med-detail-dose-summary-btn`}
                        onClick={() =>
                          handleRecordIntake(detailTarget, {
                            source: "manual_detail",
                            scheduledAt: detailDoseContext?.actionableAt || null,
                            confirmMessage: detailDoseContext?.confirmMessage || "",
                          })
                        }
                      >
                        {detailDoseContext?.actionLabel || "Registrar una toma manual"}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="medication-intake-timeline-head">
                  <div>
                    <h4>Historial de tomas</h4>
                    <p>Cada tarjeta separa la hora programada de la hora en que la toma quedó confirmada.</p>
                  </div>
                  <span className="medication-intake-timeline-count">
                    {(detailIntakeStats?.total ?? detailIntakes.length)} eventos
                  </span>
                </div>
                {detailIntakeStats && detailIntakeStats.total > 0 ? (
                  <div className="medication-intake-stats-row">
                    <span className="medication-intake-stat status-taken">
                      {detailIntakeStats.taken} {detailIntakeStats.taken === 1 ? "tomada" : "tomadas"}
                    </span>
                    {detailIntakeStats.missed > 0 ? (
                      <span className="medication-intake-stat status-missed">
                        {detailIntakeStats.missed} no {detailIntakeStats.missed === 1 ? "tomada" : "tomadas"}
                      </span>
                    ) : null}
                    {detailIntakeStats.skipped > 0 ? (
                      <span className="medication-intake-stat status-skipped">
                        {detailIntakeStats.skipped} {detailIntakeStats.skipped === 1 ? "omitida" : "omitidas"}
                      </span>
                    ) : null}
                    {detailIntakeStats.total > detailIntakes.length ? (
                      <span className="medication-intake-stat is-muted">
                        Mostrando los últimos {detailIntakes.length}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {detailIntakesLoading ? (
                  <div className="medication-intake-empty">Cargando eventos...</div>
                ) : detailIntakes.length ? (
                  <div className="medication-intake-list">
                    {detailIntakes.map((item) => {
                      const normalizedStatus = String(item.status || "taken").toLowerCase();
                      const scheduledLabel = item.scheduled_at ? formatIntakeEventDateTime(item.scheduled_at) : "";
                      const hasConfirmedDose = normalizedStatus === "taken" || normalizedStatus === "late";
                      const takenLabel =
                        hasConfirmedDose && item.taken_at ? formatIntakeEventDateTime(item.taken_at) : "";
                      const fallbackLabel = item.created_at ? formatIntakeEventDateTime(item.created_at) : "";
                      const intakeNote = getIntakeNoteLabel(item);
                      return (
                        <article key={item.id} className="medication-intake-item">
                          <div className={`medication-intake-dot status-${normalizedStatus}`} aria-hidden />
                          <div className="medication-intake-copy">
                            <div className="medication-intake-top">
                              <strong>{getIntakeHeadline(item)}</strong>
                              <span className={`medication-intake-status-chip status-${normalizedStatus}`}>
                                {getIntakeStatusLabel(item.status)}
                              </span>
                            </div>
                            <div className="medication-intake-moments">
                              {scheduledLabel ? (
                                <div className="medication-intake-moment">
                                  <span className="medication-intake-moment-label">Programada para</span>
                                  <strong>{formatIntakeEventDate(item.scheduled_at)}</strong>
                                  <span>{formatIntakeEventTime(item.scheduled_at)}</span>
                                </div>
                              ) : null}
                              {takenLabel ? (
                                <div className="medication-intake-moment">
                                  <span className="medication-intake-moment-label">Confirmada el</span>
                                  <strong>{formatIntakeEventDate(item.taken_at)}</strong>
                                  <span>{formatIntakeEventTime(item.taken_at)}</span>
                                </div>
                              ) : fallbackLabel ? (
                                <div className="medication-intake-moment">
                                  <span className="medication-intake-moment-label">
                                    {normalizedStatus === "missed"
                                      ? "Detectada el"
                                      : normalizedStatus === "skipped"
                                      ? "Marcada el"
                                      : "Registrada el"}
                                  </span>
                                  <strong>{formatIntakeEventDate(item.created_at)}</strong>
                                  <span>{formatIntakeEventTime(item.created_at)}</span>
                                </div>
                              ) : null}
                            </div>
                            <div className="medication-intake-meta">
                              <span>Origen: {getIntakeSourceLabel(item.source)}</span>
                              {scheduledLabel && takenLabel && item.scheduled_at !== item.taken_at ? (
                                <span>Programación y confirmación quedaron en horas distintas.</span>
                              ) : null}
                            </div>
                            {getIntakeStatusSummary(item) ? (
                              <div className="medication-intake-summary">
                                {getIntakeStatusSummary(item)}
                              </div>
                            ) : null}
                            {intakeNote ? <p>{intakeNote}</p> : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="medication-intake-empty">
                    Aún no hay dosis registradas para este medicamento.
                  </div>
                )}
              </div>
            </div>
            <div className="modal-actions med-detail-actions">
              {canEditActiveProfile ? (
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => {
                    handleEdit(detailTarget);
                    handleCloseDetail();
                  }}
                >
                  Editar
                </button>
              ) : null}
              {canEditActiveProfile && isMedicationFinished(detailTarget) ? (
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => {
                    handleRenewMedication(detailTarget).finally(handleCloseDetail);
                  }}
                >
                  Renovar tratamiento
                </button>
              ) : null}
              {canEditActiveProfile && !isMedicationFinished(detailTarget) ? (
                <button
                  className="secondary-btn danger"
                  type="button"
                  onClick={() => {
                    handleCompleteMedication(detailTarget).finally(handleCloseDetail);
                  }}
                >
                  Finalizar tratamiento
                </button>
              ) : null}
            </div>
          </div>
        </div>
      , document.getElementById("overlay-root") || document.body)}

      {recentlyFinishedMeds.length > 0 ? (
        <div className="card medications-surface-free med-finished-banner">
          <div className="med-finished-banner-head">
            <div>
              <h3 className="card-title" style={{ marginBottom: 4 }}>
                Tratamientos recién finalizados
              </h3>
              <p className="muted" style={{ margin: 0 }}>
                {recentlyFinishedMeds.length === 1
                  ? "Un tratamiento llegó a su fecha de término. Decide qué hacer con él."
                  : `${recentlyFinishedMeds.length} tratamientos llegaron a su fecha de término. Decide qué hacer con ellos.`}
              </p>
            </div>
            <button
              type="button"
              className="med-finished-banner-dismiss"
              aria-label="Ocultar este aviso"
              title="Ocultar por ahora"
              onClick={() => dismissFinishedBanner(recentlyFinishedMeds.map((m) => m.id))}
            >
              Ocultar
            </button>
          </div>
          <ul className="med-finished-banner-list">
            {recentlyFinishedMeds.map((med) => {
              const endAt = getMedicationEffectiveEndAt(med);
              return (
                <li key={`finished-${med.id}`} className="med-finished-banner-item">
                  <div className="med-finished-banner-info">
                    <strong>{med.name || "Medicamento"}</strong>
                    <span className="muted">
                      {med.dose ? `${med.dose} · ` : ""}
                      Terminó {endAt ? formatMedicationDateTime(endAt) : "recientemente"}
                    </span>
                  </div>
                  {canEditActiveProfile ? (
                    <div className="med-finished-banner-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => handleRenewMedication(med)}
                      >
                        Renovar
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => handleCloseFinishedMedication(med)}
                      >
                        Cerrar
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="card medications-surface-free medications-filters-card">
        <h3 className="card-title">Filtros</h3>
        <div className="form-row medications-filters-row" style={{ marginBottom: "0.35rem" }}>
          <div className="input-group">
            <label className="input-label">Búsqueda</label>
            <input
              className="input-field medications-filter-field"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, dosis o notas"
            />
          </div>
          <div className="input-group">
            <label className="input-label">Estado</label>
            <select
              className="select-field medications-filter-field"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="completed">Finalizados</option>
              <option value="scheduled">Con horario</option>
            </select>
          </div>
        </div>
      </div>

      {routeReminderMedication ? (
        <div className="card med-route-reminder-card" role="status" aria-live="polite">
          <div className="med-route-reminder-kicker">Recordatorio activo</div>
          <div className="med-route-reminder-head">
            <div>
              <h3>Te corresponde esta dosis</h3>
              <p className="med-route-reminder-name">{routeReminderMedication.name}</p>
            </div>
            <span className="med-route-reminder-time">
              {formatMedicationTime(
                routeReminderTrigger ||
                  getNextMedicationDose(routeReminderMedication) ||
                  routeReminderMedication.start_at ||
                  routeReminderMedication.schedule_time
              )}
            </span>
          </div>
          <div className="med-route-reminder-grid">
            <div className="med-route-reminder-item">
              <span>Dosis</span>
              <strong>{routeReminderMedication.dose || "Sin dosis definida"}</strong>
            </div>
            <div className="med-route-reminder-item">
              <span>Frecuencia</span>
              <strong>{routeReminderMedication.frequency || "Sin frecuencia definida"}</strong>
            </div>
            <div className="med-route-reminder-item">
              <span>Registro</span>
              <strong>
                {getDoseProgressLabel(
                  routeReminderMedication.taken_doses,
                  getMedicationPlannedDoses(routeReminderMedication)
                )}
              </strong>
            </div>
          </div>
          <p className="med-route-reminder-copy">
            Si ya la tomaste, registrala. Si aun no, puedes dejarla pendiente o marcar que no la tomaste.
          </p>
          <div className="med-route-reminder-actions">
            {canEditActiveProfile ? (
              <>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={handleTakeRouteReminder}
                  disabled={notifyActionLoading}
                >
                  {notifyActionLoading ? "Registrando..." : "Ya la tome"}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={handleSkipRouteReminder}
                  disabled={notifyActionLoading}
                >
                  No la tome
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="secondary-btn ghost"
              onClick={handleOpenRouteReminderDetail}
            >
              Ver detalle
            </button>
            <button
              type="button"
              className="secondary-btn ghost"
              onClick={dismissRouteReminder}
            >
              Ahora no
            </button>
          </div>
        </div>
      ) : null}

      <div className="card medications-surface-free medications-list-card">
        {meds.length === 0 ? (
          <p className="muted">Aún no has registrado medicamentos.</p>
        ) : filteredMeds.length === 0 ? (
          <p className="muted">No hay medicamentos que coincidan con los filtros.</p>
        ) : (
          <>
            <div className="appointments-table-shell" style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Dosis</th>
                    <th>Frecuencia</th>
                    <th>Inicio</th>
                    <th>Próxima dosis</th>
                    <th>Duración</th>
                    <th>Estado</th>
                    <th>Término</th>
                    <th>Tomas</th>
                    <th>Adherencia</th>
                    <th>Reposición</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedMeds.map((m) => {
                    const nextDose = getNextMedicationDose(m);
                    const taken = Number(m.taken_doses || 0);
                    const expected = Number(m.expected_doses || 0);
                    const apiRate = Number(m.adherence_rate);
                    const adherenceText = Number.isFinite(apiRate)
                      ? `${Math.max(0, Math.min(100, Math.round(apiRate)))}%`
                      : expected > 0
                      ? `${Math.round((taken / expected) * 100)}%`
                      : "0%";
                    const finishReason = getMedicationFinishReason(m);
                    const finished = Boolean(finishReason);
                    const statusLabel = finished ? "Finalizado" : "Activo";
                    return (
                      <tr
                        key={m.id}
                        data-medication-id={m.id}
                        className={`table-row-clickable ${finished ? "is-finished" : ""} ${
                          routeReminderMedication && String(routeReminderMedication.id) === String(m.id)
                            ? "is-focused-reminder"
                            : ""
                        }`}
                        onClick={() => handleOpenDetail(m)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleOpenDetail(m);
                          }
                        }}
                      >
                        <td>{m.name}</td>
                        <td>{m.dose}</td>
                        <td>{m.frequency}</td>
                        <td>{formatMedicationDateTime(m.start_at || m.created_at)}</td>
                        <td>{finished ? "—" : (nextDose ? formatMedicationDateTime(nextDose) : "Sin próxima dosis")}</td>
                        <td>{m.duration}</td>
                        <td>
                          <span className={`med-status-chip is-${finishReason || "active"}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td>
                          {(() => {
                            const effectiveEnd = getMedicationEffectiveEndAt(m);
                            return effectiveEnd ? formatMedicationDateTime(effectiveEnd) : "—";
                          })()}
                        </td>
                        <td>
                          {(m.taken_doses || 0)}/{getMedicationPlannedDoses(m)}
                        </td>
                        <td>{adherenceText}</td>
                        <td>
                          {m.refill_enabled ? (
                            <div className="med-refill-table-cell">
                              <div className="med-refill-table-top">
                                <span className={`med-refill-status-badge is-${m.refill_status || "normal"}`}>
                                  {m.refill_status === "critical" ? "Crítico" : m.refill_status === "alert" ? "Alerta" : "Normal"}
                                </span>
                                <strong>{m.remaining_doses ?? "—"} dosis</strong>
                              </div>
                              {m.stock_total_doses > 0 && m.remaining_doses != null && (
                                <div className="med-stock-bar-wrap">
                                  <div
                                    className={`med-stock-bar-fill is-${m.refill_status || "normal"}`}
                                    style={{ width: `${Math.min(100, Math.round((m.remaining_doses / m.stock_total_doses) * 100))}%` }}
                                  />
                                </div>
                              )}
                              <span>
                                {m.refill_current_assignee_name || "Sin asignar"}
                                {m.days_remaining != null ? ` · ~${Math.ceil(m.days_remaining)}d` : ""}
                              </span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          {canEditActiveProfile ? (
                            <RowActionsMenu
                              items={[
                                {
                                  key: "edit",
                                  label: "Editar",
                                  onClick: () => handleEdit(m),
                                },
                                !finished
                                  ? {
                                      key: "complete",
                                      label: "Finalizar tratamiento",
                                      danger: true,
                                      onClick: () => handleCompleteMedication(m),
                                    }
                                  : null,
                                finished
                                  ? {
                                      key: "renew",
                                      label: "Renovar tratamiento",
                                      onClick: () => handleRenewMedication(m),
                                    }
                                  : null,
                                m.refill_enabled
                                  ? {
                                      key: "purchased",
                                      label: "Marcar como comprado",
                                      onClick: () => handleMarkPurchased(m),
                                    }
                                  : null,
                                {
                                  key: "delete",
                                  label: "Eliminar",
                                  danger: true,
                                  onClick: () => handleDelete(m),
                                },
                              ]}
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="records-mobile-list medications-mobile-list">
              {paginatedMeds.map((m) => {
                const doseContext = getMedicationDoseContext(m);
                const nextDose = getNextMedicationDose(m);
                const taken = Number(m.taken_doses || 0);
                const expected = Number(m.expected_doses || 0);
                const apiRate = Number(m.adherence_rate);
                const adherenceText = Number.isFinite(apiRate)
                  ? `${Math.max(0, Math.min(100, Math.round(apiRate)))}%`
                  : expected > 0
                  ? `${Math.round((taken / expected) * 100)}%`
                  : "0%";
                const finishReason = getMedicationFinishReason(m);
                const finished = Boolean(finishReason);
                const statusLabel = finished ? "Finalizado" : "Activo";
                return (
                  <article
                    key={`mobile-${m.id}`}
                    data-medication-id={m.id}
                    className={`records-mobile-card medications-mobile-card ${finished ? "is-finished" : ""} ${
                      routeReminderMedication && String(routeReminderMedication.id) === String(m.id)
                        ? "is-focused-reminder"
                        : ""
                    }`}
                    onClick={() => handleOpenDetail(m)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleOpenDetail(m);
                      }
                    }}
                  >
                    <div className="records-mobile-head">
                      <div className="records-mobile-head-main">
                        <span className="records-mobile-icon-badge is-medication">M</span>
                        <div className="records-mobile-title-group">
                          <strong>{m.name}</strong>
                          <span>{m.dose || "Sin dosis"} · {m.frequency || "Sin frecuencia"}</span>
                        </div>
                      </div>
                      <div className="records-mobile-head-side">
                        <span className={`chip med-status-chip is-${finishReason || "active"}`}>
                          {statusLabel}
                        </span>
                        {canEditActiveProfile ? (
                          <div onClick={(event) => event.stopPropagation()}>
                            <RowActionsMenu
                              items={[
                                {
                                  key: "edit",
                                  label: "Editar",
                                  onClick: () => handleEdit(m),
                                },
                                !finished
                                  ? {
                                      key: "complete",
                                      label: "Finalizar tratamiento",
                                      danger: true,
                                      onClick: () => handleCompleteMedication(m),
                                    }
                                  : null,
                                finished
                                  ? {
                                      key: "renew",
                                      label: "Renovar tratamiento",
                                      onClick: () => handleRenewMedication(m),
                                    }
                                  : null,
                                {
                                  key: "delete",
                                  label: "Eliminar",
                                  danger: true,
                                  onClick: () => handleDelete(m),
                                },
                              ]}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className={`medications-mobile-next-dose ${!finished && doseContext.kind === "upcoming" ? "is-up-to-date" : ""}`}>
                      <span className="medications-mobile-next-label">Qué corresponde ahora</span>
                      <strong>
                        {finished
                          ? "Tratamiento finalizado"
                          : doseContext.headline}
                      </strong>
                      <p>
                        {finished
                          ? "Este tratamiento ya no requiere nuevas tomas."
                          : doseContext.helper}
                      </p>
                    </div>

                    <div className="records-mobile-meta-grid">
                      <div className="records-mobile-meta-item">
                        <span className="records-mobile-meta-label">Registro</span>
                        <span>{getDoseProgressLabel(taken, getMedicationPlannedDoses(m))}</span>
                      </div>
                      <div className="records-mobile-meta-item">
                        <span className="records-mobile-meta-label">Adherencia</span>
                        <span>{adherenceText} de cumplimiento</span>
                      </div>
                      <div className="records-mobile-meta-item">
                        <span className="records-mobile-meta-label">Inicio</span>
                        <span>{formatMedicationDateTime(m.schedule_anchor_at || m.start_at || m.created_at)}</span>
                      </div>
                      <div className="records-mobile-meta-item">
                        <span className="records-mobile-meta-label">Horario habitual</span>
                        <span>
                          {nextDose
                            ? formatMedicationTime(nextDose)
                            : formatMedicationTime(m.schedule_anchor_at || m.start_at || m.schedule_time)}
                        </span>
                      </div>
                    </div>

                    {m.refill_enabled ? (
                      <div className="med-refill-mobile-block">
                        <div className="med-refill-mobile-row">
                          <span className={`med-refill-status-badge is-${m.refill_status || "normal"}`}>
                            {m.refill_status === "critical" ? "Crítico" : m.refill_status === "alert" ? "Alerta" : "Normal"}
                          </span>
                          <span className="med-refill-mobile-meta">
                            {m.remaining_doses != null ? `${m.remaining_doses} dosis` : "Sin stock"}
                            {m.days_remaining != null ? ` · ~${Math.ceil(m.days_remaining)} días` : ""}
                          </span>
                        </div>
                        {m.stock_total_doses > 0 && m.remaining_doses != null && (
                          <div className="med-stock-bar-wrap">
                            <div
                              className={`med-stock-bar-fill is-${m.refill_status || "normal"}`}
                              style={{ width: `${Math.min(100, Math.round((m.remaining_doses / m.stock_total_doses) * 100))}%` }}
                            />
                          </div>
                        )}
                        <span className="med-refill-assignee-line">
                          Responsable: {m.refill_current_assignee_name || "Sin asignar"}
                          {m.refill_mode !== "fijo" && m.refill_next_assignee_name && m.refill_next_assignee_name !== m.refill_current_assignee_name
                            ? ` · Próximo: ${m.refill_next_assignee_name}` : ""}
                        </span>
                        {canEditActiveProfile && (m.refill_status === "alert" || m.refill_status === "critical") && (
                          <button
                            type="button"
                            className="med-mark-purchased-btn"
                            onClick={(event) => { event.stopPropagation(); handleMarkPurchased(m); }}
                          >
                            Marcar como comprado
                          </button>
                        )}
                      </div>
                    ) : null}

                    <div className="records-mobile-footer">
                      {!finished && canEditActiveProfile ? (
                        <button
                          type="button"
                          className={`${doseContext.kind === "upcoming" ? "secondary-btn" : "primary-btn"} medications-mobile-primary-action`}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRecordIntake(m, {
                              source: "manual_card",
                              scheduledAt: doseContext.actionableAt || null,
                              confirmMessage: doseContext.confirmMessage || "",
                            });
                          }}
                        >
                          {doseContext.actionLabel}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="records-mobile-link"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpenDetail(m);
                        }}
                      >
                        Más detalle
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="medications-list-footer">
              <span className="medications-list-progress" aria-live="polite">
                {visibleMedicationCount}/{filteredMeds.length}
              </span>
              <div className="medications-pagination">
                <button
                  type="button"
                  className="medications-pagination-btn"
                  onClick={() => setMedicationsPage((current) => Math.max(1, current - 1))}
                  disabled={safeMedicationPage <= 1}
                  aria-label="Ver medicamentos anteriores"
                >
                  ←
                </button>
                <span className="medications-pagination-status">
                  Página {safeMedicationPage} de {totalMedicationPages}
                </span>
                <button
                  type="button"
                  className="medications-pagination-btn"
                  onClick={() =>
                    setMedicationsPage((current) =>
                      Math.min(totalMedicationPages, current + 1)
                    )
                  }
                  disabled={safeMedicationPage >= totalMedicationPages}
                  aria-label="Ver más medicamentos"
                >
                  →
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card medications-surface-free medications-purchases-card">
        <div className="med-purchase-head">
          <div>
            <h3 className="card-title">Compras y boletas</h3>
            <p className="med-refill-helper">
              Aquí queda el historial de quién compró cada medicamento y su comprobante.
            </p>
          </div>
          <span className="med-purchase-count">
            {filteredPurchases.length} registro{filteredPurchases.length === 1 ? "" : "s"}
          </span>
        </div>

        {purchaseHistoryLoading ? (
          <p className="muted">Cargando historial de compras...</p>
        ) : filteredPurchases.length === 0 ? (
          <div className="med-purchase-empty">
            <strong>Aún no hay compras registradas.</strong>
            <span>
              Cuando registres una compra en el formulario o alguien marque un medicamento como comprado, la boleta y el detalle aparecerán aquí.
            </span>
          </div>
        ) : (
          <>
            <div className="appointments-table-shell" style={{ overflowX: "auto" }}>
              <table className="table med-purchase-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Medicamento</th>
                    <th>Compró</th>
                    <th>Turno asignado</th>
                    <th>Monto</th>
                    <th>Stock</th>
                    <th>Boleta</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPurchases.map((purchase) => (
                    <tr key={`purchase-${purchase.id}`}>
                      <td>{formatMedicationDateTime(purchase.purchased_at || purchase.created_at)}</td>
                      <td>
                        <div className="med-purchase-medication-cell">
                          <strong>{purchase.medication_name_snapshot || "Medicamento"}</strong>
                          <span>{purchase.dose_snapshot || "Sin dosis"}</span>
                        </div>
                      </td>
                      <td>{purchase.purchased_by_name_snapshot || "Sin registro"}</td>
                      <td>{purchase.assigned_name_snapshot || "Sin asignar"}</td>
                      <td>
                        {purchase.amount_total != null
                          ? formatPurchaseAmount(purchase.amount_total, purchase.currency)
                          : "No informado"}
                      </td>
                      <td>{purchase.new_stock_total_doses || 0} dosis</td>
                      <td>
                        {purchase.has_receipt ? (
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => handleOpenPurchaseReceipt(purchase)}
                          >
                            Ver boleta
                          </button>
                        ) : (
                          <span className="med-purchase-muted">Sin boleta</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="records-mobile-list medications-mobile-list">
              {filteredPurchases.map((purchase) => (
                <article key={`purchase-mobile-${purchase.id}`} className="records-mobile-card med-purchase-mobile-card">
                  <div className="records-mobile-head">
                    <div className="records-mobile-head-main">
                      <span className="records-mobile-icon-badge is-medication">B</span>
                      <div className="records-mobile-title-group">
                        <strong>{purchase.medication_name_snapshot || "Medicamento"}</strong>
                        <span>{formatMedicationDateTime(purchase.purchased_at || purchase.created_at)}</span>
                      </div>
                    </div>
                    <span className={`chip ${purchase.has_receipt ? "document" : "pending"}`}>
                      {purchase.has_receipt ? "Con boleta" : "Sin boleta"}
                    </span>
                  </div>
                  <div className="records-mobile-meta-grid">
                    <div className="records-mobile-meta-item">
                      <span className="records-mobile-meta-label">Compró</span>
                      <span>{purchase.purchased_by_name_snapshot || "Sin registro"}</span>
                    </div>
                    <div className="records-mobile-meta-item">
                      <span className="records-mobile-meta-label">Turno</span>
                      <span>{purchase.assigned_name_snapshot || "Sin asignar"}</span>
                    </div>
                    <div className="records-mobile-meta-item">
                      <span className="records-mobile-meta-label">Monto</span>
                      <span>
                        {purchase.amount_total != null
                          ? formatPurchaseAmount(purchase.amount_total, purchase.currency)
                          : "No informado"}
                      </span>
                    </div>
                    <div className="records-mobile-meta-item">
                      <span className="records-mobile-meta-label">Stock cargado</span>
                      <span>{purchase.new_stock_total_doses || 0} dosis</span>
                    </div>
                  </div>
                  {purchase.notes ? <div className="records-mobile-note">{purchase.notes}</div> : null}
                  <div className="records-mobile-footer">
                    {purchase.has_receipt ? (
                      <button
                        type="button"
                        className="records-mobile-link"
                        onClick={() => handleOpenPurchaseReceipt(purchase)}
                      >
                        Abrir boleta
                      </button>
                    ) : (
                      <span className="med-purchase-muted">Sin boleta adjunta</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      {purchaseOpen && purchaseTarget && (
        <div className="modal-overlay" onClick={resetPurchaseModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Registrar compra del medicamento</h3>
              <button className="modal-close" onClick={resetPurchaseModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="med-purchase-summary">
                <strong>{purchaseTarget.name}</strong>
                <span>{purchaseTarget.dose || "Sin dosis"} · {purchaseTarget.frequency || "Sin frecuencia"}</span>
                <small>
                  Responsable actual: {purchaseTarget.refill_current_assignee_name || "Sin asignar"}
                  {purchaseTarget.refill_next_assignee_name
                    ? ` · Próximo turno: ${purchaseTarget.refill_next_assignee_name}`
                    : ""}
                </small>
              </div>
              <div className="med-purchase-grid">
                <div className="input-group">
                  <label className="input-label">Quién compró</label>
                  <select
                    className="select-field"
                    value={purchaseBuyerUserId}
                    onChange={(e) => setPurchaseBuyerUserId(e.target.value)}
                  >
                    <option value="">Selecciona persona</option>
                    {purchaseActorOptions.map((person) => (
                      <option key={`purchase-modal-${person.id}`} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                  <p className="med-refill-helper">
                    Este nombre quedará guardado como la persona que realmente hizo la compra.
                  </p>
                </div>
                <div className="input-group">
                  <label className="input-label">Nuevo stock total</label>
                  <input
                    className="input-field"
                    type="number"
                    min="0"
                    value={purchaseNewStock}
                    onChange={(e) => setPurchaseNewStock(e.target.value)}
                    placeholder={`Actual: ${purchaseTarget.stock_total_doses || 0}`}
                    autoFocus
                  />
                  <p className="med-refill-helper">Escribe cuántas dosis quedan disponibles después de la compra.</p>
                </div>
                <div className="input-group">
                  <label className="input-label">Monto pagado</label>
                  <input
                    className="input-field"
                    type="text"
                    inputMode="decimal"
                    value={purchaseAmount}
                    onChange={(e) => setPurchaseAmount(e.target.value)}
                    placeholder="Ej: 5490"
                  />
                  <p className="med-refill-helper">Opcional. Escríbelo sin separadores de miles, por ejemplo 5490.</p>
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">Boleta o comprobante</label>
                <input
                  className="input-field"
                  type="file"
                  accept=".pdf,image/*"
                  onChange={(e) => setPurchaseReceiptFile(e.target.files?.[0] || null)}
                />
                <p className="med-refill-helper">
                  Puedes subir una imagen o PDF. El comprobante quedará visible para los involucrados.
                </p>
                {purchaseReceiptFile ? (
                  <div className="med-purchase-file-chip">{purchaseReceiptFile.name}</div>
                ) : null}
              </div>
              <div className="input-group">
                <label className="input-label">Observación</label>
                <textarea
                  className="input-field"
                  rows="3"
                  value={purchaseNotes}
                  onChange={(e) => setPurchaseNotes(e.target.value)}
                  placeholder="Ej: Se compró en farmacia de turno."
                />
                <p className="med-refill-helper">
                  El próximo ciclo seguirá con{" "}
                  <strong>{purchaseTarget.refill_next_assignee_name || purchaseTarget.refill_current_assignee_name || "el siguiente en rotación"}</strong>.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="primary-btn"
                onClick={handleConfirmPurchase}
                disabled={purchaseLoading}
              >
                {purchaseLoading ? "Guardando..." : "Confirmar compra"}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={resetPurchaseModal}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
