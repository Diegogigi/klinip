import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import BrandLogo from "../components/BrandLogo";
import {
  getAppointments,
  getBiometricDashboard,
  getMedications,
  getDocuments,
  getActiveHealthProfile,
  getAiLifeTimeline,
  recordMedicationIntake,
} from "../services/httpApi";
import { ensureArray } from "../utils/arrays";
import {
  getNextMedicationDose,
  isMedicationFinished,
} from "../utils/medicationSchedule";
import {
  formatBiometricMeasuredAt,
  formatBiometricValue,
  getBiometricLatestMetric,
} from "../utils/biometrics";
import {
  notifyClinicalDataChanged,
  subscribeClinicalDataChanged,
} from "../utils/clinicalRefresh";

/* ── helpers ───────────────────────────────────────────────── */
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function relativeDay(date) {
  if (!date) return "—";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((target - today) / 86400000);
  if (diff < 0) return "Vencida";
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  if (diff < 7) return `En ${diff} días`;
  return date.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" });
}

function fmtDateTime(str) {
  const d = parseDate(str);
  if (!d) return "Sin fecha";
  return d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function fmtTime12(str) {
  if (!str) return "";
  const [h, m] = str.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

function fmtMedicationMoment(value) {
  const date = parseDate(value);
  if (!date) return "Sin horario definido";
  return date.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function describeMedicationStatus(medication, nextDose, now = new Date()) {
  if (nextDose) {
    const deltaMs = nextDose.getTime() - now.getTime();
    if (deltaMs <= 15 * 60 * 1000) {
      return deltaMs < -15 * 60 * 1000
        ? `Pendiente desde ${fmtMedicationMoment(nextDose)}`
        : "Te corresponde ahora";
    }
    return `Proxima: ${fmtMedicationMoment(nextDose)}`;
  }
  if (medication.schedule_time) {
    return `Horario habitual: ${fmtTime12(medication.schedule_time)}`;
  }
  return "Sin horario definido";
}

function timeAgo(str) {
  const d = parseDate(str);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  return d.toLocaleDateString("es", { day: "numeric", month: "short" });
}

/* ── icons ─────────────────────────────────────────────────── */
const sp = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

function IcoHeart() { return <svg {...sp}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>; }
function IcoCal() { return <svg {...sp}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>; }
function IcoPill() { return <svg {...sp}><path d="m10.5 20.5-7-7a5 5 0 1 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="m8.5 8.5 7 7"/></svg>; }
function IcoDoc() { return <svg {...sp}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>; }
function IcoActivity() { return <svg {...sp}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>; }
function IcoTimeline() { return <svg {...sp}><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>; }
function IcoReport() { return <svg {...sp}><path d="M9 11l3 3 4-4"/><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M8 6V4a2 2 0 0 1 4 0v2"/></svg>; }
function IcoChart() { return <svg {...sp}><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>; }
function IcoCalGrid() { return <svg {...sp}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>; }
function IcoChevron() { return <svg {...sp} strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>; }
function IcoCheck() { return <svg {...sp} strokeWidth="2.5"><path d="M20 6 9 17l-5-5"/></svg>; }
function IcoAlert() { return <svg {...sp}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>; }
function IcoShield() { return <svg {...sp}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>; }
function IcoBiometric() { return <svg {...sp}><path d="M22 12h-4l-2.2 5L10 7 7.5 12H2"/><path d="M12 18v3"/></svg>; }

const TIMELINE_ICONS = {
  appointment: <IcoCal />,
  document: <IcoDoc />,
  medication: <IcoPill />,
  treatment: <IcoPill />,
  diagnostic_result: <IcoActivity />,
  health_alert: <IcoAlert />,
};

/* ── component ─────────────────────────────────────────────── */
export default function MiSalud() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [medications, setMedications] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [biometricDashboard, setBiometricDashboard] = useState(null);
  const [intakeBusy, setIntakeBusy] = useState(null);

  const loadPanelData = useCallback(async () => {
    const [profRes, apptRes, medRes, docRes, tlRes, bioRes] = await Promise.allSettled([
      getActiveHealthProfile(),
      getAppointments(),
      getMedications(),
      getDocuments(),
      getAiLifeTimeline(),
      getBiometricDashboard(),
    ]);
    if (profRes.status === "fulfilled") setProfile(profRes.value || null);
    if (apptRes.status === "fulfilled") setAppointments(ensureArray(apptRes.value));
    if (medRes.status === "fulfilled") setMedications(ensureArray(medRes.value));
    if (docRes.status === "fulfilled") setDocuments(ensureArray(docRes.value));
    if (tlRes.status === "fulfilled") setTimeline(ensureArray(tlRes.value?.events));
    if (bioRes.status === "fulfilled") setBiometricDashboard(bioRes.value || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadPanelData().catch(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });
    const unsubscribe = subscribeClinicalDataChanged(() => {
      loadPanelData().catch(() => {});
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadPanelData]);

  const markIntake = useCallback(async (medication, scheduledAt = null) => {
    if (intakeBusy) return;
    setIntakeBusy(medication.id);
    try {
      const payload = { status: "taken", source: "manual_health_card" };
      if (scheduledAt) {
        payload.scheduled_at =
          scheduledAt instanceof Date ? scheduledAt.toISOString() : scheduledAt;
      }
      await recordMedicationIntake(medication.id, payload);
      notifyClinicalDataChanged({
        profileId: profile?.id,
        sources: ["medications", "health-radar", "adherence"],
      });
      await loadPanelData();
    } catch { /* silently fail */ }
    setIntakeBusy(null);
  }, [intakeBusy, loadPanelData, profile?.id]);

  /* ── derived data ── */
  const now = new Date();

  const upcomingAppts = appointments
    .filter((a) => a.status !== "realizada" && a.date_time && parseDate(a.date_time) > now)
    .sort((a, b) => parseDate(a.date_time) - parseDate(b.date_time));
  const nextAppt = upcomingAppts[0] || null;
  const pendingCount = appointments.filter((a) => a.status !== "realizada").length;
  const doneCount = appointments.filter((a) => a.status === "realizada").length;

  const activeMeds = medications.filter((m) => !isMedicationFinished(m, now));
  const biometricMetrics = ensureArray(biometricDashboard?.metrics);
  const latestBiometricMetric = getBiometricLatestMetric(biometricMetrics);
  const biometricRecentCount = ensureArray(biometricDashboard?.recent_readings).length;

  const recentEvents = timeline
    .filter((e) => e && e.event_type)
    .slice(0, 5);

  /* status */
  const totalItems = appointments.length + medications.length + documents.length;
  const hasData = totalItems > 0;
  const pendingApptNoDate = appointments.filter((a) => a.status !== "realizada" && !a.date_time).length;

  const warnings = [];
  if (!loading) {
    if (pendingApptNoDate > 0)
      warnings.push(`${pendingApptNoDate} cita${pendingApptNoDate > 1 ? "s" : ""} sin agendar`);
    if (activeMeds.length === 0 && medications.length > 0)
      warnings.push("Todos los tratamientos finalizados");
  }
  /* ── render ── */
  if (loading) {
    return (
      <div className="clp-page">
        <div className="clp-loading">
          <div className="clp-loading-pulse" />
          <span>Cargando panel clínico…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="clp-page">

      {/* ═══ PATIENT HEADER ═══ */}
      <header className="clp-scene-header">
        <div className="clp-scene-topbar">
          <BrandLogo
            className="clp-scene-brand"
            markClassName="clp-scene-brand-mark"
            imgClassName="clp-scene-brand-img"
            nameClassName="clp-scene-brand-name"
          />
          <Link to="/documents" className="clp-scene-action" aria-label="Abrir documentos">
            <IcoDoc />
          </Link>
        </div>
        <div className="clp-patient-icon"><IcoShield /></div>
        <div className="clp-patient-copy">
          <p className="clp-patient-greet">{profile?.full_name || "Perfil activo"}</p>
          <p className="clp-patient-name">Mi Salud</p>
          <p className="clp-patient-meta">
            {hasData
              ? `${appointments.length} citas · ${activeMeds.length} medicamentos · ${documents.length} documentos`
              : "Todavía no tienes información guardada"}
          </p>
        </div>
        {warnings.length > 0 && (
          <span className="clp-patient-warn" title={warnings.join(". ")}>
            <IcoAlert />
          </span>
        )}
      </header>
      <section className="clp-summary-strip" aria-label="Resumen rápido">
        <article className="clp-summary-item">
          <span className="clp-summary-icon"><IcoCal /></span>
          <div>
            <strong>{nextAppt ? 1 : 0}</strong>
            <span>{nextAppt ? relativeDay(parseDate(nextAppt.date_time)) : "Sin cita"}</span>
          </div>
        </article>
        <article className="clp-summary-item">
          <span className="clp-summary-icon"><IcoPill /></span>
          <div>
            <strong>{activeMeds.length}</strong>
            <span>medicamentos activos</span>
          </div>
        </article>
        <article className="clp-summary-item">
          <span className="clp-summary-icon"><IcoDoc /></span>
          <div>
            <strong>{documents.length}</strong>
            <span>{documents.length === 1 ? "documento pendiente" : "documentos pendientes"}</span>
          </div>
        </article>
      </section>

      {/* ═══ STATUS STRIP ═══ */}
      {warnings.length > 0 && (
        <div className="clp-warn-strip" role="alert">
          <IcoAlert />
          <span>{warnings.join(" · ")}</span>
        </div>
      )}

      {/* ═══ NEXT APPOINTMENT ═══ */}
      <section className="clp-card tone-blue" aria-labelledby="clp-appt-h">
        <div className="clp-card-head">
          <span className="clp-card-icon tone-blue"><IcoCal /></span>
          <div className="clp-card-titles">
            <h2 className="clp-card-title" id="clp-appt-h">Tu próxima cita</h2>
            <p className="clp-card-sub">Lo siguiente en tu agenda médica</p>
          </div>
          <Link to="/appointments" className="clp-card-link">Ver todas <IcoChevron /></Link>
        </div>
        {nextAppt ? (
          <div className="clp-appt-body">
            <div className="clp-appt-main">
              <span className="clp-appt-tag">{relativeDay(parseDate(nextAppt.date_time))}</span>
              <p className="clp-appt-title">{nextAppt.specialty || nextAppt.title || "Consulta médica"}</p>
              <p className="clp-appt-when">{fmtDateTime(nextAppt.date_time)}</p>
              {nextAppt.notes && <p className="clp-appt-note">{nextAppt.notes}</p>}
            </div>
            <div className="clp-appt-stats">
              <div className="clp-appt-stat">
                <strong>{pendingCount}</strong>
                <span>pendiente{pendingCount !== 1 ? "s" : ""}</span>
              </div>
              <div className="clp-appt-stat">
                <strong>{doneCount}</strong>
                <span>realizada{doneCount !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="clp-empty">
            {pendingCount > 0
              ? `${pendingCount} cita${pendingCount > 1 ? "s" : ""} pendiente${pendingCount > 1 ? "s" : ""} de agendar`
              : "Sin citas registradas"}
          </div>
        )}
      </section>

      {/* ═══ MEDICATION TRACKER ═══ */}
      <section className="clp-card tone-green" aria-labelledby="clp-med-h">
        <div className="clp-card-head">
          <span className="clp-card-icon tone-green"><IcoPill /></span>
          <div className="clp-card-titles">
            <h2 className="clp-card-title" id="clp-med-h">Tus medicamentos</h2>
            <p className="clp-card-sub">Registra solo la dosis que ya tomaste. Si no la tomaste, dejala pendiente.</p>
          </div>
          <Link to="/medications" className="clp-card-link">Ver todos <IcoChevron /></Link>
        </div>
        {activeMeds.length > 0 ? (
          <div className="clp-med-list" role="list">
            {activeMeds.slice(0, 5).map((med) => {
              const busy = intakeBusy === med.id;
              const nextDose = getNextMedicationDose(med);
              return (
                <div key={med.id} className="clp-med-row" role="listitem">
                  <div className="clp-med-info">
                    <p className="clp-med-name">{med.name}</p>
                    <p className="clp-med-detail">
                      {med.dose || ""}
                      {med.frequency ? ` · ${med.frequency}` : ""}
                    </p>
                    <p className="clp-med-next">
                      {describeMedicationStatus(med, nextDose, now)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="clp-med-check"
                    disabled={busy}
                    onClick={() => markIntake(med, nextDose || med.start_at || null)}
                    aria-label={`Marcar ${med.name} como tomado`}
                    title="Usa este boton solo cuando ya hayas tomado esta dosis"
                  >
                    {busy ? <span className="clp-med-spin" /> : <IcoCheck />}
                    <span className="clp-med-check-label">{busy ? "Guardando..." : "Ya la tome"}</span>
                  </button>
                </div>
              );
            })}
            {activeMeds.length > 5 && (
              <Link to="/medications" className="clp-more-link">
                +{activeMeds.length - 5} más
              </Link>
            )}
          </div>
        ) : (
          <div className="clp-empty">
            {medications.length > 0 ? "Todos los tratamientos finalizados" : "Sin medicamentos registrados"}
          </div>
        )}
      </section>

      {/* ═══ RECENT DOCUMENTS ═══ */}
      <section className="clp-card tone-slate" aria-labelledby="clp-doc-h">
        <div className="clp-card-head">
          <span className="clp-card-icon tone-slate"><IcoDoc /></span>
          <div className="clp-card-titles">
            <h2 className="clp-card-title" id="clp-doc-h">Tus documentos</h2>
            <p className="clp-card-sub">Recetas, exámenes y archivos médicos</p>
          </div>
          <Link to="/documents" className="clp-card-link">Ver todos <IcoChevron /></Link>
        </div>
        {documents.length > 0 ? (
          <div className="clp-doc-list" role="list">
            {documents.slice(0, 3).map((doc) => (
              <Link key={doc.id} to="/documents" className="clp-doc-row" role="listitem">
                <IcoDoc />
                <div className="clp-doc-info">
                  <p className="clp-doc-name">{doc.title || doc.original_filename || "Documento"}</p>
                  <p className="clp-doc-meta">{doc.category || "Archivo"}{doc.created_at ? ` · ${timeAgo(doc.created_at)}` : ""}</p>
                </div>
              </Link>
            ))}
            {documents.length > 3 && (
              <Link to="/documents" className="clp-more-link">
                +{documents.length - 3} más
              </Link>
            )}
          </div>
        ) : (
          <div className="clp-empty">Sin documentos en tu archivo</div>
        )}
      </section>

      <section className="clp-card tone-indigo" aria-labelledby="clp-bio-h">
        <div className="clp-card-head">
          <span className="clp-card-icon tone-indigo"><IcoBiometric /></span>
          <div className="clp-card-titles">
            <h2 className="clp-card-title" id="clp-bio-h">Parámetros biométricos</h2>
            <p className="clp-card-sub">Glucosa, presión, frecuencia cardiaca y temperatura.</p>
          </div>
          <Link to="/mi-salud/biometricos" className="clp-card-link">Abrir panel <IcoChevron /></Link>
        </div>
        {latestBiometricMetric?.latest_reading ? (
          <div className="clp-biometric-body">
            <div className="clp-biometric-main">
              <span className="clp-appt-tag">
                {latestBiometricMetric.readings_count} registro{latestBiometricMetric.readings_count !== 1 ? "s" : ""}
              </span>
              <p className="clp-appt-title">{latestBiometricMetric.label}</p>
              <p className="clp-appt-when">
                {formatBiometricValue(latestBiometricMetric.latest_reading)} · {formatBiometricMeasuredAt(
                  latestBiometricMetric.latest_reading.measured_at || latestBiometricMetric.latest_reading.created_at
                )}
              </p>
              <p className="clp-appt-note">{latestBiometricMetric.trend_summary}</p>
            </div>
            <div className="clp-appt-stats">
              <div className="clp-appt-stat">
                <strong>{biometricDashboard?.active_metrics_count || 0}</strong>
                <span>parámetros activos</span>
              </div>
              <div className="clp-appt-stat">
                <strong>{biometricRecentCount}</strong>
                <span>registros recientes</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="clp-empty">
            Empieza a registrar biométricos para ver tus tendencias y compartirlas en consulta.
          </div>
        )}
      </section>

      {/* ═══ ACTIVITY FEED ═══ */}
      {recentEvents.length > 0 && (
        <section className="clp-card tone-indigo" aria-labelledby="clp-activity-h">
          <div className="clp-card-head">
            <span className="clp-card-icon tone-indigo"><IcoActivity /></span>
            <div className="clp-card-titles">
              <h2 className="clp-card-title" id="clp-activity-h">Lo último que pasó</h2>
              <p className="clp-card-sub">Tu actividad de salud reciente</p>
            </div>
            <Link to="/timeline" className="clp-card-link">Historia <IcoChevron /></Link>
          </div>
          <div className="clp-activity-list" role="list">
            {recentEvents.map((ev, i) => (
              <div key={ev.id || i} className="clp-activity-row" role="listitem">
                <span className="clp-activity-icon">
                  {TIMELINE_ICONS[ev.event_type] || <IcoDoc />}
                </span>
                <div className="clp-activity-copy">
                  <p className="clp-activity-text">{ev.title || ev.description || ev.event_type}</p>
                  <p className="clp-activity-time">{timeAgo(ev.date || ev.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══ QUICK ACCESS (secondary, compact) ═══ */}
      <div className="clp-quick-wrap">
        <p className="clp-quick-heading">Otras herramientas</p>
        <nav className="clp-quick-nav" aria-label="Herramientas clínicas">
          <Link to="/clinical-reports" className="clp-quick-item tone-blue">
            <span className="clp-quick-icon"><IcoReport /></span>
            <span>Reportes IA</span>
          </Link>
          <Link to="/calendar" className="clp-quick-item tone-green">
            <span className="clp-quick-icon"><IcoCalGrid /></span>
            <span>Calendario</span>
          </Link>
          <Link to="/stats" className="clp-quick-item tone-indigo">
            <span className="clp-quick-icon"><IcoChart /></span>
            <span>Indicadores</span>
          </Link>
          <Link to="/mi-salud/biometricos" className="clp-quick-item tone-blue">
            <span className="clp-quick-icon"><IcoBiometric /></span>
            <span>Biométricos</span>
          </Link>
          <Link to="/timeline" className="clp-quick-item tone-slate">
            <span className="clp-quick-icon"><IcoTimeline /></span>
            <span>Historia</span>
          </Link>
        </nav>
      </div>

    </div>
  );
}
