import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createHealthExamResult,
  createHealthProblem,
  createHealthSheetAction,
  createHealthVaccine,
  getDocumentAnalysis,
  getHealthExamResults,
  getHealthSheet,
  updateDocument,
  updateHealthExamResult,
  updateHealthProblem,
} from "../../services/httpApi";
import { ensureArray } from "../../utils/arrays";
import { cleanUiText } from "../../utils/textEncoding";
import { notifyClinicalDataChanged } from "../../utils/clinicalRefresh";

const PROBLEM_STATUS_LABELS = {
  active: { label: "Activo", tone: "warn" },
  monitoring: { label: "En control", tone: "info" },
  resolved: { label: "Resuelto", tone: "ok" },
  documented: { label: "Documentado", tone: "muted" },
};

const ABNORMAL_FLAGS = new Set(["high", "low", "abnormal", "critical", "alto", "bajo", "anormal", "critico"]);

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

// Estado del valor en palabras simples, con el mismo criterio que la tarjeta
// resumen: solo se etiqueta "Normal" cuando el propio dato trae un rango de
// referencia y cae dentro de él, para no inventar una clasificación que no
// podemos respaldar.
function getValueStatus(flag) {
  const key = String(flag || "").toLowerCase();
  if (isAbnormalFlag(key)) return { label: "Alterado", tone: "alt" };
  if (key === "normal") return { label: "Normal", tone: "ok" };
  return { label: "Sin rango", tone: "muted" };
}

// Un parámetro de laboratorio real es un nombre corto ("GLUCOSA", "TIEMPO DE
// PROTROMBINA"), no una frase clínica larga. Filtra registros defectuosos que
// hayan quedado guardados antes de este endurecimiento, para que la sección
// no muestre notas médicas como si fueran valores de examen.
function isPlausibleLabParamName(name) {
  return Boolean(name) && name.length <= 60 && name.trim().split(/\s+/).length <= 6;
}

// Agrupa todos los valores estructurados de exámenes por parámetro (Glucosa,
// Colesterol, etc.), ordenados del más reciente al más antiguo, para armar el
// historial que se ve como lista de indicadores.
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
        // Se guarda el registro y el nombre "crudo" tal como está en
        // values_json para poder editar/eliminar este valor puntual después.
        recordId: record?.id,
        rawName: value?.name || value?.label || "",
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

const SWIPE_REVEAL_PX = 140;

