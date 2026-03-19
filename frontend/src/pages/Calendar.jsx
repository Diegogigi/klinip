import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getAppointments,
  getHealthProfiles,
  getMedications,
  setActiveHealthProfile,
} from "../api";
import {
  parseDate,
  toLocaleDateOrEmpty,
  toLocaleDateTimeOrEmpty,
} from "../utils/dates";

const typeColors = {
  cita: "event-green",
  examen: "event-blue",
  tramite: "event-yellow",
  medication: "event-purple",
};

const profileToneClasses = ["profile-blue", "profile-violet", "profile-teal", "profile-amber"];

const MOJIBAKE_FALLBACKS = [
  ["ÃƒÂ¡", "Ã¡"],
  ["ÃƒÂ©", "Ã©"],
  ["ÃƒÂ­", "Ã­"],
  ["ÃƒÂ³", "Ã³"],
  ["ÃƒÂº", "Ãº"],
  ["ÃƒÂ±", "Ã±"],
  ["ÃƒÂ", "Ã"],
  ["Ãƒâ€°", "Ã‰"],
  ["ÃƒÂ", "Ã"],
  ["Ãƒâ€œ", "Ã“"],
  ["ÃƒÅ¡", "Ãš"],
  ["Ãƒâ€˜", "Ã‘"],
  ["Ã‚Â¿", "Â¿"],
  ["Ã‚Â¡", "Â¡"],
  ["Ã‚Â·", "Â·"],
];

function cleanUiText(value, fallback = "") {
  const text = String(value ?? "");
  const cleaned = MOJIBAKE_FALLBACKS.reduce(
    (result, [search, replacement]) => result.split(search).join(replacement),
    text
  ).trim();
  return cleaned || fallback;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function getMonthDays(viewDate) {
  const first = startOfMonth(viewDate);
  const startDay = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
  }
  const extra = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < extra; i += 1) cells.push(null);
  return cells;
}

function parseDurationDays(value) {
  if (!value) return null;
  const match = String(value).match(/(\d+)/);
  if (!match) return null;
  const days = parseInt(match[1], 10);
  return Number.isNaN(days) || days <= 0 ? null : days;
}

function toDayKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function roleCanWrite(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "caregiver" || normalized === "admin";
}

function profileShortName(profile) {
  const fullName = cleanUiText(profile?.full_name || profile?.display_name || "Perfil");
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (!parts.length) return "Perfil";
  return parts.slice(0, 2).join(" ");
}

function profileInitials(profileName) {
  const text = cleanUiText(profileName || "P");
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return "P";
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function eventTypeLabel(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "medication") return "Med";
  if (normalized === "examen") return "Exam";
  if (normalized === "tramite") return "Tram";
  return "Cita";
}

function calendarEventTitle(eventItem) {
  if (eventItem?.type === "medication") {
    return cleanUiText(eventItem?.name, "Medicamento");
  }
  return cleanUiText(eventItem?.specialty || eventItem?.center, "Actividad");
}

