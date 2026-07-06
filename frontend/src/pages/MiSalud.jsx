import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  getAppointments,
  getBiometricDashboard,
  getMedications,
  getDocuments,
  getActiveHealthProfile,
  getAiLifeTimeline,
  getContinuityPanel,
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
import SuccessSheet from "../components/SuccessSheet";
import HealthSheetCard from "../components/health/HealthSheetCard";
import { buildMedicationIntakeSuccess } from "../utils/medicationIntakeSuccess";

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

// Panel de Continuidad: a qué ruta lleva cada pendiente según su origen.
function continuityRoute(item) {
  const source = String(item?.source_type || "").toLowerCase();
  if (source.includes("appointment") || source.includes("cita") || source.includes("exam")) {
    return "/appointments";
  }
  if (source.includes("document") || source.includes("informe") || source.includes("resultado")) {
    return "/documents";
  }
  if (source.includes("prescription") || source.includes("medication") || source.includes("receta")) {
    return "/medications";
  }
  return "/timeline";
}

function continuityDueLabel(item) {
  const due = parseDate(item?.due_at);
  if (!due) return "";
  if (item?.priority === "overdue") {
    return `Venció el ${due.toLocaleDateString("es-CL", { day: "numeric", month: "short" })}`;
  }
  return `Vence: ${relativeDay(due)}`;
}

