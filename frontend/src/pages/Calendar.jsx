import React, { useEffect, useMemo, useState } from "react";
import { getAppointments } from "../api";

const typeColors = {
  cita: "event-green",
  examen: "event-blue",
  tramite: "event-yellow",
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

export default function Calendar() {
  const [appointments, setAppointments] = useState([]);
  const [viewDate, setViewDate] = useState(new Date());
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    Promise.resolve(getAppointments())
      .then((res) => setAppointments(res || []))
      .catch((err) => {
        console.error("No se pudieron cargar las actividades", err);
        setAppointments([]);
      });
  }, []);

  const normalizedViewDate = useMemo(() => {
    if (viewDate instanceof Date && !Number.isNaN(viewDate.getTime())) return viewDate;
    const parsed = new Date(viewDate);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [viewDate]);

  const monthLabel = normalizedViewDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const days = useMemo(() => getMonthDays(normalizedViewDate), [normalizedViewDate]);

  const eventsByDay = useMemo(() => {
    const map = {};
    (appointments || []).forEach((a) => {
      if (!a?.date_time) return;
      const d = new Date(a.date_time);
      if (Number.isNaN(d.getTime())) return;
      const key = d.toISOString().slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(a);
    });
    return map;
  }, [appointments]);

  const selectedEvents = useMemo(() => {
    if (!selected) return [];
    const key = selected.toISOString().slice(0, 10);
    return eventsByDay[key] || [];
  }, [selected, eventsByDay]);

  return (
    <>
      <div className="card">
        <div className="card-header" style={{ alignItems: "center" }}>
          <h2 className="card-title">Calendario de salud</h2>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button
              className="pill-button"
              type="button"
              onClick={() => setViewDate(addMonths(normalizedViewDate, -1))}
            >
              ← Mes anterior
            </button>
            <div className="month-display">{monthLabel}</div>
            <button
              className="pill-button"
              type="button"
              onClick={() => setViewDate(addMonths(normalizedViewDate, 1))}
            >
              Mes siguiente →
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Vista mensual para citas, exámenes y trámites. Pulsa un día para ver actividades o agrega desde Citas.
        </p>
        <div className="legend">
          <span className="legend-dot event-green" /> Citas
          <span className="legend-dot event-blue" /> Exámenes
          <span className="legend-dot event-yellow" /> Trámites
        </div>
        <div className="calendar">
          {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
            <div key={d} className="calendar-day-header">
              {d}
            </div>
          ))}
          {days.map((day, idx) => {
            const key = day ? day.toISOString().slice(0, 10) : `empty-${idx}`;
            const events = day ? eventsByDay[key] || [] : [];
            const isWeekend = day ? day.getDay() === 0 || day.getDay() === 6 : false;
            const todayKey = new Date().toISOString().slice(0, 10);
            const isToday = day ? key === todayKey : false;
            return (
              <div
                key={key}
                className={`calendar-cell ${day ? "" : "empty"} ${isWeekend ? "calendar-weekend" : ""} ${isToday ? "calendar-today" : ""}`}
                onClick={() => day && setSelected(day)}
              >
                {day && (
                  <>
                    <div className="calendar-date">
                      <span>{day.getDate()}</span>
                    </div>
                    <div className="calendar-events">
                      {events.slice(0, 3).map((ev) => (
                        <span key={ev.id} className={`event-dot ${typeColors[ev.type] || "event-green"}`} />
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
                      <span className={`chip ${ev.type}`}>{ev.type}</span>
                      <span className={`chip-status-${ev.status}`}>{ev.status}</span>
                    </div>
                    <p className="timeline-title">
                      {ev.specialty || "Sin especialidad"} · {ev.center || "Centro no definido"}
                    </p>
                    <p className="timeline-meta">
                      {ev.date_time ? new Date(ev.date_time).toLocaleString() : "Por agendar"}
                    </p>
                    {ev.notes && <p className="timeline-notes">Notas: {ev.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
            <div className="floating-actions">
              <a className="primary-btn" href="/appointments">
                Agregar actividad desde el calendario
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
