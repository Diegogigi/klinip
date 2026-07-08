import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getActiveHealthProfile } from "../services/httpApi";
import HealthSheetPanel from "../components/health/HealthSheetPanel";

// Sección propia de la Ficha de Salud: aquí vive el detalle completo
// (historial de valores de exámenes, diagnósticos, vacunas e indicaciones).
// En Mi Salud solo queda la tarjeta resumen que lleva hasta acá.
export default function HealthSheet() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getActiveHealthProfile()
      .then((data) => {
        if (!cancelled) setProfile(data || null);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="clp-page">
        <div className="clp-loading">
          <div className="clp-loading-pulse" />
          <span>Abriendo tu ficha de salud…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="clp-page hsheet-page">
      <section className="clp-page-intro" aria-label="Ficha de Salud">
        <div className="clp-page-intro-copy">
          <p className="clp-page-intro-kicker">{profile?.full_name || "Perfil activo"}</p>
          <h1 className="clp-page-intro-title">Ficha de Salud</h1>
          <p className="clp-page-intro-subtitle">
            Tus diagnósticos, vacunas y el historial completo de tus exámenes, siempre a mano.
          </p>
        </div>
      </section>

      {profile?.id ? (
        <HealthSheetPanel profileId={profile.id} />
      ) : (
        <div className="clp-empty">
          No pudimos identificar tu perfil activo. Vuelve a Mi Salud e inténtalo de nuevo.
        </div>
      )}

      <Link to="/mi-salud" className="hsheet-back-link">
        ← Volver a Mi Salud
      </Link>
    </div>
  );
}
