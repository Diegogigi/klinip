import { parseDate } from "./dates";

const dayMs = 24 * 60 * 60 * 1000;

export function parseScheduleTimeValue(value) {
  if (!value || typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function formatScheduleSlot(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function deriveFrequencyIntervalHours(frequencyText = "") {
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

export function parseDurationDays(value = "") {
  const text = String(value || "").toLowerCase().trim();
  const daysMatch = text.match(/(\d+)\s*d[ií]a/);
  if (daysMatch) return Number(daysMatch[1]);
  const weeksMatch = text.match(/(\d+)\s*semana/);
  if (weeksMatch) return Number(weeksMatch[1]) * 7;
  return null;
}

export function deriveFrequencyPerDay(frequencyText = "", fallbackValue = null) {
  const intervalHours = deriveFrequencyIntervalHours(frequencyText);
  if (intervalHours) {
    return Number((24 / intervalHours).toFixed(2));
  }
  const fallback = Number(fallbackValue);
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return null;
}

export function getMedicationStartAt(med) {
  return parseDate(med?.start_at || med?.created_at || null);
}

export function getMedicationEffectiveEndAt(med) {
  const derivedValue = med?.effective_end_date || med?.computed_end_date || null;
  const explicitValue = med?.end_date || null;
  const explicitEnd = parseDate(derivedValue || explicitValue);
  if (explicitEnd) {
    if (
      !derivedValue &&
      typeof explicitValue === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(explicitValue.trim())
    ) {
      explicitEnd.setHours(23, 59, 59, 999);
    }
    return explicitEnd;
  }
  const startAt = getMedicationStartAt(med);
  const durationDays = parseDurationDays(med?.duration || "");
  if (!startAt || !durationDays) return null;
  const intervalHours = deriveFrequencyIntervalHours(med?.frequency || "");
  if (intervalHours) {
    const steps = Math.max(Math.ceil((durationDays * 24) / intervalHours) - 1, 0);
    return new Date(startAt.getTime() + steps * intervalHours * 60 * 60 * 1000);
  }
  return new Date(startAt.getTime() + Math.max(durationDays - 1, 0) * dayMs);
}

function normalizeScheduleSlots(values) {
  const seen = new Set();
  return values
    .filter(Boolean)
    .map((value) => parseScheduleTimeValue(String(value)))
    .filter(Boolean)
    .map((slot) => formatScheduleSlot(slot.hour, slot.minute))
    .filter((slot) => {
      if (seen.has(slot)) return false;
      seen.add(slot);
      return true;
    })
    .sort((a, b) => a.localeCompare(b));
}

export function getMedicationScheduleTimes(med) {
  if (Array.isArray(med?.computed_schedule_times) && med.computed_schedule_times.length) {
    return normalizeScheduleSlots(med.computed_schedule_times);
  }

  const startAt = getMedicationStartAt(med) || new Date();
  const baseSlot = parseScheduleTimeValue(med?.schedule_time || "") || {
    hour: startAt.getHours(),
    minute: startAt.getMinutes(),
  };
  const intervalHours = deriveFrequencyIntervalHours(med?.frequency || "");
  if (intervalHours && intervalHours < 24) {
    const slotCount = Math.max(Math.ceil(24 / intervalHours), 1);
    const baseMinutes = baseSlot.hour * 60 + baseSlot.minute;
    const slots = [];
    for (let idx = 0; idx < slotCount; idx += 1) {
      const totalMinutes = (baseMinutes + idx * intervalHours * 60) % (24 * 60);
      const hour = Math.floor(totalMinutes / 60);
      const minute = totalMinutes % 60;
      slots.push(formatScheduleSlot(hour, minute));
    }
    return normalizeScheduleSlots(slots);
  }
  return normalizeScheduleSlots([formatScheduleSlot(baseSlot.hour, baseSlot.minute)]);
}

export function getMedicationScheduleSummary(med) {
  const explicit = String(med?.computed_schedule_summary || "").trim();
  if (explicit) return explicit;
  const slots = getMedicationScheduleTimes(med);
  if (!slots.length) return "";
  if (slots.length === 1) return slots[0];
  if (slots.length === 2) return `${slots[0]} y ${slots[1]}`;
  return `${slots.slice(0, -1).join(", ")} y ${slots[slots.length - 1]}`;
}

export function buildMedicationScheduleEventsBetween(med, windowStart, windowEnd) {
  const startAt = getMedicationStartAt(med) || new Date(windowStart);
  const effectiveStart = new Date(Math.max(startAt.getTime(), windowStart.getTime()));
  const effectiveEnd = new Date(windowEnd);
  const endAt = getMedicationEffectiveEndAt(med);
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

  const baseSlot = parseScheduleTimeValue(med?.schedule_time || "") || {
    hour: startAt.getHours(),
    minute: startAt.getMinutes(),
  };
  const current = new Date(effectiveStart);
  current.setHours(baseSlot.hour, baseSlot.minute, 0, 0);
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

export function getNextMedicationDose(med, now = new Date()) {
  if (!med || med.completed) return null;
  const persistedNextDose = parseDate(med?.next_dose_at || null);
  if (persistedNextDose) {
    return persistedNextDose;
  }
  const events = buildMedicationScheduleEventsBetween(
    med,
    now,
    new Date(now.getTime() + 45 * dayMs)
  );
  return events.find((item) => item.getTime() >= now.getTime()) || null;
}

export function isMedicationActiveAt(med, now = new Date()) {
  if (med?.completed) return false;
  const startAt = getMedicationStartAt(med);
  if (startAt && now.getTime() < startAt.getTime()) return false;
  const endAt = getMedicationEffectiveEndAt(med);
  if (!endAt) return true;
  return now.getTime() <= endAt.getTime();
}

export function isMedicationFinished(med, now = new Date()) {
  if (!med) return false;
  if (med.completed) return true;
  const endAt = getMedicationEffectiveEndAt(med);
  if (!endAt) return false;
  return now.getTime() > endAt.getTime();
}

export function getMedicationFinishReason(med, now = new Date()) {
  if (!med) return null;
  if (med.completed) return "manual";
  const endAt = getMedicationEffectiveEndAt(med);
  if (endAt && now.getTime() > endAt.getTime()) return "expired";
  return null;
}
