import React, { useState, useRef, useEffect, useCallback } from "react";
import { processVoiceSession } from "../api";

const TIPO_LABELS = {
  medicamento: "Medicamento",
  control: "Control",
  examen: "Examen",
  dieta: "Dieta",
  ejercicio: "Ejercicio",
  otro: "Otro",
};

const TIPO_TONES = {
  medicamento: "amber",
  control: "blue",
  examen: "teal",
  dieta: "green",
  ejercicio: "violet",
  otro: "neutral",
};

function formatTimer(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function KlinipVoice({ profileId, canEdit }) {
  // States: idle | consent_digital | recording_consent | recording_session | processing | done
  const [stage, setStage] = useState("idle");
  const [error, setError] = useState("");
  const [timer, setTimer] = useState(0);
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState("simple");
  const [shareOpen, setShareOpen] = useState(false);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const consentBlobRef = useRef(null);
  const timerRef = useRef(null);

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

  async function startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm", audioBitsPerSecond: 64000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(500);
      return true;
    } catch {
      setError("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
      setStage("idle");
      return false;
    }
  }

  function stopRecording() {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve(new Blob(chunksRef.current, { type: "audio/webm" }));
        return;
      }
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: "audio/webm" }));
      };
      recorder.stop();
    });
  }

  // ── Stage handlers ──

  function handleStart() {
    setError("");
    setStage("consent_digital");
  }

  async function handleConsentAccepted() {
    setStage("recording_consent");
    await startMic();
  }

  async function handleConsentDone() {
    const blob = await stopRecording();
    consentBlobRef.current = blob;
    stopStream();

    setStage("recording_session");
    setTimer(0);
    const ok = await startMic();
    if (ok) {
      timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000);
    }
  }

  async function handleStopSession() {
    const sessionBlob = await stopRecording();
    stopStream();
    setStage("processing");

    try {
      const data = await processVoiceSession({
        audioConsent: consentBlobRef.current,
        audioSession: sessionBlob,
        profileId,
      });
      setResult(data);
      setStage("done");
    } catch (err) {
      const detail = err?.response?.data?.detail || "Error al procesar el audio. Intenta de nuevo.";
      setError(detail);
      setStage("idle");
    }
  }

  function handleReset() {
    setStage("idle");
    setResult(null);
    setError("");
    setTimer(0);
    setActiveTab("simple");
    setShareOpen(false);
    consentBlobRef.current = null;
  }

  // ── Render ──

  if (stage === "idle") {
    return (
      <article className="home-panel-card home-voice-card">
        <div className="home-panel-head">
          <div>
            <h2 className="home-panel-title">Klinip Voice</h2>
            <p className="home-panel-subtitle">Graba tu próxima consulta médica.</p>
          </div>
        </div>
        {error && <p className="voice-error">{error}</p>}
        <div className="voice-body">
          <button
            type="button"
            className="home-note-primary home-voice-btn"
            disabled={!canEdit}
            onClick={handleStart}
          >
            Iniciar grabación
          </button>
        </div>
      </article>
    );
  }

  if (stage === "consent_digital") {
    return (
      <article className="home-panel-card home-voice-card">
        <div className="home-panel-head">
          <div>
            <h2 className="home-panel-title">Klinip Voice</h2>
            <p className="home-panel-subtitle">Aviso antes de grabar</p>
          </div>
        </div>
        <div className="voice-body">
          <div className="voice-consent-box">
            <p className="voice-consent-text">
              Esta sesión será grabada. El profesional debe autorizar verbalmente antes de continuar.
            </p>
            <div className="voice-consent-actions">
              <button type="button" className="home-note-secondary" onClick={handleReset}>
                Cancelar
              </button>
              <button type="button" className="home-note-primary home-voice-btn" onClick={handleConsentAccepted}>
                Entendido, iniciar
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  }

  if (stage === "recording_consent") {
    return (
      <article className="home-panel-card home-voice-card voice-recording">
        <div className="home-panel-head">
          <div>
            <h2 className="home-panel-title">Klinip Voice</h2>
            <p className="home-panel-subtitle">Grabando consentimiento...</p>
          </div>
        </div>
        <div className="voice-body">
          <div className="voice-recording-indicator">
            <span className="voice-rec-dot" />
            <span>Grabando</span>
          </div>
          <p className="voice-consent-text">
            Pide al profesional que autorice verbalmente la grabación.
          </p>
          <button type="button" className="home-note-primary home-voice-btn" onClick={handleConsentDone}>
            El profesional acaba de autorizar →
          </button>
        </div>
      </article>
    );
  }

  if (stage === "recording_session") {
    return (
      <article className="home-panel-card home-voice-card voice-recording">
        <div className="home-panel-head">
          <div>
            <h2 className="home-panel-title">Klinip Voice</h2>
            <p className="home-panel-subtitle">Grabando consulta</p>
          </div>
        </div>
        <div className="voice-body">
          <div className="voice-recording-indicator">
            <span className="voice-rec-dot" />
            <span>Grabando consulta</span>
          </div>
          <div className="voice-timer">{formatTimer(timer)}</div>
          <button type="button" className="home-note-primary voice-stop-btn" onClick={handleStopSession}>
            Detener grabación
          </button>
        </div>
      </article>
    );
  }

  if (stage === "processing") {
    return (
      <article className="home-panel-card home-voice-card">
        <div className="home-panel-head">
          <div>
            <h2 className="home-panel-title">Klinip Voice</h2>
            <p className="home-panel-subtitle">Procesando</p>
          </div>
        </div>
        <div className="voice-body voice-processing">
          <div className="voice-spinner" />
          <p>Klinip IA está procesando tu consulta...</p>
        </div>
      </article>
    );
  }

  // stage === "done"
  if (stage === "done" && result) {
    const indicaciones = result.indicaciones || [];
    return (
      <article className="home-panel-card home-voice-card voice-done">
        <div className="home-panel-head">
          <div>
            <h2 className="home-panel-title">Klinip Voice</h2>
            <p className="home-panel-subtitle">Resultados listos</p>
          </div>
          <button type="button" className="home-panel-link" onClick={handleReset}>
            Nueva sesión
          </button>
        </div>

        <div className="voice-tabs">
          <button
            type="button"
            className={`voice-tab ${activeTab === "simple" ? "is-active" : ""}`}
            onClick={() => setActiveTab("simple")}
          >
            Para ti
          </button>
          <button
            type="button"
            className={`voice-tab ${activeTab === "tecnica" ? "is-active" : ""}`}
            onClick={() => setActiveTab("tecnica")}
          >
            Transcripción técnica
          </button>
        </div>

        <div className="voice-body">
          {activeTab === "simple" && (
            <>
              <div className="voice-simple-text">
                {result.version_simple || "Sin resumen disponible."}
              </div>
              {indicaciones.length > 0 && (
                <div className="voice-indicaciones">
                  <h3 className="voice-indicaciones-title">Indicaciones</h3>
                  {indicaciones.map((ind, i) => (
                    <div key={i} className="voice-indicacion-card">
                      <div className="voice-indicacion-header">
                        <span className={`voice-indicacion-chip tone-${TIPO_TONES[ind.tipo] || "neutral"}`}>
                          {TIPO_LABELS[ind.tipo] || ind.tipo}
                        </span>
                        {ind.recordatorio_sugerido && (
                          <button type="button" className="voice-reminder-btn" disabled>
                            Crear recordatorio
                          </button>
                        )}
                      </div>
                      <p className="voice-indicacion-text">{ind.texto}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === "tecnica" && (
            <div className="voice-tecnica-text">
              {result.transcripcion_tecnica || "Sin transcripción disponible."}
            </div>
          )}
        </div>

        <div className="voice-actions-footer">
          <button
            type="button"
            className="home-note-secondary"
            onClick={() => setShareOpen(!shareOpen)}
          >
            Compartir con el profesional
          </button>
          <button type="button" className="home-note-primary home-voice-btn" disabled>
            Guardar en ficha
          </button>
        </div>

        {shareOpen && (
          <div className="voice-share-options">
            <p className="voice-share-title">Compartir vía:</p>
            <button type="button" className="voice-share-option" disabled>
              Email
            </button>
            <button type="button" className="voice-share-option" disabled>
              WhatsApp
            </button>
            <button type="button" className="voice-share-option" disabled>
              Descargar PDF
            </button>
            <p className="voice-share-note">Disponible próximamente</p>
          </div>
        )}
      </article>
    );
  }

  return null;
}
