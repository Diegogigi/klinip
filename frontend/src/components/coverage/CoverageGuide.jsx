import React from "react";
import { COVERAGE_CATEGORIES } from "./coverageTaxonomy";

// Guía plegable en lenguaje simple: qué es cada documento y para qué sirve
// guardarlo. Cerrada por defecto para mantener la página compacta en móvil.
export default function CoverageGuide() {
  const categories = COVERAGE_CATEGORIES.filter((category) => category.key !== "otro");
  return (
    <section className="coverage-section coverage-guide">
      <div className="health-hub-section-head">
        <div>
          <h2>¿Qué guardo en cada categoría?</h2>
          <p>Toca una categoría para ver qué documentos van ahí y por qué conviene guardarlos.</p>
        </div>
      </div>
      <div className="coverage-guide-list">
        {categories.map((category) => (
          <details className="coverage-guide-item" key={category.key}>
            <summary>
              <span aria-hidden>{category.icon}</span> {category.guideTitle}
            </summary>
            <p>{category.guideWhat}</p>
            <p className="coverage-guide-why">{category.guideWhy}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
