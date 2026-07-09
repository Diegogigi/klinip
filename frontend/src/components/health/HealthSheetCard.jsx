import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getHealthExamResults, getHealthSheet } from "../../services/httpApi";
import { ensureArray } from "../../utils/arrays";
import { cleanUiText } from "../../utils/textEncoding";

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function IcoSheet() {
  return (
    <svg {...svgProps}>
      <path d="M9 11l3 3 4-4" />
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M8 6V4a2 2 0 0 1 4 0v2" />
    </svg>
  );
}

function IcoChevron() {
  return (
    <svg {...svgProps} strokeWidth="2">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtSheetDate(value) {
  const date = parseDate(value);
  if (!date) return "";
  return date.toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
}

function latestByDate(items, field = "date") {
  return [...ensureArray(items)].sort((left, right) => {
    const leftTime = parseDate(left?.[field])?.getTime() || 0;
    const rightTime = parseDate(right?.[field])?.getTime() || 0;
    return rightTime - leftTime;
  })[0] || null;
}

// Un parámetro de laboratorio real es un nombre corto ("GLUCOSA", "TIEMPO DE
// PROTROMBINA"), no una frase clínica larga. Filtra registros defectuosos que
// hayan quedado guardados antes de este endurecimiento.
function isPlausibleLabParamName(name) {
  return Boolean(name) && name.length <= 60 && name.trim().split(/\s+/).length <= 6;
}

function countLabParameters(examRecords) {
  const keys = new Set();
  ensureArray(examRecords).forEach((record) => {
    ensureArray(record?.values_json).forEach((value) => {
      const name = cleanUiText(value?.name || value?.label || "", "").trim();
      if (name && isPlausibleLabParamName(name)) keys.add(name.toLowerCase());
    });
  });
  return keys.size;
}

// Tarjeta resumen de la Ficha de Salud en Mi Salud. Solo muestra el estado
// general; el detalle completo (historial de exámenes, diagnósticos, vacunas)
// vive en su propia sección: /mi-salud/ficha.
export default function HealthSheetCard({ profileId }) {
  const [sheet, setSheet] = useState(null);
  const [examRecords, setExamRecords] = useState([]);
  const [state, setState] = useState("loading");

  const loadSummary = useCallback(async () => {
    if (!profileId) {
      setSheet(null);
      setExamRecords([]);
      setState("ready");
      return;
    }
    try {
      const [sheetData, recordsData] = await Promise.all([
        getHealthSheet(profileId),
        getHealthExamResults(profileId).catch(() => []),
      ]);
      setSheet(sheetData || null);
      setExamRecords(ensureArray(recordsData));
      setState("ready");
    } catch {
      setState("error");
    }
  }, [profileId]);

  useEffect(() => {
    if (!profileId) return;
    setState("loading");
    loadSummary();
  }, [profileId, loadSummary]);

  if (!profileId) return null;

  const diagnoses = ensureArray(sheet?.diagnoses);
  const vaccines = ensureArray(sheet?.vaccines);
  const exams = ensureArray(sheet?.exams);
  const activeDiagnoses = diagnoses.filter((item) =>
    ["active", "monitoring"].includes(String(item?.status || "").toLowerCase())
  );
  const latestExam = latestByDate(exams);
  const latestVaccine = latestByDate(vaccines);
  const labParameterCount = countLabParameters(examRecords);

  const snapshotItems = [
    {
      label: "Problemas activos",
      value: activeDiagnoses.length,
      helper: activeDiagnoses.length ? "En seguimiento" : "Sin activos marcados",
      tone: activeDiagnoses.length ? "warn" : "ok",
    },
    {
      label: "Valores en historial",
      value: labParameterCount,
      helper: labParameterCount ? "Parámetros con seguimiento" : "Fotografía un examen",
      tone: labParameterCount ? "teal" : "muted",
    },
    {
      label: "Último examen",
      value: latestExam ? cleanUiText(latestExam.name, "Registrado") : "Sin datos",
      helper: latestExam?.date ? fmtSheetDate(latestExam.date) : "Aún nada guardado",
      tone: latestExam ? "info" : "muted",
    },
    {
      label: "Última vacuna",
      value: latestVaccine ? cleanUiText(latestVaccine.name, "Registrada") : "Sin datos",
      helper: latestVaccine?.date ? fmtSheetDate(latestVaccine.date) : "Aún nada guardado",
      tone: latestVaccine ? "teal" : "muted",
    },
  ];

  return (
    <section className="clp-card tone-teal hsheet-card" aria-labelledby="clp-hsheet-h">
      <div className="clp-card-head">
        <span className="clp-card-icon tone-teal"><IcoSheet /></span>
        <div className="clp-card-head-main">
          <div className="clp-card-titles">
            <h2 className="clp-card-title" id="clp-hsheet-h">Ficha de Salud</h2>
            <p className="clp-card-sub">El resumen de tus diagnósticos, exámenes y vacunas</p>
          </div>
          <div className="clp-card-head-meta clp-card-head-meta-action-only">
            <Link to="/mi-salud/ficha" className="clp-card-link clp-card-link-primary">
              Abrir ficha <IcoChevron />
            </Link>
          </div>
        </div>
      </div>

      {state === "loading" ? (
        <div className="clp-empty">Preparando tu ficha de salud…</div>
      ) : state === "error" ? (
        <div className="clp-empty hsheet-error">
          <span>No pudimos cargar tu ficha ahora.</span>
          <button type="button" onClick={() => { setState("loading"); loadSummary(); }}>
            Reintentar
          </button>
        </div>
      ) : (
        <div className="hsheet-body">
          <div className="hsheet-live-grid" aria-label="Resumen de la ficha de salud">
            {snapshotItems.map((item) => (
              <article className={`hsheet-live-card is-${item.tone}`} key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.helper}</small>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
