import React from "react";
import { formatCoverageAmount } from "./coverageTaxonomy";

// Resumen compacto de cobertura: estado general y montos detectados en los
// documentos. Los montos vacíos se muestran como "Sin datos" para no inventar $0.
export default function CoverageSummary({ total, pending, categoriesCount, amountTotals, loading }) {
  const value = (number) => (loading ? "…" : number);
  const amountValue = (amount) => {
    if (loading) return "…";
    return formatCoverageAmount(amount) || "Sin datos";
  };
  const hasAmounts = Boolean(amountTotals?.hasAnyAmount);
  const amountItems = [
    { key: "total", label: "Total", value: amountTotals?.total, helper: "Cobros detectados" },
    { key: "covered", label: "Bonificado", value: amountTotals?.covered, helper: "Cubierto por previsión" },
    { key: "patient", label: "Copago", value: amountTotals?.patient, helper: "Pagado por ti" },
    { key: "reimbursed", label: "Reembolsado", value: amountTotals?.reimbursed, helper: "Devuelto registrado" },
  ];
  return (
    <section className="coverage-summary-stack" aria-label="Resumen de cobertura">
      <div className="coverage-stats-grid is-compact">
        <article className="coverage-stat">
          <span>Guardados</span>
          <strong>{value(total)}</strong>
          <small>Documentos de cobertura</small>
        </article>
        <article className="coverage-stat">
          <span>En trámite</span>
          <strong>{value(pending)}</strong>
          <small>Esperando respuesta o pago</small>
        </article>
        <article className="coverage-stat">
          <span>Categorías</span>
          <strong>{value(categoriesCount)}</strong>
          <small>Con al menos un documento</small>
        </article>
      </div>

      <div className={`coverage-amount-grid${!hasAmounts && !loading ? " is-empty" : ""}`} aria-label="Montos de cobertura">
        {amountItems.map((item) => (
          <article className="coverage-amount-card" key={item.key}>
            <span>{item.label}</span>
            <strong>{amountValue(item.value)}</strong>
            <small>{item.helper}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