function calendarEventMeta(eventItem) {
  if (!eventItem) return "";
  if (eventItem.type === "medication") {
    const schedule = cleanUiText(eventItem.schedule_time || "", "");
    const dose = cleanUiText(eventItem.dose || "", "");
    if (schedule && dose) return `${schedule} - ${dose}`;
    if (schedule) return schedule;
    if (dose) return dose;
    return cleanUiText(eventItem.frequency, "Tratamiento");
  }
  if (eventItem.date_time) {
    const parsed = parseDate(eventItem.date_time);
    if (parsed) {
      return new Intl.DateTimeFormat("es-CL", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(parsed);
    }
  }
  return cleanUiText(eventItem.center || eventItem.type, "Actividad");
}

function buildMedicationEventsForProfile(profile, medications) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const events = [];

  (medications || []).forEach((medication) => {
    if (medication?.completed) return;
    let end = medication?.end_date ? parseDate(medication.end_date) : null;
    if (!end) {
      const durationDays = parseDurationDays(medication?.duration);
      if (durationDays) {
        end = new Date(today.getTime());
        end.setDate(end.getDate() + durationDays);
      } else {
        end = new Date(today.getTime());
        end.setDate(end.getDate() + 7);
      }
    }

    const lastDay = end < horizon ? end : horizon;
    const loopDay = new Date(today);
    while (loopDay <= lastDay) {
      const eventDate = new Date(loopDay);
      events.push({
        event_id: `med-${profile.id}-${medication.id || medication.name || "item"}-${toDayKey(eventDate)}`,
        type: "medication",
        name: medication.name,
        dose: medication.dose,
        frequency: medication.frequency,
        schedule_time: medication.schedule_time,
        notes: medication.notes,
        end_date: medication.end_date,
        profileId: profile.id,
        profileName: profileShortName(profile),
        profileTone: profile.tone,
        accessRole: profile.access_role || "",
        canWrite: roleCanWrite(profile.access_role),
        date: eventDate,
        sortAt: new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate(), 9, 0, 0, 0).getTime(),
      });
      loopDay.setDate(loopDay.getDate() + 1);
    }
  });

  return events;
}

