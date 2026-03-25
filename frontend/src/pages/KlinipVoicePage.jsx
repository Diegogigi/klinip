import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getActiveHealthProfile,
  getHealthProfiles,
  getVoiceSessions,
} from "../api";
import { canWriteProfile } from "../utils/profileAccess";
import ImmersiveVoice from "../components/ImmersiveVoice";

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateMono(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

function getSessionStatus(session) {
  if (session.compartido_en) return "compartida";
  if (session.transcripcion_tecnica) return "procesada";
  return "sin_compartir";
}

const STATUS_CONFIG = {
  procesada: { label: "Procesada", className: "vp2-badge-green" },
  compartida: { label: "Compartida", className: "vp2-badge-blue" },
  sin_compartir: { label: "Sin compartir", className: "vp2-badge-amber" },
};

const FILTER_OPTIONS = [
  { key: "todas", label: "Todas" },
  { key: "procesada", label: "Procesadas" },
  { key: "compartida", label: "Compartidas" },
  { key: "sin_compartir", label: "Pendientes" },
];

const IND_COLORS = {
  medicamento: { bg: "rgba(37,99,235,0.08)", color: "#2563eb" },
  control: { bg: "rgba(0,179,119,0.08)", color: "#00B377" },
  examen: { bg: "rgba(59,130,246,0.08)", color: "#2563EB" },
  dieta: { bg: "rgba(0,179,119,0.08)", color: "#00B377" },
  ejercicio: { bg: "rgba(37,99,235,0.08)", color: "#2563eb" },
  otro: { bg: "rgba(107,114,128,0.08)", color: "#6b7280" },
};

/* ── Icons ─────────────────────────────────────────────────────────────────── */

function MicIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4M8 21h8" />
    </svg>
  );
}

function ShareSmallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/* ── How it works steps ────────────────────────────────────────────────────── */

const STEPS = [
  { n: "01", text: "Pide autorización verbal al profesional" },
  { n: "02", text: "Klinip sella el consentimiento legal" },
  { n: "03", text: "IA transcribe, traduce y extrae indicaciones" },
  { n: "04", text: "Comparte al profesional por email/WhatsApp/PDF" },
];

const FEATURE_TAGS = [
  "Transcripción IA",
  "Lenguaje simple",
  "Consentimiento legal",
  "Compartir al médico",
];

/* ══════════════════════════════════════════════════════════════════════════════
   Main VoicePage
   ══════════════════════════════════════════════════════════════════════════════ */

