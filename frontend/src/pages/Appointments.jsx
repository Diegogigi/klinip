import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getAppointments,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  getActiveHealthProfile,
  isAuthSessionError,
} from "../api";
import {
  parseDate,
  toIsoOrNull,
  toLocaleDateTimeOrEmpty,
  toLocalInputValue,
} from "../utils/dates";
import RowActionsMenu from "../components/RowActionsMenu";
import { notifyClinicalDataChanged } from "../utils/clinicalRefresh";
import { canWriteProfile, isViewerProfile } from "../utils/profileAccess";
import { cleanUiText } from "../utils/textEncoding";
import useMobileOverlayLock from "../hooks/useMobileOverlayLock";

const typeLabels = {
  cita: "Cita médica",
  examen: "Examen",
  tramite: "Trámite",
};

function getNewestAppointmentRank(item) {
  const createdAt = parseDate(item?.created_at);
  if (createdAt) return createdAt.getTime();
  const updatedAt = parseDate(item?.updated_at);
  if (updatedAt) return updatedAt.getTime();
  const scheduledAt = parseDate(item?.date_time);
  if (scheduledAt) return scheduledAt.getTime();
  return Number(item?.id || 0);
}

const statusLabels = {
  pendiente: "Pendiente",
  agendada: "Agendada",
  realizada: "Realizada",
};

function formatAppointmentDateLabel(item) {
  if (!item?.date_time) return "Por agendar";
  return toLocaleDateTimeOrEmpty(item.date_time) || "Por agendar";
}

