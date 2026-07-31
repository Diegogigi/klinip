import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelDevicePairing,
  createDeviceMessage,
  createDevicePairing,
  getDeviceMessages,
  getDevicePairing,
  getLinkedDevices,
  revokeDeviceMessage,
  revokeLinkedDevice,
  updateLinkedDevice,
} from "../api";
import {
  DEVICE_SCOPES,
  MESSAGE_STATE_LABELS,
  PAIRING_STATE_LABELS,
  canManageDevices,
  canSendDeviceMessages,
  createIdempotencyKey,
  formatCountdown,
  getDeviceDisplayState,
  getMessageDisplayState,
  secondsUntil,
} from "../utils/klinipOneUi";
import "./KlinipOne.css";

const MESSAGE_MAX_LENGTH = 1000;

function formatDate(value) {
  if (!value) return "Sin actividad registrada";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (detail === "profile_not_authorized") {
    return "No tienes permiso para realizar esta acción en este perfil.";
  }
  if (["device_revoked", "target_device_not_eligible"].includes(detail)) {
    return "El dispositivo ya no está vinculado.";
  }
  if (detail === "message_not_authorized") {
    return "No tienes permiso para gestionar este mensaje.";
  }
  if (detail === "no_eligible_devices") {
    return "No hay dispositivos vinculados disponibles.";
  }
  if (detail === "invalid_message_body") {
    return "El mensaje está vacío o es demasiado largo.";
  }
  if (detail === "idempotency_conflict") {
    return "El mensaje cambió antes de enviarse. Revísalo e inténtalo nuevamente.";
  }
  if (detail === "message_creation_failed" || error?.response?.status === 503) {
    return "No se pudo conectar con Klinip. Inténtalo nuevamente.";
  }
  if (error?.response?.status === 401) {
    return "Tu sesión terminó. Inicia sesión nuevamente.";
  }
  if (!error?.response) {
    return "No se pudo conectar con Klinip. Inténtalo nuevamente.";
  }
  if (error?.response?.status === 422) {
    return "Revisa el mensaje y los datos seleccionados.";
  }
  return fallback;
}

function StatusPill({ children, tone = "neutral" }) {
  return <span className={`ko-status ko-status-${tone}`}>{children}</span>;
}

