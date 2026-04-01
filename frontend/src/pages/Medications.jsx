import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  deleteMedication,
  getActiveHealthProfile,
  getMyPlan,
  getMedicationIntakes,
  getMedications,
  getProfileCaregivers,
  isAuthSessionError,
  markMedicationRefillPurchased,
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
import RowActionsMenu from "../components/RowActionsMenu";
import { notifyClinicalDataChanged } from "../utils/clinicalRefresh";
import { canWriteProfile, isViewerProfile } from "../utils/profileAccess";

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

function getNewestMedicationRank(item) {
  const createdAt = parseDate(item?.created_at);
  if (createdAt) return createdAt.getTime();
  const updatedAt = parseDate(item?.updated_at);
  if (updatedAt) return updatedAt.getTime();
  const startAt = parseDate(item?.start_at);
  if (startAt) return startAt.getTime();
  return Number(item?.id || 0);
}

function parseScheduleTimeValue(value) {
  if (!value || typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function deriveFrequencyIntervalHours(frequencyText = "") {
  const text = String(frequencyText || "").toLowerCase();
  const match = text.match(/cada\s+(\d{1,2})\s+hora/);
  if (match) {
    const hours = Number(match[1]);
    if ([4, 6, 8, 12, 24].includes(hours)) return hours;
  }
  if (text.includes("24") && text.includes("hora")) return 24;
  if ((text.includes("12") && text.includes("hora")) || text.includes("2 veces")) return 12;
  if ((text.includes("8") && text.includes("hora")) || text.includes("3 veces")) return 8;
  if ((text.includes("6") && text.includes("hora")) || text.includes("4 veces")) return 6;
  return null;
}

function parseDurationDays(value = "") {
  const text = String(value || "").toLowerCase().trim();
  const daysMatch = text.match(/(\d+)\s*d[ií]a/);
  if (daysMatch) return Number(daysMatch[1]);
  const weeksMatch = text.match(/(\d+)\s*semana/);
  if (weeksMatch) return Number(weeksMatch[1]) * 7;
  return null;
}

function getMedicationStartAt(med) {
  return parseDate(med?.start_at || med?.created_at || null);
}

function getMedicationEndAt(med) {
  const explicitEnd = parseDate(med?.end_date);
  if (explicitEnd) {
    explicitEnd.setHours(23, 59, 59, 999);
    return explicitEnd;
  }
  const startAt = getMedicationStartAt(med);
  const durationDays = parseDurationDays(med?.duration || "");
  if (!startAt || !durationDays) return null;
  return new Date(startAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
}

function buildMedicationPromptEventsBetween(med, windowStart, windowEnd) {
  const startAt = getMedicationStartAt(med) || new Date(windowStart);
  const effectiveStart = new Date(Math.max(startAt.getTime(), windowStart.getTime()));
  const effectiveEnd = new Date(windowEnd);
  const endAt = getMedicationEndAt(med);
  if (endAt && endAt.getTime() < effectiveEnd.getTime()) {
    effectiveEnd.setTime(endAt.getTime());
  }
  if (effectiveEnd.getTime() < effectiveStart.getTime()) return [];

  const intervalHours = deriveFrequencyIntervalHours(med?.frequency || "");
  if (intervalHours) {
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const events = [];
    let current = new Date(startAt);
    if (current.getTime() < effectiveStart.getTime()) {
      const jumpSteps = Math.floor((effectiveStart.getTime() - current.getTime()) / intervalMs);
      current = new Date(current.getTime() + jumpSteps * intervalMs);
      while (current.getTime() < effectiveStart.getTime()) {
        current = new Date(current.getTime() + intervalMs);
      }
    }
    while (current.getTime() <= effectiveEnd.getTime()) {
      events.push(new Date(current));
      current = new Date(current.getTime() + intervalMs);
    }
    return events;
  }

  const fixedSlot = parseScheduleTimeValue(med?.schedule_time || "") || {
    hour: startAt.getHours(),
    minute: startAt.getMinutes(),
  };
  const current = new Date(effectiveStart);
  current.setHours(fixedSlot.hour, fixedSlot.minute, 0, 0);
  if (current.getTime() < effectiveStart.getTime()) {
    current.setDate(current.getDate() + 1);
  }
  const events = [];
  while (current.getTime() <= effectiveEnd.getTime()) {
    events.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return events;
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

function getNextMedicationDose(med, now = new Date()) {
  if (!med || med.completed) return null;
  const events = buildMedicationPromptEventsBetween(
    med,
    now,
    new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000)
  );
  return events.find((item) => item.getTime() >= now.getTime()) || null;
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

function isMedicationActiveToday(med, now) {
  if (med?.completed) return false;
  const startAt = getMedicationStartAt(med);
  if (startAt && now.getTime() < startAt.getTime()) return false;
  const endAt = getMedicationEndAt(med);
  if (!endAt) return true;
  return now.getTime() <= endAt.getTime();
}

function formatAlertDay(date) {
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(date);
}

export default function Medications() {
  const location = useLocation();
  const navigate = useNavigate();
  const [meds, setMeds] = useState([]);
  const [planInfo, setPlanInfo] = useState(null);
  const [activeProfile, setActiveProfile] = useState(null);
  const [familyCaregivers, setFamilyCaregivers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);
  const [detailIntakes, setDetailIntakes] = useState([]);
  const [detailIntakesLoading, setDetailIntakesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notifyQueue, setNotifyQueue] = useState([]);
  const [notifyPromptKey, setNotifyPromptKey] = useState("");
  const [notifyTriggeredAt, setNotifyTriggeredAt] = useState(null);
  const [notifyActionLoading, setNotifyActionLoading] = useState(false);
  const [missingFrequency, setMissingFrequency] = useState(null);
  const [intakeFeedback, setIntakeFeedback] = useState("");
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
    doses_per_intake: "1",
    frequency_per_day: "1",
    stock_total_doses: "",
    refill_alert_threshold_doses: "",
  });
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseTarget, setPurchaseTarget] = useState(null);
  const [purchaseNewStock, setPurchaseNewStock] = useState("");
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [showAdvancedForm, setShowAdvancedForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const canEditActiveProfile = canWriteProfile(activeProfile);
  const isReadOnlyProfile = isViewerProfile(activeProfile);

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
      const [plan, profile] = await Promise.all([
        getMyPlan(),
        getActiveHealthProfile(),
      ]);
      setPlanInfo(plan || null);
      setActiveProfile(profile || null);
      if (plan?.collaboration_enabled && profile?.id) {
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
      setPlanInfo(null);
      setActiveProfile(null);
      setFamilyCaregivers([]);
    }
  };

  const loadDetailIntakeItems = async (medicationId) => {
    if (!medicationId) {
      setDetailIntakes([]);
      setDetailIntakesLoading(false);
      return;
    }
    setDetailIntakesLoading(true);
    try {
      const response = await getMedicationIntakes(medicationId, 60);
      setDetailIntakes(Array.isArray(response?.items) ? response.items : []);
    } catch (error) {
      console.error("No se pudo cargar la línea de tiempo de adherencia", error);
      setDetailIntakes([]);
    } finally {
      setDetailIntakesLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadFamilyContext();
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) {
        clearTimeout(feedbackTimer.current);
      }
    };
  }, []);

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
    if (!location.search) return;
    const params = new URLSearchParams(location.search);
    const notify = params.get("notify") === "1";
    const notifyId = params.get("medicationId");
    const triggerParam = params.get("trigger");
    if (!notify || !notifyId) return;
    const target = meds.find((m) => String(m.id) === String(notifyId));
    if (!target) return;
    const trigger = triggerParam ? new Date(Number(triggerParam)) : new Date();
    const key = buildDosePromptKey(target, trigger);
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, "prompted");
    }
    setNotifyQueue((prev) => {
      if (prev.some((item) => item.key === key)) return prev;
      return [...prev, { med: target, key, triggeredAt: trigger }];
    });
    navigate("/medications", { replace: true });
  }, [location.search, meds, navigate]);

  useEffect(() => {
    if (!detailOpen || !detailTarget?.id) {
      setDetailIntakes([]);
      setDetailIntakesLoading(false);
      return;
    }
    loadDetailIntakeItems(detailTarget.id);
  }, [detailOpen, detailTarget?.id]);

  useEffect(() => {
    const checkDueMedicationPrompt = () => {
      const now = new Date();
      const lastCheckedAt = doseCheckRef.current;
      const nowTs = now.getTime();

      const dueMeds = [];
      (meds || []).forEach((med) => {
        if (!isMedicationActiveToday(med, now)) return;
        buildMedicationPromptEventsBetween(
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
    setLoading(true);
    try {
      // Preparar datos: convertir strings vacíos a null y document_id a número o null
      const payload = {
        name: form.name,
        dose: form.dose || "",
        frequency: form.frequency || "",
        duration: form.duration || "",
        start_at: toIsoOrNull(form.start_at),
        schedule_time: form.schedule_time || "",
        completed: Boolean(form.completed),
        end_date: toIsoOrNull(form.end_date),
        notes: form.notes || "",
        document_id: form.document_id ? parseInt(form.document_id) : null,
        refill_enabled:
          Boolean(form.refill_enabled) &&
          Boolean(planInfo?.collaboration_enabled) &&
          familyCaregivers.length > 0,
        refill_mode: form.refill_mode || "rotativo",
        refill_fixed_user_id: form.refill_fixed_user_id ? parseInt(form.refill_fixed_user_id, 10) : null,
        doses_per_intake: Math.max(parseFloat(form.doses_per_intake) || 1.0, 0.01),
        frequency_per_day: Math.max(parseFloat(form.frequency_per_day) || 1.0, 0.01),
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

      await saveMedication(payload);
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
      await load();
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["medications", "health-radar", "adherence"],
      });
      resetForm();
      setShowForm(false);
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
      start_at: toLocalInputValue(med.start_at || med.created_at || ""),
      schedule_time: med.schedule_time || "",
      completed: Boolean(med.completed),
      end_date: med.end_date ? med.end_date.slice(0, 10) : "",
      notes: med.notes || "",
      document_id: med.document_id || "",
      refill_enabled: Boolean(med.refill_enabled),
      refill_mode: med.refill_mode || "rotativo",
      refill_fixed_user_id: med.refill_fixed_user_id ? String(med.refill_fixed_user_id) : "",
      doses_per_intake: med.doses_per_intake != null ? String(med.doses_per_intake) : "1",
      frequency_per_day: med.frequency_per_day != null ? String(med.frequency_per_day) : "1",
      stock_total_doses:
        med.stock_total_doses || med.stock_total_doses === 0
          ? String(med.stock_total_doses)
          : "",
      refill_alert_threshold_doses:
        med.refill_alert_threshold_doses || med.refill_alert_threshold_doses === 0
          ? String(med.refill_alert_threshold_doses)
          : "",
    });
  };

  const handleMarkPurchased = (med) => {
    setPurchaseTarget(med);
    setPurchaseNewStock(String(med.stock_total_doses || ""));
    setPurchaseOpen(true);
  };

  const handleConfirmPurchase = async () => {
    if (!purchaseTarget) return;
    setPurchaseLoading(true);
    try {
      await markMedicationRefillPurchased(purchaseTarget.id, parseInt(purchaseNewStock, 10) || 0);
      await load();
      notifyClinicalDataChanged({ profileId: activeProfile?.id, sources: ["medications"] });
      setPurchaseOpen(false);
      setPurchaseTarget(null);
      setPurchaseNewStock("");
    } catch (err) {
      alert("No se pudo registrar la compra: " + (err.response?.data?.detail || err.message));
    } finally {
      setPurchaseLoading(false);
    }
  };

  const handleRecordIntake = async (med) => {
    if (!canEditActiveProfile) {
      alert("Este perfil está en modo solo lectura. No puedes registrar tomas.");
      return;
    }
    try {
      await recordMedicationIntake(med.id, { status: "taken", source: "manual" });
      await refreshMedicationStateAfterIntake(
        `info:Toma registrada: ${med.name}`,
        `info:Toma registrada: ${med.name}. Actualiza la lista si no ves el cambio.`
      );
    } catch (err) {
      console.error(err);
      alert(
        "No se pudo marcar como realizado: " +
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
    refreshFailureMessage
  ) => {
    notifyMedicationDataChanged();
    try {
      await load();
      showTimedIntakeFeedback(successMessage);
    } catch (error) {
      console.error("No se pudo refrescar la lista de medicamentos", error);
      showTimedIntakeFeedback(refreshFailureMessage || successMessage);
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
    setDetailIntakesLoading(false);
  };

  const closeNotifyModal = () => {
    if (notifyActionLoading) return;
    if (notifyPromptKey) {
      localStorage.setItem(notifyPromptKey, "skipped");
    }
    notifyQueue.forEach((item) => {
      if (item.key) {
        localStorage.setItem(item.key, "skipped");
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
      await recordTakenFromReminder(notifyTarget, "reminder_prompt", notifyTriggeredAt);
      if (notifyPromptKey) {
        localStorage.setItem(notifyPromptKey, "taken");
      }
      resetReminderPromptState();
      navigate("/medications", { replace: true });
      await refreshMedicationStateAfterIntake(
        `success:Toma registrada: ${notifyTarget.name}`,
        `info:Toma registrada: ${notifyTarget.name}. Actualiza la lista si no ves el cambio.`
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
      for (const item of batch) {
        await recordTakenFromReminder(item.med, "reminder_batch", item.triggeredAt);
        if (item.key) {
          localStorage.setItem(item.key, "taken");
        }
      }
      setNotifyQueue([]);
      resetReminderPromptState();
      navigate("/medications", { replace: true });
      await refreshMedicationStateAfterIntake(
        `success:Tomas registradas: ${batch.length}`,
        "info:Las tomas quedaron registradas. Actualiza la lista si no ves el cambio."
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

  const handleDelete = async (med) => {
    if (!canEditActiveProfile) {
      alert("Este perfil está en modo solo lectura. No puedes eliminar medicamentos.");
      return;
    }
    if (!window.confirm("¿Eliminar este medicamento?")) return;
    try {
      await deleteMedication(med.id);
      await load();
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["medications", "health-radar", "adherence"],
      });
    } catch (err) {
      console.error(err);
      alert("No se pudo eliminar");
    }
  };

  const medsMissingFrequency = (meds || []).filter(
    (m) => !m.frequency || m.frequency.trim() === ""
  );
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
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && !med.completed) ||
      (statusFilter === "completed" && Boolean(med.completed)) ||
      (statusFilter === "scheduled" && Boolean(med.schedule_time));
    return matchesSearch && matchesStatus;
  });
  const familyRefillAvailable =
    Boolean(planInfo?.collaboration_enabled) && familyCaregivers.length > 0;
  const familyRefillNames = familyCaregivers
    .map((item) => item?.user_name || item?.user_email || "")
    .filter(Boolean)
    .slice(0, 4);
  const frequencyValue = String(form.frequency || "").trim();
  const durationValue = String(form.duration || "").trim();
  const medicationPreviewName = String(form.name || "").trim() || "Medicamento";
  const medicationPreviewDose = String(form.dose || "").trim();
  const medicationStartPreview = toLocaleDateTimeOrEmpty(form.start_at) || "";
  const remindersReady = Boolean(frequencyValue && form.start_at);

  const formatTimelineStamp = (value) => {
    if (!value) return "Sin fecha";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Sin fecha";
    return new Intl.DateTimeFormat("es-CL", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(parsed);
  };

  const getIntakeStatusLabel = (status) => {
    const normalized = String(status || "taken").toLowerCase();
    if (normalized === "late") return "Tomado tarde";
    if (normalized === "missed") return "No registrado";
    if (normalized === "skipped") return "Omitido";
    return "Tomado";
  };

  const handleTimelineStatusUpdate = async (item, nextStatus) => {
    if (!canEditActiveProfile || !detailTarget?.id) return;
    try {
      await recordMedicationIntake(detailTarget.id, {
        status: nextStatus,
        source: "timeline_update",
        scheduled_at: item.scheduled_at || item.taken_at || item.created_at || new Date().toISOString(),
        notes:
          nextStatus === "late"
            ? "Actualizado desde la línea de tiempo como tomado tarde."
            : "Actualizado desde la línea de tiempo como omitido.",
      });
      await Promise.all([load(), loadDetailIntakeItems(detailTarget.id)]);
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["medications", "health-radar", "adherence"],
      });
      setIntakeFeedback(
        nextStatus === "late"
          ? "success:Evento actualizado como tomado tarde."
          : "info:Evento actualizado como omitido."
      );
      if (feedbackTimer.current) {
        clearTimeout(feedbackTimer.current);
      }
      feedbackTimer.current = setTimeout(() => {
        setIntakeFeedback("");
      }, 2600);
    } catch (error) {
      console.error(error);
      alert("No se pudo actualizar el evento de adherencia.");
    }
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
                  : `Registrar todos como tomados (${notifyQueue.length + 1})`}
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
              {canEditActiveProfile ? (
                <div className="med-dose-alert-actions">
                  <button
                    className="med-dose-btn"
                    type="button"
                    onClick={handleSkipFromAlert}
                    disabled={notifyActionLoading}
                  >
                    Omitir
                  </button>
                  <button
                    className="med-dose-btn is-primary"
                    type="button"
                    onClick={handleTakenFromAlert}
                    disabled={notifyActionLoading}
                  >
                    {notifyActionLoading ? "Registrando..." : "Tomado"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {canEditActiveProfile && missingFrequency && !showForm && (
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
      )}

      {showForm && canEditActiveProfile && (
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
                  Primero completa nombre, dosis, frecuencia y primera toma. El resto queda como opcional.
                </p>
              </div>
              <button className="secondary-btn" type="button" onClick={handleCloseForm}>
                Cerrar
              </button>
            </div>
            <form onSubmit={handleSubmit}>
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
                    <label className="input-label">Frecuencia</label>
                    <input
                      className="input-field"
                      value={form.frequency}
                      onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                      placeholder="Ej: Cada 8 horas"
                    />
                    <small className="muted med-form-helper">
                      Puedes escribir la indicación tal como aparece en la receta o elegir una opción rápida.
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
                      <label className="input-label">Primera toma</label>
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
                              (current.schedule_time || !nextStartAt)
                                ? current.schedule_time
                                : nextStartAt.slice(11, 16),
                          }));
                        }}
                      />
                      <small className="muted med-form-helper">
                        Si indicas frecuencia, esta fecha y hora se usa como punto de partida para los recordatorios.
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
                    <strong>{medicationPreviewName}{medicationPreviewDose ? ` · ${medicationPreviewDose}` : ""}</strong>
                    <span>{frequencyValue ? `Frecuencia: ${frequencyValue}` : "Aún no indicas la frecuencia."}</span>
                    <span>{medicationStartPreview ? `Primera toma: ${medicationStartPreview}` : "Falta indicar la primera toma."}</span>
                  </div>
                </section>

                <button
                  type="button"
                  className="med-form-advanced-toggle"
                  onClick={() => setShowAdvancedForm((current) => !current)}
                  aria-expanded={showAdvancedForm}
                >
                  {showAdvancedForm ? "Ocultar opciones opcionales" : "Ver opciones opcionales"}
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
                          onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                        />
                      </div>
                      <div className="input-group">
                        <label className="input-label">Hora base</label>
                        <input
                          className="input-field"
                          type="time"
                          value={form.schedule_time}
                          onChange={(e) => setForm({ ...form, schedule_time: e.target.value })}
                        />
                        <small className="muted med-form-helper">
                          Si no la cambias, se usa la hora de la primera toma.
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
                          <h4>Reposición familiar</h4>
                          <p>
                            Sirve para avisar quién debe comprar el medicamento cuando quede poco stock.
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
                              <label className="input-label">Dosis del envase</label>
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
                            </div>
                          </div>
                          <div className="form-row">
                            <div className="input-group">
                              <label className="input-label">Dosis por toma</label>
                              <input
                                className="input-field"
                                type="number"
                                min="0.01"
                                step="0.5"
                                value={form.doses_per_intake}
                                onChange={(e) =>
                                  setForm((current) => ({ ...current, doses_per_intake: e.target.value }))
                                }
                                placeholder="Ej: 1"
                              />
                            </div>
                            <div className="input-group">
                              <label className="input-label">Tomas por día</label>
                              <input
                                className="input-field"
                                type="number"
                                min="0.01"
                                step="0.5"
                                value={form.frequency_per_day}
                                onChange={(e) =>
                                  setForm((current) => ({ ...current, frequency_per_day: e.target.value }))
                                }
                                placeholder="Ej: 2"
                              />
                            </div>
                          </div>
                          <div className="form-row">
                            <div className="input-group">
                              <label className="input-label">Modo de asignación</label>
                              <select
                                className="select-field"
                                value={form.refill_mode}
                                onChange={(e) =>
                                  setForm((current) => ({ ...current, refill_mode: e.target.value }))
                                }
                              >
                                <option value="rotativo">Rotativo (turno automático)</option>
                                <option value="fijo">Fijo (siempre la misma persona)</option>
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
                                  {familyCaregivers.map((c) => (
                                    <option key={c.user_id} value={String(c.user_id)}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                          <p className="med-refill-helper">
                            {form.refill_mode === "fijo"
                              ? `Responsable fijo para el perfil activo${activeProfile?.name ? ` (${activeProfile.name})` : ""}.`
                              : `Rotación automática para el perfil activo${activeProfile?.name ? ` (${activeProfile.name})` : ""} entre: ${familyRefillNames.join(", ")}.`}
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
      )}

      {detailOpen && detailTarget && (
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
                <span className={`detail-chip detail-chip-status ${detailTarget.completed ? "realizada" : "pendiente"}`}>
                  {detailTarget.completed ? "Realizado" : "Activo"}
                </span>
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
                    <p>{toLocaleDateTimeOrEmpty(detailTarget.start_at || detailTarget.created_at) || "Sin inicio definido"}</p>
                  </div>
                </div>
                <div className="detail-field">
                  <span className="detail-item-icon" aria-hidden>🕒</span>
                  <div>
                    <span className="detail-label">Horario base</span>
                    <p>{detailTarget.schedule_time || "Sin horario"}</p>
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
                    <span className="detail-label">Fecha término</span>
                    <p>{detailTarget.end_date ? toLocaleDateOrEmpty(detailTarget.end_date) : "Sin término"}</p>
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
                  <span className="detail-item-icon" aria-hidden>📝</span>
                  <div>
                    <span className="detail-label">Notas</span>
                    <p>{detailTarget.notes || "Sin notas"}</p>
                  </div>
                </div>
              </div>
              <div className="medication-intake-timeline">
                <div className="medication-intake-timeline-head">
                  <div>
                    <h4>Línea de tiempo de adherencia</h4>
                    <p>Eventos reales registrados para este medicamento.</p>
                  </div>
                  <span className="medication-intake-timeline-count">
                    {detailIntakes.length} eventos
                  </span>
                </div>
                {detailIntakesLoading ? (
                  <div className="medication-intake-empty">Cargando eventos...</div>
                ) : detailIntakes.length ? (
                  <div className="medication-intake-list">
                    {detailIntakes.map((item) => {
                      const normalizedStatus = String(item.status || "taken").toLowerCase();
                      const primaryStamp = item.scheduled_at || item.taken_at || item.created_at;
                      return (
                        <article key={item.id} className="medication-intake-item">
                          <div className={`medication-intake-dot status-${normalizedStatus}`} aria-hidden />
                          <div className="medication-intake-copy">
                            <div className="medication-intake-row">
                              <strong>{getIntakeStatusLabel(item.status)}</strong>
                              <span>{formatTimelineStamp(primaryStamp)}</span>
                            </div>
                            <div className="medication-intake-meta">
                              <span>Fuente: {item.source || "manual"}</span>
                              {item.taken_at && item.scheduled_at ? (
                                <span>Registrado: {formatTimelineStamp(item.taken_at)}</span>
                              ) : null}
                            </div>
                            {item.notes ? <p>{item.notes}</p> : null}
                            {canEditActiveProfile ? (
                              <div className="medication-intake-actions">
                                <button
                                  type="button"
                                  className="secondary-btn"
                                  onClick={() => handleTimelineStatusUpdate(item, "late")}
                                  disabled={normalizedStatus === "late"}
                                >
                                  Tomado tarde
                                </button>
                                <button
                                  type="button"
                                  className="secondary-btn"
                                  onClick={() => handleTimelineStatusUpdate(item, "skipped")}
                                  disabled={normalizedStatus === "skipped"}
                                >
                                  Omitido
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="medication-intake-empty">
                    Todavía no hay eventos explícitos de adherencia para este medicamento.
                  </div>
                )}
              </div>
            </div>
            <div className="modal-actions">
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
              {canEditActiveProfile && !detailTarget.completed ? (
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => {
                    handleRecordIntake(detailTarget).finally(handleCloseDetail);
                  }}
                >
                  Marcar toma
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

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
              <option value="completed">Realizados</option>
              <option value="scheduled">Con horario</option>
            </select>
          </div>
        </div>
      </div>

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
                  {filteredMeds.map((m) => {
                    const nextDose = getNextMedicationDose(m);
                    const taken = Number(m.taken_doses || 0);
                    const expected = Number(m.expected_doses || 0);
                    const apiRate = Number(m.adherence_rate);
                    const adherenceText = Number.isFinite(apiRate)
                      ? `${Math.max(0, Math.min(100, Math.round(apiRate)))}%`
                      : expected > 0
                      ? `${Math.round((taken / expected) * 100)}%`
                      : "0%";
                    return (
                      <tr
                        key={m.id}
                        className="table-row-clickable"
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
                        <td>{nextDose ? formatMedicationDateTime(nextDose) : "Sin próxima dosis"}</td>
                        <td>{m.duration}</td>
                        <td>{m.completed ? "Realizado" : "Activo"}</td>
                        <td>{m.end_date ? toLocaleDateOrEmpty(m.end_date) : "—"}</td>
                        <td>
                          {(m.taken_doses || 0)}/{(m.expected_doses || 0)}
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
              {filteredMeds.map((m) => {
                const nextDose = getNextMedicationDose(m);
                const taken = Number(m.taken_doses || 0);
                const expected = Number(m.expected_doses || 0);
                const apiRate = Number(m.adherence_rate);
                const adherenceText = Number.isFinite(apiRate)
                  ? `${Math.max(0, Math.min(100, Math.round(apiRate)))}%`
                  : expected > 0
                  ? `${Math.round((taken / expected) * 100)}%`
                  : "0%";
                return (
                  <article
                    key={`mobile-${m.id}`}
                    className="records-mobile-card medications-mobile-card"
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
                        <span className={`chip ${m.completed ? "completed" : "medication"}`}>
                          {m.completed ? "Realizado" : "Activo"}
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

                    <div className="records-mobile-meta-grid">
                      <div className="records-mobile-meta-item">
                        <span className="records-mobile-meta-label">Próxima dosis</span>
                        <span>{nextDose ? formatMedicationDateTime(nextDose) : "Sin próxima dosis"}</span>
                      </div>
                      <div className="records-mobile-meta-item">
                        <span className="records-mobile-meta-label">Adherencia</span>
                        <span>{adherenceText}</span>
                      </div>
                      <div className="records-mobile-meta-item">
                        <span className="records-mobile-meta-label">Tomas</span>
                        <span>{taken}/{expected}</span>
                      </div>
                      <div className="records-mobile-meta-item">
                        <span className="records-mobile-meta-label">Inicio</span>
                        <span>{formatMedicationDateTime(m.start_at || m.created_at)}</span>
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
          </>
        )}
      </div>

      {purchaseOpen && purchaseTarget && (
        <div className="modal-overlay" onClick={() => setPurchaseOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Marcar como comprado</h3>
              <button className="modal-close" onClick={() => setPurchaseOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="muted">
                Medicamento: <strong>{purchaseTarget.name}</strong>
              </p>
              <div className="input-group">
                <label className="input-label">Nuevo total de dosis del envase</label>
                <input
                  className="input-field"
                  type="number"
                  min="0"
                  value={purchaseNewStock}
                  onChange={(e) => setPurchaseNewStock(e.target.value)}
                  placeholder={`Actual: ${purchaseTarget.stock_total_doses || 0}`}
                  autoFocus
                />
                <p className="med-refill-helper">
                  Ingresa la cantidad de dosis del nuevo envase. El responsable del próximo ciclo será{" "}
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
                onClick={() => setPurchaseOpen(false)}
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
