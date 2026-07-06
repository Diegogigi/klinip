import React, { useCallback, useEffect, useState } from "react";
import {
  createHealthExamResult,
  createHealthProblem,
  createHealthSheetAction,
  createHealthVaccine,
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

// Ficha de Salud: el resumen vivo del perfil (diagnósticos, vacunas, exámenes
// e indicaciones) con registro manual simple. Pensada para leerse de un
// vistazo y con acciones grandes, aptas para adultos mayores.
export default function HealthSheetCard({ profileId }) {
  const [sheet, setSheet] = useState(null);
  const [state, setState] = useState("loading");
  const [openForm, setOpenForm] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [problemDraft, setProblemDraft] = useState({ name: "", detail: "" });
  const [vaccineDraft, setVaccineDraft] = useState({ vaccine_name: "", administered_at: "", dose_label: "" });
  const [examDraft, setExamDraft] = useState({ exam_name: "", performed_at: "", summary: "" });
  const [problemBusyId, setProblemBusyId] = useState(null);
  const [actionBusyKey, setActionBusyKey] = useState("");
  const [actionsCreated, setActionsCreated] = useState(() => new Set());

  const loadSheet = useCallback(async () => {
    if (!profileId) {
      setSheet(null);
      setState("ready");
      return;
    }
    try {
      const data = await getHealthSheet(profileId);
      setSheet(data || null);
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
        await createHealthExamResult(profileId, {
          exam_name: examDraft.exam_name.trim(),
          summary: examDraft.summary.trim(),
          performed_at: examDraft.performed_at || null,
        });
        setExamDraft({ exam_name: "", performed_at: "", summary: "" });
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

  if (!profileId) return null;

  const diagnoses = ensureArray(sheet?.diagnoses);
  const vaccines = ensureArray(sheet?.vaccines);
  const exams = ensureArray(sheet?.exams);
  const indications = ensureArray(sheet?.indications);
  const totalItems = diagnoses.length + vaccines.length + exams.length;

  return (
    <section className="clp-card tone-teal hsheet-card" aria-labelledby="clp-hsheet-h">
      <div className="clp-card-head">
        <span className="clp-card-icon tone-teal"><IcoSheet /></span>
        <div className="clp-card-head-main">
          <div className="clp-card-titles">
            <h2 className="clp-card-title" id="clp-hsheet-h">Ficha de Salud</h2>
            <p className="clp-card-sub">Tus diagnósticos, vacunas y exámenes, resumidos en una sola hoja</p>
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
          {sheet?.summary ? <p className="hsheet-summary">{cleanUiText(sheet.summary)}</p> : null}

          {/* ── Problemas y diagnósticos ── */}
          <details className="hsheet-section">
            <summary>
              <span aria-hidden>🩺</span> Problemas y diagnósticos
              <span className="hsheet-count">{diagnoses.length}</span>
            </summary>
            <div className="hsheet-section-body">
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
          </details>

          {/* ── Vacunas ── */}
          <details className="hsheet-section">
            <summary>
              <span aria-hidden>💉</span> Vacunas
              <span className="hsheet-count">{vaccines.length}</span>
            </summary>
            <div className="hsheet-section-body">
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
          </details>

          {/* ── Exámenes ── */}
          <details className="hsheet-section">
            <summary>
              <span aria-hidden>🧪</span> Exámenes
              <span className="hsheet-count">{exams.length}</span>
            </summary>
            <div className="hsheet-section-body">
              {exams.length === 0 ? (
                <p className="hsheet-empty">Aún no hay exámenes registrados. Puedes agregar uno abajo.</p>
              ) : (
                exams.map((item, index) => (
                  <div className="hsheet-row" key={`exam-${index}`}>
                    <div className="hsheet-row-copy">
                      <strong>{cleanUiText(item.name)}</strong>
                      {fmtSheetDate(item.date) ? <p>Realizado el {fmtSheetDate(item.date)}</p> : null}
                      {item.summary ? <p>{cleanUiText(item.summary)}</p> : null}
                      {ensureArray(item.abnormal_values).length > 0 ? (
                        <div className="hsheet-chip-row">
                          {ensureArray(item.abnormal_values).slice(0, 4).map((value, valueIndex) => (
                            <span className="hsheet-chip" key={`val-${index}-${valueIndex}`}>
                              {cleanUiText(
                                [value?.name || value?.label || "Valor", value?.value].filter(Boolean).join(": ")
                              )}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {sourceLabel(item.source) ? <small>{sourceLabel(item.source)}</small> : null}
                    </div>
                  </div>
                ))
              )}
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
                  + Registrar examen
                </button>
              )}
            </div>
          </details>

          {/* ── Indicaciones ── */}
          {indications.length > 0 ? (
            <details className="hsheet-section">
              <summary>
                <span aria-hidden>📋</span> Indicaciones médicas
                <span className="hsheet-count">{indications.length}</span>
              </summary>
              <div className="hsheet-section-body">
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
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}