export default function KlinipVoicePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeProfile, setActiveProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [showRecorder, setShowRecorder] = useState(searchParams.get("record") === "1");
  const [immersiveSession, setImmersiveSession] = useState(null);
  const [filter, setFilter] = useState("todas");

  // Clean up ?record=1 from URL
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
        setActiveProfile(
          active || (Array.isArray(profiles) && profiles.length ? profiles[0] : null)
        );
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

  const filteredSessions = filter === "todas"
    ? sessions
    : sessions.filter((s) => getSessionStatus(s) === filter);

  if (loading) {
    return <div className="vp2-page"><div className="vp2-loading">Cargando...</div></div>;
  }

  return (
    <div className="vp2-page">
      {/* Immersive overlays */}
      {showRecorder && (
        <ImmersiveVoice
          profileId={activeProfile?.id}
          onDone={handleRecordingDone}
          onClose={() => setShowRecorder(false)}
        />
      )}
      {immersiveSession && !showRecorder && (
        <ImmersiveVoice
          profileId={activeProfile?.id}
          initialSession={immersiveSession}
          onDone={handleRecordingDone}
          onClose={() => setImmersiveSession(null)}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="vp2-header">
        <div>
          <span className="vp2-eyebrow">
            <span className="vp2-eyebrow-dot" />
            AI-powered · Clinical Voice
          </span>
          <h1 className="vp2-title">Klinip Voice</h1>
          <p className="vp2-subtitle">Consultas grabadas · {profileName}</p>
        </div>
        <button
          type="button"
          className="vp2-new-btn"
          disabled={!canEdit}
          onClick={() => setShowRecorder(true)}
        >
          <MicIcon className="vp2-new-btn-icon" />
          Nueva grabación
        </button>
      </div>

      {/* ── Grid ────────────────────────────────────────────────────────────── */}
      <div className="vp2-grid">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="vp2-left">
          {/* Hero card */}
          <div className="vp2-hero">
            <span className="vp2-hero-circle vp2-hero-circle-tr" />
            <span className="vp2-hero-circle vp2-hero-circle-bl" />
            <div className="vp2-hero-inner">
              <div className="vp2-hero-orb">
                <MicIcon className="vp2-hero-orb-icon" />
              </div>
              <h2 className="vp2-hero-title">Graba tu próxima consulta</h2>
              <p className="vp2-hero-desc">
                Convierte la voz del médico en inteligencia clínica accionable para ti y tu familia.
              </p>
              <button
                type="button"
                className="vp2-hero-btn"
                disabled={!canEdit}
                onClick={() => setShowRecorder(true)}
              >
                <MicIcon className="vp2-hero-btn-mic" />
                Iniciar grabación
              </button>
              <div className="vp2-hero-tags">
                {FEATURE_TAGS.map((t) => (
                  <span key={t} className="vp2-hero-tag">{t}</span>
                ))}
              </div>
            </div>
          </div>

          {/* How it works */}
          <div className="vp2-how">
            <span className="vp2-how-label">CÓMO FUNCIONA</span>
            <div className="vp2-how-steps">
              {STEPS.map((step, i) => (
                <div key={step.n} className="vp2-how-step">
                  <span className="vp2-how-num">{step.n}</span>
                  <span className="vp2-how-text">{step.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div className="vp2-right">
          {/* History header + filters */}
          <div className="vp2-hist-header">
            <h2 className="vp2-hist-title">Historial de sesiones</h2>
            <div className="vp2-filters">
              {FILTER_OPTIONS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`vp2-filter ${filter === f.key ? "vp2-filter-active" : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sessions loading */}
          {sessionsLoading && (
            <div className="vp2-loading">Cargando sesiones...</div>
          )}

          {/* Sessions list */}
          {!sessionsLoading && filteredSessions.length > 0 && (
            <div className="vp2-sessions">
              {filteredSessions.map((s) => {
                const status = getSessionStatus(s);
                const cfg = STATUS_CONFIG[status];
                const indicaciones = s.indicaciones || [];
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="vp2-card"
                    onClick={() => setImmersiveSession(s)}
                  >
                    <div className="vp2-card-left-bar" />
                    <div className="vp2-card-icon-wrap">
                      <MicIcon className="vp2-card-icon" />
                    </div>
                    <div className="vp2-card-body">
                      <span className="vp2-card-name">
                        Consulta {formatDate(s.created_at)}
                      </span>
                      <span className="vp2-card-meta">
                        <span className="vp2-card-date">{formatDateMono(s.created_at)}</span>
                      </span>
                      {indicaciones.length > 0 && (
                        <div className="vp2-card-chips">
                          {indicaciones.slice(0, 3).map((ind, i) => {
                            const c = IND_COLORS[ind.tipo] || IND_COLORS.otro;
                            return (
                              <span key={i} className="vp2-card-chip" style={{ background: c.bg, color: c.color }}>
                                {ind.tipo}
                              </span>
                            );
                          })}
                          {indicaciones.length > 3 && (
                            <span className="vp2-card-chip vp2-card-chip-more">+{indicaciones.length - 3}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="vp2-card-right">
                      <span className={`vp2-card-badge ${cfg.className}`}>{cfg.label}</span>
                      <div className="vp2-card-actions">
                        <span className="vp2-card-action"><EyeIcon /> Ver</span>
                        <span className="vp2-card-action"><ShareSmallIcon /> Compartir</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {!sessionsLoading && filteredSessions.length === 0 && (
            <div className="vp2-empty">
              <div className="vp2-empty-orb">
                <MicIcon className="vp2-empty-icon" />
              </div>
              <h3 className="vp2-empty-title">
                {filter === "todas" ? "Sin grabaciones aún" : "Sin sesiones en este filtro"}
              </h3>
              <p className="vp2-empty-desc">
                {filter === "todas"
                  ? "Graba tu primera consulta médica y Klinip IA la procesará automáticamente."
                  : "Cambia el filtro o graba una nueva sesión."}
              </p>
              {filter === "todas" && (
                <button
                  type="button"
                  className="vp2-empty-btn"
                  disabled={!canEdit}
                  onClick={() => setShowRecorder(true)}
                >
                  Iniciar primera grabación
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
