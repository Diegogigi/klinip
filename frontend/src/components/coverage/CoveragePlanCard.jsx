import React, { useEffect, useState } from "react";
import { cleanUiText } from "../../utils/textEncoding";
import { COVERAGE_PAYER_TYPES, KNOWN_ISAPRES, getPayerTypeLabel } from "./coverageTaxonomy";

const CONFIGURED_PAYERS = new Set(["fonasa", "isapre", "seguro_complementario", "none"]);

function needsProviderName(payerType) {
  return payerType === "isapre" || payerType === "seguro_complementario";
}

function providerPlaceholder(payerType) {
  if (payerType === "isapre") return "¿Cuál? Ej: Colmena";
  return "¿Cuál? Ej: MetLife";
}

// Tarjeta de previsión con edición en el lugar: Fonasa, Isapre o seguro
// complementario, más el nombre del plan si quieres tenerlo a mano.
export default function CoveragePlanCard({ preference, saving, error, onSave }) {
  const payerType = String(preference?.payer_type || "unknown").toLowerCase();
  const isConfigured = CONFIGURED_PAYERS.has(payerType);
  const [editing, setEditing] = useState(false);
  const [draftPayer, setDraftPayer] = useState(payerType);
  const [draftProvider, setDraftProvider] = useState(cleanUiText(preference?.provider_name || "", ""));
  const [draftPlan, setDraftPlan] = useState(cleanUiText(preference?.plan_name || "", ""));

  useEffect(() => {
    if (editing) return;
    setDraftPayer(CONFIGURED_PAYERS.has(payerType) ? payerType : "");
    setDraftProvider(cleanUiText(preference?.provider_name || "", ""));
    setDraftPlan(cleanUiText(preference?.plan_name || "", ""));
  }, [preference, payerType, editing]);

  const handleSave = async () => {
    if (!draftPayer) return;
    const provider = needsProviderName(draftPayer)
      ? draftProvider.trim()
      : draftPayer === "fonasa"
      ? "Fonasa"
      : "";
    const saved = await onSave({
      enabled: draftPayer !== "none",
      payer_type: draftPayer,
      provider_name: provider,
      plan_name: draftPlan.trim(),
    });
    if (saved) setEditing(false);
  };

  const providerLabel = cleanUiText(preference?.provider_name || "", "");
  const planLabel = cleanUiText(preference?.plan_name || "", "");
  const summaryTitle =
    payerType === "none"
      ? "Sin previsión configurada"
      : [getPayerTypeLabel(payerType), providerLabel && providerLabel !== getPayerTypeLabel(payerType) ? providerLabel : ""]
          .filter(Boolean)
          .join(" ") || "Previsión sin definir";

  if (!editing) {
    return (
      <section className="coverage-plan-card" aria-label="Tu previsión">
        <span className="coverage-plan-icon" aria-hidden>
          {payerType === "fonasa" ? "🏥" : payerType === "isapre" ? "💳" : payerType === "seguro_complementario" ? "➕" : "🩵"}
        </span>
        <div className="coverage-plan-copy">
          {isConfigured ? (
            <>
              <strong>Tu previsión: {summaryTitle}</strong>
              <span>
                {planLabel
                  ? `Plan: ${planLabel}. `
                  : ""}
                Klinip la usa para ordenar tus bonos, reembolsos y licencias.
              </span>
            </>
          ) : (
            <>
              <strong>¿Cuál es tu previsión?</strong>
              <span>Cuéntanos si tienes Fonasa, Isapre o un seguro y ordenamos tus documentos según eso.</span>
            </>
          )}
        </div>
        <button type="button" className="coverage-plan-edit-btn" onClick={() => setEditing(true)}>
          {isConfigured ? "Editar" : "Configurar"}
        </button>
      </section>
    );
  }

  return (
    <section className="coverage-plan-card is-editing" aria-label="Editar tu previsión">
      <div className="coverage-plan-form">
        <strong className="coverage-plan-form-title">¿Cuál es tu previsión?</strong>
        <div className="coverage-payer-options" role="radiogroup" aria-label="Tipo de previsión">
          {COVERAGE_PAYER_TYPES.map((payer) => (
            <button
              key={payer.value}
              type="button"
              role="radio"
              aria-checked={draftPayer === payer.value}
              className={`coverage-payer-option${draftPayer === payer.value ? " is-active" : ""}`}
              onClick={() => setDraftPayer(payer.value)}
            >
              <strong>{payer.label}</strong>
              <span>{payer.helper}</span>
            </button>
          ))}
        </div>

        {needsProviderName(draftPayer) ? (
          <label className="coverage-plan-field">
            <span>{draftPayer === "isapre" ? "Nombre de tu Isapre" : "Compañía del seguro"}</span>
            <input
              type="text"
              value={draftProvider}
              maxLength={120}
              placeholder={providerPlaceholder(draftPayer)}
              list={draftPayer === "isapre" ? "coverage-isapre-options" : undefined}
              onChange={(event) => setDraftProvider(event.target.value)}
            />
            {draftPayer === "isapre" ? (
              <datalist id="coverage-isapre-options">
                {KNOWN_ISAPRES.map((name) => (
                  <option value={name} key={name} />
                ))}
              </datalist>
            ) : null}
          </label>
        ) : null}

        {draftPayer && draftPayer !== "none" ? (
          <label className="coverage-plan-field">
            <span>Nombre del plan (opcional)</span>
            <input
              type="text"
              value={draftPlan}
              maxLength={120}
              placeholder="Como aparece en tu contrato o cartola"
              onChange={(event) => setDraftPlan(event.target.value)}
            />
          </label>
        ) : null}

        {error ? <p className="coverage-plan-error">{error}</p> : null}

        <div className="coverage-plan-actions">
          <button
            type="button"
            className="primary-btn"
            disabled={saving || !draftPayer}
            onClick={handleSave}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            Cancelar
          </button>
        </div>
      </div>
    </section>
  );
}
