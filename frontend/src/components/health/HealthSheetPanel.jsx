import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createHealthExamResult,
  createHealthProblem,
  createHealthSheetAction,
  createHealthVaccine,
  getDocumentAnalysis,
  getHealthExamResults,
  getHealthSheet,
  updateHealthProblem,
} from "../../services/httpApi";
import { ensureArray } from "../../utils/arrays";
import { cleanUiText } from "../../utils/textEncoding";
import { notifyClinicalDataChanged } from "../../utils/clinicalRefresh";

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

const PROBLEM_STATUS_LABELS = {
  active: { label: "Activo", tone: "warn" },
  monitoring: { label: "En control", tone: "info" },
  resolved: { label: "Resuelto", tone: "ok" },
  documented: { label: "Documentado", tone: "muted" },
};

const ABNORMAL_FLAGS = new Set(["high", "low", "abnormal", "alto", "bajo", "anormal"]);

const EMPTY_VALUE_ROW = { name: "", value: "", unit: "" };

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

function getProblemStatusInfo(status) {
  const key = String(status || "").toLowerCase();
  return PROBLEM_STATUS_LABELS[key] || { label: "Documentado", tone: "muted" };
}

function sourceLabel(source) {
  const label = cleanUiText(source?.label || "", "").trim();
  if (!label) return "";
  return `Fuente: ${label}`;
}

function isAbnormalFlag(flag) {
  return ABNORMAL_FLAGS.has(String(flag || "").toLowerCase());
}

// Agrupa todos los valores estructurados de exámenes por parámetro (Glucosa,
// Colesterol, etc.), ordenados del más reciente al más antiguo, para armar el
// historial que se ve como tabla.
// Un parámetro de laboratorio real es un nombre corto ("GLUCOSA", "TIEMPO DE
// PROTROMBINA"), no una frase clínica larga. Filtra registros defectuosos que
// hayan quedado guardados antes de este endurecimiento, para que la sección
// no muestre notas médicas como si fueran valores de examen.
function isPlausibleLabParamName(name) {
  return Boolean(name) && name.length <= 60 && name.trim().split(/\s+/).length <= 6;
}

