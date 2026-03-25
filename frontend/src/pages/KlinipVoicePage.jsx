import React, { useEffect, useState } from "react";
import { getActiveHealthProfile, getHealthProfiles } from "../api";
import { canWriteProfile } from "../utils/profileAccess";
import KlinipVoice from "../components/KlinipVoice";

export default function KlinipVoicePage() {
  const [activeProfile, setActiveProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [profiles, active] = await Promise.all([
          getHealthProfiles(),
          getActiveHealthProfile().catch(() => null),
        ]);
        const resolved =
          active || (Array.isArray(profiles) && profiles.length ? profiles[0] : null);
        setActiveProfile(resolved);
      } catch {
        setActiveProfile(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="voice-page">
        <div className="voice-page-loading">Cargando...</div>
      </div>
    );
  }

  const canEdit = canWriteProfile(activeProfile);

  return (
    <div className="voice-page">
      <KlinipVoice profileId={activeProfile?.id} canEdit={canEdit} />
    </div>
  );
}
