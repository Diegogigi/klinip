import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getActiveHealthProfile,
  getHealthProfiles,
  getVoiceSessions,
} from "../api";
import { canWriteProfile } from "../utils/profileAccess";
import ImmersiveVoice from "../components/ImmersiveVoice";

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getSessionStatus(session) {
  if (session.compartido_en) return "compartida";
  if (session.transcripcion_tecnica) return "procesada";
  return "sin_compartir";
}

const STATUS_CONFIG = {
  procesada: { label: "Procesada", className: "vp-badge-green" },
  compartida: { label: "Compartida", className: "vp-badge-purple" },
  sin_compartir: { label: "Sin compartir", className: "vp-badge-orange" },
};

function MicIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4M8 21h8" />
    </svg>
  );
}

// ── Main VoicePage ───────────────────────────────────────────────────────────

export default function KlinipVoicePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeProfile, setActiveProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [showRecorder, setShowRecorder] = useState(searchParams.get("record") === "1");
  const [immersiveSession, setImmersiveSession] = useState(null);

  // Clean up ?record=1 from URL after opening
  useEffect(() => {
    if (searchParams.get("record") === "1") {
      searchParams.delete("record");
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  // Load profile
  useEffect(() => {
    (async () => {
      try {
        const [profiles, active] = await Promise.all([
          getHealthProfiles(),
          getActiveHealthProfile().catch(() => null),
        ]);
        const resolved =
          active || (Array.isArray(profiles) && profiles.length ? profiles[0] : null);
        setActiveProfile(resolved);
      } catch {
        setActiveProfile(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load sessions
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await getVoiceSessions();
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && activeProfile) loadSessions();
  }, [loading, activeProfile, loadSessions]);

  const canEdit = canWriteProfile(activeProfile);
  const profileName = activeProfile?.full_name || activeProfile?.nombre || "Perfil";

  function handleRecordingDone() {
    setShowRecorder(false);
    setImmersiveSession(null);
    loadSessions();
  }

  if (loading) {
    return (
      <div className="vp-page">
        <div className="vp-loading">Cargando...</div>
      </div>
    );
  }

  const hasSessions = sessions.length > 0;

  return (
    <div className="vp-page">
      {/* Immersive overlay — new recording */}
      {showRecorder && (
        <ImmersiveVoice
          profileId={activeProfile?.id}
          onDone={handleRecordingDone}
          onClose={() => setShowRecorder(false)}
        />
      )}

      {/* Immersive overlay — view session results */}
      {immersiveSession && !showRecorder && (
        <ImmersiveVoice
          profileId={activeProfile?.id}
          initialSession={immersiveSession}
          onDone={handleRecordingDone}
          onClose={() => setImmersiveSession(null)}
        />
      )}

      {/* Header */}
      <div className="vp-header">
        <div>
          <h1 className="vp-title">Klinip Voice</h1>
          <p className="vp-subtitle">Consultas grabadas · {profileName}</p>
        </div>
        {hasSessions && (
          <button
            type="button"
            className="vp-new-btn"
            disabled={!canEdit}
            onClick={() => setShowRecorder(true)}
          >
            <MicIcon className="vp-new-btn-icon" />
            Nueva grabación
          </button>
        )}
      </div>

      {/* Hero card when no sessions */}
      {!hasSessions && !sessionsLoading && (
        <div className="vp-hero">
          <div className="vp-hero-content">
            <MicIcon className="vp-hero-icon" />
            <h2 className="vp-hero-title">Graba tu próxima consulta</h2>
            <p className="vp-hero-desc">
              Klinip Voice convierte la voz del médico en inteligencia clínica:
              transcripción técnica, versión simple para ti y tu familia, e
              indicaciones extraídas automáticamente.
            </p>
            <button
              type="button"
              className="vp-hero-btn"
              disabled={!canEdit}
              onClick={() => setShowRecorder(true)}
            >
              <span className="vp-hero-btn-icon">
                <MicIcon className="vp-hero-btn-mic" />
              </span>
              Iniciar grabación
            </button>
          </div>
        </div>
      )}

      {/* Sessions loading */}
      {sessionsLoading && (
        <div className="vp-loading">Cargando sesiones...</div>
      )}

      {/* Sessions list */}
      {hasSessions && (
        <div className="vp-sessions">
          {sessions.map((s) => {
            const status = getSessionStatus(s);
            const cfg = STATUS_CONFIG[status];
            return (
              <button
                key={s.id}
                type="button"
                className="vp-session-card"
                onClick={() => setImmersiveSession(s)}
              >
                <div className="vp-session-icon-wrap">
                  <MicIcon className="vp-session-icon" />
                </div>
                <div className="vp-session-info">
                  <span className="vp-session-title">
                    Consulta {formatDate(s.created_at)}
                  </span>
                  <span className="vp-session-meta">
                    {formatDate(s.created_at)}
                  </span>
                </div>
                <span className={`vp-session-badge ${cfg.className}`}>
                  {cfg.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
