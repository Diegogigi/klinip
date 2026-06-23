import React from "react";
import { createPortal } from "react-dom";

/**
 * Hoja de confirmación reutilizable (check verde + tarjeta resumen), con el mismo
 * estilo nativo que usa la confirmación de citas. Se usa al crear/guardar
 * medicamentos, documentos y citas, contextualizada a cada sección.
 *
 * Props:
 *  - open, onClose
 *  - kicker:   texto pequeño superior (ej. "Medicamento agregado")
 *  - title:    título grande (ej. "Todo listo")
 *  - copy:     descripción
 *  - referenceId: número de referencia opcional (#id)
 *  - rows:     [{ icon: "profile"|"calendar"|"building"|"clock"|"pill"|"doc", label, value }]
 *  - primaryLabel / onPrimary:   botón principal (ej. "Ver detalle")
 *  - secondaryLabel:             botón secundario (cierra; ej. "Volver a medicamentos")
 */

function rowIcon(type) {
  const p = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  switch (type) {
    case "profile":
      return (
        <svg {...p}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "building":
      return (
        <svg {...p}>
          <path d="M3 21h18" />
          <path d="M5 21V7l7-4 7 4v14" />
          <path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
        </svg>
      );
    case "clock":
      return (
        <svg {...p}>
          <path d="M12 6v6l4 2" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "pill":
      return (
        <svg {...p}>
          <rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(45 12 12)" />
          <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
        </svg>
      );
    case "doc":
      return (
        <svg {...p}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

export default function SuccessSheet({
  open,
  onClose,
  kicker,
  title = "Todo listo",
  copy,
  referenceId,
  rows = [],
  primaryLabel,
  onPrimary,
  secondaryLabel = "Cerrar",
}) {
  if (!open) return null;

  return createPortal(
    <div className="native-sheet-backdrop" onClick={onClose}>
      <div
        className="native-sheet native-success-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="native-sheet-grabber" aria-hidden />

        <div className="native-success-hero">
          <div className="native-success-icon" aria-hidden>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          {kicker ? <p className="native-success-kicker">{kicker}</p> : null}
          <h3 className="native-success-title">{title}</h3>
          {copy ? <p className="native-success-copy">{copy}</p> : null}
          {referenceId ? (
            <p className="native-success-ref">
              Referencia <strong>#{referenceId}</strong>
            </p>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <div className="native-sheet-body">
            <div className="native-info-card">
              {rows.map((row, index) => (
                <React.Fragment key={`${row.label}-${index}`}>
                  {index > 0 ? <div className="native-info-divider" /> : null}
                  <div className="native-info-row">
                    <span className="native-info-icon" aria-hidden>
                      {rowIcon(row.icon)}
                    </span>
                    <div className="native-info-content">
                      <span className="native-info-label">{row.label}</span>
                      <span className="native-info-value">{row.value}</span>
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        ) : null}

        <div className="native-sheet-footer">
          {onPrimary && primaryLabel ? (
            <button
              className="native-btn native-btn-primary"
              type="button"
              onClick={onPrimary}
            >
              {primaryLabel}
            </button>
          ) : null}
          <button className="native-btn native-btn-ghost" type="button" onClick={onClose}>
            {secondaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.getElementById("overlay-root") || document.body,
  );
}
