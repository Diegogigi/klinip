import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  processVoiceSession,
  voiceShareLink,
  voiceShareEmail,
  voiceDownloadPdf,
  voiceAudioUrl,
  shareVoiceWithFamily,
  revokeVoiceFamilyShare,
} from "../api";
import {
  buildRecordedVoiceBlob,
  getPreferredVoiceRecorderOption,
  resolveVoiceMimeInfo,
} from "../utils/voiceRecording";
import {
  getVoiceProfessionalMeta,
  parseVoiceTechnicalSections,
} from "../utils/voiceTranscriptFormat";

/* ── Audio Player ─────────────────────────────────────────────────────────── */

function IvAudioPlayer({ sessionId, fallbackBlob, allowRemote = true }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const token = localStorage.getItem("token");
  const src = voiceAudioUrl(sessionId);
  const [localAudioSrc, setLocalAudioSrc] = useState(null);
  const [remoteAudioSrc, setRemoteAudioSrc] = useState(null);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause();
    else a.play();
    setPlaying(!playing);
  }

  function handleSeek(e) {
    const a = audioRef.current;
    if (!a || !duration) return;
    a.currentTime = Number(e.target.value);
  }

  function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  useEffect(() => {
    if (!fallbackBlob) {
      setLocalAudioSrc(null);
      return undefined;
    }

    const objectUrl = URL.createObjectURL(fallbackBlob);
    setLocalAudioSrc(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [fallbackBlob]);

  // We need to fetch audio with auth header since the endpoint requires authentication
  useEffect(() => {
    if (!allowRemote || !sessionId || !token) {
      setRemoteAudioSrc(null);
      return undefined;
    }

    let cancelled = false;
    let objectUrl = null;

    (async () => {
      try {
        const res = await fetch(src, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setRemoteAudioSrc(objectUrl);
      } catch { /* ignore */ }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [allowRemote, sessionId, token, src]);

  const audioSrc = remoteAudioSrc || localAudioSrc;

  if (!audioSrc) return null;

  return (
    <div className="iv-audio-player">
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setPlaying(false)}
      />
      <button type="button" className="iv-audio-btn" onClick={toggle}>
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      <div className="iv-audio-track">
        <input
          type="range"
          className="iv-audio-range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          onChange={handleSeek}
        />
        <div className="iv-audio-times">
          <span>{fmt(currentTime)}</span>
          <span>{duration ? fmt(duration) : "--:--"}</span>
        </div>
      </div>
    </div>
  );
}

const CLEAN_PROFESSIONAL_ROLE_OPTIONS = [
  { value: "medico", label: "Médico/a", helper: "Puede emitir diagnóstico médico." },
  { value: "kinesiologo", label: "Kinesiólogo/a", helper: "Evaluación y rehabilitación." },
  { value: "fonoaudiologo", label: "Fonoaudiólogo/a", helper: "Lenguaje, voz y deglución." },
  { value: "psicologo", label: "Psicólogo/a", helper: "Salud mental y acompañamiento." },
  { value: "nutricionista", label: "Nutricionista", helper: "Alimentación y plan nutricional." },
  { value: "terapeuta_ocupacional", label: "Terapeuta ocupacional", helper: "Funcionalidad y autonomía." },
  { value: "enfermeria", label: "Enfermería", helper: "Cuidados y seguimiento." },
  { value: "otro", label: "Otro profesional", helper: "Otro rol de salud." },
];

function TabParaTiClean({ result }) {
  const indicaciones = Array.isArray(result?.indicaciones) ? result.indicaciones : [];
  const meta = result?.metadata_clinica || {};
  const professionalLabel = getResultProfessionalLabel(result);
  const nonDiagnosticRole = meta.puede_diagnosticar_medicamente === false;

  return (
    <div className="iv-tab-content">
      {result?.access_scope === "shared" && (
        <div className="iv-shared-meta-card">
          <span className="iv-context-label">COMPARTIDO CONTIGO</span>
          <p className="iv-context-text">
            {result.shared_by_name || "Un integrante de tu familia"} te compartió esta atención.
          </p>
          {result.shared_at ? (
            <p className="iv-context-helper">Disponible desde {formatDateTime(result.shared_at)}</p>
          ) : null}
        </div>
      )}

      {(professionalLabel || nonDiagnosticRole) && (
        <div className="iv-context-card">
          <span className="iv-context-label">CONTEXTO DE LA ATENCIÓN</span>
          {professionalLabel ? (
            <p className="iv-context-text">Profesional registrado: {professionalLabel}</p>
          ) : null}
          {nonDiagnosticRole ? (
            <p className="iv-context-helper">
              Esta atención se resumió distinguiendo entre profesional y paciente, sin asumir un diagnóstico médico nuevo.
            </p>
          ) : null}
        </div>
      )}

      <div className="iv-summary-card">
        <span className="iv-summary-label">RESUMEN SIMPLE</span>
        <p className="iv-summary-text">{result?.version_simple || "Sin resumen disponible."}</p>
      </div>

      {indicaciones.length > 0 && (
        <div className="iv-indicaciones-list">
          {indicaciones.map((ind, index) => {
            const color = TIPO_COLORS[ind?.tipo] || TIPO_COLORS.otro;
            const label = TIPO_LABELS[ind?.tipo] || ind?.tipo || "Otro";
            const actionLabel = ind?.tipo === "control" || ind?.tipo === "examen" ? "+ Agenda" : "+ Recordatorio";
            return (
              <div key={`${ind?.tipo || "otro"}-${index}`} className="iv-indicacion-item">
                <span className="iv-indicacion-dot" style={{ background: color }} />
                <div className="iv-indicacion-body">
                  <p className="iv-indicacion-text">{ind?.texto}</p>
                </div>
                <span className="iv-indicacion-badge" style={{ color }}>{label}</span>
                <button type="button" className="iv-indicacion-action" disabled>{actionLabel}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TabTecnicaStructuredClean({ result }) {
  const meta = result?.metadata_clinica || {};
  const sections = parseVoiceTechnicalSections(result?.transcripcion_tecnica, meta);
  const professionalMeta = getVoiceProfessionalMeta(meta);

  return (
    <div className="iv-tab-content">
      <div className="iv-context-card">
        <span className="iv-context-label">CONTEXTO CLÍNICO</span>
        <p className="iv-context-text">Rol confirmado: {professionalMeta.role}</p>
        <p className="iv-context-helper">{professionalMeta.disclaimer}</p>
      </div>
      {sections.length ? (
        <div className="iv-tech-sections">
          {sections.map((section) => (
            <section key={section.id} className={`iv-tech-card tone-${section.tone.key}`}>
              <div className="iv-tech-card-head">
                <h3 className="iv-tech-card-title">{section.title}</h3>
                <span className={`iv-tech-badge tone-${section.tone.key}`}>{section.tone.label}</span>
              </div>
              <div className="iv-tech-card-body">
                {section.lines.map((line, index) => (
                  <p key={`${section.id}-${index}`} className="iv-tech-line">{line}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="iv-tecnica-box">Sin transcripción disponible.</div>
      )}
    </div>
  );
}

function TabCompartirClean({ result, shareTargets, onSessionUpdated }) {
  const [shareLink, setShareLink] = useState(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailModal, setEmailModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState("");
  const [emailError, setEmailError] = useState("");
  const [familyError, setFamilyError] = useState("");
  const [familyStatus, setFamilyStatus] = useState("");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [selectedRecipients, setSelectedRecipients] = useState([]);

  const activeFamilyShares = Array.isArray(result?.family_shares)
    ? result.family_shares.filter((item) => item.status === "active")
    : [];

  useEffect(() => {
    setIncludeAudio(
      activeFamilyShares.length ? activeFamilyShares.every((item) => item.include_audio !== false) : true
    );
    setSelectedRecipients(activeFamilyShares.map((item) => item.recipient_user_id));
    setFamilyError("");
    setFamilyStatus("");
  }, [result?.id]);

  async function handleShareLink() {
    setLoading("whatsapp");
    try {
      const data = await voiceShareLink(result.id);
      setShareLink(data.url);
      const text = encodeURIComponent(`Registro de consulta Klinip Voice:\n${data.url}`);
      window.open(`https://wa.me/?text=${text}`, "_blank");
    } catch {
      // ignore
    }
    setLoading("");
  }

  async function handleSendEmail() {
    if (!emailInput.trim()) return;
    setLoading("email");
    setEmailError("");
    try {
      await voiceShareEmail(result.id, emailInput.trim());
      setEmailSent(true);
      setEmailModal(false);
    } catch {
      setEmailError("No se pudo enviar el correo. Intenta de nuevo.");
    }
    setLoading("");
  }

  async function handlePdf() {
    setLoading("pdf");
    try {
      await voiceDownloadPdf(result.id);
    } catch {
      // ignore
    }
    setLoading("");
  }

  async function handleCopy() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  function toggleRecipient(userId) {
    setSelectedRecipients((prev) =>
      prev.includes(userId) ? prev.filter((item) => item !== userId) : [...prev, userId]
    );
  }

  async function handleShareFamily() {
    if (!selectedRecipients.length) {
      setFamilyError("Selecciona al menos un integrante.");
      return;
    }
    setLoading("family");
    setFamilyError("");
    setFamilyStatus("");
    try {
      const updated = await shareVoiceWithFamily(result.id, {
        recipient_user_ids: selectedRecipients,
        include_audio: includeAudio,
      });
      onSessionUpdated?.(updated);
      setFamilyStatus("Atención compartida con la familia.");
    } catch (err) {
      setFamilyError(err?.response?.data?.detail || "No se pudo compartir con la familia.");
    }
    setLoading("");
  }

  async function handleRevokeShare(shareId) {
    setLoading(`revoke-${shareId}`);
    setFamilyError("");
    setFamilyStatus("");
    try {
      const updated = await revokeVoiceFamilyShare(shareId);
      onSessionUpdated?.(updated);
      setFamilyStatus("Se revocó el acceso compartido.");
    } catch (err) {
      setFamilyError(err?.response?.data?.detail || "No se pudo revocar el compartido.");
    }
    setLoading("");
  }

  return (
    <div className="iv-tab-content">
      <h3 className="iv-share-title">Compartir con el profesional</h3>
      <p className="iv-share-subtitle">Audio y transcripción técnica</p>

      <div className="iv-share-cards">
        <button
          type="button"
          className="iv-share-card"
          onClick={() => setEmailModal(true)}
          disabled={loading === "email" || emailSent}
        >
          <span className="iv-share-card-icon iv-share-icon-blue"><EmailIcon /></span>
          <div className="iv-share-card-info">
            <span className="iv-share-card-title">{emailSent ? "Email enviado" : "Correo electrónico"}</span>
            <span className="iv-share-card-sub">Audio + PDF técnico adjunto</span>
          </div>
        </button>

        <button
          type="button"
          className="iv-share-card"
          onClick={handleShareLink}
          disabled={loading === "whatsapp"}
        >
          <span className="iv-share-card-icon iv-share-icon-green"><WhatsAppIcon /></span>
          <div className="iv-share-card-info">
            <span className="iv-share-card-title">WhatsApp</span>
            <span className="iv-share-card-sub">Link seguro · expira en 48h</span>
          </div>
        </button>

        <button
          type="button"
          className="iv-share-card"
          onClick={handlePdf}
          disabled={loading === "pdf"}
        >
          <span className="iv-share-card-icon iv-share-icon-yellow"><PdfIcon /></span>
          <div className="iv-share-card-info">
            <span className="iv-share-card-title">PDF descargable</span>
            <span className="iv-share-card-sub">Transcripción + metadatos</span>
          </div>
        </button>
      </div>

      {shareLink && (
        <div className="iv-link-preview">
          <span className="iv-link-url">{shareLink.length > 50 ? `${shareLink.slice(0, 50)}...` : shareLink}</span>
          <button type="button" className="iv-link-copy" onClick={handleCopy}>
            {copied ? "Copiado" : "Copiar link"}
          </button>
        </div>
      )}

      {result?.can_manage_family_shares && (
        <div className="iv-family-share-block">
          <div className="iv-family-share-head">
            <div>
              <h4 className="iv-family-share-title">Compartir con tu grupo familiar</h4>
              <p className="iv-family-share-copy">
                Comparte el resumen simple, las indicaciones y, si quieres, el audio original.
              </p>
            </div>
            <label className="iv-family-audio-toggle">
              <input
                type="checkbox"
                checked={includeAudio}
                onChange={(e) => setIncludeAudio(e.target.checked)}
              />
              <span>Incluir audio</span>
            </label>
          </div>

          {Array.isArray(shareTargets) && shareTargets.length > 0 ? (
            <div className="iv-family-targets">
              {shareTargets.map((target) => {
                const isActive = activeFamilyShares.some((item) => item.recipient_user_id === target.user_id);
                const isSelected = selectedRecipients.includes(target.user_id);
                return (
                  <label key={target.user_id} className={`iv-family-target ${isSelected ? "is-selected" : ""}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRecipient(target.user_id)}
                    />
                    <span className="iv-family-target-main">
                      <span className="iv-family-target-name">
                        {target.user_name || target.user_email || `Usuario #${target.user_id}`}
                      </span>
                      <span className="iv-family-target-meta">
                        {target.relationship_type || target.role || "Integrante"}{isActive ? " · compartido" : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="iv-family-empty">No hay integrantes autorizados para compartir esta atención.</p>
          )}

          <div className="iv-family-actions">
            <button
              type="button"
              className="iv-btn iv-btn-primary"
              onClick={handleShareFamily}
              disabled={loading === "family" || !selectedRecipients.length}
            >
              {loading === "family" ? "Compartiendo..." : "Compartir con seleccionados"}
            </button>
          </div>

          {familyError ? <p className="iv-family-error">{familyError}</p> : null}
          {familyStatus ? <p className="iv-family-status">{familyStatus}</p> : null}

          {activeFamilyShares.length > 0 && (
            <div className="iv-family-current-list">
              <p className="iv-family-current-title">Accesos activos</p>
              {activeFamilyShares.map((share) => (
                <div className="iv-family-current-item" key={share.id}>
                  <div>
                    <p className="iv-family-current-name">
                      {share.recipient_name || share.recipient_email || `Usuario #${share.recipient_user_id}`}
                    </p>
                    <p className="iv-family-current-meta">
                      {share.share_mode === "automatic" ? "Automático" : "Manual"} · {share.include_audio ? "con audio" : "sin audio"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="iv-link-copy iv-link-copy-danger"
                    onClick={() => handleRevokeShare(share.id)}
                    disabled={loading === `revoke-${share.id}`}
                  >
                    {loading === `revoke-${share.id}` ? "Revocando..." : "Revocar"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {emailModal && (
        <div className="iv-email-modal">
          <p className="iv-email-modal-title">Enviar por correo</p>
          <input
            type="email"
            className="iv-email-input"
            placeholder="correo@ejemplo.cl"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            autoFocus
          />
          {emailError && <p style={{ color: "#f87171", fontSize: "0.8rem", margin: "0 0 0.5rem" }}>{emailError}</p>}
          <div className="iv-email-modal-actions">
            <button type="button" className="iv-btn iv-btn-ghost" onClick={() => { setEmailModal(false); setEmailError(""); }}>
              Cancelar
            </button>
            <button
              type="button"
              className="iv-btn iv-btn-primary"
              onClick={handleSendEmail}
              disabled={!emailInput.trim() || loading === "email"}
            >
              {loading === "email" ? "Enviando..." : "Enviar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ImmersiveVoice({
  profileId,
  onDone,
  onClose,
  initialSession,
  shareTargets = [],
}) {
  const [stage, setStage] = useState(initialSession ? "done" : "consent");
  const [error, setError] = useState("");
  const [timer, setTimer] = useState(0);
  const [closing, setClosing] = useState(false);
  const [result, setResult] = useState(initialSession || null);
  const [activeTab, setActiveTab] = useState("parati");
  const [sheetHeight, setSheetHeight] = useState(null);
  const [professionalRole, setProfessionalRole] = useState(
    initialSession?.metadata_clinica?.profesional_clave || ""
  );
  const [sessionPreviewBlob, setSessionPreviewBlob] = useState(null);
  const [micReady, setMicReady] = useState(false);
  const [wakeLockState, setWakeLockState] = useState("idle");

  const sheetRef = useRef(null);
  const dragRef = useRef({ active: false, startY: 0, startH: 0 });
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const consentBlobRef = useRef(null);
  const timerRef = useRef(null);
  const recorderOptionRef = useRef(getPreferredVoiceRecorderOption());
  const wakeLockRef = useRef(null);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.documentElement.classList.add("voice-immersive-active", "klinip-overlay-open");
    document.body.classList.add("voice-immersive-active", "klinip-overlay-open");
    return () => {
      document.documentElement.classList.remove("voice-immersive-active", "klinip-overlay-open");
      document.body.classList.remove("voice-immersive-active", "klinip-overlay-open");
    };
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    if (sentinel) {
      try {
        await sentinel.release();
      } catch {
        // ignore
      }
    }
    setWakeLockState("idle");
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (typeof document === "undefined") return false;
    if (document.visibilityState === "hidden") return false;
    if (!navigator?.wakeLock?.request) {
      setWakeLockState("unsupported");
      return false;
    }
    if (wakeLockRef.current) {
      setWakeLockState("active");
      return true;
    }

    try {
      const sentinel = await navigator.wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      setWakeLockState("active");
      sentinel.addEventListener?.("release", () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null;
        }
        setWakeLockState(document.visibilityState === "visible" ? "released" : "idle");
      });
      return true;
    } catch {
      setWakeLockState("error");
      return false;
    }
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    stopStream();
    releaseWakeLock();
  }, [releaseWakeLock, stopStream]);

  const shouldKeepScreenAwake =
    stage === "recording_consent" ||
    stage === "recording_session" ||
    stage === "processing";

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (!shouldKeepScreenAwake) {
      releaseWakeLock();
      return undefined;
    }

    requestWakeLock();

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && shouldKeepScreenAwake) {
        requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [releaseWakeLock, requestWakeLock, shouldKeepScreenAwake]);

  useEffect(() => {
    if (result?.access_scope === "shared") {
      setActiveTab("parati");
    }
  }, [result?.access_scope, result?.id]);

  const availableTabs = [
    { key: "parati", label: "Para ti" },
    ...(result?.can_view_technical ? [{ key: "tecnica", label: "Técnica" }] : []),
    ...(result?.can_manage_family_shares ? [{ key: "compartir", label: "Compartir" }] : []),
  ];

  useEffect(() => {
    if (!availableTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab("parati");
    }
  }, [activeTab, result?.id, result?.can_manage_family_shares, result?.can_view_technical]);

  function animateClose(callback) {
    setClosing(true);
    setTimeout(() => {
      if (callback) callback();
      if (onClose) onClose();
    }, 300);
  }

  async function startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const preferredOption = getPreferredVoiceRecorderOption();
      let recorder;
      try {
        recorder = preferredOption.mimeType
          ? new MediaRecorder(stream, {
              mimeType: preferredOption.mimeType,
              audioBitsPerSecond: 64000,
            })
          : new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
      } catch {
        recorder = new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
      }
      recorderOptionRef.current = resolveVoiceMimeInfo(
        recorder.mimeType || preferredOption.mimeType || "",
        preferredOption.extension || "webm"
      );
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          if (!micReady) setMicReady(true);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start(500);
      return true;
    } catch {
      setError("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
      setStage("error");
      return false;
    }
  }

  function stopRecording() {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      const blob = () => buildRecordedVoiceBlob(
        chunksRef.current,
        recorder?.mimeType || recorderOptionRef.current?.mimeType || "",
        recorderOptionRef.current?.extension || "webm"
      );
      if (!recorder || recorder.state === "inactive") {
        resolve(blob());
        return;
      }
      recorder.onstop = () => resolve(blob());
      recorder.stop();
    });
  }

  async function handleStartConsent() {
    setMicReady(false);
    setStage("recording_consent");
    await requestWakeLock();
    await startMic();
  }

  async function handleConsentDone() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      try {
        recorder.requestData();
      } catch {
        // ignore
      }
    }
    const blob = await stopRecording();
    if (!blob || blob.size === 0) {
      setError("No se capturó audio del consentimiento. Intenta de nuevo y habla durante al menos 2 segundos.");
      setStage("error");
      stopStream();
      return;
    }
    consentBlobRef.current = blob;
    stopStream();
    setMicReady(false);
    setStage("recording_session");
    setTimer(0);
    await requestWakeLock();
    const ok = await startMic();
    if (ok) {
      timerRef.current = setInterval(() => setTimer((value) => value + 1), 1000);
    }
  }

  async function handleStop() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      try {
        recorder.requestData();
      } catch {
        // ignore
      }
    }
    const sessionBlob = await stopRecording();
    stopStream();
    await releaseWakeLock();

    if (!sessionBlob || sessionBlob.size === 0) {
      setError("No se capturó audio de la consulta. Intenta de nuevo.");
      setStage("error");
      return;
    }
    if (!consentBlobRef.current || consentBlobRef.current.size === 0) {
      setError("El audio de consentimiento está vacío. Intenta de nuevo desde el inicio.");
      setStage("error");
      return;
    }

    setSessionPreviewBlob(sessionBlob);
    setStage("processing");

    try {
      const data = await processVoiceSession({
        audioConsent: consentBlobRef.current,
        audioSession: sessionBlob,
        profileId,
        professionalRole,
      });
      setResult(data);
      setStage("done");
    } catch (err) {
      let message;
      if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
        message = "La consulta fue muy larga para procesar. Intenta con un fragmento más corto.";
      } else if (!err.response) {
        message = "Sin conexión. Verifica tu internet e intenta de nuevo.";
      } else {
        const status = err.response.status;
        if (status === 413) message = "El audio es muy largo. Intenta con una grabación más corta.";
        else if (status === 422) message = "No se detectó voz clara en el audio.";
        else if (status === 503) message = "El servicio de transcripción no está disponible.";
        else message = err.response?.data?.detail || "Error al procesar. Intenta de nuevo.";
      }
      setError(message);
      setStage("error");
    }
  }

  function handleRetry() {
    setError("");
    setTimer(0);
    setMicReady(false);
    consentBlobRef.current = null;
    setSessionPreviewBlob(null);
    setWakeLockState("idle");
    setStage("consent");
  }

  function handleCancel() {
    stopStream();
    releaseWakeLock();
    setSessionPreviewBlob(null);
    animateClose(() => {
      if (stage === "done" && result && onDone) onDone(result);
    });
  }

  function handleSaveAndClose() {
    animateClose(() => {
      if (onDone && result) onDone(result);
    });
  }

  const handleSheetTouchStart = useCallback((event) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const touch = event.touches[0];
    dragRef.current = {
      active: true,
      startY: touch.clientY,
      startH: sheet.getBoundingClientRect().height,
    };
  }, []);

  const handleSheetTouchMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const touch = event.touches[0];
    const delta = drag.startY - touch.clientY;
    const viewportHeight = window.innerHeight;
    const minHeight = 120;
    const maxHeight = viewportHeight * 0.9;
    setSheetHeight(Math.min(maxHeight, Math.max(minHeight, drag.startH + delta)));
  }, []);

  const handleSheetTouchEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    const sheet = sheetRef.current;
    if (sheet && sheet.getBoundingClientRect().height < 180) {
      setSheetHeight(180);
    }
  }, []);

  const showWaves = stage === "recording_consent" || stage === "recording_session";
  const stepIndex =
    stage === "consent" ? 0 :
    stage === "recording_consent" ? 1 :
    stage === "recording_session" ? 2 : 2;
  const orbClass =
    stage === "consent" ? "iv-orb-amber" :
    stage === "recording_consent" ? "iv-orb-purple" :
    stage === "recording_session" ? "iv-orb-purple" :
    stage === "processing" ? "iv-orb-green" :
    "iv-orb-red";
  const stageCopy = {
    consent: {
      title: "Pide autorización",
      subtitle: "Solicita al profesional que autorice verbalmente la grabación.",
    },
    recording_consent: {
      title: "Grabando autorización",
      subtitle: "Pide que diga: Autorizo la grabación de esta consulta.",
    },
    recording_session: {
      title: "Grabando consulta",
      subtitle: "La consulta se está grabando.",
    },
    processing: {
      title: "Klinip IA procesando",
      subtitle: "Transcribiendo y traduciendo tu consulta...",
    },
    error: {
      title: "Error",
      subtitle: error,
    },
  }[stage] || { title: "Error", subtitle: error };
  const stageStatus = {
    consent: { label: "Preparación", tone: "idle" },
    recording_consent: { label: "Grabando", tone: "recording" },
    recording_session: { label: "Grabando", tone: "recording" },
    processing: { label: "Procesando", tone: "processing" },
    error: { label: "Error", tone: "error" },
    done: { label: "Listo", tone: "ready" },
  }[stage] || { label: "Preparación", tone: "idle" };
  const wakeLockCopy = shouldKeepScreenAwake
    ? wakeLockState === "active"
      ? "Pantalla activa durante la grabación."
      : wakeLockState === "unsupported"
        ? "Tu navegador no permite bloquear el reposo. Mantén la pantalla desbloqueada."
        : wakeLockState === "released"
          ? "La protección de pantalla se liberó. Mantén el teléfono activo."
          : wakeLockState === "error"
            ? "No pudimos sostener la pantalla activa. Evita bloquear el teléfono."
            : "Activando protección de pantalla..."
    : "";

  const renderOverlay = (content) => (
    typeof document !== "undefined" ? createPortal(content, document.body) : content
  );

  if (stage === "done" && result) {
    return renderOverlay(
      <div className={`iv-overlay iv-overlay-done ${closing ? "iv-fade-out" : "iv-fade-in"}`}>
        <button type="button" className="iv-close" onClick={handleCancel} aria-label="Cerrar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="iv-done-top">
          <div className="iv-orb iv-orb-green-solid">
            <CheckSvg />
          </div>
          <StagePill label="Listo" tone="ready" />
          <h2 className="iv-title iv-done-title">
            {result.access_scope === "shared" ? "Atención compartida" : "Consulta procesada"}
          </h2>
          <p className="iv-subtitle">
            {result.access_scope === "shared"
              ? "Tu familia te compartió este resumen de Klinip Voice."
              : "Klinip IA analizó tu consulta."}
          </p>
          <SecurityBadges />
          {(result.id || sessionPreviewBlob) && (
            <IvAudioPlayer
              sessionId={result.id}
              fallbackBlob={sessionPreviewBlob}
              allowRemote={result.audio_available !== false}
            />
          )}
        </div>

        <div
          className="iv-sheet"
          ref={sheetRef}
          style={sheetHeight ? { height: `${sheetHeight}px`, maxHeight: "90vh" } : undefined}
        >
          <div
            className="iv-sheet-handle"
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
          />

          <div className="iv-sheet-tabs">
            {availableTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`iv-sheet-tab ${activeTab === tab.key ? "iv-sheet-tab-active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="iv-sheet-body">
            {activeTab === "parati" && <TabParaTiClean result={result} />}
            {activeTab === "tecnica" && result.can_view_technical && <TabTecnicaStructuredClean result={result} />}
            {activeTab === "compartir" && result.can_manage_family_shares && (
              <TabCompartirClean
                result={result}
                shareTargets={shareTargets}
                onSessionUpdated={setResult}
              />
            )}
          </div>

          <div className="iv-sheet-footer">
            <button type="button" className="iv-btn iv-btn-primary iv-btn-full" onClick={handleSaveAndClose}>
              {result.access_scope === "shared" ? "Cerrar" : "Guardar en ficha y cerrar"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return renderOverlay(
    <div className={`iv-overlay ${closing ? "iv-fade-out" : "iv-fade-in"}`}>
      <button type="button" className="iv-close" onClick={handleCancel} aria-label="Cerrar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="iv-content">
        <div className={`iv-orb ${orbClass}`}>
          {stage === "consent" && (
            <>
              <span className="iv-ring iv-ring-1" />
              <span className="iv-ring iv-ring-2" />
              <span className="iv-ring iv-ring-3" />
            </>
          )}
          {stage === "processing" ? <span className="iv-orb-spinner" /> : <MicSvg />}
        </div>

        <div className="iv-stage-meta">
          <StagePill label={stageStatus.label} tone={stageStatus.tone} />
          {showWaves ? <span className="iv-stage-live">Entrada en tiempo real</span> : null}
        </div>

        {wakeLockCopy ? <p className={`iv-wake-lock-note is-${wakeLockState}`}>{wakeLockCopy}</p> : null}

        {showWaves ? <AudioWaves active tone="recording" /> : null}
        {stage === "recording_session" && <div className="iv-timer">{formatTimer(timer)}</div>}

        <div className="iv-text">
          <h2 className="iv-title">{stageCopy.title}</h2>
          <p className="iv-subtitle">{stageCopy.subtitle}</p>
        </div>

        <SecurityBadges />

        {stage !== "processing" && stage !== "error" && <StepDots current={stepIndex} total={3} />}

        {stage === "consent" && (
          <div className="iv-role-card">
            <span className="iv-role-label">Profesional que estás grabando</span>
            <div className="iv-role-grid">
              {CLEAN_PROFESSIONAL_ROLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`iv-role-option ${professionalRole === option.value ? "is-active" : ""}`}
                  onClick={() => setProfessionalRole(option.value)}
                >
                  <span className="iv-role-option-title">{option.label}</span>
                  <span className="iv-role-option-helper">{option.helper}</span>
                </button>
              ))}
            </div>
            <p className="iv-role-disclaimer">
              Klinip ajustará la transcripción según este rol y evitará asumir un diagnóstico médico cuando no corresponda.
            </p>
          </div>
        )}

        <div className="iv-actions">
          {stage === "consent" && (
            <button type="button" className="iv-btn iv-btn-primary" onClick={handleStartConsent} disabled={!professionalRole}>
              El profesional autorizó
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="iv-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          )}
          {stage === "recording_consent" && (
            <button type="button" className="iv-btn iv-btn-primary" disabled={!micReady} onClick={handleConsentDone}>
              {micReady ? "Autorización registrada" : "Esperando audio..."}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="iv-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          )}
          {stage === "recording_session" && (
            <div className="iv-session-controls">
              <button type="button" className="iv-ctrl iv-ctrl-stop" onClick={handleStop} aria-label="Detener grabación">
                <span className="iv-ctrl-square" />
              </button>
            </div>
          )}
          {stage === "error" && (
            <button type="button" className="iv-btn iv-btn-primary" onClick={handleRetry}>
              Intentar de nuevo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function formatTimer(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TIPO_COLORS = {
  medicamento: "#A78BFA",
  control: "#34D399",
  examen: "#60A5FA",
  dieta: "#34D399",
  ejercicio: "#A78BFA",
  otro: "rgba(255,255,255,0.3)",
};

const TIPO_LABELS = {
  medicamento: "Medicamento",
  control: "Control",
  examen: "Examen",
  dieta: "Dieta",
  ejercicio: "Ejercicio",
  otro: "Otro",
};

const PROFESSIONAL_ROLE_OPTIONS = [
  { value: "medico", label: "Médico/a", helper: "Puede emitir diagnóstico médico." },
  { value: "kinesiologo", label: "Kinesiólogo/a", helper: "Evaluación y rehabilitación." },
  { value: "fonoaudiologo", label: "Fonoaudiólogo/a", helper: "Lenguaje, voz y deglución." },
  { value: "psicologo", label: "Psicólogo/a", helper: "Salud mental y acompañamiento." },
  { value: "nutricionista", label: "Nutricionista", helper: "Alimentación y plan nutricional." },
  { value: "terapeuta_ocupacional", label: "Terapeuta ocupacional", helper: "Funcionalidad y autonomía." },
  { value: "enfermeria", label: "Enfermería", helper: "Cuidados y seguimiento." },
  { value: "otro", label: "Otro profesional", helper: "Otro rol de salud." },
];

function getProfessionalRoleLabel(value) {
  return PROFESSIONAL_ROLE_OPTIONS.find((item) => item.value === value)?.label || "Profesional de salud";
}

function getResultProfessionalLabel(result) {
  const meta = result?.metadata_clinica || {};
  return meta.profesional_confirmado || meta.especialidad_inferida || "";
}

/* ── SVG Icons ─────────────────────────────────────────────────────────────── */

function MicSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="iv-orb-mic">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4M8 21h8" />
    </svg>
  );
}

function CheckSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="iv-orb-check">
      <polyline points="6 12 10 16 18 8" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────────── */

function StepDots({ current, total }) {
  return (
    <div className="iv-dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`iv-dot ${i < current ? "iv-dot-filled" : ""} ${i === current ? "iv-dot-active" : ""}`} />
      ))}
    </div>
  );
}

function ShieldMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function StagePill({ label, tone }) {
  return <span className={`iv-stage-pill is-${tone}`}>{label}</span>;
}

function SecurityBadges() {
  return (
    <div className="iv-security-row">
      <span className="iv-security-chip">
        <ShieldMiniIcon />
        Audio protegido
      </span>
      <span className="iv-security-chip">
        <ShieldMiniIcon />
        Solo tú y tu familia
      </span>
    </div>
  );
}

function AudioWaves({ active = false, tone = "recording" }) {
  const [levels, setLevels] = useState(() => [18, 30, 22, 36, 26, 34, 22, 28, 16]);

  useEffect(() => {
    if (!active) return undefined;
    const interval = window.setInterval(() => {
      setLevels((prev) =>
        prev.map((value, index) => {
          const base = index === 4 ? 30 : index % 2 === 0 ? 22 : 28;
          const variance = Math.floor(Math.random() * 22);
          return Math.max(10, base + variance - Math.floor(value / 8));
        })
      );
    }, 140);
    return () => window.clearInterval(interval);
  }, [active]);

  return (
    <div className={`iv-waves is-${tone}`}>
      {levels.map((height, index) => (
        <span key={index} className="iv-wave-bar" style={{ height: `${height}px` }} />
      ))}
    </div>
  );
}

/* ── Done Sheet: Tab "Para ti" ─────────────────────────────────────────────── */

function TabParaTi({ result }) {
  const indicaciones = result.indicaciones || [];
  const meta = result.metadata_clinica || {};
  const professionalLabel = getResultProfessionalLabel(result);
  const nonDiagnosticRole = meta.puede_diagnosticar_medicamente === false;
  return (
    <div className="iv-tab-content">
      {result.access_scope === "shared" && (
        <div className="iv-shared-meta-card">
          <span className="iv-context-label">COMPARTIDO CONTIGO</span>
          <p className="iv-context-text">
            {result.shared_by_name || "Un integrante de tu familia"} te compartio esta atencion.
          </p>
          {result.shared_at ? (
            <p className="iv-context-helper">Disponible desde {formatDateTime(result.shared_at)}</p>
          ) : null}
        </div>
      )}
      {(professionalLabel || nonDiagnosticRole) && (
        <div className="iv-context-card">
          <span className="iv-context-label">CONTEXTO DE LA ATENCIÓN</span>
          {professionalLabel ? (
            <p className="iv-context-text">Profesional registrado: {professionalLabel}</p>
          ) : null}
          {nonDiagnosticRole ? (
            <p className="iv-context-helper">
              Esta atención se resumió distinguiendo entre profesional y paciente, sin asumir un diagnóstico médico nuevo.
            </p>
          ) : null}
        </div>
      )}
      <div className="iv-summary-card">
        <span className="iv-summary-label">RESUMEN SIMPLE</span>
        <p className="iv-summary-text">{result.version_simple || "Sin resumen disponible."}</p>
      </div>
      {indicaciones.length > 0 && (
        <div className="iv-indicaciones-list">
          {indicaciones.map((ind, i) => {
            const color = TIPO_COLORS[ind.tipo] || TIPO_COLORS.otro;
            const label = TIPO_LABELS[ind.tipo] || ind.tipo;
            const actionLabel = ind.tipo === "control" || ind.tipo === "examen" ? "+ Agenda" : "+ Recordatorio";
            return (
              <div key={i} className="iv-indicacion-item">
                <span className="iv-indicacion-dot" style={{ background: color }} />
                <div className="iv-indicacion-body">
                  <p className="iv-indicacion-text">{ind.texto}</p>
                </div>
                <span className="iv-indicacion-badge" style={{ color }}>{label}</span>
                <button type="button" className="iv-indicacion-action" disabled>{actionLabel}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TabTecnicaStructured({ result }) {
  const meta = result.metadata_clinica || {};
  const sections = parseVoiceTechnicalSections(result.transcripcion_tecnica, meta);
  const professionalMeta = getVoiceProfessionalMeta(meta);

  return (
    <div className="iv-tab-content">
      <div className="iv-context-card">
        <span className="iv-context-label">CONTEXTO CLÍNICO</span>
        <p className="iv-context-text">Rol confirmado: {professionalMeta.role}</p>
        <p className="iv-context-helper">{professionalMeta.disclaimer}</p>
      </div>
      {sections.length ? (
        <div className="iv-tech-sections">
          {sections.map((section) => (
            <section key={section.id} className={`iv-tech-card tone-${section.tone.key}`}>
              <div className="iv-tech-card-head">
                <h3 className="iv-tech-card-title">{section.title}</h3>
                <span className={`iv-tech-badge tone-${section.tone.key}`}>{section.tone.label}</span>
              </div>
              <div className="iv-tech-card-body">
                {section.lines.map((line, index) => (
                  <p key={`${section.id}-${index}`} className="iv-tech-line">{line}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="iv-tecnica-box">Sin transcripción disponible.</div>
      )}
    </div>
  );
}

/* ── Done Sheet: Tab "Compartir" ───────────────────────────────────────────── */

function TabCompartir({ result, shareTargets, onSessionUpdated }) {
  const [shareLink, setShareLink] = useState(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailModal, setEmailModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState("");
  const [emailError, setEmailError] = useState("");
  const [familyError, setFamilyError] = useState("");
  const [familyStatus, setFamilyStatus] = useState("");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [selectedRecipients, setSelectedRecipients] = useState([]);

  const activeFamilyShares = Array.isArray(result?.family_shares)
    ? result.family_shares.filter((item) => item.status === "active")
    : [];

  useEffect(() => {
    setIncludeAudio(
      activeFamilyShares.length ? activeFamilyShares.every((item) => item.include_audio !== false) : true
    );
    setSelectedRecipients(activeFamilyShares.map((item) => item.recipient_user_id));
    setFamilyError("");
    setFamilyStatus("");
  }, [result?.id]);

  async function handleShareLink() {
    setLoading("whatsapp");
    try {
      const data = await voiceShareLink(result.id);
      setShareLink(data.url);
      const text = encodeURIComponent(`Registro de consulta Klinip Voice:\n${data.url}`);
      window.open(`https://wa.me/?text=${text}`, "_blank");
    } catch { /* ignore */ }
    setLoading("");
  }

  async function handleSendEmail() {
    if (!emailInput.trim()) return;
    setLoading("email");
    setEmailError("");
    try {
      await voiceShareEmail(result.id, emailInput.trim());
      setEmailSent(true);
      setEmailModal(false);
    } catch {
      setEmailError("No se pudo enviar el correo. Intenta de nuevo.");
    }
    setLoading("");
  }

  async function handlePdf() {
    setLoading("pdf");
    try {
      await voiceDownloadPdf(result.id);
    } catch { /* ignore */ }
    setLoading("");
  }

  async function handleCopy() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  function toggleRecipient(userId) {
    setSelectedRecipients((prev) =>
      prev.includes(userId) ? prev.filter((item) => item !== userId) : [...prev, userId]
    );
  }

  async function handleShareFamily() {
    if (!selectedRecipients.length) {
      setFamilyError("Selecciona al menos un integrante.");
      return;
    }
    setLoading("family");
    setFamilyError("");
    setFamilyStatus("");
    try {
      const updated = await shareVoiceWithFamily(result.id, {
        recipient_user_ids: selectedRecipients,
        include_audio: includeAudio,
      });
      onSessionUpdated?.(updated);
      setFamilyStatus("Atencion compartida con la familia.");
    } catch (err) {
      setFamilyError(err?.response?.data?.detail || "No se pudo compartir con la familia.");
    }
    setLoading("");
  }

  async function handleRevokeShare(shareId) {
    setLoading(`revoke-${shareId}`);
    setFamilyError("");
    setFamilyStatus("");
    try {
      const updated = await revokeVoiceFamilyShare(shareId);
      onSessionUpdated?.(updated);
      setFamilyStatus("Se revoco el acceso compartido.");
    } catch (err) {
      setFamilyError(err?.response?.data?.detail || "No se pudo revocar el compartido.");
    }
    setLoading("");
  }

  return (
    <div className="iv-tab-content">
      <h3 className="iv-share-title">Compartir con el profesional</h3>
      <p className="iv-share-subtitle">Audio y transcripción técnica</p>

      <div className="iv-share-cards">
        {/* Email */}
        <button
          type="button"
          className="iv-share-card"
          onClick={() => setEmailModal(true)}
          disabled={loading === "email" || emailSent}
        >
          <span className="iv-share-card-icon iv-share-icon-blue"><EmailIcon /></span>
          <div className="iv-share-card-info">
            <span className="iv-share-card-title">{emailSent ? "Email enviado" : "Correo electrónico"}</span>
            <span className="iv-share-card-sub">Audio + PDF técnico adjunto</span>
          </div>
        </button>

        {/* WhatsApp */}
        <button
          type="button"
          className="iv-share-card"
          onClick={handleShareLink}
          disabled={loading === "whatsapp"}
        >
          <span className="iv-share-card-icon iv-share-icon-green"><WhatsAppIcon /></span>
          <div className="iv-share-card-info">
            <span className="iv-share-card-title">WhatsApp</span>
            <span className="iv-share-card-sub">Link seguro · expira en 48h</span>
          </div>
        </button>

        {/* PDF */}
        <button
          type="button"
          className="iv-share-card"
          onClick={handlePdf}
          disabled={loading === "pdf"}
        >
          <span className="iv-share-card-icon iv-share-icon-yellow"><PdfIcon /></span>
          <div className="iv-share-card-info">
            <span className="iv-share-card-title">PDF descargable</span>
            <span className="iv-share-card-sub">Transcripción + metadatos</span>
          </div>
        </button>
      </div>

      {/* Link preview */}
      {shareLink && (
        <div className="iv-link-preview">
          <span className="iv-link-url">{shareLink.length > 50 ? shareLink.slice(0, 50) + "…" : shareLink}</span>
          <button type="button" className="iv-link-copy" onClick={handleCopy}>
            {copied ? "Copiado" : "Copiar link"}
          </button>
        </div>
      )}

      {Array.isArray(shareTargets) && shareTargets.length > 0 && result?.can_manage_family_shares && (
        <div className="iv-family-share-block">
          <div className="iv-family-share-head">
            <div>
              <h4 className="iv-family-share-title">Compartir con tu grupo familiar</h4>
              <p className="iv-family-share-copy">
                Comparte el resumen simple, las indicaciones y, si quieres, el audio original.
              </p>
            </div>
            <label className="iv-family-audio-toggle">
              <input
                type="checkbox"
                checked={includeAudio}
                onChange={(e) => setIncludeAudio(e.target.checked)}
              />
              <span>Incluir audio</span>
            </label>
          </div>

          <div className="iv-family-targets">
            {shareTargets.map((target) => {
              const isActive = activeFamilyShares.some((item) => item.recipient_user_id === target.user_id);
              const isSelected = selectedRecipients.includes(target.user_id);
              return (
                <label
                  key={target.user_id}
                  className={`iv-family-target ${isSelected ? "is-selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleRecipient(target.user_id)}
                  />
                  <span className="iv-family-target-main">
                    <span className="iv-family-target-name">
                      {target.user_name || target.user_email || `Usuario #${target.user_id}`}
                    </span>
                    <span className="iv-family-target-meta">
                      {target.relationship_type || target.role || "Integrante"}{isActive ? " · compartido" : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="iv-family-actions">
            <button
              type="button"
              className="iv-btn iv-btn-primary"
              onClick={handleShareFamily}
              disabled={loading === "family" || !selectedRecipients.length}
            >
              {loading === "family" ? "Compartiendo..." : "Compartir con seleccionados"}
            </button>
          </div>

          {familyError ? <p className="iv-family-error">{familyError}</p> : null}
          {familyStatus ? <p className="iv-family-status">{familyStatus}</p> : null}

          {activeFamilyShares.length > 0 && (
            <div className="iv-family-current-list">
              <p className="iv-family-current-title">Accesos activos</p>
              {activeFamilyShares.map((share) => (
                <div className="iv-family-current-item" key={share.id}>
                  <div>
                    <p className="iv-family-current-name">
                      {share.recipient_name || share.recipient_email || `Usuario #${share.recipient_user_id}`}
                    </p>
                    <p className="iv-family-current-meta">
                      {share.share_mode === "automatic" ? "Automatico" : "Manual"} · {share.include_audio ? "con audio" : "sin audio"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="iv-link-copy iv-link-copy-danger"
                    onClick={() => handleRevokeShare(share.id)}
                    disabled={loading === `revoke-${share.id}`}
                  >
                    {loading === `revoke-${share.id}` ? "Revocando..." : "Revocar"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Email modal */}
      {emailModal && (
        <div className="iv-email-modal">
          <p className="iv-email-modal-title">Enviar por correo</p>
          <input
            type="email"
            className="iv-email-input"
            placeholder="correo@ejemplo.cl"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            autoFocus
          />
          {emailError && <p style={{ color: "#f87171", fontSize: "0.8rem", margin: "0 0 0.5rem" }}>{emailError}</p>}
          <div className="iv-email-modal-actions">
            <button type="button" className="iv-btn iv-btn-ghost" onClick={() => { setEmailModal(false); setEmailError(""); }}>
              Cancelar
            </button>
            <button
              type="button"
              className="iv-btn iv-btn-primary"
              onClick={handleSendEmail}
              disabled={!emailInput.trim() || loading === "email"}
            >
              {loading === "email" ? "Enviando..." : "Enviar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Main ImmersiveVoice Component
   ══════════════════════════════════════════════════════════════════════════════ */

function LegacyImmersiveVoice({
  profileId,
  onDone,
  onClose,
  initialSession,
  shareTargets = [],
}) {
  // If initialSession provided, start in "done" state
  const [stage, setStage] = useState(initialSession ? "done" : "consent");
  const [error, setError] = useState("");
  const [timer, setTimer] = useState(0);
  const [closing, setClosing] = useState(false);
  const [result, setResult] = useState(initialSession || null);
  const [activeTab, setActiveTab] = useState("parati");
  const [sheetHeight, setSheetHeight] = useState(null); // null = CSS default
  const [professionalRole, setProfessionalRole] = useState(
    initialSession?.metadata_clinica?.profesional_clave || ""
  );
  const [sessionPreviewBlob, setSessionPreviewBlob] = useState(null);

  const sheetRef = useRef(null);
  const dragRef = useRef({ active: false, startY: 0, startH: 0 });
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const consentBlobRef = useRef(null);
  const timerRef = useRef(null);
  const recorderOptionRef = useRef(getPreferredVoiceRecorderOption());
  const [micReady, setMicReady] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  function animateClose(callback) {
    setClosing(true);
    setTimeout(() => {
      if (callback) callback();
      if (onClose) onClose();
    }, 300);
  }

  async function startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const preferredOption = getPreferredVoiceRecorderOption();
      let recorder;
      try {
        recorder = preferredOption.mimeType
          ? new MediaRecorder(stream, {
              mimeType: preferredOption.mimeType,
              audioBitsPerSecond: 64000,
            })
          : new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
      } catch {
        recorder = new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
      }
      recorderOptionRef.current = resolveVoiceMimeInfo(
        recorder.mimeType || preferredOption.mimeType || "",
        preferredOption.extension || "webm"
      );
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          if (!micReady) setMicReady(true);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start(500);
      return true;
    } catch {
      setError("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
      setStage("error");
      return false;
    }
  }

  function stopRecording() {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      const blob = () => buildRecordedVoiceBlob(
        chunksRef.current,
        recorder?.mimeType || recorderOptionRef.current?.mimeType || "",
        recorderOptionRef.current?.extension || "webm"
      );
      if (!recorder || recorder.state === "inactive") {
        resolve(blob());
        return;
      }
      recorder.onstop = () => {
        resolve(blob());
      };
      recorder.stop();
    });
  }

  /* ── Stage handlers ──────────────────────────────────────────────────────── */

  async function handleStartConsent() {
    setMicReady(false);
    setStage("recording_consent");
    await startMic();
  }

  async function handleConsentDone() {
    // Request a final data chunk before stopping to ensure we capture everything
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      try { recorder.requestData(); } catch { /* ignore */ }
    }
    const blob = await stopRecording();
    if (!blob || blob.size === 0) {
      setError("No se capturó audio del consentimiento. Intenta de nuevo y habla durante al menos 2 segundos.");
      setStage("error");
      stopStream();
      return;
    }
    consentBlobRef.current = blob;
    stopStream();
    setMicReady(false);
    setStage("recording_session");
    setTimer(0);
    const ok = await startMic();
    if (ok) {
      timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000);
    }
  }

  async function handleStop() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      try { recorder.requestData(); } catch { /* ignore */ }
    }
    const sessionBlob = await stopRecording();
    stopStream();

    if (!sessionBlob || sessionBlob.size === 0) {
      setError("No se capturó audio de la consulta. Intenta de nuevo.");
      setStage("error");
      return;
    }
    if (!consentBlobRef.current || consentBlobRef.current.size === 0) {
      setError("El audio de consentimiento está vacío. Intenta de nuevo desde el inicio.");
      setStage("error");
      return;
    }

    setSessionPreviewBlob(sessionBlob);
    setStage("processing");

    try {
      const data = await processVoiceSession({
        audioConsent: consentBlobRef.current,
        audioSession: sessionBlob,
        profileId,
        professionalRole,
      });
      setResult(data);
      setStage("done");
    } catch (err) {
      let msg;
      if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
        msg = "La consulta fue muy larga para procesar. Intenta con un fragmento más corto.";
      } else if (!err.response) {
        msg = "Sin conexión. Verifica tu internet e intenta de nuevo.";
      } else {
        const status = err.response.status;
        if (status === 413) msg = "El audio es muy largo. Intenta con una grabación más corta.";
        else if (status === 422) msg = "No se detectó voz clara en el audio.";
        else if (status === 503) msg = "El servicio de transcripción no está disponible.";
        else msg = err.response?.data?.detail || "Error al procesar. Intenta de nuevo.";
      }
      setError(msg);
      setStage("error");
    }
  }

  function handleRetry() {
    setError("");
    setTimer(0);
    setMicReady(false);
    consentBlobRef.current = null;
    setSessionPreviewBlob(null);
    setStage("consent");
  }

  function handleCancel() {
    stopStream();
    setSessionPreviewBlob(null);
    animateClose();
  }

  function handleSaveAndClose() {
    animateClose(() => {
      if (onDone && result) onDone(result);
    });
  }

  /* ── Sheet drag (mobile) ────────────────────────────────────────────────── */

  const handleSheetTouchStart = useCallback((e) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const touch = e.touches[0];
    dragRef.current = {
      active: true,
      startY: touch.clientY,
      startH: sheet.getBoundingClientRect().height,
    };
  }, []);

  const handleSheetTouchMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d.active) return;
    const touch = e.touches[0];
    const delta = d.startY - touch.clientY; // positive = drag up
    const vh = window.innerHeight;
    const minH = 120;
    const maxH = vh * 0.9;
    const newH = Math.min(maxH, Math.max(minH, d.startH + delta));
    setSheetHeight(newH);
  }, []);

  const handleSheetTouchEnd = useCallback(() => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    // Snap: if below 180px collapse to mini, otherwise keep
    const sheet = sheetRef.current;
    if (sheet) {
      const h = sheet.getBoundingClientRect().height;
      if (h < 180) setSheetHeight(180);
    }
  }, []);

  /* ── Render: Done state with bottom sheet ────────────────────────────────── */

  if (stage === "done" && result) {
    const tabs = [
      { key: "parati", label: "Para ti" },
      { key: "tecnica", label: "Técnica" },
      { key: "compartir", label: "Compartir" },
    ];

    return (
      <div className={`iv-overlay iv-overlay-done ${closing ? "iv-fade-out" : "iv-fade-in"}`}>
        <button type="button" className="iv-close" onClick={handleCancel} aria-label="Cerrar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Top area — orb + text */}
        <div className="iv-done-top">
          <div className="iv-orb iv-orb-green-solid">
            <CheckSvg />
          </div>
          <h2 className="iv-title iv-done-title">Consulta procesada</h2>
          <p className="iv-subtitle">Klinip IA analizó tu consulta</p>
          {(result.id || sessionPreviewBlob) && (
            <IvAudioPlayer sessionId={result.id} fallbackBlob={sessionPreviewBlob} />
          )}
        </div>

        {/* Bottom sheet */}
        <div
          className="iv-sheet"
          ref={sheetRef}
          style={sheetHeight ? { height: `${sheetHeight}px`, maxHeight: '90vh' } : undefined}
        >
          <div
            className="iv-sheet-handle"
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
          />

          {/* Tab selector */}
          <div className="iv-sheet-tabs">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`iv-sheet-tab ${activeTab === t.key ? "iv-sheet-tab-active" : ""}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="iv-sheet-body">
            {activeTab === "parati" && <TabParaTi result={result} />}
            {activeTab === "tecnica" && <TabTecnicaStructured result={result} />}
            {activeTab === "compartir" && <TabCompartir sessionId={result.id} />}
          </div>

          {/* Footer */}
          <div className="iv-sheet-footer">
            <button type="button" className="iv-btn iv-btn-primary iv-btn-full" onClick={handleSaveAndClose}>
              Guardar en ficha y cerrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Render: Recording states ────────────────────────────────────────────── */

  const orbClass =
    stage === "consent" ? "iv-orb-amber" :
    stage === "recording_consent" ? "iv-orb-purple" :
    stage === "recording_session" ? "iv-orb-purple" :
    stage === "processing" ? "iv-orb-green" :
    "iv-orb-red";

  const showWaves = stage === "recording_consent" || stage === "recording_session";
  const stepIndex =
    stage === "consent" ? 0 :
    stage === "recording_consent" ? 1 :
    stage === "recording_session" ? 2 : 2;

  return (
    <div className={`iv-overlay ${closing ? "iv-fade-out" : "iv-fade-in"}`}>
      <button type="button" className="iv-close" onClick={handleCancel} aria-label="Cerrar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="iv-content">
        {/* Orb */}
        <div className={`iv-orb ${orbClass}`}>
          {stage === "consent" && (
            <>
              <span className="iv-ring iv-ring-1" />
              <span className="iv-ring iv-ring-2" />
              <span className="iv-ring iv-ring-3" />
            </>
          )}
          {stage === "processing" ? <span className="iv-orb-spinner" /> : <MicSvg />}
        </div>

        {showWaves && <AudioWaves />}

        {stage === "recording_session" && (
          <div className="iv-timer">{formatTimer(timer)}</div>
        )}

        <div className="iv-text">
          {stage === "consent" && (
            <>
              <h2 className="iv-title">Pide autorización</h2>
              <p className="iv-subtitle">Solicita al profesional que autorice verbalmente la grabación</p>
            </>
          )}
          {stage === "recording_consent" && (
            <>
              <h2 className="iv-title">Grabando autorización</h2>
              <p className="iv-subtitle">Pide que diga: Autorizo la grabación de esta consulta</p>
            </>
          )}
          {stage === "recording_session" && (
            <>
              <h2 className="iv-title">Grabando consulta</h2>
              <p className="iv-subtitle">La consulta se está grabando</p>
            </>
          )}
          {stage === "processing" && (
            <>
              <h2 className="iv-title">Klinip IA procesando</h2>
              <p className="iv-subtitle">Transcribiendo y traduciendo tu consulta...</p>
            </>
          )}
          {stage === "error" && (
            <>
              <h2 className="iv-title">Error</h2>
              <p className="iv-subtitle">{error}</p>
            </>
          )}
        </div>

        {stage !== "processing" && stage !== "error" && (
          <StepDots current={stepIndex} total={3} />
        )}

        {stage === "consent" && (
          <div className="iv-role-card">
            <span className="iv-role-label">Profesional que estás grabando</span>
            <div className="iv-role-grid">
              {PROFESSIONAL_ROLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`iv-role-option ${professionalRole === option.value ? "is-active" : ""}`}
                  onClick={() => setProfessionalRole(option.value)}
                >
                  <span className="iv-role-option-title">{option.label}</span>
                  <span className="iv-role-option-helper">{option.helper}</span>
                </button>
              ))}
            </div>
            <p className="iv-role-disclaimer">
              Klinip ajustará la transcripción según este rol y evitará asumir un diagnóstico médico cuando no corresponda.
            </p>
          </div>
        )}

        <div className="iv-actions">
          {stage === "consent" && (
            <button type="button" className="iv-btn iv-btn-primary" onClick={handleStartConsent} disabled={!professionalRole}>
              El profesional autorizó
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="iv-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          )}
          {stage === "recording_consent" && (
            <button type="button" className="iv-btn iv-btn-primary" disabled={!micReady} onClick={handleConsentDone}>
              {micReady ? "Autorización registrada" : "Esperando audio..."}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="iv-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          )}
          {stage === "recording_session" && (
            <div className="iv-session-controls">
              <button type="button" className="iv-ctrl iv-ctrl-stop" onClick={handleStop} aria-label="Detener grabación">
                <span className="iv-ctrl-square" />
              </button>
            </div>
          )}
          {stage === "error" && (
            <button type="button" className="iv-btn iv-btn-primary" onClick={handleRetry}>
              Intentar de nuevo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
