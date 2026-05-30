import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  createBiometricReading,
  deleteBiometricReading,
  getActiveHealthProfile,
  getBiometricDashboard,
} from "../api";
import { notifyClinicalDataChanged, subscribeClinicalDataChanged } from "../utils/clinicalRefresh";
import { canWriteProfile } from "../utils/profileAccess";
import {
  BIOMETRIC_METRIC_CONFIG,
  buildBiometricEmptyForm,
  formatBiometricMeasuredAt,
  formatBiometricValue,
  getBiometricLatestMetric,
  getBiometricMetricConfig,
  getBiometricMetricLabel,
  getBiometricTrendLabel,
} from "../utils/biometrics";

const METRIC_OPTIONS = Object.keys(BIOMETRIC_METRIC_CONFIG);

function Sparkline({ points = [], metricType, tone = "blue" }) {
  const values = points
    .map((item) => Number(item?.value_primary))
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    return <div className="bio-spark-empty">Aun sin datos para graficar.</div>;
  }

  if (values.length === 1) {
    return (
      <div className={`bio-spark-single tone-${tone}`}>
        <span>{formatBiometricValue({ value_primary: values[0] }, metricType)}</span>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 44 - ((value - min) / range) * 36;
    return `${x},${y}`;
  });
  const latest = values[values.length - 1];

  return (
    <div className={`bio-spark tone-${tone}`}>
      <svg viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`bio-spark-${metricType}-${tone}`} x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <path
          d={`M 0 48 L ${coords.join(" ")} L 100 48 Z`}
          fill={`url(#bio-spark-${metricType}-${tone})`}
          stroke="none"
        />
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={coords[coords.length - 1].split(",")[0]} cy={coords[coords.length - 1].split(",")[1]} r="2.8" fill="currentColor" />
      </svg>
      <div className="bio-spark-meta">
        <span>{formatBiometricValue({ value_primary: latest }, metricType)}</span>
        <small>{values.length} registros</small>
      </div>
    </div>
  );
}

