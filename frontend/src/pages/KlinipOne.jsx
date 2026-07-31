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
  if (detail === "device_revoked") return "Este dispositivo ya fue revocado.";
  if (detail === "message_not_authorized") {
    return "No tienes permiso para gestionar este mensaje.";
  }
  if (detail === "no_eligible_devices") {
    return "No hay un Klinip One autorizado para recibir este mensaje.";
  }
  if (error?.response?.status === 401) {
    return "Tu sesión terminó. Inicia sesión nuevamente.";
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

  const [view, setView] = useState("devices");
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
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(true);
  const [targetDeviceId, setTargetDeviceId] = useState("all");
  const [expiresInSeconds, setExpiresInSeconds] = useState(7 * 24 * 60 * 60);
  const [sendPreviewOpen, setSendPreviewOpen] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState("");
  const [revokingMessage, setRevokingMessage] = useState(null);

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

  function openSendPreview(event) {
    event.preventDefault();
    setError("");
    const normalized = messageBody.trim();
    if (!normalized) {
      setError("Escribe un mensaje antes de enviarlo.");
      return;
    }
    if (!messageProfileId || !hasMessageTarget) {
      setError("Este perfil no tiene un Klinip One autorizado.");
      return;
    }
    setPendingIdempotencyKey(createIdempotencyKey());
    setSendPreviewOpen(true);
  }

  async function handleSendMessage() {
    if (sendingMessage) return;
    setSendingMessage(true);
    try {
      const targetIds =
        targetDeviceId === "all" ? null : [targetDeviceId];
      await createDeviceMessage(
        Number(messageProfileId),
        {
          body: messageBody.trim(),
          requires_acknowledgement: requiresAcknowledgement,
          expires_in_seconds: Number(expiresInSeconds),
          target_device_ids: targetIds,
          protocol_version: 1,
        },
        pendingIdempotencyKey,
      );
      setSendPreviewOpen(false);
      setPendingIdempotencyKey("");
      setMessageBody("");
      setNotice("Mensaje enviado.");
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
          <h1>Conexión familiar</h1>
          <p>Gestiona los dispositivos y mensajes de tu familia.</p>
        </div>
        <div className="ko-tabs" role="tablist" aria-label="Secciones de Klinip One">
          <button
            type="button"
            role="tab"
            aria-selected={view === "devices"}
            className={view === "devices" ? "is-active" : ""}
            onClick={() => setView("devices")}
          >
            Dispositivos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "messages"}
            className={view === "messages" ? "is-active" : ""}
            onClick={() => setView("messages")}
          >
            Mensajes
          </button>
        </div>
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

      {view === "devices" ? (
        <div className="ko-content-grid">
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
      ) : (
        <div className="ko-content-grid ko-content-messages">
          <section className="ko-section" aria-labelledby="ko-send-title">
            <div className="ko-section-heading">
              <div>
                <h2 id="ko-send-title">Enviar nuevo mensaje</h2>
                <p>Mensaje familiar no clínico.</p>
              </div>
            </div>
            <form className="ko-message-form" onSubmit={openSendPreview}>
              <div className="ko-form-grid">
                <label className="ko-field">
                  <span>Perfil destinatario</span>
                  <select
                    value={messageProfileId}
                    onChange={(event) => {
                      setMessageProfileId(event.target.value);
                      setTargetDeviceId("all");
                    }}
                    disabled={!messageProfiles.length}
                  >
                    {messageProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ko-field">
                  <span>Dispositivo</span>
                  <select
                    value={targetDeviceId}
                    onChange={(event) => setTargetDeviceId(event.target.value)}
                    disabled={!canSelectSpecificDevice || !profileDevices.length}
                  >
                    <option value="all">
                      {canSelectSpecificDevice
                        ? "Todos los dispositivos vinculados"
                        : "Todos los dispositivos autorizados"}
                    </option>
                    {profileDevices.map((device) => (
                      <option key={device.device_id} value={device.device_id}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="ko-field">
                <span>Mensaje</span>
                <textarea
                  value={messageBody}
                  rows={4}
                  maxLength={MESSAGE_MAX_LENGTH}
                  placeholder="Escribe un mensaje breve y familiar"
                  onChange={(event) => setMessageBody(event.target.value)}
                />
                <small>
                  {messageBody.length} de {MESSAGE_MAX_LENGTH} caracteres
                </small>
              </label>
              <div className="ko-form-grid">
                <label className="ko-toggle-row">
                  <input
                    type="checkbox"
                    checked={requiresAcknowledgement}
                    onChange={(event) =>
                      setRequiresAcknowledgement(event.target.checked)
                    }
                  />
                  <span>
                    <strong>Pedir confirmación</strong>
                    <small>
                      La persona podrá avisarte que recibió el mensaje.
                    </small>
                  </span>
                </label>
                <label className="ko-field">
                  <span>El mensaje vence en</span>
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
              </div>
              {!hasMessageTarget && messageProfileId && (
                <p className="ko-field-error" role="status">
                  Vincula un Klinip One a este perfil antes de enviar mensajes.
                </p>
              )}
              <button
                className="ko-btn ko-btn-primary ko-send-button"
                type="submit"
                disabled={
                  !messageBody.trim() ||
                  !messageProfileId ||
                  !hasMessageTarget ||
                  sendingMessage
                }
              >
                Revisar y enviar
              </button>
            </form>
          </section>

          <section className="ko-section" aria-labelledby="ko-messages-title">
            <div className="ko-section-heading">
              <div>
                <h2 id="ko-messages-title">Mensajes familiares</h2>
                <p>
                  Escuchado significa que Klinip One terminó de leer. Confirmado
                  significa que la persona aceptó avisarte que lo recibió.
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
                  const isTerminal =
                    Boolean(message.revoked_at) ||
                    message.recipients?.every((recipient) =>
                      ["revoked", "expired"].includes(recipient.current_state),
                    );
                  return (
                    <article className="ko-message-row" key={message.message_id}>
                      <div className="ko-message-topline">
                        <div>
                          <strong>{message.sender?.display_name || "Familiar"}</strong>
                          <span>
                            Para {selectedMessageProfile?.full_name || "el perfil"}
                          </span>
                        </div>
                        <StatusPill
                          tone={
                            displayState === "Confirmado"
                              ? "success"
                              : displayState.includes("Pendiente")
                                ? "warning"
                                : "info"
                          }
                        >
                          {displayState}
                        </StatusPill>
                      </div>
                      <p>{message.body}</p>
                      <div className="ko-message-meta">
                        <span>{formatDate(message.created_at)}</span>
                        <span>
                          {message.requires_acknowledgement
                            ? "Requiere confirmación"
                            : "No requiere confirmación"}
                        </span>
                      </div>
                      {!!message.recipients?.length && (
                        <details className="ko-message-history">
                          <summary>Ver actividad</summary>
                          <ul>
                            {message.recipients.map((recipient) => (
                              <li key={recipient.recipient_id}>
                                <span>{recipient.device_label}</span>
                                <strong>
                                  {MESSAGE_STATE_LABELS[
                                    recipient.current_state
                                  ] || "Pendiente"}
                                </strong>
                              </li>
                            ))}
                            {(message.events || [])
                              .slice(-5)
                              .reverse()
                              .map((event) => (
                                <li key={event.event_id}>
                                  <span>{formatDate(event.server_timestamp)}</span>
                                  <strong>
                                    {MESSAGE_STATE_LABELS[event.event_type] ||
                                      "Actividad registrada"}
                                  </strong>
                                </li>
                              ))}
                          </ul>
                        </details>
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
                    </article>
                  );
                })}
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
        open={sendPreviewOpen}
        title="Confirmar envío"
        confirmLabel="Enviar mensaje"
        busy={sendingMessage}
        onClose={() => {
          setSendPreviewOpen(false);
          setPendingIdempotencyKey("");
        }}
        onConfirm={handleSendMessage}
      >
        <p>
          Vas a enviar este mensaje a{" "}
          <strong>{selectedMessageProfile?.full_name}</strong>.
        </p>
        <blockquote>{messageBody.trim()}</blockquote>
        <p>
          {requiresAcknowledgement
            ? "Se solicitará confirmación."
            : "No se solicitará confirmación."}
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
