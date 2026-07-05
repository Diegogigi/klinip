import React from "react";
import { COVERAGE_CATEGORIES } from "./coverageTaxonomy";

// Fila de filtros por categoría. En móvil se desplaza horizontal para no
// ocupar media pantalla; cada chip muestra cuántos documentos tiene.
// "Otros" solo aparece cuando tiene algo, para no agregar ruido.
export default function CoverageFilters({ counts, total, active, onSelect }) {
  const visibleCategories = COVERAGE_CATEGORIES.filter(
    (category) => category.key !== "otro" || (counts?.otro || 0) > 0
  );
  return (
    <div className="coverage-filter-row" role="tablist" aria-label="Filtrar por categoría">
      <button
        type="button"
        role="tab"
        aria-selected={active === "todos"}
        className={`coverage-filter-chip${active === "todos" ? " is-active" : ""}`}
        onClick={() => onSelect("todos")}
      >
        Todos
        <span className="coverage-filter-count">{total}</span>
      </button>
      {visibleCategories.map((category) => (
        <button
          key={category.key}
          type="button"
          role="tab"
          aria-selected={active === category.key}
          className={`coverage-filter-chip${active === category.key ? " is-active" : ""}`}
          onClick={() => onSelect(category.key)}
        >
          <span aria-hidden>{category.icon}</span> {category.label}
          <span className="coverage-filter-count">{counts?.[category.key] || 0}</span>
        </button>
      ))}
    </div>
  );
}
