import React, { useEffect, useState } from "react";
import { cleanUiText } from "../../utils/textEncoding";
import {
  COVERAGE_CATEGORIES,
  COVERAGE_PAYER_TYPES,
  COVERAGE_STATUS_OPTIONS,
  formatCoverageAmount,
  getCoverageCategory,
  getCoverageStatusInfo,
} from "./coverageTaxonomy";

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDay(value) {
  const date = parseDate(value);
  if (!date) return "Sin fecha";
  return date.toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

function getMonthLabel(value) {
  const date = parseDate(value);
  if (!date) return "Sin fecha";
  const label = date.toLocaleDateString("es-CL", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function buildAmountParts(amounts) {
  if (!amounts) return [];
  const parts = [];
  const total = formatCoverageAmount(amounts.total);
  const covered = formatCoverageAmount(amounts.covered);
  const patient = formatCoverageAmount(amounts.patient);
  const reimbursed = formatCoverageAmount(amounts.reimbursed);
  if (total) parts.push({ label: "Total", value: total });
  if (covered) parts.push({ label: "Cubierto", value: covered });
  if (patient) parts.push({ label: "Tu parte", value: patient });
  if (reimbursed) parts.push({ label: "Devuelto", value: reimbursed });
  return parts;
}

function amountToInput(value) {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : "";
}

function inputToAmount(value) {
  const cleaned = String(value || "").replace(/[^\d]/g, "");
  return cleaned ? Number(cleaned) : null;
}

function buildDraft(doc) {
  return {
    category: doc?.coverageCategory || "otro",
    payer_type: doc?.coveragePayerType || "unknown",
    provider_name: doc?.coverageProviderName || "",
    entity_name: doc?.coverageEntityName || "",
    status: doc?.coverageStatus || "",
    amount_total: amountToInput(doc?.coverageAmounts?.total),
    amount_covered: amountToInput(doc?.coverageAmounts?.covered),
    amount_patient: amountToInput(doc?.coverageAmounts?.patient),
    amount_reimbursed: amountToInput(doc?.coverageAmounts?.reimbursed),
  };
}

// Lista agrupada por mes. Cada fila responde: qué es, de quién viene, cuánto
// costó y en qué estado está, sin obligar a abrir el documento.
export default function CoverageDocumentList({ documents, savingId, editError, onSave }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const groups = [];
  const groupIndex = new Map();

  useEffect(() => {
    if (!editingId) return;
    const currentDoc = (documents || []).find((doc) => doc.id === editingId);
    if (!currentDoc) {
      setEditingId(null);
      setDraft({});
    }
  }, [documents, editingId]);

  const startEditing = (doc) => {
    setEditingId(doc.id);
    setDraft(buildDraft(doc));
  };

  const handleDraftChange = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async (doc) => {
    if (!onSave) return;
    const saved = await onSave(doc.id, {
      category: draft.category || "otro",
      payer_type: draft.payer_type || "unknown",
      provider_name: draft.provider_name.trim(),
      entity_name: draft.entity_name.trim(),
      status: draft.status || "",
      amount_total: inputToAmount(draft.amount_total),
      amount_covered: inputToAmount(draft.amount_covered),
      amount_patient: inputToAmount(draft.amount_patient),
      amount_reimbursed: inputToAmount(draft.amount_reimbursed),
    });
    if (saved) {
      setEditingId(null);
      setDraft({});
    }
  };

  (documents || []).forEach((doc) => {
    const monthLabel = getMonthLabel(doc.date || doc.created_at);
    if (!groupIndex.has(monthLabel)) {
      groupIndex.set(monthLabel, groups.length);
      groups.push({ monthLabel, items: [] });
    }
    groups[groupIndex.get(monthLabel)].items.push(doc);
  });

  return (
    <div className="coverage-document-groups">
      {groups.map((group) => (
        <div className="coverage-document-group" key={group.monthLabel}>
          <span className="coverage-month-label">{group.monthLabel}</span>
          <div className="coverage-document-list">
            {group.items.map((doc) => {
              const category = getCoverageCategory(doc.coverageCategory);
              const status = getCoverageStatusInfo(doc.coverageStatus);
              const amountParts = buildAmountParts(doc.coverageAmounts);
              const isEditing = editingId === doc.id;
              const isSaving = savingId === doc.id;
              const entityLine = [
                doc.coverageEntity,
                doc.center ? cleanUiText(doc.center) : "",
              ]
                .filter(Boolean)
                .filter((value, index, list) => list.indexOf(value) === index)
                .join(" · ");
              return (
                <article className="coverage-document-row" key={doc.id}>
                  <span className="coverage-document-icon coverage-document-icon-emoji" aria-hidden>
                    {category?.icon || "🗂️"}
                  </span>
                  <div className="coverage-document-copy">
                    <h3>{cleanUiText(doc.filename, "Documento de cobertura")}</h3>
                    <div className="coverage-category-chip-row">
                      {category ? (
                        <span className="coverage-category-chip">{category.label}</span>
                      ) : null}
                      {entityLine ? (
                        <span className="coverage-entity-text">{entityLine}</span>
                      ) : null}
                    </div>
                    {amountParts.length ? (
                      <div className="coverage-document-amounts">
                        {amountParts.map((part) => (
                          <span key={part.label}>
                            {part.label} <strong>{part.value}</strong>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <small>{formatDay(doc.date || doc.created_at)}</small>
                  </div>
                  <div className="coverage-document-actions">
                    <span className={`coverage-document-status is-${status.tone}`}>{status.label}</span>
                    {onSave ? (
                      <button
                        type="button"
                        className="coverage-document-edit-btn"
                        onClick={() => (isEditing ? setEditingId(null) : startEditing(doc))}
                      >
                        {isEditing ? "Cerrar" : "Corregir"}
                      </button>
                    ) : null}
                  </div>
                  {isEditing ? (
                    <div className="coverage-document-edit-form">
                      <label>
                        <span>Categoría</span>
                        <select
                          value={draft.category}
                          onChange={(event) => handleDraftChange("category", event.target.value)}
                        >
                          {COVERAGE_CATEGORIES.map((item) => (
                            <option value={item.key} key={item.key}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Pagador</span>
                        <select
                          value={draft.payer_type}
                          onChange={(event) => handleDraftChange("payer_type", event.target.value)}
                        >
                          <option value="unknown">Sin definir</option>
                          {COVERAGE_PAYER_TYPES.map((item) => (
                            <option value={item.value} key={item.value}>
                              {item.label}
                            </option>
                          ))}
                          <option value="prestador">Prestador</option>
                        </select>
                      </label>
                      <label>
                        <span>Estado</span>
                        <select
                          value={draft.status}
                          onChange={(event) => handleDraftChange("status", event.target.value)}
                        >
                          {COVERAGE_STATUS_OPTIONS.map((item) => (
                            <option value={item.value} key={item.value || "guardado"}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Entidad</span>
                        <input
                          type="text"
                          value={draft.provider_name}
                          maxLength={120}
                          placeholder="Fonasa, Isapre o seguro"
                          onChange={(event) => handleDraftChange("provider_name", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Total</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={draft.amount_total}
                          placeholder="0"
                          onChange={(event) => handleDraftChange("amount_total", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Cubierto</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={draft.amount_covered}
                          placeholder="0"
                          onChange={(event) => handleDraftChange("amount_covered", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Copago</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={draft.amount_patient}
                          placeholder="0"
                          onChange={(event) => handleDraftChange("amount_patient", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Reembolso</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={draft.amount_reimbursed}
                          placeholder="0"
                          onChange={(event) => handleDraftChange("amount_reimbursed", event.target.value)}
                        />
                      </label>
                      {editError ? <p className="coverage-document-edit-error">{editError}</p> : null}
                      <div className="coverage-document-edit-actions">
                        <button
                          type="button"
                          className="primary-btn"
                          disabled={isSaving}
                          onClick={() => handleSave(doc)}
                        >
                          {isSaving ? "Guardando..." : "Guardar corrección"}
                        </button>
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={isSaving}
                          onClick={() => {
                            setEditingId(null);
                            setDraft({});
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
