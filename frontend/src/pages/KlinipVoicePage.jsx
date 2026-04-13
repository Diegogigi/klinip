import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getActiveHealthProfile,
  getHealthProfiles,
  getProfileAutomation,
  getVoiceReceivedSessions,
  getVoiceSessions,
  getVoiceShareTargets,
  setActiveHealthProfile,
  updateProfileAutomation,
} from "../api";
import { canWriteProfile, isViewerProfile } from "../utils/profileAccess";
import ImmersiveVoice from "../components/ImmersiveVoice";
import { ensureArray } from "../utils/arrays";

const DEFAULT_AUTOMATION = {
  voice_auto_share_enabled: false,
  voice_auto_share_include_audio: true,
  voice_auto_share_recipient_ids: [],
};

const FILTER_OPTIONS = [
  { key: "todas", label: "Todas" },
  { key: "procesada", label: "Procesadas" },
  { key: "compartida", label: "Compartidas" },
  { key: "sin_compartir", label: "Pendientes" },
];

const OWN_VIEW_OPTIONS = [
  { key: "mine", label: "Mis grabaciones" },
  { key: "shared", label: "Compartido conmigo" },
];

const STATUS_CONFIG = {
  procesada: { label: "Procesada", className: "vp2-badge-green" },
  compartida: { label: "Compartida", className: "vp2-badge-blue" },
  sin_compartir: { label: "Sin compartir", className: "vp2-badge-amber" },
  received: { label: "Compartida contigo", className: "vp2-badge-blue" },
};

const IND_COLORS = {
  medicamento: { bg: "rgba(37,99,235,0.08)", color: "#2563eb" },
  control: { bg: "rgba(0,179,119,0.08)", color: "#00B377" },
  examen: { bg: "rgba(59,130,246,0.08)", color: "#2563EB" },
  dieta: { bg: "rgba(0,179,119,0.08)", color: "#00B377" },
  ejercicio: { bg: "rgba(37,99,235,0.08)", color: "#2563eb" },
  reposo: { bg: "rgba(148,163,184,0.12)", color: "#475569" },
  cuidado: { bg: "rgba(14,165,233,0.1)", color: "#0369a1" },
  otro: { bg: "rgba(107,114,128,0.08)", color: "#6b7280" },
};

const STEPS = [
  { n: "01", text: "Pide autorización verbal al profesional" },
  { n: "02", text: "Klinip registra el consentimiento" },
  { n: "03", text: "La IA resume la atención en lenguaje simple" },
  { n: "04", text: "Comparte con profesionales o familia autorizada" },
];

const FEATURE_TAGS = [
  "Transcripción IA",
  "Lenguaje simple",
  "Compartido familiar",
  "Audio protegido",
];

