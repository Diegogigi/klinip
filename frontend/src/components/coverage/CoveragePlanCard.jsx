import React, { useMemo } from "react";
import { cleanUiText } from "../../utils/textEncoding";
import { readCoveragePreference } from "./coverageTaxonomy";

// Tarjeta de previsión: muestra la Isapre/Fonasa declarada en el onboarding o
// las entidades detectadas en los documentos. Si no hay nada, no ocupa espacio.
export default function CoveragePlanCard({ detectedInsurers = [] }) {
  const preference = useMemo(() => readCoveragePreference(), []);
  const declaredProvider = cleanUiText(preference?.provider || "", "").trim();
  const detected = (detectedInsurers || []).filter(Boolean);

  if (!declaredProvider && detected.length === 0) return null;

  return (
    <section className="coverage-plan-card" aria-label="Tu previsión">
      <span className="coverage-plan-icon" aria-hidden>
        🩵
      </span>
      <div className="coverage-plan-copy">
        <strong>
          {declaredProvider
            ? `Tu previsión: ${declaredProvider}`
            : `Detectamos: ${detected.join(", ")}`}
        </strong>
        <span>
          {declaredProvider
            ? "Klinip la usa para ordenar tus documentos de cobertura."
            : "Aparece en tus documentos. Klinip la usa para ordenarlos."}
        </span>
      </div>
    </section>
  );
}
