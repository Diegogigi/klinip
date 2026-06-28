import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  createBiometricReading,
  deleteBiometricReading,
  getActiveHealthProfile,
  getBiometricDashboard,
} from "../api";
import useMobileOverlayLock from "../hooks/useMobileOverlayLock";
import {
  notifyClinicalDataChanged,
  subscribeClinicalDataChanged,
} from "../utils/clinicalRefresh";
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
import SuccessSheet from "../components/SuccessSheet";

const METRIC_OPTIONS = Object.keys(BIOMETRIC_METRIC_CONFIG);
const TONE_COLORS = {
  blue: "#2563eb",
  violet: "#7c3aed",
  teal: "#0891b2",
  amber: "#d97706",
  slate: "#64748b",
};

function Sparkline({ points = [], metricType, tone = "blue" }) {
  const values = points
    .map((item) => Number(item?.value_primary))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return <div className="bio-spark-empty">Aún sin datos para graficar.</div>;
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
  const lastCoord = coords[coords.length - 1]?.split(",") || ["100", "24"];

  return (
    <div className={`bio-spark tone-${tone}`}>
      <svg viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient
            id={`bio-spark-${metricType}-${tone}`}
            x1="0%"
            x2="100%"
            y1="0%"
            y2="0%"
          >
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
        <circle cx={lastCoord[0]} cy={lastCoord[1]} r="2.8" fill="currentColor" />
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

function buildMetricShell(metricType, metric = null) {
  const config = getBiometricMetricConfig(metricType);
  return (
    metric || {
      metric_type: metricType,
      label: config.label,
      description: config.description,
      latest_reading: null,
      chart_points: [],
      readings_count: 0,
      average_primary: null,
      trend_direction: "stable",
      trend_summary: `Aún no has registrado ${config.label.toLowerCase()}.`,
    }
  );
}

function getMetricNumericValues(metric) {
  return (metric?.chart_points || [])
    .map((item) => Number(item?.value_primary))
    .filter((value) => Number.isFinite(value));
}

function getMetricPosition(metric) {
  const values = getMetricNumericValues(metric);
  const latestValue = Number(metric?.latest_reading?.value_primary);
  if (!Number.isFinite(latestValue)) return 48;
  const source = values.length ? values : [latestValue];
  const min = Math.min(...source);
  const max = Math.max(...source);
  if (max === min) return 52;
  return 12 + ((latestValue - min) / (max - min)) * 76;
}

function getMetricAverageLabel(metric) {
  if (metric?.average_primary === null || metric?.average_primary === undefined) {
    return "Sin base";
  }
  return formatBiometricValue(
    {
      value_primary: metric.average_primary,
      value_secondary: metric.latest_reading?.value_secondary ?? null,
    },
    metric.metric_type
  );
}

function splitDisplayValue(reading, metricType) {
  if (!reading) {
    return { value: "--", unit: getBiometricMetricConfig(metricType).unit };
  }

  if (metricType === "blood_pressure") {
    const systolic = Math.round(Number(reading.value_primary || 0));
    const diastolic =
      reading.value_secondary === null || reading.value_secondary === undefined
        ? null
        : Math.round(Number(reading.value_secondary || 0));
    return {
      value: diastolic !== null ? `${systolic}/${diastolic}` : `${systolic}`,
      unit: getBiometricMetricConfig(metricType).unit,
    };
  }

  if (metricType === "temperature") {
    return {
      value: Number(reading.value_primary || 0).toFixed(1),
      unit: getBiometricMetricConfig(metricType).unit,
    };
  }

  return {
    value: `${Math.round(Number(reading.value_primary || 0))}`,
    unit: getBiometricMetricConfig(metricType).unit,
  };
}

function buildUnifiedMetricPath(metric) {
  const points = getMetricNumericValues(metric);
  if (!points.length) return null;
  if (points.length === 1) {
    return {
      linePath: null,
      areaPath: null,
      points: [{ x: 50, y: 30 }],
    };
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const coords = points.map((value, index) => ({
    x: (index / (points.length - 1)) * 100,
    y: 56 - ((value - min) / range) * 42,
  }));

  // Curva suave con Catmull-Rom convertida a Bezier
  const smoothPath = coords.reduce((acc, point, i) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    const prev = coords[i - 1];
    const next = coords[i + 1] || point;
    const beforePrev = coords[i - 2] || prev;
    const cp1x = prev.x + (point.x - beforePrev.x) / 6;
    const cp1y = prev.y + (point.y - beforePrev.y) / 6;
    const cp2x = point.x - (next.x - prev.x) / 6;
    const cp2y = point.y - (next.y - prev.y) / 6;
    return `${acc} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${point.x} ${point.y}`;
  }, "");

  const areaPath = `${smoothPath} L 100 64 L 0 64 Z`;

  return {
    linePath: smoothPath,
    areaPath,
    points: coords,
  };
}

function UnifiedMetricsChart({ metrics = [] }) {
  const chartMetrics = metrics
    .map((metric) => {
      const chart = buildUnifiedMetricPath(metric);
      return chart
        ? {
            metric,
            chart,
            color: TONE_COLORS[getBiometricMetricConfig(metric.metric_type).tone] || TONE_COLORS.slate,
          }
        : null;
    })
    .filter(Boolean);

  if (!chartMetrics.length) {
    return <div className="bio-unified-chart-empty">Registra mediciones para ver el panorama general.</div>;
  }

  // Etiquetas temporales para el eje X
  const timeLabels = ["7d", "5d", "3d", "1d", "Hoy"];

  return (
    <div className="bio-unified-chart">
      <div className="bio-unified-chart-stage">
        <svg viewBox="0 0 100 64" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            {chartMetrics.map(({ metric, color }) => (
              <linearGradient
                key={`grad-${metric.metric_type}`}
                id={`bio-area-${metric.metric_type}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {/* Grid muy sutil */}
          {[14, 28, 42, 56].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              className="bio-unified-chart-grid"
            />
          ))}

          {/* Áreas con gradiente */}
          {chartMetrics.map(({ metric, chart }) =>
            chart.areaPath ? (
              <path
                key={`area-${metric.metric_type}`}
                d={chart.areaPath}
                fill={`url(#bio-area-${metric.metric_type})`}
              />
            ) : null
          )}

          {/* Líneas suaves */}
          {chartMetrics.map(({ metric, chart, color }) =>
            chart.linePath ? (
              <path
                key={`line-${metric.metric_type}`}
                d={chart.linePath}
                fill="none"
                stroke={color}
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null
          )}

          {/* Punto final destacado */}
          {chartMetrics.map(({ metric, chart, color }) => {
            const last = chart.points[chart.points.length - 1];
            if (!last) return null;
            return (
              <g key={`last-${metric.metric_type}`}>
                <circle cx={last.x} cy={last.y} r="2.6" fill="#fff" />
                <circle cx={last.x} cy={last.y} r="1.8" fill={color} />
              </g>
            );
          })}
        </svg>

        <div className="bio-unified-chart-xaxis">
          {timeLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>

      <div className="bio-unified-chart-legend">
        {chartMetrics.map(({ metric, color }) => (
          <div key={metric.metric_type} className="bio-unified-chart-legend-item">
            <span className="bio-unified-chart-swatch" style={{ backgroundColor: color }} />
            <div>
              <strong>{metric.label}</strong>
              <small>
                {metric.latest_reading
                  ? formatBiometricValue(metric.latest_reading, metric.metric_type)
                  : "Sin registros"}
              </small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailSummaryCards({ metric }) {
  return (
    <div className="bio-detail-stats">
      <div className="bio-detail-stat-card">
        <small>Promedio reciente</small>
        <strong>{getMetricAverageLabel(metric)}</strong>
      </div>
      <div className="bio-detail-stat-card">
        <small>Tendencia</small>
        <strong>{getBiometricTrendLabel(metric?.trend_direction)}</strong>
      </div>
      <div className="bio-detail-stat-card">
        <small>Registros</small>
        <strong>{metric?.readings_count || 0}</strong>
      </div>
    </div>
  );
}

export default function Biometrics() {
  const navigate = useNavigate();
  const { metricType: routeMetricType } = useParams();
  const normalizedRouteMetricType = METRIC_OPTIONS.includes(routeMetricType) ? routeMetricType : null;
  const isMetricDetail = Boolean(normalizedRouteMetricType);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [entrySuccess, setEntrySuccess] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [activeProfile, setActiveProfile] = useState(null);
  const [form, setForm] = useState(() =>
    buildBiometricEmptyForm(normalizedRouteMetricType || "glucose")
  );
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);

  const canEdit = canWriteProfile(activeProfile);
  useMobileOverlayLock(isEntryModalOpen);

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
    if (!isEntryModalOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsEntryModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEntryModalOpen]);

  const metrics = dashboard?.metrics || [];
  const recentReadings = dashboard?.recent_readings || [];
  const latestMetric = useMemo(() => getBiometricLatestMetric(metrics), [metrics]);
  const summaryMetrics = useMemo(
    () =>
      METRIC_OPTIONS.map((metricType) =>
        buildMetricShell(metricType, metrics.find((item) => item.metric_type === metricType))
      ),
    [metrics]
  );
  const summaryMetricsWithData = useMemo(
    () => summaryMetrics.filter((metric) => Number(metric?.readings_count || 0) > 0),
    [summaryMetrics]
  );

  const selectedMetric = useMemo(() => {
    const sourceMetricType = normalizedRouteMetricType || latestMetric?.metric_type || "glucose";
    return buildMetricShell(
      sourceMetricType,
      metrics.find((item) => item.metric_type === sourceMetricType)
    );
  }, [latestMetric?.metric_type, metrics, normalizedRouteMetricType]);

  const selectedMetricConfig = getBiometricMetricConfig(selectedMetric.metric_type);
  const selectedDisplayValue = splitDisplayValue(
    selectedMetric?.latest_reading || null,
    selectedMetric.metric_type
  );
  const filteredRecentReadings = recentReadings.filter(
    (item) => !isMetricDetail || item.metric_type === normalizedRouteMetricType
  );
  const latestMetricConfig = getBiometricMetricConfig(latestMetric?.metric_type || "glucose");
  const formConfig = getBiometricMetricConfig(form.metric_type);

  useEffect(() => {
    if (normalizedRouteMetricType) {
      setForm((prev) => ({
        ...buildBiometricEmptyForm(normalizedRouteMetricType),
        measured_at: prev.measured_at || buildBiometricEmptyForm(normalizedRouteMetricType).measured_at,
      }));
      setIsEntryModalOpen(false);
    }
  }, [normalizedRouteMetricType]);

  const openEntryModal = useCallback(
    (metricType) => {
      if (!canEdit) return;
      setForm((prev) => ({
        ...buildBiometricEmptyForm(metricType),
        measured_at: prev.measured_at || buildBiometricEmptyForm(metricType).measured_at,
      }));
      setIsEntryModalOpen(true);
    },
    [canEdit]
  );

  const closeEntryModal = useCallback(() => {
    setIsEntryModalOpen(false);
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const savedReading = await createBiometricReading({
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
      setEntrySuccess({
        id: savedReading?.id,
        profileLabel: activeProfile?.display_name || activeProfile?.full_name || "Perfil activo",
        metricLabel: getBiometricMetricLabel(savedReading?.metric_type || form.metric_type),
        valueLabel: formatBiometricValue(savedReading || form, savedReading?.metric_type || form.metric_type),
        measuredAtLabel: formatBiometricMeasuredAt(savedReading?.measured_at || form.measured_at),
      });
      setForm(buildBiometricEmptyForm(form.metric_type));
      setIsEntryModalOpen(false);
      await loadDashboard();
    } catch (error) {
      window.alert(error?.response?.data?.detail || "No pudimos guardar el registro biométrico.");
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

  const entryModal =
    isEntryModalOpen && canEdit
      ? createPortal(
          <div className="modal-backdrop" onClick={closeEntryModal}>
            <div
              className="modal-card bio-entry-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="bio-entry-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-card-header bio-entry-modal-header">
                <div>
                  <h3 id="bio-entry-modal-title">Registrar parámetro</h3>
                  <p className="bio-entry-modal-header-copy">
                    Guarda un valor puntual sin salir de la vista de detalle.
                  </p>
                </div>
                <button
                  type="button"
                  className="modal-card-close"
                  onClick={closeEntryModal}
                  aria-label="Cerrar registro de biométricos"
                >
                  ×
                </button>
              </div>

              <div className="modal-card-body bio-entry-modal-body">
                <div className="bio-entry-modal-copy">
                  <span className={`bio-entry-modal-badge tone-${formConfig.tone}`}>
                    <MetricIcon metricType={form.metric_type} />
                    {getBiometricMetricLabel(form.metric_type)}
                  </span>
                  <p>
                    Completa la medición con fecha, contexto y una nota opcional para dejarla lista
                    para revisión clínica.
                  </p>
                </div>

                <form className="bio-form bio-modal-form" onSubmit={handleSubmit}>
                  <div className="bio-form-grid">
                    <label className="bio-field">
                      <span>{form.metric_type === "blood_pressure" ? "Sistólica" : "Valor"}</span>
                      <input
                        type="number"
                        step={form.metric_type === "temperature" ? "0.1" : "1"}
                        value={form.value_primary}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, value_primary: event.target.value }))
                        }
                        placeholder={form.metric_type === "temperature" ? "36.5" : "0"}
                        required
                        disabled={saving}
                      />
                    </label>

                    {form.metric_type === "blood_pressure" ? (
                      <label className="bio-field">
                        <span>Diastólica</span>
                        <input
                          type="number"
                          step="1"
                          value={form.value_secondary}
                          onChange={(event) =>
                            setForm((prev) => ({ ...prev, value_secondary: event.target.value }))
                          }
                          placeholder="0"
                          required
                          disabled={saving}
                        />
                      </label>
                    ) : (
                      <label className="bio-field">
                        <span>Unidad</span>
                        <input
                          type="text"
                          value={form.unit}
                          onChange={(event) =>
                            setForm((prev) => ({ ...prev, unit: event.target.value }))
                          }
                          disabled={saving}
                        />
                      </label>
                    )}

                    <label className="bio-field">
                      <span>Fecha y hora</span>
                      <input
                        type="datetime-local"
                        value={form.measured_at}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, measured_at: event.target.value }))
                        }
                        required
                        disabled={saving}
                      />
                    </label>

                    <label className="bio-field">
                      <span>Contexto</span>
                      <input
                        type="text"
                        value={form.context}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, context: event.target.value }))
                        }
                        placeholder="Ej. ayunas, reposo, antes de dormir"
                        disabled={saving}
                      />
                    </label>
                  </div>

                  <label className="bio-field">
                    <span>Notas</span>
                    <textarea
                      rows="3"
                      value={form.notes}
                      onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                      placeholder="Agrega una observación breve si necesitas contexto para la consulta."
                      disabled={saving}
                    />
                  </label>

                  <div className="bio-form-actions bio-modal-actions">
                    <span className="bio-form-hint">
                      {getBiometricMetricLabel(form.metric_type)} · {formConfig.unit}
                    </span>
                    <div className="bio-modal-action-row">
                      <button
                        type="button"
                        className="bio-secondary-btn"
                        onClick={closeEntryModal}
                        disabled={saving}
                      >
                        Cancelar
                      </button>
                      <button type="submit" className="bio-primary-btn" disabled={saving}>
                        {saving ? "Guardando..." : "Guardar registro"}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>,
          document.getElementById("overlay-root") || document.body
        )
      : null;

  const biometricSuccessSheet = (
    <SuccessSheet
      open={Boolean(entrySuccess)}
      onClose={() => setEntrySuccess(null)}
      kicker="Biométrico guardado"
      title="Registro agregado"
      copy="La medición quedó guardada y ya forma parte del seguimiento clínico del perfil."
      referenceId={entrySuccess?.id}
      rows={[
        { icon: "profile", label: "Perfil", value: entrySuccess?.profileLabel || "Perfil activo" },
        { icon: "doc", label: "Parámetro", value: entrySuccess?.metricLabel || "Biométrico" },
        { icon: "pill", label: "Valor", value: entrySuccess?.valueLabel || "Registro guardado" },
        { icon: "clock", label: "Fecha", value: entrySuccess?.measuredAtLabel || "Ahora" },
      ]}
      secondaryLabel="Seguir revisando"
    />
  );

  if (loading) {
    return (
      <>
        {biometricSuccessSheet}
        <div className="bio-page">
          <div className="bio-loading">
            <div className="bio-loading-pulse" />
            <span>Cargando tu panel de biométricos...</span>
          </div>
        </div>
        {entryModal}
      </>
    );
  }

  if (!isMetricDetail) {
    return (
      <>
        {biometricSuccessSheet}
        <div className="bio-page">
          <section className="bio-hero-card bio-summary-hero">
            <div className="bio-hero-copy">
              <span className="bio-eyebrow">Mi salud · Biométricos</span>
              <h1 className="bio-title">Tu panel de parámetros</h1>
              <p className="bio-subtitle">
                Resumen general de tu monitoreo. Toca un parámetro para ver su detalle.
              </p>
              <div className="bio-hero-actions">
                <Link to="/mi-salud" className="bio-ghost-link">
                  Volver a Mi salud
                </Link>
                <Link to="/timeline" className="bio-ghost-link is-muted">
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
                <small>Parámetros con datos</small>
                <strong>{summaryMetricsWithData.length}</strong>
              </div>
              <div className="bio-hero-stat">
                <small>Último registro</small>
                <strong>
                  {latestMetric?.latest_reading
                    ? formatBiometricMeasuredAt(
                        latestMetric.latest_reading.measured_at ||
                          latestMetric.latest_reading.created_at
                      )
                    : "Sin registros"}
                </strong>
              </div>
              <div className="bio-hero-stat bio-hero-stat-highlight">
                <small>Resumen general</small>
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
              Estás revisando un perfil en modo lectura. Puedes revisar tendencias, pero no
              registrar nuevos parámetros desde este perfil.
            </div>
          ) : null}

          <section className="bio-summary-layout">
            <article className="bio-panel-card bio-summary-card">
              <div className="bio-panel-head">
                <div>
                  <h2 className="bio-panel-title">Parámetros</h2>
                </div>
              </div>

              <div className="bio-parameter-grid">
                {summaryMetrics.map((metric) => {
                  const config = getBiometricMetricConfig(metric.metric_type);
                  return (
                    <button
                      key={metric.metric_type}
                      type="button"
                      className={`bio-parameter-btn tone-${config.tone}`}
                      onClick={() => navigate(`/mi-salud/biometricos/${metric.metric_type}`)}
                    >
                      <span className={`bio-metric-icon tone-${config.tone}`}>
                        <MetricIcon metricType={metric.metric_type} />
                      </span>
                      <span className="bio-parameter-copy">
                        <strong>{metric.label}</strong>
                        <small>
                          {metric.latest_reading
                            ? formatBiometricValue(metric.latest_reading, metric.metric_type)
                            : "Sin registros"}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </article>

            <article className="bio-panel-card bio-summary-card bio-chart-card">
              <div className="bio-panel-head">
                <div>
                  <h2 className="bio-panel-title">Panorama combinado</h2>
                </div>
                <span className="bio-chart-pill">Tendencia</span>
              </div>

              <UnifiedMetricsChart metrics={summaryMetricsWithData} />
            </article>
          </section>

          <section className="bio-overview-strip">
            <article className={`bio-overview-card tone-${latestMetricConfig.tone}`}>
              <small>Último parámetro</small>
              <strong>
                {latestMetric?.latest_reading
                  ? `${latestMetric.label}: ${formatBiometricValue(latestMetric.latest_reading)}`
                  : "Sin monitoreo activo"}
              </strong>
              <span>
                {latestMetric?.latest_reading
                  ? formatBiometricMeasuredAt(
                      latestMetric.latest_reading.measured_at ||
                        latestMetric.latest_reading.created_at
                    )
                  : "Guarda tu primera medición"}
              </span>
            </article>

            <article className="bio-overview-card">
              <small>Registros recientes</small>
              <strong>{recentReadings.length}</strong>
              <span>Mediciones disponibles</span>
            </article>

            <article className="bio-overview-card">
              <small>{canEdit ? "Siguiente paso" : "Modo lectura"}</small>
              <strong>
                {canEdit ? "Registrar una medición" : "Revisar tendencias"}
              </strong>
              <span>
                {canEdit
                  ? "Entra a un parámetro para guardar un valor"
                  : "Detalle disponible para consulta clínica"}
              </span>
            </article>
          </section>
        </div>
        {entryModal}
      </>
    );
  }

  return (
    <>
      {biometricSuccessSheet}
      <div className="bio-page bio-page-detail">
        <section className="bio-detail-topbar">
          <button
            type="button"
            className="bio-back-link"
            onClick={() => navigate("/mi-salud/biometricos")}
          >
            <span aria-hidden="true">←</span>
            Volver a resumen
          </button>

          <div className="bio-detail-topbar-copy">
            <span className="bio-eyebrow">Detalle del parámetro</span>
            <h1 className="bio-title">{selectedMetric.label}</h1>
            <p className="bio-subtitle">{selectedMetric.description}</p>
          </div>

          {canEdit ? (
            <button
              type="button"
              className="bio-primary-btn bio-detail-register-btn"
              onClick={() => openEntryModal(selectedMetric.metric_type)}
            >
              Registrar {selectedMetricConfig.shortLabel.toLowerCase()}
            </button>
          ) : null}
        </section>

        <section className="bio-detail-switcher">
          {summaryMetrics.map((metric) => {
            const config = getBiometricMetricConfig(metric.metric_type);
            return (
              <button
                key={metric.metric_type}
                type="button"
                className={`bio-detail-switch-btn ${
                  metric.metric_type === selectedMetric.metric_type ? "is-active" : ""
                } tone-${config.tone}`}
                onClick={() => navigate(`/mi-salud/biometricos/${metric.metric_type}`)}
              >
                <MetricIcon metricType={metric.metric_type} />
                <span>{config.shortLabel}</span>
              </button>
            );
          })}
        </section>

        <section className="bio-detail-grid">
          <article className={`bio-panel-card bio-focus-card tone-${selectedMetricConfig.tone}`}>
            <div className="bio-focus-top">
              <div>
                <small className="bio-focus-label">{selectedMetric.label}</small>
                <strong className="bio-focus-timestamp">
                  {selectedMetric?.latest_reading
                    ? formatBiometricMeasuredAt(
                        selectedMetric.latest_reading.measured_at ||
                          selectedMetric.latest_reading.created_at
                      )
                    : "Sin registros"}
                </strong>
              </div>
              <span className={`bio-focus-icon tone-${selectedMetricConfig.tone}`}>
                <MetricIcon metricType={selectedMetric.metric_type} />
              </span>
            </div>

            <div className="bio-focus-main">
              <div className="bio-focus-value-wrap">
                <strong className="bio-focus-value">{selectedDisplayValue.value}</strong>
                <span className="bio-focus-unit">{selectedDisplayValue.unit}</span>
              </div>
              <p className="bio-focus-copy">
                {selectedMetric?.latest_reading
                  ? selectedMetric.trend_summary
                  : `Aún no hay registros de ${selectedMetric.label.toLowerCase()}. Usa el botón superior para guardar la primera medición.`}
              </p>
            </div>

            <div className="bio-focus-scale" aria-hidden="true">
              <span
                className="bio-focus-scale-dot"
                style={{ left: `${getMetricPosition(selectedMetric)}%` }}
              />
              <div className="bio-focus-scale-track">
                <span className="segment short" />
                <span className="segment mid" />
                <span className={`segment accent tone-${selectedMetricConfig.tone}`} />
                <span className="segment long" />
                <span className="segment tail" />
              </div>
            </div>

            <div className="bio-focus-footer">
              <div className="bio-focus-stat">
                <small>Promedio reciente</small>
                <strong>{getMetricAverageLabel(selectedMetric)}</strong>
              </div>
              <div className="bio-focus-stat">
                <small>Tendencia</small>
                <strong>{getBiometricTrendLabel(selectedMetric?.trend_direction)}</strong>
              </div>
              <div className="bio-focus-stat">
                <small>Registros</small>
                <strong>{selectedMetric?.readings_count || 0}</strong>
              </div>
            </div>
          </article>

          <article className="bio-panel-card bio-detail-chart-card">
            <div className="bio-panel-head">
              <div>
                <h2 className="bio-panel-title">Evolución del parámetro</h2>
                <p className="bio-panel-subtitle">
                  Aquí se concentra el seguimiento específico de {selectedMetric.label.toLowerCase()}.
                </p>
              </div>
            </div>

            <Sparkline
              points={selectedMetric.chart_points}
              metricType={selectedMetric.metric_type}
              tone={selectedMetricConfig.tone}
            />
            <DetailSummaryCards metric={selectedMetric} />
          </article>
        </section>

        <section className="bio-detail-bottom-grid">
          <article className="bio-panel-card bio-insights-card">
            <div className="bio-panel-head">
              <div>
                <h2 className="bio-panel-title">Lectura rápida</h2>
                <p className="bio-panel-subtitle">
                  Explicación simple enfocada en este parámetro.
                </p>
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
              Este panel describe continuidad y cambios observables. No reemplaza la interpretación
              de un profesional.
            </div>
          </article>

          <article className="bio-panel-card bio-detail-recent-card">
            <div className="bio-panel-head">
              <div>
                <h2 className="bio-panel-title">Historial de {selectedMetricConfig.shortLabel}</h2>
                <p className="bio-panel-subtitle">
                  Revisión rápida de las últimas mediciones registradas.
                </p>
              </div>
            </div>

            {filteredRecentReadings.length ? (
              <div className="bio-recent-list">
                {filteredRecentReadings.map((item) => (
                  <div key={item.id} className="bio-recent-row">
                    <span className={`bio-recent-icon tone-${selectedMetricConfig.tone}`}>
                      <MetricIcon metricType={item.metric_type} />
                    </span>
                    <div className="bio-recent-copy">
                      <div className="bio-recent-head">
                        <strong>{formatBiometricValue(item)}</strong>
                        <span className={`bio-recent-pill tone-${selectedMetricConfig.tone}`}>
                          {selectedMetricConfig.shortLabel}
                        </span>
                      </div>
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
                ))}
              </div>
            ) : (
              <div className="bio-empty-state">
                Aún no hay registros de {selectedMetric.label.toLowerCase()} en este perfil.
              </div>
            )}
          </article>
        </section>
      </div>
      {entryModal}
    </>
  );
}