function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="ko-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="ko-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ko-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="ko-dialog-title">{title}</h2>
        <div className="ko-dialog-content">{children}</div>
        <div className="ko-dialog-actions">
          <button
            ref={cancelRef}
            className="ko-btn ko-btn-secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            className={`ko-btn ${danger ? "ko-btn-danger" : "ko-btn-primary"}`}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Procesando..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="ko-empty">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export default function KlinipOne({
  user,
  healthProfiles = [],
  activeProfileId,
}) {
  const manageableProfiles = useMemo(
    () =>
      healthProfiles.filter(
        (profile) =>
          !profile.is_archived && canManageDevices(profile, user?.id),
      ),
    [healthProfiles, user?.id],
  );
  const messageProfiles = useMemo(
    () =>
      healthProfiles.filter(
        (profile) =>
          !profile.is_archived && canSendDeviceMessages(profile, user?.id),
      ),
    [healthProfiles, user?.id],
  );
  const preferredManageProfile =
    manageableProfiles.find(
      (profile) => Number(profile.id) === Number(activeProfileId),
    ) || manageableProfiles[0];
  const preferredMessageProfile =
    messageProfiles.find(
      (profile) => Number(profile.id) === Number(activeProfileId),
    ) || messageProfiles[0];

  const [view, setView] = useState("home");
  const [manageProfileId, setManageProfileId] = useState(
    preferredManageProfile?.id || "",
  );
  const [messageProfileId, setMessageProfileId] = useState(
    preferredMessageProfile?.id || "",
  );
  const [devices, setDevices] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pairing, setPairing] = useState(null);
  const [pairingSeconds, setPairingSeconds] = useState(0);
  const [creatingPairing, setCreatingPairing] = useState(false);
  const [pairingLabel, setPairingLabel] = useState("Klinip One hogar");
  const [editingDevice, setEditingDevice] = useState(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [revokingDevice, setRevokingDevice] = useState(null);
  const [busyDeviceAction, setBusyDeviceAction] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(null);
  const [targetDeviceId, setTargetDeviceId] = useState("all");
  const [expiresInSeconds, setExpiresInSeconds] = useState(7 * 24 * 60 * 60);
  const [sendStep, setSendStep] = useState(1);
  const [sendFieldError, setSendFieldError] = useState("");
  const [sendComplete, setSendComplete] = useState(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState("");
  const [revokingMessage, setRevokingMessage] = useState(null);
  const [expandedMessageId, setExpandedMessageId] = useState("");

  useEffect(() => {
    if (!manageProfileId && preferredManageProfile?.id) {
      setManageProfileId(preferredManageProfile.id);
    }
  }, [manageProfileId, preferredManageProfile?.id]);

  useEffect(() => {
    if (!messageProfileId && preferredMessageProfile?.id) {
      setMessageProfileId(preferredMessageProfile.id);
    }
  }, [messageProfileId, preferredMessageProfile?.id]);

  async function loadDevices({ quiet = false } = {}) {
    if (!quiet) setLoadingDevices(true);
    try {
      const result = await getLinkedDevices();
      setDevices(Array.isArray(result) ? result : []);
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "No pudimos cargar los dispositivos vinculados.",
        ),
      );
    } finally {
      if (!quiet) setLoadingDevices(false);
    }
  }

  async function loadMessages(profileId = messageProfileId) {
    if (!profileId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    try {
      const result = await getDeviceMessages(profileId, { limit: 50 });
      setMessages(result?.items || []);
    } catch (requestError) {
      setMessages([]);
      setError(
        errorMessage(
          requestError,
          "No pudimos cargar los mensajes familiares.",
        ),
      );
    } finally {
      setLoadingMessages(false);
    }
  }

  useEffect(() => {
    loadDevices();
  }, []);

  useEffect(() => {
    if (messageProfileId) loadMessages(messageProfileId);
  }, [messageProfileId]);

  useEffect(() => {
    if (!pairing?.pairing_id || pairing.status !== "pending") return undefined;
    const updateCountdown = () => {
      const remaining = secondsUntil(pairing.expires_at);
      setPairingSeconds(remaining);
      if (remaining === 0) {
        setPairing((current) =>
          current?.status === "pending"
            ? { ...current, status: "expired" }
            : current,
        );
      }
    };
    updateCountdown();
    const countdownId = window.setInterval(updateCountdown, 1000);
    const pollId = window.setInterval(async () => {
      try {
        const current = await getDevicePairing(pairing.pairing_id);
        setPairing((previous) => ({ ...previous, ...current }));
        if (current.status === "claimed") {
          setNotice("Dispositivo vinculado correctamente.");
          loadDevices({ quiet: true });
        }
      } catch {
        // El próximo refresco manual conserva una salida segura.
      }
    }, 3000);
    return () => {
      window.clearInterval(countdownId);
      window.clearInterval(pollId);
    };
  }, [pairing?.pairing_id, pairing?.status]);

  const selectedMessageProfile = messageProfiles.find(
    (profile) => Number(profile.id) === Number(messageProfileId),
  );
  const profileDevices = devices.filter(
    (device) =>
      Number(device.profile_id) === Number(messageProfileId) &&
      device.status !== "revoked",
  );
  const visibleDevices = devices.filter(
    (device) => Number(device.profile_id) === Number(manageProfileId),
  );
  const canSelectSpecificDevice = canManageDevices(
    selectedMessageProfile,
    user?.id,
  );
  const hasMessageTarget =
    profileDevices.length > 0 || !canSelectSpecificDevice;
  const activeDeviceCount = devices.filter(
    (device) => device.status !== "revoked",
  ).length;
  const selectedTargetLabel =
    targetDeviceId === "all"
      ? canSelectSpecificDevice
        ? `Todos los dispositivos vinculados (${profileDevices.length})`
        : "Todos los dispositivos autorizados"
      : profileDevices.find((device) => device.device_id === targetDeviceId)
          ?.label || "Dispositivo seleccionado";

  function openView(nextView) {
    setView(nextView);
    setError("");
    setNotice("");
    if (nextView === "send") {
      setSendStep(1);
      setSendFieldError("");
      setSendComplete(null);
    }
  }

  function continueSendFlow() {
    setSendFieldError("");
    if (sendStep === 1 && (!messageProfileId || !hasMessageTarget)) {
      setSendFieldError("Selecciona una persona con un dispositivo vinculado.");
      return;
    }
    if (sendStep === 2 && !messageBody.trim()) {
      setSendFieldError("Escribe un mensaje antes de continuar.");
      return;
    }
    if (sendStep === 3 && requiresAcknowledgement === null) {
      setSendFieldError("Selecciona una opción para continuar.");
      return;
    }
    if (sendStep === 3) {
      setPendingIdempotencyKey(createIdempotencyKey());
    }
    setSendStep((current) => Math.min(4, current + 1));
  }

  function previousSendStep() {
    setSendFieldError("");
    setError("");
    setSendStep((current) => Math.max(1, current - 1));
  }

  async function handleCreatePairing() {
    if (!manageProfileId) return;
    setCreatingPairing(true);
    setError("");
    setNotice("");
    try {
      const result = await createDevicePairing({
        health_profile_id: Number(manageProfileId),
        label: pairingLabel.trim() || "Klinip One",
        requested_scopes: DEVICE_SCOPES,
        protocol_version: 1,
        expires_in_seconds: 300,
      });
      setPairing({ ...result, status: "pending" });
      setPairingSeconds(secondsUntil(result.expires_at));
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "No pudimos generar el código de vinculación.",
        ),
      );
    } finally {
      setCreatingPairing(false);
    }
  }

  async function handleCancelPairing() {
    if (!pairing?.pairing_id) return;
    try {
      await cancelDevicePairing(pairing.pairing_id);
      setPairing((current) => ({ ...current, status: "cancelled" }));
      setNotice("Código cancelado.");
    } catch (requestError) {
      setError(
        errorMessage(requestError, "No pudimos cancelar este código."),
      );
    }
  }

  async function handleCopyPairingCode() {
    try {
      await navigator.clipboard.writeText(pairing.pairing_code);
      setNotice("Código copiado.");
    } catch {
      setError("No pudimos copiar el código. Puedes ingresarlo manualmente.");
    }
  }

  async function handleRenameDevice() {
    if (!editingDevice || !deviceLabel.trim()) return;
    setBusyDeviceAction(true);
    try {
      const updated = await updateLinkedDevice(editingDevice.device_id, {
        label: deviceLabel,
      });
      setDevices((current) =>
        current.map((item) =>
          item.device_id === updated.device_id ? updated : item,
        ),
      );
      setEditingDevice(null);
      setNotice("Nombre actualizado.");
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "No pudimos cambiar el nombre del dispositivo.",
        ),
      );
    } finally {
      setBusyDeviceAction(false);
    }
  }

  async function handleRevokeDevice() {
    if (!revokingDevice) return;
    setBusyDeviceAction(true);
    try {
      await revokeLinkedDevice(revokingDevice.device_id);
      await loadDevices({ quiet: true });
      setRevokingDevice(null);
      setNotice("Acceso del dispositivo revocado.");
    } catch (requestError) {
      setError(
        errorMessage(requestError, "No pudimos revocar este dispositivo."),
      );
    } finally {
      setBusyDeviceAction(false);
    }
  }

  async function handleSendMessage() {
    if (sendingMessage) return;
    setSendingMessage(true);
    setError("");
    try {
      const targetIds =
        targetDeviceId === "all" ? null : [targetDeviceId];
      await createDeviceMessage(
        Number(messageProfileId),
        {
          body: messageBody.trim(),
          requires_acknowledgement: Boolean(requiresAcknowledgement),
          expires_in_seconds: Number(expiresInSeconds),
          target_device_ids: targetIds,
          protocol_version: 1,
        },
        pendingIdempotencyKey || createIdempotencyKey(),
      );
      setSendComplete({
        recipientName: selectedMessageProfile?.full_name || "la persona",
        requiresAcknowledgement: Boolean(requiresAcknowledgement),
      });
      setPendingIdempotencyKey("");
      setMessageBody("");
      setSendStep(1);
      await loadMessages(messageProfileId);
    } catch (requestError) {
      setError(
        errorMessage(requestError, "No pudimos enviar el mensaje."),
      );
    } finally {
      setSendingMessage(false);
    }
  }

  async function handleRevokeMessage() {
    if (!revokingMessage) return;
    setBusyDeviceAction(true);
    try {
      await revokeDeviceMessage(
        Number(messageProfileId),
        revokingMessage.message_id,
      );
      setRevokingMessage(null);
      setNotice("Mensaje revocado.");
      await loadMessages(messageProfileId);
    } catch (requestError) {
      setError(
        errorMessage(requestError, "No pudimos revocar este mensaje."),
      );
    } finally {
      setBusyDeviceAction(false);
    }
  }

  return (
    <div className="ko-page">
      <header className="ko-page-header">
        <div>
          <p className="ko-eyebrow">Klinip One</p>
          <h1>
            {view === "home" && "Conexión familiar"}
            {view === "send" && "Enviar mensaje"}
            {view === "messages" && "Mensajes enviados"}
            {view === "devices" && "Dispositivos vinculados"}
          </h1>
          <p>
            {view === "home" && "Elige qué necesitas hacer."}
            {view === "send" && "Completa un paso a la vez."}
            {view === "messages" && "Revisa el estado de cada mensaje."}
            {view === "devices" && "Administra el acceso de Klinip One."}
          </p>
        </div>
        {view !== "home" && (
          <button
            className="ko-btn ko-btn-secondary ko-home-button"
            type="button"
            onClick={() => openView("home")}
          >
            Volver al inicio
          </button>
        )}
      </header>

      {(notice || error) && (
        <div
          className={`ko-alert ${error ? "ko-alert-error" : "ko-alert-success"}`}
          role={error ? "alert" : "status"}
        >
          <span>{error || notice}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            ×
          </button>
        </div>
      )}

      {view === "home" && (
        <section className="ko-action-grid" aria-label="Acciones de Klinip One">
          <button
            className="ko-action-card ko-action-card-primary"
            type="button"
            onClick={() => openView("send")}
          >
            <span className="ko-action-number" aria-hidden="true">
              1
            </span>
            <strong>Enviar mensaje</strong>
            <span>Nuevo mensaje familiar</span>
          </button>
          <button
            className="ko-action-card"
            type="button"
            onClick={() => openView("messages")}
          >
            <span className="ko-action-number" aria-hidden="true">
              2
            </span>
            <strong>Ver mensajes enviados</strong>
            <span>
              {messages.length === 1
                ? "1 mensaje"
                : `${messages.length} mensajes`}
            </span>
          </button>
          <button
            className="ko-action-card"
            type="button"
            onClick={() => openView("devices")}
          >
            <span className="ko-action-number" aria-hidden="true">
              3
            </span>
            <strong>Dispositivos vinculados</strong>
            <span>
              {activeDeviceCount === 1
                ? "1 dispositivo"
                : `${activeDeviceCount} dispositivos`}
            </span>
          </button>
        </section>
      )}

      {view === "send" && (
        <section className="ko-wizard" aria-labelledby="ko-send-title">
          {sendComplete ? (
            <div className="ko-send-success" role="status">
              <span className="ko-success-mark" aria-hidden="true">
                ✓
              </span>
              <h2>Mensaje enviado a {sendComplete.recipientName}.</h2>
              {sendComplete.requiresAcknowledgement && (
                <p>
                  Te avisaremos cuando {sendComplete.recipientName} lo confirme.
                </p>
              )}
              <div className="ko-wizard-actions">
                <button
                  className="ko-btn ko-btn-primary"
                  type="button"
                  onClick={() => openView("messages")}
                >
                  Ver mensajes enviados
                </button>
                <button
                  className="ko-btn ko-btn-secondary"
                  type="button"
                  onClick={() => openView("home")}
                >
                  Volver al inicio
                </button>
              </div>
            </div>
          ) : (
            <>
              <ol className="ko-steps" aria-label="Progreso del envío">
                {[1, 2, 3, 4].map((step) => (
                  <li
                    key={step}
                    className={step === sendStep ? "is-current" : ""}
                    aria-current={step === sendStep ? "step" : undefined}
                  >
                    <span>{step}</span>
                    <small>
                      {step === 1 && "Persona"}
                      {step === 2 && "Mensaje"}
                      {step === 3 && "Confirmación"}
                      {step === 4 && "Revisar"}
                    </small>
                  </li>
                ))}
              </ol>

              <div className="ko-wizard-panel">
                {sendStep === 1 && (
                  <div className="ko-step-content">
                    <div>
                      <p className="ko-step-label">Paso 1 de 4</p>
                      <h2 id="ko-send-title">
                        ¿A quién quieres enviar el mensaje?
                      </h2>
                    </div>
                    {!messageProfiles.length ? (
                      <EmptyState
                        title="Sin perfiles disponibles"
                        text="No tienes permiso para enviar mensajes."
                      />
                    ) : (
                      <fieldset className="ko-choice-group">
                        <legend className="sr-only">Selecciona una persona</legend>
                        {messageProfiles.map((profile) => (
                          <label className="ko-choice-card" key={profile.id}>
                            <input
                              type="radio"
                              name="message-profile"
                              value={profile.id}
                              checked={
                                Number(messageProfileId) === Number(profile.id)
                              }
                              onChange={(event) => {
                                setMessageProfileId(event.target.value);
                                setTargetDeviceId("all");
                                setSendFieldError("");
                              }}
                            />
                            <span className="ko-choice-indicator" />
                            <span>
                              <strong>{profile.full_name}</strong>
                              <small>Perfil familiar</small>
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    )}

                    {messageProfileId && (
                      <div className="ko-delivery-target">
                        <strong>Se enviará a</strong>
                        <span>{selectedTargetLabel}</span>
                        {canSelectSpecificDevice && profileDevices.length > 1 && (
                          <label className="ko-field">
                            <span>Elegir dispositivo</span>
                            <select
                              value={targetDeviceId}
                              onChange={(event) =>
                                setTargetDeviceId(event.target.value)
                              }
                            >
                              <option value="all">
                                Todos los dispositivos vinculados
                              </option>
                              {profileDevices.map((device) => (
                                <option
                                  key={device.device_id}
                                  value={device.device_id}
                                >
                                  {device.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    )}
                    {!hasMessageTarget && messageProfileId && (
                      <p className="ko-field-error" role="alert">
                        No hay dispositivos vinculados disponibles.
                      </p>
                    )}
                  </div>
                )}

                {sendStep === 2 && (
                  <div className="ko-step-content">
                    <div>
                      <p className="ko-step-label">Paso 2 de 4</p>
                      <h2 id="ko-send-title">Escribe tu mensaje</h2>
                    </div>
                    <label className="ko-field ko-message-field">
                      <span>Mensaje para {selectedMessageProfile?.full_name}</span>
                      <textarea
                        autoFocus
                        value={messageBody}
                        rows={7}
                        maxLength={MESSAGE_MAX_LENGTH}
                        placeholder="Escribe aquí tu mensaje"
                        onChange={(event) => {
                          setMessageBody(event.target.value);
                          setSendFieldError("");
                        }}
                        aria-describedby="ko-message-count"
                      />
                      <small id="ko-message-count">
                        {messageBody.length} de {MESSAGE_MAX_LENGTH} caracteres
                      </small>
                    </label>
                  </div>
                )}

                {sendStep === 3 && (
                  <div className="ko-step-content">
                    <div>
                      <p className="ko-step-label">Paso 3 de 4</p>
                      <h2 id="ko-send-title">
                        ¿Necesitas que la persona confirme que lo recibió?
                      </h2>
                    </div>
                    <fieldset className="ko-choice-group">
                      <legend className="sr-only">Elige una opción</legend>
                      <label className="ko-choice-card">
                        <input
                          type="radio"
                          name="requires-confirmation"
                          checked={requiresAcknowledgement === false}
                          onChange={() => {
                            setRequiresAcknowledgement(false);
                            setSendFieldError("");
                          }}
                        />
                        <span className="ko-choice-indicator" />
                        <span>
                          <strong>No, solo enviarlo</strong>
                          <small>No se pedirá una respuesta.</small>
                        </span>
                      </label>
                      <label className="ko-choice-card">
                        <input
                          type="radio"
                          name="requires-confirmation"
                          checked={requiresAcknowledgement === true}
                          onChange={() => {
                            setRequiresAcknowledgement(true);
                            setSendFieldError("");
                          }}
                        />
                        <span className="ko-choice-indicator" />
                        <span>
                          <strong>Sí, pedir confirmación</strong>
                          <small>Te avisaremos cuando lo confirme.</small>
                        </span>
                      </label>
                    </fieldset>
                  </div>
                )}

                {sendStep === 4 && (
                  <div className="ko-step-content">
                    <div>
                      <p className="ko-step-label">Paso 4 de 4</p>
                      <h2 id="ko-send-title">Revisar y enviar</h2>
                    </div>
                    <dl className="ko-review">
                      <div>
                        <dt>Destinatario</dt>
                        <dd>{selectedMessageProfile?.full_name}</dd>
                      </div>
                      <div>
                        <dt>Mensaje</dt>
                        <dd className="ko-review-message">{messageBody.trim()}</dd>
                      </div>
                      <div>
                        <dt>Confirmación</dt>
                        <dd>
                          {requiresAcknowledgement
                            ? "Sí, pedir confirmación"
                            : "No, solo enviarlo"}
                        </dd>
                      </div>
                      <div>
                        <dt>Vigencia</dt>
                        <dd>
                          <label className="ko-field ko-expiry-field">
                            <span className="sr-only">Vigencia del mensaje</span>
                            <select
                              value={expiresInSeconds}
                              onChange={(event) =>
                                setExpiresInSeconds(Number(event.target.value))
                              }
                            >
                              <option value={24 * 60 * 60}>1 día</option>
                              <option value={7 * 24 * 60 * 60}>7 días</option>
                              <option value={30 * 24 * 60 * 60}>30 días</option>
                            </select>
                          </label>
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}

                {sendFieldError && (
                  <p className="ko-field-error" role="alert">
                    {sendFieldError}
                  </p>
                )}
                <div className="ko-wizard-actions ko-sticky-actions">
                  <button
                    className="ko-btn ko-btn-secondary"
                    type="button"
                    onClick={
                      sendStep === 1
                        ? () => openView("home")
                        : previousSendStep
                    }
                    disabled={sendingMessage}
                  >
                    Volver
                  </button>
                  {sendStep < 4 ? (
                    <button
                      className="ko-btn ko-btn-primary"
                      type="button"
                      onClick={continueSendFlow}
                    >
                      Continuar
                    </button>
                  ) : (
                    <button
                      className="ko-btn ko-btn-primary"
                      type="button"
                      onClick={handleSendMessage}
                      disabled={sendingMessage}
                    >
                      {sendingMessage ? "Enviando..." : "Enviar mensaje"}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {view === "messages" && (
        <section className="ko-section ko-messages-view" aria-labelledby="ko-messages-title">
          <div className="ko-section-heading">
            <div>
              <h2 id="ko-messages-title">Mensajes enviados</h2>
              <p>
                Escuchado: Klinip leyó el mensaje. Confirmado: la persona indicó
                que lo recibió.
              </p>
            </div>
            <button
              className="ko-btn ko-btn-secondary"
              type="button"
              onClick={() => loadMessages(messageProfileId)}
              disabled={loadingMessages || !messageProfileId}
            >
              Actualizar
            </button>
          </div>
          {messageProfiles.length > 1 && (
            <label className="ko-field ko-message-profile-filter">
              <span>Persona</span>
              <select
                value={messageProfileId}
                onChange={(event) => {
                  setMessageProfileId(event.target.value);
                  setTargetDeviceId("all");
                  setExpandedMessageId("");
                }}
              >
                {messageProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.full_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {loadingMessages ? (
            <div className="ko-loading" role="status">
              Cargando mensajes...
            </div>
          ) : !messages.length ? (
            <EmptyState
              title="Aún no hay mensajes"
              text="Los mensajes enviados aparecerán aquí."
            />
          ) : (
            <div className="ko-message-list">
              {messages.map((message) => {
                const displayState = getMessageDisplayState(message);
                const isExpanded = expandedMessageId === message.message_id;
                const isTerminal =
                  Boolean(message.revoked_at) ||
                  message.recipients?.every((recipient) =>
                    ["revoked", "expired"].includes(recipient.current_state),
                  );
                return (
                  <article className="ko-message-row" key={message.message_id}>
                    <div className="ko-message-topline">
                      <div>
                        <strong>
                          {selectedMessageProfile?.full_name || "Familiar"}
                        </strong>
                        <span>{formatDate(message.created_at)}</span>
                      </div>
                      <StatusPill
                        tone={
                          displayState === "Confirmado"
                            ? "success"
                            : displayState === "Esperando confirmación"
                              ? "warning"
                              : displayState === "No disponible"
                                ? "danger"
                                : "info"
                        }
                      >
                        {displayState}
                      </StatusPill>
                    </div>
                    <p className="ko-message-fragment">{message.body}</p>
                    <button
                      className="ko-btn ko-btn-secondary ko-detail-button"
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpandedMessageId(isExpanded ? "" : message.message_id)
                      }
                    >
                      {isExpanded ? "Cerrar detalle" : "Ver detalle"}
                    </button>
                    {isExpanded && (
                      <div className="ko-message-detail">
                        <p>{message.body}</p>
                        <p>
                          {message.requires_acknowledgement
                            ? "Este mensaje pide confirmación."
                            : "Este mensaje no pide confirmación."}
                        </p>
                        {!!message.recipients?.length && (
                          <div className="ko-message-activity">
                            <strong>Actividad</strong>
                            <ul>
                              {message.recipients.map((recipient) => (
                                <li key={recipient.recipient_id}>
                                  <span>{recipient.device_label}</span>
                                  <strong>
                                    {MESSAGE_STATE_LABELS[
                                      recipient.current_state
                                    ] || "Enviado"}
                                  </strong>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {!isTerminal && (
                          <button
                            className="ko-link-danger"
                            type="button"
                            onClick={() => setRevokingMessage(message)}
                          >
                            Revocar mensaje
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {view === "devices" && (
        <div className="ko-content-grid ko-devices-grid">
          <section className="ko-section" aria-labelledby="ko-linked-title">
            <div className="ko-section-heading">
              <div>
                <h2 id="ko-linked-title">Dispositivos vinculados</h2>
                <p>Acceso activo por perfil.</p>
              </div>
              {manageableProfiles.length > 1 && (
                <label className="ko-field ko-field-compact">
                  <span>Perfil</span>
                  <select
                    value={manageProfileId}
                    onChange={(event) => setManageProfileId(event.target.value)}
                  >
                    {manageableProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.full_name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {loadingDevices ? (
              <div className="ko-loading" role="status">
                Cargando dispositivos...
              </div>
            ) : !manageableProfiles.length ? (
              <EmptyState
                title="Sin perfiles disponibles"
                text="No tienes permisos para vincular dispositivos."
              />
            ) : !visibleDevices.length ? (
              <EmptyState
                title="Aún no hay dispositivos"
                text="Genera un código para vincular el primer Klinip One."
              />
            ) : (
              <div className="ko-list">
                {visibleDevices.map((device) => {
                  const displayState = getDeviceDisplayState(device);
                  const isRevoked = device.status === "revoked";
                  return (
                    <article className="ko-device-row" key={device.device_id}>
                      <div className="ko-device-mark" aria-hidden="true">
                        K
                      </div>
                      <div className="ko-row-main">
                        <div className="ko-row-title">
                          <strong>{device.label}</strong>
                          <StatusPill
                            tone={
                              isRevoked
                                ? "danger"
                                : displayState === "Sin conexión"
                                  ? "warning"
                                  : "success"
                            }
                          >
                            {displayState}
                          </StatusPill>
                        </div>
                        <span>
                          Vinculado el {formatDate(device.created_at)}
                        </span>
                        <span>
                          Última actividad: {formatDate(device.last_seen_at)}
                        </span>
                      </div>
                      {!isRevoked && (
                        <div className="ko-row-actions">
                          <button
                            className="ko-btn ko-btn-secondary"
                            type="button"
                            onClick={() => {
                              setEditingDevice(device);
                              setDeviceLabel(device.label);
                            }}
                          >
                            Cambiar nombre
                          </button>
                          <button
                            className="ko-btn ko-btn-ghost-danger"
                            type="button"
                            onClick={() => setRevokingDevice(device)}
                          >
                            Revocar
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="ko-section ko-pairing" aria-labelledby="ko-pair-title">
            <div className="ko-section-heading">
              <div>
                <h2 id="ko-pair-title">Vincular nuevo dispositivo</h2>
                <p>El código dura 5 minutos y solo puede utilizarse una vez.</p>
              </div>
            </div>
            {!pairing ? (
              <div className="ko-form-grid">
                <label className="ko-field">
                  <span>Perfil</span>
                  <select
                    value={manageProfileId}
                    onChange={(event) => setManageProfileId(event.target.value)}
                    disabled={!manageableProfiles.length}
                  >
                    {manageableProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ko-field">
                  <span>Nombre del dispositivo</span>
                  <input
                    value={pairingLabel}
                    maxLength={120}
                    onChange={(event) => setPairingLabel(event.target.value)}
                  />
                </label>
                <button
                  className="ko-btn ko-btn-primary ko-form-action"
                  type="button"
                  onClick={handleCreatePairing}
                  disabled={
                    creatingPairing ||
                    !manageProfileId ||
                    !pairingLabel.trim()
                  }
                >
                  {creatingPairing ? "Generando..." : "Generar código"}
                </button>
              </div>
            ) : (
              <div className="ko-pairing-result">
                <div className="ko-pairing-meta">
                  <StatusPill
                    tone={
                      pairing.status === "claimed"
                        ? "success"
                        : pairing.status === "pending"
                          ? "info"
                          : "warning"
                    }
                  >
                    {PAIRING_STATE_LABELS[pairing.status] || "Disponible"}
                  </StatusPill>
                  {pairing.status === "pending" && (
                    <span>Vence en {formatCountdown(pairingSeconds)}</span>
                  )}
                </div>
                {pairing.status === "pending" && (
                  <>
                    <div className="ko-code" aria-label="Código de vinculación">
                      {pairing.pairing_code}
                    </div>
                    <p className="ko-instruction">
                      Abre Klinip One en el dispositivo, entra a Setup → Klinip
                      Cloud → Vincular Klinip One e ingresa este código.
                    </p>
                    <div className="ko-inline-actions">
                      <button
                        className="ko-btn ko-btn-primary"
                        type="button"
                        onClick={handleCopyPairingCode}
                      >
                        Copiar código
                      </button>
                      <button
                        className="ko-btn ko-btn-secondary"
                        type="button"
                        onClick={handleCancelPairing}
                      >
                        Cancelar código
                      </button>
                    </div>
                  </>
                )}
                {pairing.status !== "pending" && (
                  <button
                    className="ko-btn ko-btn-primary"
                    type="button"
                    onClick={() => setPairing(null)}
                  >
                    Generar otro código
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(editingDevice)}
        title="Cambiar nombre"
        confirmLabel="Guardar nombre"
        busy={busyDeviceAction}
        onClose={() => setEditingDevice(null)}
        onConfirm={handleRenameDevice}
      >
        <label className="ko-field">
          <span>Nombre del dispositivo</span>
          <input
            value={deviceLabel}
            maxLength={120}
            onChange={(event) => setDeviceLabel(event.target.value)}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(revokingDevice)}
        title="Revocar dispositivo"
        confirmLabel="Sí, revocar"
        danger
        busy={busyDeviceAction}
        onClose={() => setRevokingDevice(null)}
        onConfirm={handleRevokeDevice}
      >
        <p>
          Este Klinip One dejará de acceder a los mensajes de este perfil.
          ¿Deseas continuar?
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(revokingMessage)}
        title="Revocar mensaje"
        confirmLabel="Sí, revocar"
        danger
        busy={busyDeviceAction}
        onClose={() => setRevokingMessage(null)}
        onConfirm={handleRevokeMessage}
      >
        <p>
          Klinip One dejará de ofrecer este mensaje si todavía está pendiente.
        </p>
      </ConfirmDialog>
    </div>
  );
}
