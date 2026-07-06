import { cleanUiText } from "../../utils/textEncoding";

// Taxonomía de Klinip Cobertura (Chile), alineada con las categorías que
// clasifica el backend en document_coverage_info. Copy pensado para personas
// no técnicas: qué es cada documento y para qué sirve guardarlo.
export const COVERAGE_CATEGORIES = [
  {
    key: "bono",
    label: "Bonos",
    icon: "🎫",
    guideTitle: "Bonos de atención",
    guideWhat: "El comprobante que recibes al pagar una consulta, examen o procedimiento con tu previsión.",
    guideWhy: "Sirve para saber cuánto pagaste tú y cuánto cubrió tu plan en cada atención.",
  },
  {
    key: "reembolso",
    label: "Reembolsos",
    icon: "💵",
    guideTitle: "Reembolsos",
    guideWhat: "Cuando pagas de tu bolsillo y después pides la devolución a tu Isapre o seguro.",
    guideWhy: "Guarda la boleta y la respuesta del reembolso: así sabes qué te devolvieron y qué falta.",
  },
  {
    key: "licencia",
    label: "Licencias",
    icon: "📝",
    guideTitle: "Licencias médicas",
    guideWhat: "Licencias médicas y trámites asociados, como los del COMPIN.",
    guideWhy: "Tenerlas juntas ayuda si necesitas revisar pagos, plazos o presentar un reclamo.",
  },
  {
    key: "copago",
    label: "Copagos",
    icon: "🧾",
    guideTitle: "Copagos y cuentas",
    guideWhat: "Lo que te toca pagar a ti después de la cobertura, como cuentas de clínica u hospital.",
    guideWhy: "Permite revisar los cobros con calma y detectar diferencias a tiempo.",
  },
  {
    key: "ges_caec",
    label: "GES / CAEC",
    icon: "🛡️",
    guideTitle: "GES y CAEC",
    guideWhat: "Cartas y formularios de las garantías GES (ex AUGE) o de la cobertura catastrófica CAEC.",
    guideWhy: "Son claves para plazos y beneficios: conviene tenerlas siempre a mano.",
  },
  {
    key: "plan_seguro",
    label: "Plan y seguro",
    icon: "💳",
    guideTitle: "Plan de salud y seguros",
    guideWhat: "Tu plan de Isapre o Fonasa, cartolas, pólizas y cartas de tu seguro complementario.",
    guideWhy: "Es tu respaldo ante cambios de plan, alzas, topes o trámites con la Superintendencia.",
  },
  {
    key: "otro",
    label: "Otros",
    icon: "🗂️",
    guideTitle: "Otros documentos",
    guideWhat: "Documentos de cobertura que aún no calzan en una categoría específica.",
    guideWhy: "Igual quedan guardados y puedes revisarlos cuando los necesites.",
  },
];

// Tipos de previsión que acepta el backend (payer_type).
export const COVERAGE_PAYER_TYPES = [
  {
    value: "fonasa",
    label: "Fonasa",
    helper: "El seguro público de salud.",
  },
  {
    value: "isapre",
    label: "Isapre",
    helper: "Banmédica, Colmena, Consalud, Cruz Blanca y otras.",
  },
  {
    value: "seguro_complementario",
    label: "Seguro complementario",
    helper: "Un seguro adicional, del trabajo o contratado aparte.",
  },
  {
    value: "none",
    label: "Ninguna por ahora",
    helper: "Puedes configurarla más adelante.",
  },
];

export const COVERAGE_STATUS_OPTIONS = [
  { value: "", label: "Guardado" },
  { value: "pendiente", label: "En trámite" },
  { value: "aprobado", label: "Aprobado" },
  { value: "rechazado", label: "Rechazado" },
];

export const KNOWN_ISAPRES = [
  "Banmédica",
  "Colmena",
  "Consalud",
  "Cruz Blanca",
  "Esencial",
  "Nueva Masvida",
  "Vida Tres",
];

export function getCoverageCategory(key) {
  const normalized = String(key || "").trim().toLowerCase();
  return COVERAGE_CATEGORIES.find((category) => category.key === normalized) || null;
}

export function getPayerTypeLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const payer = COVERAGE_PAYER_TYPES.find((item) => item.value === normalized);
  if (payer) return payer.label;
  return "";
}

// Aplana la respuesta de GET /coverage/documents ({document, coverage}) en un
// solo objeto fácil de pasar a las filas de la lista.
export function flattenCoverageDocument(item) {
  const doc = item?.document || {};
  const coverage = item?.coverage || {};
  return {
    ...doc,
    coverageCategory: getCoverageCategory(coverage.category)?.key || "otro",
    coveragePayerType: String(coverage.payer_type || "").toLowerCase(),
    coverageProviderName: cleanUiText(coverage.provider_name || "", ""),
    coverageEntityName: cleanUiText(coverage.entity_name || "", ""),
    coverageEntity: cleanUiText(coverage.entity_name || coverage.provider_name || "", ""),
    coverageStatus: String(coverage.status || "").toLowerCase(),
    coverageCurrency: coverage.currency || "CLP",
    coverageAmounts: {
      total: coverage.amount_total,
      covered: coverage.amount_covered,
      patient: coverage.amount_patient,
      reimbursed: coverage.amount_reimbursed,
    },
    coverageDates: {
      issued: coverage.issued_at || null,
      service: coverage.service_at || null,
      periodStart: coverage.period_start_at || null,
      periodEnd: coverage.period_end_at || null,
      due: coverage.due_at || null,
    },
  };
}

export function getCoverageCategoryCounts(documents) {
  const counts = {};
  COVERAGE_CATEGORIES.forEach((category) => {
    counts[category.key] = 0;
  });
  (documents || []).forEach((doc) => {
    const key = doc?.coverageCategory || "otro";
    if (key in counts) counts[key] += 1;
  });
  return counts;
}

function isFilledAmount(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

export function getCoverageAmountTotals(documents) {
  const totals = {
    total: 0,
    covered: 0,
    patient: 0,
    reimbursed: 0,
    hasAnyAmount: false,
  };
  (documents || []).forEach((doc) => {
    const amounts = doc?.coverageAmounts || {};
    [
      ["total", amounts.total],
      ["covered", amounts.covered],
      ["patient", amounts.patient],
      ["reimbursed", amounts.reimbursed],
    ].forEach(([key, value]) => {
      if (!isFilledAmount(value)) return;
      totals[key] += Number(value);
      totals.hasAnyAmount = true;
    });
  });
  return totals;
}

const CLP_FORMATTER = (() => {
  try {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: "CLP",
      maximumFractionDigits: 0,
    });
  } catch (_) {
    return null;
  }
})();

export function formatCoverageAmount(value) {
  if (!isFilledAmount(value)) return "";
  const numeric = Number(value);
  if (CLP_FORMATTER) return CLP_FORMATTER.format(numeric);
  return `$${Math.round(numeric)}`;
}

// Estado del documento en palabras simples. El backend detecta aprobado,
// pendiente o rechazado a partir del texto; sin señal queda "Guardado".
export function getCoverageStatusInfo(status) {
  const key = String(status || "").trim().toLowerCase();
  if (key === "aprobado") return { label: "Aprobado", tone: "ok" };
  if (key === "pendiente") return { label: "En trámite", tone: "warn" };
  if (key === "rechazado") return { label: "Rechazado", tone: "danger" };
  return { label: "Guardado", tone: "muted" };
}