export default function Calendar() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [appointmentsByProfile, setAppointmentsByProfile] = useState({});
  const [medicationsByProfile, setMedicationsByProfile] = useState({});
  const [loading, setLoading] = useState(true);
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  const [selected, setSelected] = useState(null);
  const [calendarScope, setCalendarScope] = useState("mine");
  const [sharedProfileId, setSharedProfileId] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadCalendar() {
      setLoading(true);
      try {
        const profilesResponse = await getHealthProfiles().catch(() => []);
        const rawProfiles = Array.isArray(profilesResponse) ? profilesResponse : [];
        const orderedProfiles = [...rawProfiles].sort((a, b) => {
          const aSelf = String(a.relationship_type || "").toLowerCase() === "self" ? 1 : 0;
          const bSelf = String(b.relationship_type || "").toLowerCase() === "self" ? 1 : 0;
          if (aSelf !== bSelf) return bSelf - aSelf;
          if (Boolean(a.is_primary_profile) !== Boolean(b.is_primary_profile)) {
            return Number(Boolean(b.is_primary_profile)) - Number(Boolean(a.is_primary_profile));
          }
          return cleanUiText(a.full_name).localeCompare(cleanUiText(b.full_name), "es");
        });
        const normalizedProfiles = orderedProfiles.map((profile, index) => ({
          ...profile,
          tone: profileToneClasses[index % profileToneClasses.length],
          display_name: profileShortName(profile),
          isSelf: String(profile.relationship_type || "").toLowerCase() === "self",
        }));

        const bundles = await Promise.all(
          normalizedProfiles.map(async (profile) => {
            const [appointments, medications] = await Promise.all([
              getAppointments({ profileId: profile.id }).catch(() => []),
              getMedications({ profileId: profile.id }).catch(() => []),
            ]);
            return {
              profileId: profile.id,
              appointments: Array.isArray(appointments) ? appointments : [],
              medications: Array.isArray(medications) ? medications : [],
            };
          })
        );

        if (cancelled) return;

        const nextAppointments = {};
        const nextMedications = {};
        bundles.forEach((bundle) => {
          nextAppointments[bundle.profileId] = bundle.appointments;
          nextMedications[bundle.profileId] = bundle.medications;
        });

        setProfiles(normalizedProfiles);
        setAppointmentsByProfile(nextAppointments);
        setMedicationsByProfile(nextMedications);
      } catch (error) {
        console.error("No se pudo cargar el calendario familiar", error);
        if (!cancelled) {
          setProfiles([]);
          setAppointmentsByProfile({});
          setMedicationsByProfile({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadCalendar();
    return () => {
      cancelled = true;
    };
  }, []);

  const ownProfiles = useMemo(() => profiles.filter((profile) => profile.isSelf), [profiles]);
  const primaryOwnProfile = ownProfiles[0] || profiles[0] || null;
  const sharedProfiles = useMemo(
    () => profiles.filter((profile) => !primaryOwnProfile || profile.id !== primaryOwnProfile.id),
    [profiles, primaryOwnProfile]
  );

  useEffect(() => {
    if (!sharedProfiles.length) {
      setCalendarScope("mine");
      setSharedProfileId("");
      return;
    }
    setSharedProfileId((current) => {
      if (sharedProfiles.some((profile) => String(profile.id) === String(current))) {
        return current;
      }
      return String(sharedProfiles[0].id);
    });
  }, [sharedProfiles]);

  const selectedSharedProfile = useMemo(() => {
    if (!sharedProfiles.length) return null;
    return (
      sharedProfiles.find((profile) => String(profile.id) === String(sharedProfileId)) || sharedProfiles[0]
    );
  }, [sharedProfiles, sharedProfileId]);

  const visibleProfiles = useMemo(() => {
    if (calendarScope === "shared" && selectedSharedProfile) {
      return [selectedSharedProfile];
    }
    if (calendarScope === "both") {
      return [primaryOwnProfile, selectedSharedProfile].filter(Boolean);
    }
    return primaryOwnProfile ? [primaryOwnProfile] : selectedSharedProfile ? [selectedSharedProfile] : [];
  }, [calendarScope, primaryOwnProfile, selectedSharedProfile]);

  const normalizedViewDate = useMemo(() => {
    if (viewDate instanceof Date && !Number.isNaN(viewDate.getTime())) return viewDate;
    const parsed = new Date(viewDate);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [viewDate]);

  const monthLabel = normalizedViewDate.toLocaleDateString("es-CL", {
    month: "long",
    year: "numeric",
  });

  const days = useMemo(() => getMonthDays(normalizedViewDate), [normalizedViewDate]);

  const eventsByDay = useMemo(() => {
    const map = {};
    const pushEvent = (key, eventItem) => {
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(eventItem);
    };

    visibleProfiles.forEach((profile) => {
      (appointmentsByProfile[profile.id] || []).forEach((appointment) => {
        const dateValue = appointment?.date_time || appointment?.created_at;
        const date = parseDate(dateValue);
        if (!date) return;
        pushEvent(toDayKey(date), {
          ...appointment,
          event_id: `appt-${profile.id}-${appointment.id}`,
          profileId: profile.id,
          profileName: profileShortName(profile),
          profileTone: profile.tone,
          accessRole: profile.access_role || "",
          canWrite: roleCanWrite(profile.access_role),
          date,
          sortAt: date.getTime(),
        });
      });

      buildMedicationEventsForProfile(profile, medicationsByProfile[profile.id] || []).forEach((eventItem) => {
        pushEvent(toDayKey(eventItem.date), eventItem);
      });
    });

    Object.keys(map).forEach((key) => {
      map[key] = map[key].sort((a, b) => a.sortAt - b.sortAt);
    });

    return map;
  }, [appointmentsByProfile, medicationsByProfile, visibleProfiles]);

  const selectedEvents = useMemo(() => {
    if (!selected) return [];
    return eventsByDay[toDayKey(selected)] || [];
  }, [eventsByDay, selected]);

  const currentActionProfile = useMemo(() => {
    if (calendarScope === "mine") return primaryOwnProfile;
    if (calendarScope === "shared") return selectedSharedProfile;
    return null;
  }, [calendarScope, primaryOwnProfile, selectedSharedProfile]);

  const canCreateOnCurrentProfile = Boolean(
    currentActionProfile && roleCanWrite(currentActionProfile.access_role)
  );

  const handleCreateFromCalendar = async () => {
    if (!currentActionProfile || !canCreateOnCurrentProfile) return;
    setSwitchingProfile(true);
    try {
      await setActiveHealthProfile(currentActionProfile.id);
      navigate("/appointments");
    } catch (error) {
      console.error("No se pudo cambiar el perfil activo para crear la actividad", error);
      window.alert("No pudimos abrir el formulario de citas para ese perfil.");
    } finally {
      setSwitchingProfile(false);
    }
  };

  return (
    <>
      <div className="card calendar-card">
        <div className="card-header calendar-header">
          <div>
            <h2 className="card-title">Calendario de salud</h2>
            <p className="muted calendar-intro-copy">
              Vista mensual para citas, exámenes, trámites y medicación. Pulsa un día para ver el
              detalle.
            </p>
          </div>
          <div className="calendar-controls">
            <button
              className="pill-button"
              type="button"
              onClick={() => setViewDate(addMonths(normalizedViewDate, -1))}
            >
              Mes anterior
            </button>
            <div className="month-display">{monthLabel}</div>
            <button
              className="pill-button"
              type="button"
              onClick={() => setViewDate(addMonths(normalizedViewDate, 1))}
            >
              Mes siguiente
            </button>
          </div>
        </div>

        {sharedProfiles.length ? (
          <div className="calendar-family-toolbar">
            <div className="calendar-scope-switch" role="tablist" aria-label="Modo de calendario">
              <button
                type="button"
                className={`calendar-scope-btn ${calendarScope === "mine" ? "is-active" : ""}`}
                onClick={() => setCalendarScope("mine")}
              >{"M\u00EDo"}</button>
              <button
                type="button"
                className={`calendar-scope-btn ${calendarScope === "shared" ? "is-active" : ""}`}
                onClick={() => setCalendarScope("shared")}
              >
                Compartido
              </button>
              <button
                type="button"
                className={`calendar-scope-btn ${calendarScope === "both" ? "is-active" : ""}`}
                onClick={() => setCalendarScope("both")}
              >
                Ambos
              </button>
            </div>
            <div className="calendar-family-toolbar-meta">
              {sharedProfiles.length > 1 ? (
                <label className="calendar-shared-select-wrap">
                  <span className="calendar-shared-select-label">Perfil compartido</span>
                  <select
                    className="select-field calendar-shared-select"
                    value={selectedSharedProfile ? String(selectedSharedProfile.id) : ""}
                    onChange={(event) => setSharedProfileId(event.target.value)}
                  >
                    {sharedProfiles.map((profile) => (
                      <option key={profile.id} value={String(profile.id)}>
                        {profile.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : selectedSharedProfile ? (
                <p className="muted calendar-shared-caption">
                  Compartido con <strong>{selectedSharedProfile.display_name}</strong>
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {visibleProfiles.length > 1 ? (
          <div className="calendar-profile-legend">
            {visibleProfiles.map((profile) => (
              <span key={profile.id} className={`calendar-profile-pill ${profile.tone}`}>
                {profile.display_name}
              </span>
            ))}
          </div>
        ) : null}

        <div className="legend">
          <span className="legend-dot event-green" /> Citas
          <span className="legend-dot event-blue" /> Exámenes
          <span className="legend-dot event-yellow" /> Trámites
          <span className="legend-dot event-purple" /> Medicación
        </div>

        {loading ? (
          <div className="home-loading">Cargando calendario familiar...</div>
        ) : (
          <div className="calendar">
            {["L", "M", "X", "J", "V", "S", "D"].map((dayLabel) => (
              <div key={dayLabel} className="calendar-day-header">
                {dayLabel}
              </div>
            ))}
            {days.map((day, index) => {
              const key = day ? toDayKey(day) : `empty-${index}`;
              const events = day ? eventsByDay[key] || [] : [];
              const isWeekend = day ? day.getDay() === 0 || day.getDay() === 6 : false;
              const isToday = day ? key === toDayKey(new Date()) : false;
              const cellClass = [
                "calendar-cell",
                day ? "" : "empty",
                isWeekend ? "calendar-weekend" : "",
                isToday ? "calendar-today" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <div key={key} className={cellClass} onClick={() => day && setSelected(day)}>
                  {day && (
                    <>
                      <div className="calendar-date">
                        <span>{day.getDate()}</span>
                      </div>
                      <div className="calendar-events">
                        {events.slice(0, 2).map((eventItem) => (
                          <article
                            key={eventItem.event_id}
                            className={`calendar-event-card ${typeColors[eventItem.type] || "event-green"} ${eventItem.profileTone || ""}`}
                            title={`${eventItem.profileName}: ${calendarEventTitle(eventItem)}`}
                          >
                            <div className="calendar-event-card-top">
                              <span className="calendar-event-type">
                                {eventTypeLabel(eventItem.type)}
                              </span>
                              {sharedProfiles.length ? (
                                <span className={`calendar-event-profile ${eventItem.profileTone || ""}`}>
                                  {profileInitials(eventItem.profileName)}
                                </span>
                              ) : null}
                            </div>
                            <strong className="calendar-event-title">
                              {calendarEventTitle(eventItem)}
                            </strong>
                            <span className="calendar-event-meta">
                              {calendarEventMeta(eventItem)}
                            </span>
                          </article>
                        ))}
                        {events.length > 2 && <span className="event-more">+{events.length - 2}</span>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <div className="floating-form-backdrop" onClick={() => setSelected(null)}>
          <div className="floating-form-card" onClick={(event) => event.stopPropagation()}>
            <div className="card-header" style={{ marginBottom: "0.5rem" }}>
              <h3 className="card-title" style={{ margin: 0 }}>
                {selected.toLocaleDateString("es-CL")}
              </h3>
              <button className="secondary-btn" type="button" onClick={() => setSelected(null)}>
                Cerrar
              </button>
            </div>
            {selectedEvents.length === 0 ? (
              <p className="muted">Sin actividades en esta fecha.</p>
            ) : (
              <ul className="timeline">
                {selectedEvents.map((eventItem) => (
                  <li key={eventItem.event_id} className="timeline-item">
                    <div className="timeline-main calendar-timeline-main">
                      <span className={`chip ${eventItem.type}`}>
                        {eventItem.type === "medication"
                          ? "Medicaci\u00F3n"
                          : cleanUiText(eventItem.type, "Actividad")}
                      </span>
                      {eventItem.status ? (
                        <span className={`chip-status-${eventItem.status}`}>{cleanUiText(eventItem.status)}</span>
                      ) : null}
                      <span className={`calendar-profile-pill ${eventItem.profileTone || ""}`}>
                        {eventItem.profileName}
                      </span>
                    </div>
                    <p className="timeline-title">
                      {eventItem.type === "medication"
                        ? cleanUiText(eventItem.name, "Medicamento")
                        : `${cleanUiText(eventItem.specialty, "Sin especialidad")} - ${cleanUiText(
                            eventItem.center,
                            "Centro no definido"
                          )}`}
                    </p>
                    <p className="timeline-meta">
                      {eventItem.type === "medication"
                        ? `${cleanUiText(eventItem.dose)} ${cleanUiText(
                            eventItem.frequency,
                            "Segun indicacion"
                          )}`.trim()
                        : eventItem.date_time
                        ? toLocaleDateTimeOrEmpty(eventItem.date_time) || "Por agendar"
                        : "Por agendar"}
                    </p>
                    {eventItem.notes ? <p className="timeline-notes">Notas: {cleanUiText(eventItem.notes)}</p> : null}
                    {eventItem.type === "medication" && eventItem.end_date ? (
                      <p className="timeline-meta">Hasta {toLocaleDateOrEmpty(eventItem.end_date)}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="floating-actions calendar-floating-actions">
              {calendarScope === "both" ? (
                <>
                <p className="muted calendar-helper-note calendar-helper-note-clean">
                  Elige "Mío" o "Compartido" para crear una actividad en un perfil específico.
                </p>
                </>
              ) : currentActionProfile && canCreateOnCurrentProfile ? (
                <button
                  className="primary-btn"
                  type="button"
                  disabled={switchingProfile}
                  onClick={handleCreateFromCalendar}
                >
                  {switchingProfile
                    ? "Abriendo..."
                    : `Agregar actividad en ${currentActionProfile.display_name}`}
                </button>
              ) : currentActionProfile ? (
                <p className="muted calendar-helper-note">
                  Tienes vista de solo lectura para el calendario de {currentActionProfile.display_name}.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

