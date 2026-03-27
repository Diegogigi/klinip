import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { getSharedVoiceSession, sharedVoiceAudioUrl } from "../api";
import {
  getVoiceProfessionalMeta,
  parseVoiceTechnicalSections,
} from "../utils/voiceTranscriptFormat";

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const IND_COLORS = {
  medicamento: { bg: "rgba(37,99,235,0.1)", color: "#2563eb", border: "rgba(37,99,235,0.2)" },
  control: { bg: "rgba(0,179,119,0.1)", color: "#00B377", border: "rgba(0,179,119,0.2)" },
  examen: { bg: "rgba(59,130,246,0.1)", color: "#3b82f6", border: "rgba(59,130,246,0.2)" },
  dieta: { bg: "rgba(0,179,119,0.1)", color: "#00B377", border: "rgba(0,179,119,0.2)" },
  ejercicio: { bg: "rgba(37,99,235,0.1)", color: "#2563eb", border: "rgba(37,99,235,0.2)" },
  reposo: { bg: "rgba(234,179,8,0.1)", color: "#ca8a04", border: "rgba(234,179,8,0.2)" },
  cuidado: { bg: "rgba(107,114,128,0.1)", color: "#6b7280", border: "rgba(107,114,128,0.2)" },
  otro: { bg: "rgba(107,114,128,0.08)", color: "#6b7280", border: "rgba(107,114,128,0.15)" },
};

/* ── Icons ─────────────────────────────────────────────────────────────────── */

function KlinipLogo() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="sv-logo-icon">
      <rect width="32" height="32" rx="8" fill="#2563eb" />
      <path d="M10 22V10h3v5l5-5h4l-6 6 6 6h-4l-5-5v5z" fill="#fff" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 22, height: 22 }}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 22, height: 22 }}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 16, height: 16 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

/* ── Audio Player ──────────────────────────────────────────────────────────── */

function AudioPlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
    } else {
      a.play();
    }
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

  return (
    <div className="sv-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setPlaying(false)}
      />
      <button type="button" className="sv-player-btn" onClick={toggle} aria-label={playing ? "Pausar" : "Reproducir"}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="sv-player-track">
        <input
          type="range"
          className="sv-player-range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          onChange={handleSeek}
        />
        <div className="sv-player-times">
          <span>{fmt(currentTime)}</span>
          <span>{duration ? fmt(duration) : "--:--"}</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   SharedVoicePage — Public page for professionals
   ══════════════════════════════════════════════════════════════════════════════ */

export default function SharedVoicePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await getSharedVoiceSession(token);
        setData(result);
      } catch (err) {
        const status = err?.response?.status;
        if (status === 410) setError("expired");
        else if (status === 404) setError("not_found");
        else setError("generic");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="sv-page">
        <div className="sv-loading">
          <div className="sv-spinner" />
          <p>Cargando registro...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sv-page">
        <div className="sv-error-card">
          <KlinipLogo />
          <h2>
            {error === "expired"
              ? "Enlace expirado"
              : error === "not_found"
              ? "Enlace no encontrado"
              : "Error al cargar"}
          </h2>
          <p>
            {error === "expired"
              ? "Este enlace de consulta ha expirado. Solicite al paciente que genere uno nuevo desde la app Klinip."
              : error === "not_found"
              ? "El enlace no es válido o ya no existe."
              : "Hubo un problema al cargar el registro. Intente de nuevo más tarde."}
          </p>
        </div>
      </div>
    );
  }

  const audioSrc = data.has_audio ? sharedVoiceAudioUrl(token) : null;
  const indicaciones = data.indicaciones || [];
  const meta = data.metadata_clinica || {};
  const professionalMeta = getVoiceProfessionalMeta(meta);
  const technicalSections = parseVoiceTechnicalSections(
    data.transcripcion_tecnica,
    meta
  );

  return (
    <div className="sv-page">
      {/* Header */}
      <header className="sv-header">
        <div className="sv-header-left">
          <KlinipLogo />
          <div>
            <span className="sv-header-brand">Klinip Voice</span>
            <span className="sv-header-sub">Registro de consulta</span>
          </div>
        </div>
        <div className="sv-header-badge">
          <ShieldIcon />
          <span>Vista segura · acceso temporal</span>
        </div>
      </header>

      {/* Main card */}
      <div className="sv-card">
        {/* Session meta */}
        <div className="sv-meta">
          <div className="sv-meta-row">
            <span className="sv-meta-label">Fecha de consulta</span>
            <span className="sv-meta-value">{data.created_at || "Sin fecha"}</span>
          </div>
          <div className="sv-meta-row">
            <span className="sv-meta-label">Paciente</span>
            <span className="sv-meta-value">{data.profile_name}</span>
          </div>
          {data.consent_timestamp && (
            <div className="sv-meta-row">
              <span className="sv-meta-label">Consentimiento verbal</span>
              <span className="sv-meta-value sv-meta-consent">
                <ShieldIcon /> Registrado el {formatDate(data.consent_timestamp)}
              </span>
            </div>
          )}
          {(meta.profesional_confirmado || meta.especialidad_inferida) && (
            <div className="sv-meta-row">
              <span className="sv-meta-label">Rol confirmado</span>
              <span className="sv-meta-value">
                {meta.profesional_confirmado || meta.especialidad_inferida}
              </span>
            </div>
          )}
          {data.audio_session_hash && (
            <div className="sv-meta-row">
              <span className="sv-meta-label">Hash de integridad</span>
              <span className="sv-meta-value sv-meta-hash">{data.audio_session_hash}</span>
            </div>
          )}
        </div>

        {/* Audio player */}
        {audioSrc && (
          <div className="sv-section">
            <h3 className="sv-section-title">Audio de la consulta</h3>
            <AudioPlayer src={audioSrc} />
          </div>
        )}

        {/* Transcription */}
        <div className="sv-section">
          <h3 className="sv-section-title">Transcripción clínica</h3>
          <div className="sv-transcription">
            <div className="sv-tech-context">
              <span className="sv-tech-context-label">CONTEXTO CLÍNICO</span>
              <p className="sv-tech-context-role">
                Rol confirmado: {professionalMeta.role}
              </p>
              <p className="sv-tech-context-helper">
                {professionalMeta.disclaimer}
              </p>
            </div>

            {technicalSections.length ? (
              <div className="sv-tech-sections">
                {technicalSections.map((section) => (
                  <section
                    key={section.id}
                    className={`sv-tech-card tone-${section.tone.key}`}
                  >
                    <div className="sv-tech-card-head">
                      <h4 className="sv-tech-card-title">{section.title}</h4>
                      <span className={`sv-tech-badge tone-${section.tone.key}`}>
                        {section.tone.label}
                      </span>
                    </div>
                    <div className="sv-tech-card-body">
                      {section.lines.map((line, index) => (
                        <p key={`${section.id}-${index}`} className="sv-tech-line">
                          {line}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              "Sin transcripción disponible."
            )}
          </div>
        </div>

        {/* Indicaciones */}
        {indicaciones.length > 0 && (
          <div className="sv-section">
            <h3 className="sv-section-title">Indicaciones extraídas ({indicaciones.length})</h3>
            <div className="sv-indications">
              {indicaciones.map((ind, i) => {
                const c = IND_COLORS[ind.tipo] || IND_COLORS.otro;
                return (
                  <div key={i} className="sv-indication" style={{ background: c.bg, borderColor: c.border }}>
                    <span className="sv-indication-type" style={{ color: c.color }}>
                      {(ind.tipo || "otro").toUpperCase()}
                    </span>
                    <span className="sv-indication-text">{ind.texto}</span>
                    {ind.detalle_recordatorio && (
                      <span className="sv-indication-detail">{ind.detalle_recordatorio}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="sv-footer">
        <p>Generado por Klinip Voice · klinip.cl</p>
        <p className="sv-footer-disclaimer">
          Este documento fue generado automáticamente por inteligencia artificial a partir de una grabación de consulta.
          La transcripción IA puede contener imprecisiones. El audio original es la fuente de verdad.
        </p>
        {data.expires_at && (
          <p className="sv-footer-expires">
            Este enlace expira el {formatDate(data.expires_at)}
          </p>
        )}
      </footer>
    </div>
  );
}
