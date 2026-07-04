import React from "react";
import { cleanUiText } from "../../utils/textEncoding";
import { getCoverageCategory } from "./coverageTaxonomy";

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

function getStatusInfo(status) {
  const key = String(status || "").toLowerCase();
  if (key === "done") return { label: "Listo", tone: "ok" };
  if (key === "pending" || key === "processing") return { label: "En lectura", tone: "info" };
  if (key.startsWith("error")) return { label: "Revisar", tone: "warn" };
  return { label: "Guardado", tone: "muted" };
}

// Lista agrupada por mes. Cada fila responde: qué es, de quién viene, cuándo
// fue y en qué estado está — sin obligar a abrir el documento.
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
              const categories = (doc.coverageCategories || [])
                .map((key) => getCoverageCategory(key))
                .filter(Boolean);
              const primaryIcon = categories[0]?.icon || "🗂️";
              const status = getStatusInfo(doc.ocr_status);
              const entityLine = [
                doc.coverageInsurer,
                doc.center ? cleanUiText(doc.center) : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <article className="coverage-document-row" key={doc.id}>
                  <span className="coverage-document-icon coverage-document-icon-emoji" aria-hidden>
                    {primaryIcon}
                  </span>
                  <div className="coverage-document-copy">
                    <h3>{cleanUiText(doc.filename, "Documento de cobertura")}</h3>
                    {categories.length ? (
                      <div className="coverage-category-chip-row">
                        {categories.map((category) => (
                          <span className="coverage-category-chip" key={category.key}>
                            {category.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <small>
                      {formatDay(doc.date || doc.created_at)}
                      {entityLine ? ` · ${entityLine}` : ""}
                    </small>
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
