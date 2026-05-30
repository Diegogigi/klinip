import { parseDate, toLocalInputValue } from "./dates";

export const BIOMETRIC_METRIC_CONFIG = {
  glucose: {
    label: "Glucosa",
    unit: "mg/dL",
    description: "Control de glicemia para seguimientos diarios o por examen.",
    shortLabel: "Glucosa",
    tone: "teal",
  },
  blood_pressure: {
    label: "Presión arterial",
    unit: "mmHg",
    description: "Registro de sistólica y diastólica en un mismo control.",
    shortLabel: "Presión",
    tone: "blue",
  },
  heart_rate: {
    label: "Frecuencia cardiaca",
    unit: "lpm",
    description: "Pulso o frecuencia cardiaca en reposo o actividad.",
    shortLabel: "FC",
    tone: "violet",
  },
  temperature: {
    label: "Temperatura",
    unit: "°C",
    description: "Seguimiento de temperatura corporal manual.",
    shortLabel: "Temp.",
    tone: "amber",
  },
};

export function getBiometricMetricConfig(metricType) {
  return (
    BIOMETRIC_METRIC_CONFIG[metricType] || {
      label: "Parametro",
      unit: "",
      description: "Registro biométrico",
      shortLabel: "Parámetro",
      tone: "slate",
    }
  );
}

export function getBiometricMetricLabel(metricType) {
  return getBiometricMetricConfig(metricType).label;
}

export function formatBiometricValue(readingLike, metricTypeOverride = null) {
  const metricType = metricTypeOverride || readingLike?.metric_type || "";
  const config = getBiometricMetricConfig(metricType);
  const primary = Number(readingLike?.value_primary ?? readingLike?.average_primary ?? 0);
  const secondary =
    readingLike?.value_secondary === null || readingLike?.value_secondary === undefined
      ? null
      : Number(readingLike.value_secondary);

  if (metricType === "blood_pressure") {
    if (!primary) return `-- ${config.unit}`;
    return `${Math.round(primary)}${secondary !== null ? `/${Math.round(secondary)}` : ""} ${config.unit}`;
  }
  if (metricType === "temperature") {
    if (!primary) return `-- ${config.unit}`;
    return `${primary.toFixed(1)} ${config.unit}`;
  }
  if (!primary) return `-- ${config.unit}`.trim();
  return `${Math.round(primary)} ${config.unit}`.trim();
}

export function formatBiometricMeasuredAt(value, withTime = true) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return parsed.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    ...(withTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
        }
      : {}),
  });
}

export function getBiometricTrendLabel(direction) {
  if (direction === "up") return "Al alza";
  if (direction === "down") return "A la baja";
  return "Estable";
}

export function getBiometricLatestMetric(metrics = []) {
  return [...metrics]
    .filter((item) => item?.latest_reading?.measured_at || item?.latest_reading?.created_at)
    .sort((left, right) => {
      const leftDate = parseDate(left?.latest_reading?.measured_at || left?.latest_reading?.created_at);
      const rightDate = parseDate(right?.latest_reading?.measured_at || right?.latest_reading?.created_at);
      return (rightDate?.getTime?.() || 0) - (leftDate?.getTime?.() || 0);
    })[0] || null;
}

export function buildBiometricEmptyForm(metricType = "glucose") {
  const config = getBiometricMetricConfig(metricType);
  return {
    metric_type: metricType,
    value_primary: "",
    value_secondary: "",
    unit: config.unit,
    context: "",
    notes: "",
    measured_at: toLocalInputValue(new Date()),
  };
}
