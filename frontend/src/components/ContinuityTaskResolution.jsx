import React, { useState } from "react";
import { updateContinuityTask } from "../services/httpApi";
import { notifyClinicalDataChanged } from "../utils/clinicalRefresh";

function buildSnoozeDate(days = 7) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

function buildResolutionPayload(status, recordLabel) {
  if (status === "done") {
    return {
      status: "done",
      note: `Marcado como hecho desde el detalle de ${recordLabel}`,
    };
  }
  if (status === "cancelled") {
    return {
      status: "cancelled",
      note: `Descartado desde el detalle de ${recordLabel}`,
    };
  }
  return {
    status: "pending",
    due_at: buildSnoozeDate(7),
    note: `Pospuesto desde el detalle de ${recordLabel}`,
  };
}

export default function ContinuityTaskResolution({
  profileId,
  taskId,
  recordLabel = "este registro",
  canUpdate = true,
  onUpdated,
}) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (!profileId || !taskId) return null;

  const handleUpdate = async (status) => {
    if (busy || !canUpdate) return;
    setBusy(status);
    setError("");
    setMessage("");
    try {
      await updateContinuityTask(profileId, taskId, buildResolutionPayload(status, recordLabel));
      notifyClinicalDataChanged({
        profileId,
        sources: ["continuity", "health-sheet"],
      });
      setMessage(
        status === "done"
          ? "Pendiente marcado como hecho."
          : status === "cancelled"
            ? "Pendiente descartado."
            : "Pendiente pospuesto por 7 días."
      );
      if (typeof onUpdated === "function") onUpdated(status);
    } catch {
      setError("No se pudo actualizar el pendiente. Intenta nuevamente.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className={`continuity-resolution${message ? " is-resolved" : ""}`}>
      <div className="continuity-resolution-copy">
        <span>Continuidad</span>
        <strong>¿Qué debes hacer aquí?</strong>
        <p>
          Revisa {recordLabel}. Si ya quedó resuelto, márcalo como hecho; si lo harás después,
          posponlo. Si ya no corresponde, descártalo.
        </p>
        {message ? <small className="continuity-resolution-ok">{message}</small> : null}
        {error ? <small className="continuity-resolution-error">{error}</small> : null}
        {!canUpdate ? (
          <small className="continuity-resolution-muted">
            Tienes acceso de lectura. Un cuidador autorizado puede cerrar este pendiente.
          </small>
        ) : null}
      </div>
      {canUpdate ? (
        <div className="continuity-resolution-actions">
          <button
            type="button"
            className="continuity-resolution-btn is-done"
            disabled={Boolean(busy)}
            onClick={() => handleUpdate("done")}
          >
            {busy === "done" ? "Guardando..." : "Hecho"}
          </button>
          <button
            type="button"
            className="continuity-resolution-btn"
            disabled={Boolean(busy)}
            onClick={() => handleUpdate("pending")}
          >
            {busy === "pending" ? "Posponiendo..." : "Posponer"}
          </button>
          <button
            type="button"
            className="continuity-resolution-btn is-cancel"
            disabled={Boolean(busy)}
            onClick={() => handleUpdate("cancelled")}
          >
            {busy === "cancelled" ? "Descartando..." : "Descartar"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