// Fila de un parámetro con gesto de deslizar hacia la izquierda para revelar
// Editar/Eliminar (como el swipe-to-delete de iOS). Usa eventos de puntero
// (mouse + touch) y bloquea el gesto al primer movimiento claramente
// horizontal, para no interferir con el scroll vertical de la página ni con
// el toque normal que expande el historial.
function SwipeableParamRow({
  param,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  isEditing,
  editDraft,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
  editBusy,
  editError,
}) {
  const [dragX, setDragX] = useState(0);
  const draggingRef = useRef(false);
  const lockRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0, base: 0 });
  const suppressClickRef = useRef(false);

  const clamp = (value) => Math.min(0, Math.max(-SWIPE_REVEAL_PX, value));

  const handlePointerDown = (event) => {
    draggingRef.current = true;
    lockRef.current = null;
    startRef.current = { x: event.clientX, y: event.clientY, base: dragX };
  };

  const handlePointerMove = (event) => {
    if (!draggingRef.current) return;
    const dx = event.clientX - startRef.current.x;
    const dy = event.clientY - startRef.current.y;
    if (!lockRef.current) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      lockRef.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (lockRef.current !== "x") return;
    setDragX(clamp(startRef.current.base + dx));
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (lockRef.current === "x") {
      suppressClickRef.current = true;
      setDragX((current) => (current < -SWIPE_REVEAL_PX / 2 ? -SWIPE_REVEAL_PX : 0));
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    lockRef.current = null;
  };

  const handleRowActivate = () => {
    if (suppressClickRef.current) return;
    if (dragX !== 0) {
      setDragX(0);
      return;
    }
    onToggleExpand();
  };

  const latest = param.entries[0];
  const status = getValueStatus(latest?.flag);

  return (
    <div className="hsheet-swipe-row">
      <div className="hsheet-swipe-actions">
        <button
          type="button"
          className="hsheet-swipe-btn is-edit"
          onClick={() => {
            setDragX(0);
            onEdit(param);
          }}
        >
          Editar
        </button>
        <button
          type="button"
          className="hsheet-swipe-btn is-delete"
          onClick={() => {
            setDragX(0);
            onDelete(param);
          }}
        >
          Eliminar
        </button>
      </div>
      <div
        className="hsheet-swipe-content"
        style={{ transform: `translateX(${dragX}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {isEditing ? (
          <div className="hsheet-indicator-item is-editing">
            <div className="hsheet-indicator-edit-form">
              <span className="hsheet-indicator-name">{param.name}</span>
              <div className="hsheet-indicator-edit-row">
                <input
                  type="text"
                  value={editDraft.value}
                  maxLength={40}
                  placeholder="Resultado"
                  aria-label="Nuevo resultado"
                  onChange={(event) => onEditDraftChange({ ...editDraft, value: event.target.value })}
                />
                <input
                  type="text"
                  value={editDraft.unit}
                  maxLength={20}
                  placeholder="Unidad"
                  aria-label="Unidad"
                  onChange={(event) => onEditDraftChange({ ...editDraft, unit: event.target.value })}
                />
              </div>
              {editError ? <p className="hsheet-form-error">{editError}</p> : null}
              <div className="hsheet-form-actions">
                <button type="button" className="primary-btn" disabled={editBusy} onClick={() => onSaveEdit(param)}>
                  {editBusy ? "Guardando…" : "Guardar"}
                </button>
                <button type="button" className="secondary-btn" disabled={editBusy} onClick={onCancelEdit}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="hsheet-indicator-item"
            role="button"
            tabIndex={0}
            onClick={handleRowActivate}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleRowActivate();
              }
            }}
          >
            <div className="hsheet-indicator-summary-row">
              <span className="hsheet-indicator-name">{param.name}</span>
              <span className="hsheet-indicator-value">
                {latest.value}{latest.unit ? ` ${latest.unit}` : ""}
              </span>
              <span className={`hsheet-indicator-pill is-${status.tone}`}>{status.label}</span>
            </div>
            {isExpanded ? (
              <div className="hsheet-indicator-history">
                {param.entries.map((entry, entryIndex) => (
                  <div className="hsheet-indicator-entry" key={`${param.key}-${entryIndex}`}>
                    <span>{fmtSheetDate(entry.date) || "Sin fecha"}</span>
                    <strong>{entry.value}{entry.unit ? ` ${entry.unit}` : ""}</strong>
                    <small>
                      {[entry.range ? `Rango: ${entry.range}` : "", entry.examName]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// Ficha de Salud: la vista principal es tu último panel de exámenes, con un
// resumen de cuántos valores están alterados o normales (como un chequeo
// médico). Diagnósticos, vacunas e indicaciones quedan en una sección
// secundaria plegada, para mantener la pantalla simple.
export default function HealthSheetPanel({ profileId }) {
  const [sheet, setSheet] = useState(null);
  const [examRecords, setExamRecords] = useState([]);
  const [state, setState] = useState("loading");
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
  const [dismissingDocId, setDismissingDocId] = useState(null);
  const [expandedParamKey, setExpandedParamKey] = useState("");
  const [editingParamKey, setEditingParamKey] = useState("");
  const [editDraft, setEditDraft] = useState({ value: "", unit: "" });
  const [editBusy, setEditBusy] = useState(false);
  const [paramActionError, setParamActionError] = useState("");

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

  // "Esto no es un examen": para solicitudes/órdenes que Klinip clasificó mal
  // como resultado y por eso insisten en pedir el traspaso de valores que
  // nunca van a existir. Se corrige el tipo del documento (misma acción que
  // "marcar como examen", en sentido contrario) y desaparece de esta lista.
  const dismissPendingExam = async (item) => {
    const documentId = item?.source?.source_id;
    if (!documentId || dismissingDocId) return;
    setDismissingDocId(documentId);
    try {
      await updateDocument(documentId, { doc_type: "orden" });
      await loadSheet();
      notifyClinicalDataChanged({ profileId, sources: ["health-sheet", "documents"] });
    } catch {
      window.alert("No se pudo actualizar el documento. Inténtalo de nuevo.");
    } finally {
      setDismissingDocId(null);
    }
  };

  const toggleParamExpanded = (key) => {
    setExpandedParamKey((current) => (current === key ? "" : key));
  };

  const startEditParam = (param) => {
    setParamActionError("");
    const latest = param.entries[0];
    setEditingParamKey(param.key);
    setEditDraft({ value: latest?.value || "", unit: latest?.unit || "" });
  };

  const cancelEditParam = () => {
    setEditingParamKey("");
    setParamActionError("");
  };

  // Edita solo el valor más reciente de este parámetro: reescribe esa entrada
  // dentro del registro de examen donde vive (values_json), sin tocar el
  // resto de los valores de ese mismo examen.
  const saveEditParam = async (param) => {
    const latest = param.entries[0];
    if (!latest?.recordId || editBusy) return;
    const nextValue = editDraft.value.trim();
    if (!nextValue) {
      setParamActionError("Ingresa un valor.");
      return;
    }
    setEditBusy(true);
    setParamActionError("");
    try {
      const record = examRecords.find((item) => item.id === latest.recordId);
      const values = ensureArray(record?.values_json).map((entry) => {
        const entryName = cleanUiText(entry?.name || entry?.label || "", "").trim().toLowerCase();
        if (entryName !== param.key) return entry;
        return { ...entry, value: nextValue, unit: editDraft.unit.trim() };
      });
      await updateHealthExamResult(profileId, latest.recordId, { values_json: values });
      setEditingParamKey("");
      await loadSheet();
      notifyClinicalDataChanged({ profileId, sources: ["health-sheet"] });
    } catch {
      setParamActionError("No se pudo guardar el cambio. Inténtalo de nuevo.");
    } finally {
      setEditBusy(false);
    }
  };

  // Elimina este parámetro de TODO su historial (todas las hojas donde
  // aparece), no solo del valor más reciente.
  const deleteParam = async (param) => {
    if (editBusy) return;
    if (
      !window.confirm(
        `¿Eliminar "${param.name}" de tu historial? Se quitará de los ${param.entries.length} registro${
          param.entries.length !== 1 ? "s" : ""
        } donde aparece.`
      )
    ) {
      return;
    }
    setEditBusy(true);
    try {
      const affectedRecordIds = new Set(param.entries.map((entry) => entry.recordId).filter(Boolean));
      for (const recordId of affectedRecordIds) {
        const record = examRecords.find((item) => item.id === recordId);
        if (!record) continue;
        const values = ensureArray(record.values_json).filter((entry) => {
          const entryName = cleanUiText(entry?.name || entry?.label || "", "").trim().toLowerCase();
          return entryName !== param.key;
        });
        await updateHealthExamResult(profileId, recordId, { values_json: values });
      }
      await loadSheet();
      notifyClinicalDataChanged({ profileId, sources: ["health-sheet"] });
    } catch {
      window.alert("No se pudo eliminar el parámetro. Inténtalo de nuevo.");
    } finally {
      setEditBusy(false);
    }
  };

  if (!profileId) return null;

  const diagnoses = ensureArray(sheet?.diagnoses);
  const vaccines = ensureArray(sheet?.vaccines);
  const exams = ensureArray(sheet?.exams);
  const indications = ensureArray(sheet?.indications);
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

  const indicatorStats = labHistory.reduce(
    (acc, param) => {
      const status = getValueStatus(param.entries[0]?.flag);
      if (status.tone === "alt") acc.altered += 1;
      else if (status.tone === "ok") acc.normal += 1;
      return acc;
    },
    { altered: 0, normal: 0 }
  );

  const moreItemsCount = diagnoses.length + vaccines.length + indications.length;

  return (
    <section className="hsheet-page-panel" aria-label="Ficha de Salud">
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
          {labHistory.length > 0 ? (
            <div className="hsheet-indicator-row" aria-label="Resumen de tus indicadores">
              <span className="hsheet-indicator is-alt">
                <em />
                <strong>{indicatorStats.altered}</strong>
                <small>Alterados</small>
              </span>
              <span className="hsheet-indicator is-ok">
                <em />
                <strong>{indicatorStats.normal}</strong>
                <small>Normales</small>
              </span>
              <span className="hsheet-indicator is-muted">
                <em />
                <strong>{labHistory.length}</strong>
                <small>Total</small>
              </span>
            </div>
          ) : null}

          {importMessage ? <p className="hsheet-import-message">{importMessage}</p> : null}

          {pendingImportExams.length > 0 ? (
            <div className="hsheet-pending-list">
              <span className="hsheet-pending-title">Exámenes leídos: pásalos a tu historial</span>
              {pendingImportExams.map((item, index) => {
                const documentId = item?.source?.source_id;
                const busy = importBusyId === documentId;
                const dismissing = dismissingDocId === documentId;
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
                        disabled={busy || dismissing}
                        onClick={() => importExamValues(item)}
                      >
                        {busy ? "Traspasando…" : "Pasar valores"}
                      </button>
                      <button
                        type="button"
                        className="hsheet-link-btn hsheet-dismiss-btn"
                        disabled={busy || dismissing}
                        onClick={() => dismissPendingExam(item)}
                      >
                        {dismissing ? "Actualizando…" : "No es un examen"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {labHistory.length > 0 ? (
            <div className="hsheet-results-block">
              <div className="hsheet-results-head">
                <span className="hsheet-results-title">Últimos resultados</span>
                <span className="hsheet-hint">Toca un valor para ver su historial. Desliza a la izquierda para editar o eliminar.</span>
              </div>
              <div className="hsheet-indicator-list">
                {labHistory.map((param) => (
                  <SwipeableParamRow
                    key={param.key}
                    param={param}
                    isExpanded={expandedParamKey === param.key}
                    onToggleExpand={() => toggleParamExpanded(param.key)}
                    onEdit={startEditParam}
                    onDelete={deleteParam}
                    isEditing={editingParamKey === param.key}
                    editDraft={editDraft}
                    onEditDraftChange={setEditDraft}
                    onSaveEdit={saveEditParam}
                    onCancelEdit={cancelEditParam}
                    editBusy={editBusy}
                    editError={editingParamKey === param.key ? paramActionError : ""}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="hsheet-empty">
              Todavía no hay valores en tu historial. Fotografía un examen de sangre o anota los
              valores a mano, y quedarán ordenados aquí para comparar en el tiempo.
            </p>
          )}

          <div className="hsheet-secondary-links">
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
              <button type="button" className="hsheet-link-btn" onClick={() => { setOpenForm("exam"); setFormError(""); }}>
                + Anotar un examen a mano
              </button>
            )}
          </div>

          {/* ── Diagnósticos, vacunas e indicaciones: sección secundaria plegada ── */}
          <details className="hsheet-more">
            <summary>
              Más de tu ficha: diagnósticos, vacunas e indicaciones
              {moreItemsCount > 0 ? <span className="hsheet-count">{moreItemsCount}</span> : null}
            </summary>
            <div className="hsheet-more-body">
              <div className="hsheet-more-block">
                <span className="hsheet-block-title">🩺 Problemas y diagnósticos</span>
                {diagnoses.length === 0 ? (
                  <p className="hsheet-empty">Aún no hay diagnósticos registrados.</p>
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
                  <button type="button" className="hsheet-link-btn" onClick={() => { setOpenForm("problem"); setFormError(""); }}>
                    + Agregar problema o diagnóstico
                  </button>
                )}
              </div>

              <div className="hsheet-more-block">
                <span className="hsheet-block-title">💉 Vacunas</span>
                {vaccines.length === 0 ? (
                  <p className="hsheet-empty">Aún no hay vacunas registradas.</p>
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
                  <button type="button" className="hsheet-link-btn" onClick={() => { setOpenForm("vaccine"); setFormError(""); }}>
                    + Registrar vacuna
                  </button>
                )}
              </div>

              {indications.length > 0 ? (
                <div className="hsheet-more-block">
                  <span className="hsheet-block-title">📋 Indicaciones médicas</span>
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
          </details>
        </div>
      )}
    </section>
  );
}
