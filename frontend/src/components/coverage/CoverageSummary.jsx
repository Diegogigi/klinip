import React from "react";

// Resumen compacto de cobertura: tres números que responden "¿cuánto tengo
// guardado, qué falta revisar y qué tan variado es?" sin tecnicismos.
export default function CoverageSummary({ total, pending, categoriesCount, loading }) {
  const value = (number) => (loading ? "…" : number);
  return (
    <section className="coverage-stats-grid is-compact" aria-label="Resumen de cobertura">
      <article className="coverage-stat">
        <span>Guardados</span>
        <strong>{value(total)}</strong>
        <small>Documentos de cobertura</small>
      </article>
      <article className="coverage-stat">
        <span>En lectura</span>
        <strong>{value(pending)}</strong>
        <small>Klinip los está leyendo</small>
      </article>
      <article className="coverage-stat">
        <span>Categorías</span>
        <strong>{value(categoriesCount)}</strong>
        <small>Con al menos un documento</small>
      </article>
    </section>
  );
}