function buildLabHistory(examRecords) {
  const paramsByKey = new Map();
  ensureArray(examRecords).forEach((record) => {
    const recordDate = record?.performed_at || record?.created_at || null;
    ensureArray(record?.values_json).forEach((value) => {
      const name = cleanUiText(value?.name || value?.label || "", "").trim();
      const measured = cleanUiText(String(value?.value ?? ""), "").trim();
      if (!name || !measured || !isPlausibleLabParamName(name)) return;
      const key = name.toLowerCase();
      if (!paramsByKey.has(key)) {
        paramsByKey.set(key, { key, name, entries: [] });
      }
      paramsByKey.get(key).entries.push({
        date: recordDate,
        value: measured,
        unit: cleanUiText(value?.unit || "", "").trim(),
        range: cleanUiText(value?.reference_range || value?.range || "", "").trim(),
        flag: String(value?.flag || "").toLowerCase(),
        examName: cleanUiText(record?.exam_name || "", "").trim(),
      });
    });
  });
  const params = [...paramsByKey.values()].map((param) => ({
    ...param,
    entries: param.entries.sort(
      (a, b) => (parseDate(b.date)?.getTime() || 0) - (parseDate(a.date)?.getTime() || 0)
    ),
  }));
  return params.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// Ficha de Salud: pestañas con el resumen vivo del perfil. El foco del flujo
// de exámenes es fotografiar el resultado, traspasar sus valores y construir
// un historial estructurado por parámetro. Copy y controles pensados para
// adultos mayores: una acción clara a la vez.
export default function HealthSheetPanel({ profileId }) {
  const navigate = useNavigate();
  const [sheet, setSheet] = useState(null);
  const [examRecords, setExamRecords] = useState([]);
  const [state, setState] = useState("loading");
  const [activeTab, setActiveTab] = useState("examenes");
  const [openForm, setOpenForm] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [problemDraft, setProblemDraft] = useState({ name: "", detail: "" });
  const [vaccineDraft, setVaccineDraft] = useState({ vaccine_name: "", administered_at: "", dose_label: "" });
  const [examDraft, setExamDraft] = useState({
    exam_name: "",
    performed_at: "",
    summary: "",
    values: [{ ...EMPTY_VALUE_ROW }],
  });
  const [problemBusyId, setProblemBusyId] = useState(null);
  const [actionBusyKey, setActionBusyKey] = useState("");
  const [actionsCreated, setActionsCreated] = useState(() => new Set());
  const [importBusyId, setImportBusyId] = useState(null);
  const [importMessage, setImportMessage] = useState("");

  const loadSheet = useCallback(async () => {
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
    loadSheet();
  }, [profileId, loadSheet]);

  const closeForm = () => {
    setOpenForm("");
    setFormError("");
  };

  const updateExamValueRow = (index, field, value) => {
    setExamDraft((draft) => {
      const values = draft.values.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row
      );
      return { ...draft, values };
    });
  };

  const addExamValueRow = () => {
    setExamDraft((draft) => ({ ...draft, values: [...draft.values, { ...EMPTY_VALUE_ROW }] }));
  };

  const submitForm = async (kind) => {
    if (formBusy || !profileId) return;
    setFormBusy(true);
    setFormError("");
    try {
      if (kind === "problem") {
        if (!problemDraft.name.trim()) {
          setFormError("Escribe el nombre del problema o diagnóstico.");
          return;
        }
        await createHealthProblem(profileId, {
          name: problemDraft.name.trim(),
          detail: problemDraft.detail.trim(),
          status: "active",
        });
        setProblemDraft({ name: "", detail: "" });
      } else if (kind === "vaccine") {
        if (!vaccineDraft.vaccine_name.trim()) {
          setFormError("Escribe el nombre de la vacuna.");
          return;
        }
        await createHealthVaccine(profileId, {
          vaccine_name: vaccineDraft.vaccine_name.trim(),
          dose_label: vaccineDraft.dose_label.trim(),
          administered_at: vaccineDraft.administered_at || null,
        });
        setVaccineDraft({ vaccine_name: "", administered_at: "", dose_label: "" });
      } else if (kind === "exam") {
        if (!examDraft.exam_name.trim()) {
          setFormError("Escribe el nombre del examen.");
          return;
        }
        const values = examDraft.values
          .map((row) => ({
            name: row.name.trim(),
            value: row.value.trim(),
            unit: row.unit.trim(),
          }))
          .filter((row) => row.name && row.value);
        await createHealthExamResult(profileId, {
          exam_name: examDraft.exam_name.trim(),
          summary: examDraft.summary.trim(),
          performed_at: examDraft.performed_at || null,
          values_json: values,
        });
        setExamDraft({ exam_name: "", performed_at: "", summary: "", values: [{ ...EMPTY_VALUE_ROW }] });
      }
      closeForm();
      await loadSheet();
      notifyClinicalDataChanged({ profileId, sources: ["health-sheet"] });
    } catch {
      setFormError("No se pudo guardar. Inténtalo de nuevo.");
    } finally {
      setFormBusy(false);
    }
  };

  const toggleProblemResolved = async (item) => {
    const source = item?.source || {};
    if (source.source_type !== "health_problem" || !source.source_id || problemBusyId) return;
    setProblemBusyId(source.source_id);
    try {
      const isResolved = String(item.status || "").toLowerCase() === "resolved";
      await updateHealthProblem(profileId, source.source_id, {
        status: isResolved ? "active" : "resolved",
        resolved_at: isResolved ? null : new Date().toISOString(),
      });
      await loadSheet();
      notifyClinicalDataChanged({ profileId, sources: ["health-sheet"] });
    } catch {
      window.alert("No se pudo actualizar el problema. Inténtalo de nuevo.");
    } finally {
      setProblemBusyId(null);
    }
  };

  const createActionFromIndication = async (indication, key) => {
    if (actionBusyKey || actionsCreated.has(key)) return;
    setActionBusyKey(key);
    try {
      await createHealthSheetAction(profileId, {
        title: cleanUiText(indication.title, "Seguir indicación médica"),
        description: cleanUiText(indication.detail || "", ""),
        source_type: indication?.source?.source_type || "health_sheet",
        source_id: indication?.source?.source_id || null,
      });
      setActionsCreated((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      notifyClinicalDataChanged({ profileId, sources: ["health-sheet", "continuity"] });
    } catch {
      window.alert("No se pudo crear el recordatorio. Inténtalo de nuevo.");
    } finally {
      setActionBusyKey("");
    }
  };

  // Traspasa los valores leídos por IA en un examen fotografiado hacia el
  // historial estructurado (HealthExamResult con values_json).
  const importExamValues = async (item) => {
    const documentId = item?.source?.source_id;
    if (!documentId || importBusyId) return;
    setImportBusyId(documentId);
    setImportMessage("");
    try {
      const analysis = await getDocumentAnalysis(documentId, profileId);
      const labValues = ensureArray(analysis?.entities)
        .filter((entity) => entity?.entity_type === "lab_value")
        .map((entity) => ({
          name: cleanUiText(entity.entity_name || "", "").trim(),
          value: cleanUiText(entity.entity_value || "", "").trim(),
          unit: cleanUiText(entity.unit || "", "").trim(),
          reference_range: cleanUiText(entity.reference_range || "", "").trim(),
          flag: entity.flag || "",
        }))
        .filter((value) => value.name && value.value);
      const fallbackValues = ensureArray(item.abnormal_values)
        .map((value) => ({
          name: cleanUiText(value?.name || value?.label || "", "").trim(),
          value: cleanUiText(String(value?.value ?? ""), "").trim(),
          unit: cleanUiText(value?.unit || "", "").trim(),
          reference_range: cleanUiText(value?.reference_range || value?.range || "", "").trim(),
          flag: value?.flag || "abnormal",
        }))
        .filter((value) => value.name && value.value);
      const values = labValues.length ? labValues : fallbackValues;
      if (!values.length) {
        setImportMessage("No encontramos valores legibles en este examen. Puedes anotarlos a mano.");
        return;
      }
      await createHealthExamResult(profileId, {
        exam_name: cleanUiText(item.name, "Examen"),
        summary: cleanUiText(item.summary || "", ""),
        performed_at: item.date || null,
        values_json: values,
        source_type: "document",
        source_id: documentId,
      });
      await loadSheet();
      notifyClinicalDataChanged({ profileId, sources: ["health-sheet"] });
      setImportMessage(`Listo: ${values.length} valor${values.length !== 1 ? "es" : ""} guardado${values.length !== 1 ? "s" : ""} en tu historial.`);
    } catch {
      setImportMessage("No se pudieron traspasar los valores. Inténtalo de nuevo.");
    } finally {
      setImportBusyId(null);
    }
  };

  if (!profileId) return null;

  const diagnoses = ensureArray(sheet?.diagnoses);
  const vaccines = ensureArray(sheet?.vaccines);
  const exams = ensureArray(sheet?.exams);
  const indications = ensureArray(sheet?.indications);
  const totalItems = diagnoses.length + vaccines.length + exams.length;
  const labHistory = buildLabHistory(examRecords);
  const importedDocumentIds = new Set(
    examRecords
      .filter((record) => String(record?.source_type || "") === "document" && record?.source_id)
      .map((record) => Number(record.source_id))
  );
  // Los exámenes leídos desde documentos cuyos valores aún no pasan al
  // historial son la acción prioritaria; el resto queda plegado.
  const pendingImportExams = exams.filter((item) => {
    const documentId = item?.source?.source_type === "document" ? item?.source?.source_id : null;
    return documentId && !importedDocumentIds.has(Number(documentId));
  });
  const storedExams = exams.filter((item) => !pendingImportExams.includes(item));

  const tabs = [
    { key: "examenes", icon: "🧪", label: "Exámenes", count: exams.length },
    { key: "diagnosticos", icon: "🩺", label: "Diagnósticos", count: diagnoses.length },
    { key: "vacunas", icon: "💉", label: "Vacunas", count: vaccines.length },
    ...(indications.length
      ? [{ key: "indicaciones", icon: "📋", label: "Indicaciones", count: indications.length }]
      : []),
  ];

  return (
    <section className="clp-card tone-teal hsheet-card" aria-labelledby="clp-hsheet-h">
      <div className="clp-card-head">
        <span className="clp-card-icon tone-teal"><IcoSheet /></span>
        <div className="clp-card-head-main">
          <div className="clp-card-titles">
            <h2 className="clp-card-title" id="clp-hsheet-h">Ficha de Salud</h2>
            <p className="clp-card-sub">Tus diagnósticos, vacunas y exámenes, ordenados en una sola hoja</p>
          </div>
          <div className="clp-card-head-meta">
            {totalItems > 0 ? (
              <span className="clp-card-metric">
                {totalItems} registro{totalItems !== 1 ? "s" : ""}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {state === "loading" ? (
        <div className="clp-empty">Preparando tu ficha de salud…</div>
      ) : state === "error" ? (
        <div className="clp-empty hsheet-error">
          <span>No pudimos cargar tu ficha ahora.</span>
          <button type="button" onClick={() => { setState("loading"); loadSheet(); }}>
            Reintentar
          </button>
        </div>
      ) : (
        <div className="hsheet-body">
          <div className="hsheet-tabs" role="tablist" aria-label="Secciones de la ficha">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`hsheet-tab${activeTab === tab.key ? " is-active" : ""}`}
                onClick={() => { setActiveTab(tab.key); closeForm(); }}
              >
                <span aria-hidden>{tab.icon}</span> {tab.label}
                <span className="hsheet-count">{tab.count}</span>
              </button>
            ))}
          </div>

          {/* ── Exámenes ── */}
          {activeTab === "examenes" ? (
            <div className="hsheet-tab-panel">
              <div className="hsheet-scan-row">
                <button
                  type="button"
                  className="primary-btn hsheet-scan-btn"
                  onClick={() => navigate("/documents?scan=1")}
                >
                  <span aria-hidden>📷</span> Fotografía tu examen aquí
                </button>
                <p className="hsheet-hint">
                  Klinip lee la foto y deja los valores listos para guardarlos en tu historial.
                </p>
              </div>

              {labHistory.length > 0 ? (
                <div className="hsheet-history">
                  <h3 className="hsheet-block-title">Historial de valores</h3>
                  <p className="hsheet-hint">Toca un parámetro para ver cómo ha cambiado en el tiempo.</p>
                  <div className="hsheet-param-list">
                    {labHistory.map((param) => {
                      const latest = param.entries[0];
                      const abnormal = isAbnormalFlag(latest?.flag);
                      return (
                        <details className="hsheet-param" key={param.key}>
                          <summary>
                            <span className="hsheet-param-name">{param.name}</span>
                            <span className={`hsheet-param-value${abnormal ? " is-abnormal" : ""}`}>
                              {latest.value}{latest.unit ? ` ${latest.unit}` : ""}
                            </span>
                            <span className="hsheet-param-date">{fmtSheetDate(latest.date) || "Sin fecha"}</span>
                          </summary>
                          <div className="hsheet-param-history">
                            {param.entries.map((entry, entryIndex) => (
                              <div className="hsheet-param-entry" key={`${param.key}-${entryIndex}`}>
                                <span className="hsheet-param-entry-date">
                                  {fmtSheetDate(entry.date) || "Sin fecha"}
                                </span>
                                <strong className={isAbnormalFlag(entry.flag) ? "is-abnormal" : ""}>
                                  {entry.value}{entry.unit ? ` ${entry.unit}` : ""}
                                </strong>
                                <small>
                                  {[entry.range ? `Rango: ${entry.range}` : "", entry.examName]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </small>
                              </div>
                            ))}
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="hsheet-empty">
                  Todavía no hay valores en tu historial. Fotografía un examen de sangre o anota los
                  valores a mano, y quedarán ordenados aquí para comparar en el tiempo.
                </p>
              )}

              {importMessage ? <p className="hsheet-import-message">{importMessage}</p> : null}

              {pendingImportExams.length > 0 ? (
                <div className="hsheet-exam-list">
                  <h3 className="hsheet-block-title">Exámenes leídos: pásalos a tu historial</h3>
                  {pendingImportExams.map((item, index) => {
                    const documentId = item?.source?.source_id;
                    const busy = importBusyId === documentId;
                    return (
                      <div className="hsheet-row" key={`exam-pending-${index}`}>
                        <div className="hsheet-row-copy">
                          <strong>{cleanUiText(item.name)}</strong>
                          {fmtSheetDate(item.date) ? <p>Realizado el {fmtSheetDate(item.date)}</p> : null}
                        </div>
                        <div className="hsheet-row-side">
                          <button
                            type="button"
                            className="hsheet-row-btn"
                            disabled={busy}
                            onClick={() => importExamValues(item)}
                          >
                            {busy ? "Traspasando…" : "Pasar valores al historial"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {storedExams.length > 0 ? (
                <details className="hsheet-section">
                  <summary>
                    <span aria-hidden>🗂️</span> Ver todos tus exámenes
                    <span className="hsheet-count">{storedExams.length}</span>
                  </summary>
                  <div className="hsheet-section-body">
                    {storedExams.map((item, index) => (
                      <div className="hsheet-row" key={`exam-${index}`}>
                        <div className="hsheet-row-copy">
                          <strong>{cleanUiText(item.name)}</strong>
                          {fmtSheetDate(item.date) ? <p>Realizado el {fmtSheetDate(item.date)}</p> : null}
                          {item.summary ? <p>{cleanUiText(item.summary)}</p> : null}
                          {sourceLabel(item.source) ? <small>{sourceLabel(item.source)}</small> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {openForm === "exam" ? (
                <div className="hsheet-form">
                  <label>
                    <span>¿Qué examen te hiciste?</span>
                    <input
                      type="text"
                      value={examDraft.exam_name}
                      maxLength={140}
                      placeholder="Ej: Perfil lipídico"
                      onChange={(event) => setExamDraft((d) => ({ ...d, exam_name: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>¿Cuándo? (opcional)</span>
                    <input
                      type="date"
                      value={examDraft.performed_at}
                      onChange={(event) => setExamDraft((d) => ({ ...d, performed_at: event.target.value }))}
                    />
                  </label>
                  <div className="hsheet-form-values">
                    <span className="hsheet-form-values-title">Valores del examen (opcional)</span>
                    {examDraft.values.map((row, index) => (
                      <div className="hsheet-form-value-row" key={`value-row-${index}`}>
                        <input
                          type="text"
                          value={row.name}
                          maxLength={80}
                          placeholder="Ej: Glucosa"
                          aria-label="Nombre del valor"
                          onChange={(event) => updateExamValueRow(index, "name", event.target.value)}
                        />
                        <input
                          type="text"
                          value={row.value}
                          maxLength={40}
                          placeholder="Ej: 98"
                          aria-label="Resultado"
                          onChange={(event) => updateExamValueRow(index, "value", event.target.value)}
                        />
                        <input
                          type="text"
                          value={row.unit}
                          maxLength={20}
                          placeholder="mg/dL"
                          aria-label="Unidad"
                          onChange={(event) => updateExamValueRow(index, "unit", event.target.value)}
                        />
                      </div>
                    ))}
                    <button type="button" className="hsheet-value-add-btn" onClick={addExamValueRow}>
                      + Agregar otro valor
                    </button>
                  </div>
                  <label>
                    <span>Resultado en tus palabras (opcional)</span>
                    <input
                      type="text"
                      value={examDraft.summary}
                      maxLength={360}
                      placeholder="Ej: Colesterol un poco alto, repetir en 3 meses"
                      onChange={(event) => setExamDraft((d) => ({ ...d, summary: event.target.value }))}
                    />
                  </label>
                  {formError ? <p className="hsheet-form-error">{formError}</p> : null}
                  <div className="hsheet-form-actions">
                    <button type="button" className="primary-btn" disabled={formBusy} onClick={() => submitForm("exam")}>
                      {formBusy ? "Guardando…" : "Guardar"}
                    </button>
                    <button type="button" className="secondary-btn" disabled={formBusy} onClick={closeForm}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="hsheet-add-btn" onClick={() => { setOpenForm("exam"); setFormError(""); }}>
                  + Anotar un examen a mano
                </button>
              )}
            </div>
          ) : null}

          {/* ── Diagnósticos ── */}
          {activeTab === "diagnosticos" ? (
            <div className="hsheet-tab-panel">
              {diagnoses.length === 0 ? (
                <p className="hsheet-empty">Aún no hay diagnósticos registrados. Puedes agregar uno abajo.</p>
              ) : (
                diagnoses.map((item, index) => {
                  const status = getProblemStatusInfo(item.status);
                  const isManual = item?.source?.source_type === "health_problem" && item?.source?.source_id;
                  const busy = problemBusyId === item?.source?.source_id;
                  return (
                    <div className="hsheet-row" key={`diag-${index}`}>
                      <div className="hsheet-row-copy">
                        <strong>{cleanUiText(item.name)}</strong>
                        {item.detail ? <p>{cleanUiText(item.detail)}</p> : null}
                        {sourceLabel(item.source) ? <small>{sourceLabel(item.source)}</small> : null}
                      </div>
                      <div className="hsheet-row-side">
                        <span className={`hsheet-status is-${status.tone}`}>{status.label}</span>
                        {isManual ? (
                          <button
                            type="button"
                            className="hsheet-row-btn"
                            disabled={busy}
                            onClick={() => toggleProblemResolved(item)}
                          >
                            {busy
                              ? "Guardando…"
                              : String(item.status).toLowerCase() === "resolved"
                              ? "Volver a activo"
                              : "Marcar resuelto"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
              {openForm === "problem" ? (
                <div className="hsheet-form">
                  <label>
                    <span>¿Qué problema o diagnóstico quieres registrar?</span>
                    <input
                      type="text"
                      value={problemDraft.name}
                      maxLength={120}
                      placeholder="Ej: Hipertensión"
                      onChange={(event) => setProblemDraft((d) => ({ ...d, name: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Detalle (opcional)</span>
                    <input
                      type="text"
                      value={problemDraft.detail}
                      maxLength={260}
                      placeholder="Ej: Diagnosticada en 2024, en control"
                      onChange={(event) => setProblemDraft((d) => ({ ...d, detail: event.target.value }))}
                    />
                  </label>
                  {formError ? <p className="hsheet-form-error">{formError}</p> : null}
                  <div className="hsheet-form-actions">
                    <button type="button" className="primary-btn" disabled={formBusy} onClick={() => submitForm("problem")}>
                      {formBusy ? "Guardando…" : "Guardar"}
                    </button>
                    <button type="button" className="secondary-btn" disabled={formBusy} onClick={closeForm}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="hsheet-add-btn" onClick={() => { setOpenForm("problem"); setFormError(""); }}>
                  + Agregar problema o diagnóstico
                </button>
              )}
            </div>
          ) : null}

          {/* ── Vacunas ── */}
          {activeTab === "vacunas" ? (
            <div className="hsheet-tab-panel">
              {vaccines.length === 0 ? (
                <p className="hsheet-empty">Aún no hay vacunas registradas. Puedes agregar una abajo.</p>
              ) : (
                vaccines.map((item, index) => (
                  <div className="hsheet-row" key={`vac-${index}`}>
                    <div className="hsheet-row-copy">
                      <strong>{cleanUiText(item.name)}</strong>
                      {fmtSheetDate(item.date) ? <p>Aplicada el {fmtSheetDate(item.date)}</p> : null}
                      {sourceLabel(item.source) ? <small>{sourceLabel(item.source)}</small> : null}
                    </div>
                  </div>
                ))
              )}
              {openForm === "vaccine" ? (
                <div className="hsheet-form">
                  <label>
                    <span>¿Qué vacuna te pusieron?</span>
                    <input
                      type="text"
                      value={vaccineDraft.vaccine_name}
                      maxLength={120}
                      placeholder="Ej: Influenza 2026"
                      onChange={(event) => setVaccineDraft((d) => ({ ...d, vaccine_name: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>¿Cuándo? (opcional)</span>
                    <input
                      type="date"
                      value={vaccineDraft.administered_at}
                      onChange={(event) => setVaccineDraft((d) => ({ ...d, administered_at: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Dosis (opcional)</span>
                    <input
                      type="text"
                      value={vaccineDraft.dose_label}
                      maxLength={80}
                      placeholder="Ej: Primera dosis, refuerzo"
                      onChange={(event) => setVaccineDraft((d) => ({ ...d, dose_label: event.target.value }))}
                    />
                  </label>
                  {formError ? <p className="hsheet-form-error">{formError}</p> : null}
                  <div className="hsheet-form-actions">
                    <button type="button" className="primary-btn" disabled={formBusy} onClick={() => submitForm("vaccine")}>
                      {formBusy ? "Guardando…" : "Guardar"}
                    </button>
                    <button type="button" className="secondary-btn" disabled={formBusy} onClick={closeForm}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="hsheet-add-btn" onClick={() => { setOpenForm("vaccine"); setFormError(""); }}>
                  + Registrar vacuna
                </button>
              )}
            </div>
          ) : null}

          {/* ── Indicaciones ── */}
          {activeTab === "indicaciones" && indications.length > 0 ? (
            <div className="hsheet-tab-panel">
              <p className="hsheet-hint">
                Si quieres que Klinip te recuerde una indicación, conviértela en pendiente.
              </p>
              {indications.map((item, index) => {
                const key = `${item.title}|${item?.source?.source_id || index}`;
                const created = actionsCreated.has(key);
                const busy = actionBusyKey === key;
                return (
                  <div className="hsheet-row" key={`ind-${index}`}>
                    <div className="hsheet-row-copy">
                      <strong>{cleanUiText(item.title)}</strong>
                      {item.detail ? <p>{cleanUiText(item.detail)}</p> : null}
                      {sourceLabel(item.source) ? <small>{sourceLabel(item.source)}</small> : null}
                    </div>
                    <div className="hsheet-row-side">
                      <button
                        type="button"
                        className={`hsheet-row-btn${created ? " is-done" : ""}`}
                        disabled={busy || created}
                        onClick={() => createActionFromIndication(item, key)}
                      >
                        {created ? "Pendiente creado ✓" : busy ? "Creando…" : "Recordármelo"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