function normalizeAutomation(data) {
  return {
    voice_auto_share_enabled: Boolean(data?.voice_auto_share_enabled),
    voice_auto_share_include_audio: data?.voice_auto_share_include_audio !== false,
    voice_auto_share_recipient_ids: ensureArray(data?.voice_auto_share_recipient_ids).map((item) => Number(item)).filter(Boolean),
  };
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
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

function formatDateMono(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

function getSessionStatus(session) {
  if ((session?.family_share_active_count || 0) > 0 || session?.compartido_en) return "compartida";
  if (session?.transcripcion_tecnica || session?.version_simple) return "procesada";
  return "sin_compartir";
}

function profileLabel(profile) {
  return profile?.full_name || profile?.nombre || "Perfil";
}

function sessionTitle(session, isSharedView = false) {
  if (isSharedView) {
    const sender = session?.shared_by_name || "Tu familia";
    return `Atención compartida por ${sender}`;
  }
  return `Consulta ${formatDate(session?.created_at)}`;
}

function sessionMetaLine(session, isSharedView = false) {
  if (isSharedView) {
    return session?.shared_at
      ? `Compartida el ${formatDateTime(session.shared_at)}`
      : "Disponible en tu bandeja compartida";
  }
  if ((session?.family_share_active_count || 0) > 0) {
    const count = Number(session.family_share_active_count) || 0;
    return `${count} integrante${count === 1 ? "" : "s"} con acceso activo`;
  }
  return "Resumen simple e indicaciones guardadas";
}

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
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
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

function SessionCard({ session, onOpen, isSharedView = false }) {
  const statusKey = isSharedView ? "received" : getSessionStatus(session);
  const status = STATUS_CONFIG[statusKey];
  const indicaciones = Array.isArray(session?.indicaciones) ? session.indicaciones : [];
  const dateValue = isSharedView ? session?.shared_at || session?.created_at : session?.created_at;
  const audioLabel = isSharedView ? (session?.audio_available ? "Con audio" : "Solo resumen") : null;

  return (
    <button type="button" className="vp2-card" onClick={() => onOpen(session)}>
      <div className="vp2-card-left-bar" />
      <div className="vp2-card-icon-wrap">
        <MicIcon className="vp2-card-icon" />
      </div>
      <div className="vp2-card-body">
        <span className="vp2-card-name">{sessionTitle(session, isSharedView)}</span>
        <span className="vp2-card-meta">
          <span className="vp2-card-date">{formatDateMono(dateValue)}</span>
          {audioLabel ? <span className="vp2-card-inline-chip">{audioLabel}</span> : null}
        </span>
        <p className="vp2-card-copy">{sessionMetaLine(session, isSharedView)}</p>
        {indicaciones.length > 0 && (
          <div className="vp2-card-chips">
            {indicaciones.slice(0, 3).map((ind, index) => {
              const color = IND_COLORS[ind?.tipo] || IND_COLORS.otro;
              const label = ind?.tipo || "otro";
              return (
                <span key={`${label}-${index}`} className="vp2-card-chip" style={{ background: color.bg, color: color.color }}>
                  {label}
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
        <span className={`vp2-card-badge ${status.className}`}>{status.label}</span>
        <div className="vp2-card-actions">
          <span className="vp2-card-action"><EyeIcon /> Ver</span>
          {!isSharedView && (
            <span className="vp2-card-action"><ShareSmallIcon /> Compartir</span>
          )}
        </div>
      </div>
    </button>
  );
}

function AutomationPanel({
  activeProfile,
  canEdit,
  loading,
  saving,
  draft,
  shareTargets,
  error,
  status,
  onToggleEnabled,
  onToggleAudio,
  onToggleRecipient,
  onSave,
}) {
  const profileName = profileLabel(activeProfile);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`vp2-panel-card vp2-automation-card ${expanded ? "is-open" : "is-collapsed"}`}>
      <div className="vp2-panel-head">
        <div>
          <span className="vp2-panel-label">AUTOMATIZACIÓN</span>
          <h3 className="vp2-panel-title">Compartido automático</h3>
        </div>
        <div className="vp2-panel-head-actions">
          <span className={`vp2-pill ${draft.voice_auto_share_enabled ? "is-active" : ""}`}>
            {draft.voice_auto_share_enabled ? "Activo" : "Manual"}
          </span>
          <button
            type="button"
            className={`vp2-panel-toggle ${expanded ? "is-open" : ""}`}
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-controls="voice-automation-panel-body"
          >
            {expanded ? "Ocultar" : "Ver"}
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4.25 6.25 8 10l3.75-3.75"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
              />
            </svg>
          </button>
        </div>
      </div>

      {expanded ? (
        <div id="voice-automation-panel-body" className="vp2-panel-body">
          <p className="vp2-panel-copy">
            Envía automáticamente el resumen simple de cada nueva atención a los familiares seleccionados de {profileName}.
          </p>
          <p className="vp2-panel-note">
            Opcional: incluir audio. La transcripción técnica no se comparte.
          </p>

      {!canEdit ? (
        <div className="vp2-inline-note">
          Estás en modo lectura para este perfil. Puedes revisar compartidos, pero no cambiar la automatización.
        </div>
      ) : null}

      {loading ? (
        <div className="vp2-inline-note">Cargando automatización...</div>
      ) : (
        <>
          <label className="vp2-switch-row">
            <input
              type="checkbox"
              checked={draft.voice_auto_share_enabled}
              onChange={(e) => onToggleEnabled(e.target.checked)}
              disabled={!canEdit || saving}
            />
            <span className="vp2-switch-copy">
              <strong>Compartir automáticamente nuevas atenciones</strong>
              <small>Se aplica solo al perfil activo.</small>
            </span>
          </label>

          <label className="vp2-switch-row">
            <input
              type="checkbox"
              checked={draft.voice_auto_share_include_audio}
              onChange={(e) => onToggleAudio(e.target.checked)}
              disabled={!canEdit || saving}
            />
            <span className="vp2-switch-copy">
              <strong>Incluir audio original</strong>
              <small>Los familiares podrán reproducirlo, no descargarlo.</small>
            </span>
          </label>

          <div className="vp2-recipient-block">
            <div className="vp2-recipient-head">
              <strong>Destinatarios automáticos</strong>
              <small>Solo integrantes con acceso aceptado a este perfil.</small>
            </div>

            {Array.isArray(shareTargets) && shareTargets.length > 0 ? (
              <div className="vp2-recipient-list">
                {shareTargets.map((target) => {
                  const checked = draft.voice_auto_share_recipient_ids.includes(target.user_id);
                  return (
                    <label
                      key={target.user_id}
                      className={`vp2-recipient-item ${checked ? "is-selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleRecipient(target.user_id)}
                        disabled={!canEdit || saving}
                      />
                      <span className="vp2-recipient-main">
                        <span className="vp2-recipient-name">
                          {target.user_name || target.user_email || `Usuario #${target.user_id}`}
                        </span>
                        <span className="vp2-recipient-meta">
                          {target.relationship_type || target.role || "Integrante"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="vp2-inline-note">
                No hay integrantes autorizados para este perfil. Agrega familiares al grupo y luego activa la automatización.
              </div>
            )}
          </div>
        </>
      )}

      {error ? <p className="vp2-feedback vp2-feedback-error">{error}</p> : null}
      {status ? <p className="vp2-feedback vp2-feedback-ok">{status}</p> : null}

          <div className="vp2-panel-actions">
            <button
              type="button"
              className="vp2-empty-btn"
              onClick={onSave}
              disabled={!canEdit || loading || saving}
            >
              {saving ? "Guardando..." : "Guardar automatización"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function KlinipVoicePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfileState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileBusy, setProfileBusy] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [receivedSessions, setReceivedSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [showRecorder, setShowRecorder] = useState(searchParams.get("record") === "1");
  const [immersiveSession, setImmersiveSession] = useState(null);
  const [filter, setFilter] = useState("todas");
  const [libraryTab, setLibraryTab] = useState(searchParams.get("view") === "shared" ? "shared" : "mine");
  const [shareTargets, setShareTargets] = useState([]);
  const [automationDraft, setAutomationDraft] = useState(DEFAULT_AUTOMATION);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationError, setAutomationError] = useState("");
  const [automationStatus, setAutomationStatus] = useState("");

  const canEdit = canWriteProfile(activeProfile);
  const readOnlyProfile = isViewerProfile(activeProfile);
  const profileName = profileLabel(activeProfile);
  const requestedProfileId = Number(searchParams.get("profile_id") || 0) || null;
  const requestedShareId = Number(searchParams.get("share_id") || 0) || null;

  const replaceSearchParam = useCallback((mutate) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const loadVoiceData = useCallback(async (profile) => {
    if (!profile?.id) {
      setSessions([]);
      setReceivedSessions([]);
      setShareTargets([]);
      setAutomationDraft(DEFAULT_AUTOMATION);
      setSessionsLoading(false);
      setAutomationLoading(false);
      return;
    }

    setSessionsLoading(true);
    setAutomationLoading(true);
    setAutomationError("");
    setAutomationStatus("");

    const ownPromise = getVoiceSessions().catch(() => []);
    const sharedPromise = getVoiceReceivedSessions().catch(() => []);
    const automationPromise = canWriteProfile(profile)
      ? getProfileAutomation(profile.id).catch(() => DEFAULT_AUTOMATION)
      : Promise.resolve(DEFAULT_AUTOMATION);
    const targetsPromise = canWriteProfile(profile)
      ? getVoiceShareTargets(profile.id).catch(() => [])
      : Promise.resolve([]);

    try {
      const [ownData, sharedData, automationData, targetsData] = await Promise.all([
        ownPromise,
        sharedPromise,
        automationPromise,
        targetsPromise,
      ]);

      setSessions(ensureArray(ownData));
      setReceivedSessions(ensureArray(sharedData));
      setShareTargets(ensureArray(targetsData));
      setAutomationDraft(normalizeAutomation(automationData));
    } finally {
      setSessionsLoading(false);
      setAutomationLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [profilesData, activeData] = await Promise.all([
          getHealthProfiles().catch(() => []),
          getActiveHealthProfile().catch(() => null),
        ]);
        if (cancelled) return;

        const safeProfiles = ensureArray(profilesData);
        let resolvedProfile = activeData || safeProfiles[0] || null;

        if (requestedProfileId) {
          const matched = safeProfiles.find((item) => Number(item.id) === requestedProfileId);
          if (matched && Number(resolvedProfile?.id) !== requestedProfileId) {
            try {
              const updated = await setActiveHealthProfile(requestedProfileId);
              if (!cancelled) resolvedProfile = updated || matched;
            } catch {
              resolvedProfile = matched;
            }
          }
        }

        if (!cancelled) {
          setProfiles(safeProfiles);
          setActiveProfileState(resolvedProfile);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedProfileId]);

  useEffect(() => {
    if (!loading && activeProfile?.id) {
      loadVoiceData(activeProfile);
    }
  }, [activeProfile, loading, loadVoiceData]);

  useEffect(() => {
    if (searchParams.get("record") === "1") {
      replaceSearchParam((next) => {
        next.delete("record");
      });
    }
  }, [replaceSearchParam, searchParams]);

  useEffect(() => {
    replaceSearchParam((next) => {
      if (libraryTab === "shared") next.set("view", "shared");
      else next.delete("view");
    });
  }, [libraryTab, replaceSearchParam]);

  useEffect(() => {
    if (!activeProfile?.id) return;
    replaceSearchParam((next) => {
      next.set("profile_id", String(activeProfile.id));
    });
  }, [activeProfile?.id, replaceSearchParam]);

  useEffect(() => {
    if (!requestedShareId || !receivedSessions.length) return;
    const matched = receivedSessions.find((item) => Number(item.received_share_id) === requestedShareId);
    if (!matched) return;
    setLibraryTab("shared");
    setImmersiveSession(matched);
    replaceSearchParam((next) => {
      next.delete("share_id");
      next.set("view", "shared");
    });
  }, [receivedSessions, replaceSearchParam, requestedShareId]);

  const filteredSessions = useMemo(() => {
    if (filter === "todas") return sessions;
    return sessions.filter((item) => getSessionStatus(item) === filter);
  }, [filter, sessions]);

  async function handleProfileChange(event) {
    const nextId = Number(event.target.value);
    if (!nextId || nextId === Number(activeProfile?.id)) return;

    setProfileBusy(true);
    setAutomationError("");
    setAutomationStatus("");
    setImmersiveSession(null);
    setShowRecorder(false);

    try {
      const updated = await setActiveHealthProfile(nextId);
      const fallback = profiles.find((item) => Number(item.id) === nextId) || null;
      setActiveProfileState(updated || fallback);
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleSaveAutomation() {
    if (!activeProfile?.id || !canEdit || automationSaving) return;
    if (
      automationDraft.voice_auto_share_enabled &&
      automationDraft.voice_auto_share_recipient_ids.length === 0
    ) {
      setAutomationError("Selecciona al menos un integrante para activar el compartido automático.");
      setAutomationStatus("");
      return;
    }

    setAutomationSaving(true);
    setAutomationError("");
    setAutomationStatus("");

    try {
      const saved = await updateProfileAutomation(activeProfile.id, automationDraft);
      const normalized = normalizeAutomation(saved);
      setAutomationDraft(normalized);
      setAutomationStatus("La automatización de Klinip Voice quedó actualizada.");
      setShareTargets((prev) => prev.map((item) => ({
        ...item,
        is_auto_selected: normalized.voice_auto_share_recipient_ids.includes(item.user_id),
      })));
    } catch (err) {
      setAutomationError(err?.response?.data?.detail || "No se pudo guardar la automatización.");
    } finally {
      setAutomationSaving(false);
    }
  }

  function handleRecordingDone() {
    setShowRecorder(false);
    setImmersiveSession(null);
    if (activeProfile?.id) loadVoiceData(activeProfile);
  }

  function handleToggleRecipient(userId) {
    setAutomationDraft((prev) => ({
      ...prev,
      voice_auto_share_recipient_ids: prev.voice_auto_share_recipient_ids.includes(userId)
        ? prev.voice_auto_share_recipient_ids.filter((item) => item !== userId)
        : [...prev.voice_auto_share_recipient_ids, userId],
    }));
  }

  if (loading) {
    return <div className="vp2-page"><div className="vp2-loading">Cargando Klinip Voice...</div></div>;
  }

  return (
    <div className="vp2-page">
      {showRecorder && (
        <ImmersiveVoice
          profileId={activeProfile?.id}
          shareTargets={shareTargets}
          onDone={handleRecordingDone}
          onClose={() => setShowRecorder(false)}
        />
      )}

      {immersiveSession && !showRecorder && (
        <ImmersiveVoice
          profileId={activeProfile?.id}
          initialSession={immersiveSession}
          shareTargets={shareTargets}
          onDone={handleRecordingDone}
          onClose={() => setImmersiveSession(null)}
        />
      )}

      <div className="vp2-header">
        <div className="vp2-header-copy">
          <span className="vp2-eyebrow">
            <span className="vp2-eyebrow-dot" />
            AI-powered · Clinical Voice
          </span>
          <h1 className="vp2-title">Klinip Voice</h1>
          <p className="vp2-subtitle">Consultas grabadas · {profileName}</p>
        </div>

        <div className="vp2-header-actions">
          <label className="vp2-profile-picker">
            <span>Perfil activo</span>
            <select
              className="vp2-profile-select"
              value={activeProfile?.id || ""}
              onChange={handleProfileChange}
              disabled={profileBusy}
            >
              {(profiles || []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profileLabel(profile)}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="vp2-new-btn"
            disabled={!canEdit || profileBusy}
            onClick={() => setShowRecorder(true)}
          >
            <MicIcon className="vp2-new-btn-icon" />
            Nueva grabación
          </button>
        </div>
      </div>

      <div className="vp2-view-tabs" role="tablist" aria-label="Vistas de Klinip Voice">
        {OWN_VIEW_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`vp2-view-tab ${libraryTab === option.key ? "is-active" : ""}`}
            onClick={() => setLibraryTab(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="vp2-grid">
        <div className="vp2-left">
          <div className="vp2-hero">
            <span className="vp2-hero-circle vp2-hero-circle-tr" />
            <span className="vp2-hero-circle vp2-hero-circle-bl" />
            <div className="vp2-hero-inner">
              <div className="vp2-hero-orb">
                <MicIcon className="vp2-hero-orb-icon" />
              </div>
              <h2 className="vp2-hero-title">
                {libraryTab === "shared" ? "Tu bandeja familiar de Voice" : "Graba tu próxima consulta"}
              </h2>
              <p className="vp2-hero-desc">
                {libraryTab === "shared"
                  ? "Aquí verás los audios y resúmenes simples que tu grupo familiar comparta contigo para este perfil."
                  : "Convierte la voz del profesional en un resumen claro, indicaciones útiles y opciones seguras de compartido."}
              </p>
              <button
                type="button"
                className="vp2-hero-btn"
                disabled={!canEdit || profileBusy}
                onClick={() => setShowRecorder(true)}
              >
                <MicIcon className="vp2-hero-btn-mic" />
                Iniciar grabación
              </button>
              <div className="vp2-hero-tags">
                {FEATURE_TAGS.map((tag) => (
                  <span key={tag} className="vp2-hero-tag">{tag}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="vp2-how">
            <span className="vp2-how-label">CÓMO FUNCIONA</span>
            <div className="vp2-how-steps">
              {STEPS.map((step) => (
                <div key={step.n} className="vp2-how-step">
                  <span className="vp2-how-num">{step.n}</span>
                  <span className="vp2-how-text">{step.text}</span>
                </div>
              ))}
            </div>
          </div>

          {libraryTab === "mine" && (
            <AutomationPanel
              activeProfile={activeProfile}
              canEdit={canEdit}
              loading={automationLoading}
              saving={automationSaving}
              draft={automationDraft}
              shareTargets={shareTargets}
              error={automationError}
              status={automationStatus}
              onToggleEnabled={(checked) => setAutomationDraft((prev) => ({ ...prev, voice_auto_share_enabled: checked }))}
              onToggleAudio={(checked) => setAutomationDraft((prev) => ({ ...prev, voice_auto_share_include_audio: checked }))}
              onToggleRecipient={handleToggleRecipient}
              onSave={handleSaveAutomation}
            />
          )}
        </div>

        <div className="vp2-right">
          <div className="vp2-hist-header">
            <h2 className="vp2-hist-title">
              {libraryTab === "shared" ? "Compartido conmigo" : "Historial de sesiones"}
            </h2>
            {libraryTab === "mine" ? (
              <div className="vp2-filters">
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`vp2-filter ${filter === option.key ? "vp2-filter-active" : ""}`}
                    onClick={() => setFilter(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="vp2-inline-note">
                Los compartidos quedan guardados por separado y no se mezclan con tus grabaciones propias.
              </div>
            )}
          </div>

          {sessionsLoading && (
            <div className="vp2-loading">
              {libraryTab === "shared" ? "Cargando compartidos..." : "Cargando sesiones..."}
            </div>
          )}

          {!sessionsLoading && libraryTab === "mine" && filteredSessions.length > 0 && (
            <div className="vp2-sessions">
              {filteredSessions.map((session) => (
                <SessionCard key={session.id} session={session} onOpen={setImmersiveSession} />
              ))}
            </div>
          )}

          {!sessionsLoading && libraryTab === "shared" && receivedSessions.length > 0 && (
            <div className="vp2-sessions">
              {receivedSessions.map((session) => (
                <SessionCard
                  key={`${session.id}-${session.received_share_id || "shared"}`}
                  session={session}
                  onOpen={setImmersiveSession}
                  isSharedView
                />
              ))}
            </div>
          )}

          {!sessionsLoading && libraryTab === "mine" && filteredSessions.length === 0 && (
            <div className="vp2-empty">
              <div className="vp2-empty-orb">
                <MicIcon className="vp2-empty-icon" />
              </div>
              <h3 className="vp2-empty-title">
                {filter === "todas" ? "Sin grabaciones aún" : "Sin sesiones en este filtro"}
              </h3>
              <p className="vp2-empty-desc">
                {filter === "todas"
                  ? "Graba tu primera consulta y Klinip Voice la procesará para guardar un resumen simple y las indicaciones."
                  : "Cambia el filtro o graba una nueva sesión para este perfil."}
              </p>
              <button
                type="button"
                className="vp2-empty-btn"
                disabled={!canEdit || profileBusy}
                onClick={() => setShowRecorder(true)}
              >
                Iniciar primera grabación
              </button>
            </div>
          )}

          {!sessionsLoading && libraryTab === "shared" && receivedSessions.length === 0 && (
            <div className="vp2-empty">
              <div className="vp2-empty-orb">
                <ShareSmallIcon />
              </div>
              <h3 className="vp2-empty-title">Sin mensajes compartidos</h3>
              <p className="vp2-empty-desc">
                Cuando alguien autorizado comparta una atención de Klinip Voice contigo, aparecerá aquí con su audio y resumen simple.
              </p>
              {readOnlyProfile ? null : (
                <div className="vp2-inline-note">
                  También puedes activar el compartido automático desde el panel de la izquierda para este perfil.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
