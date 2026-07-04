import { cleanUiText } from "./textEncoding";

export const COVERAGE_UPLOAD_INTENT = "coverage";
export const COVERAGE_FORM_VALUE = "cobertura";
export const COVERAGE_NOTE_MARKER = "[KLINIP_COVERAGE_INTENT]";

const COVERAGE_GROUPS = [
  {
    key: "seguro",
    label: "Seguro",
    terms: ["isapre", "fonasa", "seguro", "complementario", "cobertura", "plan de salud"],
  },
  {
    key: "reembolso",
    label: "Reembolso",
    terms: ["reembolso", "bono", "bonificacion", "bonificación", "copago", "excedente", "excedentes"],
  },
  {
    key: "ges",
    label: "GES / CAEC",
    terms: ["ges", "caec", "auge", "garantia", "garantía"],
  },
  {
    key: "licencia",
    label: "Licencia",
    terms: ["licencia", "licencia medica", "licencia médica", "compin"],
  },
  {
    key: "prestador",
    label: "Prestador",
    terms: ["clinica", "clínica", "hospital", "laboratorio", "centro medico", "centro médico"],
  },
];

const KNOWN_INSURERS = [
  "banmedica",
  "banmédica",
  "colmena",
  "consalud",
  "cruz blanca",
  "esencial",
  "fonasa",
  "isapre",
  "masvida",
  "más vida",
  "nueva masvida",
  "nueva más vida",
  "vida tres",
];

function normalizeText(value) {
  return cleanUiText(value, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getDocumentSearchText(doc) {
  return normalizeText(
    [
      doc?.filename,
      doc?.center,
      doc?.notes,
      doc?.doc_type,
      doc?.ocr_status,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function buildCoverageNotes(notes = "") {
  const cleaned = cleanUiText(notes, "").trim();
  if (cleaned.includes(COVERAGE_NOTE_MARKER)) return cleaned;
  return [cleaned, `${COVERAGE_NOTE_MARKER} Cobertura / seguro`].filter(Boolean).join("\n");
}

export function getCoverageDisplayNotes(notes = "", fallback = "") {
  const cleaned = cleanUiText(notes, "");
  const visible = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes(COVERAGE_NOTE_MARKER))
    .join("\n")
    .trim();
  return visible || fallback;
}

export function getCoverageSignals(doc) {
  const text = getDocumentSearchText(doc);
  const signals = COVERAGE_GROUPS.filter((group) =>
    group.terms.some((term) => text.includes(normalizeText(term))),
  ).map((group) => group.label);

  return Array.from(new Set(signals));
}

export function getDetectedInsurer(doc) {
  const text = getDocumentSearchText(doc);
  const match = KNOWN_INSURERS.find((item) => text.includes(normalizeText(item)));
  if (!match) return "";
  if (normalizeText(match) === "fonasa") return "Fonasa";
  if (normalizeText(match) === "isapre") return "Isapre";
  return match
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isCoverageDocument(doc) {
  const notes = cleanUiText(doc?.notes, "");
  if (notes.includes(COVERAGE_NOTE_MARKER)) return true;
  return getCoverageSignals(doc).length > 0 || Boolean(getDetectedInsurer(doc));
}
