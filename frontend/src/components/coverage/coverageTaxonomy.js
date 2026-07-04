import { cleanUiText } from "../../utils/textEncoding";
import { getDetectedInsurer } from "../../utils/coverageDocuments";

// Taxonomía de Klinip Cobertura (Chile). Cada categoría tiene copy pensado
// para personas no técnicas: qué es y para qué sirve guardarlo.
export const COVERAGE_CATEGORIES = [
  {
    key: "bono",
    label: "Bonos",
    icon: "🎫",
    guideTitle: "Bonos de atención",
    guideWhat: "El comprobante que recibes al pagar una consulta, examen o procedimiento con tu previsión.",
    guideWhy: "Sirve para saber cuánto pagaste tú y cuánto cubrió tu plan en cada atención.",
    terms: ["bono", "bonos", "bono de atencion", "bono electronico"],
  },
  {
    key: "reembolso",
    label: "Reembolsos",
    icon: "💵",
    guideTitle: "Reembolsos",
    guideWhat: "Cuando pagas de tu bolsillo y después pides la devolución a tu Isapre o seguro.",
    guideWhy: "Guarda la boleta y la respuesta del reembolso: así sabes qué te devolvieron y qué falta.",
    terms: ["reembolso", "reembolsos", "solicitud de reembolso", "excedente", "excedentes"],
  },
  {
    key: "licencia",
    label: "Licencias",
    icon: "📝",
    guideTitle: "Licencias médicas",
    guideWhat: "Licencias médicas y trámites asociados, como los del COMPIN.",
    guideWhy: "Tenerlas juntas ayuda si necesitas revisar pagos, plazos o presentar un reclamo.",
    terms: ["licencia", "licencias", "licencia medica", "compin", "subsidio de incapacidad"],
  },
  {
    key: "copago",
    label: "Copagos",
    icon: "🧾",
    guideTitle: "Copagos y cuentas",
    guideWhat: "Lo que te toca pagar a ti después de la cobertura, como cuentas de clínica u hospital.",
    guideWhy: "Permite revisar los cobros con calma y detectar diferencias a tiempo.",
    terms: ["copago", "copagos", "cuenta clinica", "cuenta hospitalaria", "presupuesto"],
  },
  {
    key: "ges",
    label: "GES / CAEC",
    icon: "🛡️",
    guideTitle: "GES y CAEC",
    guideWhat: "Cartas y formularios de las garantías GES (ex AUGE) o de la cobertura catastrófica CAEC.",
    guideWhy: "Son claves para plazos y beneficios: conviene tenerlas siempre a mano.",
    terms: ["ges", "caec", "auge", "garantias explicitas", "garantia explicita"],
  },
  {
    key: "fonasa",
    label: "Fonasa",
    icon: "🏥",
    guideTitle: "Fonasa",
    guideWhat: "Documentos de Fonasa: tu tramo, compra de bonos, programas o certificados.",
    guideWhy: "Ayudan a saber qué te cubre Fonasa y en qué red te conviene atenderte.",
    terms: ["fonasa", "tramo fonasa", "modalidad libre eleccion"],
  },
  {
    key: "isapre",
    label: "Isapre",
    icon: "💳",
    guideTitle: "Isapre",
    guideWhat: "Tu plan de salud, cartolas, cartas y respuestas de tu Isapre.",
    guideWhy: "Es tu respaldo ante cambios de plan, alzas o trámites con la Superintendencia.",
    terms: [
      "isapre",
      "cartola",
      "plan de salud",
      "banmedica",
      "colmena",
      "consalud",
      "cruz blanca",
      "vida tres",
      "nueva masvida",
      "masvida",
    ],
  },
  {
    key: "seguro",
    label: "Seguro complementario",
    icon: "➕",
    guideTitle: "Seguros complementarios",
    guideWhat: "Pólizas y reembolsos del seguro adicional, del trabajo o contratado por tu cuenta.",
    guideWhy: "Muchas devoluciones se pierden por no tener la póliza y los topes a la vista.",
    terms: [
      "seguro complementario",
      "seguro de salud",
      "poliza",
      "aseguradora",
      "metlife",
      "sura",
      "bice vida",
      "consorcio",
      "chilena consolidada",
      "zurich",
    ],
  },
];

const COVERAGE_PREF_KEY_PREFIX = "klinip_onboarding_coverage_pref_v1";

function normalizeCoverageText(value) {
  return cleanUiText(value, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Coincidencia con límites de palabra sobre texto sin acentos, para que
// términos cortos como "ges" no calcen dentro de "gestión".
function matchesTerm(text, term) {
  const normalizedTerm = normalizeCoverageText(term).trim();
  if (!normalizedTerm) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`);
  return pattern.test(text);
}

function getDocumentSearchText(doc) {
  return normalizeCoverageText(
    [doc?.filename, doc?.center, doc?.notes, doc?.doc_type].filter(Boolean).join(" ")
  );
}

export function getCoverageCategoryKeys(doc) {
  const text = getDocumentSearchText(doc);
  if (!text) return [];
  return COVERAGE_CATEGORIES.filter((category) =>
    category.terms.some((term) => matchesTerm(text, term))
  ).map((category) => category.key);
}

export function getCoverageCategory(key) {
  return COVERAGE_CATEGORIES.find((category) => category.key === key) || null;
}

export function decorateCoverageDocument(doc) {
  return {
    ...doc,
    coverageCategories: getCoverageCategoryKeys(doc),
    coverageInsurer: getDetectedInsurer(doc),
  };
}

export function getCoverageCategoryCounts(documents) {
  const counts = {};
  COVERAGE_CATEGORIES.forEach((category) => {
    counts[category.key] = 0;
  });
  (documents || []).forEach((doc) => {
    (doc?.coverageCategories || []).forEach((key) => {
      if (key in counts) counts[key] += 1;
    });
  });
  return counts;
}

// Preferencia guardada durante el onboarding ({enabled, provider}). La clave
// incluye el id de usuario, por eso se busca por prefijo.
export function readCoveragePreference() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(COVERAGE_PREF_KEY_PREFIX)) continue;
      const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch (_) {
    return null;
  }
  return null;
}
