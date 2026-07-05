import React from "react";
import { cleanUiText } from "../../utils/textEncoding";
import {
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

// Lista agrupada por mes. Cada fila responde: qué es, de quién viene, cuánto
// costó y en qué estado está, sin obligar a abrir el documento.
export default function CoverageDocumentList({ documents }) {
  const groups = [];
  const groupIndex = new Map();
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
                  <span className={`coverage-document-status is-${status.tone}`}>{status.label}</span>
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