// El motor de episodios puede generar tareas gemelas (mismo texto y misma
// fecha); mostrarlas repetidas solo confunde.
function dedupeContinuityItems(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = `${item?.title || ""}|${item?.due_at || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const MEDICATION_CTA_LEAD_MS = 45 * 60 * 1000;
const MEDICATION_CTA_GRACE_MS = 90 * 60 * 1000;
const MEDICATION_CTA_DONE_MS = 75 * 60 * 1000;

function getMedicationActionState(medication, nextDose, recentConfirmation, now = new Date()) {
  const confirmedTakenAt = parseDate(recentConfirmation?.takenAt || null);
  const confirmedScheduledAt = parseDate(recentConfirmation?.scheduledAt || null);

  if (
    confirmedTakenAt &&
    now.getTime() - confirmedTakenAt.getTime() <= MEDICATION_CTA_DONE_MS
  ) {
    return {
      kind: "done",
      label: "Ya la tomé",
      scheduledAt: confirmedScheduledAt || confirmedTakenAt,
    };
  }

  if (!nextDose) return null;

  const deltaMs = nextDose.getTime() - now.getTime();
  if (deltaMs > MEDICATION_CTA_LEAD_MS) return null;
  if (deltaMs < -MEDICATION_CTA_GRACE_MS) return null;

  return {
    kind: "pending",
    label: "Pendiente",
    scheduledAt: nextDose,
  };
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
function IcoCoverage() { return <svg {...sp}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z"/><path d="M4 9h16M7.5 14h4M16 13.2h.01"/></svg>; }
function IcoActivity() { return <svg {...sp}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>; }
function IcoTimeline() { return <svg {...sp}><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>; }
function IcoReport() { return <svg {...sp}><path d="M9 11l3 3 4-4"/><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M8 6V4a2 2 0 0 1 4 0v2"/></svg>; }
function IcoChart() { return <svg {...sp}><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>; }
function IcoCalGrid() { return <svg {...sp}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>; }
function IcoChevron() { return <svg {...sp} strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>; }
function IcoCheck() { return <svg {...sp} strokeWidth="2.5"><path d="M20 6 9 17l-5-5"/></svg>; }
function IcoAlert() { return <svg {...sp}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>; }
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
  const [recentMedicationConfirmations, setRecentMedicationConfirmations] = useState({});
  const [intakeSuccess, setIntakeSuccess] = useState(null);
  const [continuity, setContinuity] = useState(null);
  const [continuityState, setContinuityState] = useState("loading");

  const loadContinuity = useCallback(async (profileId) => {
    if (!profileId) {
      setContinuity(null);
      setContinuityState("ready");
      return;
    }
    try {
      const data = await getContinuityPanel(profileId);
      setContinuity(data || null);
      setContinuityState("ready");
    } catch {
      setContinuityState("error");
    }
  }, []);

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

  useEffect(() => {
    if (loading) return undefined;
    setContinuityState("loading");
    loadContinuity(profile?.id);
    const unsubscribe = subscribeClinicalDataChanged(() => {
      loadContinuity(profile?.id);
    });
    return () => unsubscribe();
  }, [loading, profile?.id, loadContinuity]);

  const markIntake = useCallback(async (medication, scheduledAt = null) => {
    if (intakeBusy) return;
    setIntakeBusy(medication.id);
    try {
      const payload = { status: "taken", source: "manual_health_card" };
      const resolvedScheduledAt =
        scheduledAt instanceof Date ? scheduledAt.toISOString() : (scheduledAt || new Date().toISOString());
      if (scheduledAt) {
        payload.scheduled_at = resolvedScheduledAt;
      }
      const savedIntake = await recordMedicationIntake(medication.id, payload);
      setRecentMedicationConfirmations((prev) => ({
        ...prev,
        [medication.id]: {
          scheduledAt: savedIntake?.scheduled_at || resolvedScheduledAt,
          takenAt: savedIntake?.taken_at || new Date().toISOString(),
        },
      }));
      notifyClinicalDataChanged({
        profileId: profile?.id,
        sources: ["medications", "health-radar", "adherence"],
      });
      try {
        await loadPanelData();
      } finally {
        setIntakeSuccess(
          buildMedicationIntakeSuccess({
            intake: savedIntake,
            medication,
            profileLabel: profile?.display_name || profile?.full_name || "Mi perfil",
          })
        );
      }
    } catch {
      window.alert("No se pudo registrar la toma. Intenta nuevamente.");
    }
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

  /* ── continuidad ── */
  const continuityNextStep = continuity?.next_step || null;
  const continuityOverdue = dedupeContinuityItems(
    ensureArray(continuity?.overdue).filter(
      (item) => item?.id && item.id !== continuityNextStep?.id
    )
  );
  const continuityActionsAll = dedupeContinuityItems(
    ensureArray(continuity?.requires_action).filter(
      (item) => item?.id && item.id !== continuityNextStep?.id && item.priority !== "overdue"
    )
  );
  const continuityPendingTotal = continuityOverdue.length + continuityActionsAll.length;
  const continuityPrep = continuity?.upcoming_preparation || null;
  const continuityIsClear =
    !continuityNextStep && continuityPendingTotal === 0 && !continuityPrep;
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
    <>
      <SuccessSheet
        open={Boolean(intakeSuccess)}
        onClose={() => setIntakeSuccess(null)}
        {...(intakeSuccess || {})}
      />
      <div className="clp-page">

      {/* ═══ PATIENT HEADER ═══ */}
      <section className="clp-page-intro" aria-label="Resumen principal">
        <div className="clp-page-intro-copy">
          <p className="clp-page-intro-kicker">{profile?.full_name || "Perfil activo"}</p>
          <h1 className="clp-page-intro-title">Mi Salud</h1>
          <p className="clp-page-intro-subtitle">
            {hasData
              ? "Tu agenda, tratamientos y documentos en un solo lugar"
              : "Todavía no tienes información guardada"}
          </p>
        </div>
      </section>

      {/* ═══ STATUS STRIP ═══ */}
      {warnings.length > 0 && (
        <div className="clp-warn-strip" role="alert">
          <IcoAlert />
          <span>{warnings.join(" · ")}</span>
        </div>
      )}

      {/* ═══ CONTINUIDAD ═══ */}
      {profile?.id ? (
        <section className="clp-card tone-amber clp-continuity" aria-labelledby="clp-cont-h">
          <div className="clp-card-head">
            <span className="clp-card-icon tone-amber"><IcoActivity /></span>
            <div className="clp-card-head-main">
              <div className="clp-card-titles">
                <h2 className="clp-card-title" id="clp-cont-h">Lo que falta hacer</h2>
                <p className="clp-card-sub">Te recordamos, paso a paso, lo que quedó pendiente de tu atención</p>
              </div>
              <div className="clp-card-head-meta">
                {continuityPendingTotal > 0 ? (
                  <span className="clp-card-metric">
                    {continuityPendingTotal} pendiente{continuityPendingTotal !== 1 ? "s" : ""}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {continuityState === "loading" ? (
            <div className="clp-empty">Revisando tus pendientes…</div>
          ) : continuityState === "error" ? (
            <div className="clp-empty clp-continuity-error">
              <span>No pudimos revisar tu continuidad ahora.</span>
              <button type="button" onClick={() => { setContinuityState("loading"); loadContinuity(profile?.id); }}>
                Reintentar
              </button>
            </div>
          ) : continuityIsClear ? (
            <div className="clp-continuity-clear">
              <IcoCheck />
              <span>¡Todo al día! Por ahora no tienes nada pendiente.</span>
            </div>
          ) : (
            <div className="clp-continuity-body">
              {continuityNextStep ? (
                <div className={`clp-next-step is-${continuityNextStep.priority || "normal"}`}>
                  <div className="clp-next-step-copy">
                    <span className="clp-next-step-kicker">
                      {continuityNextStep.priority === "overdue" ? "Próximo paso · Atrasado" : "Próximo paso"}
                    </span>
                    <strong>{continuityNextStep.title}</strong>
                    {continuityNextStep.description ? <p>{continuityNextStep.description}</p> : null}
                    {continuityDueLabel(continuityNextStep) ? (
                      <small>{continuityDueLabel(continuityNextStep)}</small>
                    ) : null}
                  </div>
                  <Link className="clp-next-step-cta" to={continuityRoute(continuityNextStep)}>
                    {continuityNextStep.action_label || "Revisar"}
                  </Link>
                </div>
              ) : null}

              {continuityPendingTotal > 0 ? (
                <details className="clp-continuity-pending">
                  <summary>
                    <span>Ver todos los pendientes ({continuityPendingTotal})</span>
                    {continuityOverdue.length > 0 ? (
                      <span className="clp-continuity-overdue-chip">
                        {continuityOverdue.length} atrasado{continuityOverdue.length !== 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </summary>
                  <div className="clp-continuity-pending-body">
                    {continuityOverdue.map((item) => (
                      <div className="clp-continuity-row is-overdue" key={item.id}>
                        <div className="clp-continuity-row-copy">
                          <strong>{item.title}</strong>
                          {continuityDueLabel(item) ? <small>{continuityDueLabel(item)}</small> : null}
                        </div>
                        <Link to={continuityRoute(item)} className="clp-continuity-row-cta">
                          {item.action_label || "Resolver"}
                        </Link>
                      </div>
                    ))}
                    {continuityActionsAll.map((item) => (
                      <div className="clp-continuity-row" key={item.id}>
                        <div className="clp-continuity-row-copy">
                          <strong>{item.title}</strong>
                          {continuityDueLabel(item) ? <small>{continuityDueLabel(item)}</small> : null}
                        </div>
                        <Link to={continuityRoute(item)} className="clp-continuity-row-cta">
                          {item.action_label || "Revisar"}
                        </Link>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {continuityPrep ? (
                <details className="clp-continuity-prep">
                  <summary>
                    Prepara tu {continuityPrep.appointment_type === "examen" ? "examen" : "cita"}
                    {continuityPrep.date_time
                      ? ` · ${relativeDay(parseDate(continuityPrep.date_time))}`
                      : ""}
                  </summary>
                  <div className="clp-continuity-prep-body">
                    <p className="clp-continuity-prep-when">
                      {[
                        continuityPrep.specialty,
                        continuityPrep.center,
                        continuityPrep.date_time ? fmtDateTime(continuityPrep.date_time) : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {ensureArray(continuityPrep.documents_to_bring).length > 0 ? (
                      <div className="clp-continuity-prep-group">
                        <span>Documentos que te conviene llevar</span>
                        <div className="clp-continuity-prep-chips">
                          {ensureArray(continuityPrep.documents_to_bring).map((docName) => (
                            <Link to="/documents" className="clp-continuity-prep-chip" key={docName}>
                              {docName}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {Number(continuityPrep.active_medications_count || 0) > 0 ? (
                      <div className="clp-continuity-prep-group">
                        <span>Medicamentos activos</span>
                        <p>
                          Tienes {continuityPrep.active_medications_count} tratamiento
                          {Number(continuityPrep.active_medications_count) !== 1 ? "s" : ""} activo
                          {Number(continuityPrep.active_medications_count) !== 1 ? "s" : ""}: menciónalos en la atención.{" "}
                          <Link to="/medications">Ver medicamentos</Link>
                        </p>
                      </div>
                    ) : null}
                    {ensureArray(continuityPrep.suggested_questions).length > 0 ? (
                      <div className="clp-continuity-prep-group">
                        <span>Preguntas que puedes hacer</span>
                        <ul>
                          {ensureArray(continuityPrep.suggested_questions).map((question) => (
                            <li key={question}>{question}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="clp-continuity-prep-actions">
                      <Link to="/appointments">Ver agenda</Link>
                      <Link to="/documents">Documentos</Link>
                      <Link to="/medications">Medicamentos</Link>
                    </div>
                  </div>
                </details>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {/* ═══ NEXT APPOINTMENT ═══ */}
      <section className="clp-card tone-blue" aria-labelledby="clp-appt-h">
        <div className="clp-card-head">
          <span className="clp-card-icon tone-blue"><IcoCal /></span>
          <div className="clp-card-head-main">
            <div className="clp-card-titles">
              <h2 className="clp-card-title" id="clp-appt-h">Tu próxima cita</h2>
              <p className="clp-card-sub">Lo siguiente en tu agenda médica</p>
            </div>
            <div className="clp-card-head-meta">
              <span className="clp-card-metric">{appointments.length} {appointments.length === 1 ? "cita" : "citas"}</span>
              <Link to="/appointments" className="clp-card-link clp-card-link-primary">Ver todas <IcoChevron /></Link>
            </div>
          </div>
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
          <div className="clp-card-head-main">
            <div className="clp-card-titles">
              <h2 className="clp-card-title" id="clp-med-h">Tus medicamentos</h2>
              <p className="clp-card-sub">Registra solo la dosis que ya tomaste. Si no la tomaste, dejala pendiente.</p>
            </div>
            <div className="clp-card-head-meta">
              <span className="clp-card-metric">{activeMeds.length} {activeMeds.length === 1 ? "activo" : "activos"}</span>
              <Link to="/medications" className="clp-card-link clp-card-link-primary">Ver todos <IcoChevron /></Link>
            </div>
          </div>
        </div>
        {activeMeds.length > 0 ? (
          <div className="clp-med-list" role="list">
            {activeMeds.slice(0, 5).map((med) => {
              const busy = intakeBusy === med.id;
              const nextDose = getNextMedicationDose(med);
              const actionState = getMedicationActionState(
                med,
                nextDose,
                recentMedicationConfirmations[med.id],
                now
              );
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
                  {actionState ? (
                    <button
                      type="button"
                      className={`clp-med-check ${actionState.kind === "done" ? "is-done" : "is-pending"}`}
                      disabled={busy || actionState.kind === "done"}
                      onClick={() => markIntake(med, actionState.scheduledAt || nextDose || med.start_at || null)}
                      aria-label={
                        actionState.kind === "done"
                          ? `${med.name} ya fue marcada como tomada`
                          : `Marcar ${med.name} como tomada`
                      }
                      title={
                        actionState.kind === "done"
                          ? "La dosis ya quedó confirmada"
                          : "Marca esta dosis cuando ya la hayas tomado"
                      }
                    >
                      {busy ? <span className="clp-med-spin" /> : actionState.kind === "done" ? <IcoCheck /> : <IcoAlert />}
                      <span className="clp-med-check-label">{busy ? "Guardando..." : actionState.label}</span>
                    </button>
                  ) : null}
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
          <div className="clp-card-head-main">
            <div className="clp-card-titles">
              <h2 className="clp-card-title" id="clp-doc-h">Tus documentos</h2>
              <p className="clp-card-sub">Recetas, exámenes y archivos médicos</p>
            </div>
            <div className="clp-card-head-meta">
              <span className="clp-card-metric">{documents.length} {documents.length === 1 ? "archivo" : "archivos"}</span>
              <Link to="/documents" className="clp-card-link clp-card-link-primary">Ver todos <IcoChevron /></Link>
            </div>
          </div>
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

      {/* ═══ FICHA DE SALUD ═══ */}
      <HealthSheetCard profileId={profile?.id} />

      <section className="clp-card tone-indigo" aria-labelledby="clp-bio-h">
        <div className="clp-card-head">
          <span className="clp-card-icon tone-indigo"><IcoBiometric /></span>
          <div className="clp-card-head-main">
            <div className="clp-card-titles">
              <h2 className="clp-card-title" id="clp-bio-h">Parámetros biométricos</h2>
              <p className="clp-card-sub">Glucosa, presión, frecuencia cardiaca y temperatura.</p>
            </div>
            <div className="clp-card-head-meta clp-card-head-meta-action-only">
              <Link to="/mi-salud/biometricos" className="clp-card-link clp-card-link-primary">Abrir panel <IcoChevron /></Link>
            </div>
          </div>
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
            <div className="clp-card-head-main">
              <div className="clp-card-titles">
                <h2 className="clp-card-title" id="clp-activity-h">Lo último que pasó</h2>
                <p className="clp-card-sub">Tu actividad de salud reciente</p>
              </div>
              <div className="clp-card-head-meta clp-card-head-meta-action-only">
                <Link to="/timeline" className="clp-card-link clp-card-link-primary">Historia <IcoChevron /></Link>
              </div>
            </div>
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
          <Link to="/coverage" className="clp-quick-item tone-green">
            <span className="clp-quick-icon"><IcoCoverage /></span>
            <span>Cobertura</span>
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
    </>
  );
}
