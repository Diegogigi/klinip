import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLandingStats } from "../api";

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
    { value: formatPercent(stats.satisfaction), label: "Satisfacción" },
  ];

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-logo">
          <span className="landing-logo-mark">K</span>
          <span>Klinip</span>
        </div>
        <div className="landing-nav-actions">
          <Link to="/login" className="landing-btn-ghost">
            Iniciar sesión
          </Link>
          <Link to="/register" className="landing-btn-primary">
            Crear cuenta
          </Link>
        </div>
      </header>

      <div className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            Asistente clínico inteligente
          </div>
          <h1>
            Tu salud organizada
            <br />
            <span className="landing-hero-gradient">en un solo lugar</span>
          </h1>
          <p className="landing-hero-description">
            Klinip es tu compañero digital de salud. Organiza tus <strong>citas médicas</strong>, 
            gestiona tu <strong>medicación</strong>, almacena <strong>documentos</strong> importantes 
            y mantén un <strong>historial completo</strong> de tu salud. Todo sincronizado, 
            seguro y siempre disponible.
          </p>
          <div className="landing-actions">
            <Link className="landing-btn-cta" to="/register">
              <span>Comenzar gratis</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <Link className="landing-btn-secondary" to="/login">
              Ya tengo cuenta
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
          <h2>Todo lo que necesitas para cuidar tu salud</h2>
          <p>Funciones diseñadas para simplificar la gestión de tu salud y la de tu familia.</p>
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

      <section className="landing-cta-section">
        <div className="landing-cta-content">
          <h2>Comienza a organizar tu salud hoy</h2>
          <p>Únete a miles de personas que ya confían en Klinip para gestionar su salud.</p>
          <div className="landing-cta-actions">
            <Link to="/register" className="landing-btn-cta">
              <span>Crear cuenta gratis</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-content">
          <div className="landing-footer-brand">
            <div className="landing-logo">
              <span className="landing-logo-mark">K</span>
              <span>Klinip</span>
            </div>
            <p>Tu ruta de salud, simplificada</p>
          </div>
          <div className="landing-footer-copy">
            © 2024 Klinip. Todos los derechos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}