function MetricIcon({ metricType }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  if (metricType === "blood_pressure") {
    return (
      <svg {...common}>
        <path d="M6 13c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M8 13h8" />
        <path d="M12 13v5" />
        <path d="M9 18h6" />
      </svg>
    );
  }
  if (metricType === "heart_rate") {
    return (
      <svg {...common}>
        <path d="M22 12h-4l-2.2 5L10 7 7.5 12H2" />
      </svg>
    );
  }
  if (metricType === "temperature") {
    return (
      <svg {...common}>
        <path d="M14 14.7V5a2 2 0 0 0-4 0v9.7a4 4 0 1 0 4 0Z" />
        <path d="M12 9v7" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M6.5 12.5h11" />
      <path d="M8 16.5h8" />
      <path d="M8 8.5h8" />
      <rect x="4" y="5" width="16" height="14" rx="4" />
    </svg>
  );
}

export default function Biometrics() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [activeProfile, setActiveProfile] = useState(null);
  const [form, setForm] = useState(() => buildBiometricEmptyForm());

  const canEdit = canWriteProfile(activeProfile);

  const loadDashboard = useCallback(async () => {
    const [profileResponse, dashboardResponse] = await Promise.all([
      getActiveHealthProfile().catch(() => null),
      getBiometricDashboard().catch(() => null),
    ]);
    setActiveProfile(profileResponse || null);
    setDashboard(dashboardResponse || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDashboard().catch(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });
    const unsubscribe = subscribeClinicalDataChanged(() => {
      loadDashboard().catch(() => {});
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadDashboard]);

  useEffect(() => {
    setForm((prev) => {
      const config = getBiometricMetricConfig(prev.metric_type);
      return {
        ...prev,
        unit: config.unit,
      };
    });
  }, [form.metric_type]);

  const metrics = dashboard?.metrics || [];
  const recentReadings = dashboard?.recent_readings || [];
  const latestMetric = useMemo(() => getBiometricLatestMetric(metrics), [metrics]);

  const handleMetricChange = (metricType) => {
    setForm((prev) => ({
      ...buildBiometricEmptyForm(metricType),
      measured_at: prev.measured_at || buildBiometricEmptyForm(metricType).measured_at,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      await createBiometricReading({
        ...form,
        value_primary: Number(form.value_primary),
        value_secondary:
          form.metric_type === "blood_pressure" && form.value_secondary !== ""
            ? Number(form.value_secondary)
            : null,
        measured_at: form.measured_at || null,
      });
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["biometrics"],
      });
      setForm(buildBiometricEmptyForm(form.metric_type));
      await loadDashboard();
    } catch (error) {
      window.alert(error?.response?.data?.detail || "No pudimos guardar el registro biometrico.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (readingId) => {
    if (!canEdit || !readingId || deletingId) return;
    if (!window.confirm("¿Eliminar este registro biométrico?")) return;
    setDeletingId(readingId);
    try {
      await deleteBiometricReading(readingId);
      notifyClinicalDataChanged({
        profileId: activeProfile?.id,
        sources: ["biometrics"],
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error?.response?.data?.detail || "No pudimos eliminar el registro.");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="bio-page">
        <div className="bio-loading">
          <div className="bio-loading-pulse" />
          <span>Cargando tu panel de biométricos...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bio-page">
      <section className="bio-hero-card">
        <div className="bio-hero-copy">
          <span className="bio-eyebrow">Mi salud · Parámetros biométricos</span>
          <h1 className="bio-title">Monitorea tus controles frecuentes en un solo panel</h1>
          <p className="bio-subtitle">
            Registra glucosa, presión arterial, frecuencia cardiaca o temperatura para revisar cambios y compartirlos en consulta.
          </p>
          <div className="bio-hero-actions">
            <Link to="/mi-salud" className="bio-ghost-link">
              Volver a Mi salud
            </Link>
            <Link to="/timeline" className="bio-ghost-link">
              Ver historial clínico
            </Link>
          </div>
        </div>
        <div className="bio-hero-summary">
          <div className="bio-hero-stat">
            <small>Perfil activo</small>
            <strong>{activeProfile?.full_name || "Mi perfil"}</strong>
          </div>
          <div className="bio-hero-stat">
            <small>Parámetros en seguimiento</small>
            <strong>{dashboard?.active_metrics_count || 0}</strong>
          </div>
          <div className="bio-hero-stat">
            <small>Último registro</small>
            <strong>
              {latestMetric?.latest_reading
                ? formatBiometricMeasuredAt(
                    latestMetric.latest_reading.measured_at || latestMetric.latest_reading.created_at
                  )
                : "Sin registros"}
            </strong>
          </div>
          <div className="bio-hero-stat bio-hero-stat-highlight">
            <small>Resumen</small>
            <strong>
              {latestMetric?.latest_reading
                ? `${latestMetric.label}: ${formatBiometricValue(latestMetric.latest_reading)}`
                : "Comienza tu monitoreo"}
            </strong>
          </div>
        </div>
      </section>

      {!canEdit ? (
        <div className="bio-readonly-banner">
          Estás revisando un perfil en modo lectura. Puedes ver las tendencias, pero no registrar nuevos parámetros desde aquí.
        </div>
      ) : null}

      <section className="bio-top-grid">
        <article className="bio-panel-card bio-form-card">
          <div className="bio-panel-head">
            <div>
              <h2 className="bio-panel-title">Nuevo registro</h2>
              <p className="bio-panel-subtitle">Guarda cada medición con fecha, contexto y unidad.</p>
            </div>
          </div>

          <div className="bio-metric-switch" role="tablist" aria-label="Tipo de parametro">
            {METRIC_OPTIONS.map((metricType) => {
              const config = getBiometricMetricConfig(metricType);
              return (
                <button
                  key={metricType}
                  type="button"
                  className={`bio-metric-pill${form.metric_type === metricType ? " is-active" : ""}`}
                  onClick={() => handleMetricChange(metricType)}
                >
                  <MetricIcon metricType={metricType} />
                  <span>{config.shortLabel}</span>
                </button>
              );
            })}
          </div>

          <form className="bio-form" onSubmit={handleSubmit}>
            <div className="bio-form-grid">
              <label className="bio-field">
                <span>{form.metric_type === "blood_pressure" ? "Sistólica" : "Valor"}</span>
                <input
                  type="number"
                  step={form.metric_type === "temperature" ? "0.1" : "1"}
                  value={form.value_primary}
                  onChange={(event) => setForm((prev) => ({ ...prev, value_primary: event.target.value }))}
                  placeholder={form.metric_type === "temperature" ? "36.5" : "0"}
                  required
                  disabled={!canEdit || saving}
                />
              </label>

              {form.metric_type === "blood_pressure" ? (
                <label className="bio-field">
                  <span>Diastólica</span>
                  <input
                    type="number"
                    step="1"
                    value={form.value_secondary}
                    onChange={(event) => setForm((prev) => ({ ...prev, value_secondary: event.target.value }))}
                    placeholder="0"
                    required
                    disabled={!canEdit || saving}
                  />
                </label>
              ) : (
                <label className="bio-field">
                  <span>Unidad</span>
                  <input
                    type="text"
                    value={form.unit}
                    onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}
                    disabled={!canEdit || saving}
                  />
                </label>
              )}

              <label className="bio-field">
                <span>Fecha y hora</span>
                <input
                  type="datetime-local"
                  value={form.measured_at}
                  onChange={(event) => setForm((prev) => ({ ...prev, measured_at: event.target.value }))}
                  required
                  disabled={!canEdit || saving}
                />
              </label>

              <label className="bio-field">
                <span>Contexto</span>
                <input
                  type="text"
                  value={form.context}
                  onChange={(event) => setForm((prev) => ({ ...prev, context: event.target.value }))}
                  placeholder="Ej. ayunas, reposo, antes de dormir"
                  disabled={!canEdit || saving}
                />
              </label>
            </div>

            <label className="bio-field">
              <span>Notas</span>
              <textarea
                rows="3"
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Agrega una observacion breve si necesitas contexto para la consulta."
                disabled={!canEdit || saving}
              />
            </label>

            <div className="bio-form-actions">
              <button type="submit" className="bio-primary-btn" disabled={!canEdit || saving}>
                {saving ? "Guardando..." : "Guardar registro"}
              </button>
              <span className="bio-form-hint">
                {getBiometricMetricLabel(form.metric_type)} · {getBiometricMetricConfig(form.metric_type).unit}
              </span>
            </div>
          </form>
        </article>

        <article className="bio-panel-card bio-insights-card">
          <div className="bio-panel-head">
            <div>
              <h2 className="bio-panel-title">Lectura rápida</h2>
              <p className="bio-panel-subtitle">Explicación simple para tener tus datos a mano.</p>
            </div>
          </div>
          <div className="bio-insights-list">
            {(dashboard?.insights || []).map((item, index) => (
              <div key={`${item}-${index}`} className="bio-insight-item">
                <span className="bio-insight-dot" />
                <p>{item}</p>
              </div>
            ))}
          </div>
          <div className="bio-insights-note">
            Este panel describe tendencias y continuidad de registros. No reemplaza la interpretación de un profesional.
          </div>
        </article>
      </section>

      <section className="bio-metrics-grid">
        {metrics.map((metric) => {
          const config = getBiometricMetricConfig(metric.metric_type);
          const latestReading = metric.latest_reading;
          return (
            <article
              key={metric.metric_type}
              className={`bio-panel-card bio-metric-card tone-${config.tone}`}
            >
              <div className="bio-metric-card-head">
                <span className={`bio-metric-icon tone-${config.tone}`}>
                  <MetricIcon metricType={metric.metric_type} />
                </span>
                <div>
                  <h2 className="bio-panel-title">{metric.label}</h2>
                  <p className="bio-panel-subtitle">{metric.description}</p>
                </div>
              </div>

              <div className="bio-metric-readout">
                <strong>{latestReading ? formatBiometricValue(latestReading) : `Sin registros ${config.unit}`.trim()}</strong>
                <span>
                  {latestReading
                    ? `Ultimo: ${formatBiometricMeasuredAt(
                        latestReading.measured_at || latestReading.created_at
                      )}`
                    : "Aun no has guardado mediciones."}
                </span>
              </div>

              <Sparkline points={metric.chart_points} metricType={metric.metric_type} tone={config.tone} />

              <div className="bio-metric-footer">
                <span className={`bio-trend-chip tone-${config.tone}`}>
                  {getBiometricTrendLabel(metric.trend_direction)}
                </span>
                <small>{metric.trend_summary}</small>
              </div>
            </article>
          );
        })}
      </section>

      <section className="bio-panel-card bio-recent-card">
        <div className="bio-panel-head">
          <div>
            <h2 className="bio-panel-title">Historial reciente</h2>
            <p className="bio-panel-subtitle">Tus últimas mediciones para revisar y compartir.</p>
          </div>
        </div>

        {recentReadings.length ? (
          <div className="bio-recent-list">
            {recentReadings.map((item) => {
              const config = getBiometricMetricConfig(item.metric_type);
              return (
                <div key={item.id} className="bio-recent-row">
                  <span className={`bio-recent-icon tone-${config.tone}`}>
                    <MetricIcon metricType={item.metric_type} />
                  </span>
                  <div className="bio-recent-copy">
                    <strong>{getBiometricMetricLabel(item.metric_type)}</strong>
                    <span>{formatBiometricValue(item)}</span>
                    <small>
                      {formatBiometricMeasuredAt(item.measured_at || item.created_at)}
                      {item.context ? ` · ${item.context}` : ""}
                      {item.notes ? ` · ${item.notes}` : ""}
                    </small>
                  </div>
                  {canEdit ? (
                    <button
                      type="button"
                      className="bio-delete-btn"
                      onClick={() => handleDelete(item.id)}
                      disabled={deletingId === item.id}
                    >
                      {deletingId === item.id ? "Eliminando..." : "Eliminar"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bio-empty-state">
            Aun no tienes registros biométricos. Empieza por el parámetro que necesites monitorear con más frecuencia.
          </div>
        )}
      </section>
    </div>
  );
}