export default function Appointments() {
  const location = useLocation();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successTarget, setSuccessTarget] = useState(null);
  const [successMode, setSuccessMode] = useState("created");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedUndatedId, setSelectedUndatedId] = useState("");
  const [form, setForm] = useState({
    id: null,
    type: "cita",
    specialty: "",
    center: "",
    date_time: "",
    status: "pendiente",
    notes: "",
  });
  const [loading, setLoading] = useState(false);

  const canEditActiveProfile = canWriteProfile(activeProfile);
  const isReadOnlyProfile = isViewerProfile(activeProfile);
  const hasOverlayOpen = showForm || notifyOpen || detailOpen || successOpen;

  useMobileOverlayLock(hasOverlayOpen);

  async function load() {
    try {
      const [data, profile] = await Promise.all([
        getAppointments(),
        getActiveHealthProfile().catch(() => null),
      ]);
      setActiveProfile(profile || null);
      setAppointments(
        [...data].sort((a, b) => getNewestAppointmentRank(b) - getNewestAppointmentRank(a))
      );
    } catch (error) {
      if (!isAuthSessionError(error)) {
        console.error("No se pudieron cargar las citas", error);
      }
      setActiveProfile(null);
      setAppointments([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!canEditActiveProfile) return;
    if (!location.search) return;
    const params = new URLSearchParams(location.search);
    const id = params.get("complete");
    if (!id) return;
    const target = appointments.find((a) => String(a.id) === String(id));
    if (!target || target.status === "realizada") return;
    updateAppointment(target.id, {
      type: target.type,
      specialty: target.specialty || "",
      center: target.center || "",
      date_time: target.date_time || null,
      status: "realizada",
      notes: target.notes || "",
      checklist: target.checklist || []
    })
      .then(load)
      .finally(() => {
        navigate("/appointments", { replace: true });
      });
  }, [location.search, appointments, navigate, canEditActiveProfile]);

  useEffect(() => {
    if (!location.search) return;
    const params = new URLSearchParams(location.search);
    const notify = params.get("notify") === "1";
    const notifyId = params.get("appointmentId");
    if (!notify || !notifyId) return;
    const target = appointments.find((a) => String(a.id) === String(notifyId));
    if (!target) return;
    setNotifyTarget(target);
    setNotifyOpen(true);
  }, [location.search, appointments]);

  const resetForm = () => {
    setForm({
      id: null,
      type: "cita",
      specialty: "",
      center: "",
      date_time: "",
      status: "pendiente",
      notes: "",
    });
  };

  const handleCloseSuccess = () => {
    setSuccessOpen(false);
    setSuccessTarget(null);
    setSuccessMode("created");
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!canEditActiveProfile) {
      alert("Este perfil está en modo solo lectura. No puedes modificar citas.");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        type: form.type,
        specialty: form.specialty,
        center: form.center,
        date_time: toIsoOrNull(form.date_time),
        status: form.status,
        notes: form.notes,
      };
      let savedActivity = null;
      if (form.id) {
        savedActivity = await updateAppointment(form.id, payload);
        setSuccessMode("updated");
      } else {
        savedActivity = await createAppointment(payload);
        setSuccessMode("created");
      }
      await load();
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["appointments", "health-radar"],
      });
      resetForm();
      setShowForm(false);
      setSuccessTarget(savedActivity || payload);
      setSuccessOpen(true);
    } catch (err) {
      console.error(err);
      alert("No se pudo guardar la cita");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (appt) => {
    if (!canEditActiveProfile) return;
    setDetailOpen(false);
    setDetailTarget(null);
    setNotifyOpen(false);
    setNotifyTarget(null);
    setShowForm(true);
    setForm({
      id: appt.id,
      type: appt.type,
      specialty: appt.specialty || "",
      center: appt.center || "",
      date_time: appt.date_time ? toLocalInputValue(appt.date_time) : "",
      status: appt.status,
      notes: appt.notes || "",
    });
  };

  const handleDelete = async (appt) => {
    if (!canEditActiveProfile) {
      alert("Este perfil está en modo solo lectura. No puedes eliminar citas.");
      return;
    }
    if (!window.confirm("¿Eliminar esta cita/examen?")) return;
    try {
      await deleteAppointment(appt.id);
      await load();
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["appointments", "health-radar"],
      });
    } catch (err) {
      console.error(err);
      alert("No se pudo eliminar");
    }
  };

  const handleMarkCompleted = async (appt) => {
    if (!canEditActiveProfile) {
      alert("Este perfil está en modo solo lectura. No puedes modificar el estado de la cita.");
      return;
    }
    try {
      await updateAppointment(appt.id, {
        type: appt.type,
        specialty: appt.specialty || "",
        center: appt.center || "",
        date_time: appt.date_time || null,
        status: "realizada",
        notes: appt.notes || "",
        checklist: appt.checklist || []
      });
      await load();
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["appointments", "health-radar"],
      });
    } catch (err) {
      console.error(err);
      alert("No se pudo marcar como realizada");
    }
  };

  const handleOpenDetail = (appt) => {
    setDetailTarget(appt);
    setDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setDetailTarget(null);
  };

  const getAppointmentLabel = (appt) => {
    const typeLabel = cleanUiText(typeLabels[appt.type] || appt.type || "Actividad");
    const detail = cleanUiText(appt.specialty || appt.center || "Sin detalle");
    return `${typeLabel} · ${detail}`;
  };

  const filteredAppointments = appointments.filter((a) => {
    const matchesSearch =
      !search ||
      (a.specialty || "").toLowerCase().includes(search.toLowerCase()) ||
      (a.center || "").toLowerCase().includes(search.toLowerCase()) ||
      (a.notes || "").toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || a.type === typeFilter;
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    return matchesSearch && matchesType && matchesStatus;
  });
  const undatedAppointments = filteredAppointments.filter((a) => !a.date_time);
  const hasUndatedAppointments = undatedAppointments.length > 0;
  const upcomingAppointments = appointments.filter((a) => a.status !== "realizada");
  const completedAppointments = appointments.filter((a) => a.status === "realizada");
  const confirmedAppointments = appointments.filter((a) => a.status === "agendada");
  const nextScheduledAppointment = [...appointments]
    .filter((a) => a.date_time && a.status !== "realizada")
    .sort((a, b) => {
      const left = parseDate(a.date_time)?.getTime() || 0;
      const right = parseDate(b.date_time)?.getTime() || 0;
      return left - right;
    })[0];

  useEffect(() => {
    if (!undatedAppointments.length) {
      setSelectedUndatedId("");
      return;
    }
    setSelectedUndatedId((prev) => {
      const exists = undatedAppointments.some(
        (a) => String(a.id) === String(prev)
      );
      return exists ? prev : String(undatedAppointments[0].id);
    });
  }, [undatedAppointments]);

  return (
    <>
      <div className="card appointments-surface-free appointments-intro appointments-hero-card">
        <div className="appointments-hero-main">
          <div>
            <p className="appointments-hero-eyebrow">Agenda clínica</p>
            <h2 className="card-title">Citas, exámenes y trámites</h2>
            <p className="muted appointments-hero-copy">
              Organiza tus actividades médicas en un solo flujo, con seguimiento claro y acceso rápido
              al siguiente paso.
            </p>
          </div>
          {canEditActiveProfile ? (
            <button
              className="primary-btn appointments-hero-cta"
              type="button"
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
            >
              Nueva actividad
            </button>
          ) : null}
        </div>

        <div className="appointments-hero-stats">
          <article className="appointments-stat-card tone-blue">
            <span className="appointments-stat-label">Próximas</span>
            <strong className="appointments-stat-value">{upcomingAppointments.length}</strong>
            <span className="appointments-stat-meta">
              {confirmedAppointments.length} confirmada{confirmedAppointments.length === 1 ? "" : "s"}
            </span>
          </article>
          <article className="appointments-stat-card tone-green">
            <span className="appointments-stat-label">Realizadas</span>
            <strong className="appointments-stat-value">{completedAppointments.length}</strong>
            <span className="appointments-stat-meta">Historial actualizado</span>
          </article>
          <article className="appointments-stat-card tone-white">
            <span className="appointments-stat-label">Sin fecha</span>
            <strong className="appointments-stat-value">{undatedAppointments.length}</strong>
            <span className="appointments-stat-meta">
              {undatedAppointments.length ? "Requieren revisión" : "Todo calendarizado"}
            </span>
          </article>
        </div>

        {nextScheduledAppointment ? (
          <div className="appointments-next-strip">
            <span className="appointments-next-strip-label">Siguiente actividad</span>
            <strong>{cleanUiText(nextScheduledAppointment.specialty, "Actividad programada")}</strong>
            <span>
              {nextScheduledAppointment.center
                ? `${cleanUiText(nextScheduledAppointment.center)} · `
                : ""}
              {formatAppointmentDateLabel(nextScheduledAppointment)}
            </span>
          </div>
        ) : null}
      </div>

      {isReadOnlyProfile ? (
        <div className="card">
          <div className="alert-info">
            <p>
              <strong>Perfil en modo lectura.</strong> Puedes revisar citas y exámenes, pero no crear, editar ni marcar actividades.
            </p>
          </div>
        </div>
      ) : null}

      {hasUndatedAppointments && (
        <div className="card">
          <div className="alert-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5" />
              <circle cx="12" cy="17" r="1" />
            </svg>
            <p>
              <strong>Hay actividades sin fecha.</strong> Agrega una fecha real para
              verlas en el calendario y recibir recordatorios.
            </p>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <select
                className="select-field"
                value={selectedUndatedId}
                onChange={(e) => setSelectedUndatedId(e.target.value)}
                style={{ minWidth: "200px" }}
              >
                {undatedAppointments.map((appt) => (
                  <option key={appt.id} value={String(appt.id)}>
                    {getAppointmentLabel(appt)}
                  </option>
                ))}
              </select>
              {canEditActiveProfile ? (
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => {
                    const target =
                      undatedAppointments.find(
                        (a) => String(a.id) === String(selectedUndatedId)
                      ) || undatedAppointments[0];
                    if (target) {
                      handleEdit(target);
                    } else {
                      resetForm();
                      setShowForm(true);
                    }
                  }}
                  style={{ whiteSpace: "nowrap" }}
                >
                  Agregar fecha
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {notifyOpen && notifyTarget && createPortal(
        <div className="native-sheet-backdrop" onClick={() => {
          setNotifyOpen(false);
          setNotifyTarget(null);
          navigate("/appointments", { replace: true });
        }}>
          <div className="native-sheet native-notify-sheet" onClick={(event) => event.stopPropagation()}>
            <span className="native-sheet-grabber" aria-hidden />
            <div className="native-detail-header">
              <div className="native-detail-header-top">
                <span className={`native-chip native-chip-type ${notifyTarget.type}`}>
                  {cleanUiText(typeLabels[notifyTarget.type] || notifyTarget.type)}
                </span>
                <button className="native-close-btn" type="button" onClick={() => {
                  setNotifyOpen(false);
                  setNotifyTarget(null);
                  navigate("/appointments", { replace: true });
                }} aria-label="Cerrar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <h3 className="native-detail-title">
                {cleanUiText(notifyTarget.specialty, typeLabels[notifyTarget.type] || "Cita")}
              </h3>
              <p className="native-detail-subtitle">
                {notifyTarget.center ? cleanUiText(notifyTarget.center) : ""}
                {notifyTarget.date_time ? ` · ${toLocaleDateTimeOrEmpty(notifyTarget.date_time)}` : ""}
              </p>
            </div>
            <div className="native-sheet-footer">
              <button
                className="native-btn native-btn-primary"
                type="button"
                onClick={() => {
                  setNotifyOpen(false);
                  setNotifyTarget(null);
                  navigate("/appointments", { replace: true });
                  handleOpenDetail(notifyTarget);
                }}
              >
                Ver detalle
              </button>
              {canEditActiveProfile && notifyTarget.status !== "realizada" ? (
                <button
                  className="native-btn native-btn-outline"
                  type="button"
                  onClick={() => {
                    handleMarkCompleted(notifyTarget).finally(() => {
                      setNotifyOpen(false);
                      setNotifyTarget(null);
                      navigate("/appointments", { replace: true });
                    });
                  }}
                >
                  Marcar realizada
                </button>
              ) : null}
            </div>
          </div>
        </div>
      , document.getElementById("overlay-root") || document.body)}

      {detailOpen && detailTarget && createPortal(
        <div className="native-sheet-backdrop" onClick={handleCloseDetail}>
          <div
            key={`detail-${detailTarget.id ?? "activity"}`}
            className="native-sheet native-detail-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="native-sheet-grabber" aria-hidden />

            {/* Header nativo con gradiente */}
            <div className="native-detail-header">
              <div className="native-detail-header-top">
                <span className={`native-chip native-chip-type ${detailTarget.type}`}>
                  {cleanUiText(typeLabels[detailTarget.type] || detailTarget.type)}
                </span>
                <button className="native-close-btn" type="button" onClick={handleCloseDetail} aria-label="Cerrar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <h3 className="native-detail-title">{cleanUiText(detailTarget.specialty, "Actividad médica")}</h3>
              <p className="native-detail-subtitle">{cleanUiText(detailTarget.center, "Centro por confirmar")}</p>
              <div className="native-detail-badges">
                <span className={`native-chip native-chip-status ${detailTarget.status}`}>
                  {cleanUiText(statusLabels[detailTarget.status] || detailTarget.status)}
                </span>
                <span className="native-chip native-chip-muted">
                  {detailTarget.date_time ? "Programada" : "Pendiente de fecha"}
                </span>
              </div>
            </div>

            {/* Cuerpo con campos */}
            <div className="native-sheet-body">
              <div className="native-detail-section">
                <h5 className="native-section-title">Información de la cita</h5>

                <div className="native-info-card">
                  <div className="native-info-row">
                    <span className="native-info-icon" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                      </svg>
                    </span>
                    <div className="native-info-content">
                      <span className="native-info-label">Especialidad</span>
                      <span className="native-info-value">{cleanUiText(detailTarget.specialty, "Sin especialidad")}</span>
                    </div>
                  </div>

                  <div className="native-info-divider" />

                  <div className="native-info-row">
                    <span className="native-info-icon" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M3 21h18"/>
                        <path d="M5 21V7l7-4 7 4v14"/>
                        <path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/>
                      </svg>
                    </span>
                    <div className="native-info-content">
                      <span className="native-info-label">Centro</span>
                      <span className="native-info-value">{cleanUiText(detailTarget.center, "Sin centro")}</span>
                    </div>
                  </div>

                  <div className="native-info-divider" />

                  <div className="native-info-row">
                    <span className="native-info-icon" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <rect x="3" y="4" width="18" height="18" rx="2"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                    </span>
                    <div className="native-info-content">
                      <span className="native-info-label">Fecha y hora</span>
                      <span className="native-info-value">
                        {detailTarget.date_time
                          ? toLocaleDateTimeOrEmpty(detailTarget.date_time)
                          : "Por agendar"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Notas en card separada */}
                {detailTarget.notes ? (
                  <div className="native-notes-card">
                    <div className="native-notes-header">
                      <span className="native-info-icon" aria-hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                          <line x1="8" y1="13" x2="16" y2="13"/>
                          <line x1="8" y1="17" x2="13" y2="17"/>
                        </svg>
                      </span>
                      <span className="native-info-label">Notas</span>
                    </div>
                    <p className="native-notes-text">{cleanUiText(detailTarget.notes)}</p>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Footer con acciones */}
            {canEditActiveProfile ? (
              <div className="native-sheet-footer">
                <button
                  className="native-btn native-btn-outline"
                  type="button"
                  onClick={() => {
                    handleEdit(detailTarget);
                    handleCloseDetail();
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  Editar
                </button>
                {detailTarget.status !== "realizada" ? (
                  <button
                    className="native-btn native-btn-primary"
                    type="button"
                    onClick={() => {
                      handleMarkCompleted(detailTarget).finally(handleCloseDetail);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Marcar realizada
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      , document.getElementById("overlay-root") || document.body)}

      {successOpen && successTarget && createPortal(
        <div className="native-sheet-backdrop" onClick={handleCloseSuccess}>
          <div
            className="native-sheet native-success-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="native-sheet-grabber" aria-hidden />

            <div className="native-success-hero">
              <div className="native-success-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="native-success-kicker">
                {successMode === "updated" ? "Actividad actualizada" : "Actividad guardada"}
              </p>
              <h3 className="native-success-title">
                {successMode === "updated" ? "Cambios aplicados" : "Todo listo"}
              </h3>
              <p className="native-success-copy">
                {successMode === "updated"
                  ? "La información quedó actualizada y ya forma parte de tu seguimiento clínico."
                  : "La actividad quedó registrada correctamente y ya aparece en tu agenda clínica."}
              </p>
              {successTarget?.id ? (
                <p className="native-success-ref">
                  Referencia <strong>#{successTarget.id}</strong>
                </p>
              ) : null}
            </div>

            <div className="native-sheet-body">
              <div className="native-info-card">
                <div className="native-info-row">
                  <span className="native-info-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                      <circle cx="12" cy="8" r="3.5" />
                      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
                    </svg>
                  </span>
                  <div className="native-info-content">
                    <span className="native-info-label">Perfil activo</span>
                    <span className="native-info-value">{cleanUiText(activeProfile?.display_name || activeProfile?.full_name || "Mi perfil")}</span>
                  </div>
                </div>
                <div className="native-info-divider" />
                <div className="native-info-row">
                  <span className="native-info-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </span>
                  <div className="native-info-content">
                    <span className="native-info-label">Actividad</span>
                    <span className="native-info-value">{cleanUiText(successTarget.specialty, typeLabels[successTarget.type] || "Actividad")}</span>
                  </div>
                </div>
                <div className="native-info-divider" />
                <div className="native-info-row">
                  <span className="native-info-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                      <path d="M3 21h18" />
                      <path d="M5 21V7l7-4 7 4v14" />
                      <path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
                    </svg>
                  </span>
                  <div className="native-info-content">
                    <span className="native-info-label">Centro</span>
                    <span className="native-info-value">{cleanUiText(successTarget.center, "Centro por confirmar")}</span>
                  </div>
                </div>
                <div className="native-info-divider" />
                <div className="native-info-row">
                  <span className="native-info-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                      <path d="M12 6v6l4 2" />
                      <circle cx="12" cy="12" r="9" />
                    </svg>
                  </span>
                  <div className="native-info-content">
                    <span className="native-info-label">Fecha</span>
                    <span className="native-info-value">{formatAppointmentDateLabel(successTarget)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="native-sheet-footer">
              <button
                className="native-btn native-btn-primary"
                type="button"
                onClick={() => {
                  handleCloseSuccess();
                  handleOpenDetail(successTarget);
                }}
              >
                Ver detalle
              </button>
              <button
                className="native-btn native-btn-ghost"
                type="button"
                onClick={handleCloseSuccess}
              >
                Volver a citas
              </button>
            </div>
          </div>
        </div>
      , document.getElementById("overlay-root") || document.body)}

      {showForm && canEditActiveProfile && createPortal(
        <div className="native-sheet-backdrop" onClick={() => setShowForm(false)}>
          <div
            key={form.id ?? "new-appointment"}
            className="native-sheet native-form-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="native-sheet-grabber" aria-hidden />

            {/* Header nativo del formulario */}
            <div className="native-form-header">
              <div className="native-form-header-row">
                <button
                  className="native-header-action"
                  type="button"
                  onClick={() => { resetForm(); setShowForm(false); }}
                >
                  Cancelar
                </button>
                <h3 className="native-form-title">
                  {form.id ? "Editar actividad" : "Nueva actividad"}
                </h3>
                <button
                  className="native-header-action native-header-action-primary"
                  type="button"
                  disabled={loading}
                  onClick={handleSubmit}
                >
                  {loading ? "..." : form.id ? "Guardar" : "Agregar"}
                </button>
              </div>
              <p className="native-form-subtitle">
                Completa los datos principales de tu cita
              </p>
            </div>

            <form className="native-form-shell" onSubmit={handleSubmit}>
              <div className="native-sheet-body">
                {/* Tipo */}
                <div className="native-form-section">
                  <h5 className="native-section-title">Tipo de actividad</h5>
                  <div className="native-type-selector">
                    {[
                      { value: "cita", label: "Cita médica", icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                      )},
                      { value: "examen", label: "Examen", icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>
                      )},
                      { value: "tramite", label: "Trámite", icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      )},
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`native-type-option ${form.type === opt.value ? "active" : ""}`}
                        onClick={() => setForm({ ...form, type: opt.value })}
                      >
                        <span className="native-type-icon">{opt.icon}</span>
                        <span className="native-type-label">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Campos principales */}
                <div className="native-form-section">
                  <h5 className="native-section-title">Detalles</h5>
                  <div className="native-form-card">
                    <div className="native-form-field">
                      <label className="native-field-label">Especialidad</label>
                      <input
                        className="native-field-input"
                        value={form.specialty}
                        onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                        placeholder="Ej: Medicina general"
                      />
                    </div>
                    <div className="native-form-field-divider" />
                    <div className="native-form-field">
                      <label className="native-field-label">Centro de salud</label>
                      <input
                        className="native-field-input"
                        value={form.center}
                        onChange={(e) => setForm({ ...form, center: e.target.value })}
                        placeholder="Ej: Hospital, clínica..."
                      />
                    </div>
                  </div>
                </div>

                {/* Fecha y estado */}
                <div className="native-form-section">
                  <h5 className="native-section-title">Programación</h5>
                  <div className="native-form-card">
                    <div className="native-form-field">
                      <label className="native-field-label">Fecha y hora</label>
                      <input
                        className="native-field-input"
                        type="datetime-local"
                        value={form.date_time}
                        onChange={(e) => setForm({ ...form, date_time: e.target.value })}
                      />
                      <span className="native-field-hint">
                        Opcional si aún no tienes la hora exacta
                      </span>
                    </div>
                    <div className="native-form-field-divider" />
                    <div className="native-form-field">
                      <label className="native-field-label">Estado</label>
                      <select
                        className="native-field-select"
                        value={form.status}
                        onChange={(e) => setForm({ ...form, status: e.target.value })}
                      >
                        <option value="pendiente">Pendiente</option>
                        <option value="agendada">Agendada</option>
                        <option value="realizada">Realizada</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Notas */}
                <div className="native-form-section">
                  <h5 className="native-section-title">Notas</h5>
                  <div className="native-form-card">
                    <div className="native-form-field">
                      <textarea
                        className="native-field-textarea"
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        placeholder="Ej: Traer exámenes, venir en ayunas..."
                        rows={4}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer con botones nativos */}
              <div className="native-sheet-footer">
                <button className="native-btn native-btn-primary native-btn-full" type="submit" disabled={loading}>
                  {loading ? "Guardando..." : form.id ? "Actualizar" : "Agregar actividad"}
                </button>
                <button
                  type="button"
                  className="native-btn native-btn-ghost"
                  onClick={() => { resetForm(); setShowForm(false); }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      , document.getElementById("overlay-root") || document.body)}

      {/* Tabs estilo Burjeel - visibles solo en mobile */}
      <div className="appt-tabs-bar">
        <button
          type="button"
          className={`appt-tab-btn ${statusFilter === "all" || statusFilter === "pendiente" || statusFilter === "agendada" ? "active" : ""}`}
          onClick={() => setStatusFilter("all")}
        >
          Próximas
        </button>
        <button
          type="button"
          className={`appt-tab-btn ${statusFilter === "realizada" ? "active" : ""}`}
          onClick={() => setStatusFilter("realizada")}
        >
          Realizadas
        </button>
      </div>

      {/* Barra de búsqueda mobile */}
      <div className="appt-search-bar">
        <div className="appt-search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            className="appt-search-input"
            placeholder="Especialidad, centro..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {canEditActiveProfile ? (
        <div className="card appointments-surface-free appointments-create appointments-create-mobile">
          <button
            className="primary-btn"
            type="button"
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
          >
            Agregar actividad
          </button>
        </div>
      ) : null}

      <div className="card appointments-surface-free appointments-filters-card appt-desktop-filters">
        <h3 className="card-title">Listado de actividades</h3>
        <div className="form-row appointments-filters-row" style={{ marginBottom: "0.75rem" }}>
          <div className="input-group">
            <label className="input-label">Búsqueda</label>
            <input
              className="input-field"
              placeholder="Especialidad, centro o notas"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label className="input-label">Tipo</label>
            <select
              className="select-field"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="cita">Cita</option>
              <option value="examen">Examen</option>
              <option value="tramite">Trámite</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Estado</label>
            <select
              className="select-field"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="agendada">Agendada</option>
              <option value="realizada">Realizada</option>
            </select>
          </div>
        </div>
        {appointments.length === 0 ? (
          <p className="muted">Aún no has registrado actividades.</p>
        ) : filteredAppointments.length === 0 ? (
          <p className="muted">No hay actividades que coincidan con los filtros.</p>
        ) : (
          <>
            <div className="appointments-table-shell" style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Especialidad</th>
                    <th>Centro</th>
                    <th>Fecha y hora</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAppointments.map((a) => (
                    <tr
                      key={a.id}
                      className="table-row-clickable"
                      onClick={() => handleOpenDetail(a)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleOpenDetail(a);
                        }
                      }}
                    >
                      <td>
                        <span className={`chip ${a.type}`}>
                          {cleanUiText(typeLabels[a.type] || a.type)}
                        </span>
                      </td>
                      <td>{cleanUiText(a.specialty)}</td>
                      <td>{cleanUiText(a.center)}</td>
                      <td>{formatAppointmentDateLabel(a)}</td>
                      <td>
                        <span className={`chip-status-${a.status}`}>
                          {cleanUiText(statusLabels[a.status] || a.status)}
                        </span>
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        {canEditActiveProfile ? (
                          <RowActionsMenu
                            items={[
                              a.status !== "realizada"
                                ? {
                                    key: "complete",
                                    label: "Marcar realizada",
                                    onClick: () => handleMarkCompleted(a),
                                  }
                                : null,
                              {
                                key: "edit",
                                label: "Editar",
                                onClick: () => handleEdit(a),
                              },
                              {
                                key: "delete",
                                label: "Eliminar",
                                danger: true,
                                onClick: () => handleDelete(a),
                              },
                            ]}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="records-mobile-list appointments-mobile-list">
              {filteredAppointments.map((a) => (
                <article
                  key={`mobile-${a.id}`}
                  className="appt-burjeel-card"
                  onClick={() => handleOpenDetail(a)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleOpenDetail(a);
                    }
                  }}
                >
                  {/* Badge de estado arriba a la derecha */}
                  <span className={`appt-burjeel-badge appt-badge-${a.status}`}>
                    {a.status === "agendada" ? "Cita confirmada" : a.status === "realizada" ? "Realizada" : "Pendiente de agendar"}
                  </span>

                  {/* Header: ícono + datos del doctor/especialidad */}
                  <div className="appt-burjeel-head">
                    <span className={`appt-burjeel-icon is-${a.type}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                        <rect x="9" y="3" width="6" height="4" rx="1"/>
                        <path d="M9 12h6M9 16h4"/>
                      </svg>
                    </span>
                    <div className="appt-burjeel-info">
                      <strong className="appt-burjeel-name">
                        {cleanUiText(a.specialty || typeLabels[a.type] || "Actividad")}
                      </strong>
                      <span className="appt-burjeel-specialty">
                        {cleanUiText(typeLabels[a.type] || a.type)}
                      </span>
                      <span className="appt-burjeel-center">
                        {cleanUiText(a.center || "Centro por confirmar")}
                      </span>
                    </div>
                    {canEditActiveProfile && (
                      <div className="appt-burjeel-menu" onClick={(e) => e.stopPropagation()}>
                        <RowActionsMenu
                          items={[
                            a.status !== "realizada" ? { key: "complete", label: "Marcar realizada", onClick: () => handleMarkCompleted(a) } : null,
                            { key: "edit", label: "Editar", onClick: () => handleEdit(a) },
                            { key: "delete", label: "Eliminar", danger: true, onClick: () => handleDelete(a) },
                          ]}
                        />
                      </div>
                    )}
                  </div>

                  {/* Fecha y hora */}
                  <div className="appt-burjeel-datetime">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="14" height="14">
                      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>
                      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                    </svg>
                    {formatAppointmentDateLabel(a)}
                  </div>

                  {/* Botones de acción */}
                  {canEditActiveProfile && (
                    <div className="appt-burjeel-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="appt-burjeel-btn-cancel"
                        onClick={() => handleDelete(a)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="appt-burjeel-btn-edit"
                        onClick={() => handleEdit(a)}
                      >
                        Editar
                      </button>
                    </div>
                  )}
                  {!canEditActiveProfile && (
                    <div className="appt-burjeel-actions">
                      <button
                        type="button"
                        className="appt-burjeel-btn-edit"
                        style={{ flex: 1 }}
                        onClick={(e) => { e.stopPropagation(); handleOpenDetail(a); }}
                      >
                        Ver detalle
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
