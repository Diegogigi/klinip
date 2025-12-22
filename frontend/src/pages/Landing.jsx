import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLandingStats } from "../api";

const legacyStats = [
  { value: "1,200+", label: "Usuarios registrados" },
  { value: "15,000+", label: "Citas gestionadas" },
  { value: "50,000+", label: "Recordatorios enviados" },
  { value: "98%", label: "Satisfacción" },
];

const fallbackStats = {
  users: 1200,
  appointments: 15000,
  reminders: 50000,
  satisfaction: 98,
};

const formatCount = (value) =>
  `${new Intl.NumberFormat("en-US").format(value)}+`;
const formatPercent = (value) => `${value}%`;

const features = [
  {
    title: "Asistente de IA en salud",
    desc: "Recomendaciones y alertas inteligentes para citas, documentos y medicación.",
    icon: "🤖",
  },
  {
    title: "Calendario unificado",
    desc: "Citas y medicamentos en una sola vista, con colores y notificaciones push.",
    icon: "🗓️",
  },
  {
    title: "Documentos siempre a mano",
    desc: "Resultados, recetas e informes seguros y accesibles en cualquier dispositivo.",
    icon: "📂",
  },
  {
    title: "Seguimiento integral",
    desc: "Historial clínico y línea de tiempo para compartir con tu médico.",
    icon: "📈",
  },
];

export default function Landing() {
  const [stats, setStats] = useState(fallbackStats);

  useEffect(() => {
    let mounted = true;
    getLandingStats()
      .then((data) => {
        if (!mounted || !data) return;
        setStats({
          users: data.users ?? fallbackStats.users,
          appointments: data.appointments ?? fallbackStats.appointments,
          reminders: data.reminders ?? fallbackStats.reminders,
          satisfaction: data.satisfaction ?? fallbackStats.satisfaction,
        });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const statItems = [
    { value: formatCount(stats.users), label: "Usuarios registrados" },
    { value: formatCount(stats.appointments), label: "Citas gestionadas" },
    { value: formatCount(stats.reminders), label: "Recordatorios enviados" },
    { value: formatPercent(stats.satisfaction), label: "SatisfacciÇün" },
  ];

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-logo">
          <span className="landing-logo-mark">K</span>
          <span>Klinip</span>
        </div>
        <div className="landing-nav-actions">
          <Link to="/login" className="ghost-link">
            Iniciar sesión
          </Link>
          <Link to="/register" className="primary-btn">
            Crear cuenta
          </Link>
        </div>
      </header>

      <div className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-badge">Asistente clínico inteligente</div>
          <h1>
            Gestión médica con apoyo de IA
            <br />
            para familias y profesionales.
          </h1>
          <p>
            Agenda, recordatorios push, calendario unificado, documentos seguros y medicamentos en un solo lugar. Klinip te
            acompaña para que nada se pase por alto.
          </p>
          <div className="landing-actions">
            <Link className="primary-btn" to="/register">
              Comenzar gratis
            </Link>
          </div>
          <div className="landing-stats">
            {statItems.map((s) => (
              <div key={s.label} className="landing-stat">
                <span className="landing-stat-value">{s.value}</span>
                <span className="landing-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="landing-hero-visual">
          <div className="landing-glow" />
          <div className="landing-screen">
            <div className="landing-screen-header">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
              <span className="landing-screen-title">Klinip • Salud</span>
            </div>
            <div className="landing-screen-body">
              <div className="landing-chip">Calendario · Hoy</div>
              <div className="landing-tile">
                <div>
                  <p className="landing-tile-title">Consulta cardiología</p>
                  <p className="landing-tile-meta">12:00 - Centro Salud Norte</p>
                </div>
                <span className="chip-status-agendada">Agendada</span>
              </div>
              <div className="landing-tile">
                <div>
                  <p className="landing-tile-title">Tomar medicación</p>
                  <p className="landing-tile-meta">08:00 · Amlodipino 5mg</p>
                </div>
                <span className="chip-status-pendiente">Recordar</span>
              </div>
              <div className="landing-tile ghost">
                <div>
                  <p className="landing-tile-title">Subir examen</p>
                  <p className="landing-tile-meta">Resultados laboratorio</p>
                </div>
                <span className="chip">Documento</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="landing-section">
        <div className="landing-section-header">
          <h2>Todo lo que necesitas en una sola plataforma</h2>
          <p>Funciones clave de Klinip para tu ruta de salud.</p>
        </div>
        <div className="landing-cards">
          {features.map((f) => (
            <div key={f.title} className="landing-card">
              <div className="landing-card-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
