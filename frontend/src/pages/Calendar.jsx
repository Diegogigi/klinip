
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getAppointments, getMedications } from "../api";
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

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function getMonthDays(viewDate) {
  const first = startOfMonth(viewDate);
  const startDay = first.getDay() === 0 ? 6 : first.getDay() - 1; // Monday start
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(viewDate.getFullYear(), viewDate.getMonth(), d));
  }
  const extra = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < extra; i++) cells.push(null);
  return cells;
}

function parseDurationDays(value) {
  if (!value) return null;
  const match = String(value).match(/(\d+)/);
  if (!match) return null;
  const days = parseInt(match[1], 10);
  return Number.isNaN(days) || days <= 0 ? null : days;
}

export default function Calendar() {
  const [appointments, setAppointments] = useState([]);
  const [medications, setMedications] = useState([]);
  const [viewDate, setViewDate] = useState(new Date());
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    Promise.all([getAppointments(), getMedications()])
      .then(([apptRes, medRes]) => {
        setAppointments(apptRes || []);
        setMedications(medRes || []);
      })
      .catch((err) => {
        console.error("No se pudieron cargar las actividades", err);
        setAppointments([]);
        setMedications([]);
      });
  }, []);

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
    const pushEvent = (key, ev) => {
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    };

    (appointments || []).forEach((a) => {
      const dateValue = a?.date_time || a?.created_at;
      if (!dateValue) return;
      const d = parseDate(dateValue);
      if (!d) return;
      const key = d.toISOString().slice(0, 10);
      pushEvent(key, a);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    (medications || []).forEach((m) => {
      if (m?.completed) return;
      let end = m?.end_date ? parseDate(m.end_date) : null;
      if (!end) {
        const durationDays = parseDurationDays(m?.duration);
        if (durationDays) {
          end = new Date(today.getTime());
          end.setDate(end.getDate() + durationDays);
        } else {
          end = new Date(today.getTime());
          end.setDate(end.getDate() + 7);
        }
      }
      const lastDay = end < horizon ? end : horizon;
      for (let day = new Date(today); day <= lastDay; day.setDate(day.getDate() + 1)) {
        const key = day.toISOString().slice(0, 10);
        pushEvent(key, {
          id: "med-" + (m.id || m.name || "item") + "-" + key,
          type: "medication",
          name: m.name,
          dose: m.dose,
          frequency: m.frequency,
          notes: m.notes,
          end_date: m.end_date,
        });
      }
    });
    return map;
  }, [appointments, medications]);

  const selectedEvents = useMemo(() => {
    if (!selected) return [];
    const key = selected.toISOString().slice(0, 10);
    return eventsByDay[key] || [];
  }, [selected, eventsByDay]);

  return (
    <>
      <div className="card calendar-card">
        <div className="card-header" style={{ alignItems: "center" }}>
          <h2 className="card-title">Calendario de salud</h2>
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
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Vista mensual para citas, examenes, tramites y medicacion. Pulsa un dia para ver actividades o agrega desde Citas.
        </p>
        <div className="legend">
          <span className="legend-dot event-green" /> Citas
          <span className="legend-dot event-blue" /> Examenes
          <span className="legend-dot event-yellow" /> Tramites
          <span className="legend-dot event-purple" /> Medicacion
        </div>
        <div className="calendar">
          {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
            <div key={d} className="calendar-day-header">
              {d}
            </div>
          ))}
          {days.map((day, idx) => {
            const key = day ? day.toISOString().slice(0, 10) : "empty-" + idx;
            const events = day ? eventsByDay[key] || [] : [];
            const isWeekend = day ? day.getDay() === 0 || day.getDay() === 6 : false;
            const todayKey = new Date().toISOString().slice(0, 10);
            const isToday = day ? key === todayKey : false;
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
                      {events.slice(0, 3).map((ev) => (
                        <span
                          key={ev.id}
                          className={"event-dot " + (typeColors[ev.type] || "event-green")}
                        />
                      ))}
                      {events.length > 3 && <span className="event-more">+{events.length - 3}</span>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="floating-form-backdrop" onClick={() => setSelected(null)}>
          <div className="floating-form-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-header" style={{ marginBottom: "0.5rem" }}>
              <h3 className="card-title" style={{ margin: 0 }}>
                {selected.toLocaleDateString()}
              </h3>
              <button className="secondary-btn" type="button" onClick={() => setSelected(null)}>
                Cerrar
              </button>
            </div>
            {selectedEvents.length === 0 ? (
              <p className="muted">Sin actividades en esta fecha.</p>
            ) : (
              <ul className="timeline">
                {selectedEvents.map((ev) => (
                  <li key={ev.id} className="timeline-item">
                    <div className="timeline-main">
                      <span className={"chip " + ev.type}>
                        {ev.type === "medication" ? "Medicacion" : ev.type}
                      </span>
                      {ev.status && <span className={"chip-status-" + ev.status}>{ev.status}</span>}
                    </div>
                    <p className="timeline-title">
                      {ev.type === "medication"
                        ? ev.name || "Medicamento"
                        : `${ev.specialty || "Sin especialidad"} - ${ev.center || "Centro no definido"}`}
                    </p>
                    <p className="timeline-meta">
                      {ev.type === "medication"
                        ? `${ev.dose || ""} ${ev.frequency || "Segun indicacion"}`.trim()
                        : ev.date_time
                        ? toLocaleDateTimeOrEmpty(ev.date_time) || "Por agendar"
                        : "Por agendar"}
                    </p>
                    {ev.notes && <p className="timeline-notes">Notas: {ev.notes}</p>}
                    {ev.type === "medication" && ev.end_date && (
                      <p className="timeline-meta">
                        Hasta {toLocaleDateOrEmpty(ev.end_date)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="floating-actions">
              <Link className="primary-btn" to="/appointments">
                Agregar actividad desde el calendario
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
