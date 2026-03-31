import React, { useEffect, useMemo, useState } from "react";
import { getAppointments, getDocuments, getMedications, isAuthSessionError } from "../api";
import { parseDate } from "../utils/dates";

function RingChart({ value, label, tone = "blue" }) {
  const safeValue = Math.max(0, Math.min(100, Number(value || 0)));
  const style = {
    "--ring-value": `${safeValue}%`,
  };
  return (
    <div className={`stats-ring-card tone-${tone}`}>
      <div className="stats-ring" style={style} aria-hidden="true">
        <span>{safeValue}%</span>
      </div>
      <p>{label}</p>
    </div>
  );
}

function BarChart({ data }) {
  const max = Math.max(1, ...data.map((item) => Number(item.value || 0)));
  return (
    <div className="stats-mini-bars">
      {data.map((item) => {
        const pct = Math.round((Number(item.value || 0) / max) * 100);
        return (
          <div key={item.label} className="stats-mini-bar-row">
            <span className="stats-mini-bar-label">{item.label}</span>
            <div className="stats-mini-bar-track">
              <span style={{ width: `${pct}%` }} />
            </div>
            <strong>{item.value}</strong>
          </div>
        );
      })}
    </div>
  );
}

export default function Stats() {
  const [appointments, setAppointments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [medications, setMedications] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const [apptData, docData, medData] = await Promise.all([
          getAppointments(),
          getDocuments(),
          getMedications(),
        ]);
        setAppointments(apptData || []);
        setDocuments(docData || []);
        setMedications(medData || []);
      } catch (error) {
        if (!isAuthSessionError(error)) {
          console.error("No se pudieron cargar las estadísticas", error);
        }
        setAppointments([]);
        setDocuments([]);
        setMedications([]);
      }
    }
    load();
  }, []);

  const stats = useMemo(() => {
    const now = new Date();
    const plus30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const appointmentsTotal = appointments.length;
    const appointmentsPending = appointments.filter((a) => a.status === "pendiente").length;
    const appointmentsScheduled = appointments.filter((a) => a.status === "agendada").length;
    const appointmentsDone = appointments.filter((a) => a.status === "realizada").length;
    const appointmentsWithDate = appointments.filter((a) => parseDate(a.date_time)).length;
    const appointmentsOverdue = appointments.filter((a) => {
      const when = parseDate(a.date_time);
      if (!when) return false;
      return when < now && a.status !== "realizada";
    }).length;
    const appointmentsNext30 = appointments.filter((a) => {
      const when = parseDate(a.date_time);
      if (!when) return false;
      return when >= now && when <= plus30;
    }).length;

    const documentsTotal = documents.length;
    const ocrDone = documents.filter((d) => d.ocr_status === "done").length;
    const ocrPending = documents.filter(
      (d) => d.ocr_status === "pending" || d.ocr_status === "processing"
    ).length;
    const ocrError = documents.filter(
      (d) => (d.ocr_status || "").startsWith("error") || d.ocr_status === "skipped_size"
    ).length;
    const docsByType = {
      receta: documents.filter((d) => d.doc_type === "receta").length,
      orden: documents.filter((d) => d.doc_type === "orden").length,
      resultado: documents.filter((d) => d.doc_type === "resultado").length,
      informe: documents.filter((d) => d.doc_type === "informe").length,
      otro: documents.filter((d) => d.doc_type === "otro").length,
    };

    const medicationsTotal = medications.length;
    const medicationsDone = medications.filter((m) => Boolean(m.completed)).length;
    const medicationsActive = medications.filter((m) => !m.completed).length;
    const medicationsMissingFrequency = medications.filter(
      (m) => !m.frequency || !m.frequency.trim()
    ).length;
    const medicationsWithSchedule = medications.filter((m) => Boolean(m.schedule_time)).length;
    const medicationsTaken = medications.reduce(
      (acc, m) => acc + Number(m.taken_doses || 0),
      0
    );
    const medicationsExpected = medications.reduce(
      (acc, m) => acc + Number(m.expected_doses || 0),
      0
    );

    const timelineEvents = appointmentsWithDate + documentsTotal + medicationsTotal;
    const allRecords = appointmentsTotal + documentsTotal + medicationsTotal;
    const appointmentCompletionPct = appointmentsTotal
      ? Math.round((appointmentsDone / appointmentsTotal) * 100)
      : 0;
    const calendarCoveragePct = appointmentsTotal
      ? Math.round((appointmentsWithDate / appointmentsTotal) * 100)
      : 0;
    const ocrReadyPct = documentsTotal ? Math.round((ocrDone / documentsTotal) * 100) : 0;
    const medsAdherencePct = medicationsExpected
      ? Math.min(100, Math.round((medicationsTaken / medicationsExpected) * 100))
      : 0;

    return {
      allRecords,
      timelineEvents,
      appointments: {
        total: appointmentsTotal,
        pending: appointmentsPending,
        scheduled: appointmentsScheduled,
        done: appointmentsDone,
        overdue: appointmentsOverdue,
        next30: appointmentsNext30,
      },
      documents: {
        total: documentsTotal,
        byType: docsByType,
        ocrDone,
        ocrPending,
        ocrError,
      },
      medications: {
        total: medicationsTotal,
        done: medicationsDone,
        active: medicationsActive,
        missingFrequency: medicationsMissingFrequency,
        withSchedule: medicationsWithSchedule,
        taken: medicationsTaken,
        expected: medicationsExpected,
      },
      percentages: {
        appointmentCompletion: appointmentCompletionPct,
        calendarCoverage: calendarCoveragePct,
        ocrReady: ocrReadyPct,
        medsAdherence: medsAdherencePct,
      },
    };
  }, [appointments, documents, medications]);

  return (
    <div className="stats-page">
      <section className="card stats-hero">
        <h2 className="stats-hero-title">Estadisticas de mi salud</h2>
        <p className="stats-hero-sub">
          Linea de tiempo cuantificable de citas, examenes, documentos y medicamentos.
        </p>

        <div className="stats-kpi-grid">
          <article className="stats-kpi kpi-appointments">
            <strong>{stats.appointments.total}</strong>
            <span>Citas</span>
          </article>
          <article className="stats-kpi kpi-documents">
            <strong>{stats.documents.total}</strong>
            <span>Documentos</span>
          </article>
          <article className="stats-kpi kpi-medications">
            <strong>{stats.medications.total}</strong>
            <span>Medicamentos</span>
          </article>
          <article className="stats-kpi kpi-total">
            <strong>{stats.timelineEvents}</strong>
            <span>Total</span>
          </article>
        </div>
      </section>

      <section className="card stats-charts">
        <div className="stats-rings">
          <RingChart value={stats.percentages.calendarCoverage} label="Cobertura calendario" tone="blue" />
          <RingChart value={stats.percentages.ocrReady} label="OCR listo" tone="amber" />
          <RingChart value={stats.percentages.appointmentCompletion} label="Citas realizadas" tone="green" />
          <RingChart value={stats.percentages.medsAdherence} label="Adherencia meds" tone="violet" />
        </div>
      </section>

      <section className="stats-panels">
        <article className="card stats-panel">
          <h3>Citas y calendario</h3>
          <BarChart
            data={[
              { label: "Pendientes", value: stats.appointments.pending },
              { label: "Agendadas", value: stats.appointments.scheduled },
              { label: "Realizadas", value: stats.appointments.done },
              { label: "Prox. 30 dias", value: stats.appointments.next30 },
              { label: "Vencidas", value: stats.appointments.overdue },
            ]}
          />
        </article>

        <article className="card stats-panel">
          <h3>Documentos</h3>
          <BarChart
            data={[
              { label: "Recetas", value: stats.documents.byType.receta },
              { label: "Ordenes", value: stats.documents.byType.orden },
              { label: "Resultados", value: stats.documents.byType.resultado },
              { label: "Informes", value: stats.documents.byType.informe },
              { label: "Otros", value: stats.documents.byType.otro },
            ]}
          />
          <div className="stats-tag-row">
            <span className="badge">OCR listo: {stats.documents.ocrDone}</span>
            <span className="badge">Pendiente: {stats.documents.ocrPending}</span>
            <span className="badge">Error: {stats.documents.ocrError}</span>
          </div>
        </article>

        <article className="card stats-panel">
          <h3>Medicamentos</h3>
          <BarChart
            data={[
              { label: "Activos", value: stats.medications.active },
              { label: "Realizados", value: stats.medications.done },
              { label: "Con horario", value: stats.medications.withSchedule },
              { label: "Sin frecuencia", value: stats.medications.missingFrequency },
              { label: "Tomas", value: stats.medications.taken },
            ]}
          />
          <p className="muted stats-foot">
            Tomas esperadas: <strong>{stats.medications.expected}</strong>
          </p>
        </article>
      </section>

      <section className="card stats-bottom">
        <div className="stats-bottom-item">
          <span>Registros totales</span>
          <strong>{stats.allRecords}</strong>
        </div>
        <div className="stats-bottom-item">
          <span>Eventos en historia</span>
          <strong>{stats.timelineEvents}</strong>
        </div>
      </section>
    </div>
  );
}
