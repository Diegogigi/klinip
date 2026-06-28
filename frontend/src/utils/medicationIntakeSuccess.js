import { cleanUiText } from "./textEncoding";

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeMedicationIntakeStatus(status) {
  const normalized = String(status || "taken").trim().toLowerCase();
  if (normalized === "late") return "late";
  if (normalized === "missed") return "missed";
  if (normalized === "skipped") return "skipped";
  return "taken";
}

export function getMedicationIntakeStatusLabel(status) {
  const normalized = normalizeMedicationIntakeStatus(status);
  if (normalized === "late") return "Tomada fuera de horario";
  if (normalized === "missed") return "Pendiente de confirmar";
  if (normalized === "skipped") return "No tomada";
  return "Tomada";
}

export function formatMedicationIntakeSuccessDateTime(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin horario";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function buildMedicationCreateSuccess({ medication, profileLabel }) {
  return {
    kicker: "Medicamento agregado",
    title: "Todo listo",
    copy: "El medicamento quedo registrado y ya forma parte de tu seguimiento clinico.",
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
        label: "Dosis y frecuencia",
        value: cleanUiText(
          [medication?.dose, medication?.frequency].filter(Boolean).join(" - ") || "Por confirmar",
        ),
      },
    ],
    primaryLabel: "Ver detalle",
    secondaryLabel: "Volver a medicamentos",
    targetMedication: medication || null,
  };
}

export function buildMedicationIntakeSuccess({
  intake,
  medication,
  profileLabel,
  count = 1,
}) {
  const normalizedStatus = normalizeMedicationIntakeStatus(intake?.status);
  const isLate = normalizedStatus === "late";
  const takenAt = intake?.taken_at || intake?.created_at || null;
  const scheduledAt = intake?.scheduled_at || null;

  if (count > 1) {
    return {
      kicker: "Tomas guardadas",
      title: `${count} dosis confirmadas`,
      copy: "Las dosis quedaron confirmadas y desde este momento cuentan para tu adherencia.",
      rows: [
        {
          icon: "profile",
          label: "Perfil activo",
          value: cleanUiText(profileLabel || "Mi perfil"),
        },
        {
          icon: "pill",
          label: "Dosis registradas",
          value: `${count} confirmadas`,
        },
        {
          icon: "clock",
          label: "Ultima confirmacion",
          value: formatMedicationIntakeSuccessDateTime(takenAt),
        },
      ],
      secondaryLabel: "Seguir revisando",
    };
  }

  const rows = [
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
      icon: "doc",
      label: "Estado",
      value: getMedicationIntakeStatusLabel(normalizedStatus),
    },
  ];

  if (scheduledAt) {
    rows.push({
      icon: "calendar",
      label: "Hora esperada",
      value: formatMedicationIntakeSuccessDateTime(scheduledAt),
    });
  }

  rows.push({
    icon: "clock",
    label: "Confirmada",
    value: formatMedicationIntakeSuccessDateTime(takenAt),
  });

  return {
    kicker: isLate ? "Dosis guardada mas tarde" : "Dosis guardada",
    title: isLate
      ? "Se registro fuera de horario"
      : scheduledAt
      ? "Se registro a tiempo"
      : "Toma confirmada",
    copy: isLate
      ? "La dosis quedo confirmada mas tarde de lo esperado y desde este momento cuenta para tu adherencia."
      : scheduledAt
      ? "La dosis quedo confirmada dentro del horario esperado y desde este momento cuenta para tu adherencia."
      : "La dosis quedo confirmada y desde este momento cuenta para tu adherencia.",
    referenceId: intake?.id,
    rows,
    primaryLabel: medication ? "Ver detalle" : undefined,
    secondaryLabel: "Seguir revisando",
    targetMedication: medication || null,
  };
}
