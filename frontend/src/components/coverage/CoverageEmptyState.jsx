import React from "react";
import { getCoverageCategory } from "./coverageTaxonomy";

// Estado vacío con copy según contexto: sin documentos aún, o sin resultados
// para la categoría filtrada.
export default function CoverageEmptyState({ activeFilter, hasAnyCoverage, onUpload }) {
  if (hasAnyCoverage && activeFilter !== "todos") {
    const category = getCoverageCategory(activeFilter);
    return (
      <div className="coverage-empty">
        <strong>Nada guardado en {category?.label || "esta categoría"} todavía.</strong>
        <span>
          Cuando subas un documento de este tipo, Klinip lo dejará ordenado aquí automáticamente.
        </span>
      </div>
    );
  }

  return (
    <div className="coverage-empty">
      <strong>Empieza subiendo tu primer documento de cobertura.</strong>
      <span>
        Puede ser un bono, un reembolso, una licencia médica, una carta GES/CAEC o tu plan de salud.
        Al subirlo, elige la opción "Cobertura / seguro" y Klinip lo ordena por ti.
      </span>
      <button type="button" className="health-hub-hero-secondary" onClick={onUpload}>
        Subir documento
      </button>
    </div>
  );
}
